/**
 * Voz da NEXO AI — abstração de fala (TTS) e escuta (STT).
 *
 * Provider ativo: VozGemini
 *   - TTS: chama /api/nexo-ai/tts (Gemini neural no servidor, chave oculta)
 *   - Reproduz via Web AudioContext com AnalyserNode → amplitude real para o orbe
 *   - Fallback para a voz nativa do navegador APENAS em erro de rede (endpoint
 *     inacessível). Erros de API/autenticação propagam via cb.aoErro — nunca
 *     ficam silenciosos.
 *   - STT: Web Speech API com AnalyserNode no microfone → amplitude real durante escuta
 *
 * Trocar de provider: mudar criarProvedorVoz() no final — nada mais muda.
 */

import { getSupabase } from '@/data/supabase/client';

export interface AoFalar {
  aoIniciar?: () => void;
  aoTerminar?: () => void;
  aoErro?: (motivo: string) => void;
  /** 0..1, atualizado durante a fala para o orbe reagir. */
  aoNivel?: (nivel: number) => void;
}

export interface AoOuvir {
  aoParcial?: (texto: string) => void;
  aoFinal?: (texto: string) => void;
  aoErro?: (motivo: string) => void;
  aoFim?: () => void;
  /** 0..1, amplitude real do microfone durante a escuta. */
  aoNivel?: (nivel: number) => void;
}

export interface ProvedorVoz {
  readonly nome: string;
  readonly podeFalar: boolean;
  readonly podeOuvir: boolean;
  falar(texto: string, cb?: AoFalar): void;
  pararFala(): void;
  ouvir(cb?: AoOuvir): void;
  pararEscuta(): void;
  /** Para a escuta chamando rec.stop() — Chrome comita isFinal e dispara aoFinal → enviar. */
  finalizarEscuta(): void;
}

/* --------------------------------------------------------------------------
   Tipagem mínima da Web Speech API (não vem no lib.dom padrão)
   -------------------------------------------------------------------------- */

interface ReconhecimentoFala extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: {
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type ConstrutorReconhecimento = new () => ReconhecimentoFala;

function construtorReconhecimento(): ConstrutorReconhecimento | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorReconhecimento;
    webkitSpeechRecognition?: ConstrutorReconhecimento;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* --------------------------------------------------------------------------
   Seleção de voz feminina — mantido para o fallback nativo de rede
   -------------------------------------------------------------------------- */

export function escolherVozFeminina(vozes: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!vozes.length) return null;
  const ptBR = vozes.filter((v) => /pt[-_]?BR/i.test(v.lang));
  const candidatas = ptBR.length ? ptBR : vozes.filter((v) => /^pt/i.test(v.lang));
  const nomesFemininos = /(maria|luciana|fernanda|francisca|ana|helena|vit[óo]ria|female|mulher|feminin)/i;
  return (
    candidatas.find((v) => nomesFemininos.test(v.name)) ??
    candidatas[0] ??
    vozes[0] ??
    null
  );
}

/* --------------------------------------------------------------------------
   VozGemini — TTS neural via /api/nexo-ai/tts
   -------------------------------------------------------------------------- */

class VozGemini implements ProvedorVoz {
  readonly nome = 'gemini-tts';

  private reconhecimento: ReconhecimentoFala | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private nivelTimer: ReturnType<typeof setInterval> | null = null;
  private cancelado = false;
  private ttsGenId = 0;

  // Análise de amplitude do microfone durante STT
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micNivelTimer: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  // Cache do token Supabase — evita round-trip repetido a cada chamada TTS
  private tokenCache: { value: string; expiresAt: number } | null = null;

  /* ---- capacidades ---- */

  get podeFalar(): boolean {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  get podeOuvir(): boolean {
    return construtorReconhecimento() !== null;
  }

  /* ---- TTS ---- */

  falar(texto: string, cb: AoFalar = {}): void {
    if (!this.podeFalar || !texto.trim()) {
      cb.aoTerminar?.();
      return;
    }
    this.pararFala();
    this.cancelado = false;
    void this.tentarGemini(texto, cb);
  }

  private async tentarGemini(texto: string, cb: AoFalar): Promise<void> {
    const genId = ++this.ttsGenId;
    const _tts0 = Date.now();
    // Pré-aquece o AudioContext imediatamente — correrá em paralelo com a rede
    // para eliminar o atraso de criação/resume após o áudio chegar.
    const ctxPromise = this.obterCtxPronto();

    let resp: Response;
    try {
      const token = await this.token();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      resp = await fetch('/api/nexo-ai/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ texto }),
      });
    } catch (e) {
      // Erro de rede — endpoint inacessível. Fallback para voz nativa.
      if (this.cancelado || genId !== this.ttsGenId) return;
      console.warn('[VozGemini] erro de rede, usando voz nativa:', e instanceof Error ? e.message : String(e));
      this.falarNativo(texto, cb);
      return;
    }

    if (this.cancelado || genId !== this.ttsGenId) return;
    console.debug('[TIMING] T5 resposta TTS:', Date.now() - _tts0, 'ms | status:', resp.status);

    if (!resp.ok) {
      // Erro da API (autenticação, modelo, configuração). NÃO usa fallback —
      // o erro precisa ficar visível para que seja corrigido.
      let mensagem = `Gemini TTS retornou status ${resp.status}`;
      try {
        const contentType = resp.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const body = await resp.json() as { erro?: string };
          if (body?.erro) mensagem = body.erro;
        }
      } catch { /* ignora erro ao ler o corpo */ }
      console.error('[VozGemini] falha no endpoint TTS:', mensagem);
      cb.aoErro?.(mensagem);
      return;
    }

    // Loga qual modelo foi usado para confirmar que é o Gemini (não o nativo).
    const modeloUsado = resp.headers.get('X-TTS-Model') ?? 'gemini';
    console.info(`[VozGemini] áudio gerado pelo Gemini (modelo: ${modeloUsado})`);

    try {
      // Lê o buffer e aguarda o AudioContext prontos em paralelo — o ctx já deve
      // ter resolvido durante a chamada de rede, então a espera aqui é zero.
      const [raw, ctx] = await Promise.all([resp.arrayBuffer(), ctxPromise]);
      if (this.cancelado || genId !== this.ttsGenId) return;
      console.debug('[TIMING] T5b áudio+ctx prontos:', Date.now() - _tts0, 'ms | bytes:', raw.byteLength);

      const audioBuffer = await ctx.decodeAudioData(raw);
      if (this.cancelado || genId !== this.ttsGenId) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      this.sourceNode = source;
      this.analyser = analyser;

      source.onended = () => {
        this.pararNivel();
        cb.aoNivel?.(0);
        cb.aoTerminar?.();
      };

      cb.aoIniciar?.();
      this.iniciarNivel(cb);
      source.start(0);
      console.debug('[TIMING] T6 reprodução TTS:', Date.now() - _tts0, 'ms');
    } catch (e) {
      if (this.cancelado) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[VozGemini] erro ao decodificar áudio:', msg);
      cb.aoErro?.(`Erro ao reproduzir áudio do Gemini: ${msg}`);
    }
  }

  private falarNativo(texto: string, cb: AoFalar): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      cb.aoErro?.('TTS não disponível.');
      return;
    }
    window.speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR';
    fala.rate = 1.02;
    fala.pitch = 1.05;
    const voz = escolherVozFeminina(window.speechSynthesis.getVoices());
    if (voz) fala.voice = voz;

    fala.onstart = () => {
      cb.aoIniciar?.();
      this.nivelTimer = setInterval(() => cb.aoNivel?.(0.35 + Math.random() * 0.5), 90);
    };
    const encerrar = () => {
      this.pararNivel();
      cb.aoNivel?.(0);
    };
    fala.onend = () => { encerrar(); cb.aoTerminar?.(); };
    fala.onerror = () => { encerrar(); cb.aoErro?.('Falha ao sintetizar a voz.'); };
    window.speechSynthesis.speak(fala);
  }

  pararFala(): void {
    this.cancelado = true;
    this.pararNivel();
    if (this.sourceNode) {
      this.sourceNode.onended = null; // Impede aoTerminar de disparar em parada intencional
      try { this.sourceNode.stop(); } catch { /* já parado */ }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /* ---- Amplitude real via AnalyserNode para o orbe (TTS) ---- */

  private iniciarNivel(cb: AoFalar): void {
    const analyser = this.analyser;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    this.nivelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let soma = 0;
      for (const v of buf) soma += Math.abs(v - 128);
      cb.aoNivel?.(Math.min(1, (soma / buf.length / 128) * 8));
    }, 60);
  }

  private pararNivel(): void {
    if (this.nivelTimer) {
      clearInterval(this.nivelTimer);
      this.nivelTimer = null;
    }
  }

  /* ---- AudioContext ---- */

  private obterCtx(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  /** Garante que o AudioContext está running; resolve assim que pronto. */
  private async obterCtxPronto(): Promise<AudioContext> {
    const ctx = this.obterCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  /* ---- Token Supabase com cache ---- */

  private async token(): Promise<string | null> {
    const agora = Date.now();
    // Reutiliza o token se ainda for válido por pelo menos 30 s
    if (this.tokenCache && this.tokenCache.expiresAt > agora + 30_000) {
      return this.tokenCache.value;
    }
    const { data } = await getSupabase().auth.getSession();
    const session = data.session;
    if (session?.access_token) {
      this.tokenCache = {
        value: session.access_token,
        expiresAt: (session.expires_at ?? 0) * 1000,
      };
      return session.access_token;
    }
    this.tokenCache = null;
    return null;
  }

  /* ---- Amplitude real do microfone via AnalyserNode durante STT ---- */

  private async iniciarAnalyseMic(cb: AoOuvir): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      // Sem processamento de áudio — echoCancellation/noiseSuppression/AGC
      // interferem com o VAD interno do SpeechRecognition no Chrome,
      // impedindo que o silêncio seja detectado e isFinal nunca dispara.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (!this.reconhecimento) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.micStream = stream;

      const ctx = this.obterCtx();
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      // Conecta só ao analyser, NÃO ao destination — evita feedback de áudio
      source.connect(analyser);

      this.micSource = source;
      this.micAnalyser = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const LIMIAR_VOZ = 0.04;  // abaixo deste nível = silêncio
      const SILENCIO_MS = 800;  // ms de silêncio após fala → forçar stop
      let falou = false;

      this.micNivelTimer = setInterval(() => {
        if (!this.micAnalyser) return;
        this.micAnalyser.getByteTimeDomainData(buf);
        let soma = 0;
        for (const v of buf) soma += Math.abs(v - 128);
        const nivel = Math.min(1, (soma / buf.length / 128) * 8);
        cb.aoNivel?.(nivel);

        if (nivel > LIMIAR_VOZ) {
          // Usuário está falando: cancela timer de silêncio se existir
          falou = true;
          if (this.silenceTimer !== null) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
          }
        } else if (falou && this.silenceTimer === null) {
          // Silêncio detectado após fala: agenda stop do SpeechRecognition.
          // Quando rec.stop() é chamado explicitamente, o Chrome comita o
          // resultado pendente como isFinal=true e dispara onend.
          this.silenceTimer = setTimeout(() => {
            this.silenceTimer = null;
            if (this.reconhecimento) {
              try { this.reconhecimento.stop(); } catch { /* ignore */ }
            }
          }, SILENCIO_MS);
        }
      }, 60);
    } catch {
      // getUserMedia negado ou indisponível — amplitude visual não disponível,
      // mas o STT continua funcionando normalmente.
    }
  }

  private pararAnalyseMic(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.micNivelTimer) {
      clearInterval(this.micNivelTimer);
      this.micNivelTimer = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* já desconectado */ }
      this.micSource = null;
    }
    if (this.micAnalyser) {
      try { this.micAnalyser.disconnect(); } catch { /* já desconectado */ }
      this.micAnalyser = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
  }

  /* ---- STT ---- */

  ouvir(cb: AoOuvir = {}): void {
    const Construtor = construtorReconhecimento();
    if (!Construtor) {
      cb.aoErro?.('Este navegador não reconhece voz. Use o teclado.');
      return;
    }
    this.pararEscuta();

    const rec = new Construtor();
    rec.lang = 'pt-BR';
    rec.continuous = false;
    rec.interimResults = true;

    let finalChamado = false;
    rec.onresult = (e) => {
      let parcial = '';
      let finalizado = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) finalizado += txt;
        else parcial += txt;
      }
      if (parcial) cb.aoParcial?.(parcial);
      if (finalizado && !finalChamado) {
        finalChamado = true;
        cb.aoFinal?.(finalizado.trim());
      }
    };

    rec.onerror = (e) => {
      const erros: Record<string, string> = {
        'not-allowed': 'Permissão de microfone negada.',
        'service-not-allowed': 'O serviço de reconhecimento de voz não está disponível neste navegador.',
        'no-speech': 'Não ouvi nada. Tente de novo.',
        'audio-capture': 'Não foi possível acessar o microfone.',
        network: 'Erro de rede no reconhecimento de voz.',
        aborted: 'O reconhecimento de voz foi interrompido.',
        'language-not-supported': 'O reconhecimento de português não está disponível neste navegador.',
      };
      cb.aoErro?.(erros[e.error] ?? `Falha no reconhecimento de voz (${e.error}).`);
    };

    rec.onend = () => {
      this.pararAnalyseMic();
      cb.aoNivel?.(0);
      cb.aoFim?.();
    };

    this.reconhecimento = rec;
    try {
      rec.start();
      // Inicia captura de amplitude do microfone em paralelo com o STT
      void this.iniciarAnalyseMic(cb);
    } catch {
      cb.aoErro?.('Não foi possível iniciar a escuta.');
    }
  }

  pararEscuta(): void {
    this.pararAnalyseMic();
    if (this.reconhecimento) {
      try { this.reconhecimento.abort(); } catch { /* já parado */ }
      this.reconhecimento = null;
    }
  }

  finalizarEscuta(): void {
    // rec.stop() faz Chrome comitar o transcript pendente como isFinal=true
    // e depois dispara onend → pararAnalyseMic + aoFim.
    if (this.reconhecimento) {
      try { this.reconhecimento.stop(); } catch { /* já parado */ }
      // Não null aqui — onend limpa
    } else {
      this.pararAnalyseMic();
    }
  }
}

/* --------------------------------------------------------------------------
   Ponto único de troca de provider — só esta linha muda ao trocar
   -------------------------------------------------------------------------- */

export function criarProvedorVoz(): ProvedorVoz {
  return new VozGemini();
}

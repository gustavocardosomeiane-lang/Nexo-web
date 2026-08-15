/**
 * Voz da NEXO AI — abstração de fala (TTS) e escuta (STT).
 *
 * Provider ativo: VozGemini
 *   - TTS: chama /api/nexo-ai/tts (Gemini neural no servidor, chave oculta)
 *   - Reproduz via Web AudioContext com AnalyserNode → amplitude real para o orbe
 *   - Fallback automático para a voz nativa do navegador se o endpoint falhar
 *   - STT: Web Speech API (mesma lógica de sempre)
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
}

export interface ProvedorVoz {
  readonly nome: string;
  readonly podeFalar: boolean;
  readonly podeOuvir: boolean;
  falar(texto: string, cb?: AoFalar): void;
  pararFala(): void;
  ouvir(cb?: AoOuvir): void;
  pararEscuta(): void;
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
   Seleção de voz feminina — mantido para o fallback nativo
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
   VozGemini — TTS neural via /api/nexo-ai/tts + fallback para voz nativa
   -------------------------------------------------------------------------- */

class VozGemini implements ProvedorVoz {
  readonly nome = 'gemini-tts';

  private reconhecimento: ReconhecimentoFala | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private nivelTimer: ReturnType<typeof setInterval> | null = null;
  private cancelado = false;

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
    try {
      const token = await this.token();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resp = await fetch('/api/nexo-ai/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ texto }),
      });

      if (!resp.ok) throw new Error(`status ${resp.status}`);
      if (this.cancelado) return;

      const raw = await resp.arrayBuffer();
      if (this.cancelado) return;

      const ctx = this.obterCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      if (this.cancelado) return;

      const audioBuffer = await ctx.decodeAudioData(raw);
      if (this.cancelado) return;

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
    } catch (e) {
      if (this.cancelado) return;
      console.warn('[VozGemini] fallback:', e instanceof Error ? e.message : String(e));
      this.falarNativo(texto, cb);
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

  /* ---- Amplitude real via AnalyserNode para o orbe ---- */

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

  private obterCtx(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  private async token(): Promise<string | null> {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  }

  /* ---- STT (mesma lógica de sempre) ---- */

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
      if (finalizado) cb.aoFinal?.(finalizado.trim());
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

    rec.onend = () => cb.aoFim?.();
    this.reconhecimento = rec;
    try { rec.start(); } catch { cb.aoErro?.('Não foi possível iniciar a escuta.'); }
  }

  pararEscuta(): void {
    if (this.reconhecimento) {
      try { this.reconhecimento.abort(); } catch { /* já parado */ }
      this.reconhecimento = null;
    }
  }
}

/* --------------------------------------------------------------------------
   Ponto único de troca de provider — só esta linha muda ao trocar
   -------------------------------------------------------------------------- */

export function criarProvedorVoz(): ProvedorVoz {
  return new VozGemini();
}

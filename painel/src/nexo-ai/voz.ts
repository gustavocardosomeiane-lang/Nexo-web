/* Voz e escuta da NEXO AI: Speech Recognition para entrada + Gemini TTS para saída. */
import { getSupabase } from '@/data/supabase/client';

export interface AoFalar { aoIniciar?: () => void; aoTerminar?: () => void; aoErro?: (motivo: string) => void; aoNivel?: (nivel: number) => void; }
export interface AoOuvir { aoParcial?: (texto: string) => void; aoFinal?: (texto: string) => void; aoErro?: (motivo: string) => void; aoFim?: () => void; }
export interface ProvedorVoz { readonly nome: string; readonly podeFalar: boolean; readonly podeOuvir: boolean; falar(texto: string, cb?: AoFalar): void; pararFala(): void; ouvir(cb?: AoOuvir): void; pararEscuta(): void; }

interface ReconhecimentoFala extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type ConstrutorReconhecimento = new () => ReconhecimentoFala;

function construtorReconhecimento(): ConstrutorReconhecimento | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: ConstrutorReconhecimento; webkitSpeechRecognition?: ConstrutorReconhecimento };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function criarContextoAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

function limparParaVoz(texto: string): string {
  return texto
    .replace(/[*_~`#]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

function pcm16ParaBuffer(ctx: AudioContext, bytes: ArrayBuffer): AudioBuffer {
  const view = new DataView(bytes);
  const samples = Math.floor(view.byteLength / 2);
  const buffer = ctx.createBuffer(1, samples, 24000);
  const canal = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) canal[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

class VozGemini implements ProvedorVoz {
  readonly nome = 'gemini-kore';
  private reconhecimento: ReconhecimentoFala | null = null;
  private contextoAudio: AudioContext | null = null;
  private fonteAtual: AudioBufferSourceNode | null = null;
  private falando = false;
  private temporizadorSilencio: ReturnType<typeof setTimeout> | null = null;
  private faixaMicrofone: MediaStream | null = null;
  private analisadorMicrofone: AnalyserNode | null = null;
  private fonteMicrofone: MediaStreamAudioSourceNode | null = null;
  private frameVoz: number | null = null;
  private inicioVoz = false;
  private ultimoSom = 0;

  get podeFalar(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in (window as unknown as Record<string, unknown>));
  }

  get podeOuvir(): boolean { return construtorReconhecimento() !== null; }

  private garantirContextoAudio(): AudioContext | null {
    if (!this.contextoAudio) this.contextoAudio = criarContextoAudio();
    return this.contextoAudio;
  }

  private async tokenSessao(): Promise<string | null> {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  }

  private async prepararAudio(): Promise<void> {
    const ctx = this.garantirContextoAudio();
    if (ctx?.state === 'suspended') await ctx.resume();
  }

  falar(texto: string, cb: AoFalar = {}): void {
    const limpo = limparParaVoz(texto);
    if (!this.podeFalar || !limpo) { cb.aoTerminar?.(); return; }

    this.pararFala();
    this.falando = true;
    cb.aoIniciar?.();

    void (async () => {
      try {
        await this.prepararAudio();
        const token = await this.tokenSessao();
        if (!token) throw new Error('Sua sessão expirou. Entre novamente para falar com a NEXO AI.');

        const resposta = await fetch('/api/nexo-ai/falar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ texto: limpo }),
        });
        if (!resposta.ok) {
          const corpo = await resposta.json().catch(() => null) as { erro?: string } | null;
          throw new Error(corpo?.erro ?? 'Não foi possível gerar a voz.');
        }

        const bytes = await resposta.arrayBuffer();
        const ctx = this.garantirContextoAudio();
        if (!ctx) throw new Error('Áudio não disponível neste navegador.');
        await ctx.resume();
        const buffer = pcm16ParaBuffer(ctx, bytes);
        if (!this.falando) return;

        const fonte = ctx.createBufferSource();
        fonte.buffer = buffer;
        fonte.connect(ctx.destination);
        this.fonteAtual = fonte;
        fonte.onended = () => {
          if (this.fonteAtual === fonte) this.fonteAtual = null;
          this.falando = false;
          cb.aoNivel?.(0);
          cb.aoTerminar?.();
        };
        const inicio = performance.now();
        const atualizarNivel = () => {
          if (!this.falando || this.fonteAtual !== fonte) return;
          const decorrido = (performance.now() - inicio) / 1000;
          const duracao = buffer.duration || 1;
          const pulso = 0.3 + Math.min(0.65, Math.max(0, 1 - decorrido / duracao) * 0.5);
          cb.aoNivel?.(pulso);
          requestAnimationFrame(atualizarNivel);
        };
        atualizarNivel();
        fonte.start(0);
      } catch (e) {
        this.falando = false;
        cb.aoNivel?.(0);
        cb.aoErro?.(e instanceof Error ? e.message : 'Falha ao reproduzir a voz.');
      }
    })();
  }

  pararFala(): void {
    this.falando = false;
    if (this.fonteAtual) {
      try { this.fonteAtual.stop(); } catch {}
      this.fonteAtual = null;
    }
  }

  ouvir(cb: AoOuvir = {}): void {
    const Construtor = construtorReconhecimento();
    if (!Construtor) { cb.aoErro?.('Este navegador não reconhece voz. Use o teclado.'); return; }

    this.pararEscuta();
    this.pararFala();
    void this.iniciarEscuta(Construtor, cb);
  }

  private iniciarVAD(ctx: AudioContext, stream: MediaStream, concluir: () => void): void {
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 512;
    analisador.smoothingTimeConstant = 0.18;
    const fonte = ctx.createMediaStreamSource(stream);
    fonte.connect(analisador);
    this.analisadorMicrofone = analisador;
    this.fonteMicrofone = fonte;

    const dados = new Float32Array(analisador.fftSize);
    let pisoRuido = 0.006;
    const LIMIAR_FALA = 0.022;
    const SILENCIO_MS = 700;
    const PRE_ROLL_MS = 350;
    const comecouEm = performance.now();
    this.inicioVoz = false;
    this.ultimoSom = performance.now();

    const verificar = () => {
      if (!this.faixaMicrofone || this.faixaMicrofone !== stream) return;
      analisador.getFloatTimeDomainData(dados);
      let soma = 0;
      for (let i = 0; i < dados.length; i++) soma += dados[i] * dados[i];
      const rms = Math.sqrt(soma / dados.length);
      const agora = performance.now();

      if (!this.inicioVoz && agora - comecouEm < PRE_ROLL_MS && rms < LIMIAR_FALA) {
        pisoRuido = Math.min(0.02, pisoRuido * 0.92 + rms * 0.08);
      }

      const limiar = Math.max(LIMIAR_FALA, pisoRuido * 3.2);
      if (rms >= limiar) {
        this.inicioVoz = true;
        this.ultimoSom = agora;
      } else if (this.inicioVoz && agora - this.ultimoSom >= SILENCIO_MS) {
        concluir();
        return;
      }

      this.frameVoz = requestAnimationFrame(verificar);
    };

    this.frameVoz = requestAnimationFrame(verificar);
  }

  private pararVAD(): void {
    if (this.frameVoz !== null) cancelAnimationFrame(this.frameVoz);
    this.frameVoz = null;
    try { this.fonteMicrofone?.disconnect(); } catch {}
    try { this.analisadorMicrofone?.disconnect(); } catch {}
    this.fonteMicrofone = null;
    this.analisadorMicrofone = null;
  }

  private async iniciarEscuta(Construtor: ConstrutorReconhecimento, cb: AoOuvir): Promise<void> {
    const ctx = this.garantirContextoAudio();
    if (!ctx) {
      cb.aoErro?.('Áudio não disponível neste navegador.');
      cb.aoFim?.();
      return;
    }

    try {
      await ctx.resume();
      this.faixaMicrofone?.getTracks().forEach((faixa) => faixa.stop());
      this.faixaMicrofone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : '';
      const mensagens: Record<string, string> = {
        NotAllowedError: 'Permissão de microfone negada. Libere o microfone no navegador e tente novamente.',
        PermissionDeniedError: 'Permissão de microfone negada. Libere o microfone no navegador e tente novamente.',
        NotFoundError: 'Nenhum microfone foi encontrado neste dispositivo.',
        NotReadableError: 'O microfone está sendo usado por outro aplicativo.',
      };
      cb.aoErro?.(mensagens[nome] ?? 'Não foi possível acessar o microfone.');
      cb.aoFim?.();
      return;
    }

    const stream = this.faixaMicrofone;
    this.pararVAD();

    const rec = new Construtor();
    rec.lang = 'pt-BR';
    rec.continuous = false;
    rec.interimResults = true;

    let acumulado = '';
    let parcialAtual = '';
    let houveErro = false;
    let finalizado = false;

    const cancelarTemporizador = () => {
      if (this.temporizadorSilencio) {
        clearTimeout(this.temporizadorSilencio);
        this.temporizadorSilencio = null;
      }
    };

    const liberarMicrofone = () => {
      this.pararVAD();
      this.faixaMicrofone?.getTracks().forEach((faixa) => faixa.stop());
      this.faixaMicrofone = null;
    };

    const concluir = () => {
      cancelarTemporizador();
      if (finalizado) return;
      finalizado = true;
      const texto = acumulado.trim() || parcialAtual.trim();
      try { rec.stop(); } catch {}
      this.reconhecimento = null;
      liberarMicrofone();
      if (texto && !houveErro) cb.aoFinal?.(texto);
    };

    const programarEnvio = () => {
      cancelarTemporizador();
      this.temporizadorSilencio = setTimeout(concluir, 800);
    };

    rec.onresult = (e) => {
      let parcial = '';
      let novosFinais = '';
      const inicio = Math.max(0, e.results.length - 3);
      for (let i = inicio; i < e.results.length; i++) {
        const r = e.results[i]!;
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) novosFinais += `${txt} `;
        else parcial += `${txt} `;
      }
      if (novosFinais.trim()) acumulado = `${acumulado} ${novosFinais.trim()}`.trim();
      parcialAtual = parcial.trim();
      const visivel = `${acumulado} ${parcialAtual}`.trim();
      if (visivel) {
        cb.aoParcial?.(visivel);
        programarEnvio();
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech') return;
      houveErro = true;
      cancelarTemporizador();
      const erros: Record<string, string> = {
        'not-allowed': 'Permissão de microfone negada. Libere o microfone no navegador e tente novamente.',
        'service-not-allowed': 'O serviço de reconhecimento de voz não está disponível neste navegador.',
        'audio-capture': 'Não foi possível acessar o microfone.',
        network: 'Erro de rede no reconhecimento de voz.',
        aborted: 'O reconhecimento de voz foi interrompido.',
        'language-not-supported': 'O reconhecimento de português não está disponível neste navegador.',
      };
      cb.aoErro?.(erros[e.error] ?? `Falha no reconhecimento de voz (${e.error}).`);
    };

    rec.onend = () => {
      cancelarTemporizador();
      this.reconhecimento = null;
      if (!finalizado && !houveErro && (acumulado.trim() || parcialAtual.trim())) concluir();
      else liberarMicrofone();
      cb.aoFim?.();
    };

    this.reconhecimento = rec;
    this.iniciarVAD(ctx, stream, concluir);

    try {
      rec.start();
    } catch {
      this.reconhecimento = null;
      liberarMicrofone();
      cb.aoErro?.('Não foi possível iniciar a escuta. Tente clicar novamente no microfone.');
      cb.aoFim?.();
    }
  }

  pararEscuta(): void {
    if (this.temporizadorSilencio) {
      clearTimeout(this.temporizadorSilencio);
      this.temporizadorSilencio = null;
    }
    if (this.reconhecimento) {
      try { this.reconhecimento.stop(); } catch { try { this.reconhecimento.abort(); } catch {} }
      this.reconhecimento = null;
    }
    this.pararVAD();
    this.faixaMicrofone?.getTracks().forEach((faixa) => faixa.stop());
    this.faixaMicrofone = null;
  }
}

export function criarProvedorVoz(): ProvedorVoz { return new VozGemini(); }

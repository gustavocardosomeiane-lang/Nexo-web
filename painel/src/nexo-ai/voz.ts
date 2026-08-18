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
  /** Cancela a sessão de escuta ativa sem disparar aoFinal — usado por pararEscuta(). */
  private cancelarEscutaAtual: (() => void) | null = null;

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

  private async iniciarEscuta(Construtor: ConstrutorReconhecimento, cb: AoOuvir): Promise<void> {
    const rec = new Construtor();
    rec.lang = 'pt-BR';
    rec.continuous = false;
    rec.interimResults = true;

    let acumulado = '';
    let parcialAtual = '';
    let indiceProcessado = 0;
    let houveErro = false;
    let finalizado = false;

    const cancelarTemporizador = () => {
      if (this.temporizadorSilencio) {
        clearTimeout(this.temporizadorSilencio);
        this.temporizadorSilencio = null;
      }
    };

    const limparReferencias = () => {
      cancelarTemporizador();
      if (this.reconhecimento === rec) this.reconhecimento = null;
      if (this.cancelarEscutaAtual === cancelarSemEnviar) this.cancelarEscutaAtual = null;
    };

    const concluir = () => {
      cancelarTemporizador();
      if (finalizado) {
        console.log('[NEXO MIC] concluir: ja finalizado, ignorado');
        return;
      }
      finalizado = true;
      const texto = `${acumulado} ${parcialAtual}`.trim();
      console.log('[NEXO MIC] concluir', { texto, acumulado, parcialAtual, houveErro });
      limparReferencias();
      try { rec.stop(); } catch {}
      if (texto && !houveErro) {
        console.log('[NEXO MIC] aoFinal', texto);
        cb.aoFinal?.(texto);
      }
    };

    const cancelarSemEnviar = () => {
      console.log('[NEXO MIC] cancelarSemEnviar (pararEscuta chamado)');
      cancelarTemporizador();
      if (finalizado) return;
      finalizado = true;
      limparReferencias();
      try { rec.stop(); } catch { try { rec.abort(); } catch {} }
    };
    this.cancelarEscutaAtual = cancelarSemEnviar;

    const programarEnvio = () => {
      cancelarTemporizador();
      console.log('[NEXO MIC] timer scheduled');
      this.temporizadorSilencio = setTimeout(() => {
        console.log('[NEXO MIC] timer fired');
        concluir();
      }, 800);
    };

    rec.onresult = (e) => {
      if (finalizado) return;
      let parcial = '';
      for (let i = indiceProcessado; i < e.results.length; i++) {
        const r = e.results[i]!;
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) {
          acumulado = `${acumulado} ${txt}`.trim();
          indiceProcessado = i + 1;
        } else {
          parcial += `${txt} `;
        }
      }
      parcialAtual = parcial.trim();
      console.log('[NEXO MIC] onresult');
      console.log('[NEXO MIC] acumulado:', acumulado);
      console.log('[NEXO MIC] parcialAtual:', parcialAtual);
      const visivel = `${acumulado} ${parcialAtual}`.trim();
      if (visivel) {
        cb.aoParcial?.(visivel);
        programarEnvio();
      }
    };

    rec.onerror = (e) => {
      console.log('[NEXO MIC] onerror', e.error);
      if (e.error === 'no-speech') return;
      if (finalizado) return;
      const textoValido = `${acumulado} ${parcialAtual}`.trim();
      if (textoValido) {
        concluir();
        return;
      }
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
      console.log('[NEXO MIC] onend', { finalizado, acumulado, parcialAtual, houveErro });
      cancelarTemporizador();
      if (this.reconhecimento === rec) this.reconhecimento = null;
      if (!finalizado && (acumulado.trim() || parcialAtual.trim())) {
        concluir();
      } else if (!finalizado) {
        finalizado = true;
        if (this.cancelarEscutaAtual === cancelarSemEnviar) this.cancelarEscutaAtual = null;
      }
      cb.aoFim?.();
    };

    this.reconhecimento = rec;

    try {
      console.log('[NEXO MIC] start');
      rec.start();
    } catch {
      this.reconhecimento = null;
      if (this.cancelarEscutaAtual === cancelarSemEnviar) this.cancelarEscutaAtual = null;
      cancelarTemporizador();
      cb.aoErro?.('Não foi possível iniciar a escuta. Tente clicar novamente no microfone.');
      cb.aoFim?.();
    }
  }

  pararEscuta(): void {
    console.log('[NEXO MIC] pararEscuta chamado');
    if (this.cancelarEscutaAtual) {
      this.cancelarEscutaAtual();
      return;
    }
    if (this.temporizadorSilencio) {
      clearTimeout(this.temporizadorSilencio);
      this.temporizadorSilencio = null;
    }
    if (this.reconhecimento) {
      try { this.reconhecimento.stop(); } catch { try { this.reconhecimento.abort(); } catch {} }
      this.reconhecimento = null;
    }
  }
}

export function criarProvedorVoz(): ProvedorVoz { return new VozGemini(); }

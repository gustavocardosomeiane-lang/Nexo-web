export interface AoFalar {
  aoIniciar?: () => void;
  aoTerminar?: () => void;
  aoErro?: (motivo: string) => void;
  aoNivel?: (nivel: number) => void;
}

export interface AoOuvir {
  aoParcial?: (texto: string) => void;
  aoFinal?: (texto: string) => void;
  aoErro?: (motivo: string) => void;
  aoFim?: () => void;
}

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
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorReconhecimento;
    webkitSpeechRecognition?: ConstrutorReconhecimento;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface ProvedorVoz {
  readonly nome: string;
  readonly podeFalar: boolean;
  readonly podeOuvir: boolean;
  prepararFala(): void;
  falar(texto: string, cb?: AoFalar): void;
  pararFala(): void;
  ouvir(cb?: AoOuvir): void;
  pararEscuta(): void;
}

class VozNexa implements ProvedorVoz {
  readonly nome = 'gemini-kore';
  private reconhecimento: ReconhecimentoFala | null = null;
  private silencio: ReturnType<typeof setTimeout> | null = null;
  private contexto: AudioContext | null = null;
  private fonte: AudioBufferSourceNode | null = null;

  get podeFalar(): boolean {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  get podeOuvir(): boolean {
    return construtorReconhecimento() !== null;
  }

  private audioContext(): AudioContext {
    if (!this.contexto) this.contexto = new AudioContext();
    return this.contexto;
  }

  prepararFala(): void {
    if (!this.podeFalar) return;
    const ctx = this.audioContext();
    void ctx.resume().catch(() => undefined);
  }

  async falar(texto: string, cb: AoFalar = {}): Promise<void> {
    const limpo = texto
      .replace(/[*_~`#]+/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!limpo || !this.podeFalar) {
      cb.aoTerminar?.();
      return;
    }

    try {
      this.pararFala();
      const ctx = this.audioContext();
      await ctx.resume();
      cb.aoIniciar?.();

      const resposta = await fetch('/api/nexo-ai/falar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: limpo }),
      });

      if (!resposta.ok) throw new Error('TTS HTTP ' + resposta.status);
      const dados = await resposta.arrayBuffer();
      const buffer = await ctx.decodeAudioData(dados.slice(0));
      this.fonte = ctx.createBufferSource();
      this.fonte.buffer = buffer;
      this.fonte.connect(ctx.destination);
      this.fonte.onended = () => {
        this.fonte = null;
        cb.aoNivel?.(0);
        cb.aoTerminar?.();
      };
      this.fonte.start(0);

      const duracao = Math.max(300, buffer.duration * 1000);
      const inicio = performance.now();
      const animar = () => {
        if (!this.fonte) return;
        const progresso = (performance.now() - inicio) / duracao;
        cb.aoNivel?.(0.35 + Math.sin(progresso * 42) * 0.18 + Math.random() * 0.2);
        if (progresso < 1) requestAnimationFrame(animar);
      };
      requestAnimationFrame(animar);
    } catch (e) {
      this.fonte = null;
      cb.aoNivel?.(0);
      cb.aoErro?.(e instanceof Error ? e.message : 'Falha ao reproduzir a voz.');
      cb.aoTerminar?.();
    }
  }

  pararFala(): void {
    if (this.fonte) {
      try { this.fonte.stop(); } catch { /* já finalizado */ }
      this.fonte.disconnect();
      this.fonte = null;
    }
  }

  private limparSilencio(): void {
    if (this.silencio) clearTimeout(this.silencio);
    this.silencio = null;
  }

  private programarFim(rec: ReconhecimentoFala, cb: AoOuvir, ms = 1200): void {
    this.limparSilencio();
    this.silencio = setTimeout(() => {
      try { rec.stop(); } catch { /* já finalizado */ }
    }, ms);
  }

  ouvir(cb: AoOuvir = {}): void {
    const Construtor = construtorReconhecimento();
    if (!Construtor) {
      cb.aoErro?.('Seu navegador não oferece reconhecimento de voz.');
      return;
    }

    this.pararEscuta();
    const rec = new Construtor();
    rec.lang = 'pt-BR';
    rec.continuous = false;
    rec.interimResults = true;

    let ultimoTexto = '';
    let finalEnviado = false;

    rec.onresult = (e) => {
      let parcial = '';
      let finalizado = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) finalizado += txt;
        else parcial += txt;
      }

      const texto = `${finalizado} ${parcial}`.replace(/\s+/g, ' ').trim();
      if (texto) {
        ultimoTexto = texto;
        cb.aoParcial?.(texto);
        this.programarFim(rec, cb, finalizado ? 250 : 1200);
      }

      if (finalizado.trim() && !finalEnviado) {
        finalEnviado = true;
        this.limparSilencio();
        cb.aoFinal?.(finalizado.trim());
      }
    };

    rec.onerror = (e) => {
      this.limparSilencio();
      const erros: Record<string, string> = {
        'not-allowed': 'Permissão de microfone negada. Libere o microfone nas configurações do site.',
        'service-not-allowed': 'O reconhecimento de voz não está disponível neste navegador.',
        'no-speech': 'Não ouvi nada. Tente falar novamente.',
        'audio-capture': 'Não foi possível acessar o microfone.',
        network: 'Erro de rede no reconhecimento de voz.',
      };
      cb.aoErro?.(erros[e.error] ?? `Falha no reconhecimento de voz (${e.error}).`);
    };

    rec.onend = () => {
      this.limparSilencio();
      this.reconhecimento = null;
      if (!finalEnviado && ultimoTexto.trim()) {
        finalEnviado = true;
        cb.aoFinal?.(ultimoTexto.trim());
      }
      cb.aoFim?.();
    };

    this.reconhecimento = rec;
    try {
      rec.start();
    } catch {
      this.reconhecimento = null;
      cb.aoErro?.('Não foi possível iniciar o microfone. Tente clicar novamente.');
    }
  }

  pararEscuta(): void {
    this.limparSilencio();
    if (!this.reconhecimento) return;
    try { this.reconhecimento.stop(); } catch { /* já parado */ }
    this.reconhecimento = null;
  }
}

export function criarProvedorVoz(): ProvedorVoz {
  return new VozNexa();
}

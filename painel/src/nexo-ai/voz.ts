/**
 * Voz da NEXO AI — abstração de fala (TTS) e escuta (STT).
 *
 * ===========================================================================
 * POR QUE UMA INTERFACE, E NÃO SÓ `speechSynthesis` DIRETO
 *
 * Nesta fase a voz é a nativa do navegador: custo zero, sem dependência, e a
 * `Web Speech API` já traz vozes femininas em pt-BR. Mas a decisão do projeto
 * é poder trocar por um TTS em nuvem (voz de mais qualidade) sem reconstruir o
 * Core. Por isso a NEXO AI nunca chama `speechSynthesis` direto — ela fala com
 * `ProvedorVoz`. Trocar de provedor é implementar esta interface de novo e
 * mudar uma linha em `vozNativa` → `vozNuvem`. O resto do sistema não sabe.
 *
 * O `nivel` (0..1) existe para o orbe pulsar junto com a fala. A Web Speech
 * API não expõe amplitude real, então a implementação nativa sintetiza um
 * nível a partir dos eventos de fronteira de palavra. Um provedor em nuvem,
 * que devolve o áudio, poderá alimentar `nivel` com a amplitude verdadeira —
 * o orbe não muda.
 * ===========================================================================
 */

export interface AoFalar {
  aoIniciar?: () => void;
  aoTerminar?: () => void;
  aoErro?: (motivo: string) => void;
  /** 0..1, atualizado durante a fala, para o orbe reagir. */
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

/**
 * Escolhe a melhor voz feminina em português.
 *
 * Heurística por nome, porque a Web Speech API não marca gênero. Preferimos
 * pt-BR; entre elas, nomes historicamente femininos das vozes do sistema;
 * se nada casar, a primeira pt-BR; e por fim qualquer uma, para nunca ficar
 * muda por excesso de exigência.
 */
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
   Implementação NATIVA do navegador
   -------------------------------------------------------------------------- */

class VozNativa implements ProvedorVoz {
  readonly nome = 'navegador';
  private reconhecimento: ReconhecimentoFala | null = null;
  private timerNivel: ReturnType<typeof setInterval> | null = null;
  private vozCache: SpeechSynthesisVoice | null = null;

  get podeFalar(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get podeOuvir(): boolean {
    return construtorReconhecimento() !== null;
  }

  private resolverVoz(): SpeechSynthesisVoice | null {
    if (this.vozCache) return this.vozCache;
    this.vozCache = escolherVozFeminina(window.speechSynthesis.getVoices());
    return this.vozCache;
  }

  falar(texto: string, cb: AoFalar = {}): void {
    if (!this.podeFalar || !texto.trim()) {
      cb.aoTerminar?.();
      return;
    }
    window.speechSynthesis.cancel();

    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR';
    fala.rate = 1.02;
    fala.pitch = 1.05;
    const voz = this.resolverVoz();
    if (voz) fala.voice = voz;

    fala.onstart = () => {
      cb.aoIniciar?.();
      // Nível sintético: a API não expõe amplitude, então o orbe recebe uma
      // oscilação suave enquanto a fala dura. Um TTS de nuvem substitui isto
      // por amplitude real sem tocar no orbe.
      this.timerNivel = setInterval(() => {
        cb.aoNivel?.(0.35 + Math.random() * 0.5);
      }, 90);
    };
    const encerrar = () => {
      if (this.timerNivel) clearInterval(this.timerNivel);
      this.timerNivel = null;
      cb.aoNivel?.(0);
    };
    fala.onend = () => {
      encerrar();
      cb.aoTerminar?.();
    };
    fala.onerror = () => {
      encerrar();
      cb.aoErro?.('Falha ao sintetizar a voz.');
    };

    window.speechSynthesis.speak(fala);
  }

  pararFala(): void {
    if (this.podeFalar) window.speechSynthesis.cancel();
    if (this.timerNivel) {
      clearInterval(this.timerNivel);
      this.timerNivel = null;
    }
  }

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
    'service-not-allowed':
      'O serviço de reconhecimento de voz não está disponível neste navegador.',
    'no-speech': 'Não ouvi nada. Tente de novo.',
    'audio-capture': 'Não foi possível acessar o microfone.',
    network: 'Erro de rede no reconhecimento de voz.',
    aborted: 'O reconhecimento de voz foi interrompido.',
    'language-not-supported':
      'O reconhecimento de português não está disponível neste navegador.',
  };

  cb.aoErro?.(
    erros[e.error] ?? `Falha no reconhecimento de voz (${e.error}).`
  );
};
    rec.onend = () => cb.aoFim?.();

    this.reconhecimento = rec;
    try {
      rec.start();
    } catch {
      cb.aoErro?.('Não foi possível iniciar a escuta.');
    }
  }

  pararEscuta(): void {
    if (this.reconhecimento) {
      try {
        this.reconhecimento.abort();
      } catch {
        /* já parado */
      }
      this.reconhecimento = null;
    }
  }
}

/**
 * Provedor de voz em uso.
 *
 * Ponto único de troca: no dia do TTS em nuvem, isto vira
 * `new VozNuvem(...)` e nada mais no projeto muda.
 */
export function criarProvedorVoz(): ProvedorVoz {
  return new VozNativa();
}

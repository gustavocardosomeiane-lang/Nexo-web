/* Voz e escuta da NEXO AI: MediaRecorder + transcrição Groq para entrada, Gemini TTS para saída. */
import { getSupabase } from '@/data/supabase/client';

export interface AoFalar { aoIniciar?: () => void; aoTerminar?: () => void; aoErro?: (motivo: string) => void; aoNivel?: (nivel: number) => void; }
export interface AoOuvir { aoParcial?: (texto: string) => void; aoProcessando?: () => void; aoFinal?: (texto: string) => void; aoErro?: (motivo: string) => void; aoFim?: () => void; }
/** Callbacks de uma sessão de fila de fala — ver iniciarFilaFala(). */
export interface AoFilaFala {
  /** O primeiro áudio da fila começou a tocar de verdade. */
  aoIniciar?: () => void;
  aoNivel?: (nivel: number) => void;
  /** A fila foi encerrada (encerrarFilaFala) e esvaziou — nada mais tocando nem pendente. */
  aoTerminar?: () => void;
  /** Erro ao gerar/tocar UM segmento — não interrompe os demais da fila. */
  aoErro?: (motivo: string) => void;
}
export interface ProvedorVoz {
  readonly nome: string;
  readonly podeFalar: boolean;
  readonly podeOuvir: boolean;
  falar(texto: string, cb?: AoFalar): void;
  pararFala(): void;
  /** Começa uma nova sessão de fala incremental — cancela qualquer fila/áudio anterior. */
  iniciarFilaFala(cb?: AoFilaFala): void;
  /** Adiciona um trecho ao fim da fila; a síntese já começa em paralelo (prefetch). */
  enfileirarFala(texto: string): void;
  /** Sinaliza que não vem mais texto — aoTerminar dispara assim que a fila esvaziar. */
  encerrarFilaFala(): void;
  /** Cancela a fila ativa (áudio tocando + pendentes) sem chamar aoTerminar. */
  pararFilaFala(): void;
  ouvir(cb?: AoOuvir): void;
  pararEscuta(): void;
  finalizarEscuta(): void;
}

function podeGravarAudio(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window
  );
}

function tipoDeGravacaoSuportado(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((tipo) =>
    MediaRecorder.isTypeSupported(tipo),
  );
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

/** Motivo do DOMException do getUserMedia → mensagem em português. */
const ERROS_MICROFONE: Record<string, string> = {
  NotAllowedError: 'Permissão de microfone negada. Libere o microfone no navegador e tente novamente.',
  PermissionDeniedError: 'Permissão de microfone negada. Libere o microfone no navegador e tente novamente.',
  NotFoundError: 'Nenhum microfone encontrado neste dispositivo.',
  DevicesNotFoundError: 'Nenhum microfone encontrado neste dispositivo.',
  NotReadableError: 'O microfone está sendo usado por outro programa.',
  OverconstrainedError: 'Não foi possível configurar o microfone deste dispositivo.',
};

class VozGemini implements ProvedorVoz {
  readonly nome = 'gemini-kore';
  private contextoAudio: AudioContext | null = null;
  private fonteAtual: AudioBufferSourceNode | null = null;
  private falando = false;
  /* ---- Fila de fala incremental (TTS por segmento, streaming) ---- */
  private cbFilaFala: AoFilaFala = {};
  private filaFala: { texto: string; bufferPromise: Promise<AudioBuffer | null> }[] = [];
  private fonteFilaAtual: AudioBufferSourceNode | null = null;
  /** Incrementada a cada iniciarFilaFala()/pararFilaFala() — invalida callbacks presos de uma geração anterior. */
  private geracaoFala = 0;
  /** Geração dona do "worker" que consome a fila agora — evita dois workers rodando ao mesmo tempo. */
  private geracaoComWorkerAtivo: number | null = null;
  private filaEncerrada = false;
  private primeiraFalaDaGeracao = false;
  private streamAtual: MediaStream | null = null;
  private gravadorAtual: MediaRecorder | null = null;
  /** Cancela a gravação ativa sem transcrever/enviar — usado por pararEscuta(). */
  private cancelarEscutaAtual: (() => void) | null = null;
  /** Encerra a gravação ativa e dispara a transcrição — usado por finalizarEscuta() (2º clique no mic). */
  private finalizarEscutaAtual: (() => void) | null = null;

  get podeFalar(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in (window as unknown as Record<string, unknown>));
  }

  get podeOuvir(): boolean { return podeGravarAudio(); }

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

  /** Para tudo que estiver falando — a fala avulsa (falar()) E a fila incremental. */
  pararFala(): void {
    this.falando = false;
    if (this.fonteAtual) {
      try { this.fonteAtual.stop(); } catch {}
      this.fonteAtual = null;
    }
    this.pararFilaFala();
  }

  /* ==========================================================================
     FILA DE FALA INCREMENTAL

     Cada trecho de texto vira um pedido a /api/nexo-ai/falar assim que entra
     na fila (prefetch em paralelo — o próximo trecho já pode estar pronto
     antes do atual terminar de tocar). A REPRODUÇÃO é sempre serial: só um
     AudioBufferSourceNode ativo por vez, na ordem em que os textos entraram.

     `geracaoFala` é o mecanismo de cancelamento: iniciarFilaFala()/
     pararFilaFala() incrementam esse número, e todo callback assíncrono
     pendente (fetch de síntese, worker de reprodução) se auto-invalida ao
     notar que a geração mudou — o mesmo padrão de identidade já usado em
     iniciarGravacao() para o microfone.
     ========================================================================== */

  /** Começa uma nova sessão de fala incremental — cancela qualquer fila/áudio anterior primeiro. */
  iniciarFilaFala(cb: AoFilaFala = {}): void {
    this.pararFilaFala();
    this.cbFilaFala = cb;
    this.primeiraFalaDaGeracao = true;
  }

  /** Cancelamento real da fila: descarta o que estiver tocando e o que estiver pendente, sem chamar aoTerminar. */
  pararFilaFala(): void {
    console.log('[NEXO MIC] pararFilaFala (cancela fila de TTS)');
    this.geracaoFala += 1;
    this.filaFala = [];
    this.filaEncerrada = false;
    this.geracaoComWorkerAtivo = null;
    if (this.fonteFilaAtual) {
      try { this.fonteFilaAtual.stop(); } catch {}
      this.fonteFilaAtual = null;
    }
  }

  enfileirarFala(texto: string): void {
    const limpo = limparParaVoz(texto);
    if (!this.podeFalar || !limpo) return;
    const geracao = this.geracaoFala;
    this.filaFala.push({ texto: limpo, bufferPromise: this.sintetizarFala(limpo, geracao) });
    void this.processarFilaFala(geracao);
  }

  encerrarFilaFala(): void {
    this.filaEncerrada = true;
    // Garante o aoTerminar mesmo se a fila já estava vazia e parada (ex.:
    // resposta sem nenhum segmento falável — não deveria acontecer, mas não
    // pode deixar o estado da UI preso em "falando" por falta de callback).
    void this.processarFilaFala(this.geracaoFala);
  }

  private async sintetizarFala(texto: string, geracao: number): Promise<AudioBuffer | null> {
    try {
      const token = await this.tokenSessao();
      if (!token) throw new Error('Sua sessão expirou. Entre novamente para falar com a NEXO AI.');

      const resposta = await fetch('/api/nexo-ai/falar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ texto }),
      });
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
        throw new Error(corpo?.erro ?? 'Não foi possível gerar a voz.');
      }

      const bytes = await resposta.arrayBuffer();
      if (geracao !== this.geracaoFala) return null; // cancelado enquanto buscava
      const ctx = this.garantirContextoAudio();
      if (!ctx) throw new Error('Áudio não disponível neste navegador.');
      return pcm16ParaBuffer(ctx, bytes);
    } catch (e) {
      if (geracao === this.geracaoFala) {
        console.log('[NEXO MIC] fila de fala: erro num segmento —', e instanceof Error ? e.message : e);
        this.cbFilaFala.aoErro?.(e instanceof Error ? e.message : 'Falha ao gerar a voz.');
      }
      return null;
    }
  }

  /** O "player": consome a fila estritamente em ordem, nunca dois áudios ao mesmo tempo. */
  private async processarFilaFala(geracao: number): Promise<void> {
    if (this.geracaoComWorkerAtivo === geracao) return; // já tem um worker rodando para esta geração
    this.geracaoComWorkerAtivo = geracao;

    while (geracao === this.geracaoFala && this.filaFala.length > 0) {
      const item = this.filaFala.shift()!;
      const buffer = await item.bufferPromise;
      if (geracao !== this.geracaoFala) break;
      if (buffer) await this.tocarBufferFala(buffer, geracao);
    }

    // Só limpa a própria marca — se uma geração mais nova já assumiu o
    // worker, essa comparação falha e não mexe no que não é dela.
    if (this.geracaoComWorkerAtivo === geracao) this.geracaoComWorkerAtivo = null;

    if (geracao === this.geracaoFala && this.filaEncerrada && this.filaFala.length === 0) {
      console.log('[NEXO MIC] fila de fala: terminou');
      this.cbFilaFala.aoTerminar?.();
    }
  }

  private async tocarBufferFala(buffer: AudioBuffer, geracao: number): Promise<void> {
    if (geracao !== this.geracaoFala) return;
    const ctx = this.garantirContextoAudio();
    if (!ctx) return;
    try { await ctx.resume(); } catch {}
    if (geracao !== this.geracaoFala) return;

    return new Promise((resolve) => {
      const fonte = ctx.createBufferSource();
      fonte.buffer = buffer;
      fonte.connect(ctx.destination);
      this.fonteFilaAtual = fonte;

      fonte.onended = () => {
        if (this.fonteFilaAtual === fonte) this.fonteFilaAtual = null;
        this.cbFilaFala.aoNivel?.(0);
        resolve();
      };

      const inicio = performance.now();
      const atualizarNivel = () => {
        if (geracao !== this.geracaoFala || this.fonteFilaAtual !== fonte) return;
        const decorrido = (performance.now() - inicio) / 1000;
        const duracao = buffer.duration || 1;
        const pulso = 0.3 + Math.min(0.65, Math.max(0, 1 - decorrido / duracao) * 0.5);
        this.cbFilaFala.aoNivel?.(pulso);
        requestAnimationFrame(atualizarNivel);
      };

      try {
        if (this.primeiraFalaDaGeracao) {
          this.primeiraFalaDaGeracao = false;
          console.log('[NEXO MIC] fila de fala: primeiro audio comecou');
          this.cbFilaFala.aoIniciar?.();
        }
        fonte.start(0);
        atualizarNivel();
      } catch {
        if (this.fonteFilaAtual === fonte) this.fonteFilaAtual = null;
        resolve();
      }
    });
  }

  /** Envia o Blob gravado para /api/nexo-ai/transcrever e devolve o texto. GROQ_API_KEY nunca sai do servidor. */
  private async transcrever(blob: Blob): Promise<string> {
    const token = await this.tokenSessao();
    if (!token) throw new Error('Sua sessão expirou. Entre novamente para falar com a NEXO AI.');

    const extensao = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `gravacao.${extensao}`);

    const resposta = await fetch('/api/nexo-ai/transcrever', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const corpo = (await resposta.json().catch(() => null)) as { ok?: boolean; texto?: string; erro?: string } | null;
    if (!resposta.ok || corpo?.ok === false) {
      throw new Error(corpo?.erro ?? 'Não foi possível transcrever o áudio.');
    }
    return typeof corpo?.texto === 'string' ? corpo.texto : '';
  }

  ouvir(cb: AoOuvir = {}): void {
    if (!this.podeOuvir) { cb.aoErro?.('Este navegador não grava áudio. Use o teclado.'); return; }

    this.pararEscuta();
    this.pararFala();
    void this.iniciarGravacao(cb);
  }

  private async iniciarGravacao(cb: AoOuvir): Promise<void> {
    const encerrarTracks = (stream: MediaStream | null) => {
      stream?.getTracks().forEach((track) => track.stop());
    };

    let stream: MediaStream;
    try {
      console.log('[NEXO MIC] pedindo microfone (getUserMedia)');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : '';
      console.log('[NEXO MIC] getUserMedia falhou:', nome || e);
      cb.aoErro?.(ERROS_MICROFONE[nome] ?? 'Não foi possível acessar o microfone.');
      cb.aoFim?.();
      return;
    }

    if (this.streamAtual && this.streamAtual !== stream) encerrarTracks(this.streamAtual);
    this.streamAtual = stream;

    let gravador: MediaRecorder;
    try {
      const mimeType = tipoDeGravacaoSuportado();
      gravador = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      encerrarTracks(stream);
      if (this.streamAtual === stream) this.streamAtual = null;
      cb.aoErro?.('Gravação de áudio não é suportada neste navegador.');
      cb.aoFim?.();
      return;
    }

    const pedacos: BlobPart[] = [];
    let finalizado = false;
    let cancelado = false;

    const limpar = () => {
      encerrarTracks(stream);
      if (this.streamAtual === stream) this.streamAtual = null;
      if (this.gravadorAtual === gravador) this.gravadorAtual = null;
      if (this.cancelarEscutaAtual === cancelar) this.cancelarEscutaAtual = null;
      if (this.finalizarEscutaAtual === finalizar) this.finalizarEscutaAtual = null;
    };

    /** Idempotente: só a primeira chamada (timer/onstop/onerror) tem efeito. */
    const concluirGravacao = () => {
      if (finalizado) {
        console.log('[NEXO MIC] concluirGravacao: ja finalizado, ignorado');
        return;
      }
      finalizado = true;
      limpar();

      if (cancelado) {
        console.log('[NEXO MIC] gravacao cancelada, audio descartado');
        cb.aoFim?.();
        return;
      }

      const blob = new Blob(pedacos, { type: gravador.mimeType || 'audio/webm' });
      console.log('[NEXO MIC] blob pronto:', blob.size, blob.type);

      if (!blob.size) {
        console.log('[NEXO MIC] blob vazio, nada a transcrever');
        cb.aoFim?.();
        return;
      }

      cb.aoProcessando?.();
      void (async () => {
        try {
          const texto = await this.transcrever(blob);
          console.log('[NEXO MIC] transcricao ok:', texto);
          if (texto.trim()) {
            console.log('[NEXO MIC] aoFinal', texto.trim());
            cb.aoFinal?.(texto.trim());
          }
        } catch (e) {
          console.log('[NEXO MIC] transcricao falhou:', e);
          cb.aoErro?.(e instanceof Error ? e.message : 'Falha ao transcrever o áudio.');
        } finally {
          cb.aoFim?.();
        }
      })();
    };

    const finalizar = () => {
      console.log('[NEXO MIC] finalizarEscuta chamado (2º clique)');
      if (finalizado) return;
      try { gravador.stop(); } catch { concluirGravacao(); }
    };

    const cancelar = () => {
      console.log('[NEXO MIC] cancelarEscuta chamado (pararEscuta)');
      if (finalizado) return;
      cancelado = true;
      try { gravador.stop(); } catch { concluirGravacao(); }
    };

    this.cancelarEscutaAtual = cancelar;
    this.finalizarEscutaAtual = finalizar;

    gravador.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) pedacos.push(e.data);
    };

    gravador.onstop = () => {
      console.log('[NEXO MIC] onstop (MediaRecorder)');
      concluirGravacao();
    };

    gravador.onerror = () => {
      console.log('[NEXO MIC] onerror (MediaRecorder)');
      if (finalizado) return;
      finalizado = true;
      limpar();
      cb.aoErro?.('Falha ao gravar áudio.');
      cb.aoFim?.();
    };

    this.gravadorAtual = gravador;

    try {
      gravador.start();
      console.log('[NEXO MIC] start (MediaRecorder)');
    } catch {
      limpar();
      cb.aoErro?.('Não foi possível iniciar a gravação. Tente novamente.');
      cb.aoFim?.();
    }
  }

  /**
   * Cancelamento real: descarta a gravação ativa sem transcrever nem enviar
   * nada. Uso: cleanup de unmount e qualquer ação explícita de cancelar —
   * NUNCA a ação do botão de microfone durante 'listening' (isso é
   * finalizarEscuta()).
   */
  pararEscuta(): void {
    console.log('[NEXO MIC] pararEscuta chamado');
    if (this.cancelarEscutaAtual) {
      this.cancelarEscutaAtual();
      return;
    }
    if (this.gravadorAtual) {
      try { this.gravadorAtual.stop(); } catch {}
      this.gravadorAtual = null;
    }
    if (this.streamAtual) {
      this.streamAtual.getTracks().forEach((track) => track.stop());
      this.streamAtual = null;
    }
  }

  /**
   * Fallback manual: encerra a gravação ativa (2º clique no microfone) e
   * dispara a transcrição — a mesma rota que o próprio navegador usaria se
   * parasse a gravação sozinho, então nunca duplica envio nem descarta
   * áudio já capturado. Sem sessão ativa, não faz nada.
   */
  finalizarEscuta(): void {
    console.log('[NEXO MIC] finalizarEscuta chamado');
    if (this.finalizarEscutaAtual) {
      this.finalizarEscutaAtual();
      return;
    }
    console.log('[NEXO MIC] finalizarEscuta: nenhuma sessao ativa');
  }
}

export function criarProvedorVoz(): ProvedorVoz { return new VozGemini(); }

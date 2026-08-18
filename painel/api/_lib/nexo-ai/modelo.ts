/**
 * Camada de MODELO da NEXO AI — geração de TEXTO.
 *
 * Provider único:
 *   Groq (openai/gpt-oss-20b)
 *
 * A chave fica exclusivamente no servidor (GROQ_API_KEY).
 *
 * O TTS (voz da NEXO) é INDEPENDENTE deste arquivo — continua em
 * api/nexo-ai/falar.ts, usando ElevenLabs (ELEVENLABS_API_KEY). Nada aqui
 * afeta a voz.
 */

export interface MensagemModelo {
  papel: 'user' | 'assistant';
  conteudo: string;
}

export interface FerramentaModelo {
  nome: string;
  descricao: string;
  parametros: Record<string, unknown>;
}

export interface ChamadaFerramenta {
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
}

export interface RespostaModelo {
  texto: string;
  chamadas: ChamadaFerramenta[];
  tokens: {
    entrada: number;
    saida: number;
  };
}

export interface PedidoModelo {
  sistema: string;
  mensagens: MensagemModelo[];
  ferramentas?: FerramentaModelo[];
  resultados?: {
    id: string;
    conteudo: string;
  }[];
  maxTokensSaida?: number;
}

export interface ModeloProvider {
  readonly nome: string;
  readonly configurado: boolean;
  conversar(pedido: PedidoModelo): Promise<RespostaModelo>;
}

export class ErroModelo extends Error {
  readonly status: number;
  readonly codigo?: string;

  constructor(
    message: string,
    status: number,
    codigo?: string
  ) {
    super(message);
    this.name = 'ErroModelo';
    this.status = status;
    this.codigo = codigo;
  }
}

/* ==========================================================================
   GROQ — PROVIDER ÚNICO DE TEXTO

   Endpoint OpenAI-compatível. A chave (GROQ_API_KEY) já está configurada na
   Vercel — este arquivo só lê process.env.GROQ_API_KEY, nunca um literal.
   ========================================================================== */

const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';

/** Fixo por decisão de produto — NÃO usar llama-3.1-8b-instant. */
const GROQ_MODELO = 'openai/gpt-oss-20b';

/** Sem isso, uma chamada travada no Groq nunca solta a requisição do usuário. */
const GROQ_TIMEOUT_MS = 20000;

function chaveGroq(): string {
  const key = (process.env.GROQ_API_KEY ?? '').trim();
  if (!key) {
    throw new ErroModelo('GROQ_API_KEY não configurada no servidor.', 500, 'sem_credencial');
  }
  return key;
}

interface MensagemGroq {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ToolCallGroq {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function montarCorpoGroq(pedido: PedidoModelo, streaming = false): Record<string, unknown> {
  const mensagens: MensagemGroq[] = [];

  if (pedido.sistema && pedido.sistema.trim()) {
    mensagens.push({ role: 'system', content: pedido.sistema });
  }

  for (const m of pedido.mensagens) {
    const conteudo = m.conteudo.trim();
    if (!conteudo) continue;
    mensagens.push({ role: m.papel === 'assistant' ? 'assistant' : 'user', content: conteudo });
  }

  /*
   * `resultados` não vem de um ciclo real de function-calling do Groq — hoje
   * as ferramentas da NEXO são resolvidas ANTES desta chamada, em
   * conversar.ts, e injetadas como texto no `sistema` (ver "DADO REAL —" em
   * conversar.ts). Sem um assistant.tool_calls[] anterior com o mesmo id
   * nesta mesma lista de mensagens, a API da Groq rejeita role:"tool" com
   * 400 (tool_call_id sem correspondência). Por isso, se `resultados` vier
   * preenchido, ele entra como contexto comum — não como role:"tool" — até
   * existir de fato um loop de function-calling (tool_calls → execução →
   * role:"tool" → nova chamada), que este provider não implementa.
   */
  if (pedido.resultados?.length) {
    const contexto = pedido.resultados
      .map((r) => `Resultado da ferramenta ${r.id}: ${r.conteudo}`)
      .join('\n');
    mensagens.push({ role: 'user', content: contexto });
  }

  const corpo: Record<string, unknown> = {
    model: GROQ_MODELO,
    messages: mensagens,
    max_tokens: pedido.maxTokensSaida ?? 512,
    /*
     * gpt-oss é um modelo de raciocínio: sem isso ele pensa em nível "medium"
     * por padrão, gastando tokens invisíveis antes da resposta — o mesmo
     * motivo pelo qual o Gemini usava thinkingLevel "LOW". "low" é o nível
     * mínimo aceito pela Groq para esta família de modelo.
     */
    reasoning_effort: 'low',
  };

  if (pedido.ferramentas?.length) {
    corpo.tools = pedido.ferramentas.map((f) => ({
      type: 'function',
      function: { name: f.nome, description: f.descricao, parameters: f.parametros },
    }));
  }

  if (streaming) {
    corpo.stream = true;
    // Sem isso o chunk final não traz `usage` — perderíamos a contagem de
    // tokens no modo streaming (a Groq só inclui quando pedido explicitamente).
    corpo.stream_options = { include_usage: true };
  }

  return corpo;
}

function lerRespostaGroq(dados: Record<string, unknown>): RespostaModelo {
  const choices = Array.isArray(dados.choices) ? dados.choices : [];
  if (!choices.length) {
    throw new ErroModelo('O Groq não retornou uma resposta.', 500, 'sem_resposta');
  }

  const primeira = choices[0] as Record<string, unknown>;
  const mensagem = primeira?.message as Record<string, unknown> | undefined;
  const texto = typeof mensagem?.content === 'string' ? mensagem.content : '';

  const toolCallsBrutas = Array.isArray(mensagem?.tool_calls) ? (mensagem.tool_calls as ToolCallGroq[]) : [];
  const chamadas: ChamadaFerramenta[] = toolCallsBrutas.map((tc) => {
    let argumentos: Record<string, unknown> = {};
    try {
      argumentos = JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      argumentos = {};
    }
    return { id: tc.id, nome: tc.function?.name ?? '', argumentos };
  });

  const uso = (dados.usage as Record<string, number>) ?? {};

  return {
    texto: texto.trim(),
    chamadas,
    tokens: {
      entrada: uso.prompt_tokens ?? 0,
      saida: uso.completion_tokens ?? 0,
    },
  };
}

export const groqProvider: ModeloProvider = {
  nome: 'groq',

  get configurado() {
    return Boolean((process.env.GROQ_API_KEY ?? '').trim());
  },

  async conversar(pedido: PedidoModelo): Promise<RespostaModelo> {
    const key = chaveGroq();

    const controlador = new AbortController();
    const timeoutId = setTimeout(() => controlador.abort(), GROQ_TIMEOUT_MS);

    let resposta: Response;
    try {
      resposta = await fetch(GROQ_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(montarCorpoGroq(pedido)),
        signal: controlador.signal,
      });
    } catch (e) {
      const timeout = e instanceof Error && e.name === 'AbortError';
      console.error('[NEXO AI] Groq erro:', timeout ? 'tempo limite excedido' : 'falha de rede');
      throw new ErroModelo(
        timeout ? 'Tempo limite excedido ao contatar o Groq.' : 'Não foi possível alcançar a API do Groq.',
        timeout ? 504 : 502,
        timeout ? 'timeout' : 'rede',
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const dados = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;

    if (!resposta.ok || !dados) {
      const erro = dados?.error as { message?: string } | undefined;
      const detalhe = erro?.message ?? `Groq respondeu ${resposta.status}.`;
      console.error('[NEXO AI] Groq erro:', resposta.status, detalhe);
      throw new ErroModelo(detalhe, resposta.status, 'groq_recusou');
    }

    console.log('[NEXO AI] Groq respondeu com sucesso:', GROQ_MODELO);
    return lerRespostaGroq(dados);
  },
};

/* ==========================================================================
   GROQ — STREAMING

   Mesmo provider, mesmo modelo, mesma montagem de corpo — só troca stream:
   false por true e consome a resposta como Server-Sent Events em vez de um
   único JSON. Usado por /api/nexo-ai/conversar para começar a mandar texto
   ao navegador assim que o primeiro token chega, em vez de esperar tudo.
   ========================================================================== */

/** Quebra o corpo bruto da resposta em blocos SSE (delimitados por linha em branco). */
async function* blocosSSE(corpo: ReadableStream<Uint8Array> | null): AsyncGenerator<string, void, void> {
  if (!corpo) return;
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let restante = '';
  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      restante += decodificador.decode(value, { stream: true });
      let indice: number;
      while ((indice = restante.indexOf('\n\n')) !== -1) {
        yield restante.slice(0, indice);
        restante = restante.slice(indice + 2);
      }
    }
    if (restante.trim()) yield restante;
  } finally {
    leitor.releaseLock();
  }
}

/**
 * Conversa em streaming: yield de cada pedaço de texto (delta) assim que
 * chega; o valor de retorno do generator (acessível via `.next()` quando
 * `done === true`) é a RespostaModelo completa, para persistência e tokens —
 * mesmo formato que `groqProvider.conversar()`, só entregue aos poucos.
 */
export async function* groqStream(pedido: PedidoModelo): AsyncGenerator<string, RespostaModelo, void> {
  const key = chaveGroq();
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), GROQ_TIMEOUT_MS);

  let resposta: Response;
  try {
    resposta = await fetch(GROQ_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(montarCorpoGroq(pedido, true)),
      signal: controlador.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const timeout = e instanceof Error && e.name === 'AbortError';
    console.error('[NEXO AI] Groq erro:', timeout ? 'tempo limite excedido' : 'falha de rede');
    throw new ErroModelo(
      timeout ? 'Tempo limite excedido ao contatar o Groq.' : 'Não foi possível alcançar a API do Groq.',
      timeout ? 504 : 502,
      timeout ? 'timeout' : 'rede',
    );
  }

  if (!resposta.ok) {
    clearTimeout(timeoutId);
    const dados = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
    const erro = dados?.error as { message?: string } | undefined;
    const detalhe = erro?.message ?? `Groq respondeu ${resposta.status}.`;
    console.error('[NEXO AI] Groq erro:', resposta.status, detalhe);
    throw new ErroModelo(detalhe, resposta.status, 'groq_recusou');
  }

  let texto = '';
  let tokens = { entrada: 0, saida: 0 };
  try {
    for await (const bloco of blocosSSE(resposta.body)) {
      for (const linha of bloco.split('\n')) {
        const l = linha.trim();
        if (!l.startsWith('data:')) continue;
        const dado = l.slice(5).trim();
        if (!dado || dado === '[DONE]') continue;

        let json: Record<string, unknown>;
        try {
          json = JSON.parse(dado) as Record<string, unknown>;
        } catch {
          continue;
        }

        const uso = json.usage as Record<string, number> | undefined;
        if (uso) {
          tokens = { entrada: uso.prompt_tokens ?? 0, saida: uso.completion_tokens ?? 0 };
        }

        const choices = Array.isArray(json.choices) ? json.choices : [];
        const delta = (choices[0] as Record<string, unknown> | undefined)?.delta as Record<string, unknown> | undefined;
        const pedaco = typeof delta?.content === 'string' ? delta.content : '';
        if (pedaco) {
          texto += pedaco;
          yield pedaco;
        }
      }
    }
  } catch (e) {
    console.error('[NEXO AI] Groq erro: stream interrompido —', e instanceof Error ? e.message : e);
    throw new ErroModelo('A resposta da NEXO foi interrompida. Tente novamente.', 502, 'stream_interrompido');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!texto.trim()) {
    throw new ErroModelo('O Groq não retornou uma resposta.', 500, 'sem_resposta');
  }

  console.log('[NEXO AI] Groq respondeu com sucesso (stream):', GROQ_MODELO);
  return { texto: texto.trim(), chamadas: [], tokens };
}

/* ==========================================================================
   PROVIDER ATIVO — Groq é o único provider de texto.
   ========================================================================== */

export function provedorAtivo(): ModeloProvider {
  console.log('[NEXO AI] Provider Groq:', groqProvider.configurado ? 'CONFIGURADO' : 'NÃO CONFIGURADO');
  return groqProvider;
}
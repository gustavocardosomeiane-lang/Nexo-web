/**
 * Camada de MODELO da NEXO AI — abstração do provedor.
 *
 * ===========================================================================
 * POR QUE ABSTRAIR
 *
 * O Dashboard não pode ficar acoplado a um provedor. A regra do projeto é
 * `NEXO AI CORE → AI PROVIDER → MODEL`: o core fala com esta interface, nunca
 * com a Anthropic direto. Trocar de modelo — ou usar um mais barato para
 * tarefas simples — é trocar a implementação, sem tocar no resto.
 *
 * Sem SDK: as APIs são HTTP/JSON e o `fetch` nativo resolve. Menos uma
 * dependência, menos superfície de ataque.
 *
 * AS CHAVES VIVEM SÓ AQUI, em variáveis de servidor sem prefixo `VITE_`.
 * Nunca chegam ao navegador.
 *   - GEMINI_API_KEY   → Google Gemini (preferencial)
 *   - NEXO_AI_API_KEY  → Anthropic (fallback)
 * ===========================================================================
 */

export interface MensagemModelo {
  papel: 'user' | 'assistant';
  conteudo: string;
}

/** Ferramenta oferecida ao modelo. `parametros` é um JSON Schema. */
export interface FerramentaModelo {
  nome: string;
  descricao: string;
  parametros: Record<string, unknown>;
}

/** Pedido de execução de ferramenta que o modelo devolve. */
export interface ChamadaFerramenta {
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
}

export interface RespostaModelo {
  /** Texto para o usuário. Vazio quando o modelo só pediu ferramenta. */
  texto: string;
  /** Ferramentas que o modelo quer executar antes de concluir. */
  chamadas: ChamadaFerramenta[];
  /** Uso real, para telemetria de custo. */
  tokens: { entrada: number; saida: number };
}

export interface PedidoModelo {
  sistema: string;
  mensagens: MensagemModelo[];
  ferramentas?: FerramentaModelo[];
  /** Resultados de ferramentas já executadas, para o modelo concluir. */
  resultados?: { id: string; conteudo: string }[];
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
  constructor(message: string, status: number, codigo?: string) {
    super(message);
    this.name = 'ErroModelo';
    this.status = status;
    this.codigo = codigo;
  }
}

/* --------------------------------------------------------------------------
   Provider: Anthropic
   -------------------------------------------------------------------------- */

const BASE = 'https://api.anthropic.com/v1/messages';
const VERSAO = '2023-06-01';

/** Modelo padrão. Trocável por env sem publicar código. */
function modeloPadrao(): string {
  return (process.env.NEXO_AI_MODELO ?? 'claude-sonnet-5').trim() || 'claude-sonnet-5';
}

function chave(): string {
  const k = (process.env.NEXO_AI_API_KEY ?? '').trim();
  if (!k) throw new ErroModelo('NEXO_AI_API_KEY não configurada no servidor.', 500, 'sem_credencial');
  return k;
}

/** Traduz o formato interno para o corpo que a API da Anthropic espera. */
function montarCorpo(pedido: PedidoModelo) {
  const mensagens: unknown[] = pedido.mensagens.map((m) => ({
    role: m.papel === 'assistant' ? 'assistant' : 'user',
    content: m.conteudo,
  }));

  // Resultados de ferramenta entram como uma mensagem `user` com blocos
  // tool_result — é assim que a API encadeia a segunda rodada.
  if (pedido.resultados?.length) {
    mensagens.push({
      role: 'user',
      content: pedido.resultados.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.conteudo,
      })),
    });
  }

  const corpo: Record<string, unknown> = {
    model: modeloPadrao(),
    max_tokens: pedido.maxTokensSaida ?? 1024,
    system: pedido.sistema,
    messages: mensagens,
  };

  if (pedido.ferramentas?.length) {
    corpo.tools = pedido.ferramentas.map((f) => ({
      name: f.nome,
      description: f.descricao,
      input_schema: f.parametros,
    }));
  }

  return corpo;
}

/** Extrai texto e chamadas de ferramenta da resposta da API. */
function lerResposta(dados: Record<string, unknown>): RespostaModelo {
  const blocos = Array.isArray(dados.content) ? dados.content : [];
  let texto = '';
  const chamadas: ChamadaFerramenta[] = [];

  for (const b of blocos as Record<string, unknown>[]) {
    if (b.type === 'text' && typeof b.text === 'string') texto += b.text;
    if (b.type === 'tool_use') {
      chamadas.push({
        id: String(b.id),
        nome: String(b.name),
        argumentos: (b.input as Record<string, unknown>) ?? {},
      });
    }
  }

  const uso = (dados.usage as Record<string, number>) ?? {};
  return {
    texto: texto.trim(),
    chamadas,
    tokens: { entrada: uso.input_tokens ?? 0, saida: uso.output_tokens ?? 0 },
  };
}

export const anthropicProvider: ModeloProvider = {
  nome: 'anthropic',
  get configurado() {
    return Boolean((process.env.NEXO_AI_API_KEY ?? '').trim());
  },

  async conversar(pedido: PedidoModelo): Promise<RespostaModelo> {
    let resposta: Response;
    try {
      resposta = await fetch(BASE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': chave(),
          'anthropic-version': VERSAO,
        },
        body: JSON.stringify(montarCorpo(pedido)),
      });
    } catch {
      throw new ErroModelo('Não foi possível alcançar o modelo de IA.', 502, 'rede');
    }

    const dados = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;

    if (!resposta.ok || !dados) {
      const detalhe =
        ((dados?.error as { message?: string })?.message) ??
        `O modelo respondeu ${resposta.status}.`;
      // 401/403 viram 500 para fora: é erro de configuração nossa, não do usuário.
      const status = resposta.status === 401 || resposta.status === 403 ? 500 : resposta.status;
      throw new ErroModelo(detalhe, status, 'modelo_recusou');
    }

    return lerResposta(dados);
  },
};

/* --------------------------------------------------------------------------
   Provider: Google Gemini
   -------------------------------------------------------------------------- */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function modeloGemini(): string {
  return (process.env.NEXO_AI_MODELO_GEMINI ?? 'gemini-2.0-flash').trim() || 'gemini-2.0-flash';
}

function chaveGemini(): string {
  const k = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!k) throw new ErroModelo('GEMINI_API_KEY não configurada no servidor.', 500, 'sem_credencial');
  return k;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

function montarCorpoGemini(pedido: PedidoModelo) {
  const contents: GeminiContent[] = [];

  for (const m of pedido.mensagens) {
    contents.push({
      role: m.papel === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.conteudo }],
    });
  }

  if (pedido.resultados?.length) {
    if (contents.length && contents[contents.length - 1].role === 'model') {
      contents.pop();
    }
    contents.push({
      role: 'model',
      parts: pedido.resultados.map((r) => ({
        functionCall: { name: r.id, args: {} },
      })),
    });
    contents.push({
      role: 'user',
      parts: pedido.resultados.map((r) => ({
        functionResponse: {
          name: r.id,
          response: { result: r.conteudo },
        },
      })),
    });
  }

  const merged: GeminiContent[] = [];
  for (const c of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === c.role) {
      last.parts.push(...c.parts);
    } else {
      merged.push({ role: c.role, parts: [...c.parts] });
    }
  }

  if (merged.length && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', parts: [{ text: '.' }] });
  }

  const corpo: Record<string, unknown> = {
    contents: merged,
    generationConfig: {
      maxOutputTokens: pedido.maxTokensSaida ?? 1024,
    },
  };

  if (pedido.sistema) {
    corpo.systemInstruction = { parts: [{ text: pedido.sistema }] };
  }

  if (pedido.ferramentas?.length) {
    corpo.tools = [
      {
        functionDeclarations: pedido.ferramentas.map((f) => ({
          name: f.nome,
          description: f.descricao,
          parameters: f.parametros,
        })),
      },
    ];
  }

  return corpo;
}

function lerRespostaGemini(dados: Record<string, unknown>): RespostaModelo {
  const candidates = Array.isArray(dados.candidates) ? dados.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as { parts?: GeminiPart[] } | undefined;
  const parts = content?.parts ?? [];

  let texto = '';
  const chamadas: ChamadaFerramenta[] = [];

  for (const p of parts) {
    if (p.text) texto += p.text;
    if (p.functionCall) {
      chamadas.push({
        id: p.functionCall.name,
        nome: p.functionCall.name,
        argumentos: p.functionCall.args ?? {},
      });
    }
  }

  const uso = (dados.usageMetadata as Record<string, number>) ?? {};
  return {
    texto: texto.trim(),
    chamadas,
    tokens: {
      entrada: uso.promptTokenCount ?? 0,
      saida: uso.candidatesTokenCount ?? 0,
    },
  };
}

export const geminiProvider: ModeloProvider = {
  nome: 'gemini',
  get configurado() {
    return Boolean((process.env.GEMINI_API_KEY ?? '').trim());
  },

  async conversar(pedido: PedidoModelo): Promise<RespostaModelo> {
    const modelo = modeloGemini();
    const url = `${GEMINI_BASE}/${modelo}:generateContent?key=${chaveGemini()}`;

    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(montarCorpoGemini(pedido)),
      });
    } catch {
      throw new ErroModelo('Não foi possível alcançar o modelo de IA.', 502, 'rede');
    }

    const dados = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;

    if (!resposta.ok || !dados) {
      const err = dados?.error as { message?: string } | undefined;
      const detalhe = err?.message ?? `O modelo respondeu ${resposta.status}.`;
      const status = resposta.status === 401 || resposta.status === 403 ? 500 : resposta.status;
      throw new ErroModelo(detalhe, status, 'modelo_recusou');
    }

    const cands = Array.isArray(dados.candidates) ? dados.candidates : [];
    if (!cands.length) {
      const feedback = dados.promptFeedback as { blockReason?: string } | undefined;
      if (feedback?.blockReason) {
        throw new ErroModelo(`Conteúdo bloqueado: ${feedback.blockReason}`, 400, 'conteudo_bloqueado');
      }
      throw new ErroModelo('O modelo não retornou resposta.', 500, 'sem_resposta');
    }

    return lerRespostaGemini(dados);
  },
};

/** Provider ativo: Gemini quando configurado, Anthropic como fallback. */
export function provedorAtivo(): ModeloProvider {
  if (geminiProvider.configurado) return geminiProvider;
  return anthropicProvider;
}

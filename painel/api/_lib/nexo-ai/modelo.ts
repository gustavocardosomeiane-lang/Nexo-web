/**
 * Camada de MODELO da NEXO AI
 *
 * Provider único:
 *   Google Gemini
 *
 * As chaves ficam exclusivamente no servidor.
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
   GOOGLE GEMINI — PROVIDER ÚNICO
   ========================================================================== */

const GEMINI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Modelo Gemini utilizado pela NEXO AI.
 */
const GEMINI_MODELO = 'gemini-2.0-flash';

function chaveGemini(): string {
  const key = (
    process.env.GEMINI_API_KEY ?? ''
  ).trim();

  if (!key) {
    throw new ErroModelo(
      'GEMINI_API_KEY não configurada no servidor.',
      500,
      'sem_credencial'
    );
  }

  return key;
}

interface GeminiPart {
  text?: string;

  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
  };

  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/*
 * Campos aceitos pelo Gemini em schemas de parâmetros de função.
 * A API usa um subconjunto do OpenAPI 3.0 e rejeita tudo fora desta lista.
 */
const CAMPOS_SCHEMA_GEMINI = new Set([
  'type', 'description', 'properties', 'required', 'enum', 'items', 'nullable',
]);

function normalizarSchemaGemini(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!CAMPOS_SCHEMA_GEMINI.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = normalizarSchemaGemini(pv as Record<string, unknown>);
      }
      out[k] = props;
    } else if (k === 'items' && v && typeof v === 'object') {
      out[k] = normalizarSchemaGemini(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function montarCorpoGemini(
  pedido: PedidoModelo
): Record<string, unknown> {
  const contents: GeminiContent[] = [];

  for (const mensagem of pedido.mensagens) {
    const role =
      mensagem.papel === 'assistant'
        ? 'model'
        : 'user';

    const texto =
      mensagem.conteudo.trim();

    if (!texto) {
      continue;
    }

    const ultimo =
      contents[contents.length - 1];

    if (
      ultimo &&
      ultimo.role === role
    ) {
      ultimo.parts.push({
        text: texto,
      });
    } else {
      contents.push({
        role,
        parts: [
          {
            text: texto,
          },
        ],
      });
    }
  }

  /*
   * Gemini exige que a conversa comece com USER.
   */
  if (
    !contents.length ||
    contents[0].role !== 'user'
  ) {
    contents.unshift({
      role: 'user',
      parts: [
        {
          text: 'Inicie a conversa.',
        },
      ],
    });
  }

  const corpo: Record<string, unknown> = {
    contents,

    generationConfig: {
      maxOutputTokens:
        pedido.maxTokensSaida ?? 1024,
    },
  };

  /*
   * Instrução de sistema.
   */
  if (
    pedido.sistema &&
    pedido.sistema.trim()
  ) {
    corpo.systemInstruction = {
      parts: [
        {
          text: pedido.sistema,
        },
      ],
    };
  }

  /*
   * Ferramentas.
   *
   * A API do Gemini aceita um subconjunto do OpenAPI 3.0. Campos JSON Schema
   * não reconhecidos (additionalProperties, $schema, $ref, allOf, etc.) fazem
   * a requisição falhar com HTTP 400. O normalizador filtra antes de enviar.
   */
  if (pedido.ferramentas?.length) {
    corpo.tools = [
      {
        functionDeclarations: pedido.ferramentas.map((f) => ({
          name: f.nome,
          description: f.descricao,
          parameters: normalizarSchemaGemini(
            f.parametros as Record<string, unknown>,
          ),
        })),
      },
    ];
  }

  return corpo;
}

function lerRespostaGemini(
  dados: Record<string, unknown>
): RespostaModelo {
  const candidates =
    Array.isArray(dados.candidates)
      ? dados.candidates
      : [];

  if (!candidates.length) {
    const feedback =
      dados.promptFeedback as
        | {
            blockReason?: string;
          }
        | undefined;

    if (feedback?.blockReason) {
      throw new ErroModelo(
        `Conteúdo bloqueado: ${feedback.blockReason}`,
        400,
        'conteudo_bloqueado'
      );
    }

    throw new ErroModelo(
      'O Gemini não retornou uma resposta.',
      500,
      'sem_resposta'
    );
  }

  const primeiro =
    candidates[0] as
      | Record<string, unknown>
      | undefined;

  const content =
    primeiro?.content as
      | {
          parts?: GeminiPart[];
        }
      | undefined;

  const parts =
    content?.parts ?? [];

  let texto = '';

  const chamadas: ChamadaFerramenta[] = [];

  for (const part of parts) {
    if (
      typeof part.text === 'string'
    ) {
      texto += part.text;
    }

    if (part.functionCall) {
      chamadas.push({
        id: part.functionCall.name,
        nome: part.functionCall.name,
        argumentos:
          part.functionCall.args ?? {},
      });
    }
  }

  const uso =
    (dados.usageMetadata as Record<
      string,
      number
    >) ?? {};

  return {
    texto: texto.trim(),
    chamadas,
    tokens: {
      entrada:
        uso.promptTokenCount ?? 0,
      saida:
        uso.candidatesTokenCount ?? 0,
    },
  };
}

export const geminiProvider: ModeloProvider = {
  nome: 'gemini',

  get configurado() {
    const key =
      process.env.GEMINI_API_KEY;

    return (
      typeof key === 'string' &&
      key.trim().length > 0
    );
  },

  async conversar(
    pedido: PedidoModelo
  ): Promise<RespostaModelo> {
    const key = chaveGemini();

    const url =
      `${GEMINI_BASE}/${GEMINI_MODELO}` +
      `:generateContent?key=${encodeURIComponent(
        key
      )}`;

    let resposta: Response;

    try {
      resposta = await fetch(
        url,
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json',
          },

          body: JSON.stringify(
            montarCorpoGemini(pedido)
          ),
        }
      );
    } catch {
      throw new ErroModelo(
        'Não foi possível alcançar a API do Gemini.',
        502,
        'rede'
      );
    }

    const dados =
      (await resposta
        .json()
        .catch(() => null)) as Record<
        string,
        unknown
      > | null;

    if (!resposta.ok || !dados) {
      const erro =
        dados?.error as
          | {
              message?: string;
              status?: string;
            }
          | undefined;

      const detalhe =
        erro?.message ??
        `Gemini respondeu ${resposta.status}.`;

      console.error(
        '[NEXO AI] Gemini error:',
        {
          status: resposta.status,
          detalhe,
        }
      );

      throw new ErroModelo(
        detalhe,
        resposta.status,
        'gemini_recusou'
      );
    }

    return lerRespostaGemini(dados);
  },
};

/* ==========================================================================
   PROVIDER ATIVO
   ========================================================================== */

/**
 * A NEXO AI utiliza exclusivamente o Google Gemini.
 *
 * Não existe fallback para Anthropic.
 */
export function provedorAtivo(): ModeloProvider {
  if (geminiProvider.configurado) {
    return geminiProvider;
  }

  return {
    nome: 'nenhum',

    get configurado() {
      return false;
    },

    async conversar(): Promise<RespostaModelo> {
      throw new ErroModelo(
        'GEMINI_API_KEY não está configurada no servidor.',
        500,
        'nenhum_provedor'
      );
    },
  };
}

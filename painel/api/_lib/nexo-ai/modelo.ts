```typescript
/**
 * Camada de MODELO da NEXO AI
 *
 * Provider principal:
 *   Google Gemini
 *
 * Fallback:
 *   Anthropic
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
   ANTHROPIC — FALLBACK
   ========================================================================== */

const ANTHROPIC_BASE =
  'https://api.anthropic.com/v1/messages';

const ANTHROPIC_VERSION = '2023-06-01';

function modeloAnthropic(): string {
  return (
    process.env.NEXO_AI_MODELO ??
    'claude-sonnet-5'
  ).trim() || 'claude-sonnet-5';
}

function chaveAnthropic(): string {
  const key = (
    process.env.NEXO_AI_API_KEY ?? ''
  ).trim();

  if (!key) {
    throw new ErroModelo(
      'NEXO_AI_API_KEY não configurada no servidor.',
      500,
      'sem_credencial'
    );
  }

  return key;
}

function montarCorpoAnthropic(
  pedido: PedidoModelo
) {
  const mensagens = pedido.mensagens.map((m) => ({
    role:
      m.papel === 'assistant'
        ? 'assistant'
        : 'user',
    content: m.conteudo,
  }));

  const corpo: Record<string, unknown> = {
    model: modeloAnthropic(),
    max_tokens:
      pedido.maxTokensSaida ?? 1024,
    system: pedido.sistema,
    messages: mensagens,
  };

  if (pedido.ferramentas?.length) {
    corpo.tools =
      pedido.ferramentas.map((f) => ({
        name: f.nome,
        description: f.descricao,
        input_schema: f.parametros,
      }));
  }

  if (pedido.resultados?.length) {
    mensagens.push({
      role: 'user',
      content: pedido.resultados
        .map((r) => ({
          type: 'text',
          text: `Resultado da ferramenta ${r.id}: ${r.conteudo}`,
        }))
        .map((x) => x.text)
        .join('\n'),
    });
  }

  return corpo;
}

function lerRespostaAnthropic(
  dados: Record<string, unknown>
): RespostaModelo {
  const blocos = Array.isArray(dados.content)
    ? dados.content
    : [];

  let texto = '';

  const chamadas: ChamadaFerramenta[] = [];

  for (const bloco of blocos as Record<
    string,
    unknown
  >[]) {
    if (
      bloco.type === 'text' &&
      typeof bloco.text === 'string'
    ) {
      texto += bloco.text;
    }

    if (bloco.type === 'tool_use') {
      chamadas.push({
        id: String(bloco.id),
        nome: String(bloco.name),
        argumentos:
          (bloco.input as Record<
            string,
            unknown
          >) ?? {},
      });
    }
  }

  const uso =
    (dados.usage as Record<
      string,
      number
    >) ?? {};

  return {
    texto: texto.trim(),
    chamadas,
    tokens: {
      entrada:
        uso.input_tokens ?? 0,
      saida:
        uso.output_tokens ?? 0,
    },
  };
}

export const anthropicProvider: ModeloProvider = {
  nome: 'anthropic',

  get configurado() {
    return Boolean(
      (
        process.env.NEXO_AI_API_KEY ?? ''
      ).trim()
    );
  },

  async conversar(
    pedido: PedidoModelo
  ): Promise<RespostaModelo> {
    let resposta: Response;

    try {
      resposta = await fetch(
        ANTHROPIC_BASE,
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/json',
            'x-api-key':
              chaveAnthropic(),
            'anthropic-version':
              ANTHROPIC_VERSION,
          },
          body: JSON.stringify(
            montarCorpoAnthropic(pedido)
          ),
        }
      );
    } catch {
      throw new ErroModelo(
        'Não foi possível alcançar o modelo de IA.',
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
            }
          | undefined;

      const detalhe =
        erro?.message ??
        `O modelo respondeu ${resposta.status}.`;

      throw new ErroModelo(
        detalhe,
        resposta.status,
        'modelo_recusou'
      );
    }

    return lerRespostaAnthropic(dados);
  },
};

/* ==========================================================================
   GOOGLE GEMINI — PROVIDER PRINCIPAL
   ========================================================================== */

const GEMINI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * IMPORTANTE:
 *
 * Este é o modelo que foi TESTADO MANUALMENTE
 * pelo terminal e respondeu:
 *
 * GEMINI OK
 *
 * Portanto não vamos depender de uma variável
 * antiga NEXO_AI_MODELO_GEMINI.
 */
const GEMINI_MODELO = 'gemini-3.6-flash';

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

function montarCorpoGemini(
  pedido: PedidoModelo
) {
  const contents: GeminiContent[] = [];

  for (const mensagem of pedido.mensagens) {
    const role =
      mensagem.papel === 'assistant'
        ? 'model'
        : 'user';

    const texto =
      mensagem.conteudo.trim();

    if (!texto) continue;

    const ultimo =
      contents[contents.length - 1];

    if (ultimo && ultimo.role === role) {
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
   */
  if (pedido.ferramentas?.length) {
    corpo.tools = [
      {
        functionDeclarations:
          pedido.ferramentas.map(
            (f) => ({
              name: f.nome,
              description:
                f.descricao,
              parameters:
                f.parametros,
            })
          ),
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
        id:
          part.functionCall.name,
        nome:
          part.functionCall.name,
        argumentos:
          part.functionCall.args ??
          {},
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

export const geminiProvider: ModeloProvider =
  {
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
            status:
              resposta.status,
            detalhe,
          }
        );

        throw new ErroModelo(
          detalhe,
          resposta.status,
          'gemini_recusou'
        );
      }

      console.log(
        '[NEXO AI] Gemini respondeu com sucesso:',
        GEMINI_MODELO
      );

      return lerRespostaGemini(
        dados
      );
    },
  };

/* ==========================================================================
   PROVIDER ATIVO
   ========================================================================== */

/**
 * Gemini é SEMPRE prioridade quando GEMINI_API_KEY
 * está configurada.
 *
 * Anthropic só será usado se Gemini não estiver
 * configurado.
 */
export function provedorAtivo(): ModeloProvider {
  const geminiConfigurado =
    geminiProvider.configurado;

  const anthropicConfigurado =
    anthropicProvider.configurado;

  console.log(
    '[NEXO AI] Provider Gemini:',
    geminiConfigurado
      ? 'CONFIGURADO'
      : 'NÃO CONFIGURADO'
  );

  console.log(
    '[NEXO AI] Provider Anthropic:',
    anthropicConfigurado
      ? 'CONFIGURADO'
      : 'NÃO CONFIGURADO'
  );

  if (geminiConfigurado) {
    console.log(
      '[NEXO AI] PROVIDER ATIVO: GEMINI'
    );

    return geminiProvider;
  }

  if (anthropicConfigurado) {
    console.log(
      '[NEXO AI] PROVIDER ATIVO: ANTHROPIC'
    );

    return anthropicProvider;
  }

  throw new ErroModelo(
    'Nenhum provedor de IA está configurado no servidor.',
    500,
    'nenhum_provedor'
  );
}
```

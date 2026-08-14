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
 * Sem SDK: a API da Anthropic é HTTP/JSON e o `fetch` nativo resolve. Menos
 * uma dependência, menos superfície de ataque.
 *
 * A CHAVE VIVE SÓ AQUI, em `NEXO_AI_API_KEY`, variável de servidor sem
 * prefixo `VITE_`. Nunca chega ao navegador.
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

/** Provider ativo. Um dia isto escolhe entre vários por env. */
export function provedorAtivo(): ModeloProvider {
  return anthropicProvider;
}

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
  /**
   * Rótulo SÓ para diagnóstico ("extracao" | "resposta_final" | ...) — nunca
   * vai para o Groq. Fica aqui em vez de hardcoded neste arquivo porque
   * `modelo.ts` é um cliente genérico do Groq e não conhece os conceitos de
   * negócio da NEXO (prospecção, extração); quem chama é que sabe o que a
   * chamada representa.
   */
  etapa?: string;
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
    /*
     * gpt-oss separa o raciocínio da resposta final num campo próprio do
     * delta (documentação oficial da Groq) — a resposta que interessa
     * sempre foi `content`, nunca o raciocínio. `reasoning_format` NÃO é
     * suportado para gpt-oss (a Groq documenta `include_reasoning` como o
     * controle certo pra esta família de modelo); pedir pra Groq nem
     * incluir o raciocínio evita gastar parte do `max_tokens` com um
     * conteúdo que o produto nunca exibe.
     */
    include_reasoning: false,
  };

  if (pedido.ferramentas?.length) {
    corpo.tools = pedido.ferramentas.map((f) => ({
      type: 'function',
      function: { name: f.nome, description: f.descricao, parameters: f.parametros },
    }));
    // Explícito, não implícito: esta chamada TEM ferramenta e o modelo DECIDE
    // se chama ou não ("auto" já é o padrão da API sem isso — só documentado
    // aqui pra aparecer no log de diagnóstico, não muda comportamento).
    corpo.tool_choice = 'auto';
  }
  // Sem `pedido.ferramentas`, `tools` nunca é enviado — não existe
  // `tool_choice` para setar (a API não aceita a chave sem `tools` junto).
  // É esse o caso da chamada final de resposta: nenhuma ferramenta é
  // oferecida, então o modelo estruturalmente não tem como tentar uma
  // tool_call — ver a investigação registrada no commit deste arquivo.

  if (streaming) {
    corpo.stream = true;
    // Sem isso o chunk final não traz `usage` — perderíamos a contagem de
    // tokens no modo streaming (a Groq só inclui quando pedido explicitamente).
    corpo.stream_options = { include_usage: true };
  }

  return corpo;
}

/**
 * Log de diagnóstico ANTES de mandar a requisição — nunca o conteúdo das
 * mensagens, nunca a chave, só a FORMA da chamada: quantas mensagens, que
 * papéis, se tem ferramenta e qual a política de escolha. É o que permite
 * confirmar, num teste real, se a chamada final de resposta está (como
 * deveria) sem nenhuma ferramenta oferecida — em vez de adivinhar pelos
 * sintomas.
 */
function logPedidoGroq(corpo: Record<string, unknown>, etapa: string | undefined): void {
  const mensagens = (corpo.messages as MensagemGroq[] | undefined) ?? [];
  console.log(
    '[NEXO AI] Groq ->',
    'etapa=' + (etapa ?? 'desconhecida'),
    'mensagens=' + mensagens.length,
    'roles=' + mensagens.map((m) => m.role).join(','),
    'tools=' + (Array.isArray(corpo.tools) ? 'sim' : 'nao'),
    'tool_choice=' + (typeof corpo.tool_choice === 'string' ? corpo.tool_choice : 'n/a'),
  );
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
    const corpo = montarCorpoGroq(pedido);
    logPedidoGroq(corpo, pedido.etapa);

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
        body: JSON.stringify(corpo),
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
  const corpo = montarCorpoGroq(pedido, true);
  logPedidoGroq(corpo, pedido.etapa);
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
      body: JSON.stringify(corpo),
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
  // gpt-oss é um modelo de RACIOCÍNIO: por padrão a Groq inclui os tokens de
  // "pensamento" do modelo separados da resposta final — e, com um
  // `max_tokens` apertado, esse raciocínio pode consumir o orçamento
  // INTEIRO antes do modelo sequer começar a responder. Foi exatamente o
  // que aconteceu no incidente investigado: 47 chunks, todos vazios em
  // `delta.content`, `finish_reason` nunca chegou a aparecer como string.
  // `include_reasoning: false` (ver montarCorpoGroq) já pede pra Groq nem
  // mandar esse campo — mas o parser continua contando `reasoning`/
  // `reasoning_content` só para DIAGNÓSTICO (confirmar se o parâmetro
  // realmente suprime o campo em produção), nunca lê o valor pra virar
  // resposta: raciocínio é conteúdo interno do modelo, não uma resposta
  // formatada, e nunca deve chegar ao usuário. Se `delta.content` ficar
  // vazio mesmo assim, quem decide o que fazer é conversar.ts (fallback
  // determinístico da prospecção ou erro normal) — nunca este arquivo.
  let tokens = { entrada: 0, saida: 0 };
  // Diagnóstico da investigação do "Groq não retornou resposta": conta o
  // que realmente veio em cada chunk, em vez de só reagir ao resultado
  // final. `chunksComToolCalls` NUNCA deveria ficar > 0 aqui — esta chamada
  // não oferece `tools` (ver logPedidoGroq acima), então o modelo
  // estruturalmente não tem ferramenta nenhuma pra tentar chamar. Se
  // aparecer mesmo assim, é sinal de comportamento inesperado da API e fica
  // registrado, nunca engolido em silêncio.
  let chunksTotal = 0;
  let chunksComContent = 0;
  let chunksComRaciocinio = 0;
  let chunksComToolCalls = 0;
  let finishReason: string | null = null;
  // TEMPORÁRIO — instrumentação da investigação do incidente. Loga só as
  // CHAVES do primeiro delta não vazio (nunca o texto, nunca prompt/mensagem
  // do usuário): é o que confirma, num run real, qual campo a Groq está de
  // fato usando para gpt-oss, em vez de continuar adivinhando pelos
  // sintomas. Remover depois que o formato estiver confirmado em produção
  // por algumas execuções.
  let primeiroDeltaDiagnosticado = false;
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
        chunksTotal += 1;

        const uso = json.usage as Record<string, number> | undefined;
        if (uso) {
          tokens = { entrada: uso.prompt_tokens ?? 0, saida: uso.completion_tokens ?? 0 };
        }

        const choices = Array.isArray(json.choices) ? json.choices : [];
        const primeiraEscolha = choices[0] as Record<string, unknown> | undefined;
        const delta = primeiraEscolha?.delta as Record<string, unknown> | undefined;

        if (typeof primeiraEscolha?.finish_reason === 'string') {
          finishReason = primeiraEscolha.finish_reason as string;
        }

        if (!primeiroDeltaDiagnosticado && delta && Object.keys(delta).length > 0) {
          primeiroDeltaDiagnosticado = true;
          console.log(
            '[NEXO AI] Groq diagnostico_primeiro_delta (temporário)',
            'etapa=' + (pedido.etapa ?? 'desconhecida'),
            'chaves=' + Object.keys(delta).join(','),
          );
        }

        const pedaco = typeof delta?.content === 'string' ? delta.content : '';
        if (pedaco) {
          chunksComContent += 1;
          texto += pedaco;
          yield pedaco;
        }

        // Só CONTA — nunca guarda o texto do raciocínio. É diagnóstico
        // seguro (confirma se `include_reasoning: false` está de fato
        // suprimindo o campo em produção); o conteúdo em si nunca deve
        // sobreviver além deste `if`, nem em variável nem em log.
        const temRaciocinio = typeof delta?.reasoning === 'string' || typeof delta?.reasoning_content === 'string';
        if (temRaciocinio) {
          chunksComRaciocinio += 1;
        }

        if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
          chunksComToolCalls += 1;
        }
      }
    }
  } catch (e) {
    console.error('[NEXO AI] Groq erro: stream interrompido —', e instanceof Error ? e.message : e);
    throw new ErroModelo('A resposta da NEXO foi interrompida. Tente novamente.', 502, 'stream_interrompido');
  } finally {
    clearTimeout(timeoutId);
  }

  console.log(
    '[NEXO AI] Groq <-',
    'etapa=' + (pedido.etapa ?? 'desconhecida'),
    'chunks=' + chunksTotal,
    'chunks_com_content=' + chunksComContent,
    'chunks_com_raciocinio=' + chunksComRaciocinio,
    'chunks_com_tool_calls=' + chunksComToolCalls,
    'finish_reason=' + (finishReason ?? 'ausente'),
  );

  // `raciocinio` NUNCA vira resposta visível — é conteúdo de pensamento
  // interno do modelo, não uma resposta formatada para o usuário. Se
  // `delta.content` não veio nada, o chamador (conversar.ts) decide o que
  // fazer: usar o fallback determinístico da prospecção quando ela já
  // rodou com sucesso, ou seguir o tratamento normal de erro — nunca este
  // arquivo decidindo exibir raciocínio.
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
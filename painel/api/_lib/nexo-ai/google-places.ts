/**
 * Adaptador server-side para o Google Places API (New).
 *
 * ===========================================================================
 * TUDO AQUI RODA NO SERVIDOR (Vercel Functions). A `GOOGLE_PLACES_API_KEY`
 * nunca sai daqui — nenhuma variável deste arquivo leva prefixo `VITE_`, pelo
 * mesmo motivo de `api/_lib/asaas.ts`: não pode ser empacotada no frontend.
 *
 * MINIMIZAÇÃO DE CUSTO (decisão registrada com você):
 *   - Text Search primeiro, com FieldMask mínimo (`FIELD_MASK_BUSCA`).
 *   - Place Details só é chamado por candidato que ficou SEM telefone OU SEM
 *     site depois do Text Search — nunca para quem já veio completo.
 *   - Nunca duas chamadas de Details para o mesmo `place_id` (`jaDetalhados`).
 *   - Paginação para no que for necessário: para assim que há candidatos
 *     suficientes, ou ao atingir `MAX_PAGINAS` — nunca busca ilimitada.
 * ===========================================================================
 */

const BASE = 'https://places.googleapis.com/v1';
const TIMEOUT_MS = 10_000;

/** Máximo aceito pelo Text Search (New) por página. */
const TAMANHO_PAGINA = 20;
/** Teto de páginas — nunca busca ilimitada, mesmo que o pedido peça muito mais. */
const MAX_PAGINAS = 3;
/** O pageToken só fica válido alguns instantes depois de emitido pelo Google. */
const ATRASO_PROXIMA_PAGINA_MS = 2000;
/** Quantas chamadas de Place Details rodam em paralelo, no máximo. */
const CONCORRENCIA_DETALHES = 8;

/**
 * FIELD MASK DA BUSCA — só o que o CRM precisa.
 *
 * `addressComponents` entra "de graça": uma vez que `internationalPhoneNumber`
 * e `websiteUri` (camada "Contact Data" de cobrança do Google) já estão no
 * pedido, incluir campos da camada mais barata ("Basic Data", onde mora
 * `addressComponents`) não muda o preço da chamada — o Google cobra pela
 * camada MAIS CARA presente na máscara, não pela soma dos campos.
 * `nextPageToken` precisa estar na máscara ou a resposta não traz paginação
 * nenhuma, mesmo havendo mais resultados.
 */
const FIELD_MASK_BUSCA = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.addressComponents',
  'nextPageToken',
].join(',');

/** FIELD MASK DOS DETALHES — mesmos campos mínimos, sem o wrapper `places.`. */
const FIELD_MASK_DETALHES = [
  'id',
  'displayName',
  'formattedAddress',
  'internationalPhoneNumber',
  'websiteUri',
  'addressComponents',
].join(',');

/*
 * Campos explícitos, sem "parameter properties" no construtor: o test
 * runner do Node (`--experimental-strip-types`) só APAGA tipos, não
 * transpila — o atalho `constructor(readonly status: number)` é sintaxe que
 * o TypeScript reescreve em tempo de build, não algo que dá pra só remover
 * o tipo e sobrar JS válido. Mesmo padrão já usado em `ErroModelo`
 * (api/_lib/nexo-ai/modelo.ts).
 */
export class ErroGooglePlaces extends Error {
  readonly status: number;
  readonly codigo?: string;

  constructor(message: string, status: number, codigo?: string) {
    super(message);
    this.name = 'ErroGooglePlaces';
    this.status = status;
    this.codigo = codigo;
  }
}

function chaveGooglePlaces(): string {
  const key = (process.env.GOOGLE_PLACES_API_KEY ?? '').trim();
  if (!key) {
    throw new ErroGooglePlaces('GOOGLE_PLACES_API_KEY não configurada no servidor.', 500, 'sem_credencial');
  }
  return key;
}

/* --------------------------------------------------------------------------
   Formas brutas da resposta do Google — só os campos que pedimos
   -------------------------------------------------------------------------- */

interface EnderecoComponenteBruto {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlaceBruto {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  addressComponents?: EnderecoComponenteBruto[];
}

interface RespostaTextSearch {
  places?: PlaceBruto[];
  nextPageToken?: string;
}

/* --------------------------------------------------------------------------
   Chamadas HTTP — timeout no mesmo padrão de modelo.ts/asaas.ts
   -------------------------------------------------------------------------- */

type OperacaoGooglePlaces = 'text_search' | 'place_details';

async function chamarGooglePlaces<T>(
  caminho: string,
  fieldMask: string,
  operacao: OperacaoGooglePlaces,
  opcoes: { metodo?: 'GET' | 'POST'; corpo?: unknown } = {},
): Promise<T> {
  const { metodo = 'GET', corpo } = opcoes;
  // Fora do try: se faltar credencial, o erro precisa sair como
  // `sem_credencial` — não pode ser engolido pelo catch genérico de rede
  // logo abaixo e reaparecer como "não foi possível alcançar o Google".
  const chave = chaveGooglePlaces();
  const url = `${BASE}${caminho}`;
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  // Log de diagnóstico — NUNCA a chave (ela só vai no header X-Goog-Api-Key,
  // que não é logado) e NUNCA query string (esta API não usa: a chave vai
  // em header, os parâmetros de busca vão no corpo do POST). Método, URL
  // (sem segredo nenhum — `caminho` nunca carrega place_id sensível, é um
  // identificador público do Google) e tipo de operação, só isso.
  console.log('[NEXO AI] Google Places ->', operacao, metodo, url);

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': chave,
        'X-Goog-FieldMask': fieldMask,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'AbortError';
    throw new ErroGooglePlaces(
      timeout ? 'Tempo limite excedido ao contatar o Google Places.' : 'Não foi possível alcançar o Google Places.',
      timeout ? 504 : 502,
      timeout ? 'timeout' : 'rede',
    );
  } finally {
    clearTimeout(timeoutId);
  }

  console.log('[NEXO AI] Google Places <-', operacao, resposta.status);

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const erro = (dados as { error?: { message?: string } } | null)?.error;
    throw new ErroGooglePlaces(
      erro?.message ?? `Google Places respondeu ${resposta.status}.`,
      resposta.status,
      'google_recusou',
    );
  }

  return dados as T;
}

function buscarTextoGooglePlaces(textQuery: string, pageToken: string | undefined): Promise<RespostaTextSearch> {
  // Endpoint exato da Places API (New): POST /v1/places:searchText — o
  // recurso é "places", com o método customizado ":searchText" no final.
  // Faltava o segmento "/places" aqui (virava ".../v1:searchText", 404
  // real em produção — ver a investigação deste incidente).
  return chamarGooglePlaces<RespostaTextSearch>('/places:searchText', FIELD_MASK_BUSCA, 'text_search', {
    metodo: 'POST',
    corpo: {
      textQuery,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      pageSize: TAMANHO_PAGINA,
      ...(pageToken ? { pageToken } : {}),
    },
  });
}

function buscarDetalhesGooglePlaces(placeId: string): Promise<PlaceBruto> {
  // Endpoint exato: GET /v1/places/{PLACE_ID}. `placeId` aqui é sempre o
  // valor de `place.id` (bare, ex.: "ChIJ...") — NUNCA o `place.name`
  // (esse sim já vem como "places/{id}"); nosso FieldMask só pede `id`,
  // então não há risco de concatenar "places/" num valor que já o tenha.
  return chamarGooglePlaces<PlaceBruto>(`/places/${encodeURIComponent(placeId)}`, FIELD_MASK_DETALHES, 'place_details');
}

/* --------------------------------------------------------------------------
   Conversão para o formato que o resto da prospecção usa
   -------------------------------------------------------------------------- */

export interface CandidatoGooglePlaces {
  place_id: string;
  nome: string;
  endereco: string | null;
  cidade: string | null;
  telefone: string | null;
  site: string | null;
}

/** `locality` é o componente correto na maioria dos endereços do Google no Brasil; algumas cidades só trazem `administrative_area_level_2`. */
function extrairCidade(componentes: EnderecoComponenteBruto[] | undefined): string | null {
  if (!componentes) return null;
  const achado =
    componentes.find((c) => c.types?.includes('locality')) ??
    componentes.find((c) => c.types?.includes('administrative_area_level_2'));
  return achado?.longText?.trim() || null;
}

function converterPlaceBruto(bruto: PlaceBruto): CandidatoGooglePlaces {
  return {
    place_id: bruto.id,
    nome: bruto.displayName?.text?.trim() || '',
    endereco: bruto.formattedAddress?.trim() || null,
    cidade: extrairCidade(bruto.addressComponents),
    telefone: bruto.internationalPhoneNumber?.trim() || null,
    site: bruto.websiteUri?.trim() || null,
  };
}

/* --------------------------------------------------------------------------
   Função pública
   -------------------------------------------------------------------------- */

export interface OpcoesBuscaGooglePlaces {
  /** Override só para teste — evita esperar de verdade o pageToken ficar válido. */
  atrasoEntrePaginasMs?: number;
}

/**
 * Busca candidatos a lead no Google Places (Text Search + Details) para um
 * nicho e cidade, até `quantidade` — nunca mais que `TAMANHO_PAGINA * MAX_PAGINAS`.
 *
 * DETERMINÍSTICO NA FORMA, NÃO NO CONTEÚDO: o Google decide quais negócios
 * existem; esta função nunca filtra, pontua ou decide duplicidade — isso é
 * shared/regras-prospeccao.ts, chamado por quem orquestra (prospeccao.ts).
 */
export async function buscarCandidatosGooglePlaces(
  nicho: string,
  cidade: string,
  quantidade: number,
  opcoes: OpcoesBuscaGooglePlaces = {},
): Promise<CandidatoGooglePlaces[]> {
  const atraso = opcoes.atrasoEntrePaginasMs ?? ATRASO_PROXIMA_PAGINA_MS;
  const alvo = Math.max(1, Math.min(Math.trunc(quantidade) || 1, TAMANHO_PAGINA * MAX_PAGINAS));
  const textQuery = `${nicho} em ${cidade}`.trim();

  const brutos: PlaceBruto[] = [];
  let pageToken: string | undefined;
  let pagina = 0;

  do {
    const resposta = await buscarTextoGooglePlaces(textQuery, pageToken);
    brutos.push(...(resposta.places ?? []));
    pagina += 1;

    const podeContinuar = Boolean(resposta.nextPageToken) && brutos.length < alvo && pagina < MAX_PAGINAS;
    if (podeContinuar) {
      pageToken = resposta.nextPageToken;
      await new Promise((resolve) => setTimeout(resolve, atraso));
    } else {
      pageToken = undefined;
    }
  } while (pageToken);

  const cortados = brutos.slice(0, alvo);

  // Completa telefone/site só de quem faltou — e nunca duas vezes o mesmo
  // place_id, mesmo que ele apareça repetido nos resultados brutos.
  const jaDetalhados = new Set<string>();
  const completos = await mapComConcorrenciaLimitada(cortados, CONCORRENCIA_DETALHES, async (bruto) => {
    const faltaAlgo = !bruto.internationalPhoneNumber || !bruto.websiteUri;
    if (!faltaAlgo || jaDetalhados.has(bruto.id)) return bruto;

    jaDetalhados.add(bruto.id);
    try {
      const detalhe = await buscarDetalhesGooglePlaces(bruto.id);
      return { ...bruto, ...detalhe };
    } catch {
      // Detalhe indisponível não derruba o candidato: ele entra só com o que
      // o Text Search já trouxe.
      return bruto;
    }
  });

  return completos.map(converterPlaceBruto);
}

/* --------------------------------------------------------------------------
   Concorrência limitada — pool simples de N workers, sem dependência nova.
   Reaproveitada por prospeccao.ts para a análise de sites.
   -------------------------------------------------------------------------- */

export async function mapComConcorrenciaLimitada<T, R>(
  itens: T[],
  limite: number,
  tarefa: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let proximo = 0;

  async function worker(): Promise<void> {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice]!);
    }
  }

  const quantidadeWorkers = Math.min(limite, itens.length);
  await Promise.all(Array.from({ length: quantidadeWorkers }, () => worker()));

  return resultados;
}

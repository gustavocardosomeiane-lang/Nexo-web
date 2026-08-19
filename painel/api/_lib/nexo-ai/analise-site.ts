/**
 * Análise técnica REAL de um site — HTTP puro, nunca navegador.
 *
 * ===========================================================================
 * Um único GET com `fetch`, leitura do HTML e checagens objetivas por
 * cabeçalho/regex. Nunca executa JavaScript da página, nunca abre um
 * navegador headless — é o que garante que todo sinal aqui é técnico e
 * verificável, nunca opinião de design ("bonito"/"feio" não existe neste
 * arquivo). O resultado alimenta `calcularScoreOportunidade` em
 * `shared/regras-prospeccao.ts`, que é quem decide o que cada sinal pesa.
 *
 * NUNCA REJEITA. Qualquer falha — timeout, rede, redirecionamento demais,
 * corpo ilegível — vira `erro` preenchido DENTRO do `AnaliseSite` devolvido,
 * nunca uma exceção. É o contrato que permite `mapComConcorrenciaLimitada`
 * (google-places.ts) seguir o lote inteiro mesmo quando um site cai — um
 * `throw` aqui derrubaria o worker e, com ele, os outros sites que aquele
 * worker ainda ia processar.
 * ===========================================================================
 */

/**
 * Espelha `AnaliseSite` em `shared/regras-prospeccao.ts` (que por sua vez
 * espelha `src/types/index.ts`). Mesmo padrão de tipo duplicado que o resto
 * do projeto usa entre `shared/` e os dois lados que o consomem — mexeu num,
 * mexa nos outros dois.
 */
export interface AnaliseSite {
  tem_site: boolean;
  acessivel: boolean;
  status_http: number | null;
  https: boolean;
  viewport_mobile: boolean;
  tempo_resposta_ms: number | null;
  tamanho_bytes: number | null;
  tem_cta: boolean;
  erro: string | null;
}

const TIMEOUT_MS = 5000;

/**
 * Quantos caracteres do HTML entram nas checagens de viewport/CTA.
 *
 * NÃO é um limite de download — `fetch().text()` já baixa o corpo inteiro
 * antes deste corte; é só o que evita gastar tempo de regex numa página de
 * megabytes. O timeout de 5s acima é a proteção real contra corpo gigante ou
 * lento: se a leitura não terminar a tempo, `AbortController` já encerrou a
 * conexão antes de chegar aqui.
 */
const LIMITE_CARACTERES_ANALISADOS = 300_000;

const USER_AGENT = 'NexoWebProspeccaoBot/1.0 (+https://nexoweb.com.br)';

const PADRAO_VIEWPORT = /<meta[^>]+name=["']viewport["']/i;
const PADRAO_TEL = /href=["']tel:/i;
const PADRAO_WHATSAPP = /href=["']https?:\/\/(api\.|www\.)?(wa\.me|whatsapp\.com)\//i;
const PADRAO_FORMULARIO = /<form[\s>]/i;

function analiseComErro(erro: string): AnaliseSite {
  return {
    tem_site: true,
    acessivel: false,
    status_http: null,
    https: false,
    viewport_mobile: false,
    tempo_resposta_ms: null,
    tamanho_bytes: null,
    tem_cta: false,
    erro,
  };
}

/** Aceita URL com ou sem protocolo — o Google às vezes devolve só o domínio. */
function comProtocolo(url: string): string {
  const limpa = url.trim();
  return /^https?:\/\//i.test(limpa) ? limpa : `https://${limpa}`;
}

export interface OpcoesAnaliseSite {
  /** Override só para teste — evita esperar o timeout real de 5s. */
  timeoutMs?: number;
}

/**
 * Analisa um site já existente (chamador garante que há URL — quem decide
 * "esse lead não tem site" é `prospeccao.ts`, que nem chega a chamar esta
 * função nesse caso).
 */
export async function analisarSite(url: string, opcoes: OpcoesAnaliseSite = {}): Promise<AnaliseSite> {
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS;
  const alvo = comProtocolo(url);
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), timeoutMs);
  const inicio = Date.now();

  let resposta: Response;
  try {
    resposta = await fetch(alvo, {
      method: 'GET',
      redirect: 'follow',
      signal: controlador.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const timeout = e instanceof Error && e.name === 'AbortError';
    return analiseComErro(timeout ? 'timeout' : 'rede');
  }

  // Resposta inválida (4xx/5xx) = site quebrado. O `redirect: 'follow'` já
  // resolveu qualquer 3xx antes de chegar aqui — `resposta.url` reflete o
  // endereço FINAL, depois de todos os redirecionamentos.
  if (!resposta.ok) {
    clearTimeout(timeoutId);
    return {
      tem_site: true,
      acessivel: false,
      status_http: resposta.status,
      https: resposta.url.startsWith('https://'),
      viewport_mobile: false,
      tempo_resposta_ms: Date.now() - inicio,
      tamanho_bytes: null,
      tem_cta: false,
      erro: `status_${resposta.status}`,
    };
  }

  let corpo: string;
  try {
    corpo = await resposta.text();
  } catch (e) {
    clearTimeout(timeoutId);
    const timeout = e instanceof Error && e.name === 'AbortError';
    return analiseComErro(timeout ? 'timeout' : 'leitura_falhou');
  }
  clearTimeout(timeoutId);

  const tempo_resposta_ms = Date.now() - inicio;
  const html = corpo.slice(0, LIMITE_CARACTERES_ANALISADOS);

  const tamanhoHeader = Number(resposta.headers.get('content-length') ?? '');
  // Quando o servidor não manda Content-Length, usamos o tamanho do que foi
  // realmente lido — uma medida honesta, ainda que dependente de encoding.
  const tamanho_bytes =
    Number.isFinite(tamanhoHeader) && tamanhoHeader > 0
      ? tamanhoHeader
      : new TextEncoder().encode(corpo).byteLength;

  return {
    tem_site: true,
    acessivel: true,
    status_http: resposta.status,
    https: resposta.url.startsWith('https://'),
    viewport_mobile: PADRAO_VIEWPORT.test(html),
    tempo_resposta_ms,
    tamanho_bytes,
    tem_cta: PADRAO_TEL.test(html) || PADRAO_WHATSAPP.test(html) || PADRAO_FORMULARIO.test(html),
    erro: null,
  };
}

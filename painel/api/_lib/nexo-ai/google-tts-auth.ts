import type { VercelRequest } from '@vercel/node';

/**
 * NEXO AI — autenticação KEYLESS (Vercel OIDC → Google Workload Identity
 * Federation → impersonação) para o Google Cloud Text-to-Speech.
 *
 * Substitui a versão anterior baseada em GOOGLE_TTS_CREDENCIAIS (JSON de
 * conta de serviço baixado do Console) — a organização do Google Cloud
 * bloqueia criação de chave (`iam.disableServiceAccountKeyCreation`), então
 * não existe chave nenhuma pra guardar. Nada aqui depende de arquivo local
 * fixo de token nem de segredo estático: cada access_token é obtido em
 * runtime e vive só em memória, com expiração curta.
 *
 * Fluxo (RFC 8693 token exchange + impersonação — três hops):
 *
 *   1. Token OIDC da Vercel — cada invocação de uma Vercel Function traz o
 *      header `x-vercel-oidc-token` (confirmado na documentação oficial:
 *      "the token is only available in the Request object as the
 *      x-vercel-oidc-token header" — NÃO é uma env var estática em
 *      produção; em dev local, cai pra `VERCEL_OIDC_TOKEN` via
 *      `vercel env pull`). `aud` desse token é o padrão da Vercel
 *      (`https://vercel.com/c2minds`) — o Workload Identity Provider foi
 *      configurado com "Allowed audiences" pra aceitar exatamente esse
 *      valor, então nenhuma troca de audience é necessária.
 *
 *   2. Google STS (`sts.googleapis.com/v1/token`) troca esse token OIDC por
 *      um "federated token" do Workload Identity Pool.
 *
 *   3. IAM Credentials API (`generateAccessToken`) usa o federated token pra
 *      impersonar a service account de destino (GOOGLE_TTS_SERVICE_ACCOUNT,
 *      `nexo-tts@...`) e devolve o access_token de verdade — o único
 *      usado pra chamar o Cloud TTS.
 *
 * Nada neste arquivo é segredo: project number, pool ID, provider ID e o
 * e-mail da service account são todos identificadores públicos (visíveis em
 * qualquer console do IAM) — só o access_token resultante (de curta duração)
 * precisa ficar fora de log e fora do frontend.
 */

const STS_ENDPOINT = 'https://sts.googleapis.com/v1/token';
const IAM_CREDENTIALS_BASE = 'https://iamcredentials.googleapis.com/v1';
const ESCOPO_CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';
/** Valores exatos exigidos pelo RFC 8693 / STS do Google — confirmados na documentação oficial. */
const SUBJECT_TOKEN_TYPE_JWT = 'urn:ietf:params:oauth:token-type:jwt';
const GRANT_TYPE_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const REQUESTED_TOKEN_TYPE_ACCESS_TOKEN = 'urn:ietf:params:oauth:token-type:access_token';
/** Pedido explícito do lifetime do access_token impersonado — reduz o blast radius se vazar. */
const LIFETIME_ACCESS_TOKEN = '3600s';

const MARGEM_EXPIRACAO_MS = 5 * 60 * 1000;
const TIMEOUT_STS_MS = 8_000;
const TIMEOUT_IMPERSONACAO_MS = 8_000;

interface ConfiguracaoWif {
  projectNumber: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
}

function lerConfiguracao(): ConfiguracaoWif | null {
  const projectNumber = (process.env.GCP_PROJECT_NUMBER ?? '').trim();
  const poolId = (process.env.GCP_WORKLOAD_IDENTITY_POOL_ID ?? '').trim();
  const providerId = (process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID ?? '').trim();
  const serviceAccountEmail = (process.env.GOOGLE_TTS_SERVICE_ACCOUNT ?? '').trim();
  if (!projectNumber || !poolId || !providerId || !serviceAccountEmail) return null;
  return { projectNumber, poolId, providerId, serviceAccountEmail };
}

/**
 * Identificador do Workload Identity Provider exigido pelo STS — sempre
 * neste formato protocol-relative (confirmado na documentação oficial do
 * Google). Independe do modo de "Audience" escolhido na configuração do
 * provider: este campo diz ao STS QUAL provider validar o token, não é a
 * claim `aud` do token em si.
 */
export function montarAudienceProviderWif(config: ConfiguracaoWif): string {
  return `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
}

/**
 * Lê o token OIDC da requisição — header `x-vercel-oidc-token` (o único
 * lugar onde ele existe numa Vercel Function de verdade, em produção), com
 * fallback pra `VERCEL_OIDC_TOKEN` (dev local via `vercel env pull`). Nunca
 * lido de `process.env` sozinho como fonte primária: a documentação da
 * Vercel é explícita que em Function o token só vem no header.
 */
export function obterTokenOidcVercel(req: Pick<VercelRequest, 'headers'>): string {
  const doHeader = req.headers['x-vercel-oidc-token'];
  const bruto = Array.isArray(doHeader) ? doHeader[0] : doHeader;
  if (bruto) return bruto.trim();
  return (process.env.VERCEL_OIDC_TOKEN ?? '').trim();
}

/**
 * Monta a requisição de token exchange (RFC 8693) pro Google STS — extraído
 * pra ser testável sem rede. Nomes de campo em snake_case e valores exatos
 * confirmados na documentação oficial do Google — nada inventado.
 */
export function montarRequisicaoSts(
  oidcToken: string,
  audienceProvider: string,
): { url: string; opcoes: { method: 'POST'; headers: Record<string, string>; body: string } } {
  return {
    url: STS_ENDPOINT,
    opcoes: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: audienceProvider,
        grant_type: GRANT_TYPE_TOKEN_EXCHANGE,
        requested_token_type: REQUESTED_TOKEN_TYPE_ACCESS_TOKEN,
        scope: ESCOPO_CLOUD_PLATFORM,
        subject_token_type: SUBJECT_TOKEN_TYPE_JWT,
        subject_token: oidcToken,
      }),
    },
  };
}

/**
 * Monta a requisição de impersonação (IAM Credentials API,
 * `generateAccessToken`) — troca o federated token do STS por um
 * access_token de verdade da service account alvo. Campos em camelCase e
 * endpoint confirmados na documentação oficial: `scope` é ARRAY (não
 * string, ao contrário do STS), `lifetime` no formato `"Ns"`.
 */
export function montarRequisicaoImpersonacao(
  federatedToken: string,
  serviceAccountEmail: string,
): { url: string; opcoes: { method: 'POST'; headers: Record<string, string>; body: string } } {
  return {
    url: `${IAM_CREDENTIALS_BASE}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`,
    opcoes: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${federatedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: [ESCOPO_CLOUD_PLATFORM],
        lifetime: LIFETIME_ACCESS_TOKEN,
      }),
    },
  };
}

/**
 * Corpo de erro do STS (padrão OAuth2: `{ error: "invalid_grant",
 * error_description }`) OU da IAM Credentials API (padrão Google API:
 * `{ error: { code, message, status } }`) — os dois hops usam convenções
 * diferentes. Extrai com segurança, sem presumir qual formato veio.
 */
export function extrairDetalheErroGoogleAuth(dados: unknown): { codigo: string | null; mensagem: string | null } {
  const raiz = (dados ?? null) as Record<string, unknown> | null;
  if (!raiz) return { codigo: null, mensagem: null };
  if (typeof raiz.error === 'string') {
    return {
      codigo: raiz.error,
      mensagem: typeof raiz.error_description === 'string' ? raiz.error_description : null,
    };
  }
  if (raiz.error && typeof raiz.error === 'object') {
    const e = raiz.error as Record<string, unknown>;
    return {
      codigo: typeof e.status === 'string' ? e.status : null,
      mensagem: typeof e.message === 'string' ? e.message : null,
    };
  }
  return { codigo: null, mensagem: null };
}

/** Em qual dos hops a autenticação falhou — usado só pra log/diagnóstico, nunca exposto ao frontend. */
export type EtapaFalhaAuthGoogleTts = 'config_ausente' | 'oidc_ausente' | 'sts' | 'impersonacao';

export class ErroAuthGoogleTts extends Error {
  etapa: EtapaFalhaAuthGoogleTts;
  statusHttp?: number;
  constructor(etapa: EtapaFalhaAuthGoogleTts, message: string, statusHttp?: number) {
    super(message);
    this.name = 'ErroAuthGoogleTts';
    this.etapa = etapa;
    this.statusHttp = statusHttp;
  }
}

async function fetchComTimeout(url: string, opcoes: RequestInit, timeoutMs: number, etapa: EtapaFalhaAuthGoogleTts): Promise<Response> {
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'AbortError';
    throw new ErroAuthGoogleTts(etapa, timeout ? `Tempo limite no hop "${etapa}".` : `Falha de rede no hop "${etapa}".`);
  } finally {
    clearTimeout(timeoutId);
  }
}

let tokenCache: { token: string; expiraEm: number } | null = null;

/**
 * Devolve um access_token da service account impersonada, reaproveitando
 * entre invocações "quentes" (cache em memória, nunca em disco). Refaz os
 * três hops só quando o cache está ausente ou perto de vencer.
 */
export async function obterAccessTokenGoogle(req: Pick<VercelRequest, 'headers'>): Promise<string> {
  const agora = Date.now();
  if (tokenCache && agora < tokenCache.expiraEm - MARGEM_EXPIRACAO_MS) {
    return tokenCache.token;
  }

  const config = lerConfiguracao();
  if (!config) {
    throw new ErroAuthGoogleTts('config_ausente', 'Configuração de Workload Identity Federation incompleta.');
  }

  const oidcToken = obterTokenOidcVercel(req);
  if (!oidcToken) {
    throw new ErroAuthGoogleTts('oidc_ausente', 'Token OIDC da Vercel não encontrado na requisição.');
  }

  const audienceProvider = montarAudienceProviderWif(config);
  const { url: urlSts, opcoes: opcoesSts } = montarRequisicaoSts(oidcToken, audienceProvider);
  const respostaSts = await fetchComTimeout(urlSts, opcoesSts, TIMEOUT_STS_MS, 'sts');
  const dadosSts = await respostaSts.json().catch(() => null);
  if (!respostaSts.ok) {
    const detalhe = extrairDetalheErroGoogleAuth(dadosSts);
    throw new ErroAuthGoogleTts(
      'sts',
      `Google STS recusou o token (status ${respostaSts.status}, codigo ${detalhe.codigo ?? 'ausente'}).`,
      respostaSts.status,
    );
  }
  const federatedToken = typeof (dadosSts as { access_token?: unknown })?.access_token === 'string'
    ? (dadosSts as { access_token: string }).access_token
    : '';
  if (!federatedToken) {
    throw new ErroAuthGoogleTts('sts', 'Google STS não retornou access_token.');
  }

  const { url: urlImpersonacao, opcoes: opcoesImpersonacao } = montarRequisicaoImpersonacao(
    federatedToken,
    config.serviceAccountEmail,
  );
  const respostaImpersonacao = await fetchComTimeout(urlImpersonacao, opcoesImpersonacao, TIMEOUT_IMPERSONACAO_MS, 'impersonacao');
  const dadosImpersonacao = await respostaImpersonacao.json().catch(() => null);
  if (!respostaImpersonacao.ok) {
    const detalhe = extrairDetalheErroGoogleAuth(dadosImpersonacao);
    throw new ErroAuthGoogleTts(
      'impersonacao',
      `IAM Credentials recusou a impersonação (status ${respostaImpersonacao.status}, codigo ${detalhe.codigo ?? 'ausente'}).`,
      respostaImpersonacao.status,
    );
  }
  const corpo = dadosImpersonacao as { accessToken?: unknown; expireTime?: unknown } | null;
  const accessToken = typeof corpo?.accessToken === 'string' ? corpo.accessToken : '';
  if (!accessToken) {
    throw new ErroAuthGoogleTts('impersonacao', 'IAM Credentials não retornou accessToken.');
  }
  const expireTimeMs = typeof corpo?.expireTime === 'string' ? Date.parse(corpo.expireTime) : NaN;
  const expiraEm = Number.isFinite(expireTimeMs) ? expireTimeMs : agora + 3600_000;

  tokenCache = { token: accessToken, expiraEm };
  return accessToken;
}

/** Só para os testes resetarem o cache entre casos — não é usado em produção. */
export function _resetarCacheTokenParaTeste(): void {
  tokenCache = null;
}

/**
 * Diagnóstico seguro da configuração — nada aqui é segredo (project number,
 * pool/provider ID e e-mail da service account são identificadores
 * públicos, visíveis em qualquer console do IAM), então pode logar tudo.
 * Só o access_token (obtido depois, via `obterAccessTokenGoogle`) nunca é
 * logado. Throttlado por valor, mesmo padrão dos outros diagnósticos do
 * projeto.
 */
let ultimaConfigDiagnosticada: string | null = null;
export function logDiagnosticoConfigGoogleTts(): void {
  const config = lerConfiguracao();
  const chave = JSON.stringify(config);
  if (chave === ultimaConfigDiagnosticada) return;
  ultimaConfigDiagnosticada = chave;

  if (!config) {
    console.log(
      '[NEXO TTS] diagnostico_config_google',
      'config_completa=nao',
      'project_number=' + ((process.env.GCP_PROJECT_NUMBER ?? '').trim() || 'ausente'),
      'pool_id=' + ((process.env.GCP_WORKLOAD_IDENTITY_POOL_ID ?? '').trim() || 'ausente'),
      'provider_id=' + ((process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID ?? '').trim() || 'ausente'),
      'service_account=' + ((process.env.GOOGLE_TTS_SERVICE_ACCOUNT ?? '').trim() || 'ausente'),
      'ambiente=' + (process.env.VERCEL_ENV ?? 'desconhecido'),
    );
    return;
  }
  console.log(
    '[NEXO TTS] diagnostico_config_google',
    'config_completa=sim',
    'project_number=' + config.projectNumber,
    'pool_id=' + config.poolId,
    'provider_id=' + config.providerId,
    'service_account=' + config.serviceAccountEmail,
    'ambiente=' + (process.env.VERCEL_ENV ?? 'desconhecido'),
  );
}

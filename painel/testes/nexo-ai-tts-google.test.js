/**
 * Testes da migração do TTS da NEXO AI: GOOGLE_TTS_CREDENCIAIS (JSON de
 * conta de serviço) -> autenticação KEYLESS (Vercel OIDC -> Google STS ->
 * impersonação da service account nexo-tts).
 *
 * Cobrem exatamente os pontos pedidos na migração:
 *   - o token OIDC da Vercel nunca aparece em log;
 *   - audience e request do STS corretos (RFC 8693 token exchange);
 *   - impersonação usa a service account certa, com scope cloud-platform;
 *   - cache do access_token funciona e renova quando perto de vencer;
 *   - 403 de impersonação e erro de STS são tratados sem lançar exceção
 *     não classificada nem entrar em retry infinito;
 *   - a chamada ao Cloud TTS usa Bearer access_token (nunca xi-api-key da
 *     ElevenLabs, nunca a antiga GOOGLE_TTS_CREDENCIAIS);
 *   - o formato de áudio (MP3/audio-mpeg) continua igual pro frontend.
 *
 * Mesma limitação já documentada nos outros testes de TTS: o handler em si
 * (autenticação de sessão, fetch real) não é exercitado aqui — só as
 * funções puras extraídas dele, testáveis sem mock de módulo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  montarAudienceProviderWif,
  obterTokenOidcVercel,
  montarRequisicaoSts,
  montarRequisicaoImpersonacao,
  extrairDetalheErroGoogleAuth,
  obterAccessTokenGoogle,
  logDiagnosticoConfigGoogleTts,
  ErroAuthGoogleTts,
  _resetarCacheTokenParaTeste,
} from '../api/_lib/nexo-ai/google-tts-auth.ts';
import { montarRequisicaoGoogleTts, extrairDetalheGoogleTts } from '../api/nexo-ai/falar.ts';

const consoleLogOriginal = console.log;
const fetchOriginal = globalThis.fetch;

const CHAVES_ENV = [
  'GCP_PROJECT_NUMBER',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
  'GOOGLE_TTS_SERVICE_ACCOUNT',
  'VERCEL_OIDC_TOKEN',
  'GOOGLE_TTS_CREDENCIAIS',
];
const envOriginal = Object.fromEntries(CHAVES_ENV.map((k) => [k, process.env[k]]));

function capturarLogs() {
  const linhas = [];
  console.log = (...args) => linhas.push(args.join(' '));
  return linhas;
}

function definirEnvValido() {
  process.env.GCP_PROJECT_NUMBER = '333777789753';
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = 'vercel';
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = 'vercel';
  process.env.GOOGLE_TTS_SERVICE_ACCOUNT = 'nexo-tts@nexo-ai-506000.iam.gserviceaccount.com';
}

function reqComOidc(token) {
  return { headers: token ? { 'x-vercel-oidc-token': token } : {} };
}

test.afterEach(() => {
  console.log = consoleLogOriginal;
  globalThis.fetch = fetchOriginal;
  _resetarCacheTokenParaTeste();
  for (const k of CHAVES_ENV) {
    if (envOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = envOriginal[k];
  }
});

/* ==========================================================================
   1. montarAudienceProviderWif — identificador do provider exigido pelo STS
   ========================================================================== */

test('audience do provider WIF segue o formato protocol-relative exigido pelo STS', () => {
  const audience = montarAudienceProviderWif({
    projectNumber: '333777789753',
    poolId: 'vercel',
    providerId: 'vercel',
    serviceAccountEmail: 'nexo-tts@nexo-ai-506000.iam.gserviceaccount.com',
  });
  assert.equal(
    audience,
    '//iam.googleapis.com/projects/333777789753/locations/global/workloadIdentityPools/vercel/providers/vercel',
  );
});

/* ==========================================================================
   2. obterTokenOidcVercel — header em produção, env var em dev local
   ========================================================================== */

test('lê o token do header x-vercel-oidc-token quando presente (produção)', () => {
  const token = obterTokenOidcVercel({ headers: { 'x-vercel-oidc-token': 'token-do-header' } });
  assert.equal(token, 'token-do-header');
});

test('header como array (alguns runtimes normalizam assim): usa o primeiro valor', () => {
  const token = obterTokenOidcVercel({ headers: { 'x-vercel-oidc-token': ['token-a', 'token-b'] } });
  assert.equal(token, 'token-a');
});

test('sem header: cai pro fallback VERCEL_OIDC_TOKEN (dev local via vercel env pull)', () => {
  process.env.VERCEL_OIDC_TOKEN = 'token-do-env-local';
  const token = obterTokenOidcVercel({ headers: {} });
  assert.equal(token, 'token-do-env-local');
});

test('sem header e sem env var: string vazia, nunca lança', () => {
  const token = obterTokenOidcVercel({ headers: {} });
  assert.equal(token, '');
});

/* ==========================================================================
   3. montarRequisicaoSts — RFC 8693 token exchange, campos exatos
   ========================================================================== */

test('URL do STS é exatamente o endpoint documentado', () => {
  const { url } = montarRequisicaoSts('oidc-token', 'audience-do-provider');
  assert.equal(url, 'https://sts.googleapis.com/v1/token');
});

test('corpo do STS: snake_case, grant_type/requested_token_type/subject_token_type exatos', () => {
  const { opcoes } = montarRequisicaoSts('oidc-token-de-teste', '//iam.googleapis.com/projects/1/providers/x');
  const corpo = JSON.parse(opcoes.body);
  assert.equal(corpo.audience, '//iam.googleapis.com/projects/1/providers/x');
  assert.equal(corpo.grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange');
  assert.equal(corpo.requested_token_type, 'urn:ietf:params:oauth:token-type:access_token');
  assert.equal(corpo.subject_token_type, 'urn:ietf:params:oauth:token-type:jwt');
  assert.equal(corpo.scope, 'https://www.googleapis.com/auth/cloud-platform');
  assert.equal(corpo.subject_token, 'oidc-token-de-teste');
});

test('STS é POST com Content-Type application/json', () => {
  const { opcoes } = montarRequisicaoSts('t', 'a');
  assert.equal(opcoes.method, 'POST');
  assert.equal(opcoes.headers['Content-Type'], 'application/json');
});

/* ==========================================================================
   4. montarRequisicaoImpersonacao — generateAccessToken, campos exatos
   ========================================================================== */

test('URL da impersonação aponta pra service account certa, com :generateAccessToken', () => {
  const { url } = montarRequisicaoImpersonacao('federated-token', 'nexo-tts@nexo-ai-506000.iam.gserviceaccount.com');
  assert.equal(
    url,
    'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/nexo-tts%40nexo-ai-506000.iam.gserviceaccount.com:generateAccessToken',
  );
});

test('impersonação usa Authorization Bearer com o federated token do STS — nunca xi-api-key', () => {
  const { opcoes } = montarRequisicaoImpersonacao('federated-token-abc', 'sa@projeto.iam.gserviceaccount.com');
  assert.equal(opcoes.headers['Authorization'], 'Bearer federated-token-abc');
  assert.equal('xi-api-key' in opcoes.headers, false);
});

test('corpo da impersonação: scope é ARRAY com cloud-platform, lifetime em segundos', () => {
  const { opcoes } = montarRequisicaoImpersonacao('t', 'sa@projeto.iam.gserviceaccount.com');
  const corpo = JSON.parse(opcoes.body);
  assert.deepEqual(corpo.scope, ['https://www.googleapis.com/auth/cloud-platform']);
  assert.equal(corpo.lifetime, '3600s');
});

/* ==========================================================================
   5. extrairDetalheErroGoogleAuth — STS (OAuth2) x IAM Credentials (Google API)
   ========================================================================== */

test('formato OAuth2 do STS: { error: "invalid_grant", error_description }', () => {
  const detalhe = extrairDetalheErroGoogleAuth({ error: 'invalid_grant', error_description: 'Token inválido.' });
  assert.equal(detalhe.codigo, 'invalid_grant');
  assert.equal(detalhe.mensagem, 'Token inválido.');
});

test('formato Google API da IAM Credentials: { error: { status, message } }', () => {
  const detalhe = extrairDetalheErroGoogleAuth({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Permission denied.' } });
  assert.equal(detalhe.codigo, 'PERMISSION_DENIED');
  assert.equal(detalhe.mensagem, 'Permission denied.');
});

test('corpo nulo/vazio/desconhecido: nunca lança, devolve nulls', () => {
  assert.deepEqual(extrairDetalheErroGoogleAuth(null), { codigo: null, mensagem: null });
  assert.deepEqual(extrairDetalheErroGoogleAuth(undefined), { codigo: null, mensagem: null });
  assert.deepEqual(extrairDetalheErroGoogleAuth({}), { codigo: null, mensagem: null });
  assert.deepEqual(extrairDetalheErroGoogleAuth('string solta'), { codigo: null, mensagem: null });
});

/* ==========================================================================
   6. obterAccessTokenGoogle — orquestra os 3 hops, sem retry infinito
   ========================================================================== */

test('config incompleta (falta env var): rejeita com etapa=config_ausente, nunca chama fetch', async () => {
  let chamouFetch = false;
  globalThis.fetch = async () => { chamouFetch = true; };
  await assert.rejects(
    () => obterAccessTokenGoogle(reqComOidc('token')),
    (e) => e instanceof ErroAuthGoogleTts && e.etapa === 'config_ausente',
  );
  assert.equal(chamouFetch, false);
});

test('sem token OIDC (header e env ausentes): rejeita com etapa=oidc_ausente, nunca chama fetch', async () => {
  definirEnvValido();
  let chamouFetch = false;
  globalThis.fetch = async () => { chamouFetch = true; };
  await assert.rejects(
    () => obterAccessTokenGoogle(reqComOidc(null)),
    (e) => e instanceof ErroAuthGoogleTts && e.etapa === 'oidc_ausente',
  );
  assert.equal(chamouFetch, false);
});

test('fluxo completo: STS -> impersonação, cada chamada com a URL e o corpo certos', async () => {
  definirEnvValido();
  const chamadas = [];
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (url === 'https://sts.googleapis.com/v1/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'federated-xyz', expires_in: 3600 }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'access-final-abc', expireTime: new Date(Date.now() + 3600_000).toISOString() }),
    };
  };

  const token = await obterAccessTokenGoogle(reqComOidc('meu-token-oidc'));
  assert.equal(token, 'access-final-abc');
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0].url, 'https://sts.googleapis.com/v1/token');
  assert.equal(JSON.parse(chamadas[0].opcoes.body).subject_token, 'meu-token-oidc');
  assert.match(chamadas[1].url, /:generateAccessToken$/);
  assert.match(chamadas[1].url, /nexo-tts%40nexo-ai-506000\.iam\.gserviceaccount\.com/);
  assert.equal(chamadas[1].opcoes.headers['Authorization'], 'Bearer federated-xyz');
});

test('STS recusa (400): rejeita com etapa=sts e o status certo, impersonação NUNCA é chamada', async () => {
  definirEnvValido();
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'ruim' }) };
  };

  await assert.rejects(
    () => obterAccessTokenGoogle(reqComOidc('token')),
    (e) => e instanceof ErroAuthGoogleTts && e.etapa === 'sts' && e.statusHttp === 400,
  );
  assert.equal(chamadas, 1);
});

test('impersonação recusa (403 PERMISSION_DENIED): rejeita com etapa=impersonacao — STS já tinha passado', async () => {
  definirEnvValido();
  let chamadas = 0;
  globalThis.fetch = async (url) => {
    chamadas += 1;
    if (url === 'https://sts.googleapis.com/v1/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'federated-xyz', expires_in: 3600 }) };
    }
    return { ok: false, status: 403, json: async () => ({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'sem acesso' } }) };
  };

  await assert.rejects(
    () => obterAccessTokenGoogle(reqComOidc('token')),
    (e) => e instanceof ErroAuthGoogleTts && e.etapa === 'impersonacao' && e.statusHttp === 403,
  );
  assert.equal(chamadas, 2);
});

test('cache: chamadas seguidas com token ainda válido reaproveitam — fetch só na primeira vez', async () => {
  definirEnvValido();
  let chamadas = 0;
  globalThis.fetch = async (url) => {
    chamadas += 1;
    if (url === 'https://sts.googleapis.com/v1/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'federated-xyz', expires_in: 3600 }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'access-cacheado', expireTime: new Date(Date.now() + 3600_000).toISOString() }),
    };
  };

  const t1 = await obterAccessTokenGoogle(reqComOidc('token'));
  const t2 = await obterAccessTokenGoogle(reqComOidc('token'));
  assert.equal(t1, 'access-cacheado');
  assert.equal(t2, 'access-cacheado');
  assert.equal(chamadas, 2); // só o primeiro fluxo completo (STS + impersonação)
});

test('token perto de vencer é renovado — não reaproveita cache expirado', async () => {
  definirEnvValido();
  let chamadas = 0;
  globalThis.fetch = async (url) => {
    chamadas += 1;
    if (url === 'https://sts.googleapis.com/v1/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'federated-xyz', expires_in: 3600 }) };
    }
    // expira em 1s — bem dentro da margem de 5min, força renovação na próxima chamada
    return {
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'access-quase-vencendo', expireTime: new Date(Date.now() + 1000).toISOString() }),
    };
  };

  const t1 = await obterAccessTokenGoogle(reqComOidc('token'));
  assert.equal(t1, 'access-quase-vencendo');
  assert.equal(chamadas, 2);

  const t2 = await obterAccessTokenGoogle(reqComOidc('token'));
  assert.equal(t2, 'access-quase-vencendo');
  assert.equal(chamadas, 4); // refez os dois hops — não reaproveitou o token perto de vencer
});

test('GOOGLE_TTS_CREDENCIAIS (variável antiga) não é lida — fluxo funciona mesmo com ela ausente ou corrompida', async () => {
  definirEnvValido();
  delete process.env.GOOGLE_TTS_CREDENCIAIS;
  globalThis.fetch = async (url) => {
    if (url === 'https://sts.googleapis.com/v1/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'federated-xyz', expires_in: 3600 }) };
    }
    return { ok: true, status: 200, json: async () => ({ accessToken: 'ok', expireTime: new Date(Date.now() + 3600_000).toISOString() }) };
  };
  const token = await obterAccessTokenGoogle(reqComOidc('token'));
  assert.equal(token, 'ok');
});

test('o token OIDC nunca aparece em nenhum log durante o fluxo (sucesso ou falha)', async () => {
  definirEnvValido();
  const oidcSecreto = 'token-oidc-super-especifico-nao-deve-vazar-em-log';
  globalThis.fetch = async (url) => {
    if (url === 'https://sts.googleapis.com/v1/token') {
      return { ok: false, status: 401, json: async () => ({ error: 'invalid_token' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const logs = capturarLogs();
  await assert.rejects(() => obterAccessTokenGoogle(reqComOidc(oidcSecreto)));
  assert.equal(logs.some((l) => l.includes(oidcSecreto)), false);
});

/* ==========================================================================
   7. logDiagnosticoConfigGoogleTts — nada aqui é segredo, mas ainda assim
      não deve depender/logar a antiga GOOGLE_TTS_CREDENCIAIS
   ========================================================================== */

test('config completa: loga project_number/pool_id/provider_id/service_account (não são segredos)', () => {
  definirEnvValido();
  const logs = capturarLogs();
  logDiagnosticoConfigGoogleTts();
  const linha = logs.find((l) => l.includes('diagnostico_config_google'));
  assert.ok(linha);
  assert.match(linha, /config_completa=sim/);
  assert.match(linha, /service_account=nexo-tts@nexo-ai-506000\.iam\.gserviceaccount\.com/);
});

test('config incompleta: config_completa=nao, sem crashar', () => {
  const logs = capturarLogs();
  logDiagnosticoConfigGoogleTts();
  const linha = logs.find((l) => l.includes('diagnostico_config_google'));
  assert.match(linha, /config_completa=nao/);
});

test('mesmo com GOOGLE_TTS_CREDENCIAIS definida (valor antigo/secreto), nunca aparece no log', () => {
  definirEnvValido();
  process.env.GOOGLE_TTS_CREDENCIAIS = 'valor-secreto-antigo-que-nao-deveria-mais-ser-lido';
  const logs = capturarLogs();
  logDiagnosticoConfigGoogleTts();
  assert.equal(logs.some((l) => l.includes('valor-secreto-antigo-que-nao-deveria-mais-ser-lido')), false);
});

/* ==========================================================================
   8. montarRequisicaoGoogleTts / extrairDetalheGoogleTts (falar.ts) —
      Bearer access_token, MP3, nunca ElevenLabs
   ========================================================================== */

test('a chamada ao Cloud TTS usa Authorization Bearer com o access_token final — nunca xi-api-key', () => {
  const { opcoes } = montarRequisicaoGoogleTts('olá', 'pt-BR-Chirp3-HD-Kore', 'access-token-final');
  assert.equal(opcoes.headers['Authorization'], 'Bearer access-token-final');
  assert.equal('xi-api-key' in opcoes.headers, false);
});

test('audioEncoding continua MP3 — frontend não precisa mudar decodeAudioData', () => {
  const { opcoes } = montarRequisicaoGoogleTts('olá', 'pt-BR-Chirp3-HD-Kore', 'token');
  const corpo = JSON.parse(opcoes.body);
  assert.equal(corpo.audioConfig.audioEncoding, 'MP3');
});

test('URL do Cloud TTS nunca é a da ElevenLabs', () => {
  const { url } = montarRequisicaoGoogleTts('olá', 'pt-BR-Chirp3-HD-Kore', 'token');
  assert.equal(url.includes('elevenlabs'), false);
  assert.equal(url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
});

test('extrairDetalheGoogleTts continua funcionando pro erro do próprio Cloud TTS (formato Google API padrão)', () => {
  const detalhe = extrairDetalheGoogleTts({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'sem acesso ao TTS' } });
  assert.equal(detalhe.status, 'PERMISSION_DENIED');
  assert.equal(detalhe.message, 'sem acesso ao TTS');
});

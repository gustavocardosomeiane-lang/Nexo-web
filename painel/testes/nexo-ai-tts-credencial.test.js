/**
 * Testes da investigação do 401 recorrente da ElevenLabs em /api/nexo-ai/falar.
 *
 * CAUSA DA RAJADA DE CHAMADAS (não é retry da mesma requisição): a fila de
 * fala incremental (src/nexo-ai/voz.ts) enfileira UM POST /api/nexo-ai/falar
 * por SEGMENTO da resposta falada (segmentarParaFala corta em blocos de
 * ~80-160 caracteres) — uma resposta de 400+ caracteres já vira 3-5
 * segmentos, cada um sintetizado de forma independente. Sem um freio, os 5
 * segmentos de UMA resposta batiam os 5 na ElevenLabs e levavam 5×401.
 *
 * DUAS CAMADAS TESTADAS AQUI:
 *   1. `deveTravarPorCredencial` (shared/regras-nexo-ai.ts) — o critério
 *      único usado tanto pelo backend (pra decidir `codigo: 'tts_credencial'`)
 *      quanto pelo frontend (pra travar a fila) de que um erro NÃO é
 *      transitório. Puro, sem DOM — pode ser testado de verdade.
 *   2. `logDiagnosticoCredencialTts` / `extrairDetalheElevenLabs`
 *      (api/nexo-ai/falar.ts) — diagnóstico seguro da credencial e do corpo
 *      de erro da ElevenLabs.
 *
 * `src/nexo-ai/voz.ts` (a fila de fala em si, com o `this.credencialTtsInvalida`
 * e o early-return antes de qualquer fetch) roda só em `typeof window !==
 * 'undefined'` — `podeFalar`/`enfileirarFala` são no-op fora do navegador, e
 * não há jsdom neste projeto (só `node --test`). Por isso a fila em si não
 * pode ser exercitada aqui; o que é testável — o predicado que decide
 * "trava ou não" — é testado exaustivamente abaixo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deveTravarPorCredencial } from '../shared/regras-nexo-ai.ts';
import {
  logDiagnosticoCredencialTts,
  extrairDetalheElevenLabs,
  montarRequisicaoElevenLabs,
} from '../api/nexo-ai/falar.ts';

const consoleLogOriginal = console.log;

function capturarLogs() {
  const linhas = [];
  console.log = (...args) => linhas.push(args.join(' '));
  return linhas;
}

test.afterEach(() => {
  console.log = consoleLogOriginal;
});

/* ==========================================================================
   1. deveTravarPorCredencial — critério único front/back, puro
   ========================================================================== */

test('401 trava — credencial inválida nunca é transitória', () => {
  assert.equal(deveTravarPorCredencial(401), true);
});

test('403 trava — sem permissão também nunca é transitório', () => {
  assert.equal(deveTravarPorCredencial(403), true);
});

test('429 NÃO trava — limite de uso é transitório, tem cooldown próprio', () => {
  assert.equal(deveTravarPorCredencial(429), false);
});

test('200/500/502 não travam por si só (sem o codigo explícito)', () => {
  assert.equal(deveTravarPorCredencial(200), false);
  assert.equal(deveTravarPorCredencial(500), false);
  assert.equal(deveTravarPorCredencial(502), false);
});

test('codigo="tts_credencial" trava mesmo com um status HTTP diferente de 401/403', () => {
  assert.equal(deveTravarPorCredencial(500, 'tts_credencial'), true);
});

test('codigo diferente ou ausente não trava sozinho', () => {
  assert.equal(deveTravarPorCredencial(500, 'tts_quota'), false);
  assert.equal(deveTravarPorCredencial(500, undefined), false);
  assert.equal(deveTravarPorCredencial(500, null), false);
});

/* ==========================================================================
   2. logDiagnosticoCredencialTts — diagnóstico seguro (item 4)
   ========================================================================== */

test('chave presente: chave_existe=sim, tamanho correto, sem trim', () => {
  const chave = 'x'.repeat(31);
  const logs = capturarLogs();
  logDiagnosticoCredencialTts(chave, 'voice-abc');
  const linha = logs.find((l) => l.includes('diagnostico_credencial'));
  assert.ok(linha);
  assert.match(linha, /chave_existe=sim/);
  assert.match(linha, /tamanho_da_chave=31/);
  assert.match(linha, /houve_trim=nao/);
});

test('chave ausente: chave_existe=nao, tamanho=0, sem crashar', () => {
  const logs = capturarLogs();
  logDiagnosticoCredencialTts('', 'voice-abc-diferente-1');
  const linha = logs.find((l) => l.includes('diagnostico_credencial'));
  assert.ok(linha);
  assert.match(linha, /chave_existe=nao/);
  assert.match(linha, /tamanho_da_chave=0/);
});

test('detecta trim (espaço/quebra de linha ao redor da chave)', () => {
  const logs = capturarLogs();
  logDiagnosticoCredencialTts('  chave-com-espaco-ao-redor  \n', 'voice-abc-diferente-2');
  const linha = logs.find((l) => l.includes('diagnostico_credencial'));
  assert.match(linha, /houve_trim=sim/);
});

test('inclui VERCEL_ENV no diagnóstico', () => {
  const original = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    const logs = capturarLogs();
    logDiagnosticoCredencialTts('chave-qualquer', 'voice-abc-diferente-3');
    const linha = logs.find((l) => l.includes('diagnostico_credencial'));
    assert.match(linha, /ambiente=production/);
  } finally {
    if (original === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = original;
  }
});

test('a chave NUNCA aparece no log — nem prefixo, nem sufixo, nem valor', () => {
  const chave = 'AIzaSyExemploDeChaveSecretaQueNaoDeveVazar123';
  const logs = capturarLogs();
  logDiagnosticoCredencialTts(chave, 'voice-abc-diferente-4');
  assert.equal(logs.some((l) => l.includes(chave)), false);
  // Nem um prefixo de 4 caracteres — mais estrito que o diagnóstico do
  // Google Places, por instrução explícita para este endpoint.
  assert.equal(logs.some((l) => l.includes(chave.slice(0, 4))), false);
});

test('throttle: mesma chave e mesmo voice_id não repetem o log', () => {
  const logs = capturarLogs();
  logDiagnosticoCredencialTts('chave-estavel', 'voice-estavel-1');
  logDiagnosticoCredencialTts('chave-estavel', 'voice-estavel-1');
  logDiagnosticoCredencialTts('chave-estavel', 'voice-estavel-1');
  const ocorrencias = logs.filter((l) => l.includes('diagnostico_credencial')).length;
  assert.equal(ocorrencias, 1);
});

test('throttle: voice_id mudando sozinho ainda dispara um novo log', () => {
  const logs = capturarLogs();
  logDiagnosticoCredencialTts('chave-estavel-2', 'voice-a');
  logDiagnosticoCredencialTts('chave-estavel-2', 'voice-b');
  const ocorrencias = logs.filter((l) => l.includes('diagnostico_credencial')).length;
  assert.equal(ocorrencias, 2);
});

/* ==========================================================================
   3. extrairDetalheElevenLabs — corpo de erro (item 5)
   ========================================================================== */

test('detail como objeto: extrai status e message', () => {
  const detalhe = extrairDetalheElevenLabs({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
  assert.equal(detalhe.status, 'invalid_api_key');
  assert.equal(detalhe.message, 'Invalid API key');
});

test('detail como string solta: vira message, status fica null', () => {
  const detalhe = extrairDetalheElevenLabs({ detail: 'algo deu errado' });
  assert.equal(detalhe.status, null);
  assert.equal(detalhe.message, 'algo deu errado');
});

test('corpo nulo, vazio ou sem "detail": nunca lança, devolve nulls', () => {
  assert.deepEqual(extrairDetalheElevenLabs(null), { status: null, message: null });
  assert.deepEqual(extrairDetalheElevenLabs(undefined), { status: null, message: null });
  assert.deepEqual(extrairDetalheElevenLabs({}), { status: null, message: null });
  assert.deepEqual(extrairDetalheElevenLabs('string solta'), { status: null, message: null });
  assert.deepEqual(extrairDetalheElevenLabs(42), { status: null, message: null });
});

test('detail.status/detail.message preservados exatamente como a ElevenLabs manda, sem reescrever', () => {
  const detalhe = extrairDetalheElevenLabs({
    detail: { status: 'invalid_api_key', message: 'The API key you used is invalid or has been revoked.' },
  });
  assert.equal(detalhe.status, 'invalid_api_key');
  assert.equal(detalhe.message, 'The API key you used is invalid or has been revoked.');
});

/* ==========================================================================
   4. montarRequisicaoElevenLabs — endpoint e header exatos (item 2/3/6)
   ========================================================================== */

test('URL é exatamente o endpoint de streaming documentado da ElevenLabs', () => {
  const { url } = montarRequisicaoElevenLabs('voice-123', 'chave-de-teste', 'olá');
  assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/voice-123/stream?output_format=mp3_22050_32');
});

test('header de autenticação é exatamente xi-api-key, nunca Authorization/Bearer', () => {
  const { opcoes } = montarRequisicaoElevenLabs('voice-123', 'chave-de-teste', 'olá');
  assert.equal(opcoes.headers['xi-api-key'], 'chave-de-teste');
  assert.equal('Authorization' in opcoes.headers, false);
});

test('método é POST', () => {
  const { opcoes } = montarRequisicaoElevenLabs('voice-123', 'chave-de-teste', 'olá');
  assert.equal(opcoes.method, 'POST');
});

test('corpo inclui text e model_id — eleven_flash_v2_5, fixo por decisão de produto', () => {
  const { opcoes } = montarRequisicaoElevenLabs('voice-123', 'chave-de-teste', 'olá, tudo bem?');
  const corpo = JSON.parse(opcoes.body);
  assert.equal(corpo.text, 'olá, tudo bem?');
  assert.equal(corpo.model_id, 'eleven_flash_v2_5');
});

test('voice_id vai codificado na URL (defesa contra caractere especial)', () => {
  const { url } = montarRequisicaoElevenLabs('voice/com espaço', 'chave', 'oi');
  assert.ok(url.includes(encodeURIComponent('voice/com espaço')));
  assert.equal(url.includes('voice/com espaço'), false);
});

test('a chave nunca aparece na URL — só no header', () => {
  const chave = 'chave-secreta-nao-deve-ir-pra-url';
  const { url } = montarRequisicaoElevenLabs('voice-123', chave, 'oi');
  assert.equal(url.includes(chave), false);
});

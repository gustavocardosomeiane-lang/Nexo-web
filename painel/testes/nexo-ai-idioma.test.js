/**
 * Testes do bug de mistura de idiomas na NEXO AI — investigação do
 * incidente em que a resposta final (Groq, openai/gpt-oss-20b) às vezes
 * inseria trechos em árabe no meio de uma explicação em português.
 *
 * CORREÇÃO EM DUAS RODADAS: a primeira versão bufferizava a resposta
 * inteira antes de mandar qualquer coisa ao cliente — segura, mas matava o
 * streaming progressivo. Esta versão preserva o streaming: uma pequena
 * MARGEM DE SEGURANÇA (`MARGEM_SEGURANCA_IDIOMA` caracteres) fica sempre
 * retida no fim do texto ainda não confirmado, e só o que já "sobrou pra
 * trás" da margem é liberado ao cliente — ver `proximoTrechoSeguro` em
 * shared/regras-nexo-ai.ts para a prova da invariante de segurança.
 *
 * Três camadas testadas:
 *   1. `contemCaracteresArabes` / `contarCaracteresArabes` / `usuarioPediuArabe`
 *      — detecção pura por Unicode, sem rede.
 *   2. `proximoTrechoSeguro` / `liberarRestante` — a janela de segurança em
 *      si, pura, sem rede.
 *   3. `gerarRespostaFinalSegura` (api/nexo-ai/conversar.ts) — a composição
 *      "streama filtrado -> detecta -> regenera no máximo 1x -> nunca vaza
 *      árabe pro cliente". `fetch` é sempre mockado; nenhuma chamada real
 *      ao Groq.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contemCaracteresArabes,
  contarCaracteresArabes,
  usuarioPediuArabe,
  proximoTrechoSeguro,
  liberarRestante,
  MARGEM_SEGURANCA_IDIOMA,
} from '../shared/regras-nexo-ai.ts';
import { gerarRespostaFinalSegura } from '../api/nexo-ai/conversar.ts';
import { ErroModelo } from '../api/_lib/nexo-ai/modelo.ts';

const fetchOriginal = global.fetch;
const consoleErrorOriginal = console.error;

test.beforeEach(() => {
  process.env.GROQ_API_KEY = 'chave-de-teste-nao-deve-vazar';
});

test.afterEach(() => {
  global.fetch = fetchOriginal;
  console.error = consoleErrorOriginal;
});

/* --------------------------------------------------------------------------
   Trecho árabe de exemplo — só DADO de teste, nunca instrução. String
   literal em `\uXXXX` seria mais "auditável" ainda, mas aqui é só um valor
   de teste (não faz parte do detector em si), então o literal serve.
   -------------------------------------------------------------------------- */
const TRECHO_ARABE = 'مرحبا'; // saudação comum, 5 caracteres

function capturarErros() {
  const linhas = [];
  console.error = (...args) => {
    linhas.push(args.join(' '));
  };
  return linhas;
}

/* ==========================================================================
   1. contemCaracteresArabes / contarCaracteresArabes / usuarioPediuArabe
   ========================================================================== */

test('texto normal em pt-BR não é detectado como árabe', () => {
  assert.equal(contemCaracteresArabes('Você tem 5 leads qualificados este mês.'), false);
  assert.equal(contarCaracteresArabes('Você tem 5 leads qualificados este mês.'), 0);
});

test('texto vazio ou nulo não quebra e não é detectado', () => {
  assert.equal(contemCaracteresArabes(''), false);
  assert.equal(contemCaracteresArabes(undefined), false);
  assert.equal(contemCaracteresArabes(null), false);
});

test('trecho árabe no meio da frase é detectado e contado', () => {
  const texto = `Você tem 5 leads qualificados ${TRECHO_ARABE} este mês.`;
  assert.equal(contemCaracteresArabes(texto), true);
  assert.equal(contarCaracteresArabes(texto), TRECHO_ARABE.length);
});

test('chamadas repetidas não vazam estado entre si (regex global com lastIndex)', () => {
  assert.equal(contemCaracteresArabes(TRECHO_ARABE), true);
  assert.equal(contemCaracteresArabes(TRECHO_ARABE), true);
  assert.equal(contemCaracteresArabes(TRECHO_ARABE), true);
});

test('BOM (U+FEFF, usado no export de CSV) não é falso positivo', () => {
  assert.equal(contemCaracteresArabes('﻿nome,telefone,cidade'), false);
});

test('nomes próprios, marcas e termos técnicos legítimos não disparam falso positivo', () => {
  const textos = [
    'A NEXO WEB entregou o site da Center Seg em 5 dias.',
    'O plano Profissional custa R$ 2.500 e inclui SEO avançado.',
    'TRAÇO Arquitetura e C2 Minds já têm site publicado.',
    'Envie a mensagem pelo WhatsApp ou pelo CRM.',
    'Métricas: CTR, CPA, ROI e LTV estão na aba Relatórios.',
  ];
  for (const t of textos) assert.equal(contemCaracteresArabes(t), false, `falso positivo em: "${t}"`);
});

test('mensagem normal em português não conta como pedido de árabe', () => {
  assert.equal(usuarioPediuArabe('quantos leads temos hoje?'), false);
});

test('usuário escrevendo em árabe conta como pedido explícito', () => {
  assert.equal(usuarioPediuArabe(TRECHO_ARABE), true);
});

test('pedido explícito em português ("em árabe", "fale em arabe") é reconhecido', () => {
  assert.equal(usuarioPediuArabe('responda em árabe, por favor'), true);
  assert.equal(usuarioPediuArabe('pode falar em arabe?'), true);
});

/* ==========================================================================
   2. proximoTrechoSeguro / liberarRestante — a janela de segurança
   ========================================================================== */

test('texto menor que a margem: nada é liberado ainda', () => {
  const passo = proximoTrechoSeguro('oi tudo bem', 0, 32);
  assert.equal(passo.trecho, '');
  assert.equal(passo.liberadoAte, 0);
  assert.equal(passo.bloqueado, false);
});

test('texto maior que a margem: libera só o que já "sobrou" para trás dela', () => {
  const texto = 'x'.repeat(50);
  const passo = proximoTrechoSeguro(texto, 0, 32);
  assert.equal(passo.trecho, 'x'.repeat(18)); // 50 - 32 = 18
  assert.equal(passo.liberadoAte, 18);
  assert.equal(passo.bloqueado, false);
});

test('chamadas sucessivas avançam incrementalmente, nunca repetem o que já foi liberado', () => {
  let liberadoAte = 0;
  const passo1 = proximoTrechoSeguro('x'.repeat(50), liberadoAte, 32);
  liberadoAte = passo1.liberadoAte;
  const passo2 = proximoTrechoSeguro('x'.repeat(50) + 'y'.repeat(20), liberadoAte, 32);
  assert.equal(passo2.trecho, 'x'.repeat(20)); // chars[18:38) do texto de 70 — ainda dentro do trecho de 'x'
  assert.equal(passo2.liberadoAte, 38);
});

test('sem margem explícita, usa o padrão de produção (MARGEM_SEGURANCA_IDIOMA)', () => {
  const texto = 'x'.repeat(MARGEM_SEGURANCA_IDIOMA + 10);
  const passo = proximoTrechoSeguro(texto, 0);
  assert.equal(passo.trecho, 'x'.repeat(10));
  assert.equal(passo.liberadoAte, 10);
});

test('árabe dentro da margem (ainda não liberável): bloqueia sem liberar nada', () => {
  const passo = proximoTrechoSeguro(TRECHO_ARABE, 0, 32); // 5 chars, bem dentro da margem de 32
  assert.equal(passo.trecho, '');
  assert.equal(passo.bloqueado, true);
});

test('árabe aparece só DEPOIS de trechos já liberados: o que já foi liberado nunca é desfeito', () => {
  let liberadoAte = 0;
  const passo1 = proximoTrechoSeguro('x'.repeat(50), liberadoAte, 32);
  liberadoAte = passo1.liberadoAte;
  assert.equal(passo1.bloqueado, false);

  const passo2 = proximoTrechoSeguro('x'.repeat(50) + TRECHO_ARABE, liberadoAte, 32);
  assert.equal(passo2.bloqueado, true);
  assert.equal(passo2.trecho, '', 'nada novo deve ser liberado no passo que detecta o árabe');
  assert.equal(passo2.liberadoAte, liberadoAte, 'o ponteiro não avança quando bloqueado');
});

test('liberarRestante devolve exatamente o que sobrou na margem, no fim do stream', () => {
  const texto = 'resposta completa em português';
  const liberadoAte = texto.length - 10;
  assert.equal(liberarRestante(texto, liberadoAte), texto.slice(-10));
});

/* ==========================================================================
   3. gerarRespostaFinalSegura — composição completa, com Groq mockado
   ========================================================================== */

function respostaSSE(eventos, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const corpo = new ReadableStream({
    start(controller) {
      for (const ev of eventos) controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body: corpo, json: async () => ({}) };
}

function chunkContent(texto) {
  return { choices: [{ index: 0, delta: { content: texto } }] };
}

function chunkFinal(finishReason) {
  return { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] };
}

const PEDIDO_BASE = { sistema: 'Você é a NEXO AI.', mensagens: [{ papel: 'user', conteudo: 'oi' }], etapa: 'resposta_final' };

function coletorDeChunks() {
  const partes = [];
  return { enviar: (t) => partes.push(t), partes, texto: () => partes.join('') };
}

test('resposta pt-BR normal continua chegando em STREAMING (vários chunks, não um só)', async () => {
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    return respostaSSE([
      chunkContent('Você tem 5 leads qualificados '.repeat(3)), // > margem, gera liberação incremental
      chunkContent('e 2 vendas fechadas este mês, '.repeat(3)),
      chunkFinal('stop'),
    ]);
  };
  const coletor = coletorDeChunks();

  const resultado = await gerarRespostaFinalSegura(PEDIDO_BASE, false, coletor.enviar);

  assert.equal(chamadas, 1, 'sem árabe, não deveria regenerar');
  assert.ok(coletor.partes.length >= 2, 'esperava mais de um chunk liberado ao cliente — prova de streaming progressivo');
  // `.trim()`: groqStream apara só o texto final devolvido para persistência
  // (ver modelo.ts) — os chunks BRUTOS transmitidos ao cliente preservam
  // espaço em branco de borda; é o mesmo comportamento de antes desta
  // correção, não uma regressão.
  assert.equal(coletor.texto().trim(), resultado.texto);
});

test('árabe detectado ANTES de qualquer envio (dentro da margem): regenera 1x, cliente só vê o texto limpo', async () => {
  let chamadas = 0;
  const corpos = [];
  global.fetch = async (url, opcoes) => {
    chamadas += 1;
    corpos.push(JSON.parse(opcoes.body));
    if (chamadas === 1) {
      // Curto o bastante pra nunca ultrapassar a margem — nada é liberado antes do bloqueio.
      return respostaSSE([chunkContent(`5 leads ${TRECHO_ARABE}`), chunkFinal('stop')]);
    }
    return respostaSSE([chunkContent('Você tem 5 leads qualificados este mês.'), chunkFinal('stop')]);
  };
  const coletor = coletorDeChunks();

  const resultado = await gerarRespostaFinalSegura(PEDIDO_BASE, false, coletor.enviar);

  assert.equal(chamadas, 2, 'deveria ter regenerado exatamente 1 vez');
  assert.equal(resultado.texto, 'Você tem 5 leads qualificados este mês.');
  assert.equal(coletor.texto(), 'Você tem 5 leads qualificados este mês.');
  assert.match(corpos[1].messages[0].content, /exclusivamente em português/i);
  assert.doesNotMatch(corpos[0].messages[0].content, /a resposta anterior misturou/i, 'a 1ª chamada nunca leva o reforço');
});

test('árabe aparece DEPOIS de parte da resposta já enviada: encerra no ponto limpo, NÃO regenera por cima', async () => {
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    // 100 + 20 = 120 chars limpos (> margem de 64, gera liberação incremental) seguidos de árabe.
    return respostaSSE([
      chunkContent('x'.repeat(100)),
      chunkContent('y'.repeat(20)),
      chunkContent(TRECHO_ARABE),
      chunkFinal('stop'),
    ]);
  };
  const coletor = coletorDeChunks();

  const resultado = await gerarRespostaFinalSegura(PEDIDO_BASE, false, coletor.enviar);

  assert.equal(chamadas, 1, 'já enviou parte da resposta — não regenera por cima (evita texto incoerente)');
  assert.equal(resultado.texto, 'x'.repeat(56)); // 120 - 64 (margem) = 56 chars liberados antes do bloqueio
  assert.equal(coletor.texto(), resultado.texto, 'o que foi enviado ao cliente é exatamente o texto final devolvido');
  assert.equal(coletor.texto().includes(TRECHO_ARABE), false);
});

test('árabe persiste mesmo após regeneração (sem nunca enviar nada): lança ErroModelo "idioma_incorreto", sem 3ª tentativa', async () => {
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    return respostaSSE([chunkContent(`curto ${TRECHO_ARABE}`), chunkFinal('stop')]);
  };
  const coletor = coletorDeChunks();

  await assert.rejects(
    () => gerarRespostaFinalSegura(PEDIDO_BASE, false, coletor.enviar),
    (erro) => {
      assert.ok(erro instanceof ErroModelo);
      assert.equal(erro.codigo, 'idioma_incorreto');
      return true;
    },
  );
  assert.equal(chamadas, 2, 'no máximo 1 regeneração — nunca uma 3ª chamada');
  assert.equal(coletor.partes.length, 0, 'nada deveria ter sido enviado ao cliente');
});

test('regeneração falha por erro de rede: mesmo assim vira "idioma_incorreto", sem 3ª tentativa', async () => {
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    if (chamadas === 1) return respostaSSE([chunkContent(`curto ${TRECHO_ARABE}`), chunkFinal('stop')]);
    throw new TypeError('fetch failed');
  };

  await assert.rejects(
    () => gerarRespostaFinalSegura(PEDIDO_BASE, false, () => {}),
    (erro) => {
      assert.ok(erro instanceof ErroModelo);
      assert.equal(erro.codigo, 'idioma_incorreto');
      return true;
    },
  );
  assert.equal(chamadas, 2);
});

test('usuário pediu árabe explicitamente: streaming normal, árabe passa, SEM regeneração', async () => {
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    return respostaSSE([
      chunkContent(`${TRECHO_ARABE} — `),
      chunkContent('resposta legítima no idioma pedido'),
      chunkFinal('stop'),
    ]);
  };
  const coletor = coletorDeChunks();

  const resultado = await gerarRespostaFinalSegura(PEDIDO_BASE, true, coletor.enviar);

  assert.equal(chamadas, 1, 'permiteArabe=true não deve disparar regeneração nenhuma');
  assert.match(resultado.texto, new RegExp(TRECHO_ARABE));
  assert.equal(coletor.partes.length >= 2, true, 'continua em streaming normal, sem filtro nenhum');
});

test('nunca vaza árabe: em nenhum cenário bloqueado o texto árabe aparece no que foi enviado ao cliente', async () => {
  // Cenário "antes do envio" (bloqueado_sem_envio na regeneração também).
  global.fetch = async () => respostaSSE([chunkContent(`x ${TRECHO_ARABE} y`), chunkFinal('stop')]);
  const coletor1 = coletorDeChunks();
  await assert.rejects(() => gerarRespostaFinalSegura(PEDIDO_BASE, false, coletor1.enviar));
  assert.equal(coletor1.texto().includes(TRECHO_ARABE), false);

  // Cenário "depois de parte enviada" — precisa passar da margem de 64 antes do árabe.
  global.fetch = async () =>
    respostaSSE([chunkContent('x'.repeat(100)), chunkContent(TRECHO_ARABE), chunkFinal('stop')]);
  const coletor2 = coletorDeChunks();
  await gerarRespostaFinalSegura(PEDIDO_BASE, false, coletor2.enviar);
  assert.equal(coletor2.texto().includes(TRECHO_ARABE), false);
});

test('log de diagnóstico não expõe o texto árabe — só motivo e tamanhos', async () => {
  global.fetch = async () => respostaSSE([chunkContent(`segredo-de-teste ${TRECHO_ARABE}`), chunkFinal('stop')]);
  const logs = capturarErros();

  await assert.rejects(() => gerarRespostaFinalSegura(PEDIDO_BASE, false, () => {}));

  const vazou = logs.some((l) => l.includes(TRECHO_ARABE) || l.includes('segredo-de-teste'));
  assert.equal(vazou, false);
  assert.ok(logs.some((l) => l.includes('idioma_incorreto')), 'esperava log de diagnóstico do bloqueio');
});

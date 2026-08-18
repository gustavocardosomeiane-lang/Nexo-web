/**
 * Segmentação de fala — streaming de texto do Groq para TTS incremental.
 *
 * Pura, sem rede: garante que o corte de frases forma blocos de ~80–160
 * caracteres (poucas chamadas de TTS, evitando a rajada que estourou a
 * quota da Gemini em produção) sem perder texto nem quebrar palavra/frase
 * no meio, mesmo quando o streaming entrega chunk partido.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentarParaFala, finalizarSegmentacao } from '../shared/regras-nexo-ai.ts';

test('1 frase curta: não fecha sozinha (abaixo do alvo mínimo de 80) — espera acumular', () => {
  const r = segmentarParaFala('', 'Temos 42 leads qualificados.');
  assert.deepEqual(r.segmentos, []);
  assert.equal(r.restante, 'Temos 42 leads qualificados.');
});

test('1 frase curta isolada no fim da resposta ainda é falada, via finalizarSegmentacao', () => {
  const r = segmentarParaFala('', 'Ok.');
  assert.deepEqual(r.segmentos, []);
  assert.equal(finalizarSegmentacao(r.restante), 'Ok.');
});

test('várias frases curtas se juntam até atingir o alvo mínimo — não uma chamada de TTS por frase', () => {
  let buffer = '';
  const acumulados = [];
  const chunks = [
    'Ok. ',
    'Certo. ',
    'Vou verificar os leads qualificados que estão registrados no sistema agora mesmo para você, só um instante.',
  ];
  for (const chunk of chunks) {
    const r = segmentarParaFala(buffer, chunk);
    acumulados.push(...r.segmentos);
    buffer = r.restante;
  }
  // As duas frases curtas ("Ok.", "Certo.") não geraram segmento sozinhas —
  // só quando o bloco cruzou o alvo mínimo é que fechou, com as três juntas.
  assert.equal(acumulados.length, 1);
  assert.equal(acumulados[0], chunks.join('').trim());
  assert.ok(acumulados[0].length >= 80, `bloco deveria ter cruzado o alvo mínimo: ${acumulados[0].length} chars`);
  assert.ok(acumulados[0].startsWith('Ok. Certo.'), 'as frases curtas ficaram no início do bloco agrupado, não sozinhas');
});

test('resposta longa: cada bloco fica dentro da faixa de ~80-160 caracteres', () => {
  const frase = 'Isso é uma frase de tamanho médio para testar agrupamento de blocos. ';
  let buffer = '';
  const segmentos = [];
  for (let i = 0; i < 10; i++) {
    const r = segmentarParaFala(buffer, frase);
    segmentos.push(...r.segmentos);
    buffer = r.restante;
  }
  assert.ok(segmentos.length >= 3, 'resposta longa deve gerar vários blocos, não um só');
  for (const seg of segmentos) {
    assert.ok(seg.length >= 80 && seg.length <= 220, `bloco fora da faixa esperada (${seg.length} chars): "${seg}"`);
  }
});

test('agrupamento 80-160: bloco fecha assim que cruza o alvo mínimo, não antes nem muito depois', () => {
  // "Primeira parte." (15) + "Segunda parte um pouco mais longa para completar o bloco." (59) = 74, ainda < 80.
  const r1 = segmentarParaFala('', 'Primeira parte. Segunda parte um pouco mais longa para completar o bloco.');
  assert.deepEqual(r1.segmentos, []);

  // + "Terceira parte fecha." (21) -> 74+1+21=96, cruza o alvo mínimo de 80.
  const r2 = segmentarParaFala(r1.restante, ' Terceira parte fecha.');
  assert.equal(r2.segmentos.length, 1);
  assert.ok(r2.segmentos[0].length >= 80);
  assert.ok(r2.segmentos[0].length <= 160);
});

test('sem pontuação nenhuma por muito tempo: corta no teto (ALVO_MAXIMO), no espaço, nunca no meio da palavra', () => {
  const textoLongo = 'lorem '.repeat(50); // bem acima do teto, sem nenhuma pontuação final
  const r = segmentarParaFala('', textoLongo);
  assert.ok(r.segmentos.length >= 1);
  for (const seg of r.segmentos) {
    assert.ok(seg.length <= 165, `bloco de corte de segurança maior que o esperado: ${seg.length}`);
    assert.ok(seg.trim().split(/\s+/).every((p) => p === 'lorem'), `segmento com fragmento de palavra: "${seg}"`);
  }
});

test('chunk quebra uma palavra no meio: o corte só considera o texto depois de a palavra se completar', () => {
  let buffer = '';
  const r1 = segmentarParaFala(buffer, 'Isso é uma frase de tamanho médio que ainda não fechou pontuação nenhuma e continua com uma palavra corta');
  buffer = r1.restante;
  assert.deepEqual(r1.segmentos, []); // sem pontuação ainda, buffer < ALVO_MAXIMO

  const r2 = segmentarParaFala(buffer, 'da.');
  assert.equal(r2.segmentos.length, 1);
  assert.ok(r2.segmentos[0].endsWith('cortada.'));
  assert.equal(r2.restante, '');
});

test('pontuação chegando sozinha num chunk separado ainda fecha o bloco certo', () => {
  const textoBase = 'Esta é uma frase razoavelmente longa para passar do alvo mínimo de oitenta caracteres';
  let buffer = '';
  const r1 = segmentarParaFala(buffer, textoBase);
  buffer = r1.restante;
  assert.deepEqual(r1.segmentos, []);

  const r2 = segmentarParaFala(buffer, '.');
  assert.deepEqual(r2.segmentos, [`${textoBase}.`]);
  assert.equal(r2.restante, '');
});

test('ordem preservada e nenhum trecho duplicado ao longo de vários chunks', () => {
  let buffer = '';
  const acumulados = [];
  const chunks = [
    'Temos 42 leads qualificados. ',
    'Destes, 18 já foram contatados pela nossa equipe de vendas. ',
    'O restante ainda está no funil aguardando qualificação. ',
    'Recomendo priorizar os leads mais recentes primeiro.',
  ];
  for (const chunk of chunks) {
    const r = segmentarParaFala(buffer, chunk);
    acumulados.push(...r.segmentos);
    buffer = r.restante;
  }
  const ultimo = finalizarSegmentacao(buffer);
  if (ultimo) acumulados.push(ultimo);

  const textoReconstruido = acumulados.join(' ').replace(/\s+/g, ' ').trim();
  const textoOriginal = chunks.join('').replace(/\s+/g, ' ').trim();
  assert.equal(textoReconstruido, textoOriginal, 'reconstrução dos blocos deve bater com o texto original, sem perder nem duplicar nada');

  // nenhum bloco aparece mais de uma vez
  assert.equal(new Set(acumulados).size, acumulados.length);
});

test('último bloco sem pontuação, mesmo curto, é falado no fim via finalizarSegmentacao', () => {
  const r = segmentarParaFala('', 'Aqui está o resumo');
  assert.deepEqual(r.segmentos, []);
  assert.equal(finalizarSegmentacao(r.restante), 'Aqui está o resumo');
});

test('finalizarSegmentacao devolve null quando não sobrou nada além de espaço', () => {
  assert.equal(finalizarSegmentacao(''), null);
  assert.equal(finalizarSegmentacao('   '), null);
});

test('buffer vazio e chunk vazio não produzem segmento nenhum', () => {
  const r = segmentarParaFala('', '');
  assert.deepEqual(r.segmentos, []);
  assert.equal(r.restante, '');
});

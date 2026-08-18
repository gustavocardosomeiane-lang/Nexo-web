/**
 * Segmentação de fala — streaming de texto do Groq para TTS incremental.
 *
 * Pura, sem rede: garante que o corte de frases funciona mesmo quando o
 * streaming quebra chunk no meio de palavra ou de pontuação, sem duplicar
 * nem perder texto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentarParaFala, finalizarSegmentacao } from '../shared/regras-nexo-ai.ts';

test('resposta de uma frase: fecha e fala assim que pontua', () => {
  const r = segmentarParaFala('', 'Temos 42 leads qualificados.');
  assert.deepEqual(r.segmentos, ['Temos 42 leads qualificados.']);
  assert.equal(r.restante, '');
});

test('resposta de várias frases: cada uma vira um segmento, na ordem', () => {
  const r = segmentarParaFala(
    '',
    'Temos 42 leads qualificados. Destes, 18 já foram contatados. O restante está no funil.',
  );
  assert.deepEqual(r.segmentos, [
    'Temos 42 leads qualificados.',
    'Destes, 18 já foram contatados.',
    'O restante está no funil.',
  ]);
  assert.equal(r.restante, '');
});

test('resposta longa sem pontuação: corta no espaço antes do limite de segurança, nunca no meio de uma palavra', () => {
  const palavra = 'lorem ';
  const textoLongo = palavra.repeat(50); // bem acima de 220 caracteres, sem nenhuma pontuação final
  const r = segmentarParaFala('', textoLongo);
  assert.ok(r.segmentos.length >= 1);
  for (const seg of r.segmentos) {
    assert.ok(!seg.endsWith('lore'), `segmento não pode cortar palavra no meio: "${seg}"`);
    assert.ok(seg.trim().split(/\s+/).every((p) => p === 'lorem'), `segmento com fragmento de palavra: "${seg}"`);
  }
});

test('chunk quebra uma palavra no meio: o corte só acontece depois que a palavra se completa no buffer concatenado', () => {
  let buffer = '';
  const r1 = segmentarParaFala(buffer, 'Temos 42 leads qualificado');
  buffer = r1.restante;
  assert.deepEqual(r1.segmentos, []); // ainda não fechou frase (sem pontuação)

  const r2 = segmentarParaFala(buffer, 's. Destes, 18...');
  assert.deepEqual(r2.segmentos, ['Temos 42 leads qualificados.']);
  assert.equal(r2.restante, ' Destes, 18...');
});

test('pontuação chegando sozinha num chunk separado ainda fecha o segmento certo', () => {
  let buffer = '';
  const r1 = segmentarParaFala(buffer, 'Temos 42 leads qualificados');
  buffer = r1.restante;
  assert.deepEqual(r1.segmentos, []);

  const r2 = segmentarParaFala(buffer, '.');
  assert.deepEqual(r2.segmentos, ['Temos 42 leads qualificados.']);
  assert.equal(r2.restante, '');
});

test('primeiro bloco não duplica: o texto consumido não aparece de novo no restante nem em segmentos seguintes', () => {
  let buffer = '';
  const acumulados = [];
  for (const chunk of ['Temos 42 leads', ' qualificados.', ' Destes, 18 já', ' foram contatados.']) {
    const r = segmentarParaFala(buffer, chunk);
    acumulados.push(...r.segmentos);
    buffer = r.restante;
  }
  assert.deepEqual(acumulados, ['Temos 42 leads qualificados.', 'Destes, 18 já foram contatados.']);
  // nenhum texto de um segmento já emitido reaparece no que sobrou
  assert.equal(buffer.includes('qualificados'), false);
});

test('frase curta demais (menor que o piso) não fecha sozinha — espera acumular com a próxima', () => {
  const r = segmentarParaFala('', 'Ok.');
  assert.deepEqual(r.segmentos, []);
  assert.equal(r.restante, 'Ok.');
});

test('frase curta se junta com a próxima até atingir o piso mínimo', () => {
  let buffer = '';
  const r1 = segmentarParaFala(buffer, 'Ok. ');
  buffer = r1.restante;
  assert.deepEqual(r1.segmentos, []);

  const r2 = segmentarParaFala(buffer, 'Vou verificar os leads agora.');
  assert.deepEqual(r2.segmentos, ['Ok. Vou verificar os leads agora.']);
});

test('último bloco sem pontuação é falado no fim, via finalizarSegmentacao', () => {
  const r = segmentarParaFala('', 'Aqui está o resumo que você pediu');
  assert.deepEqual(r.segmentos, []);
  assert.equal(finalizarSegmentacao(r.restante), 'Aqui está o resumo que você pediu');
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

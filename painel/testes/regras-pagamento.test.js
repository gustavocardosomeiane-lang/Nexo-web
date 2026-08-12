/**
 * Testes das regras de pagamento.
 *
 * Rodam no test runner nativo do Node (`node --test`), sem framework. Cobrem a
 * lógica que decide dinheiro — a parte onde um erro custa caro e não aparece
 * na tela até ser tarde.
 *
 *   npm run testar --prefix painel
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarEventoAsaas,
  efeitoNoPagamento,
  formatarBRL,
  notificacaoDoEvento,
  statusDaVenda,
} from '../shared/regras-pagamento.ts';

/* ==========================================================================
   Classificação dos eventos do Asaas
   ========================================================================== */

test('evento de pagamento recebido vira "aprovado"', () => {
  assert.deepEqual(classificarEventoAsaas('PAYMENT_RECEIVED'), {
    desconhecido: false,
    tipo: 'pagamento.aprovado',
  });
  assert.deepEqual(classificarEventoAsaas('PAYMENT_CONFIRMED'), {
    desconhecido: false,
    tipo: 'pagamento.aprovado',
  });
});

test('evento informativo é conhecido, mas não mexe em estado', () => {
  const r = classificarEventoAsaas('PAYMENT_UPDATED');
  assert.equal(r.desconhecido, false);
  assert.equal(r.tipo, null);
});

test('evento desconhecido é sinalizado em vez de adivinhado', () => {
  // O ponto do teste: um evento novo do Asaas NUNCA pode ser tratado como
  // aprovação por engano. Ele tem que sair marcado como desconhecido.
  const r = classificarEventoAsaas('PAYMENT_ALGUMA_COISA_NOVA');
  assert.equal(r.desconhecido, true);
  assert.equal(r.tipo, null);
});

test('cartão recusado não quita: a cobrança segue em aberto', () => {
  const { tipo } = classificarEventoAsaas('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED');
  assert.equal(tipo, 'pagamento.recusado');
  assert.equal(efeitoNoPagamento(tipo), 'pendente');
});

test('estorno leva o pagamento para reembolsado', () => {
  const { tipo } = classificarEventoAsaas('PAYMENT_REFUNDED');
  assert.equal(efeitoNoPagamento(tipo), 'reembolsado');
});

test('exclusão de cobrança cancela o pagamento', () => {
  const { tipo } = classificarEventoAsaas('PAYMENT_DELETED');
  assert.equal(efeitoNoPagamento(tipo), 'cancelado');
});

test('"pagamento.criado" registra mas não altera estado', () => {
  assert.equal(efeitoNoPagamento('pagamento.criado'), null);
});

/* ==========================================================================
   Status da venda, derivado das parcelas
   ========================================================================== */

const p = (status) => ({ status });

test('venda sem parcela nenhuma mantém o status atual', () => {
  assert.equal(statusDaVenda([], 'orcamento'), 'orcamento');
});

test('nenhuma parcela paga: orçamento vira aguardando pagamento', () => {
  assert.equal(statusDaVenda([p('pendente'), p('pendente')], 'orcamento'), 'aguardando_pagamento');
});

test('uma de três pagas = parcialmente pago', () => {
  assert.equal(
    statusDaVenda([p('pago'), p('pendente'), p('pendente')], 'aguardando_pagamento'),
    'parcialmente_pago',
  );
});

test('todas pagas = pago', () => {
  assert.equal(statusDaVenda([p('pago'), p('pago')], 'parcialmente_pago'), 'pago');
});

test('venda só é "paga" quando NENHUMA parcela ficou em aberto', () => {
  // A regra que impede o pior erro possível: dar a venda por quitada com
  // parcela em aberto.
  const quase = [p('pago'), p('pago'), p('atrasado')];
  assert.notEqual(statusDaVenda(quase, 'parcialmente_pago'), 'pago');
  assert.equal(statusDaVenda(quase, 'parcialmente_pago'), 'parcialmente_pago');
});

test('todas reembolsadas = reembolsado', () => {
  assert.equal(statusDaVenda([p('reembolsado'), p('reembolsado')], 'pago'), 'reembolsado');
});

test('reembolso parcial não vira reembolso total', () => {
  assert.equal(statusDaVenda([p('reembolsado'), p('pago')], 'pago'), 'parcialmente_pago');
});

test('todas canceladas = cancelado', () => {
  assert.equal(statusDaVenda([p('cancelado'), p('cancelado')], 'aguardando_pagamento'), 'cancelado');
});

test('parcela atrasada não regride uma venda já parcialmente paga', () => {
  assert.equal(statusDaVenda([p('pago'), p('atrasado')], 'parcialmente_pago'), 'parcialmente_pago');
});

/* ==========================================================================
   Notificações
   ========================================================================== */

test('aprovação gera notificação de sucesso', () => {
  const n = notificacaoDoEvento('pagamento.aprovado');
  assert.equal(n.tipo, 'pagamento_aprovado');
  assert.equal(n.severidade, 'sucesso');
});

test('recusa gera notificação de erro', () => {
  assert.equal(notificacaoDoEvento('pagamento.recusado').severidade, 'erro');
});

test('criação de cobrança não gera notificação', () => {
  assert.equal(notificacaoDoEvento('pagamento.criado'), null);
});

/* ==========================================================================
   Formatação de dinheiro
   ========================================================================== */

test('formata centavos em BRL com separador de milhar', () => {
  assert.equal(formatarBRL(140000), 'R$ 1.400,00');
  assert.equal(formatarBRL(250000), 'R$ 2.500,00');
  assert.equal(formatarBRL(1), 'R$ 0,01');
  assert.equal(formatarBRL(0), 'R$ 0,00');
  assert.equal(formatarBRL(123456789), 'R$ 1.234.567,89');
});

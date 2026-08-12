/**
 * Testes das travas de disparo.
 *
 * Aqui mora o risco de reputação: disparar para quem não pediu, ou disparar
 * duas vezes para a mesma pessoa. Cada teste abaixo corresponde a uma trava
 * descrita em `src/integrations/ninjabot/campanhas.ts`.
 *
 * Testa as funções PURAS (avaliação de público e montagem de mensagem). O que
 * depende de banco é exercido no navegador — ver o relatório.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarPublico, montarMensagem, resumirCampanha } from '../shared/regras-campanha.ts';

/* --------------------------------------------------------------------------
   Fábricas
   -------------------------------------------------------------------------- */

let contador = 0;
function lead(sobrescrever = {}) {
  contador += 1;
  return {
    id: `lead-${contador}`,
    nome: 'Ana Beatriz Souza',
    empresa: 'Padaria Grão Dourado',
    telefone: '5562984747979',
    whatsapp: '5562984747979',
    email: null,
    origem: 'site',
    tags: ['tag-comercio'],
    nao_contatar: false,
    campanha: null,
    data_entrada: '2026-08-01',
    responsavel_id: null,
    status: 'novo',
    observacoes: null,
    ultima_interacao: null,
    proxima_acao: null,
    proxima_acao_em: null,
    valor_potencial: null,
    servico_interesse_id: null,
    cliente_id: null,
    criado_em: '2026-08-01T10:00:00.000Z',
    atualizado_em: '2026-08-01T10:00:00.000Z',
    ...sobrescrever,
  };
}

const vazio = { jaNaCampanha: new Set(), emCarencia: new Set() };
const campanha = { tag: 'tag-comercio' };

const so = (leads, contexto = vazio) => avaliarPublico(leads, campanha, contexto)[0];

/* ==========================================================================
   Trava 1 — público fechado pela tag
   ========================================================================== */

test('lead com a tag da campanha é elegível', () => {
  assert.equal(so([lead()]).elegivel, true);
});

test('lead SEM a tag da campanha nunca entra', () => {
  const r = so([lead({ tags: ['tag-clinicas'] })]);
  assert.equal(r.elegivel, false);
  assert.equal(r.motivo, 'fora_da_tag');
});

test('lead sem tag nenhuma nunca entra', () => {
  assert.equal(so([lead({ tags: [] })]).motivo, 'fora_da_tag');
});

test('lead com várias tags entra se uma delas for a da campanha', () => {
  assert.equal(so([lead({ tags: ['tag-sem-site', 'tag-comercio'] })]).elegivel, true);
});

/* ==========================================================================
   Trava 2 — não contatar
   ========================================================================== */

test('"não contatar" bloqueia mesmo com a tag correta', () => {
  const r = so([lead({ nao_contatar: true })]);
  assert.equal(r.elegivel, false);
  assert.equal(r.motivo, 'nao_contatar');
});

test('"não contatar" tem prioridade sobre qualquer outro critério', () => {
  // Um contato pessoal marcado assim não pode escapar por nenhuma combinação.
  const r = so([lead({ nao_contatar: true, status: 'qualificado', valor_potencial: 500000 })]);
  assert.equal(r.motivo, 'nao_contatar');
});

/* ==========================================================================
   Trava 3 — não repetir dentro da campanha
   ========================================================================== */

test('lead já na campanha não entra de novo', () => {
  const l = lead();
  const r = so([l], { jaNaCampanha: new Set([l.id]), emCarencia: new Set() });
  assert.equal(r.elegivel, false);
  assert.equal(r.motivo, 'ja_na_campanha');
});

/* ==========================================================================
   Trava 4 — carência global
   ========================================================================== */

test('lead contatado recentemente por outra campanha fica de fora', () => {
  const l = lead();
  const r = so([l], { jaNaCampanha: new Set(), emCarencia: new Set([l.id]) });
  assert.equal(r.elegivel, false);
  assert.equal(r.motivo, 'em_carencia');
});

/* ==========================================================================
   Outros critérios
   ========================================================================== */

test('quem já é cliente não recebe prospecção', () => {
  assert.equal(so([lead({ status: 'cliente' })]).motivo, 'ja_cliente');
});

test('lead sem telefone nem whatsapp fica de fora', () => {
  assert.equal(so([lead({ whatsapp: null, telefone: null })]).motivo, 'sem_whatsapp');
});

test('telefone sem whatsapp ainda serve', () => {
  assert.equal(so([lead({ whatsapp: null, telefone: '5562984747979' })]).elegivel, true);
});

test('avalia a lista inteira e separa elegíveis de excluídos', () => {
  const leads = [
    lead(),
    lead({ nao_contatar: true }),
    lead({ tags: ['outra'] }),
    lead({ status: 'cliente' }),
    lead(),
  ];
  const r = avaliarPublico(leads, campanha, vazio);
  assert.equal(r.filter((x) => x.elegivel).length, 2);
  assert.equal(r.filter((x) => !x.elegivel).length, 3);
});

/* ==========================================================================
   Montagem da mensagem
   ========================================================================== */

test('substitui nome, primeiro nome e empresa', () => {
  const texto = montarMensagem('Oi {{primeiro_nome}}, aqui é sobre a {{empresa}}. Certo, {{nome}}?', lead());
  assert.equal(texto, 'Oi Ana, aqui é sobre a Padaria Grão Dourado. Certo, Ana Beatriz Souza?');
});

test('empresa vazia não deixa "undefined" na mensagem', () => {
  const texto = montarMensagem('Olá {{primeiro_nome}} da {{empresa}}!', lead({ empresa: null }));
  assert.ok(!texto.includes('undefined'));
  assert.ok(!texto.includes('{{'));
});

test('aceita variação de espaço e maiúscula na variável', () => {
  assert.equal(montarMensagem('Oi {{ PRIMEIRO_NOME }}', lead()), 'Oi Ana');
});

test('modelo sem variável passa intacto', () => {
  assert.equal(montarMensagem('Mensagem fixa.', lead()), 'Mensagem fixa.');
});

/* ==========================================================================
   Resumo
   ========================================================================== */

const alvo = (status) => ({ status });

test('taxa de resposta considera enviados + respondidos como base', () => {
  const r = resumirCampanha([
    alvo('enviado'),
    alvo('enviado'),
    alvo('enviado'),
    alvo('respondido'),
    alvo('pendente'),
  ]);
  assert.equal(r.total, 5);
  assert.equal(r.pendentes, 1);
  assert.equal(r.enviados, 3);
  assert.equal(r.respondidos, 1);
  // 1 resposta em 4 contatados = 25%. Pendente não entra na conta.
  assert.equal(r.taxa_resposta, 25);
});

test('campanha sem contato feito tem taxa zero, sem divisão por zero', () => {
  const r = resumirCampanha([alvo('pendente'), alvo('pendente')]);
  assert.equal(r.taxa_resposta, 0);
});

test('ignorados e falhas são contados à parte', () => {
  const r = resumirCampanha([alvo('ignorado'), alvo('falhou'), alvo('enviado')]);
  assert.equal(r.ignorados, 1);
  assert.equal(r.falhas, 1);
  assert.equal(r.taxa_resposta, 0);
});

/**
 * DIAGNÓSTICO — "me chama de Iong" não voltou numa conversa nova.
 *
 * ATUALIZAÇÃO: o banco confirmou que a memória real em produção tem
 * `relevancia=0.9` — ACIMA do limiar antigo (0.85). Ou seja, para ESTE
 * caso específico a causa NÃO era relevância baixa (a hipótese original,
 * ainda coberta abaixo porque continua sendo um risco real para memórias
 * futuras com relevância mais baixa). A pergunta que sobrou era: será que
 * `selecionarMemorias`/`camadaMemorias` de fato incluem uma memória com
 * essa forma exata (chaves=["nome_preferido"], relevancia=0.9, ativo=true,
 * tipo="preferencia") quando a pergunta é "Bom dia" (zero palavras em
 * comum)?
 *
 * RESPOSTA (provada pelos testes abaixo): SIM — a lógica pura de
 * `selecionarMemorias` já incluía essa memória exata mesmo ANTES da
 * correção desta rodada (via `relevancia >= 0.85`). Ou seja, se
 * `carregarMemorias` (a consulta ao Supabase) realmente devolveu essa
 * linha pro código, ela chegava ao prompt corretamente.
 *
 * ISSO DEIXA UM RISCO EM ABERTO, não coberto por teste (não dá pra testar
 * uma chamada de rede real neste projeto): se `carregarMemorias` não
 * devolveu a linha por algum motivo na consulta ao Supabase (ex.: cache de
 * schema do PostgREST desatualizado logo depois da migration 004, que
 * faria `.eq('ativo', true)` falhar silenciosamente — `carregarMemorias`
 * ignora `error` de propósito e cai pra lista vazia), NENHUMA correção de
 * lógica de seleção resolve isso. Ver o relatório da conversa para o
 * encaminhamento.
 *
 * CORREÇÃO DESTA RODADA: "core" não depende mais só de relevância
 * numérica — chaves estruturais (nome_preferido, forma_tratamento, idioma,
 * preferencia_comunicacao) são SEMPRE core, mesmo com relevância baixa ou
 * ausente. Reforça o caso relatado e cobre o caso em que o modelo manda um
 * número de importância mais baixo no futuro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { selecionarMemorias, normalizarExtracaoMemoria } from '../shared/regras-nexo-ai.ts';
import { camadaMemorias } from '../api/_lib/nexo-ai/persona.ts';

function memoriaNomePreferido(sobrescrever = {}) {
  return {
    id: 'mem-nome-preferido',
    tipo: 'preferencia',
    conteudo: 'Prefere ser chamado de Iong',
    chaves: ['nome_preferido'],
    relevancia: 0.9,
    usuario_id: 'user-1',
    ativo: true,
    ...sobrescrever,
  };
}

/* ==========================================================================
   1/2 — Reprodução EXATA do cenário confirmado pelo banco:
   chaves=["nome_preferido"], relevancia=0.9, ativo=true, pergunta="Bom dia"
   ========================================================================== */

test('carregarMemorias -> selecionarMemorias: a memória real (relevancia=0.9) É selecionada para "Bom dia"', () => {
  // Formato exatamente como carregarMemorias devolveria (api/nexo-ai/conversar.ts)
  // se a consulta ao Supabase retornar a linha confirmada no banco.
  const memoriasDoUsuario = [memoriaNomePreferido()];
  const selecionadas = selecionarMemorias(memoriasDoUsuario, 'Bom dia');
  assert.equal(selecionadas.length, 1);
  assert.equal(selecionadas[0].id, 'mem-nome-preferido');
});

test('selecionarMemorias -> camadaMemorias: o conteúdo real ("Prefere ser chamado de Iong") chega ao texto do system prompt', () => {
  const selecionadas = selecionarMemorias([memoriaNomePreferido()], 'Bom dia');
  const prompt = camadaMemorias(selecionadas);
  assert.match(prompt, /Prefere ser chamado de Iong/);
});

test('CONCLUSÃO: com os dados exatos confirmados no banco, a lógica pura (seleção + prompt) SEMPRE incluiria a memória — não é aqui que o caminho quebra', () => {
  const selecionadas = selecionarMemorias([memoriaNomePreferido()], 'Bom dia');
  const prompt = camadaMemorias(selecionadas);
  assert.equal(selecionadas.length, 1);
  assert.ok(prompt.length > 0);
});

/* ==========================================================================
   3 — Correção: chaves estruturais são core independente de relevância
   ========================================================================== */

test('nome_preferido com relevância BAIXA (0.3) agora também é core — não depende só do limiar numérico', () => {
  const selecionadas = selecionarMemorias([memoriaNomePreferido({ relevancia: 0.3 })], 'Bom dia');
  assert.equal(selecionadas.length, 1, 'antes da correção desta rodada, isto FALHAVA — era exatamente o risco apontado no diagnóstico anterior');
});

test('nome_preferido SEM relevância nenhuma (undefined) ainda é core, pela chave', () => {
  const memoria = memoriaNomePreferido({ relevancia: undefined });
  const selecionadas = selecionarMemorias([memoria], 'Bom dia');
  assert.equal(selecionadas.length, 1);
});

test('as outras 3 chaves estruturais pedidas (forma_tratamento, idioma, preferencia_comunicacao) também são core, mesmo com relevância baixa', () => {
  const casos = [
    { tipo: 'preferencia', chaves: ['forma_tratamento'], conteudo: 'Prefere tratamento informal, sem "senhor"' },
    { tipo: 'preferencia', chaves: ['idioma'], conteudo: 'Prefere respostas em português, mesmo em termos técnicos' },
    { tipo: 'preferencia', chaves: ['preferencia_comunicacao'], conteudo: 'Prefere respostas curtas e diretas' },
  ];
  for (const caso of casos) {
    const memoria = { id: 'x', relevancia: 0.2, usuario_id: 'user-1', ativo: true, ...caso };
    const selecionadas = selecionarMemorias([memoria], 'Bom dia');
    assert.equal(selecionadas.length, 1, `chave "${caso.chaves[0]}" deveria ser core mesmo com relevância 0.2`);
  }
});

test('chave estrutural com variação de acento/caixa (ex.: "Nome Preferido") ainda é reconhecida como core, via normalizarChave', () => {
  const memoria = memoriaNomePreferido({ relevancia: 0.1, chaves: ['Nome Preferido'] });
  const selecionadas = selecionarMemorias([memoria], 'Bom dia');
  assert.equal(selecionadas.length, 1);
});

test('chave qualquer, NÃO estrutural, com relevância baixa, continua de fora (a trava não virou um passe livre geral)', () => {
  const memoria = { id: 'x', tipo: 'fato', chaves: ['detalhe_qualquer_do_projeto_x'], conteudo: 'Algo pontual', relevancia: 0.2, usuario_id: 'user-1', ativo: true };
  const selecionadas = selecionarMemorias([memoria], 'Bom dia');
  assert.equal(selecionadas.length, 0);
});

/* ==========================================================================
   4 — camadaMemorias reforçada
   ========================================================================== */

test('camadaMemorias agora inclui instrução explícita de uso natural e respeito à preferência atual', () => {
  const prompt = camadaMemorias([memoriaNomePreferido()]);
  assert.match(prompt, /naturalmente/i);
  assert.match(prompt, /nome\/tratamento/i);
  assert.match(prompt, /Prefere ser chamado de Iong/);
});

test('camadaMemorias instrui a NUNCA mencionar que está "consultando" a memória', () => {
  const prompt = camadaMemorias([memoriaNomePreferido()]);
  assert.match(prompt, /sem dizer que está.*consultando/i);
});

/* ==========================================================================
   Hipótese original (relevância baixa) — ainda coberta, continua válida
   para memórias futuras cujo modelo mande um número de importância menor
   ========================================================================== */

test('importancia=70 (plausível de um modelo real) ainda vira relevancia=0.7 — mas agora, se a chave for estrutural, isso deixou de importar', () => {
  const r = normalizarExtracaoMemoria({
    acao: 'criar',
    categoria: 'preferencia',
    chave: 'nome_preferido',
    conteudo: 'Prefere ser chamado de Iong',
    importancia: 70,
  });
  assert.equal(r.relevancia, 0.7);
  const selecionadas = selecionarMemorias(
    [{ id: 'x', tipo: r.categoria, chaves: [r.chave], conteudo: r.conteudo, relevancia: r.relevancia, usuario_id: 'user-1', ativo: true }],
    'Bom dia',
  );
  assert.equal(selecionadas.length, 1, 'agora é core pela chave, independente do número que o modelo mandou');
});

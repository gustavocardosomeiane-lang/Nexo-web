/**
 * Testes das regras puras de escrita de memória de longo prazo
 * (shared/regras-nexo-ai.ts, seção 10) — validação/normalização
 * determinística do que a extração (Groq) propõe, dedupe e a heurística de
 * custo que decide quando vale a pena chamar o extrator.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarExtracaoMemoria,
  normalizarChave,
  mesmaMemoria,
  podeConterMemoria,
  pontuarMemoria,
  selecionarMemorias,
  LIMIAR_MEMORIA_CORE,
} from '../shared/regras-nexo-ai.ts';

/* ==========================================================================
   normalizarChave
   ========================================================================== */

test('normalizarChave: minúsculo, sem acento, espaço vira underscore', () => {
  assert.equal(normalizarChave('Nome Preferido'), 'nome_preferido');
  assert.equal(normalizarChave('Preferência de Tratamento'), 'preferencia_de_tratamento');
});

test('normalizarChave: não deixa underscore duplicado nem nas pontas', () => {
  assert.equal(normalizarChave('  foco   atual!!  '), 'foco_atual');
});

/* ==========================================================================
   normalizarExtracaoMemoria — a porta de entrada determinística
   ========================================================================== */

test('acao "criar" válida: normaliza categoria, chave e converte importância 0-100 -> relevância 0-1', () => {
  const r = normalizarExtracaoMemoria({
    acao: 'criar',
    categoria: 'preferencia',
    chave: 'nome_preferido',
    conteudo: 'Prefere ser chamado de Iong',
    importancia: 90,
  });
  assert.deepEqual(r, {
    acao: 'criar',
    categoria: 'preferencia',
    chave: 'nome_preferido',
    conteudo: 'Prefere ser chamado de Iong',
    relevancia: 0.9,
  });
});

test('acao "nenhuma": sempre recusa (null), mesmo com o resto preenchido', () => {
  assert.equal(
    normalizarExtracaoMemoria({ acao: 'nenhuma', categoria: 'fato', conteudo: 'irrelevante' }),
    null,
  );
});

test('acao ausente ou desconhecida: trata como "nenhuma" (falha fechado, nunca grava por engano)', () => {
  assert.equal(normalizarExtracaoMemoria({}), null);
  assert.equal(normalizarExtracaoMemoria({ acao: 'apagar_tudo' }), null);
  assert.equal(normalizarExtracaoMemoria({ acao: 123 }), null);
});

test('sem conteúdo (acao criar/atualizar): recusa — nunca grava linha vazia', () => {
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', conteudo: '' }), null);
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', conteudo: '   ' }), null);
  assert.equal(normalizarExtracaoMemoria({ acao: 'atualizar', chave: 'x' }), null);
});

test('acao "esquecer" pode vir só com a chave, sem conteúdo', () => {
  const r = normalizarExtracaoMemoria({ acao: 'esquecer', chave: 'nome_preferido' });
  assert.equal(r.acao, 'esquecer');
  assert.equal(r.chave, 'nome_preferido');
});

test('conteúdo acima do tamanho máximo é recusado, não truncado silenciosamente', () => {
  const r = normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'a'.repeat(501) });
  assert.equal(r, null);
});

test('categoria desconhecida: cai em "fato" em vez de rejeitar a memória inteira', () => {
  const r = normalizarExtracaoMemoria({ acao: 'criar', categoria: 'clima', chave: 'x', conteudo: 'algo relevante' });
  assert.equal(r.categoria, 'fato');
});

test('sinônimos de categoria (vocabulário natural) mapeiam pro enum real do banco', () => {
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', categoria: 'identidade', chave: 'x', conteudo: 'y' }).categoria, 'preferencia');
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', categoria: 'pessoa', chave: 'x', conteudo: 'y' }).categoria, 'fato');
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', categoria: 'rotina', chave: 'x', conteudo: 'y' }).categoria, 'fato');
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', categoria: 'negocio', chave: 'x', conteudo: 'y' }).categoria, 'empresa');
});

test('importância ausente/ inválida usa um padrão neutro (50 -> 0.5), nunca lança', () => {
  const r1 = normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'y' });
  assert.equal(r1.relevancia, 0.5);
  const r2 = normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'y', importancia: 'muito' });
  assert.equal(r2.relevancia, 0.5);
});

test('importância fora de 0-100 é limitada (clamp), nunca ultrapassa a escala', () => {
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'y', importancia: 999 }).relevancia, 1);
  assert.equal(normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'y', importancia: -50 }).relevancia, 0);
});

test('sem chave explícita: deriva uma chave a partir do início do conteúdo, nunca fica vazia', () => {
  const r = normalizarExtracaoMemoria({ acao: 'criar', conteudo: 'Nosso foco agora é clínicas de estética' });
  assert.ok(r.chave.length > 0);
  assert.doesNotMatch(r.chave, /\s/);
});

/* ==========================================================================
   Filtro de segredo — nunca grava token/senha/chave como memória
   ========================================================================== */

test('conteúdo com padrão de segredo reconhecido (JWT/chave de API) é recusado inteiro, não redigido', () => {
  const jwtFalso = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_teste_valido_o_bastante';
  const r = normalizarExtracaoMemoria({ acao: 'criar', chave: 'token', conteudo: `O token é ${jwtFalso}` });
  assert.equal(r, null);
});

test('conteúdo com chave de API estilo sk_live/pk_test é recusado', () => {
  const r = normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'A chave é sk_live_abcdefgh12345678' });
  assert.equal(r, null);
});

test('conteúdo comum, sem nenhum padrão de segredo, passa normalmente', () => {
  const r = normalizarExtracaoMemoria({ acao: 'criar', chave: 'x', conteudo: 'Prefere respostas curtas e diretas' });
  assert.ok(r);
});

/* ==========================================================================
   mesmaMemoria — dedupe/atualização
   ========================================================================== */

test('mesma chave, mesma categoria: é a mesma memória (deve atualizar, não duplicar)', () => {
  const candidata = { categoria: 'preferencia', chave: 'nome_preferido', conteudo: 'Prefere ser chamado de Iong' };
  const existente = { tipo: 'preferencia', conteudo: 'Prefere ser chamado de Gustavo', chaves: ['nome_preferido'] };
  assert.equal(mesmaMemoria(candidata, existente), true);
});

test('categorias diferentes: nunca é a mesma memória, mesmo com a mesma chave', () => {
  const candidata = { categoria: 'decisao', chave: 'foco_atual', conteudo: 'x' };
  const existente = { tipo: 'preferencia', conteudo: 'x', chaves: ['foco_atual'] };
  assert.equal(mesmaMemoria(candidata, existente), false);
});

test('sem chave batendo, mas conteúdo quase idêntico (paráfrase): reconhece como a mesma pela sobreposição de palavras', () => {
  const candidata = { categoria: 'decisao', chave: 'foco', conteudo: 'Nosso foco agora é clínicas de estética em Goiânia' };
  const existente = { tipo: 'decisao', conteudo: 'O foco atual é clínicas de estética em Goiânia', chaves: ['prioridade'] };
  assert.equal(mesmaMemoria(candidata, existente), true);
});

test('conteúdo completamente diferente: não é a mesma memória', () => {
  const candidata = { categoria: 'fato', chave: 'a', conteudo: 'Ícaro cuida do financeiro' };
  const existente = { tipo: 'fato', conteudo: 'A reunião semanal é toda sexta', chaves: ['b'] };
  assert.equal(mesmaMemoria(candidata, existente), false);
});

/* ==========================================================================
   podeConterMemoria — heurística de custo (não chama o modelo à toa)
   ========================================================================== */

test('mensagens banais NÃO disparam extração — economiza a chamada extra', () => {
  for (const m of ['oi', 'obrigado', 'que horas são', 'busque 5 leads agora', 'ok', 'valeu!']) {
    assert.equal(podeConterMemoria(m), false, `"${m}" não deveria disparar extração`);
  }
});

test('exemplos do pedido original que DEVEM disparar extração', () => {
  for (const m of [
    'Me chama de Iong.',
    'Prefiro respostas curtas.',
    'A NEXO usa preto e vermelho.',
    'Não quero mais usar ElevenLabs.',
    'Ícaro cuida do financeiro.',
    'Nosso foco agora é clínicas de estética.',
  ]) {
    assert.equal(podeConterMemoria(m), true, `"${m}" deveria disparar extração`);
  }
});

test('comandos de esquecimento também disparam a extração (a ação "esquecer" também precisa do extrator)', () => {
  assert.equal(podeConterMemoria('Esquece que eu falei sobre o orçamento.'), true);
  assert.equal(podeConterMemoria('Não me chame mais de Iong.'), true);
});

test('texto curto demais nunca dispara, mesmo contendo uma palavra-sinal isolada', () => {
  assert.equal(podeConterMemoria('oi'), false);
});

/* ==========================================================================
   Recuperação — core memory sempre tenta entrar, recência pontua
   ========================================================================== */

test('memória com relevância acima do limiar core entra mesmo sem nenhuma palavra em comum com a pergunta', () => {
  const nomePreferido = { id: '1', tipo: 'preferencia', conteudo: 'Prefere ser chamado de Iong', relevancia: LIMIAR_MEMORIA_CORE + 0.05 };
  const escolhidas = selecionarMemorias([nomePreferido], 'bom dia');
  assert.deepEqual(escolhidas.map((m) => m.id), ['1']);
});

test('memória de relevância comum (abaixo do limiar core) só entra se tiver sobreposição com a pergunta', () => {
  const memoriaComum = { id: '2', tipo: 'fato', conteudo: 'O projeto do cliente X usa React', relevancia: 0.5 };
  const semRelacao = selecionarMemorias([memoriaComum], 'bom dia');
  assert.deepEqual(semRelacao, []);
  const comRelacao = selecionarMemorias([memoriaComum], 'como está o projeto do cliente X?');
  assert.deepEqual(comRelacao.map((m) => m.id), ['2']);
});

test('memória usada recentemente pontua mais alto que uma idêntica nunca usada, em empate de relevância declarada', () => {
  const agora = Date.now();
  const usadaOntem = {
    conteudo: 'foco em clinicas de estetica',
    relevancia: 0.5,
    last_used_at: new Date(agora - 1 * 86_400_000).toISOString(),
  };
  const nuncaUsada = { conteudo: 'foco em clinicas de estetica', relevancia: 0.5, last_used_at: null };
  const pontoUsada = pontuarMemoria(usadaOntem, 'qual o foco em clinicas de estetica?', agora);
  const pontoNuncaUsada = pontuarMemoria(nuncaUsada, 'qual o foco em clinicas de estetica?', agora);
  assert.ok(pontoUsada > pontoNuncaUsada);
});

test('memória antiga (fora da janela de recência) ainda pode ser recuperada — só não ganha o bônus', () => {
  const agora = Date.now();
  const memoriaAntiga = {
    id: 'antiga',
    tipo: 'fato',
    conteudo: 'decidimos usar Google Cloud Text-to-Speech para a voz da NEXO',
    relevancia: 0.6,
    last_used_at: new Date(agora - 200 * 86_400_000).toISOString(),
  };
  const escolhidas = selecionarMemorias([memoriaAntiga], 'qual provedor de TTS a NEXO usa hoje?');
  assert.deepEqual(escolhidas.map((m) => m.id), ['antiga']);
});

/**
 * Trava contra divergência: a visibilidade do SERVIDOR
 * (api/_lib/nexo-ai/permissao.ts) precisa bater exatamente com a dimensão
 * "ver" da matriz do FRONTEND (src/auth/permissions.ts).
 *
 * Duas cópias de uma regra de permissão que divergem em silêncio é como um
 * usuário acaba vendo pela IA o que não veria na tela. Este teste falha antes
 * de o deploy acontecer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { VISIBILIDADE, podePorPapel } from '../api/_lib/nexo-ai/permissao.ts';
import { PERMISSOES } from '../src/auth/permissions.ts';

test('todo papel do frontend existe na visibilidade do servidor', () => {
  for (const papel of Object.keys(PERMISSOES)) {
    assert.ok(VISIBILIDADE[papel], `servidor não conhece o papel "${papel}"`);
  }
});

/**
 * Módulos que são só de NAVEGAÇÃO, sem contrapartida de DADOS no servidor.
 *
 * `nexo_ai` é a própria tela da assistente: dá acesso à página, não a uma
 * fonte de dados. Não existe ferramenta `consultar_nexo_ai`, então ele não
 * entra na visibilidade do servidor — e não deve, senão a IA "consultaria a
 * si mesma". Fica de fora da comparação de propósito.
 */
const SO_NAVEGACAO = new Set(['nexo_ai']);

test('a visibilidade do servidor bate módulo a módulo com a matriz do frontend', () => {
  for (const [papel, modulos] of Object.entries(PERMISSOES)) {
    // O que o frontend deixa VER: módulo de DADOS cuja lista inclui 'ver'.
    const veNoFrontend = Object.entries(modulos)
      .filter(([modulo, acoes]) => acoes.includes('ver') && !SO_NAVEGACAO.has(modulo))
      .map(([modulo]) => modulo)
      .sort();

    const veNoServidor = [...VISIBILIDADE[papel]].sort();

    assert.deepEqual(
      veNoServidor,
      veNoFrontend,
      `divergência para "${papel}": servidor=${veNoServidor} frontend=${veNoFrontend}`,
    );
  }
});

test('papel desconhecido não vê nada — falha fechado', () => {
  assert.equal(podePorPapel('intruso', 'vendas'), false);
  assert.equal(podePorPapel('', 'dashboard'), false);
});

test('vendedor NÃO enxerga financeiro nem configurações', () => {
  assert.equal(podePorPapel('vendedor', 'financeiro'), false);
  assert.equal(podePorPapel('vendedor', 'configuracoes'), false);
});

test('colaborador NÃO enxerga vendas nem pagamentos', () => {
  assert.equal(podePorPapel('colaborador', 'vendas'), false);
  assert.equal(podePorPapel('colaborador', 'pagamentos'), false);
});

test('administrador enxerga tudo', () => {
  for (const modulo of VISIBILIDADE.administrador) {
    assert.ok(podePorPapel('administrador', modulo));
  }
});

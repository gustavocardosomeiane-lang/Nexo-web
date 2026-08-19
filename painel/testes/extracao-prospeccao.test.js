/**
 * Testes da extração de parâmetros por linguagem natural (Etapa 4).
 *
 * `pareceComandoDeProspeccao` é palavra-chave pura, sem rede. `extrairParametrosBusca`
 * recebe um `ProvedorExtracao` FALSO — nenhuma chamada real ao Groq, nenhum custo.
 * A única coisa que este módulo decide é OS PARÂMETROS da busca — nunca o
 * resultado dela.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pareceComandoDeProspeccao, extrairParametrosBusca } from '../api/_lib/nexo-ai/ferramentas.ts';

/* ==========================================================================
   pareceComandoDeProspeccao — detecção barata por palavra-chave
   ========================================================================== */

test('reconhece o comando de exemplo do combinado com você', () => {
  assert.equal(
    pareceComandoDeProspeccao('NEXO, procure 30 clínicas de estética em Goiânia que não tenham site ou tenham site ruim.'),
    true,
  );
});

test('reconhece variações de verbo e nicho', () => {
  assert.equal(pareceComandoDeProspeccao('busque academias em Anápolis'), true);
  assert.equal(pareceComandoDeProspeccao('encontre negócios locais de estética'), true);
  assert.equal(pareceComandoDeProspeccao('quero prospectar clientes na região'), true);
});

test('não reconhece perguntas comuns do dia a dia', () => {
  assert.equal(pareceComandoDeProspeccao('quantos leads temos hoje?'), false);
  assert.equal(pareceComandoDeProspeccao('quanto vendemos esse mês?'), false);
  assert.equal(pareceComandoDeProspeccao('bom dia, tudo bem?'), false);
});

test('não reconhece o verbo sozinho, sem contexto de negócio', () => {
  assert.equal(pareceComandoDeProspeccao('procure na tela de configurações'), false);
});

test('ignora acento e caixa', () => {
  assert.equal(pareceComandoDeProspeccao('PROCURE 10 CLÍNICAS EM GOIÂNIA'), true);
  assert.equal(pareceComandoDeProspeccao('Prospectar Empresas'), true);
});

/* ==========================================================================
   extrairParametrosBusca — provedor de modelo FALSO, sem rede
   ========================================================================== */

function provedorQueChama(argumentos) {
  return {
    conversar: async () => ({
      texto: '',
      chamadas: [{ id: 'call-1', nome: 'buscar_leads_locais', argumentos }],
      tokens: { entrada: 10, saida: 5 },
    }),
  };
}

function provedorQueNaoChama(textoLivre = 'Claro, em qual cidade você quer procurar?') {
  return {
    conversar: async () => ({
      texto: textoLivre,
      chamadas: [],
      tokens: { entrada: 10, saida: 5 },
    }),
  };
}

function provedorQueFalha() {
  return {
    conversar: async () => {
      throw new Error('Groq indisponível');
    },
  };
}

test('extrai nicho/cidade/quantidade quando o modelo chama a ferramenta', async () => {
  const provedor = provedorQueChama({ nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 30 });
  const parametros = await extrairParametrosBusca('procure 30 clínicas de estética em Goiânia', provedor);
  assert.deepEqual(parametros, { nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 30 });
});

test('devolve null quando o modelo NÃO chama a ferramenta (faltou informação)', async () => {
  const provedor = provedorQueNaoChama();
  const parametros = await extrairParametrosBusca('procure clínicas de estética', provedor);
  assert.equal(parametros, null);
});

test('devolve null (não derruba a conversa) quando a chamada ao modelo falha', async () => {
  const provedor = provedorQueFalha();
  const parametros = await extrairParametrosBusca('procure academias em Goiânia', provedor);
  assert.equal(parametros, null);
});

test('só considera a chamada de buscar_leads_locais, ignora chamadas de outra ferramenta', async () => {
  const provedor = {
    conversar: async () => ({
      texto: '',
      chamadas: [{ id: 'call-1', nome: 'consultar_leads', argumentos: {} }],
      tokens: { entrada: 10, saida: 5 },
    }),
  };
  const parametros = await extrairParametrosBusca('procure clínicas em Goiânia', provedor);
  assert.equal(parametros, null);
});

test('a extração expõe SÓ a ferramenta buscar_leads_locais ao modelo, nunca as outras', async () => {
  let ferramentasRecebidas = null;
  const provedor = {
    conversar: async (pedido) => {
      ferramentasRecebidas = pedido.ferramentas;
      return { texto: '', chamadas: [], tokens: { entrada: 0, saida: 0 } };
    },
  };
  await extrairParametrosBusca('procure clínicas em Goiânia', provedor);
  assert.equal(ferramentasRecebidas.length, 1);
  assert.equal(ferramentasRecebidas[0].nome, 'buscar_leads_locais');
});

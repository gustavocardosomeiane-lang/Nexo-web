/**
 * Testes da extração de parâmetros por linguagem natural (Etapa 4 + correção
 * do fluxo multi-turn).
 *
 * `pareceComandoDeProspeccao` é palavra-chave pura, sem rede. `extrairParametrosBusca`
 * recebe um `ProvedorExtracao` FALSO — nenhuma chamada real ao Groq, nenhum
 * custo, nenhum Google Places. `global.fetch` é envenenado neste arquivo
 * inteiro (ver abaixo): se qualquer teste tentar uma rede de verdade, ele
 * falha alto e claro, em vez de silenciosamente tentar sair para a internet.
 *
 * A única coisa que este módulo decide é OS PARÂMETROS da busca — nunca o
 * resultado dela.
 *
 * CONTEXTO DO INCIDENTE: em produção, um pedido completo num turno só
 * pediu confirmação de nicho/cidade que já estavam na mensagem, e um pedido
 * em dois turnos ("procure clínicas" → "qual cidade?" → "Goiânia") nunca se
 * completou. A causa: `extrairParametrosBusca` só via a ÚLTIMA mensagem,
 * nunca o histórico da conversa — corrigido para receber `historico` como
 * parâmetro explícito. Os testes abaixo cobrem os dois cenários.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pareceComandoDeProspeccao, extrairParametrosBusca } from '../api/_lib/nexo-ai/ferramentas.ts';

const fetchOriginal = global.fetch;

test.before(() => {
  global.fetch = async (url) => {
    throw new Error(`Nenhum teste de extração deveria chamar fetch de verdade: ${url}`);
  };
});

test.after(() => {
  global.fetch = fetchOriginal;
});

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

/** Simula um modelo que SEMPRE chama a ferramenta, com os argumentos dados. */
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

/**
 * Simula um modelo "correto": só chama a ferramenta se, somando o
 * histórico recebido + a mensagem atual, nicho e cidade aparecem em algum
 * lugar da conversa. Isso testa a FIAÇÃO do código (o histórico chega
 * inteiro até o provedor, e o retorno do provedor é repassado sem
 * mutilação) — não testa se o Groq de verdade vai se comportar assim; isso
 * só um teste real (fora desta suíte) confirma.
 */
function provedorQueCombinaTurnos({ nichoDoHistorico, cidadeDoHistorico, quantidadeDoHistorico } = {}) {
  return {
    conversar: async (pedido) => {
      const textoCompleto = pedido.mensagens.map((m) => m.conteudo).join(' ').toLowerCase();

      const nicho = nichoDoHistorico ?? (textoCompleto.includes('clínica') || textoCompleto.includes('clinica')
        ? 'clínica de estética'
        : null);
      const cidade = cidadeDoHistorico ?? (textoCompleto.includes('goiânia') || textoCompleto.includes('goiania')
        ? 'Goiânia'
        : null);
      const quantidade = quantidadeDoHistorico ?? (/(\d+)/.exec(textoCompleto)?.[1]
        ? Number(/(\d+)/.exec(textoCompleto)[1])
        : undefined);

      if (!nicho || !cidade) {
        return { texto: 'Preciso de mais informação.', chamadas: [], tokens: { entrada: 0, saida: 0 } };
      }

      const argumentos = { nicho, cidade, ...(quantidade ? { quantidade } : {}) };
      return {
        texto: '',
        chamadas: [{ id: 'call-1', nome: 'buscar_leads_locais', argumentos }],
        tokens: { entrada: 10, saida: 5 },
      };
    },
  };
}

/* -------------------------------------------------------------------------
   Turno único, comando completo
   ------------------------------------------------------------------------- */

test('comando completo em um turno: extrai nicho/cidade/quantidade', async () => {
  const provedor = provedorQueChama({ nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 30 });
  const parametros = await extrairParametrosBusca(
    'procure 30 clínicas de estética em Goiânia',
    [],
    provedor,
  );
  assert.deepEqual(parametros, { nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 30 });
});

test('execução ocorre assim que todos os campos estão disponíveis, sem histórico nenhum', async () => {
  const provedor = provedorQueCombinaTurnos();
  const parametros = await extrairParametrosBusca(
    'NEXO, procure 3 clínicas de estética em Goiânia que não tenham site ou tenham site ruim.',
    [],
    provedor,
  );
  assert.ok(parametros, 'deveria ter chamado a ferramenta direto, sem pedir confirmação');
  assert.equal(parametros.nicho, 'clínica de estética');
  assert.equal(parametros.cidade, 'Goiânia');
  assert.equal(parametros.quantidade, 3);
});

test('falta só cidade: modelo não chama a ferramenta (comportamento esperado)', async () => {
  const provedor = provedorQueCombinaTurnos();
  const parametros = await extrairParametrosBusca('procure clínicas de estética', [], provedor);
  assert.equal(parametros, null);
});

test('falta só nicho: modelo não chama a ferramenta (comportamento esperado)', async () => {
  const provedor = provedorQueCombinaTurnos();
  const parametros = await extrairParametrosBusca('procure em Goiânia', [], provedor);
  assert.equal(parametros, null);
});

/* -------------------------------------------------------------------------
   Multi-turn — o cenário do incidente
   ------------------------------------------------------------------------- */

test('cidade fornecida no segundo turno: combina com o nicho do histórico', async () => {
  const historico = [
    { papel: 'user', conteudo: 'Procure clínicas de estética.' },
    { papel: 'assistant', conteudo: 'Claro! Em qual cidade você quer que eu procure?' },
  ];
  const provedor = provedorQueCombinaTurnos();

  const parametros = await extrairParametrosBusca('Goiânia inteira', historico, provedor);

  assert.ok(parametros, 'deveria ter combinado nicho do histórico com a cidade da mensagem atual');
  assert.equal(parametros.nicho, 'clínica de estética');
  assert.equal(parametros.cidade, 'Goiânia');
});

test('nicho fornecido no segundo turno: combina com a cidade do histórico', async () => {
  const historico = [
    { papel: 'user', conteudo: 'Quero prospectar em Goiânia.' },
    { papel: 'assistant', conteudo: 'Certo! Que tipo de negócio você quer buscar?' },
  ];
  const provedor = provedorQueCombinaTurnos();

  const parametros = await extrairParametrosBusca('Clínicas de estética', historico, provedor);

  assert.ok(parametros, 'deveria ter combinado cidade do histórico com o nicho da mensagem atual');
  assert.equal(parametros.cidade, 'Goiânia');
  assert.equal(parametros.nicho, 'clínica de estética');
});

test('quantidade fornecida no segundo turno: combina com nicho e cidade já ditos', async () => {
  const historico = [
    { papel: 'user', conteudo: 'Procure clínicas de estética em Goiânia.' },
    { papel: 'assistant', conteudo: 'Quantos leads você quer que eu importe?' },
  ];
  const provedor = provedorQueCombinaTurnos({
    nichoDoHistorico: 'clínica de estética',
    cidadeDoHistorico: 'Goiânia',
  });

  const parametros = await extrairParametrosBusca('Uns 10', historico, provedor);

  assert.ok(parametros);
  assert.equal(parametros.nicho, 'clínica de estética');
  assert.equal(parametros.cidade, 'Goiânia');
});

test('"Goiânia inteira" é repassada como a cidade Goiânia, sem o código alterar o que o modelo extraiu', async () => {
  const provedor = provedorQueChama({ nicho: 'academia', cidade: 'Goiânia', quantidade: 30 });
  const parametros = await extrairParametrosBusca('Goiânia inteira', [
    { papel: 'user', conteudo: 'busque academias' },
    { papel: 'assistant', conteudo: 'qual cidade?' },
  ], provedor);

  assert.equal(parametros.cidade, 'Goiânia');
});

test('o histórico é enviado ao modelo por inteiro, na ordem certa, antes da mensagem atual', async () => {
  let mensagensRecebidas = null;
  const provedor = {
    conversar: async (pedido) => {
      mensagensRecebidas = pedido.mensagens;
      return { texto: '', chamadas: [], tokens: { entrada: 0, saida: 0 } };
    },
  };
  const historico = [
    { papel: 'user', conteudo: 'Procure clínicas de estética.' },
    { papel: 'assistant', conteudo: 'Em qual cidade?' },
  ];

  await extrairParametrosBusca('Goiânia inteira', historico, provedor);

  assert.equal(mensagensRecebidas.length, 3);
  assert.deepEqual(mensagensRecebidas[0], { papel: 'user', conteudo: 'Procure clínicas de estética.' });
  assert.deepEqual(mensagensRecebidas[1], { papel: 'assistant', conteudo: 'Em qual cidade?' });
  assert.deepEqual(mensagensRecebidas[2], { papel: 'user', conteudo: 'Goiânia inteira' });
});

test('histórico vazio (primeira mensagem da conversa) não quebra a extração', async () => {
  const provedor = provedorQueChama({ nicho: 'clínica', cidade: 'Goiânia' });
  const parametros = await extrairParametrosBusca('procure clínicas em Goiânia', [], provedor);
  assert.ok(parametros);
});

/* -------------------------------------------------------------------------
   Falhas e casos de borda
   ------------------------------------------------------------------------- */

test('devolve null quando o modelo NÃO chama a ferramenta (faltou informação em toda a conversa)', async () => {
  const provedor = provedorQueNaoChama();
  const parametros = await extrairParametrosBusca('procure clínicas de estética', [], provedor);
  assert.equal(parametros, null);
});

test('devolve null (não derruba a conversa) quando a chamada ao modelo falha', async () => {
  const provedor = provedorQueFalha();
  const parametros = await extrairParametrosBusca('procure academias em Goiânia', [], provedor);
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
  const parametros = await extrairParametrosBusca('procure clínicas em Goiânia', [], provedor);
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
  await extrairParametrosBusca('procure clínicas em Goiânia', [], provedor);
  assert.equal(ferramentasRecebidas.length, 1);
  assert.equal(ferramentasRecebidas[0].nome, 'buscar_leads_locais');
});

/* -------------------------------------------------------------------------
   Instrução explícita contra confirmação redundante
   ------------------------------------------------------------------------- */

test('o prompt de extração instrui explicitamente a NUNCA pedir confirmação de dado já informado', async () => {
  let sistemaRecebido = null;
  const provedor = {
    conversar: async (pedido) => {
      sistemaRecebido = pedido.sistema;
      return { texto: '', chamadas: [], tokens: { entrada: 0, saida: 0 } };
    },
  };
  await extrairParametrosBusca('procure clínicas em Goiânia', [], provedor);

  assert.match(sistemaRecebido, /NUNCA peça confirmação/i);
  assert.match(sistemaRecebido, /conversa INTEIRA|vários turnos|mensagem anterior/i);
});

test('o prompt de extração instrui que "sem site"/"site ruim" não é parâmetro e não deve travar a chamada', async () => {
  let sistemaRecebido = null;
  const provedor = {
    conversar: async (pedido) => {
      sistemaRecebido = pedido.sistema;
      return { texto: '', chamadas: [], tokens: { entrada: 0, saida: 0 } };
    },
  };
  await extrairParametrosBusca('procure clínicas em Goiânia', [], provedor);

  assert.match(sistemaRecebido, /site ruim/i);
});

/**
 * Testes de `registrarMemoria`/`atualizarUsoMemorias` (api/_lib/nexo-ai/memoria.ts)
 * e da ferramenta `registrar_memoria` (api/_lib/nexo-ai/ferramentas.ts) —
 * a parte que FALA COM O BANCO da memória de longo prazo.
 *
 * `global.fetch` fica envenenado no arquivo inteiro: memória nunca deveria
 * chamar rede nenhuma além do modelo (que aqui nem entra em cena — só
 * testamos a gravação, com o resultado da extração já pronto).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registrarMemoria, atualizarUsoMemorias } from '../api/_lib/nexo-ai/memoria.ts';
import { executarFerramenta } from '../api/_lib/nexo-ai/ferramentas.ts';

const fetchOriginal = global.fetch;

test.before(() => {
  global.fetch = async (url) => {
    throw new Error(`memória nunca deveria chamar fetch: ${url}`);
  };
});

test.after(() => {
  global.fetch = fetchOriginal;
});

/* --------------------------------------------------------------------------
   Cliente Supabase falso — só o subconjunto que memoria.ts usa
   -------------------------------------------------------------------------- */

function criarDbFakeMemoria({ memoriasExistentes = [], erroSelect = null, erroInsert = null, erroUpdate = null } = {}) {
  const chamadas = { selects: [], inserts: [], updates: [] };
  let proximoId = 0;

  function selectQuery() {
    const filtros = {};
    const builder = {
      eq(campo, valor) {
        filtros[campo] = valor;
        return builder;
      },
      then(resolve, reject) {
        chamadas.selects.push({ ...filtros });
        if (erroSelect) return Promise.resolve({ data: null, error: erroSelect }).then(resolve, reject);
        let resultado = memoriasExistentes;
        for (const [campo, valor] of Object.entries(filtros)) {
          resultado = resultado.filter((m) => m[campo] === valor);
        }
        return Promise.resolve({ data: resultado, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  const db = {
    from(tabela) {
      if (tabela !== 'ai_memories') throw new Error('tabela inesperada: ' + tabela);
      return {
        select() {
          return selectQuery();
        },
        insert(linha) {
          chamadas.inserts.push(linha);
          return {
            select: () => ({
              single: async () => {
                if (erroInsert) return { data: null, error: erroInsert };
                proximoId += 1;
                const nova = { id: `nova-${proximoId}`, ...linha };
                memoriasExistentes.push({ ...nova, tipo: linha.tipo });
                return { data: { id: nova.id }, error: null };
              },
            }),
          };
        },
        update(mudancas) {
          return {
            eq: async (campo, valor) => {
              chamadas.updates.push({ campo, valor, mudancas });
              if (erroUpdate) return { error: erroUpdate };
              const alvo = memoriasExistentes.find((m) => m[campo] === valor);
              if (alvo) Object.assign(alvo, mudancas);
              return { error: null };
            },
          };
        },
      };
    },
  };

  return { db, chamadas, memoriasExistentes };
}

/* ==========================================================================
   1. "me chama de Iong" cria/atualiza preferência
   ========================================================================== */

test('cria uma memória nova quando nada parecido existe', async () => {
  const { db, chamadas } = criarDbFakeMemoria({});
  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-1', conversaId: 'conv-1' },
    { acao: 'criar', categoria: 'preferencia', chave: 'nome_preferido', conteudo: 'Prefere ser chamado de Iong', importancia: 90 },
  );
  assert.equal(resultado.status, 'criada');
  assert.equal(chamadas.inserts.length, 1);
  assert.equal(chamadas.inserts[0].usuario_id, 'user-1');
  assert.equal(chamadas.inserts[0].tipo, 'preferencia');
  assert.equal(chamadas.inserts[0].conteudo, 'Prefere ser chamado de Iong');
  assert.deepEqual(chamadas.inserts[0].chaves, ['nome_preferido']);
  assert.equal(chamadas.inserts[0].source_conversation_id, 'conv-1');
});

/* ==========================================================================
   2/3. Mudança de nome ATUALIZA, não duplica
   ========================================================================== */

test('mesma chave/categoria já existente: ATUALIZA em vez de duplicar', async () => {
  const { db, chamadas } = criarDbFakeMemoria({
    memoriasExistentes: [
      { id: 'mem-1', tipo: 'preferencia', conteudo: 'Prefere ser chamado de Gustavo', chaves: ['nome_preferido'], relevancia: 0.9, usuario_id: 'user-1', ativo: true },
    ],
  });

  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-1', conversaId: 'conv-2' },
    { acao: 'criar', categoria: 'preferencia', chave: 'nome_preferido', conteudo: 'Prefere ser chamado de Iong', importancia: 90 },
  );

  assert.equal(resultado.status, 'atualizada');
  assert.equal(resultado.id, 'mem-1');
  assert.equal(chamadas.inserts.length, 0, 'nunca insere uma segunda linha para a mesma memória');
  assert.equal(chamadas.updates.length, 1);
  assert.equal(chamadas.updates[0].mudancas.conteudo, 'Prefere ser chamado de Iong');
});

/* ==========================================================================
   4. "esquece..." desativa a memória correta
   ========================================================================== */

test('acao esquecer: desativa (ativo=false) a memória certa — nunca DELETE físico', async () => {
  const { db, chamadas, memoriasExistentes } = criarDbFakeMemoria({
    memoriasExistentes: [
      { id: 'mem-nome', tipo: 'preferencia', conteudo: 'Prefere ser chamado de Iong', chaves: ['nome_preferido'], usuario_id: 'user-1', ativo: true },
      { id: 'mem-outra', tipo: 'fato', conteudo: 'Ícaro cuida do financeiro', chaves: ['icaro_financeiro'], usuario_id: 'user-1', ativo: true },
    ],
  });

  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-1', conversaId: 'conv-3' },
    { acao: 'esquecer', chave: 'nome_preferido' },
  );

  assert.equal(resultado.status, 'esquecida');
  assert.equal(resultado.id, 'mem-nome');
  assert.equal(chamadas.updates[0].mudancas.ativo, false);
  assert.equal(memoriasExistentes.find((m) => m.id === 'mem-nome').ativo, false);
  assert.notEqual(memoriasExistentes.find((m) => m.id === 'mem-outra').ativo, false, 'só a memória certa é desativada');
});

test('esquecer sem nenhuma correspondência: não faz nada, não é erro', async () => {
  const { db, chamadas } = criarDbFakeMemoria({ memoriasExistentes: [] });
  const resultado = await registrarMemoria({ db, usuarioId: 'user-1', conversaId: 'c' }, { acao: 'esquecer', chave: 'nao_existe' });
  assert.equal(resultado.status, 'nada_para_esquecer');
  assert.equal(chamadas.updates.length, 0);
});

/* ==========================================================================
   5. Mensagem banal não cria memória (via a ferramenta, camada acima)
   ========================================================================== */

test('acao "nenhuma": ferramenta não toca no banco', async () => {
  const { db, chamadas } = criarDbFakeMemoria({});
  const resultado = JSON.parse(
    await executarFerramenta(
      'registrar_memoria',
      { acao: 'nenhuma' },
      { db, usuarioId: 'user-1', papel: 'vendedor', conversaId: 'c' },
      ['registrar_memoria'],
    ),
  );
  assert.equal(resultado.status, 'ignorado');
  assert.equal(chamadas.selects.length, 0);
  assert.equal(chamadas.inserts.length, 0);
});

/* ==========================================================================
   6. Isolamento entre usuários
   ========================================================================== */

test('dedupe/consulta é sempre filtrada pelo usuário — nunca vê memória de outro', async () => {
  const { db, chamadas } = criarDbFakeMemoria({
    memoriasExistentes: [{ id: 'mem-de-outro', tipo: 'preferencia', conteudo: 'Prefere ser chamado de Carlos', chaves: ['nome_preferido'], usuario_id: 'user-B' }],
  });

  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-A', conversaId: 'c' },
    { acao: 'criar', categoria: 'preferencia', chave: 'nome_preferido', conteudo: 'Prefere ser chamado de Iong' },
  );

  // A consulta de dedupe filtrou por usuario_id=user-A — a memória de user-B
  // (que não tem usuario_id=user-A) não aparece no resultado, então isto
  // devia CRIAR uma nova, nunca atualizar a do outro usuário.
  assert.equal(resultado.status, 'criada');
  assert.equal(chamadas.selects[0].usuario_id, 'user-A');
});

/* ==========================================================================
   7. Segredo/token não é salvo (camada de orquestração — a validação em si já é testada em memoria-extracao.test.js)
   ========================================================================== */

test('conteúdo com padrão de segredo: nunca chega a fazer INSERT', async () => {
  const { db, chamadas } = criarDbFakeMemoria({});
  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-1', conversaId: 'c' },
    { acao: 'criar', chave: 'token', conteudo: 'A chave é sk_live_abcdefgh12345678' },
  );
  assert.equal(resultado.status, 'ignorado');
  assert.equal(chamadas.inserts.length, 0);
});

/* ==========================================================================
   12. Falha no módulo de memória NÃO derruba a conversa
   ========================================================================== */

test('erro do Supabase na consulta de dedupe: devolve {status:"erro"}, nunca lança', async () => {
  const { db } = criarDbFakeMemoria({ erroSelect: { message: 'column "ativo" does not exist' } });
  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-1', conversaId: 'c' },
    { acao: 'criar', chave: 'x', conteudo: 'algo relevante pra lembrar' },
  );
  assert.equal(resultado.status, 'erro');
  assert.ok(resultado.motivo);
});

test('erro do Supabase no INSERT: devolve {status:"erro"}, nunca lança', async () => {
  const { db } = criarDbFakeMemoria({ erroInsert: { message: 'falha simulada' } });
  const resultado = await registrarMemoria(
    { db, usuarioId: 'user-1', conversaId: 'c' },
    { acao: 'criar', chave: 'x', conteudo: 'algo relevante pra lembrar' },
  );
  assert.equal(resultado.status, 'erro');
});

test('erro do Supabase no UPDATE (esquecer): devolve {status:"erro"}, nunca lança', async () => {
  const { db } = criarDbFakeMemoria({
    memoriasExistentes: [{ id: 'mem-1', tipo: 'fato', conteudo: 'x', chaves: ['x'], usuario_id: 'user-1', ativo: true }],
    erroUpdate: { message: 'falha simulada' },
  });
  const resultado = await registrarMemoria({ db, usuarioId: 'user-1', conversaId: 'c' }, { acao: 'esquecer', chave: 'x' });
  assert.equal(resultado.status, 'erro');
});

test('ferramenta registrar_memoria: erro do banco não lança exceção pro chamador', async () => {
  const { db } = criarDbFakeMemoria({ erroSelect: { message: 'falha' } });
  // Se lançasse, executarFerramenta capturaria e devolveria {erro:...} —
  // ainda assim não pode travar a resposta. Confirma que nem chega a lançar.
  const bruto = await executarFerramenta(
    'registrar_memoria',
    { acao: 'criar', chave: 'x', conteudo: 'algo relevante' },
    { db, usuarioId: 'user-1', papel: 'vendedor', conversaId: 'c' },
    ['registrar_memoria'],
  );
  assert.doesNotThrow(() => JSON.parse(bruto));
});

/* ==========================================================================
   atualizarUsoMemorias — recência
   ========================================================================== */

test('atualizarUsoMemorias: atualiza last_used_at das memórias usadas', async () => {
  const atualizacoes = [];
  const db = {
    from: () => ({
      update: (mudancas) => ({
        in: async (campo, valores) => {
          atualizacoes.push({ mudancas, campo, valores });
          return { error: null };
        },
      }),
    }),
  };
  await atualizarUsoMemorias(db, ['mem-1', 'mem-2']);
  assert.equal(atualizacoes.length, 1);
  assert.ok(atualizacoes[0].mudancas.last_used_at);
  assert.deepEqual(atualizacoes[0].valores, ['mem-1', 'mem-2']);
});

test('atualizarUsoMemorias: lista vazia não toca no banco', async () => {
  let chamou = false;
  const db = { from: () => { chamou = true; } };
  await atualizarUsoMemorias(db, []);
  assert.equal(chamou, false);
});

test('atualizarUsoMemorias: erro do banco nunca lança (melhor esforço)', async () => {
  const db = {
    from: () => ({
      update: () => ({
        in: async () => {
          throw new Error('falha de rede simulada');
        },
      }),
    }),
  };
  await assert.doesNotReject(() => atualizarUsoMemorias(db, ['mem-1']));
});

/* ==========================================================================
   Definição exposta ao modelo
   ========================================================================== */

test('a definição da ferramenta não pede segredo nenhum', async () => {
  const { definicoesDe } = await import('../api/_lib/nexo-ai/ferramentas.ts');
  const [definicao] = definicoesDe(['registrar_memoria']);
  assert.equal(definicao.nome, 'registrar_memoria');
  assert.equal(JSON.stringify(definicao).toLowerCase().includes('api_key'), false);
});

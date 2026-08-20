/**
 * Testes do botão "Nova conversa" — a parte que dá pra testar sem jsdom
 * (este projeto não tem: React/hooks com estado/DOM não são exercitados
 * aqui, só o código puro/orquestração por trás). Ver o comentário no fim
 * do arquivo sobre o que fica só revisado manualmente.
 *
 * `criarConversa` (api/_lib/nexo-ai/conversas.ts) é o único INSERT
 * envolvido — reaproveitado tanto por `garantirConversa` (fallback quando
 * nenhum conversa_id é enviado) quanto pelo endpoint dedicado
 * `POST /api/nexo-ai/conversas` (o botão em si).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { criarConversa } from '../api/_lib/nexo-ai/conversas.ts';
import { carregarMemorias } from '../api/nexo-ai/conversar.ts';
import { ehAbortoIntencional } from '../shared/regras-nexo-ai.ts';

/* --------------------------------------------------------------------------
   Fábrica — cliente Supabase falso com "tabelas" de verdade (arrays),
   pra poder simular consultas de ai_messages/ai_memories depois do INSERT.
   -------------------------------------------------------------------------- */

function criarDbFake({ conversations = [], messages = [], memories = [] } = {}) {
  let proximoId = 0;
  const chamadas = { deletes: [], inserts: [] };

  const db = {
    from(tabela) {
      return {
        insert(linha) {
          chamadas.inserts.push({ tabela, linha });
          return {
            select: () => ({
              single: async () => {
                proximoId += 1;
                const nova = { id: `${tabela}-${proximoId}`, ...linha };
                if (tabela === 'ai_conversations') conversations.push(nova);
                return { data: { id: nova.id }, error: null };
              },
            }),
          };
        },
        select() {
          const filtros = [];
          const builder = {
            eq(campo, valor) {
              filtros.push(['eq', campo, valor]);
              return builder;
            },
            // Simula o parser real do Supabase pra `.or('usuario_id.eq.X,usuario_id.is.null')`
            // — cada condição vira um OU; sem isso o fake "vazaria" tudo,
            // o que esconderia exatamente o bug que este teste quer pegar.
            or(expressao) {
              const condicoes = String(expressao)
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean)
                .map((c) => {
                  const [campo, operador, ...resto] = c.split('.');
                  return { campo, operador, valor: resto.join('.') };
                });
              filtros.push(['or', condicoes]);
              return builder;
            },
            order() {
              return builder;
            },
            limit() {
              return builder;
            },
            then(resolve, reject) {
              const base = tabela === 'ai_messages' ? messages : tabela === 'ai_memories' ? memories : [];
              let resultado = base;
              for (const filtro of filtros) {
                if (filtro[0] === 'eq') {
                  const [, campo, valor] = filtro;
                  resultado = resultado.filter((r) => r[campo] === valor);
                } else if (filtro[0] === 'or') {
                  const condicoes = filtro[1];
                  resultado = resultado.filter((r) =>
                    condicoes.some(({ campo, operador, valor }) => {
                      if (operador === 'eq') return r[campo] === valor;
                      if (operador === 'is' && valor === 'null') return r[campo] === null || r[campo] === undefined;
                      return false;
                    }),
                  );
                }
              }
              return Promise.resolve({ data: resultado, error: null }).then(resolve, reject);
            },
          };
          return builder;
        },
        delete() {
          chamadas.deletes.push({ tabela });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };

  return { db, chamadas, conversations, messages, memories };
}

/* ==========================================================================
   1/2. Criar nova conversa gera um conversation_id novo e diferente
   ========================================================================== */

test('criarConversa gera um conversation_id novo', async () => {
  const { db } = criarDbFake();
  const id = await criarConversa(db, 'user-1');
  assert.ok(id);
  assert.equal(typeof id, 'string');
});

test('duas chamadas seguidas geram ids DIFERENTES — nunca reaproveita a conversa anterior', async () => {
  const { db } = criarDbFake();
  const id1 = await criarConversa(db, 'user-1');
  const id2 = await criarConversa(db, 'user-1');
  assert.notEqual(id1, id2);
});

test('a conversa nova é criada com o usuario_id certo, título padrão', async () => {
  const { db, chamadas } = criarDbFake();
  await criarConversa(db, 'user-42');
  const insercao = chamadas.inserts.find((i) => i.tabela === 'ai_conversations');
  assert.equal(insercao.linha.usuario_id, 'user-42');
  assert.equal(insercao.linha.titulo, 'Nova conversa');
});

/* ==========================================================================
   3/4. Nada antigo é removido — nem mensagem, nem conversa, nem memória
   ========================================================================== */

test('criarConversa nunca chama delete em tabela nenhuma', async () => {
  const { db, chamadas } = criarDbFake();
  await criarConversa(db, 'user-1');
  assert.equal(chamadas.deletes.length, 0);
});

test('criarConversa só insere em ai_conversations — nunca toca ai_messages nem ai_memories', async () => {
  const { db, chamadas } = criarDbFake();
  await criarConversa(db, 'user-1');
  assert.deepEqual(chamadas.inserts.map((i) => i.tabela), ['ai_conversations']);
});

/* ==========================================================================
   5. A nova conversa começa sem nenhuma mensagem da conversa anterior
   ========================================================================== */

test('conversa nova não tem nenhuma mensagem — mensagens antigas continuam só na conversa de origem', async () => {
  const { db } = criarDbFake({
    messages: [
      { conversa_id: 'conversa-A', papel: 'user', conteudo: 'Me chama de Iong daqui pra frente.' },
      { conversa_id: 'conversa-A', papel: 'assistant', conteudo: 'Combinado, Iong!' },
    ],
  });

  const novoId = await criarConversa(db, 'user-1');

  // Simula a mesma consulta que carregarHistorico faz, filtrando pela
  // conversa NOVA — tem que vir vazia, mesmo com mensagens de outra
  // conversa no mesmo "banco".
  const { data: historicoDaNova } = await db.from('ai_messages').select('papel, conteudo').eq('conversa_id', novoId);
  assert.deepEqual(historicoDaNova, []);

  // E a conversa A original continua com as duas mensagens dela, intactas.
  const { data: historicoDaOriginal } = await db.from('ai_messages').select('papel, conteudo').eq('conversa_id', 'conversa-A');
  assert.equal(historicoDaOriginal.length, 2);
});

/* ==========================================================================
   6. Memória persistente continua entrando no contexto da conversa nova
   ========================================================================== */

test('carregarMemorias é filtrada só por usuario_id — nunca recebe/depende de conversa_id', async () => {
  const { db } = criarDbFake({
    memories: [{ id: 'mem-1', tipo: 'preferencia', conteudo: 'Prefere ser chamado de Iong', chaves: ['nome_preferido'], usuario_id: 'user-1', ativo: true }],
  });

  // A "conversa A" nem existe pra esta função — carregarMemorias não recebe
  // conversaId como parâmetro (assinatura: (db, usuarioId)). Chamar de novo
  // "depois de trocar de conversa" dá exatamente o mesmo resultado, porque
  // não há como ela saber (nem precisar saber) qual conversa está ativa.
  const memoriasNaConversaA = await carregarMemorias(db, 'user-1');
  const idNovaConversa = await criarConversa(db, 'user-1'); // troca de conversa, do ponto de vista do usuário
  const memoriasNaConversaB = await carregarMemorias(db, 'user-1');

  assert.ok(idNovaConversa);
  assert.deepEqual(memoriasNaConversaA, memoriasNaConversaB);
  assert.equal(memoriasNaConversaB.length, 1);
  assert.equal(memoriasNaConversaB[0].conteudo, 'Prefere ser chamado de Iong');
});

test('memória de um usuário nunca aparece pra outro, mesmo depois de criar conversa nova', async () => {
  const { db } = criarDbFake({
    memories: [{ id: 'mem-1', tipo: 'preferencia', conteudo: 'Prefere ser chamado de Carlos', chaves: ['nome_preferido'], usuario_id: 'user-OUTRO', ativo: true }],
  });
  await criarConversa(db, 'user-1');
  const memorias = await carregarMemorias(db, 'user-1');
  assert.deepEqual(memorias, []);
});

/* ==========================================================================
   ehAbortoIntencional — cancelamento de streaming em voo ("Nova conversa"
   clicada durante uma resposta ainda chegando)

   A função pura que decide "isto é um abort proposital, não um erro de
   rede" (shared/regras-nexo-ai.ts). `src/nexo-ai/cliente.ts` usa isto nos
   dois pontos que podem lançar por causa de um `AbortController.abort()`
   externo: o `fetch` inicial e a leitura do stream — nos dois casos, um
   aborto intencional retorna sem chamar `cb.aoErro`, então o usuário nunca
   vê "conexão interrompida" por algo que ELE mesmo pediu.
   ========================================================================== */

test('reconhece um AbortError de verdade (o que um AbortController real produz)', () => {
  const controlador = new AbortController();
  controlador.abort();
  // O padrão real: uma promise rejeitada por um fetch/reader abortado
  // rejeita com isto (DOMException 'AbortError', ou equivalente).
  const erroReal = controlador.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  assert.equal(ehAbortoIntencional(erroReal), true);
});

test('reconhece qualquer objeto com name="AbortError", sem exigir DOMException especificamente', () => {
  assert.equal(ehAbortoIntencional({ name: 'AbortError' }), true);
  assert.equal(ehAbortoIntencional(new Error('AbortError')), false, 'a MENSAGEM não conta — só o campo name');
  const erroComName = new Error('cancelado');
  erroComName.name = 'AbortError';
  assert.equal(ehAbortoIntencional(erroComName), true);
});

test('NÃO reconhece um erro de rede comum como aborto — continua virando cb.aoErro', () => {
  assert.equal(ehAbortoIntencional(new TypeError('Failed to fetch')), false);
  assert.equal(ehAbortoIntencional(new Error('network error')), false);
});

test('nunca lança para entrada estranha — null, undefined, string, número', () => {
  assert.equal(ehAbortoIntencional(null), false);
  assert.equal(ehAbortoIntencional(undefined), false);
  assert.equal(ehAbortoIntencional('erro qualquer'), false);
  assert.equal(ehAbortoIntencional(42), false);
  assert.equal(ehAbortoIntencional({}), false);
});

/* ==========================================================================
   Nota sobre cobertura — o que fica FORA deste arquivo
   ==========================================================================
   Requisitos 7 ("clique duplo não cria duas conversas indevidas") e 8
   ("falha ao criar conversa não apaga a conversa atual"), e agora também o
   cancelamento em si (associar/abortar o AbortController, a guarda de
   geração como defesa adicional), vivem inteiramente em `useNexoAI.ts`
   (estado React: `criandoConversaRef`/`criandoConversa`/`controladorAtual`,
   ordem de efeitos colaterais em `novaConversa`/`enviar`). Este projeto não
   tem jsdom — hooks com estado/DOM não são exercitados pelo `node --test`
   (ver também os comentários equivalentes em nexo-ai-tts-credencial.test.js
   sobre a fila de voz). Implementado e revisado manualmente:
     - duplo clique: `criandoConversaRef` (useRef, síncrono) é checado e
       marcado ANTES de qualquer `await`, então a 2ª chamada síncrona
       retorna cedo mesmo que o React ainda não tenha re-renderizado com
       `criandoConversa=true`; o botão também fica `disabled` nesse meio
       tempo.
     - falha não apaga a conversa atual: `novaConversa()` só chama
       `.abort()` e escreve em `conversaId.current`/`mensagens`/estado
       DEPOIS que `criarNovaConversa()` resolve com sucesso — qualquer erro
       (rede, sessão) cai no `catch`, que só seta `erro`, sem abortar nada
       nem tocar em nenhum estado da conversa em andamento.
     - cancelamento real: `enviar()` cria um `AbortController` novo por
       requisição, guarda a referência em `controladorAtual`, e passa
       `.signal` pro `conversarStream` (testável em `cliente.ts`, coberto
       indiretamente pelos testes de `ehAbortoIntencional` acima — o
       comportamento de NÃO chamar `cb.aoErro` num abort real depende do
       `fetch`/`ReadableStream` do navegador, que não existe neste runner).
     - guarda de geração como defesa adicional: preservada e documentada no
       próprio código (`conversaGeracao`), continua sendo a mesma checagem
       já testada estruturalmente pelo desenho do `useRef` — sem jsdom não
       há como disparar o React re-render que a exercitaria de ponta a
       ponta. */

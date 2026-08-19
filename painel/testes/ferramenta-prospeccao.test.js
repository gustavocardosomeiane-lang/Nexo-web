/**
 * Testes da ferramenta `buscar_leads_locais` (Etapa 4).
 *
 * Cobre a integração completa — validação de entrada, chamada real a
 * `buscarLeadsLocais`, carregamento de dedup, e a importação no Supabase —
 * sempre com `fetch` mockado (Google Places + análise de site) e um cliente
 * Supabase FALSO (sem rede nenhuma, sem custo nenhum).
 *
 * Testa pelo limite público real: `executarFerramenta('buscar_leads_locais', ...)`
 * — o mesmo caminho que `conversar.ts` usa em produção.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { executarFerramenta, definicoesDe } from '../api/_lib/nexo-ai/ferramentas.ts';

const fetchOriginal = global.fetch;

test.beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'chave-de-teste-nao-deve-vazar';
});

test.afterEach(() => {
  global.fetch = fetchOriginal;
});

const PERMITIDAS = ['buscar_leads_locais'];

/* --------------------------------------------------------------------------
   Fábricas — Google Places
   -------------------------------------------------------------------------- */

// Telefone/endereço ÚNICOS a cada chamada, de propósito: dois candidatos
// numa mesma busca não podem colidir por acidente no dedup (telefone é o
// 2º critério de prioridade) só porque a fábrica usou o mesmo valor padrão
// duas vezes. Testes que QUEREM colisão sobrescrevem explicitamente.
let proximoSufixo = 10000;
function placeBruto(sobrescrever = {}) {
  proximoSufixo += 1;
  return {
    id: 'place-1',
    displayName: { text: 'Clínica Estética Bella' },
    formattedAddress: `Rua de Teste ${proximoSufixo}, Setor Oeste, Goiânia - GO`,
    internationalPhoneNumber: `+55 62 9${proximoSufixo}`,
    websiteUri: undefined, // sem site => maior score, e evita fetch de site nos testes simples
    addressComponents: [{ longText: 'Goiânia', types: ['locality'] }],
    ...sobrescrever,
  };
}

function respostaJson(corpo, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

/** Mock de fetch: Google Text Search/Details. Nenhum candidato tem site por padrão — sem chamada de análise a mockar. */
function mockarGoogle({ paginas }) {
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.endsWith(':searchText')) return respostaJson(paginas);
    if (typeof url === 'string' && url.includes('/places/')) return respostaJson({ error: { message: 'sem detalhe' } }, 404);
    throw new Error(`URL inesperada no mock: ${url}`);
  };
}

/* --------------------------------------------------------------------------
   Fábrica — cliente Supabase falso
   -------------------------------------------------------------------------- */

/**
 * Simula só o subconjunto do cliente Supabase que `ferramentas.ts` usa:
 *   db.from('leads').select(campos)                       -> dedup
 *   db.from('leads').insert(linhas).select(campos)         -> lote
 *   db.from('leads').insert(linha).select(campos).single() -> fallback por linha
 */
function criarDbFake({ leadsExistentes = [], inserirComportamento }) {
  const chamadasSelect = [];

  const db = {
    from(tabela) {
      return {
        select(campos) {
          chamadasSelect.push({ tabela, campos });
          return Promise.resolve({ data: leadsExistentes, error: null });
        },
        insert(linhaOuLinhas) {
          const ehArray = Array.isArray(linhaOuLinhas);
          const linhas = ehArray ? linhaOuLinhas : [linhaOuLinhas];
          return {
            select() {
              const promessa = Promise.resolve().then(() => inserirComportamento(linhas, ehArray));
              promessa.single = async () => {
                const r = await inserirComportamento(linhas, ehArray);
                if (r.error) return { data: null, error: r.error };
                return { data: r.data[0] ?? null, error: null };
              };
              return promessa;
            },
          };
        },
      };
    },
  };

  return { db, chamadasSelect };
}

let contadorId = 0;
function inserirTudoComSucesso(linhas) {
  return {
    data: linhas.map((l) => ({
      id: `novo-${++contadorId}`,
      place_id: l.place_id,
      nome: l.nome,
      cidade: l.cidade,
      score_oportunidade: l.score_oportunidade,
    })),
    error: null,
  };
}

const CTX = (db) => ({ db, usuarioId: 'usr-teste', papel: 'administrador' });

/* ==========================================================================
   Validação de entrada
   ========================================================================== */

test('nicho ausente: pede a informação em vez de buscar', async () => {
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });
  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );
  assert.ok(resultado.erro);
  assert.match(resultado.erro, /nicho/i);
});

test('cidade ausente: pede a informação em vez de buscar', async () => {
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });
  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica de estética' }, CTX(db), PERMITIDAS),
  );
  assert.ok(resultado.erro);
  assert.match(resultado.erro, /cidade/i);
});

test('nicho/cidade vazios ou não-string são tratados como ausentes', async () => {
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });
  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: '   ', cidade: 42 }, CTX(db), PERMITIDAS),
  );
  assert.ok(resultado.erro);
});

test('quantidade acima de 30 é limitada a 30 — nunca rejeitada com erro', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 500 },
      CTX(db),
      PERMITIDAS,
    ),
  );

  assert.equal(resultado.solicitados, 30);
});

test('quantidade abaixo de 1 é elevada a 1', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: -5 },
      CTX(db),
      PERMITIDAS,
    ),
  );

  assert.equal(resultado.solicitados, 1);
});

test('quantidade ausente usa o padrão de 30', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica de estética', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.solicitados, 30);
});

/* ==========================================================================
   Autorização por papel
   ========================================================================== */

test('financeiro não pode importar leads automaticamente (só vê o módulo, não cria)', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica', cidade: 'Goiânia' },
      { db, usuarioId: 'usr-fin', papel: 'financeiro' },
      PERMITIDAS,
    ),
  );

  assert.ok(resultado.erro);
  assert.match(resultado.erro, /administradores e vendedores/i);
});

test('colaborador não pode importar leads automaticamente', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica', cidade: 'Goiânia' },
      { db, usuarioId: 'usr-colab', papel: 'colaborador' },
      PERMITIDAS,
    ),
  );

  assert.ok(resultado.erro);
});

test('vendedor pode importar leads automaticamente', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica', cidade: 'Goiânia' },
      { db, usuarioId: 'usr-vend', papel: 'vendedor' },
      PERMITIDAS,
    ),
  );

  assert.equal(resultado.erro, undefined);
  assert.equal(resultado.importados, 1);
});

/* ==========================================================================
   Comando válido — fluxo completo
   ========================================================================== */

test('comando válido: busca, importa e devolve o resultado estruturado esperado', async () => {
  mockarGoogle({
    paginas: {
      places: [
        placeBruto({ id: 'p1', displayName: { text: 'Clínica A' } }),
        placeBruto({ id: 'p2', displayName: { text: 'Clínica B' } }),
      ],
    },
  });
  const { db, chamadasSelect } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 10 },
      CTX(db),
      PERMITIDAS,
    ),
  );

  assert.equal(resultado.solicitados, 10);
  assert.equal(resultado.encontrados, 2);
  assert.equal(resultado.analisados, 2);
  assert.equal(resultado.duplicados, 0);
  assert.equal(resultado.importados, 2);
  assert.equal(resultado.descartados, 0);
  assert.equal(Array.isArray(resultado.leads), true);
  assert.equal(resultado.leads.length, 2);
  assert.ok('nome' in resultado.leads[0]);
  assert.ok('score_oportunidade' in resultado.leads[0]);

  // Só os campos de dedup foram pedidos — nada a mais.
  assert.equal(chamadasSelect.length, 1);
  assert.equal(chamadasSelect[0].tabela, 'leads');
  assert.equal(chamadasSelect[0].campos, 'id, place_id, telefone, site, nome, endereco');
});

test('carregamento de leads existentes acontece ANTES da importação (dedup usa dado fresco)', async () => {
  mockarGoogle({ paginas: { places: [placeBruto({ id: 'ja-existe' })] } });
  const { db } = criarDbFake({
    leadsExistentes: [
      { id: 'lead-banco', place_id: 'ja-existe', telefone: null, site: null, nome: 'x', endereco: null },
    ],
    inserirComportamento: inserirTudoComSucesso,
  });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.duplicados, 1);
  assert.equal(resultado.importados, 0);
});

/* ==========================================================================
   Regra de importação
   ========================================================================== */

test('lead importado entra com status=novo e origem=prospeccao_ia', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  let linhaCapturada = null;
  const { db } = criarDbFake({
    inserirComportamento: (linhas) => {
      linhaCapturada = linhas[0];
      return inserirTudoComSucesso(linhas);
    },
  });

  await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS);

  assert.equal(linhaCapturada.status, 'novo');
  assert.equal(linhaCapturada.origem, 'prospeccao_ia');
  assert.equal(linhaCapturada.nome, 'Clínica Estética Bella');
  assert.match(linhaCapturada.telefone, /^\+55 62 9\d+$/);
  assert.equal(linhaCapturada.whatsapp, linhaCapturada.telefone);
  assert.equal(linhaCapturada.cidade, 'Goiânia');
  assert.equal(linhaCapturada.nicho, 'clínica');
  assert.ok(linhaCapturada.place_id);
  assert.equal(typeof linhaCapturada.score_oportunidade, 'number');
  assert.equal(typeof linhaCapturada.motivo_score, 'string');
  assert.ok(linhaCapturada.data_entrada);
  assert.match(linhaCapturada.data_entrada, /^\d{4}-\d{2}-\d{2}$/);
});

test('quantidade solicitada é respeitada — nunca importa mais do que foi pedido', async () => {
  mockarGoogle({
    paginas: {
      places: [
        placeBruto({ id: 'p1' }),
        placeBruto({ id: 'p2' }),
        placeBruto({ id: 'p3' }),
        placeBruto({ id: 'p4' }),
      ],
    },
  });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta(
      'buscar_leads_locais',
      { nicho: 'clínica', cidade: 'Goiânia', quantidade: 2 },
      CTX(db),
      PERMITIDAS,
    ),
  );

  assert.equal(resultado.importados, 2);
  assert.equal(resultado.encontrados, 4);
  assert.equal(resultado.descartados, 2, 'os 2 excedentes (não duplicados, mas além da quantidade) contam como descartados');
});

test('duplicados nunca chegam a ser inseridos no banco', async () => {
  mockarGoogle({
    paginas: {
      places: [placeBruto({ id: 'novo' }), placeBruto({ id: 'ja-existe', displayName: { text: 'Já é lead' } })],
    },
  });
  let linhasInseridas = [];
  const { db } = criarDbFake({
    leadsExistentes: [
      { id: 'lead-banco', place_id: 'ja-existe', telefone: null, site: null, nome: 'x', endereco: null },
    ],
    inserirComportamento: (linhas) => {
      linhasInseridas = linhas;
      return inserirTudoComSucesso(linhas);
    },
  });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.duplicados, 1);
  assert.equal(resultado.importados, 1);
  assert.equal(linhasInseridas.length, 1);
  assert.equal(linhasInseridas[0].place_id, 'novo');
});

/* ==========================================================================
   Conflito de place_id por condição de corrida
   ========================================================================== */

test('conflito de place_id na inserção em lote: refaz por linha, não derruba o lote', async () => {
  mockarGoogle({
    paginas: {
      places: [
        placeBruto({ id: 'sem-conflito-1' }),
        placeBruto({ id: 'colide-numa-corrida' }),
        placeBruto({ id: 'sem-conflito-2' }),
      ],
    },
  });

  let tentativasEmLote = 0;
  const { db } = criarDbFake({
    inserirComportamento: (linhas, ehArray) => {
      const temColisao = linhas.some((l) => l.place_id === 'colide-numa-corrida');
      if (ehArray && linhas.length > 1) {
        tentativasEmLote += 1;
        if (temColisao) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      if (temColisao) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      return inserirTudoComSucesso(linhas);
    },
  });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(tentativasEmLote, 1, 'tentou em lote primeiro, como preferido');
  assert.equal(resultado.importados, 2, 'os dois sem conflito entraram');
  assert.equal(resultado.duplicados, 1, 'o que colidiu na corrida conta como duplicado, não como erro');
});

test('falha parcial de insert: mistura de sucesso e conflito, todos contabilizados corretamente', async () => {
  mockarGoogle({
    paginas: {
      places: [placeBruto({ id: 'ok-1' }), placeBruto({ id: 'colide' }), placeBruto({ id: 'ok-2' })],
    },
  });
  const { db } = criarDbFake({
    inserirComportamento: (linhas, ehArray) => {
      if (ehArray && linhas.length > 1) {
        return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      if (linhas[0].place_id === 'colide') {
        return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      return inserirTudoComSucesso(linhas);
    },
  });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.importados, 2);
  assert.equal(resultado.duplicados, 1);
});

test('erro de Supabase que NÃO é conflito de unicidade vira erro tratado, não crash', async () => {
  mockarGoogle({ paginas: { places: [placeBruto()] } });
  const { db } = criarDbFake({
    inserirComportamento: () => ({ data: null, error: { code: 'XXTHERR', message: 'conexão perdida com o banco' } }),
  });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.ok(resultado.erro);
  assert.doesNotMatch(resultado.erro, /conexão perdida/i, 'o erro cru do banco não deve vazar pro usuário');
});

/* ==========================================================================
   Erros do Google tratados
   ========================================================================== */

test('GOOGLE_PLACES_API_KEY ausente: erro amigável, sem crash', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.ok(resultado.erro);
  assert.doesNotMatch(resultado.erro, /GOOGLE_PLACES_API_KEY/);
});

test('Google Places indisponível (quota/429): erro amigável específico', async () => {
  global.fetch = async () => respostaJson({ error: { message: 'Resource has been exhausted' } }, 429);
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.ok(resultado.erro);
  assert.match(resultado.erro, /limite de requisições/i);
});

test('erro de rede ao contatar o Google: erro amigável, sem stack técnico', async () => {
  global.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.ok(resultado.erro);
  assert.doesNotMatch(resultado.erro, /TypeError|fetch failed/);
});

/* ==========================================================================
   Casos sem erro, mas sem importação
   ========================================================================== */

test('nenhum negócio encontrado: resultado zerado, sem erro', async () => {
  mockarGoogle({ paginas: { places: [] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.erro, undefined);
  assert.equal(resultado.encontrados, 0);
  assert.equal(resultado.importados, 0);
});

test('todos os candidatos duplicados: zero importados, sem erro', async () => {
  mockarGoogle({ paginas: { places: [placeBruto({ id: 'ja-existe' })] } });
  const { db } = criarDbFake({
    leadsExistentes: [
      { id: 'lead-banco', place_id: 'ja-existe', telefone: null, site: null, nome: 'x', endereco: null },
    ],
    inserirComportamento: inserirTudoComSucesso,
  });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.erro, undefined);
  assert.equal(resultado.duplicados, 1);
  assert.equal(resultado.importados, 0);
});

test('nenhum candidato com dado mínimo suficiente (sem nome): zero importados, contam como descartados', async () => {
  mockarGoogle({ paginas: { places: [placeBruto({ displayName: { text: '' } })] } });
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const resultado = JSON.parse(
    await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS),
  );

  assert.equal(resultado.erro, undefined);
  assert.equal(resultado.importados, 0);
  assert.equal(resultado.descartados, 1);
});

/* ==========================================================================
   Segurança: nenhum segredo aparece
   ========================================================================== */

test('a chave do Google nunca aparece em nenhum resultado, mesmo em erro', async () => {
  const chave = process.env.GOOGLE_PLACES_API_KEY;
  global.fetch = async () => respostaJson({ error: { message: 'erro qualquer' } }, 500);
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const bruto = await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS);

  assert.equal(bruto.includes(chave), false);
});

test('mesmo se o Google "vazasse" algo sensível na mensagem de erro, a resposta final é sempre um texto fixo', async () => {
  global.fetch = async () => respostaJson({ error: { message: 'segredo-vazado-pelo-google-hipotetico-xyz' } }, 500);
  const { db } = criarDbFake({ inserirComportamento: inserirTudoComSucesso });

  const bruto = await executarFerramenta('buscar_leads_locais', { nicho: 'clínica', cidade: 'Goiânia' }, CTX(db), PERMITIDAS);

  assert.equal(bruto.includes('segredo-vazado-pelo-google-hipotetico-xyz'), false);
});

/* ==========================================================================
   Definição exposta ao modelo
   ========================================================================== */

test('a definição da ferramenta exige nicho e cidade, e não pede segredo nenhum', () => {
  const [definicao] = definicoesDe(['buscar_leads_locais']);
  assert.equal(definicao.nome, 'buscar_leads_locais');
  assert.deepEqual(definicao.parametros.required, ['nicho', 'cidade']);
  assert.equal(JSON.stringify(definicao).toLowerCase().includes('api_key'), false);
});

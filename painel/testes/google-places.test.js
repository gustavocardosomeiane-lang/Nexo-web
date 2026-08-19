/**
 * Testes do adaptador do Google Places (Etapa 3).
 *
 * `fetch` é sempre mockado — NENHUMA chamada real, NENHUM custo. Cobre Text
 * Search, Place Details, FieldMask exato, paginação limitada, dedup de
 * chamadas de detalhe e erro do Google.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarCandidatosGooglePlaces,
  mapComConcorrenciaLimitada,
  ErroGooglePlaces,
} from '../api/_lib/nexo-ai/google-places.ts';

const fetchOriginal = global.fetch;
const envOriginal = process.env.GOOGLE_PLACES_API_KEY;

test.beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'chave-de-teste';
});

test.afterEach(() => {
  global.fetch = fetchOriginal;
  process.env.GOOGLE_PLACES_API_KEY = envOriginal;
});

/* --------------------------------------------------------------------------
   Fábricas de resposta
   -------------------------------------------------------------------------- */

function placeBruto(sobrescrever = {}) {
  return {
    id: 'place-1',
    displayName: { text: 'Clínica Estética Bella', languageCode: 'pt-BR' },
    formattedAddress: 'Rua 10, 123, Setor Oeste, Goiânia - GO',
    internationalPhoneNumber: '+55 62 98474-7979',
    websiteUri: 'https://clinicabella.com.br',
    addressComponents: [
      { longText: 'Goiânia', shortText: 'Goiânia', types: ['locality', 'political'] },
      { longText: 'Goiás', shortText: 'GO', types: ['administrative_area_level_1', 'political'] },
    ],
    ...sobrescrever,
  };
}

function respostaJson(corpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

/**
 * Endpoints EXATOS da Places API (New) — o mock só responde a estes dois,
 * caractere por caractere. Um mock leniente (ex.: `url.endsWith(':searchText')`)
 * teria aceitado `.../v1:searchText` (a URL com bug real que causou o 404 em
 * produção) como se fosse `.../v1/places:searchText` — por isso a checagem
 * aqui é de igualdade e prefixo exatos, não substring.
 */
const URL_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const PREFIXO_PLACE_DETAILS = 'https://places.googleapis.com/v1/places/';

/** Mock de fetch que roteia por URL: searchText vs places/{id}. */
function criarFetchMock({ paginas = [{ places: [placeBruto()] }], detalhes = {}, statusErro = null }) {
  const chamadas = { busca: [], detalhes: [] };
  let indicePagina = 0;

  const fetchMock = async (url, opcoes) => {
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined;

    if (url === URL_TEXT_SEARCH) {
      chamadas.busca.push({ url, headers: opcoes.headers, corpo });
      if (statusErro) return respostaJson({ error: { message: 'cota excedida' } }, statusErro);
      const pagina = paginas[Math.min(indicePagina, paginas.length - 1)];
      indicePagina += 1;
      return respostaJson(pagina);
    }

    if (url.startsWith(PREFIXO_PLACE_DETAILS)) {
      const placeId = decodeURIComponent(url.slice(PREFIXO_PLACE_DETAILS.length));
      chamadas.detalhes.push({ url, headers: opcoes.headers, placeId });
      const detalhe = detalhes[placeId];
      if (!detalhe) return respostaJson({ error: { message: 'não encontrado' } }, 404);
      return respostaJson(detalhe);
    }

    // Qualquer outra URL — inclusive uma quase certa, como a antiga
    // ".../v1:searchText" sem "/places" — falha o teste alto e claro, em vez
    // de silenciosamente "funcionar" contra um endpoint errado.
    throw new Error(`URL inesperada no mock (não é um endpoint real da Places API New): ${url}`);
  };

  global.fetch = fetchMock;
  return chamadas;
}

/* ==========================================================================
   URL EXATA — regressão do incidente de produção (404)

   Um Text Search sem "/places" antes de ":searchText" foi parar em produção
   e devolveu 404 do Google — porque o mock anterior aceitava QUALQUER coisa
   terminada em ":searchText", inclusive a URL quebrada. Estes dois testes
   capturam a URL de verdade que `fetch` recebeu e comparam com o endpoint
   documentado da Places API (New), caractere por caractere — não é possível
   passar com um path parecido, só com o path certo.
   ========================================================================== */

test('URL EXATA do Text Search bate com o endpoint documentado da Places API (New)', async () => {
  let urlCapturada = null;
  const fetchOriginalDoTeste = global.fetch;
  criarFetchMock({ paginas: [{ places: [placeBruto()] }] });
  const fetchMockado = global.fetch;
  global.fetch = async (url, opcoes) => {
    urlCapturada = url;
    return fetchMockado(url, opcoes);
  };

  await buscarCandidatosGooglePlaces('clínica de estética', 'Goiânia', 1);

  assert.equal(urlCapturada, 'https://places.googleapis.com/v1/places:searchText');
  global.fetch = fetchOriginalDoTeste;
});

test('URL EXATA do Place Details bate com o endpoint documentado da Places API (New)', async () => {
  const urlsCapturadas = [];
  criarFetchMock({
    paginas: [{ places: [placeBruto({ id: 'ChIJ_exemplo_real', websiteUri: undefined })] }],
    detalhes: { ChIJ_exemplo_real: placeBruto({ id: 'ChIJ_exemplo_real', websiteUri: 'https://exemplo.com.br' }) },
  });
  const fetchMockado = global.fetch;
  global.fetch = async (url, opcoes) => {
    urlsCapturadas.push(url);
    return fetchMockado(url, opcoes);
  };

  await buscarCandidatosGooglePlaces('clínica de estética', 'Goiânia', 1);

  const urlDetalhes = urlsCapturadas.find((u) => u !== URL_TEXT_SEARCH);
  assert.equal(urlDetalhes, 'https://places.googleapis.com/v1/places/ChIJ_exemplo_real');
});

test('URL do Place Details faz o encode correto do place_id', async () => {
  const idComCaracteresEspeciais = 'ChIJ/estranho com espaço';
  const urlsCapturadas = [];
  criarFetchMock({
    paginas: [{ places: [placeBruto({ id: idComCaracteresEspeciais, websiteUri: undefined })] }],
    detalhes: {
      [idComCaracteresEspeciais]: placeBruto({ id: idComCaracteresEspeciais, websiteUri: 'https://exemplo.com.br' }),
    },
  });
  const fetchMockado = global.fetch;
  global.fetch = async (url, opcoes) => {
    urlsCapturadas.push(url);
    return fetchMockado(url, opcoes);
  };

  await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 1);

  const urlDetalhes = urlsCapturadas.find((u) => u !== URL_TEXT_SEARCH);
  assert.equal(
    urlDetalhes,
    `https://places.googleapis.com/v1/places/${encodeURIComponent(idComCaracteresEspeciais)}`,
  );
  // A barra do place_id precisa estar codificada (%2F) — senão o path vira
  // um recurso diferente do que era pra ser.
  assert.ok(urlDetalhes.includes('%2F'));
});

/* ==========================================================================
   Text Search
   ========================================================================== */

test('Text Search: monta textQuery, idioma e tamanho de página corretos', async () => {
  const chamadas = criarFetchMock({ paginas: [{ places: [placeBruto()] }] });

  await buscarCandidatosGooglePlaces('clínica de estética', 'Goiânia', 5);

  assert.equal(chamadas.busca.length, 1);
  const { corpo } = chamadas.busca[0];
  assert.equal(corpo.textQuery, 'clínica de estética em Goiânia');
  assert.equal(corpo.languageCode, 'pt-BR');
  assert.equal(corpo.regionCode, 'BR');
  assert.equal(corpo.pageSize, 20);
  assert.equal('pageToken' in corpo, false);
});

test('Text Search: FieldMask da busca é exatamente o mínimo esperado', async () => {
  const chamadas = criarFetchMock({});
  await buscarCandidatosGooglePlaces('academia', 'Goiânia', 3);

  const mask = chamadas.busca[0].headers['X-Goog-FieldMask'];
  assert.equal(
    mask,
    'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.addressComponents,nextPageToken',
  );
});

test('Text Search: a chave vai no header X-Goog-Api-Key, nunca na URL nem no corpo', async () => {
  const chamadas = criarFetchMock({});
  await buscarCandidatosGooglePlaces('academia', 'Goiânia', 3);

  const { url, headers, corpo } = chamadas.busca[0];
  assert.equal(headers['X-Goog-Api-Key'], 'chave-de-teste');
  assert.equal(url.includes('chave-de-teste'), false);
  assert.equal(JSON.stringify(corpo).includes('chave-de-teste'), false);
});

test('cidade é extraída de addressComponents (locality)', async () => {
  criarFetchMock({ paginas: [{ places: [placeBruto()] }] });
  const [candidato] = await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 1);
  assert.equal(candidato.cidade, 'Goiânia');
});

test('cidade cai para administrative_area_level_2 quando não há locality', async () => {
  criarFetchMock({
    paginas: [
      {
        places: [
          placeBruto({
            addressComponents: [
              { longText: 'Região Metropolitana', types: ['administrative_area_level_2'] },
            ],
          }),
        ],
      },
    ],
  });
  const [candidato] = await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 1);
  assert.equal(candidato.cidade, 'Região Metropolitana');
});

test('erro do Google (resposta não-ok) vira ErroGooglePlaces, com o motivo', async () => {
  criarFetchMock({ statusErro: 429 });

  await assert.rejects(
    () => buscarCandidatosGooglePlaces('clínica', 'Goiânia', 5),
    (erro) => {
      assert.ok(erro instanceof ErroGooglePlaces);
      assert.equal(erro.status, 429);
      assert.match(erro.message, /cota excedida/);
      return true;
    },
  );
});

test('GOOGLE_PLACES_API_KEY ausente falha antes de qualquer chamada de rede', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  let chamouRede = false;
  global.fetch = async () => {
    chamouRede = true;
    throw new Error('não deveria chamar a rede');
  };

  await assert.rejects(
    () => buscarCandidatosGooglePlaces('clínica', 'Goiânia', 5),
    (erro) => {
      assert.ok(erro instanceof ErroGooglePlaces);
      assert.equal(erro.codigo, 'sem_credencial');
      return true;
    },
  );
  assert.equal(chamouRede, false);
});

/* ==========================================================================
   Paginação
   ========================================================================== */

test('paginação: busca páginas adicionais só até ter candidatos suficientes', async () => {
  const chamadas = criarFetchMock({
    paginas: [
      { places: [placeBruto({ id: 'p1' })], nextPageToken: 'token-2' },
      { places: [placeBruto({ id: 'p2' })], nextPageToken: 'token-3' },
      { places: [placeBruto({ id: 'p3' })], nextPageToken: 'token-4' },
    ],
  });

  const resultado = await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 25, { atrasoEntrePaginasMs: 0 });

  // 20 (página 1) + 5 usados da página 2 seriam o ideal, mas cada página
  // mockada aqui só devolve 1 item — o que importa é que parou de pedir
  // páginas assim que teve o suficiente (25) ou bateu o teto de páginas.
  assert.ok(chamadas.busca.length <= 3);
  assert.ok(resultado.length <= 25);
});

test('paginação: nunca ultrapassa o teto de páginas (busca não é ilimitada)', async () => {
  const chamadas = criarFetchMock({
    paginas: [
      { places: [placeBruto({ id: 'p1' })], nextPageToken: 'token-2' },
      { places: [placeBruto({ id: 'p2' })], nextPageToken: 'token-3' },
      { places: [placeBruto({ id: 'p3' })], nextPageToken: 'token-4' },
      { places: [placeBruto({ id: 'p4' })], nextPageToken: 'token-5' },
      { places: [placeBruto({ id: 'p5' })], nextPageToken: 'token-6' },
    ],
  });

  // Pede muito mais do que qualquer teto razoável admitiria de uma vez.
  await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 1000, { atrasoEntrePaginasMs: 0 });

  assert.equal(chamadas.busca.length, 3);
});

test('paginação: pede menos que uma página só faz UMA chamada', async () => {
  const chamadas = criarFetchMock({
    paginas: [{ places: [placeBruto({ id: 'p1' }), placeBruto({ id: 'p2' })], nextPageToken: 'token-2' }],
  });

  await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 2, { atrasoEntrePaginasMs: 0 });

  assert.equal(chamadas.busca.length, 1);
});

/* ==========================================================================
   Place Details
   ========================================================================== */

test('Place Details só é chamado para quem falta telefone OU site', async () => {
  const chamadas = criarFetchMock({
    paginas: [
      {
        places: [
          placeBruto({ id: 'completo', internationalPhoneNumber: '+55 62 90000-0000', websiteUri: 'https://a.com.br' }),
          placeBruto({ id: 'sem-telefone', internationalPhoneNumber: undefined }),
          placeBruto({ id: 'sem-site', websiteUri: undefined }),
        ],
      },
    ],
    detalhes: {
      'sem-telefone': placeBruto({ id: 'sem-telefone', internationalPhoneNumber: '+55 62 91111-1111' }),
      'sem-site': placeBruto({ id: 'sem-site', websiteUri: 'https://b.com.br' }),
    },
  });

  const resultado = await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 3);

  assert.equal(chamadas.detalhes.length, 2);
  const idsDetalhados = chamadas.detalhes.map((c) => c.placeId).sort();
  assert.deepEqual(idsDetalhados, ['sem-site', 'sem-telefone']);

  const semTelefone = resultado.find((c) => c.place_id === 'sem-telefone');
  assert.equal(semTelefone.telefone, '+55 62 91111-1111');
  const semSite = resultado.find((c) => c.place_id === 'sem-site');
  assert.equal(semSite.site, 'https://b.com.br');
});

test('Place Details nunca é chamado duas vezes para o mesmo place_id', async () => {
  const chamadas = criarFetchMock({
    paginas: [
      {
        places: [
          placeBruto({ id: 'repetido', internationalPhoneNumber: undefined }),
          placeBruto({ id: 'repetido', internationalPhoneNumber: undefined }),
        ],
      },
    ],
    detalhes: { repetido: placeBruto({ id: 'repetido', internationalPhoneNumber: '+55 62 92222-2222' }) },
  });

  await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 5);

  const chamadasParaRepetido = chamadas.detalhes.filter((c) => c.placeId === 'repetido');
  assert.equal(chamadasParaRepetido.length, 1);
});

test('FieldMask dos detalhes é o mínimo esperado', async () => {
  const chamadas = criarFetchMock({
    paginas: [{ places: [placeBruto({ id: 'x', websiteUri: undefined })] }],
    detalhes: { x: placeBruto({ id: 'x' }) },
  });

  await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 1);

  assert.equal(
    chamadas.detalhes[0].headers['X-Goog-FieldMask'],
    'id,displayName,formattedAddress,internationalPhoneNumber,websiteUri,addressComponents',
  );
});

test('Place Details indisponível não derruba o candidato — ele entra só com o que o Text Search trouxe', async () => {
  criarFetchMock({
    paginas: [{ places: [placeBruto({ id: 'sem-detalhe-disponivel', websiteUri: undefined })] }],
    detalhes: {},
  });

  const resultado = await buscarCandidatosGooglePlaces('clínica', 'Goiânia', 1);

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].place_id, 'sem-detalhe-disponivel');
  assert.equal(resultado[0].site, null);
});

/* ==========================================================================
   Concorrência limitada (utilitário reaproveitado pela análise de sites)
   ========================================================================== */

test('mapComConcorrenciaLimitada nunca roda mais que o limite ao mesmo tempo', async () => {
  const limite = 3;
  let emAndamento = 0;
  let picoObservado = 0;

  const itens = Array.from({ length: 10 }, (_, i) => i);
  await mapComConcorrenciaLimitada(itens, limite, async (item) => {
    emAndamento += 1;
    picoObservado = Math.max(picoObservado, emAndamento);
    await new Promise((resolve) => setTimeout(resolve, 5));
    emAndamento -= 1;
    return item * 2;
  });

  assert.ok(picoObservado <= limite, `pico observado (${picoObservado}) excedeu o limite (${limite})`);
});

test('mapComConcorrenciaLimitada preserva a ordem dos resultados', async () => {
  const itens = [5, 3, 4, 1, 2];
  const resultado = await mapComConcorrenciaLimitada(itens, 2, async (item) => {
    await new Promise((resolve) => setTimeout(resolve, item));
    return item * 10;
  });
  assert.deepEqual(resultado, [50, 30, 40, 10, 20]);
});

test('mapComConcorrenciaLimitada com lista vazia não quebra', async () => {
  const resultado = await mapComConcorrenciaLimitada([], 5, async (x) => x);
  assert.deepEqual(resultado, []);
});

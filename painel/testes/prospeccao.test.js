/**
 * Testes do orquestrador da prospecção automática (Etapa 3).
 *
 * Cobre o fluxo completo — Google Places -> análise de site -> score ->
 * dedup -> resultado preparado — inteiramente com `fetch` mockado. Confirma
 * também as duas garantias mais importantes combinadas com você: um site
 * que falha não derruba o lote, e a concorrência da análise nunca ultrapassa
 * o limite configurado.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarLeadsLocais,
  CONCORRENCIA_ANALISE_SITE,
} from '../api/_lib/nexo-ai/prospeccao.ts';

const fetchOriginal = global.fetch;

test.beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'chave-de-teste';
});

test.afterEach(() => {
  global.fetch = fetchOriginal;
});

/* --------------------------------------------------------------------------
   Fábricas
   -------------------------------------------------------------------------- */

function placeBruto(sobrescrever = {}) {
  return {
    id: 'place-1',
    displayName: { text: 'Clínica Estética Bella' },
    formattedAddress: 'Rua 10, 123, Setor Oeste, Goiânia - GO',
    internationalPhoneNumber: '+55 62 98474-7979',
    websiteUri: 'https://clinicabella.com.br',
    addressComponents: [{ longText: 'Goiânia', types: ['locality'] }],
    ...sobrescrever,
  };
}

function respostaJson(corpo, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

function htmlSaudavel() {
  return '<html><head><meta name="viewport" content="width=device-width"></head><body><a href="tel:+5562984747979">Ligar</a></body></html>';
}

/**
 * Mock de fetch central: roteia por padrão de URL.
 *   - Google Text Search  -> `paginas`
 *   - Google Place Details -> `detalhes`
 *   - qualquer outra URL  -> tratada como o SITE do candidato, resolvida por
 *     `sites[url]` (ou por `sitePadrao`, se `sites` não tiver aquela URL).
 */
function criarFetchMock({ paginas, detalhes = {}, sites = {}, sitePadrao }) {
  const emAndamentoPorTipo = { site: 0 };
  const picoPorTipo = { site: 0 };

  const fetchMock = async (url, opcoes = {}) => {
    if (typeof url === 'string' && url.endsWith(':searchText')) {
      return respostaJson(paginas);
    }
    if (typeof url === 'string' && url.includes('places.googleapis.com/v1/places/')) {
      const placeId = decodeURIComponent(url.split('/places/')[1]);
      const detalhe = detalhes[placeId];
      return detalhe ? respostaJson(detalhe) : respostaJson({ error: { message: 'não encontrado' } }, 404);
    }

    // Chamada de análise de site.
    emAndamentoPorTipo.site += 1;
    picoPorTipo.site = Math.max(picoPorTipo.site, emAndamentoPorTipo.site);

    const definicao = sites[url] ?? sitePadrao;
    try {
      if (!definicao) return { ok: true, status: 200, url, headers: { get: () => null }, text: async () => htmlSaudavel() };
      if (definicao.tipo === 'timeout') {
        return new Promise((_resolve, reject) => {
          opcoes.signal?.addEventListener('abort', () => {
            const erro = new Error('abortado');
            erro.name = 'AbortError';
            reject(erro);
          });
        });
      }
      if (definicao.tipo === 'erro-rede') {
        throw new TypeError('fetch failed');
      }
      if (definicao.tipo === 'status') {
        return { ok: false, status: definicao.status, url, headers: { get: () => null }, text: async () => '' };
      }
      // 'ok' (padrão): pequeno atraso artificial pra dar chance de observar concorrência real.
      await new Promise((resolve) => setTimeout(resolve, definicao.atrasoMs ?? 3));
      return {
        ok: true,
        status: 200,
        url: definicao.urlFinal ?? url,
        headers: { get: (nome) => definicao.headers?.[nome.toLowerCase()] ?? null },
        text: async () => definicao.html ?? htmlSaudavel(),
      };
    } finally {
      emAndamentoPorTipo.site -= 1;
    }
  };

  global.fetch = fetchMock;
  return { picoPorTipo };
}

/* ==========================================================================
   Formato do resultado
   ========================================================================== */

test('buscarLeadsLocais devolve todos os campos esperados por candidato', async () => {
  criarFetchMock({ paginas: { places: [placeBruto()] } });

  const [lead] = await buscarLeadsLocais({ nicho: 'clínica de estética', cidade: 'Goiânia', quantidade: 1 });

  assert.equal(lead.nome, 'Clínica Estética Bella');
  assert.equal(lead.telefone, '+55 62 98474-7979');
  assert.equal(lead.endereco, 'Rua 10, 123, Setor Oeste, Goiânia - GO');
  assert.equal(lead.cidade, 'Goiânia');
  assert.equal(lead.nicho, 'clínica de estética');
  assert.equal(lead.site, 'https://clinicabella.com.br');
  assert.equal(lead.place_id, 'place-1');
  assert.equal(lead.origem, 'prospeccao_ia');
  assert.equal(lead.status, 'novo');
  assert.equal(typeof lead.score_oportunidade, 'number');
  assert.equal(typeof lead.motivo_score, 'string');
  assert.ok(lead.analise_site);
  assert.ok(lead.analisado_em);
  assert.equal(lead.duplicado, false);
  assert.equal(lead.motivo_duplicidade, null);
});

test('cidade cai para a cidade pesquisada quando o Google não devolve locality', async () => {
  criarFetchMock({ paginas: { places: [placeBruto({ addressComponents: [] })] } });

  const [lead] = await buscarLeadsLocais({ nicho: 'academia', cidade: 'Anápolis', quantidade: 1 });
  assert.equal(lead.cidade, 'Anápolis');
});

/* ==========================================================================
   Candidato sem site
   ========================================================================== */

test('candidato sem site: score de "sem site", nenhum fetch de análise, analise_site nula', async () => {
  criarFetchMock({
    paginas: { places: [placeBruto({ websiteUri: undefined })] },
    detalhes: {},
  });
  // Envolve o mock: qualquer chamada que não seja Text Search/Details só
  // pode ser uma tentativa de analisar um site — e não deveria acontecer
  // aqui, já que o único candidato não tem `site`.
  const fetchGooglePlaces = global.fetch;
  let chamouSite = false;
  global.fetch = async (url, opcoes) => {
    const ehGoogle = typeof url === 'string' && (url.endsWith(':searchText') || url.includes('/places/'));
    if (!ehGoogle) chamouSite = true;
    return fetchGooglePlaces(url, opcoes);
  };

  const [lead] = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 1 });

  assert.equal(lead.site, null);
  assert.equal(lead.analise_site, null);
  assert.equal(lead.analisado_em, null);
  assert.ok(lead.score_oportunidade >= 90, `esperado score alto, recebeu ${lead.score_oportunidade}`);
  assert.match(lead.motivo_score, /Não tem site/);
  assert.equal(chamouSite, false, 'não deveria ter feito nenhum fetch para um candidato sem site');
});

/* ==========================================================================
   Resiliência do lote
   ========================================================================== */

test('lote continua mesmo quando um site falha (timeout em um não derruba os outros)', async () => {
  const candidatos = [
    placeBruto({ id: 'ok-1', websiteUri: 'https://site-ok-1.com.br' }),
    placeBruto({ id: 'com-timeout', websiteUri: 'https://site-lento.com.br' }),
    placeBruto({ id: 'ok-2', websiteUri: 'https://site-ok-2.com.br' }),
  ];

  criarFetchMock({
    paginas: { places: candidatos },
    sites: {
      'https://site-lento.com.br': { tipo: 'timeout' },
    },
    sitePadrao: { tipo: 'ok' },
  });

  const resultado = await buscarLeadsLocais(
    { nicho: 'clínica', cidade: 'Goiânia', quantidade: 3 },
    [],
    { timeoutAnaliseSiteMs: 20 },
  );

  assert.equal(resultado.length, 3);
  const comTimeout = resultado.find((l) => l.place_id === 'com-timeout');
  assert.equal(comTimeout.analise_site.acessivel, false);
  assert.equal(comTimeout.analise_site.erro, 'timeout');

  const outros = resultado.filter((l) => l.place_id !== 'com-timeout');
  assert.ok(outros.every((l) => l.analise_site.acessivel === true));
});

test('lote continua mesmo com erro de rede em um site', async () => {
  const candidatos = [
    placeBruto({ id: 'ok', websiteUri: 'https://site-ok.com.br' }),
    placeBruto({ id: 'com-erro-rede', websiteUri: 'https://site-fora-do-ar.com.br' }),
  ];

  criarFetchMock({
    paginas: { places: candidatos },
    sites: { 'https://site-fora-do-ar.com.br': { tipo: 'erro-rede' } },
    sitePadrao: { tipo: 'ok' },
  });

  const resultado = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 2 });

  assert.equal(resultado.length, 2);
  const comErro = resultado.find((l) => l.place_id === 'com-erro-rede');
  assert.equal(comErro.analise_site.erro, 'rede');
  const ok = resultado.find((l) => l.place_id === 'ok');
  assert.equal(ok.analise_site.acessivel, true);
});

/* ==========================================================================
   Concorrência
   ========================================================================== */

test('concorrência da análise de sites nunca ultrapassa CONCORRENCIA_ANALISE_SITE', async () => {
  const quantidade = 20;
  const candidatos = Array.from({ length: quantidade }, (_, i) =>
    placeBruto({ id: `p${i}`, websiteUri: `https://site-${i}.com.br` }),
  );

  const { picoPorTipo } = criarFetchMock({
    paginas: { places: candidatos },
    sitePadrao: { tipo: 'ok', atrasoMs: 8 },
  });

  await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade });

  assert.ok(
    picoPorTipo.site <= CONCORRENCIA_ANALISE_SITE,
    `pico observado (${picoPorTipo.site}) excedeu o limite (${CONCORRENCIA_ANALISE_SITE})`,
  );
  assert.ok(picoPorTipo.site > 1, 'esperava alguma concorrência real, não uma análise por vez');
});

/* ==========================================================================
   Deduplicação após enriquecimento
   ========================================================================== */

test('dedup: candidato com place_id já existente no banco vem marcado como duplicado', async () => {
  criarFetchMock({ paginas: { places: [placeBruto({ id: 'ja-existe' })] } });

  const existentes = [
    {
      id: 'lead-do-banco',
      place_id: 'ja-existe',
      telefone: null,
      site: null,
      nome: 'Outro nome qualquer',
      endereco: null,
    },
  ];

  const [lead] = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 1 }, existentes);

  assert.equal(lead.duplicado, true);
  assert.equal(lead.motivo_duplicidade, 'place_id');
});

test('dedup: candidato com telefone já existente no banco (formato diferente) vem marcado como duplicado', async () => {
  criarFetchMock({
    paginas: { places: [placeBruto({ id: 'novo-place-id', internationalPhoneNumber: '+55 62 98474-7979' })] },
  });

  const existentes = [
    { id: 'lead-do-banco', place_id: null, telefone: '(62) 98474-7979', site: null, nome: 'x', endereco: null },
  ];

  const [lead] = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 1 }, existentes);

  assert.equal(lead.duplicado, true);
  assert.equal(lead.motivo_duplicidade, 'telefone');
});

test('dedup: dois candidatos do mesmo lote com o mesmo place_id — o segundo vem duplicado', async () => {
  criarFetchMock({
    paginas: {
      places: [
        placeBruto({ id: 'repetido', displayName: { text: 'Empresa A' } }),
        placeBruto({ id: 'repetido', displayName: { text: 'Empresa A' } }),
      ],
    },
  });

  const resultado = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 2 });

  assert.equal(resultado[0].duplicado, false);
  assert.equal(resultado[1].duplicado, true);
  assert.equal(resultado[1].motivo_duplicidade, 'place_id');
});

test('candidato realmente novo vem com duplicado=false e motivo_duplicidade=null', async () => {
  criarFetchMock({ paginas: { places: [placeBruto({ id: 'totalmente-novo' })] } });

  const existentes = [
    {
      id: 'lead-nao-relacionado',
      place_id: 'outro-place-id',
      telefone: '62911112222',
      site: 'https://outraempresa.com.br',
      nome: 'Empresa Não Relacionada',
      endereco: 'Endereço bem diferente',
    },
  ];

  const [lead] = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 1 }, existentes);

  assert.equal(lead.duplicado, false);
  assert.equal(lead.motivo_duplicidade, null);
});

/* ==========================================================================
   Determinismo do fluxo completo
   ========================================================================== */

test('determinismo: a mesma busca mockada sempre devolve o mesmo score e motivo', async () => {
  criarFetchMock({ paginas: { places: [placeBruto()] } });
  const [a] = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 1 });

  criarFetchMock({ paginas: { places: [placeBruto()] } });
  const [b] = await buscarLeadsLocais({ nicho: 'clínica', cidade: 'Goiânia', quantidade: 1 });

  assert.equal(a.score_oportunidade, b.score_oportunidade);
  assert.equal(a.motivo_score, b.motivo_score);
});

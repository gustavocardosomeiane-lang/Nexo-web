/**
 * Testes das regras puras de prospecção automática (Etapa 2).
 *
 * Cobre normalização, deduplicação e score de oportunidade — tudo sem rede,
 * sem banco, sem modelo de IA. Cada teste corresponde a um caso combinado
 * com você antes de implementar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto,
  normalizarNome,
  normalizarEndereco,
  normalizarTelefone,
  normalizarDominio,
  verificarDuplicidade,
  deduplicarLote,
  calcularScoreOportunidade,
  PESOS_SCORE,
} from '../shared/regras-prospeccao.ts';

/* --------------------------------------------------------------------------
   Fábricas
   -------------------------------------------------------------------------- */

function registro(sobrescrever = {}) {
  return {
    id: 'existente-1',
    place_id: null,
    telefone: null,
    site: null,
    nome: 'Clínica Estética Bella',
    endereco: 'Rua 10, 123, Setor Oeste, Goiânia',
    ...sobrescrever,
  };
}

function analiseSaudavel(sobrescrever = {}) {
  return {
    tem_site: true,
    acessivel: true,
    status_http: 200,
    https: true,
    viewport_mobile: true,
    tempo_resposta_ms: 400,
    tamanho_bytes: 200_000,
    tem_cta: true,
    erro: null,
    ...sobrescrever,
  };
}

/* ==========================================================================
   1. Normalização
   ========================================================================== */

test('normalizarTexto remove acento, caixa e espaço duplicado', () => {
  assert.equal(normalizarTexto('  Clínica   São José  '), 'clinica sao jose');
});

test('normalizarTexto de entrada vazia/nula não quebra', () => {
  assert.equal(normalizarTexto(null), '');
  assert.equal(normalizarTexto(undefined), '');
  assert.equal(normalizarTexto(''), '');
});

test('normalizarNome trata acento e maiúsculas como o mesmo nome', () => {
  assert.equal(normalizarNome('Clínica Estética Bella'), normalizarNome('CLINICA ESTETICA BELLA'));
  assert.equal(normalizarNome('Açaí do Bairro'), normalizarNome('acai do bairro'));
});

test('normalizarEndereco ignora acento, maiúsculas e pontuação', () => {
  assert.equal(
    normalizarEndereco('Av. T-9, 500 - Setor Bueno'),
    normalizarEndereco('av t 9 500 setor bueno'),
  );
});

test('normalizarTelefone reconhece o mesmo número em formatos diferentes', () => {
  const a = normalizarTelefone('(62) 98474-7979');
  const b = normalizarTelefone('5562984747979');
  const c = normalizarTelefone('62 9 8474-7979');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a, '62984747979');
});

test('normalizarTelefone: números diferentes não colidem', () => {
  assert.notEqual(normalizarTelefone('62984747979'), normalizarTelefone('62999998888'));
});

test('normalizarTelefone: ausente ou curto demais vira string vazia, nunca falso positivo', () => {
  assert.equal(normalizarTelefone(null), '');
  assert.equal(normalizarTelefone(undefined), '');
  assert.equal(normalizarTelefone('123'), '');
  assert.equal(normalizarTelefone(''), '');
});

test('normalizarDominio reconhece o mesmo domínio em URLs diferentes', () => {
  const variantes = [
    'https://www.exemplo.com.br/pagina?utm=x',
    'http://exemplo.com.br',
    'WWW.EXEMPLO.COM.BR',
    'exemplo.com.br/',
    'https://exemplo.com.br:443/contato#topo',
  ];
  const normalizados = new Set(variantes.map(normalizarDominio));
  assert.equal(normalizados.size, 1);
  assert.ok(normalizados.has('exemplo.com.br'));
});

test('normalizarDominio: domínios diferentes não colidem', () => {
  assert.notEqual(normalizarDominio('https://exemplo.com.br'), normalizarDominio('https://outraempresa.com.br'));
});

test('normalizarDominio de entrada vazia/nula não quebra', () => {
  assert.equal(normalizarDominio(null), '');
  assert.equal(normalizarDominio(''), '');
});

/* ==========================================================================
   2. Deduplicação
   ========================================================================== */

test('place_id igual = duplicado, mesmo com o resto diferente', () => {
  const existentes = [registro({ id: 'lead-1', place_id: 'ChIJ_abc123', nome: 'Nome Antigo', endereco: 'Endereço Antigo' })];
  const candidato = registro({
    place_id: 'ChIJ_abc123',
    nome: 'Nome Totalmente Diferente',
    endereco: 'Outro endereço qualquer',
    telefone: '11999998888',
  });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, true);
  assert.equal(resultado.motivo, 'place_id');
  assert.equal(resultado.correspondeA, 'lead-1');
});

test('telefone normalizado igual = duplicado, mesmo com place_id ausente', () => {
  const existentes = [registro({ id: 'lead-2', telefone: '(62) 98474-7979' })];
  const candidato = registro({ telefone: '5562984747979', nome: 'Outro nome', endereco: 'Outro endereço' });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, true);
  assert.equal(resultado.motivo, 'telefone');
  assert.equal(resultado.correspondeA, 'lead-2');
});

test('domínio normalizado igual = duplicado, mesmo com URLs escritas diferente', () => {
  const existentes = [registro({ id: 'lead-3', site: 'https://www.exemplo.com.br' })];
  const candidato = registro({ site: 'http://exemplo.com.br/contato', nome: 'Outro nome', endereco: 'Outro endereço' });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, true);
  assert.equal(resultado.motivo, 'dominio');
  assert.equal(resultado.correspondeA, 'lead-3');
});

test('nome + endereço normalizados iguais = duplicado, quando não há place_id/telefone/site', () => {
  const existentes = [registro({ id: 'lead-4', nome: 'Salão Beleza Pura', endereco: 'Rua das Flores, 45' })];
  const candidato = registro({ nome: 'SALAO BELEZA PURA', endereco: 'rua das flores, 45' });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, true);
  assert.equal(resultado.motivo, 'nome_endereco');
  assert.equal(resultado.correspondeA, 'lead-4');
});

test('nome igual mas endereço diferente NÃO é duplicado', () => {
  const existentes = [registro({ id: 'lead-5', nome: 'Salão Beleza Pura', endereco: 'Rua das Flores, 45' })];
  const candidato = registro({ nome: 'Salão Beleza Pura', endereco: 'Avenida Central, 900' });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, false);
});

test('empresas completamente diferentes NÃO são duplicadas', () => {
  const existentes = [
    registro({ id: 'lead-6', place_id: 'ChIJ_xyz', telefone: '62911112222', site: 'https://outraempresa.com.br' }),
  ];
  const candidato = registro({
    place_id: 'ChIJ_diferente',
    telefone: '62933334444',
    site: 'https://empresanova.com.br',
    nome: 'Empresa Totalmente Nova',
    endereco: 'Endereço nunca visto',
  });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, false);
  assert.equal(resultado.motivo, null);
  assert.equal(resultado.correspondeA, null);
});

test('dois leads sem telefone/site/place_id não colidem só por estarem vazios', () => {
  const existentes = [registro({ id: 'lead-7', place_id: null, telefone: null, site: null, nome: 'A', endereco: null })];
  const candidato = registro({ place_id: null, telefone: null, site: null, nome: 'B', endereco: null });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.duplicado, false);
});

test('ordem de prioridade: place_id vence mesmo quando telefone bate com outro registro', () => {
  const existentes = [
    registro({ id: 'lead-por-telefone', telefone: '62984747979' }),
    registro({ id: 'lead-por-place-id', place_id: 'ChIJ_certo', telefone: '62911110000' }),
  ];
  const candidato = registro({ place_id: 'ChIJ_certo', telefone: '62984747979' });

  const resultado = verificarDuplicidade(candidato, existentes);
  assert.equal(resultado.motivo, 'place_id');
  assert.equal(resultado.correspondeA, 'lead-por-place-id');
});

test('deduplicarLote: candidatos duplicados entre si (place_id repetido na mesma busca)', () => {
  const candidatos = [
    registro({ id: 'cand-1', place_id: 'ChIJ_repetido', nome: 'Padaria Trigo Dourado' }),
    registro({ id: 'cand-2', place_id: 'ChIJ_repetido', nome: 'Padaria Trigo Dourado' }),
  ];

  const resultados = deduplicarLote(candidatos, []);

  assert.equal(resultados[0].duplicado, false);
  assert.equal(resultados[1].duplicado, true);
  assert.equal(resultados[1].motivo, 'place_id');
  assert.equal(resultados[1].correspondeA, 'cand-1');
});

test('deduplicarLote: candidato duplicado do banco não é confundido com duplicado do lote', () => {
  const existentes = [registro({ id: 'lead-banco', place_id: 'ChIJ_ja_no_banco' })];
  const candidatos = [
    registro({ id: 'cand-1', place_id: 'ChIJ_ja_no_banco' }),
    // nome/endereço PRECISAM ser diferentes do padrão da fábrica aqui — senão
    // este candidato bateria com "lead-banco" por nome_endereco (4º critério)
    // e o teste pararia de isolar o que ele realmente verifica: que o motivo
    // do bloqueio de cand-1 (place_id) não vaza para cand-2.
    registro({
      id: 'cand-2',
      place_id: 'ChIJ_novo',
      nome: 'Empresa Bem Diferente',
      endereco: 'Endereço nunca visto antes',
    }),
  ];

  const resultados = deduplicarLote(candidatos, existentes);

  assert.equal(resultados[0].duplicado, true);
  assert.equal(resultados[0].correspondeA, 'lead-banco');
  assert.equal(resultados[1].duplicado, false);
});

/* ==========================================================================
   3. Score de oportunidade
   ========================================================================== */

test('empresa sem site: score altíssimo', () => {
  const resultado = calcularScoreOportunidade({
    tem_site: false,
    acessivel: false,
    status_http: null,
    https: false,
    viewport_mobile: false,
    tempo_resposta_ms: null,
    tamanho_bytes: null,
    tem_cta: false,
    erro: null,
  });

  assert.equal(resultado.score_oportunidade, PESOS_SCORE.semSite);
  assert.equal(resultado.fatores.length, 1);
  assert.equal(resultado.fatores[0].fator, 'sem_site');
  assert.match(resultado.motivo_score, /Oportunidade muito forte/);
});

test('site quebrado/não responde: score muito alto, igual à mesma faixa de "sem site"', () => {
  const resultado = calcularScoreOportunidade(
    analiseSaudavel({ tem_site: true, acessivel: false, erro: 'timeout' }),
  );

  assert.equal(resultado.score_oportunidade, PESOS_SCORE.siteNaoAcessivel);
  assert.equal(resultado.fatores[0].fator, 'site_nao_acessivel');
  assert.match(resultado.motivo_score, /timeout/);
});

test('site bom (saudável, moderno): score baixo — baixa prioridade', () => {
  const resultado = calcularScoreOportunidade(analiseSaudavel());

  assert.equal(resultado.score_oportunidade, PESOS_SCORE.baseSiteAcessivel);
  assert.equal(resultado.fatores.length, 1);
  assert.match(resultado.motivo_score, /Baixa prioridade/);
});

test('site parcialmente ruim: soma só os fatores que realmente falharam', () => {
  const resultado = calcularScoreOportunidade(
    analiseSaudavel({ https: true, viewport_mobile: false, tempo_resposta_ms: 1000, tem_cta: true }),
  );

  assert.equal(resultado.score_oportunidade, PESOS_SCORE.baseSiteAcessivel + PESOS_SCORE.semViewportMobile);
  const fatores = resultado.fatores.map((f) => f.fator);
  assert.deepEqual(fatores, ['base_site_acessivel', 'sem_viewport_mobile']);
});

test('site com todos os problemas técnicos: soma todos os fatores, sem estourar 100', () => {
  const resultado = calcularScoreOportunidade(
    analiseSaudavel({ https: false, viewport_mobile: false, tempo_resposta_ms: 9000, tem_cta: false }),
  );

  const somaEsperada =
    PESOS_SCORE.baseSiteAcessivel +
    PESOS_SCORE.semHttps +
    PESOS_SCORE.semViewportMobile +
    PESOS_SCORE.respostaLenta +
    PESOS_SCORE.semCta;

  assert.equal(resultado.score_oportunidade, somaEsperada);
  assert.ok(resultado.score_oportunidade <= 100);
  assert.equal(resultado.fatores.length, 5);
});

test('resposta lenta só conta acima do limite configurado', () => {
  const dentroDoLimite = calcularScoreOportunidade(analiseSaudavel({ tempo_resposta_ms: PESOS_SCORE.limiteRespostaLentaMs }));
  const acimaDoLimite = calcularScoreOportunidade(
    analiseSaudavel({ tempo_resposta_ms: PESOS_SCORE.limiteRespostaLentaMs + 1 }),
  );

  assert.equal(dentroDoLimite.fatores.some((f) => f.fator === 'resposta_lenta'), false);
  assert.equal(acimaDoLimite.fatores.some((f) => f.fator === 'resposta_lenta'), true);
});

test('tempo de resposta desconhecido (null) não penaliza', () => {
  const resultado = calcularScoreOportunidade(analiseSaudavel({ tempo_resposta_ms: null }));
  assert.equal(resultado.fatores.some((f) => f.fator === 'resposta_lenta'), false);
});

test('score nunca sai da faixa 0-100, em qualquer combinação', () => {
  const combinacoes = [true, false];
  for (const tem_site of combinacoes) {
    for (const acessivel of combinacoes) {
      for (const https of combinacoes) {
        for (const viewport_mobile of combinacoes) {
          for (const tem_cta of combinacoes) {
            const resultado = calcularScoreOportunidade({
              tem_site,
              acessivel,
              status_http: acessivel ? 200 : null,
              https,
              viewport_mobile,
              tempo_resposta_ms: 5000,
              tamanho_bytes: null,
              tem_cta,
              erro: acessivel ? null : 'erro genérico',
            });
            assert.ok(resultado.score_oportunidade >= 0, `score abaixo de 0: ${resultado.score_oportunidade}`);
            assert.ok(resultado.score_oportunidade <= 100, `score acima de 100: ${resultado.score_oportunidade}`);
          }
        }
      }
    }
  }
});

test('determinismo: mesma análise sempre devolve o mesmo resultado', () => {
  const analise = analiseSaudavel({ https: false, viewport_mobile: false });
  const a = calcularScoreOportunidade(analise);
  const b = calcularScoreOportunidade(analise);
  assert.deepEqual(a, b);
});

test('determinismo: chamadas repetidas não acumulam estado entre si', () => {
  const semSite = calcularScoreOportunidade({
    tem_site: false,
    acessivel: false,
    status_http: null,
    https: false,
    viewport_mobile: false,
    tempo_resposta_ms: null,
    tamanho_bytes: null,
    tem_cta: false,
    erro: null,
  });
  const depoisSaudavel = calcularScoreOportunidade(analiseSaudavel());

  assert.equal(semSite.score_oportunidade, PESOS_SCORE.semSite);
  assert.equal(depoisSaudavel.score_oportunidade, PESOS_SCORE.baseSiteAcessivel);
});

/**
 * Testes do fallback determinístico da resposta final da NEXO AI —
 * investigação do incidente "[nexo-ai] erro (stream em andamento): O Groq
 * não retornou uma resposta." depois de uma prospecção BEM-SUCEDIDA (leads
 * já buscados e importados no Supabase).
 *
 * `respostaFallbackProspeccao` (api/nexo-ai/conversar.ts) é função pura:
 * recebe o MESMO JSON que `executarFerramenta('buscar_leads_locais', ...)`
 * já produziu nesta requisição e devolve uma frase pronta, sem chamar rede,
 * sem reexecutar a busca no Google Places nem a importação no Supabase.
 * `global.fetch` fica envenenado no arquivo inteiro: se qualquer teste
 * disparasse uma chamada de rede, isso provaria uma reexecução indevida da
 * ferramenta — e o teste falharia alto e claro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { respostaFallbackProspeccao } from '../api/nexo-ai/conversar.ts';

const fetchOriginal = global.fetch;

test.before(() => {
  global.fetch = async (url) => {
    throw new Error(`respostaFallbackProspeccao nunca deveria chamar fetch — reexecutaria a busca: ${url}`);
  };
});

test.after(() => {
  global.fetch = fetchOriginal;
});

/* ==========================================================================
   Caso principal: leads importados
   ========================================================================== */

test('leads importados: resposta com os números reais, no plural', () => {
  const conteudo = JSON.stringify({
    solicitados: 20,
    encontrados: 20,
    analisados: 20,
    duplicados: 6,
    importados: 4,
    descartados: 10,
    leads: [{ nome: 'Clínica A', cidade: 'Goiânia', score_oportunidade: 88 }],
  });

  assert.equal(
    respostaFallbackProspeccao(conteudo),
    'Busca concluída. Encontrei 20 empresas e importei 4 novos leads que ainda não estavam cadastrados.',
  );
});

test('singular correto quando encontrados=1 e importados=1', () => {
  const conteudo = JSON.stringify({ encontrados: 1, importados: 1 });
  assert.equal(
    respostaFallbackProspeccao(conteudo),
    'Busca concluída. Encontrei 1 empresa e importei 1 novo lead que ainda não estava cadastrado.',
  );
});

/* ==========================================================================
   Nenhum lead importado — ainda é sucesso, resposta diferente
   ========================================================================== */

test('nenhum lead importado (todos duplicados ou fora do critério): explica sem inventar causa', () => {
  const conteudo = JSON.stringify({ solicitados: 10, encontrados: 8, importados: 0, duplicados: 8 });
  assert.equal(
    respostaFallbackProspeccao(conteudo),
    'Busca concluída. Analisei 8 empresas, mas nenhuma nova passou pelos critérios ou todas já estavam cadastradas.',
  );
});

test('nenhum negócio encontrado (encontrados=0, importados=0): mesma resposta de "sem novidade", sem erro', () => {
  const conteudo = JSON.stringify({ encontrados: 0, importados: 0 });
  assert.equal(
    respostaFallbackProspeccao(conteudo),
    'Busca concluída. Analisei 0 empresas, mas nenhuma nova passou pelos critérios ou todas já estavam cadastradas.',
  );
});

/* ==========================================================================
   Não é caso de "sucesso sem texto" — o fallback recusa (null)
   ========================================================================== */

test('ferramenta reportou erro (Google Places, Supabase, etc.): fallback recusa — não inventa "busca concluída"', () => {
  const conteudo = JSON.stringify({ erro: 'Não foi possível buscar negócios locais agora. Tente de novo em instantes.' });
  assert.equal(respostaFallbackProspeccao(conteudo), null);
});

test('JSON inválido: fallback recusa (null), nunca lança exceção', () => {
  assert.equal(respostaFallbackProspeccao('isto não é json'), null);
  assert.equal(respostaFallbackProspeccao(''), null);
});

test('faltando "encontrados" ou "importados": fallback recusa (null) em vez de adivinhar', () => {
  assert.equal(respostaFallbackProspeccao(JSON.stringify({ importados: 2 })), null);
  assert.equal(respostaFallbackProspeccao(JSON.stringify({ encontrados: 5 })), null);
  assert.equal(respostaFallbackProspeccao(JSON.stringify({ leads: [] })), null);
});

/* ==========================================================================
   Segurança / não-duplicação: nunca reexecuta busca nem importação
   ========================================================================== */

test('nunca chama fetch — não reexecuta o Google Places nem a importação no Supabase', () => {
  // Se chamasse fetch, o test.before acima já teria lançado e este teste
  // falharia com a mensagem "reexecutaria a busca".
  respostaFallbackProspeccao(JSON.stringify({ encontrados: 3, importados: 1 }));
  respostaFallbackProspeccao(JSON.stringify({ encontrados: 0, importados: 0 }));
  assert.ok(true, 'nenhuma chamada de rede foi disparada');
});

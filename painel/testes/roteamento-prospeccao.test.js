/**
 * Testes do ROTEAMENTO de intenção da prospecção — distinguir "descobrir
 * negócio novo fora do CRM" de "consultar/filtrar leads que já existem".
 *
 * CONTEXTO DO INCIDENTE: em produção, um pedido de prospecção que mencionava
 * "3 leads" foi classificado como leitura do CRM (a NEXO respondeu com o
 * total de leads já cadastrados e pediu filtros), e a resposta seguinte, em
 * formato de formulário ("Nicho: ... / Localização: ... / Quantidade: ..."),
 * não continuou o fluxo de prospecção. Ver `pareceComandoDeProspeccao` em
 * api/_lib/nexo-ai/ferramentas.ts para a causa e a correção.
 *
 * Nenhum teste aqui toca rede — `pareceComandoDeProspeccao` é palavra-chave
 * pura, sem Groq, sem Google Places, sem Supabase.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pareceComandoDeProspeccao } from '../api/_lib/nexo-ai/ferramentas.ts';

function turno(papel, conteudo) {
  return { papel, conteudo };
}

/* ==========================================================================
   1. Comando completo de prospecção em uma frase
   ========================================================================== */

test('comando completo de prospecção em uma frase é reconhecido', () => {
  assert.equal(
    pareceComandoDeProspeccao('NEXO, procure 3 clínicas de estética em Goiânia que não tenham site ou tenham site ruim.'),
    true,
  );
});

test('variações do comando completo — todas reconhecidas', () => {
  assert.equal(pareceComandoDeProspeccao('busque novos leads de clínicas de estética em Goiânia'), true);
  assert.equal(pareceComandoDeProspeccao('quero 3 leads novos de clínicas de estética em Goiânia'), true);
  assert.equal(pareceComandoDeProspeccao('prospecte clínicas de estética em Goiânia'), true);
  assert.equal(pareceComandoDeProspeccao('encontre negócios locais que precisam de site'), true);
  assert.equal(pareceComandoDeProspeccao('traga 3 empresas de estética em Goiânia'), true);
});

/* ==========================================================================
   2. "quero 3 leads novos"
   ========================================================================== */

test('"quero 3 leads novos" é reconhecido como prospecção, mesmo sem verbo de descoberta', () => {
  assert.equal(pareceComandoDeProspeccao('quero 3 leads novos'), true);
});

test('"quero novos leads" (sem número) também é reconhecido', () => {
  assert.equal(pareceComandoDeProspeccao('quero novos leads'), true);
});

/* ==========================================================================
   3. Mensagem estruturada Nicho/Localização/Quantidade
   ========================================================================== */

test('mensagem estruturada isolada (sem turno anterior de prospecção) NÃO é reconhecida', () => {
  const estruturada = [
    'Nicho: Clínicas de estética',
    'Localização: Goiânia – GO',
    'Quantidade: 3 leads',
  ].join('\n');
  // Sem histórico nenhum, uma mensagem só de dados não tem como saber que é
  // continuação de prospecção — é o comportamento correto: pedir contexto.
  assert.equal(pareceComandoDeProspeccao(estruturada), false);
});

/* ==========================================================================
   4. Mensagem estruturada como SEGUNDO turno — o cenário do incidente
   ========================================================================== */

test('mensagem estruturada como segundo turno de uma prospecção iniciada antes É reconhecida', () => {
  const historico = [
    turno('user', 'Procure clínicas de estética em Goiânia.'),
    turno('assistant', 'Já temos 269 leads no CRM. Quer que eu filtre algum status específico?'),
  ];
  const estruturada = [
    'Nicho: Clínicas de estética',
    'Localização: Goiânia – GO',
    'Quantidade: 3 leads',
    'Etapa: Novo',
    'Prioridade: negócios sem site, ou com site ruim/desatualizado',
    'Critério de desempate: maior potencial comercial',
  ].join('\n');

  assert.equal(pareceComandoDeProspeccao(estruturada, historico), true);
});

test('mensagem estruturada como segundo turno, com rótulos em variações de acento/caixa', () => {
  const historico = [turno('user', 'busque academias em Anápolis')];
  const estruturada = 'NICHO: academias\nLOCALIZAÇÃO: Anápolis\nQUANTIDADE: 5';
  assert.equal(pareceComandoDeProspeccao(estruturada, historico), true);
});

test('mensagem estruturada NÃO reabre prospecção se o turno de prospecção foi há muito tempo', () => {
  const historicoAntigo = [
    turno('user', 'procure clínicas em Goiânia'),
    turno('assistant', 'Ok!'),
    turno('user', 'quanto vendemos esse mês?'),
    turno('assistant', 'R$ 45.000.'),
    turno('user', 'e os pagamentos pendentes?'),
    turno('assistant', 'R$ 12.000 em aberto.'),
    turno('user', 'obrigado'),
  ];
  const estruturada = 'Nicho: academia\nLocalização: Anápolis\nQuantidade: 5';
  // Só os últimos 6 turnos contam — o pedido de prospecção já saiu da janela.
  assert.equal(pareceComandoDeProspeccao(estruturada, historicoAntigo), false);
});

/* ==========================================================================
   5-6. Sinais de qualidade de site
   ========================================================================== */

test('"negócios sem site em Goiânia" é reconhecido', () => {
  assert.equal(pareceComandoDeProspeccao('negócios sem site em Goiânia'), true);
});

test('"clínicas com site ruim em Goiânia" é reconhecido', () => {
  assert.equal(pareceComandoDeProspeccao('clínicas com site ruim em Goiânia'), true);
});

test('"empresas com site desatualizado" é reconhecido', () => {
  assert.equal(pareceComandoDeProspeccao('empresas com site desatualizado em Anápolis'), true);
});

/* ==========================================================================
   7-9. Leitura do CRM NÃO deve virar prospecção
   ========================================================================== */

test('"mostre meus 3 leads novos" continua leitura do CRM', () => {
  assert.equal(pareceComandoDeProspeccao('mostre meus 3 leads novos'), false);
});

test('"quantos leads novos eu tenho?" continua leitura do CRM', () => {
  assert.equal(pareceComandoDeProspeccao('quantos leads novos eu tenho?'), false);
});

test('"filtre os leads novos de Goiânia" continua leitura do CRM', () => {
  assert.equal(pareceComandoDeProspeccao('filtre os leads novos de Goiânia'), false);
});

test('outras leituras comuns do CRM continuam corretas', () => {
  assert.equal(pareceComandoDeProspeccao('liste os leads qualificados'), false);
  assert.equal(pareceComandoDeProspeccao('quais são os leads de Goiânia?'), false);
  assert.equal(pareceComandoDeProspeccao('quantos leads temos hoje?'), false);
});

/* ==========================================================================
   10. Prioridade da prospecção sobre leitura quando a intenção é descoberta
   ========================================================================== */

test('mensagem com "leads" E sinal de descoberta é tratada como prospecção, não leitura', () => {
  // A mesma palavra "leads" que aparece em pedidos de leitura também aparece
  // aqui — o que decide é o verbo de descoberta + o nicho, não a palavra.
  assert.equal(pareceComandoDeProspeccao('quero 3 leads novos de clínicas de estética em Goiânia'), true);
  assert.equal(pareceComandoDeProspeccao('busque leads novos de academias em Anápolis'), true);
});

test('sinal de descoberta vence mesmo quando a frase também soa como pedido de relatório', () => {
  assert.equal(
    pareceComandoDeProspeccao('procure 3 clínicas de estética em Goiânia — quero um relatório de leads novos'),
    true,
  );
});

/* ==========================================================================
   Regressão: comportamento de turno único continua correto
   ========================================================================== */

test('histórico vazio (padrão) não muda o comportamento de mensagem única', () => {
  assert.equal(pareceComandoDeProspeccao('procure academias em Goiânia'), true);
  assert.equal(pareceComandoDeProspeccao('procure academias em Goiânia', []), true);
});

test('"procure na tela de configurações" continua não reconhecido (verbo sem contexto de negócio)', () => {
  assert.equal(pareceComandoDeProspeccao('procure na tela de configurações'), false);
});

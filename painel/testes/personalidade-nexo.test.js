/**
 * Testes da personalidade/comportamento conversacional da NEXO AI e das
 * preferências obrigatórias (memória estrutural tratada como instrução).
 *
 * Cobre o que é testável sem chamar o Groq de verdade (este projeto não
 * mocka o modelo em teste de integração): o TEXTO do system prompt (persona
 * + camada de memória) e a classificação leve de modo conversa/tarefa
 * (reaproveita `pareceComandoDeProspeccao`, já testado em profundidade em
 * roteamento-prospeccao.test.js — aqui só confirma as frases casuais
 * específicas deste pedido, sem duplicar a matriz inteira).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA, camadaMemorias } from '../api/_lib/nexo-ai/persona.ts';
import { selecionarMemorias } from '../shared/regras-nexo-ai.ts';
import { pareceComandoDeProspeccao } from '../api/_lib/nexo-ai/ferramentas.ts';

function memoriaNomePreferidoSenhor() {
  return {
    id: 'mem-nome-preferido',
    tipo: 'preferencia',
    conteudo: 'Prefere ser chamado de Senhor',
    chaves: ['nome_preferido'],
    relevancia: 0.9,
    usuario_id: 'user-1',
    ativo: true,
  };
}

/* ==========================================================================
   1/2 — nome_preferido="Senhor" como preferência obrigatória, mesmo em "Bom dia"
   ========================================================================== */

test('camadaMemorias coloca nome_preferido="Senhor" no bloco PREFERÊNCIAS OBRIGATÓRIAS, separado do resto', () => {
  const prompt = camadaMemorias([memoriaNomePreferidoSenhor()]);
  assert.match(prompt, /PREFERÊNCIAS OBRIGATÓRIAS DO USUÁRIO/);
  assert.match(prompt, /Prefere ser chamado de Senhor/);
});

test('"Bom dia" seleciona a memória de nome_preferido="Senhor" e ela chega pronta pro prompt', () => {
  const selecionadas = selecionarMemorias([memoriaNomePreferidoSenhor()], 'Bom dia');
  assert.equal(selecionadas.length, 1);
  const prompt = camadaMemorias(selecionadas);
  assert.match(prompt, /Senhor/);
});

test('a instrução do bloco obrigatório diz pra respeitar SEM anunciar que está consultando memória', () => {
  const prompt = camadaMemorias([memoriaNomePreferidoSenhor()]);
  assert.match(prompt, /sem dizer que está.*consultando memória/i);
});

test('a instrução do bloco obrigatório pede moderação — não repetir o tratamento em toda frase', () => {
  const prompt = camadaMemorias([memoriaNomePreferidoSenhor()]);
  assert.match(prompt, /sem repetir o nome\/tratamento em toda frase/i);
});

/* ==========================================================================
   6/7/8/9 — o que a persona instrui sobre tom e brevidade
   ========================================================================== */

test('persona instrui resposta curta por padrão pra conversa casual', () => {
  assert.match(PERSONA, /breve.*1-4 frases|1-4 frases/i);
});

test('persona permite UMA pergunta de continuidade natural, mas não mais que isso', () => {
  assert.match(PERSONA, /UMA pergunta de continuidade/);
  assert.match(PERSONA, /nunca mais que uma/i);
});

test('persona proíbe explicitamente empilhar perguntas / perguntar por perguntar', () => {
  assert.match(PERSONA, /Não empilhe perguntas/i);
  assert.match(PERSONA, /nunca forçada/i);
});

test('persona proíbe "Como posso ajudar?" e aberturas genéricas repetidas', () => {
  assert.match(PERSONA, /Como posso ajudar/);
  assert.match(PERSONA, /Nunca abra com/i);
});

test('persona evita clichês de IA — "Claro!"/"Com certeza!"/"Ótima pergunta!"', () => {
  assert.match(PERSONA, /Claro!/);
  assert.match(PERSONA, /Com certeza!/);
  assert.match(PERSONA, /Ótima pergunta!/);
});

test('persona distingue explicitamente modo tarefa (executa primeiro) de conversa casual', () => {
  assert.match(PERSONA, /Pedido de tarefa.*execute primeiro/is);
});

test('persona reforça identidade: feminina, profissional, próxima — sem soar robótica nem bajuladora', () => {
  assert.match(PERSONA, /Feminina/);
  assert.match(PERSONA, /profissional/i);
  assert.match(PERSONA, /colega de trabalho/i);
});

/* ==========================================================================
   10/11 — memória relevante pode puxar assunto; irrelevante fica de fora
   ========================================================================== */

test('memória sobre um assunto em andamento (não estrutural) é recuperada quando a pergunta é sobre esse assunto', () => {
  const memoriaProspeccao = {
    id: 'mem-foco',
    tipo: 'decisao',
    conteudo: 'Foco atual é prospecção de clínicas de estética em Goiânia',
    chaves: ['foco_atual'],
    relevancia: 0.6,
    usuario_id: 'user-1',
    ativo: true,
  };
  const selecionadas = selecionarMemorias([memoriaProspeccao], 'como está indo a prospecção de clínicas?');
  assert.equal(selecionadas.length, 1);
});

test('memória sobre um assunto sem relação NÃO é puxada numa saudação simples', () => {
  const memoriaProjetoAntigo = {
    id: 'mem-projeto-x',
    tipo: 'fato',
    conteudo: 'O projeto do cliente Y usa React e foi entregue em março',
    chaves: ['projeto_y'],
    relevancia: 0.4,
    usuario_id: 'user-1',
    ativo: true,
  };
  const selecionadas = selecionarMemorias([memoriaProjetoAntigo], 'Bom dia');
  assert.equal(selecionadas.length, 0, 'sem overlap de palavras nem chave estrutural, não deveria ser puxada só por "bom dia"');
});

test('persona autoriza puxar assunto relacionado quando há espaço, sem forçar tema sem relação', () => {
  assert.match(PERSONA, /pode puxar UMA pergunta de continuidade/i);
  assert.match(PERSONA, /nunca sobre assunto sem relação/i);
});

/* ==========================================================================
   4/5 — conversa casual não dispara ferramenta; comando de tarefa dispara
   ========================================================================== */

test('frases casuais deste pedido NÃO parecem comando de prospecção', () => {
  const casuais = ['Bom dia', 'Consegui fechar um cliente.', 'Tô cansado hoje.', 'O que você acha?'];
  for (const frase of casuais) {
    assert.equal(pareceComandoDeProspeccao(frase), false, `"${frase}" não deveria acionar prospecção`);
  }
});

test('comando de tarefa deste pedido continua disparando a ferramenta certa', () => {
  assert.equal(pareceComandoDeProspeccao('Busque 20 clínicas de estética em Goiânia.'), true);
});

/* ==========================================================================
   12 — nenhum passo bloqueante novo antes do streaming (revisão estrutural)

   Não dá pra "testar" isso com node --test sem mockar o Groq inteiro — é
   uma revisão de código, registrada aqui como documentação do que foi
   checado: a única mudança em conversar.ts nesta rodada foi CONCATENAR uma
   frase extra na string `sistemaComDados`, já calculada de forma síncrona
   a partir de `todosResultados` (que já existia). Nenhum novo `await`,
   nenhuma nova consulta ao banco, nenhuma nova chamada ao modelo foi
   adicionada — a ordem e a paralelização de tudo que já rodava (histórico,
   memórias, ferramentas, extração) continua exatamente a mesma.
   ========================================================================== */

test('placeholder documental — ver comentário acima; sem asserção de código porque não é testável sem mockar o Groq inteiro', () => {
  assert.ok(true);
});

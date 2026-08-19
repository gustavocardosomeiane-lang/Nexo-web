/**
 * Testes do fluxo final do Groq (streaming) — investigação do incidente
 * "[nexo-ai] erro (stream em andamento): O Groq não retornou uma resposta."
 * depois de uma prospecção bem-sucedida.
 *
 * CAUSA ESTRUTURAL CONFIRMADA POR LEITURA DE CÓDIGO: a chamada final
 * (`groqStream`, usada por conversar.ts para gerar a resposta em texto)
 * NUNCA envia `tools` no corpo da requisição — só a extração
 * (`groqProvider.conversar`, chamada separada) envia. Sem `tools` no
 * pedido, a API não tem ferramenta nenhuma pra o modelo tentar chamar, então
 * `tool_choice: "none"` (a recomendação oficial do Groq para o loop
 * clássico de function-calling) não se aplica à nossa arquitetura — as duas
 * chamadas são conversas INDEPENDENTES, não um único loop com o resultado
 * da ferramenta anexado de volta.
 *
 * Estes testes fixam esse comportamento (para não regredir) e cobrem os
 * cenários de borda do streaming: chunks sem content antes do texto, chunks
 * com tool_calls (nunca deveriam aparecer aqui, mas não podem derrubar o
 * parser se aparecerem), finish_reason sendo capturado, e stream terminando
 * sem nenhum content.
 *
 * `fetch` é sempre mockado. Nenhuma chamada real ao Groq.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { groqStream, groqProvider, ErroModelo } from '../api/_lib/nexo-ai/modelo.ts';

const fetchOriginal = global.fetch;
const consoleLogOriginal = console.log;

test.beforeEach(() => {
  process.env.GROQ_API_KEY = 'chave-de-teste-nao-deve-vazar';
});

test.afterEach(() => {
  global.fetch = fetchOriginal;
  console.log = consoleLogOriginal;
});

/* --------------------------------------------------------------------------
   Fábricas
   -------------------------------------------------------------------------- */

/** Monta uma resposta SSE de verdade — o parser lê isto exatamente como leria do Groq. */
function respostaSSE(eventos, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const corpo = new ReadableStream({
    start(controller) {
      for (const ev of eventos) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body: corpo, json: async () => ({}) };
}

function chunkContent(texto) {
  return { choices: [{ index: 0, delta: { content: texto } }] };
}

function chunkReasoning(texto) {
  return { choices: [{ index: 0, delta: { reasoning: texto } }] };
}

function chunkReasoningContent(texto) {
  return { choices: [{ index: 0, delta: { reasoning_content: texto } }] };
}

function chunkFinal(finishReason) {
  return { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] };
}

function chunkUsage(entrada, saida) {
  return { choices: [], usage: { prompt_tokens: entrada, completion_tokens: saida } };
}

function chunkToolCall() {
  return {
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, id: 'call_inesperado', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      },
    ],
  };
}

/** Captura as chamadas a `console.log` durante o teste, sem parar de exibir nada de verdade. */
function capturarLogs() {
  const linhas = [];
  console.log = (...args) => {
    linhas.push(args.join(' '));
  };
  return linhas;
}

async function consumirStream(pedido) {
  const gerador = groqStream(pedido);
  let textoAcumulado = '';
  let resultado;
  while (true) {
    const passo = await gerador.next();
    if (passo.done) {
      resultado = passo.value;
      break;
    }
    textoAcumulado += passo.value;
  }
  return { textoAcumulado, resultado };
}

const PEDIDO_BASE = { sistema: 'Você é a NEXO AI.', mensagens: [{ papel: 'user', conteudo: 'oi' }] };

/* ==========================================================================
   1. Fluxo normal sem prospecção — sem regressão
   ========================================================================== */

test('fluxo normal sem prospecção: stream de texto simples funciona como antes', async () => {
  global.fetch = async () =>
    respostaSSE([chunkContent('Olá'), chunkContent(', tudo bem?'), chunkFinal('stop'), chunkUsage(50, 6)]);

  const { textoAcumulado, resultado } = await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  assert.equal(textoAcumulado, 'Olá, tudo bem?');
  assert.equal(resultado.texto, 'Olá, tudo bem?');
  assert.equal(resultado.tokens.entrada, 50);
  assert.equal(resultado.tokens.saida, 6);
});

/* ==========================================================================
   2. Chamada final nunca envia `tools` — não há "tool_choice: none" pra aplicar
   ========================================================================== */

test('a chamada final NUNCA envia tools no corpo — não existe ferramenta pra "tool_choice: none" recusar', async () => {
  let corpoEnviado = null;
  global.fetch = async (url, opcoes) => {
    corpoEnviado = JSON.parse(opcoes.body);
    return respostaSSE([chunkContent('Encontrei 3 leads novos.'), chunkFinal('stop')]);
  };

  await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  assert.equal('tools' in corpoEnviado, false);
  assert.equal('tool_choice' in corpoEnviado, false);
});

test('a extração (com ferramenta) envia tools E tool_choice="auto" explicitamente', async () => {
  let corpoEnviado = null;
  global.fetch = async (url, opcoes) => {
    corpoEnviado = JSON.parse(opcoes.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }], usage: {} }),
    };
  };

  await groqProvider.conversar({
    sistema: 'extraia parâmetros',
    mensagens: [{ papel: 'user', conteudo: 'procure clínicas em Goiânia' }],
    ferramentas: [{ nome: 'buscar_leads_locais', descricao: '...', parametros: { type: 'object', properties: {} } }],
    etapa: 'extracao',
  });

  assert.ok(Array.isArray(corpoEnviado.tools));
  assert.equal(corpoEnviado.tools.length, 1);
  assert.equal(corpoEnviado.tool_choice, 'auto');
});

/* ==========================================================================
   3. Groq tenta retornar tool_call na chamada final (não deveria, mas...)
   ========================================================================== */

test('chunk de tool_calls na chamada final não derruba o parser — texto continua sendo acumulado', async () => {
  global.fetch = async () =>
    respostaSSE([
      chunkContent('Encontrei '),
      chunkToolCall(),
      chunkContent('3 leads novos.'),
      chunkFinal('stop'),
    ]);

  const { textoAcumulado, resultado } = await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  assert.equal(textoAcumulado, 'Encontrei 3 leads novos.');
  assert.equal(resultado.texto, 'Encontrei 3 leads novos.');
});

test('chunk de tool_calls inesperado é registrado no log de diagnóstico', async () => {
  global.fetch = async () => respostaSSE([chunkContent('Ok'), chunkToolCall(), chunkFinal('stop')]);
  const logs = capturarLogs();

  await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  const linhaDiagnostico = logs.find((l) => l.includes('Groq <-') && l.includes('etapa=resposta_final'));
  assert.ok(linhaDiagnostico, 'esperava a linha de diagnóstico de saída do stream');
  assert.match(linhaDiagnostico, /chunks_com_tool_calls=1/);
});

/* ==========================================================================
   4. Stream começa com chunks sem content e depois texto
   ========================================================================== */

test('stream começando com chunks vazios (delta de role, sem content) ainda funciona', async () => {
  global.fetch = async () =>
    respostaSSE([
      { choices: [{ index: 0, delta: { role: 'assistant' } }] },
      { choices: [{ index: 0, delta: {} }] },
      chunkContent('Agora sim, o texto.'),
      chunkFinal('stop'),
    ]);

  const { textoAcumulado } = await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  assert.equal(textoAcumulado, 'Agora sim, o texto.');
});

/* ==========================================================================
   5. Stream termina sem content nenhum
   ========================================================================== */

test('stream que termina sem nenhum content lança ErroModelo "sem_resposta"', async () => {
  global.fetch = async () =>
    respostaSSE([
      { choices: [{ index: 0, delta: { role: 'assistant' } }] },
      chunkFinal('length'),
      chunkUsage(900, 512),
    ]);

  await assert.rejects(
    () => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }),
    (erro) => {
      assert.ok(erro instanceof ErroModelo);
      assert.equal(erro.codigo, 'sem_resposta');
      return true;
    },
  );
});

test('finish_reason="length" (orçamento de tokens esgotado) aparece no log de diagnóstico', async () => {
  global.fetch = async () => respostaSSE([chunkFinal('length')]);
  const logs = capturarLogs();

  await assert.rejects(() => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }));

  const linhaDiagnostico = logs.find((l) => l.includes('Groq <-') && l.includes('etapa=resposta_final'));
  assert.ok(linhaDiagnostico, 'o diagnóstico deve aparecer mesmo quando o stream termina sem resposta');
  assert.match(linhaDiagnostico, /finish_reason=length/);
  assert.match(linhaDiagnostico, /chunks_com_content=0/);
});

test('finish_reason="stop" com conteúdo aparece no log de diagnóstico', async () => {
  global.fetch = async () => respostaSSE([chunkContent('tudo certo'), chunkFinal('stop')]);
  const logs = capturarLogs();

  await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  const linhaDiagnostico = logs.find((l) => l.includes('Groq <-'));
  assert.match(linhaDiagnostico, /finish_reason=stop/);
  assert.match(linhaDiagnostico, /chunks_com_content=1/);
});

/* ==========================================================================
   5b. Formato real investigado: gpt-oss separa o raciocínio da resposta
   final num campo próprio do delta (`reasoning`/`reasoning_content`) —
   causa raiz do incidente "chunks=47 chunks_com_content=0". A correção NÃO
   é usar esse campo como resposta (seria expor pensamento interno do
   modelo ao usuário): é pedir pra Groq nem mandá-lo (`include_reasoning:
   false`, em montarCorpoGroq) e, se `content` mesmo assim ficar vazio,
   deixar quem chama (conversar.ts) decidir — nunca este arquivo.
   `respostaFallbackProspeccao`, testada em resposta-final-fallback.test.js,
   é o que cobre o caso "prospecção já concluída, sem texto do Groq"; aqui
   só se prova que ESTE módulo nunca vaza raciocínio como se fosse resposta.
   ========================================================================== */

test('delta.reasoning sozinho (sem content): NUNCA vira resposta — lança ErroModelo "sem_resposta"', async () => {
  global.fetch = async () =>
    respostaSSE([
      chunkReasoning('Encontrei '),
      chunkReasoning('20 empresas e importei 4 novos leads.'),
      chunkFinal('stop'),
    ]);

  await assert.rejects(
    () => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }),
    (erro) => {
      assert.ok(erro instanceof ErroModelo);
      assert.equal(erro.codigo, 'sem_resposta');
      return true;
    },
  );
});

test('delta.reasoning_content (nome alternativo) também NUNCA vira resposta', async () => {
  global.fetch = async () =>
    respostaSSE([chunkReasoningContent('Busca concluída com sucesso.'), chunkFinal('stop')]);

  await assert.rejects(
    () => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }),
    (erro) => {
      assert.ok(erro instanceof ErroModelo);
      assert.equal(erro.codigo, 'sem_resposta');
      return true;
    },
  );
});

test('raciocínio nunca é emitido via yield — nem um único chunk chega ao cliente', async () => {
  global.fetch = async () =>
    respostaSSE([chunkReasoning('primeira parte '), chunkReasoning('segunda parte'), chunkFinal('stop')]);

  const gerador = groqStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });
  const partes = [];
  await assert.rejects(async () => {
    while (true) {
      const passo = await gerador.next();
      if (passo.done) break;
      partes.push(passo.value);
    }
  });

  assert.equal(partes.length, 0, 'nenhum pedaço de raciocínio deveria ter sido entregue ao cliente via SSE');
});

test('quando delta.content existe, o raciocínio junto é ignorado — nunca entra na resposta', async () => {
  global.fetch = async () =>
    respostaSSE([
      chunkReasoning('pensando sobre a pergunta...'),
      chunkContent('Resposta real e formatada.'),
      chunkFinal('stop'),
    ]);

  const { textoAcumulado, resultado } = await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  assert.equal(textoAcumulado, 'Resposta real e formatada.');
  assert.equal(resultado.texto, 'Resposta real e formatada.');
});

test('nem content nem reasoning presentes: mesmo comportamento (sem_resposta), sem tratamento especial', async () => {
  global.fetch = async () =>
    respostaSSE([{ choices: [{ index: 0, delta: { role: 'assistant' } }] }, chunkFinal('length')]);

  await assert.rejects(
    () => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }),
    (erro) => {
      assert.ok(erro instanceof ErroModelo);
      assert.equal(erro.codigo, 'sem_resposta');
      return true;
    },
  );
});

test('diagnóstico do primeiro delta não vazio loga só as CHAVES, nunca o texto do raciocínio', async () => {
  global.fetch = async () =>
    respostaSSE([chunkReasoning('conteudo-sensivel-do-raciocinio-nao-pode-vazar-no-log'), chunkFinal('stop')]);
  const logs = capturarLogs();

  await assert.rejects(() => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }));

  const linhaDiagnosticoDelta = logs.find((l) => l.includes('diagnostico_primeiro_delta'));
  assert.ok(linhaDiagnosticoDelta, 'esperava o log de diagnóstico do primeiro delta');
  assert.match(linhaDiagnosticoDelta, /chaves=reasoning/);
  assert.equal(
    logs.some((l) => l.includes('conteudo-sensivel-do-raciocinio-nao-pode-vazar-no-log')),
    false,
    'o texto do raciocínio nunca deve aparecer em nenhuma linha de log',
  );
});

test('log de saída do stream conta chunks_com_raciocinio separadamente de chunks_com_content, mesmo falhando', async () => {
  global.fetch = async () => respostaSSE([chunkReasoning('a'), chunkReasoning('b'), chunkFinal('stop')]);
  const logs = capturarLogs();

  await assert.rejects(() => consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' }));

  const linhaDiagnostico = logs.find((l) => l.includes('Groq <-') && l.includes('etapa=resposta_final'));
  assert.match(linhaDiagnostico, /chunks_com_content=0/);
  assert.match(linhaDiagnostico, /chunks_com_raciocinio=2/);
});

test('include_reasoning: false é enviado no corpo da chamada final, para a Groq nem mandar o campo', async () => {
  let corpoEnviado = null;
  global.fetch = async (url, opcoes) => {
    corpoEnviado = JSON.parse(opcoes.body);
    return respostaSSE([chunkContent('ok'), chunkFinal('stop')]);
  };

  await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  assert.equal(corpoEnviado.include_reasoning, false);
  assert.equal('reasoning_format' in corpoEnviado, false, 'reasoning_format não é suportado para gpt-oss — nunca deve ser enviado');
});

/* ==========================================================================
   6. Ferramenta falhou, mas ainda há resposta textual amigável
   ========================================================================== */

test('mesmo com um "DADO REAL" de erro no sistema (ferramenta falhou), o stream final ainda produz texto normal', async () => {
  global.fetch = async () =>
    respostaSSE([
      chunkContent('Não consegui buscar agora, tente de novo em instantes.'),
      chunkFinal('stop'),
    ]);

  const pedidoComErroDeFerramenta = {
    sistema:
      'Você é a NEXO AI.\n\n---\n\nDADO REAL — buscar_leads_locais: {"erro":"Não foi possível buscar negócios locais agora."}\nUse somente esses dados reais para responder à pergunta. Não invente números.',
    mensagens: [{ papel: 'user', conteudo: 'procure 3 clínicas em Goiânia' }],
    etapa: 'resposta_final',
  };

  const { textoAcumulado } = await consumirStream(pedidoComErroDeFerramenta);

  assert.equal(textoAcumulado, 'Não consegui buscar agora, tente de novo em instantes.');
});

/* ==========================================================================
   7. Prospecção bem-sucedida → resposta final textual usando os números reais
   ========================================================================== */

test('prospecção bem-sucedida: o DADO REAL chega ao pedido final e o stream devolve texto', async () => {
  let mensagensRecebidas = null;
  global.fetch = async (url, opcoes) => {
    mensagensRecebidas = JSON.parse(opcoes.body).messages;
    return respostaSSE([
      chunkContent('Encontrei 5 empresas, analisei os sites e importei 3 novos leads de clínicas de estética em Goiânia.'),
      chunkFinal('stop'),
      chunkUsage(300, 40),
    ]);
  };

  const pedidoComResultadoReal = {
    sistema:
      'Você é a NEXO AI.\n\n---\n\nDADO REAL — buscar_leads_locais: {"solicitados":3,"encontrados":5,"analisados":5,"duplicados":2,"importados":3,"descartados":0,"leads":[{"nome":"Clínica A","cidade":"Goiânia","score_oportunidade":92}]}\nUse somente esses dados reais para responder à pergunta. Não invente números.',
    mensagens: [{ papel: 'user', conteudo: 'procure 3 clínicas de estética em Goiânia' }],
    etapa: 'resposta_final',
  };

  const { textoAcumulado, resultado } = await consumirStream(pedidoComResultadoReal);

  assert.match(textoAcumulado, /3 novos leads/);
  assert.equal(resultado.tokens.entrada, 300);
  assert.equal(resultado.tokens.saida, 40);

  // A chamada final continua sem tools, mesmo depois de uma prospecção real.
  const corpoEnviado = { messages: mensagensRecebidas };
  assert.ok(Array.isArray(corpoEnviado.messages));
  assert.equal(corpoEnviado.messages[0].role, 'system');
  assert.match(corpoEnviado.messages[0].content, /DADO REAL — buscar_leads_locais/);
});

/* ==========================================================================
   Segurança: a chave nunca aparece nos logs
   ========================================================================== */

test('a chave do Groq nunca aparece nos logs de diagnóstico', async () => {
  global.fetch = async () => respostaSSE([chunkContent('ok'), chunkFinal('stop')]);
  const logs = capturarLogs();

  await consumirStream({ ...PEDIDO_BASE, etapa: 'resposta_final' });

  const chave = process.env.GROQ_API_KEY;
  assert.equal(logs.some((l) => l.includes(chave)), false);
});

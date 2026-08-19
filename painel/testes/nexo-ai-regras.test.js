/**
 * Regras puras da NEXO AI.
 *
 * Estas decisões custam dinheiro (orçamento de contexto) ou protegem dado
 * (redação, permissão de ferramenta). Testadas sem rede e sem gastar um
 * único token do modelo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FERRAMENTA_MODULO,
  MAX_MENSAGENS_HISTORICO,
  ORCAMENTO,
  RETRY_MS_PADRAO,
  estimarTokens,
  extrairRetryDelayMs,
  ferramentasPermitidas,
  normalizar,
  palavrasChave,
  podeTransitar,
  pontuarMemoria,
  recortarHistorico,
  redigirSegredos,
  selecionarMemorias,
} from '../shared/regras-nexo-ai.ts';

/* ==========================================================================
   Orçamento
   ========================================================================== */

test('estimativa de tokens é conservadora, nunca zero para texto real', () => {
  assert.equal(estimarTokens(''), 0);
  assert.ok(estimarTokens('oi') >= 1);
  // ~3,5 chars/token: 350 chars ≈ 100 tokens.
  assert.ok(Math.abs(estimarTokens('x'.repeat(350)) - 100) <= 1);
});

test('histórico é cortado pelas mensagens MAIS RECENTES', () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({
    papel: i % 2 === 0 ? 'user' : 'assistant',
    conteudo: `mensagem ${i}`,
  }));
  const r = recortarHistorico(msgs);
  assert.ok(r.length <= MAX_MENSAGENS_HISTORICO);
  // A última tem de estar lá — é o que o usuário acabou de dizer.
  assert.equal(r[r.length - 1].conteudo, 'mensagem 19');
});

test('histórico mantém ordem cronológica após o corte', () => {
  const msgs = [
    { papel: 'user', conteudo: 'primeira' },
    { papel: 'assistant', conteudo: 'segunda' },
    { papel: 'user', conteudo: 'terceira' },
  ];
  const r = recortarHistorico(msgs);
  assert.deepEqual(r.map((m) => m.conteudo), ['primeira', 'segunda', 'terceira']);
});

test('uma mensagem gigante sozinha ainda passa — senão a IA fica muda', () => {
  const r = recortarHistorico([{ papel: 'user', conteudo: 'x'.repeat(50000) }]);
  assert.equal(r.length, 1);
});

test('mensagem gigante não arrasta as outras junto', () => {
  const r = recortarHistorico([
    { papel: 'user', conteudo: 'x'.repeat(50000) },
    { papel: 'assistant', conteudo: 'curta' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].conteudo, 'curta', 'mantém a recente, descarta a cara');
});

/* ==========================================================================
   Memória
   ========================================================================== */

test('normalizar remove acento, caixa e pontuação', () => {
  // Se o regex de acentuação se perder, isto quebra na hora.
  assert.equal(normalizar('Prospecção'), 'prospeccao');
  assert.equal(normalizar('AÇÃO, é ótimo!'), 'acao e otimo');
  assert.equal(normalizar('  Múltiplos   espaços  '), 'multiplos espacos');
});

test('palavras-chave descartam conectivos e palavras curtas', () => {
  const p = palavrasChave('Qual é o objetivo da nossa empresa?');
  assert.ok(p.includes('objetivo'));
  assert.ok(p.includes('empresa'));
  assert.ok(!p.includes('da'));
  assert.ok(!p.includes('qual'));
});

const mem = (s = {}) => ({
  id: 'm1',
  tipo: 'fato',
  conteudo: 'O plano Profissional custa R$ 2.500',
  ...s,
});

test('memória aderente à pergunta pontua mais que memória alheia', () => {
  const perto = pontuarMemoria(mem(), 'quanto custa o plano profissional?');
  const longe = pontuarMemoria(mem({ conteudo: 'A cor da marca é vermelha' }), 'quanto custa o plano profissional?');
  assert.ok(perto > longe);
});

test('pergunta sem palavra útil não pontua nada', () => {
  assert.equal(pontuarMemoria(mem(), 'e a?'), 0);
});

test('memórias de EMPRESA entram mesmo sem casar com a pergunta', () => {
  // São o "quem somos" — úteis sempre, e o operador não deveria ter de citá-las.
  const ms = [
    mem({ id: 'e1', tipo: 'empresa', conteudo: 'A NEXO WEB cria sites profissionais.' }),
    mem({ id: 'f1', tipo: 'fato', conteudo: 'Nada a ver com a pergunta' }),
  ];
  const sel = selecionarMemorias(ms, 'qual a cor do céu');
  assert.deepEqual(sel.map((m) => m.id), ['e1']);
});

test('memória irrelevante NÃO entra — não se paga token por ruído', () => {
  const ms = [mem({ id: 'f1', conteudo: 'Reunião de terça foi adiada' })];
  assert.equal(selecionarMemorias(ms, 'quantos leads temos?').length, 0);
});

test('seleção respeita o teto de tokens', () => {
  const ms = Array.from({ length: 50 }, (_, i) =>
    mem({ id: `e${i}`, tipo: 'empresa', conteudo: 'contexto '.repeat(200) }),
  );
  const sel = selecionarMemorias(ms, 'qualquer coisa');
  const custo = sel.reduce((s, m) => s + estimarTokens(m.conteudo), 0);
  assert.ok(custo <= ORCAMENTO.memorias, `custo ${custo} estourou ${ORCAMENTO.memorias}`);
  assert.ok(sel.length < 50, 'nem todas cabem, e isso é o esperado');
});

/* ==========================================================================
   Segredos
   ========================================================================== */

test('redige credenciais que apareçam em campo de texto do CRM', () => {
  const sujo = [
    'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
    'chave sk_live_abcdefghijklmnop',
    'asaas $aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5',
    'Authorization: Bearer abcdefghijklmnopqrs',
  ].join(' | ');
  const limpo = redigirSegredos(sujo);
  assert.ok(!limpo.includes('eyJhbGci'), 'JWT');
  assert.ok(!limpo.includes('sk_live_abcdefghijklmnop'), 'stripe-like');
  assert.ok(!limpo.includes('$aact_YTU5'), 'asaas');
  assert.ok(!limpo.includes('abcdefghijklmnopqrs'), 'bearer');
});

test('texto comum passa intacto — redator não pode mutilar conversa', () => {
  const t = 'O cliente pediu orçamento de R$ 2.500 para o plano Profissional.';
  assert.equal(redigirSegredos(t), t);
});

/* ==========================================================================
   Ferramentas x permissão
   ========================================================================== */

const TODAS = Object.keys(FERRAMENTA_MODULO);

test('a IA herda a permissão de quem pergunta — não tem a própria', () => {
  const soLeads = ferramentasPermitidas(TODAS, (m) => m === 'leads');
  // consultar_leads (leitura) e buscar_leads_locais (Etapa 4 — a única
  // ferramenta de escrita) são os dois mapeados para o módulo 'leads'.
  assert.deepEqual(soLeads, ['consultar_leads', 'buscar_leads_locais']);
});

test('quem não vê financeiro não consulta vendas pela IA', () => {
  const semVendas = ferramentasPermitidas(TODAS, (m) => m !== 'vendas');
  assert.ok(!semVendas.includes('consultar_vendas'));
});

test('ferramenta sem módulo declarado NÃO é oferecida', () => {
  // Falha fechado: esquecer de mapear não pode virar acesso liberado.
  const r = ferramentasPermitidas([...TODAS, 'ferramenta_nova_sem_mapa'], () => true);
  assert.ok(!r.includes('ferramenta_nova_sem_mapa'));
});

test('usuário sem permissão nenhuma não recebe ferramenta nenhuma', () => {
  assert.equal(ferramentasPermitidas(TODAS, () => false).length, 0);
});

test('só as ferramentas de escrita explicitamente aprovadas existem nesta fase', () => {
  // Trava de escopo. `buscar_leads_locais` é a ÚNICA exceção aprovada
  // (Etapa 4 — prospecção automática): busca e IMPORTA lead novo, nunca
  // envia mensagem, nunca dispara WhatsApp, nunca modifica lead existente
  // (ver executarBuscaEImportacao em api/_lib/nexo-ai/ferramentas.ts).
  // Qualquer OUTRA ferramenta de escrita/envio que aparecer aqui não foi
  // combinada com você — é bug, não recurso.
  const ESCRITA_APROVADA = new Set(['buscar_leads_locais']);
  for (const f of TODAS) {
    if (ESCRITA_APROVADA.has(f)) continue;
    assert.ok(
      f.startsWith('consultar_') || f === 'buscar_memoria' || f === 'salvar_memoria',
      `ferramenta inesperada para esta fase: ${f}`,
    );
    assert.ok(!/enviar|disparar|whatsapp|excluir|remover|deletar/i.test(f), f);
  }
});

/* ==========================================================================
   Estados
   ========================================================================== */

test('fluxo normal de voz é permitido', () => {
  assert.ok(podeTransitar('idle', 'listening'));
  assert.ok(podeTransitar('listening', 'thinking'));
  assert.ok(podeTransitar('thinking', 'responding'));
  assert.ok(podeTransitar('responding', 'speaking'));
  assert.ok(podeTransitar('speaking', 'idle'));
});

test('estados impossíveis são recusados', () => {
  assert.ok(!podeTransitar('idle', 'speaking'), 'não fala sem pensar');
  assert.ok(!podeTransitar('listening', 'speaking'));
  assert.ok(!podeTransitar('error', 'thinking'), 'do erro só se volta ao repouso');
});

test('clicar no microfone enquanto a NEXO fala interrompe e vai direto pra escuta', () => {
  assert.ok(podeTransitar('speaking', 'listening'));
});

test('todos os outros estados continuam podendo transitar pros mesmos destinos de sempre', () => {
  assert.ok(podeTransitar('idle', 'listening'));
  assert.ok(podeTransitar('idle', 'thinking'));
  assert.ok(podeTransitar('listening', 'thinking'));
  assert.ok(podeTransitar('listening', 'idle'));
  assert.ok(podeTransitar('thinking', 'responding'));
  assert.ok(podeTransitar('thinking', 'idle'));
  assert.ok(podeTransitar('responding', 'speaking'));
  assert.ok(podeTransitar('responding', 'idle'));
  assert.ok(podeTransitar('speaking', 'idle'));
  assert.ok(podeTransitar('error', 'idle'));
});

test('a correção de speaking->listening não abriu nenhuma outra transição por engano', () => {
  const ESTADOS = ['idle', 'listening', 'thinking', 'responding', 'speaking', 'error'];
  const PERMITIDAS = {
    idle: ['listening', 'thinking', 'error'],
    listening: ['thinking', 'idle', 'error'],
    thinking: ['responding', 'error', 'idle'],
    responding: ['speaking', 'idle', 'error'],
    speaking: ['idle', 'error', 'listening'],
    error: ['idle'],
  };
  for (const de of ESTADOS) {
    for (const para of ESTADOS) {
      const esperado = PERMITIDAS[de].includes(para);
      assert.equal(podeTransitar(de, para), esperado, `${de} -> ${para}`);
    }
  }
});

test('de qualquer estado ativo dá para cair em erro', () => {
  for (const e of ['idle', 'listening', 'thinking', 'responding', 'speaking']) {
    assert.ok(podeTransitar(e, 'error'), e);
  }
});

/* ==========================================================================
   Cooldown de TTS — extração segura do tempo de espera num 429
   (genérico: já serviu pro Gemini, serve igual pra ElevenLabs ou qualquer outro)
   ========================================================================== */

test('extrairRetryDelayMs: prioriza o header Retry-After quando presente', () => {
  const ms = extrairRetryDelayMs({ error: { message: 'x', details: [{ retryDelay: '99s' }] } }, '15');
  assert.equal(ms, 15_000);
});

test('extrairRetryDelayMs: usa o campo estruturado error.details[].retryDelay da Gemini', () => {
  const ms = extrairRetryDelayMs({ error: { message: 'quota exceeded', details: [{ '@type': 'x', retryDelay: '20.5s' }] } });
  assert.equal(ms, 20_500);
});

test('extrairRetryDelayMs: cai pro texto livre "retry in Xs" quando não há campo estruturado', () => {
  const ms = extrairRetryDelayMs({ error: { message: 'You exceeded your quota. Please retry in 12s.' } });
  assert.equal(ms, 12_000);
});

test('extrairRetryDelayMs: nunca ultrapassa o teto de 60s, mesmo se a Gemini sugerir mais', () => {
  const doHeader = extrairRetryDelayMs(null, '3600');
  assert.equal(doHeader, 60_000);
  const doDetalhe = extrairRetryDelayMs({ error: { details: [{ retryDelay: '9999s' }] } });
  assert.equal(doDetalhe, 60_000);
});

test('extrairRetryDelayMs: devolve null quando não há nenhuma fonte utilizável — quem chama decide o padrão', () => {
  assert.equal(extrairRetryDelayMs(null), null);
  assert.equal(extrairRetryDelayMs({ error: { message: 'erro genérico sem tempo nenhum' } }), null);
  assert.equal(extrairRetryDelayMs({ error: { details: [{ retryDelay: 'não é número' }] } }), null);
  assert.equal(extrairRetryDelayMs(null, 'não é número'), null);
  assert.equal(extrairRetryDelayMs(null, '-5'), null, 'valor negativo não é usado');
  assert.equal(extrairRetryDelayMs(null, '0'), null, 'zero não é um tempo de espera válido');
});

test('RETRY_MS_PADRAO existe como fallback documentado quando extrairRetryDelayMs devolve null', () => {
  assert.equal(RETRY_MS_PADRAO, 20_000);
});

test('extrairRetryDelayMs: reconhece o formato de erro da ElevenLabs ({ detail: { message } })', () => {
  const ms = extrairRetryDelayMs({ detail: { status: 'too_many_concurrent_requests', message: 'Please retry after 8s.' } });
  assert.equal(ms, 8_000);
});

test('extrairRetryDelayMs: reconhece detail como string direta', () => {
  const ms = extrairRetryDelayMs({ detail: 'rate limited, retry in 5s' });
  assert.equal(ms, 5_000);
});

test('extrairRetryDelayMs: reconhece campos numéricos genéricos (retry_after/retryAfter/retry_in/retryIn)', () => {
  assert.equal(extrairRetryDelayMs({ retry_after: 7 }), 7_000);
  assert.equal(extrairRetryDelayMs({ retryAfter: 9 }), 9_000);
  assert.equal(extrairRetryDelayMs({ retry_in: 3 }), 3_000);
  assert.equal(extrairRetryDelayMs({ retryIn: 4 }), 4_000);
});

test('extrairRetryDelayMs: campo genérico negativo/zero é ignorado, cai pro próximo formato reconhecido', () => {
  assert.equal(extrairRetryDelayMs({ retry_after: -1, message: 'retry in 6s' }), 6_000);
});

test('extrairRetryDelayMs: corpo em formato inesperado (string, número, array solto) não quebra — devolve null', () => {
  assert.equal(extrairRetryDelayMs('erro em texto puro'), null);
  assert.equal(extrairRetryDelayMs(42), null);
  assert.equal(extrairRetryDelayMs(undefined), null);
  assert.equal(extrairRetryDelayMs([1, 2, 3]), null);
});

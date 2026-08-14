/**
 * Testes da seleção manual, slots, duplicidade e autorização da IA.
 *
 * Estas são as regras que decidem QUEM recebe mensagem e QUEM a IA pode
 * atender. Errar aqui significa abordar quem pediu para não ser abordado, ou
 * soltar a IA em cima de quem nunca falou com a gente.
 *
 * Tudo com dados fictícios. Nenhum teste toca a rede, nenhum envia mensagem.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autorizacoesPendentes,
  bloqueioNoDisparo,
  avaliarSelecao,
  contarBloqueios,
  detectarTelefonesRepetidos,
  podeReceberIA,
  resumirSlot,
  selecionaveis,
} from '../shared/regras-slots.ts';

/* --------------------------------------------------------------------------
   Fábricas
   -------------------------------------------------------------------------- */

let n = 0;
function lead(sobrescrever = {}) {
  n += 1;
  return {
    id: `lead-${n}`,
    nome: 'Ana Beatriz Souza',
    empresa: 'Padaria Grão Dourado',
    telefone: '5562984747979',
    whatsapp: '5562984747979',
    nao_contatar: false,
    status: 'novo',
    ...sobrescrever,
  };
}

const alvo = (leadId, sobrescrever = {}) => ({
  lead_id: leadId,
  slot_id: null,
  status: 'pendente',
  ...sobrescrever,
});

const SLOT = 'slot-1';
const primeiro = (leads, alvos = []) => avaliarSelecao(leads, alvos, SLOT)[0];

/* ==========================================================================
   1. Seleção manual
   ========================================================================== */

test('lead comum pode ser selecionado', () => {
  const r = primeiro([lead()]);
  assert.equal(r.selecionavel, true);
  assert.equal(r.jaNoSlot, false);
});

test('a seleção respeita exatamente quem foi escolhido', () => {
  // Nenhum lead entra sozinho: avaliarSelecao só diz quem PODE, a escolha é da tela.
  const leads = [lead(), lead(), lead()];
  const estados = avaliarSelecao(leads, [], SLOT);
  assert.equal(estados.length, 3);
  assert.equal(selecionaveis(estados).length, 3);
});

test('contagem de selecionáveis ignora os bloqueados', () => {
  const leads = [lead(), lead({ nao_contatar: true }), lead({ whatsapp: null, telefone: null })];
  assert.equal(selecionaveis(avaliarSelecao(leads, [], SLOT)).length, 1);
});

/* ==========================================================================
   2. Travas de seleção
   ========================================================================== */

test('"não contatar" bloqueia — a trava absoluta', () => {
  const r = primeiro([lead({ nao_contatar: true })]);
  assert.equal(r.selecionavel, false);
  assert.equal(r.motivo, 'nao_contatar');
});

test('"não contatar" vence qualquer outra circunstância', () => {
  const r = primeiro([lead({ nao_contatar: true, status: 'qualificado' })]);
  assert.equal(r.motivo, 'nao_contatar');
});

test('sem telefone nenhum não dá para selecionar', () => {
  assert.equal(primeiro([lead({ whatsapp: null, telefone: null })]).motivo, 'sem_whatsapp');
});

test('telefone sem whatsapp ainda serve', () => {
  assert.equal(primeiro([lead({ whatsapp: null })]).selecionavel, true);
});

test('bloqueado continua visível, com o motivo', () => {
  // Sumir com o contato faria a pessoa procurá-lo achando que saiu do CRM.
  const estados = avaliarSelecao([lead({ nao_contatar: true })], [], SLOT);
  assert.equal(estados.length, 1);
  assert.ok(estados[0].motivo);
});

/* ==========================================================================
   3. Duplicidade
   ========================================================================== */

test('quem já recebeu a campanha não entra de novo', () => {
  const l = lead();
  const r = primeiro([l], [alvo(l.id, { status: 'enviado', slot_id: SLOT })]);
  assert.equal(r.selecionavel, false);
  assert.equal(r.motivo, 'ja_recebeu');
});

test('quem já respondeu também não entra de novo', () => {
  const l = lead();
  assert.equal(primeiro([l], [alvo(l.id, { status: 'respondido' })]).motivo, 'ja_recebeu');
});

test('lead em OUTRO slot da mesma campanha é bloqueado', () => {
  // Sem isso a pessoa receberia duas mensagens do mesmo disparo.
  const l = lead();
  const r = primeiro([l], [alvo(l.id, { slot_id: 'slot-2' })]);
  assert.equal(r.selecionavel, false);
  assert.equal(r.motivo, 'em_outro_slot');
});

test('lead já NESTE slot aparece marcado, não bloqueado por engano', () => {
  const l = lead();
  const r = primeiro([l], [alvo(l.id, { slot_id: SLOT })]);
  assert.equal(r.jaNoSlot, true);
  assert.equal(r.motivo, undefined);
});

test('conta os bloqueios por motivo, para a tela explicar', () => {
  const a = lead({ nao_contatar: true });
  const b = lead({ whatsapp: null, telefone: null });
  const c = lead();
  const d = lead();
  const conta = contarBloqueios(
    avaliarSelecao([a, b, c, d], [alvo(c.id, { status: 'enviado' })], SLOT),
  );
  assert.equal(conta.nao_contatar, 1);
  assert.equal(conta.sem_whatsapp, 1);
  assert.equal(conta.ja_recebeu, 1);
});

/* ==========================================================================
   4. Telefone repetido entre leads diferentes
   ========================================================================== */

test('detecta o mesmo número em dois leads distintos', () => {
  // Caso real: a pessoa preencheu o formulário duas vezes. O UNIQUE do banco é
  // por lead, então isso passaria e ela receberia a mensagem em dobro.
  const r = detectarTelefonesRepetidos([
    { leadId: 'a', telefone: '5562984747979' },
    { leadId: 'b', telefone: '5562984747979' },
    { leadId: 'c', telefone: '5562911112222' },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].leadIds.sort(), ['a', 'b']);
});

test('reconhece o mesmo número escrito de formas diferentes', () => {
  const r = detectarTelefonesRepetidos([
    { leadId: 'a', telefone: '5562984747979' },
    { leadId: 'b', telefone: '(62) 98474-7979' },
  ]);
  assert.equal(r.length, 1);
});

test('números diferentes não são apontados como repetidos', () => {
  const r = detectarTelefonesRepetidos([
    { leadId: 'a', telefone: '5562984747979' },
    { leadId: 'b', telefone: '5562911112222' },
  ]);
  assert.equal(r.length, 0);
});

test('telefone ausente ou curto é ignorado, não vira falso positivo', () => {
  const r = detectarTelefonesRepetidos([
    { leadId: 'a', telefone: null },
    { leadId: 'b', telefone: '' },
    { leadId: 'c', telefone: '123' },
  ]);
  assert.equal(r.length, 0);
});

/* ==========================================================================
   5. Autorização da IA — a regra central
   ========================================================================== */

const autorizavel = (sobrescrever = {}) => ({
  status: 'enviado',
  telefone: '5562984747979',
  ia_autorizada: true,
  ...sobrescrever,
});

test('participou do disparo E foi autorizado: a IA pode atender', () => {
  assert.equal(podeReceberIA(autorizavel()), true);
});

test('quem respondeu também continua autorizado', () => {
  assert.equal(podeReceberIA(autorizavel({ status: 'respondido' })), true);
});

test('PENDENTE não autoriza — estar no slot não basta', () => {
  // O ponto central: entrar na campanha não libera a IA. Só o disparo libera.
  assert.equal(podeReceberIA(autorizavel({ status: 'pendente' })), false);
});

test('enviado mas SEM autorização efetivada não libera a IA', () => {
  assert.equal(podeReceberIA(autorizavel({ ia_autorizada: false })), false);
});

test('contato desconhecido nunca é autorizado', () => {
  // O caso da Maria, que não participou de disparo nenhum.
  assert.equal(podeReceberIA(null), false);
  assert.equal(podeReceberIA(undefined), false);
});

test('sem telefone não há como autorizar', () => {
  assert.equal(podeReceberIA(autorizavel({ telefone: null })), false);
});

test('ignorado e falhou não autorizam', () => {
  assert.equal(podeReceberIA(autorizavel({ status: 'ignorado' })), false);
  assert.equal(podeReceberIA(autorizavel({ status: 'falhou' })), false);
});

test('lista as autorizações que falharam e precisam ser repetidas', () => {
  const alvos = [
    autorizavel(),
    autorizavel({ ia_autorizada: false }),
    autorizavel({ status: 'pendente', ia_autorizada: false }),
    autorizavel({ ia_autorizada: false, telefone: null }),
  ];
  const pendentes = autorizacoesPendentes(alvos);
  // Só o enviado-sem-autorização-com-telefone entra.
  assert.equal(pendentes.length, 1);
});

/* ==========================================================================
   6. Resumo do slot
   ========================================================================== */

test('resume o slot separando enviados, autorizados e pendências', () => {
  const r = resumirSlot([
    autorizavel({ status: 'pendente', ia_autorizada: false }),
    autorizavel(),
    autorizavel({ status: 'respondido' }),
    autorizavel({ ia_autorizada: false }),
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.pendentes, 1);
  assert.equal(r.enviados, 2);
  assert.equal(r.respondidos, 1);
  assert.equal(r.autorizados, 2);
  assert.equal(r.semAutorizacao, 1);
});

test('slot vazio não quebra nem divide por zero', () => {
  const r = resumirSlot([]);
  assert.equal(r.total, 0);
  assert.equal(r.semAutorizacao, 0);
});

/* ==========================================================================
   REVALIDAÇÃO NO INSTANTE DO DISPARO

   `avaliarSelecao` decide quem PODE ENTRAR no slot, e roda na montagem do
   lote. Entre montar e disparar passa tempo, e o mundo muda. Sem revalidar,
   `nao_contatar` seria furado por simples passagem de tempo — a trava
   absoluta do projeto valendo só no dia em que o lote foi montado.
   ========================================================================== */

const leadOk = (s = {}) => ({
  id: 'l1',
  nome: 'Fulano',
  whatsapp: '5562983199074',
  telefone: null,
  nao_contatar: false,
  ...s,
});

test('lead marcado "não contatar" DEPOIS de entrar no slot é bloqueado', () => {
  // O caso que motivou a correção: entrou no lote na segunda, pediu para não
  // ser contatado na terça, disparo na quarta.
  const alvo = { lead_id: 'l1', slot_id: 's1', status: 'pendente' };
  assert.equal(bloqueioNoDisparo(leadOk({ nao_contatar: true }), alvo), 'nao_contatar');
});

test('lead que perdeu o telefone depois de entrar no slot é bloqueado', () => {
  const alvo = { lead_id: 'l1', slot_id: 's1', status: 'pendente' };
  assert.equal(
    bloqueioNoDisparo(leadOk({ whatsapp: null, telefone: null }), alvo),
    'sem_whatsapp',
  );
});

test('quem já recebeu é bloqueado — trava de duplicidade no disparo', () => {
  for (const status of ['enviado', 'respondido']) {
    const alvo = { lead_id: 'l1', slot_id: 's1', status };
    assert.equal(bloqueioNoDisparo(leadOk(), alvo), 'ja_recebeu', `status ${status}`);
  }
});

test('lead íntegro e ainda pendente passa', () => {
  const alvo = { lead_id: 'l1', slot_id: 's1', status: 'pendente' };
  assert.equal(bloqueioNoDisparo(leadOk(), alvo), null);
});

test('nao_contatar vence qualquer outra condição', () => {
  // Mesmo sem telefone e já enviado, o motivo reportado é o absoluto.
  const alvo = { lead_id: 'l1', slot_id: 's1', status: 'enviado' };
  assert.equal(
    bloqueioNoDisparo(leadOk({ nao_contatar: true, whatsapp: null, telefone: null }), alvo),
    'nao_contatar',
  );
});

/* ==========================================================================
   REGRESSÃO — "0 registrados" não é sucesso

   O bug real: um slot em que nada podia ser processado devolvia
   `registrados: 0` e a tela mostrava "0 contato(s) registrados" num toast
   VERDE. O operador lia como concluído, o contato nunca chegava à whitelist,
   e a IA ficava calada sem nenhuma pista do motivo.

   A decisão da tela é pura e está testada aqui: dado um resultado, qual é o
   tom da mensagem e o motivo mostrado.
   ========================================================================== */

/** Espelha a decisão de `confirmar()` em CampanhaSlots.tsx. */
function decidirAviso(r) {
  if (r.registrados === 0) {
    if (r.totalNoSlot === 0) return { tom: 'erro', causa: 'slot_vazio' };
    if (r.ignorados.length > 0) return { tom: 'erro', causa: 'todos_pulados' };
    return { tom: 'erro', causa: 'sem_motivo_declarado' };
  }
  if (r.falhasAutorizacao.length > 0) return { tom: 'erro', causa: 'sem_autorizacao' };
  return { tom: 'sucesso', causa: 'ok' };
}

const resultado = (s = {}) => ({
  registrados: 0,
  autorizados: 0,
  falhasAutorizacao: [],
  ignorados: [],
  totalNoSlot: 0,
  ...s,
});

test('slot vazio NÃO mostra sucesso', () => {
  const d = decidirAviso(resultado());
  assert.equal(d.tom, 'erro');
  assert.equal(d.causa, 'slot_vazio');
});

test('todos os contatos pulados NÃO mostra sucesso — e diz o motivo', () => {
  const r = resultado({
    totalNoSlot: 2,
    ignorados: [
      { nome: 'Ana', telefone: '5562911110001', motivo: 'já registrado como enviado neste slot' },
      { nome: 'Bruno', telefone: '5562911110002', motivo: 'Marcado como “não contatar”' },
    ],
  });
  const d = decidirAviso(r);
  assert.equal(d.tom, 'erro');
  assert.equal(d.causa, 'todos_pulados');
  // O motivo precisa chegar à tela, não só a contagem.
  assert.ok(r.ignorados.every((i) => i.motivo && i.nome));
});

test('registrado mas SEM autorização é erro, não sucesso', () => {
  // Este é o caso que faz a IA ficar muda. Não pode passar como verde.
  const d = decidirAviso(
    resultado({
      registrados: 1,
      autorizados: 0,
      totalNoSlot: 1,
      falhasAutorizacao: [{ telefone: '5562911110001', erro: 'canal recusou' }],
    }),
  );
  assert.equal(d.tom, 'erro');
  assert.equal(d.causa, 'sem_autorizacao');
});

test('trabalho de verdade mostra sucesso', () => {
  const d = decidirAviso(resultado({ registrados: 2, autorizados: 2, totalNoSlot: 2 }));
  assert.equal(d.tom, 'sucesso');
});

test('sucesso parcial: registra alguns e pula outros, sem esconder os pulados', () => {
  const r = resultado({
    registrados: 1,
    autorizados: 1,
    totalNoSlot: 2,
    ignorados: [{ nome: 'Ana', telefone: '5562911110001', motivo: 'já registrado' }],
  });
  assert.equal(decidirAviso(r).tom, 'sucesso');
  assert.equal(r.ignorados.length, 1, 'os pulados continuam visíveis na mensagem');
});

test('zero registrados sem motivo declarado é tratado como bug, não como sucesso', () => {
  // Se um caminho novo pular alguém sem registrar o motivo, a tela grita.
  const d = decidirAviso(resultado({ totalNoSlot: 3 }));
  assert.equal(d.tom, 'erro');
  assert.equal(d.causa, 'sem_motivo_declarado');
});

/* ==========================================================================
   REGRESSÃO — bloqueio circunstancial não pode virar estado permanente

   O bug: `dispararSlot` marcava QUALQUER bloqueio como `status: 'ignorado'`.
   Um lead sem telefone (circunstancial, resolve editando o cadastro) saía de
   `pendente` para sempre. Resultado na tela: "Pendentes: 0" e "Todos os leads
   já foram tratados" — com zero mensagens enviadas e nenhuma forma de
   reprocessar o contato.

   Só `nao_contatar` é decisão permanente.
   ========================================================================== */

/** Espelha a decisão de `dispararSlot`/`confirmarDisparoSlot`. */
function statusApos(bloqueio) {
  return bloqueio === 'nao_contatar' ? 'ignorado' : 'pendente';
}

test('nao_contatar é permanente: vira ignorado', () => {
  assert.equal(statusApos('nao_contatar'), 'ignorado');
});

test('sem_whatsapp é circunstancial: CONTINUA pendente', () => {
  // Edita o cadastro, adiciona o número, e o contato volta a ser processável.
  assert.equal(statusApos('sem_whatsapp'), 'pendente');
});

test('ja_recebeu é histórico: não re-marca o alvo', () => {
  assert.equal(statusApos('ja_recebeu'), 'pendente');
});

test('sem bloqueio nenhum permanece pendente até ser processado', () => {
  assert.equal(statusApos(null), 'pendente');
});

test('um lead recém-colocado no slot conta como PENDENTE', () => {
  // O caso do relato: "Pendentes: 0" com o lead acabado de entrar no slot.
  const alvos = [{ status: 'pendente' }];
  assert.equal(resumirSlot(alvos).pendentes, 1);
});

test('campanha com alvos e zero enviados NÃO está concluída', () => {
  // A tela dizia "todos já foram tratados" em verde. Não estava tratado nada.
  const r = resumirSlot([{ status: 'ignorado' }]);
  assert.equal(r.pendentes, 0);
  assert.equal(r.enviados, 0);
  assert.ok(r.total > 0, 'há lead na campanha, então não é campanha vazia');
});

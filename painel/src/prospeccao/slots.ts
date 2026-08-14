/**
 * Slots de disparo e autorização da IA.
 *
 * Este é o módulo que implementa o fluxo combinado:
 *
 *   você seleciona os contatos → escolhe a mensagem → organiza em slots →
 *   revisa → VOCÊ dispara pelo WhatsApp → confirma aqui →
 *   só então a IA fica autorizada a atender aqueles contatos.
 *
 * ===========================================================================
 * ENVIAR E REGISTRAR SÃO COISAS DIFERENTES — e continuam separadas.
 *
 *   prepararSlot          monta texto e link do WhatsApp. Não envia.
 *   confirmarDisparoSlot  REGISTRA um envio que você fez na mão, e autoriza.
 *   dispararSlot          ENVIA pela API, contato a contato, e só então
 *                         registra e autoriza cada um.
 *
 * `dispararSlot` roda uma vez, a partir de um clique já confirmado na tela.
 * Não há laço acima dela, nem cron, nem retry automático. E o servidor recusa
 * tudo enquanto `NINJABOT_ENVIO_LIBERADO` não for "true".
 *
 * A ordem dentro de `dispararSlot` é a garantia do projeto:
 * ENVIOU → REGISTROU → AUTORIZOU. Quem falha no envio não é autorizado.
 * ===========================================================================
 */

import { db } from '@/data';
import { montarMensagem } from '../../shared/regras-campanha';
import { whatsappLink } from '@/lib/format';
import type { Campaign, CampaignSlot, CampaignTarget, Lead, SlotStatus } from '@/types';

// A decisao de quem pode entrar num disparo vive em shared/, testavel sem banco.
import {
  autorizacoesPendentes,
  avaliarSelecao,
  BLOQUEIO_TEXTO,
  bloqueioNoDisparo,
  contarBloqueios,
  detectarTelefonesRepetidos,
  podeReceberIA,
  resumirSlot,
  selecionaveis,
  type EstadoSelecao,
  type MotivoBloqueio,
  type ResumoSlot,
} from '../../shared/regras-slots';

export {
  autorizacoesPendentes,
  avaliarSelecao,
  BLOQUEIO_TEXTO,
  contarBloqueios,
  detectarTelefonesRepetidos,
  podeReceberIA,
  resumirSlot,
  selecionaveis,
};
export type { EstadoSelecao, MotivoBloqueio, ResumoSlot };

/* --------------------------------------------------------------------------
   Seleção manual de contatos
   -------------------------------------------------------------------------- */

/**
 * Coloca EXATAMENTE os leads escolhidos dentro de um slot.
 *
 * Nenhum lead entra por conta própria: a lista vem da sua seleção na tela. Um
 * lead já atribuído a outro slot da mesma campanha é recusado, para o mesmo
 * contato não receber duas mensagens do mesmo disparo.
 */
export async function atribuirAoSlot(
  campanha: Campaign,
  slot: CampaignSlot,
  leadIds: string[],
): Promise<{ atribuidos: number; recusados: { leadId: string; motivo: string }[] }> {
  const [alvos, leads] = await Promise.all([
    db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } }),
    db.leads.todos(),
  ]);

  const porLead = new Map(alvos.map((a) => [a.lead_id, a]));
  const leadPorId = new Map(leads.map((l) => [l.id, l]));

  const recusados: { leadId: string; motivo: string }[] = [];
  let atribuidos = 0;

  for (const leadId of leadIds) {
    const lead = leadPorId.get(leadId);
    if (!lead) {
      recusados.push({ leadId, motivo: 'Lead não encontrado' });
      continue;
    }

    // A trava de contato pessoal vale aqui também, mesmo com seleção manual:
    // marcar "não contatar" precisa significar não contatar, sempre.
    if (lead.nao_contatar) {
      recusados.push({ leadId, motivo: 'Marcado como “não contatar”' });
      continue;
    }

    const telefone = lead.whatsapp ?? lead.telefone;
    if (!telefone) {
      recusados.push({ leadId, motivo: 'Sem número de WhatsApp' });
      continue;
    }

    const existente = porLead.get(leadId);

    if (existente) {
      if (existente.status === 'enviado' || existente.status === 'respondido') {
        recusados.push({ leadId, motivo: 'Já recebeu esta campanha' });
        continue;
      }
      if (existente.slot_id && existente.slot_id !== slot.id) {
        recusados.push({ leadId, motivo: 'Já está em outro slot' });
        continue;
      }
      await db.alvosCampanha.atualizar(existente.id, {
        slot_id: slot.id,
        status: 'pendente',
        telefone,
        mensagem_final: montarMensagem(slot.mensagem, lead),
      });
      atribuidos++;
      continue;
    }

    await db.alvosCampanha.criar({
      campanha_id: campanha.id,
      lead_id: leadId,
      status: 'pendente',
      lote: null,
      enviado_em: null,
      respondido_em: null,
      observacao: null,
      slot_id: slot.id,
      telefone,
      mensagem_final: montarMensagem(slot.mensagem, lead),
      ia_autorizada: false,
      ia_autorizada_em: null,
      ia_canal_id: null,
      conversa_externa_id: null,
      mensagem_externa_id: null,
    });
    atribuidos++;
  }

  return { atribuidos, recusados };
}

/**
 * Mensagem individual para UM contato, diferente da do slot.
 *
 * Atende o caso "João recebe a mensagem A, Pedro recebe a B" dentro do mesmo
 * lote. A mensagem passa a ser dele: `regerarMensagens` não a sobrescreve,
 * porque quem editou à mão quis aquele texto.
 */
export async function definirMensagemDoContato(
  alvo: CampaignTarget,
  mensagem: string,
): Promise<void> {
  if (alvo.status === 'enviado' || alvo.status === 'respondido') {
    throw new Error('Este contato já recebeu a mensagem. O texto enviado não pode ser reescrito.');
  }
  await db.alvosCampanha.atualizar(alvo.id, {
    mensagem_final: mensagem.trim().slice(0, 4000),
    // Marca que houve edição manual, para a regeração respeitar.
    observacao: 'mensagem personalizada',
  });
}

/** Tira um contato do slot, sem apagar o histórico da campanha. */
export async function removerDoSlot(alvo: CampaignTarget): Promise<void> {
  if (alvo.status === 'enviado' || alvo.status === 'respondido') {
    throw new Error('Este contato já recebeu a mensagem. O registro do disparo não pode ser desfeito.');
  }
  await db.alvosCampanha.atualizar(alvo.id, { slot_id: null, mensagem_final: null });
}

/* --------------------------------------------------------------------------
   Preparação (revisão antes do disparo)
   -------------------------------------------------------------------------- */

export interface ItemPreparado {
  alvo: CampaignTarget;
  lead: Lead;
  telefone: string;
  mensagem: string;
  /** `null` quando o número não forma um link válido. */
  link: string | null;
  /**
   * Motivo pelo qual este contato NÃO pode receber agora, revalidado no
   * momento da preparação — não no dia em que ele entrou no slot.
   *
   * `null` = liberado. Ver `bloqueioNoDisparo` em shared/regras-slots.ts.
   */
  bloqueio: MotivoBloqueio | null;
}

/**
 * Monta o slot pronto para revisão: cada contato com a mensagem final e o
 * link do WhatsApp já com o texto embutido.
 *
 * Abrir o link NÃO envia nada — o WhatsApp abre a conversa com a mensagem
 * digitada, e quem aperta enviar é você.
 */
export async function prepararSlot(slot: CampaignSlot): Promise<ItemPreparado[]> {
  const [alvos, leads] = await Promise.all([
    db.alvosCampanha.todos({ filtros: { slot_id: slot.id } }),
    db.leads.todos(),
  ]);

  const porId = new Map(leads.map((l) => [l.id, l]));
  const preparados: ItemPreparado[] = [];

  for (const alvo of alvos) {
    const lead = porId.get(alvo.lead_id);
    if (!lead) continue;

    const telefone = alvo.telefone ?? lead.whatsapp ?? lead.telefone ?? '';
    // A mensagem congelada tem prioridade: é a que você revisou. Só recalcula
    // se ainda não existir.
    const mensagem = alvo.mensagem_final ?? montarMensagem(slot.mensagem, lead);

    preparados.push({
      alvo,
      lead,
      telefone,
      mensagem,
      link: whatsappLink(telefone, mensagem),
      // Revalidado agora, com o estado ATUAL do lead.
      bloqueio: bloqueioNoDisparo(lead, alvo),
    });
  }

  return preparados;
}

/**
 * Regera as mensagens do slot a partir do modelo atual.
 * Usado quando você edita o texto depois de já ter atribuído contatos.
 */
export async function regerarMensagens(slot: CampaignSlot): Promise<number> {
  const preparados = await prepararSlot(slot);
  let atualizados = 0;

  for (const item of preparados) {
    // Contato já disparado mantém a mensagem original: o registro histórico
    // precisa refletir o que foi realmente enviado.
    if (item.alvo.status === 'enviado' || item.alvo.status === 'respondido') continue;

    await db.alvosCampanha.atualizar(item.alvo.id, {
      mensagem_final: montarMensagem(slot.mensagem, item.lead),
    });
    atualizados++;
  }

  return atualizados;
}

/* --------------------------------------------------------------------------
   Confirmação e autorização
   -------------------------------------------------------------------------- */

export interface ResultadoConfirmacao {
  registrados: number;
  autorizados: number;
  /** Contatos registrados cuja autorização no NinjaBot falhou. */
  falhasAutorizacao: { telefone: string; erro: string }[];
  /**
   * Quem foi pulado e por quê.
   *
   * POR QUE ISTO EXISTE: sem esta lista, um slot em que nada podia ser
   * processado devolvia `registrados: 0` e a tela mostrava
   * "0 contato(s) registrados" num toast VERDE, de sucesso. O operador lia
   * como "registro concluído", o contato nunca era autorizado, e a IA ficava
   * calada sem nenhuma pista do motivo. Zero trabalho não é sucesso.
   */
  ignorados: { nome: string; telefone: string; motivo: string }[];
  /** Total de itens no slot, antes de qualquer filtro. */
  totalNoSlot: number;
}

/**
 * Registra que VOCÊ disparou este slot.
 *
 * MODO ASSISTIDO: o painel monta o lote e congela o que foi enviado; o envio
 * acontece por você, no WhatsApp. Esta função não fala com nenhuma API — ela
 * apenas grava o que já aconteceu.
 *
 * Antes ela também autorizava a IA do NinjaBot. Essa integração foi removida
 * do projeto; o parâmetro `canalId` saiu junto, porque não havia mais canal
 * para informar.
 */
export async function confirmarDisparoSlot(slot: CampaignSlot): Promise<ResultadoConfirmacao> {
  const preparados = await prepararSlot(slot);
  const agora = new Date().toISOString();

  let registrados = 0;
  let autorizados = 0;
  const falhasAutorizacao: { telefone: string; erro: string }[] = [];
  const ignorados: { nome: string; telefone: string; motivo: string }[] = [];

  /* Alvos que `prepararSlot` descartou por não achar o lead.
     Era um `continue` mudo: o contato sumia do processamento sem aparecer em
     lugar nenhum, e o resultado vinha "0 registrados" sem motivo. */
  const alvosCrus = await db.alvosCampanha.todos({ filtros: { slot_id: slot.id } });
  if (alvosCrus.length > preparados.length) {
    ignorados.push({
      nome: `${alvosCrus.length - preparados.length} contato(s)`,
      telefone: '',
      motivo: 'o lead não foi encontrado no CRM (removido ou fora do alcance da consulta)',
    });
  }

  for (const item of preparados) {
    // Ja registrado antes. Nao reprocessa — mas DIZ que pulou.
    if (item.alvo.status === 'enviado' || item.alvo.status === 'respondido') {
      ignorados.push({
        nome: item.lead.nome,
        telefone: item.telefone,
        motivo: 'já registrado como enviado neste slot',
      });
      continue;
    }

    /* ---- 0. `nao_contatar` vale aqui também ----

       Este caminho não envia — você já enviou pelo WhatsApp. Mas ele AUTORIZA
       a IA, e liberar a IA em cima de quem pediu para não ser contatado é
       justamente o que `nao_contatar` existe para impedir. Sem esta checagem,
       a trava absoluta seria contornável pelo botão "Já enviei". */
    if (item.bloqueio) {
      const motivo = BLOQUEIO_TEXTO[item.bloqueio];
      // So 'nao_contatar' vira 'ignorado' no banco: e decisao permanente.
      // Os outros bloqueios sao circunstanciais e o alvo segue pendente.
      if (item.bloqueio === 'nao_contatar') {
        await db.alvosCampanha.atualizar(item.alvo.id, { status: 'ignorado', observacao: motivo });
      }
      ignorados.push({ nome: item.lead.nome, telefone: item.telefone, motivo });
      continue;
    }

    /* ---- 1. Registro local ---- */
    await db.alvosCampanha.atualizar(item.alvo.id, {
      status: 'enviado',
      enviado_em: agora,
      telefone: item.telefone,
      mensagem_final: item.mensagem,
    });
    registrados++;

    if (item.lead.status === 'novo') {
      await db.leads.atualizar(item.lead.id, {
        status: 'contatado',
        ultima_interacao: agora,
        campanha: slot.nome,
      });
    }

    /* ---- 2. Autorização da IA — NÃO EXISTE MAIS ----

       A integração com o NinjaBot foi removida do projeto. Não há mais
       whitelist, portão de envio nem IA assumindo conversa: o painel registra
       quem foi contatado e o atendimento é seu, pelo WhatsApp.

       As colunas `ia_autorizada`, `ia_autorizada_em` e `ia_canal_id`
       continuam no banco de propósito — guardam o histórico do que já foi
       autorizado enquanto a integração existiu. Apagá-las exigiria migration
       destrutiva e perderia esse registro. Elas simplesmente não são mais
       escritas. */
  }

  // Slot so vira 'disparado' se algo realmente foi registrado. Marcar um slot
  // vazio como disparado esconderia os contatos que ainda precisam de acao.
  if (registrados > 0) {
    await db.slotsCampanha.atualizar(slot.id, { status: 'disparado', disparado_em: agora });
  }

  return {
    registrados,
    autorizados,
    falhasAutorizacao,
    ignorados,
    // Conta os alvos CRUS, não os preparados: se `prepararSlot` descartou
    // algum, o total precisa denunciar a diferença em vez de escondê-la.
    totalNoSlot: alvosCrus.length,
  };
}




/* --------------------------------------------------------------------------
   Consulta de participação
   -------------------------------------------------------------------------- */

/**
 * Este telefone participou de algum disparo e está autorizado?
 *
 * É a pergunta que responde ao item central do pedido: só quem participou
 * pode receber atendimento automático. Serve para conferência na tela e para
 * auditar o que o NinjaBot está fazendo.
 */
export async function participouDoDisparo(
  telefone: string,
): Promise<{ participou: boolean; autorizado: boolean; alvo: CampaignTarget | null }> {
  const digitos = telefone.replace(/\D/g, '');
  const normalizado = digitos.startsWith('55') ? digitos : `55${digitos}`;

  const alvos = await db.alvosCampanha.todos();
  const alvo =
    alvos.find(
      (a) => a.telefone && a.telefone.replace(/\D/g, '').endsWith(normalizado.slice(-11)),
    ) ?? null;

  return {
    participou: Boolean(alvo && (alvo.status === 'enviado' || alvo.status === 'respondido')),
    autorizado: Boolean(alvo?.ia_autorizada),
    alvo,
  };
}

/** Contatos de uma campanha, com o estado de cada um. */
export async function participantesDaCampanha(campanhaId: string): Promise<CampaignTarget[]> {
  const alvos = await db.alvosCampanha.todos({ filtros: { campanha_id: campanhaId } });
  return alvos.filter((a) => a.status === 'enviado' || a.status === 'respondido');
}

/* --------------------------------------------------------------------------
   Slots
   -------------------------------------------------------------------------- */

export async function criarSlot(
  campanha: Campaign,
  dados: { nome: string; mensagem: string },
): Promise<CampaignSlot> {
  const existentes = await db.slotsCampanha.todos({ filtros: { campanha_id: campanha.id } });
  const ordem = existentes.length + 1;

  return db.slotsCampanha.criar({
    campanha_id: campanha.id,
    nome: dados.nome.trim() || `Slot ${ordem}`,
    mensagem: dados.mensagem.trim(),
    status: 'rascunho' as SlotStatus,
    ordem,
    disparado_em: null,
  });
}

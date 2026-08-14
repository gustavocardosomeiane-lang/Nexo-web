/**
 * Motor de campanhas — NinjaBot em MODO ASSISTIDO.
 *
 * O NinjaBot que operamos não expõe API pública, então nada é enviado por
 * HTTP daqui. O que este módulo faz é tudo que dá para fazer com segurança:
 * escolher o público, montar os lotes, gerar a mensagem pronta, registrar
 * quem já foi contatado e mover o funil. O envio em si acontece no painel do
 * NinjaBot / WhatsApp, e o operador confirma aqui.
 *
 * ===========================================================================
 * AS QUATRO TRAVAS. São o motivo deste arquivo existir.
 *
 *   1. PÚBLICO FECHADO. Só entra na campanha quem carrega a tag escolhida.
 *      A checagem é feita na geração dos alvos E de novo na montagem do lote.
 *
 *   2. NÃO CONTATAR. `lead.nao_contatar` exclui de qualquer campanha, sempre.
 *      É onde ficam contato pessoal, fornecedor e quem pediu para não receber.
 *
 *   3. UM CONTATO POR CAMPANHA. `campaign_targets` tem UNIQUE(campanha, lead).
 *      Recarregar a tela ou dois operadores trabalhando juntos não geram
 *      disparo repetido.
 *
 *   4. CARÊNCIA GLOBAL. Um lead contatado por QUALQUER campanha nos últimos
 *      N dias não entra numa nova. Evita a mesma pessoa receber três
 *      abordagens em uma semana.
 * ===========================================================================
 */

import { db } from '@/data';
import type { Campaign, CampaignTarget, Lead } from '@/types';
import { whatsappLink } from '@/lib/format';

/**
 * O que aconteceu ao confirmar o envio de um contato do lote.
 *
 * Existe porque registrar e AUTORIZAR A IA são coisas diferentes, e a segunda
 * pode falhar sozinha. Antes esta função devolvia `void`: a autorização nem
 * era tentada, e a tela não tinha como saber. Foi assim que um lead recebeu a
 * mensagem, ficou registrado, e a IA nunca assumiu a conversa.
 */
export interface ResultadoConfirmacaoEnvio {
  registrado: boolean;
  autorizada: boolean;
  /** Mensagem do erro quando a autorização falhou. `null` quando deu certo. */
  erroAutorizacao: string | null;
  /** `true` quando o contato foi barrado por “não contatar”. */
  bloqueado: boolean;
}

// As regras puras vivem em shared/ para poderem ser testadas sem banco.
// Reexportadas aqui para quem consome o motor nao precisar saber disso.
import {
  avaliarPublico,
  montarMensagem,
  resumirCampanha,
  temTag,
  variaveisVazias,
  CARENCIA_DIAS,
  MOTIVO_TEXTO,
  TAMANHO_LOTE_PADRAO,
  VARIAVEIS_DISPONIVEIS,
  type Avaliacao,
  type MotivoInelegivel,
  type ResumoCampanha,
} from '../../shared/regras-campanha';

export {
  avaliarPublico,
  montarMensagem,
  resumirCampanha,
  variaveisVazias,
  CARENCIA_DIAS,
  MOTIVO_TEXTO,
  TAMANHO_LOTE_PADRAO,
  VARIAVEIS_DISPONIVEIS,
};
export type { Avaliacao, MotivoInelegivel, ResumoCampanha };

/** Leads contatados recentemente por qualquer campanha. */
async function idsEmCarencia(): Promise<Set<string>> {
  const limite = new Date();
  limite.setDate(limite.getDate() - CARENCIA_DIAS);
  const corte = limite.toISOString();

  const alvos = await db.alvosCampanha.todos();
  return new Set(
    alvos.filter((a) => a.enviado_em && a.enviado_em >= corte).map((a) => a.lead_id),
  );
}

/* --------------------------------------------------------------------------
   Preparação
   -------------------------------------------------------------------------- */

export interface PreviaCampanha {
  avaliacoes: Avaliacao[];
  elegiveis: Lead[];
  /** Contagem por motivo de exclusão. */
  exclusoes: Partial<Record<MotivoInelegivel, number>>;
}

/** Prévia antes de gerar os alvos. Mostra quem entra e quem fica de fora. */
export async function previaDaCampanha(campanha: Pick<Campaign, 'id' | 'tag'>): Promise<PreviaCampanha> {
  const [leads, alvosExistentes, carencia] = await Promise.all([
    db.leads.todos(),
    db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } }),
    idsEmCarencia(),
  ]);

  const jaNaCampanha = new Set(alvosExistentes.map((a) => a.lead_id));
  // Quem já está nesta campanha não conta como "em carência" — senão o lead
  // apareceria com o motivo errado.
  for (const id of jaNaCampanha) carencia.delete(id);

  const avaliacoes = avaliarPublico(leads, campanha, { jaNaCampanha, emCarencia: carencia });

  const exclusoes: Partial<Record<MotivoInelegivel, number>> = {};
  for (const a of avaliacoes) {
    if (!a.elegivel && a.motivo) exclusoes[a.motivo] = (exclusoes[a.motivo] ?? 0) + 1;
  }

  return {
    avaliacoes,
    elegiveis: avaliacoes.filter((a) => a.elegivel).map((a) => a.lead),
    exclusoes,
  };
}

/**
 * Cria os alvos da campanha a partir do público elegível.
 * Idempotente: rodar de novo só acrescenta lead novo que passou a se
 * encaixar, nunca duplica quem já está.
 */
export async function gerarAlvos(campanha: Campaign): Promise<{ criados: number; total: number }> {
  const previa = await previaDaCampanha(campanha);

  let criados = 0;
  for (const lead of previa.elegiveis) {
    await db.alvosCampanha.criar({
      campanha_id: campanha.id,
      lead_id: lead.id,
      status: 'pendente',
      lote: null,
      enviado_em: null,
      respondido_em: null,
      observacao: null,
      // Participação e autorização só são preenchidas quando VOCÊ confirma o
      // envio. Entrar no público não autoriza a IA a nada.
      slot_id: null,
      telefone: null,
      mensagem_final: null,
      ia_autorizada: false,
      ia_autorizada_em: null,
      ia_canal_id: null,
      conversa_externa_id: null,
      mensagem_externa_id: null,
    });
    criados++;
  }

  const total = (await db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } })).length;
  return { criados, total };
}

/* --------------------------------------------------------------------------
   Lotes
   -------------------------------------------------------------------------- */

export interface ItemLote {
  alvo: CampaignTarget;
  lead: Lead;
  mensagem: string;
  /** `null` quando o número é inválido — o item entra bloqueado. */
  link: string | null;
}

export interface Lote {
  numero: number;
  itens: ItemLote[];
  /** Quantos ainda restam depois deste lote. */
  restantes: number;
}

/**
 * Monta o próximo lote de pendentes.
 *
 * REVALIDA cada lead antes de incluir. Entre gerar os alvos e disparar o lote
 * pode ter passado uma semana: o lead pode ter virado cliente, ganhado a marca
 * "não contatar" ou perdido a tag. Alvo que não passa mais é marcado como
 * `ignorado` com o motivo, e não entra no lote.
 */
export async function proximoLote(campanha: Campaign): Promise<Lote> {
  const [alvos, leads] = await Promise.all([
    db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } }),
    db.leads.todos(),
  ]);

  const porId = new Map(leads.map((l) => [l.id, l]));
  const pendentes = alvos.filter((a) => a.status === 'pendente');

  const usados = alvos.map((a) => a.lote ?? 0);
  const numero = Math.max(0, ...usados) + 1;

  const tamanho = campanha.tamanho_lote > 0 ? campanha.tamanho_lote : TAMANHO_LOTE_PADRAO;
  const itens: ItemLote[] = [];

  for (const alvo of pendentes) {
    if (itens.length >= tamanho) break;

    const lead = porId.get(alvo.lead_id);

    if (!lead) {
      await db.alvosCampanha.atualizar(alvo.id, { status: 'ignorado', observacao: 'Lead removido' });
      continue;
    }

    // Revalidação — as travas valem no momento do envio, não só na geração.
    let motivo: MotivoInelegivel | null = null;
    if (lead.nao_contatar) motivo = 'nao_contatar';
    else if (!temTag(lead, campanha.tag)) motivo = 'fora_da_tag';
    else if (lead.status === 'cliente') motivo = 'ja_cliente';
    else if (!lead.whatsapp && !lead.telefone) motivo = 'sem_whatsapp';

    if (motivo) {
      await db.alvosCampanha.atualizar(alvo.id, {
        status: 'ignorado',
        observacao: MOTIVO_TEXTO[motivo],
      });
      continue;
    }

    const mensagem = montarMensagem(campanha.mensagem, lead);
    const atualizado = await db.alvosCampanha.atualizar(alvo.id, { lote: numero });

    itens.push({
      alvo: atualizado,
      lead,
      mensagem,
      link: whatsappLink(lead.whatsapp ?? lead.telefone, mensagem),
    });
  }

  const restantes = pendentes.length - itens.length;
  return { numero, itens, restantes: Math.max(0, restantes) };
}

/* --------------------------------------------------------------------------
   Confirmação de envio
   -------------------------------------------------------------------------- */

/**
 * Telefone só com dígitos e prefixo 55.
 *
 * Vivia em `shared/regras-disparo.ts`, que saiu junto com a integração do
 * NinjaBot. Aqui ele serve apenas para congelar o número no registro do
 * disparo — não alimenta mais nenhuma API externa.
 */
function soDigitosCom55(valor: string): string {
  const d = (valor ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

/**
 * Registra que a primeira mensagem saiu.
 *
 * É o ponto em que o disparo vira fato no sistema:
 *   - alvo vira `enviado`;
 *   - lead sai de `novo` para `contatado`;
 *   - nasce a conversa, aguardando resposta.
 *
 * Chamado só depois que o operador confirma — o painel nunca marca sozinho.
 */
export async function confirmarEnvio(
  campanha: Campaign,
  item: ItemLote,
): Promise<ResultadoConfirmacaoEnvio> {
  const agora = new Date().toISOString();
  const telefone = soDigitosCom55(item.lead.whatsapp ?? item.lead.telefone ?? '');

  /* ---- 0. `nao_contatar` revalidado agora ----

     O lead pode ter pedido para não ser contatado depois de entrar no lote.
     Sem esta checagem, a trava absoluta valeria só até a montagem — e aqui ela
     importa em dobro, porque este caminho AUTORIZA a IA. */
  if (item.lead.nao_contatar) {
    await db.alvosCampanha.atualizar(item.alvo.id, {
      status: 'ignorado',
      observacao: 'Marcado como “não contatar”',
    });
    return { registrado: false, autorizada: false, erroAutorizacao: null, bloqueado: true };
  }

  /* ---- 1. Registro do participante ---- */
  await db.alvosCampanha.atualizar(item.alvo.id, {
    status: 'enviado',
    enviado_em: agora,
    telefone,
  });

  if (item.lead.status === 'novo') {
    await db.leads.atualizar(item.lead.id, {
      status: 'contatado',
      ultima_interacao: agora,
      campanha: campanha.nome,
    });
  } else {
    await db.leads.atualizar(item.lead.id, { ultima_interacao: agora });
  }

  // Uma conversa por lead por campanha. Se já existe (reenvio manual), atualiza.
  const existentes = await db.conversas.todos({ filtros: { lead_id: item.lead.id } });
  const daCampanha = existentes.find((c) => c.campanha === campanha.nome);

  if (daCampanha) {
    await db.conversas.atualizar(daCampanha.id, {
      status: 'aguardando_resposta',
      ultima_mensagem: item.mensagem,
      ultima_mensagem_em: agora,
      mensagens_enviadas: daCampanha.mensagens_enviadas + 1,
    });
    return { registrado: true, autorizada: false, erroAutorizacao: null, bloqueado: false };
  }

  await db.conversas.criar({
    lead_id: item.lead.id,
    cliente_id: null,
    telefone: item.lead.whatsapp ?? item.lead.telefone ?? '',
    campanha: campanha.nome,
    canal: 'whatsapp',
    status: 'aguardando_resposta',
    etapa_funil: 'contatado',
    ultima_mensagem: item.mensagem,
    ultima_mensagem_em: agora,
    mensagens_enviadas: 1,
    mensagens_recebidas: 0,
    servico_interesse_id: item.lead.servico_interesse_id,
    valor_potencial: item.lead.valor_potencial,
    externo_id: null,
  });

  return { registrado: true, autorizada: false, erroAutorizacao: null, bloqueado: false };
}


/** Marca o alvo como falho, sem consumir o lead — ele volta para pendente. */
export async function marcarFalha(alvo: CampaignTarget, motivo: string): Promise<void> {
  await db.alvosCampanha.atualizar(alvo.id, {
    status: 'falhou',
    observacao: motivo.slice(0, 200),
  });
}

/* --------------------------------------------------------------------------
   Resposta do lead
   -------------------------------------------------------------------------- */

/**
 * O lead respondeu — é aqui que a IA do NinjaBot assume no fluxo real.
 *
 * Efeitos: alvo vira `respondido`, conversa passa para atendimento e o lead
 * avança no funil. `em_conversa` é o passo certo: respondeu, mas ainda não foi
 * qualificado.
 */
export async function registrarResposta(
  conversaId: string,
  mensagem: string | null,
): Promise<void> {
  const agora = new Date().toISOString();

  const conversa = await db.conversas.obter(conversaId);
  if (!conversa) throw new Error('Conversa não encontrada.');

  await db.conversas.atualizar(conversaId, {
    status: 'em_atendimento',
    etapa_funil: 'em_conversa',
    ultima_mensagem: mensagem ?? conversa.ultima_mensagem,
    ultima_mensagem_em: agora,
    mensagens_recebidas: conversa.mensagens_recebidas + 1,
  });

  if (conversa.lead_id) {
    const lead = await db.leads.obter(conversa.lead_id);
    // Só avança quem ainda está no começo do funil: um lead já em negociação
    // não pode regredir para "em conversa" por causa de uma mensagem nova.
    if (lead && (lead.status === 'novo' || lead.status === 'contatado')) {
      await db.leads.atualizar(lead.id, { status: 'em_conversa', ultima_interacao: agora });
    }

    const alvos = await db.alvosCampanha.todos({ filtros: { lead_id: conversa.lead_id } });
    const pendente = alvos.find((a) => a.status === 'enviado');
    if (pendente) {
      await db.alvosCampanha.atualizar(pendente.id, { status: 'respondido', respondido_em: agora });
    }
  }
}

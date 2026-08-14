/**
 * Regras de seleção manual e slots — parte PURA, sem banco.
 *
 * Fora de `src/` pelo mesmo motivo de `regras-campanha.ts`: sem alias `@/`,
 * roda no test runner do Node. E é aqui que mora a decisão mais delicada do
 * fluxo — quem pode entrar num disparo e quem não pode.
 */

/* --------------------------------------------------------------------------
   Tipos mínimos
   -------------------------------------------------------------------------- */

export interface LeadSelecionavel {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  whatsapp: string | null;
  nao_contatar: boolean;
  status: string;
}

export interface AlvoExistente {
  lead_id: string;
  slot_id: string | null;
  status: 'pendente' | 'enviado' | 'respondido' | 'ignorado' | 'falhou';
}

/* --------------------------------------------------------------------------
   Elegibilidade para seleção manual
   -------------------------------------------------------------------------- */

export type MotivoBloqueio =
  | 'nao_contatar'
  | 'sem_whatsapp'
  | 'ja_recebeu'
  | 'em_outro_slot';

export const BLOQUEIO_TEXTO: Record<MotivoBloqueio, string> = {
  nao_contatar: 'Marcado como “não contatar”',
  sem_whatsapp: 'Sem número de WhatsApp',
  ja_recebeu: 'Já recebeu esta campanha',
  em_outro_slot: 'Já está em outro slot',
};

export interface EstadoSelecao {
  lead: LeadSelecionavel;
  /** Pode ser marcado na tela. */
  selecionavel: boolean;
  /** Já está neste slot. */
  jaNoSlot: boolean;
  motivo?: MotivoBloqueio;
}

/**
 * Decide, lead a lead, quem pode entrar NESTE slot.
 *
 * ORDEM DAS CHECAGENS. `nao_contatar` vem primeiro porque é a trava absoluta:
 * um contato pessoal marcado assim não pode ser selecionado por nenhuma
 * combinação de circunstância. Depois vêm os impedimentos técnicos e por fim
 * os de duplicidade.
 *
 * Bloqueado continua VISÍVEL na lista, com o motivo escrito. Sumir com o
 * contato faria você procurá-lo achando que sumiu do CRM.
 */
export function avaliarSelecao(
  leads: LeadSelecionavel[],
  alvos: AlvoExistente[],
  slotId: string,
): EstadoSelecao[] {
  const porLead = new Map(alvos.map((a) => [a.lead_id, a]));

  return leads.map((lead) => {
    const alvo = porLead.get(lead.id);
    const jaNoSlot = alvo?.slot_id === slotId;

    const bloquear = (motivo: MotivoBloqueio): EstadoSelecao => ({
      lead,
      selecionavel: false,
      jaNoSlot,
      motivo,
    });

    if (lead.nao_contatar) return bloquear('nao_contatar');
    if (!lead.whatsapp && !lead.telefone) return bloquear('sem_whatsapp');

    if (alvo) {
      // Já disparado: o registro é histórico e não se refaz.
      if (alvo.status === 'enviado' || alvo.status === 'respondido') return bloquear('ja_recebeu');
      // Em outro slot da mesma campanha: seria mensagem dupla no mesmo disparo.
      if (alvo.slot_id && alvo.slot_id !== slotId) return bloquear('em_outro_slot');
    }

    return { lead, selecionavel: true, jaNoSlot };
  });
}

/**
 * Revalidação NO MOMENTO DO DISPARO. Devolve o motivo do bloqueio, ou `null`.
 *
 * POR QUE ISTO EXISTE SEPARADO DE `avaliarSelecao`:
 *
 * `avaliarSelecao` decide quem PODE ENTRAR no slot — e roda quando você monta
 * o lote. Entre montar e disparar pode passar um dia, e o mundo muda: o lead
 * pede para não ser mais contatado, alguém marca `nao_contatar` no CRM, o
 * telefone é apagado. Sem revalidar aqui, a mensagem sairia assim mesmo,
 * porque a decisão ficou congelada no dia da montagem.
 *
 * `nao_contatar` é a trava absoluta do projeto: se ela pode ser furada por
 * passagem de tempo, ela não é absoluta.
 */
export function bloqueioNoDisparo(
  lead: LeadSelecionavel,
  alvo: AlvoExistente | null | undefined,
): MotivoBloqueio | null {
  if (lead.nao_contatar) return 'nao_contatar';
  if (!lead.whatsapp && !lead.telefone) return 'sem_whatsapp';
  if (alvo && (alvo.status === 'enviado' || alvo.status === 'respondido')) return 'ja_recebeu';
  return null;
}

/** Só quem pode ser marcado agora. */
export function selecionaveis(estados: EstadoSelecao[]): LeadSelecionavel[] {
  return estados.filter((e) => e.selecionavel).map((e) => e.lead);
}

/** Contagem por motivo de bloqueio, para a tela explicar as exclusões. */
export function contarBloqueios(estados: EstadoSelecao[]): Partial<Record<MotivoBloqueio, number>> {
  const conta: Partial<Record<MotivoBloqueio, number>> = {};
  for (const e of estados) {
    if (!e.selecionavel && e.motivo) conta[e.motivo] = (conta[e.motivo] ?? 0) + 1;
  }
  return conta;
}

/* --------------------------------------------------------------------------
   Duplicidade entre slots
   -------------------------------------------------------------------------- */

/**
 * Um mesmo telefone aparecendo em mais de um contato do disparo.
 *
 * Acontece de verdade: dois leads cadastrados separadamente com o mesmo número
 * (a pessoa preencheu o formulário duas vezes, ou o sócio usa o telefone da
 * empresa). O UNIQUE do banco é por lead, não por telefone, então esse caso
 * passaria — e a pessoa receberia a mensagem duas vezes.
 */
export interface TelefoneRepetido {
  telefone: string;
  leadIds: string[];
}

export function detectarTelefonesRepetidos(
  itens: { leadId: string; telefone: string | null }[],
): TelefoneRepetido[] {
  const porTelefone = new Map<string, string[]>();

  for (const item of itens) {
    const digitos = (item.telefone ?? '').replace(/\D/g, '');
    if (digitos.length < 10) continue;
    // Compara pelos últimos 11 dígitos: ignora diferença de DDI e de nono
    // dígito ausente, que é onde o mesmo número se disfarça.
    const chave = digitos.slice(-11);
    porTelefone.set(chave, [...(porTelefone.get(chave) ?? []), item.leadId]);
  }

  return [...porTelefone.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([telefone, leadIds]) => ({ telefone, leadIds }));
}

/* --------------------------------------------------------------------------
   Autorização
   -------------------------------------------------------------------------- */

export interface AlvoAutorizavel {
  status: 'pendente' | 'enviado' | 'respondido' | 'ignorado' | 'falhou';
  telefone: string | null;
  ia_autorizada: boolean;
}

/**
 * A IA pode atender este contato?
 *
 * REGRA CENTRAL DO SISTEMA. Duas condições, ambas obrigatórias:
 *   1. o contato participou de um disparo registrado (`enviado`/`respondido`);
 *   2. a autorização foi efetivada no NinjaBot (`ia_autorizada`).
 *
 * Estar no público da campanha NÃO basta. Estar num slot NÃO basta. Só quem
 * recebeu mensagem de verdade — e teve a autorização confirmada — entra.
 */
export function podeReceberIA(alvo: AlvoAutorizavel | null | undefined): boolean {
  if (!alvo) return false;
  if (!alvo.telefone) return false;
  const participou = alvo.status === 'enviado' || alvo.status === 'respondido';
  return participou && alvo.ia_autorizada;
}

/** Contatos que deveriam estar autorizados e não estão. */
export function autorizacoesPendentes<T extends AlvoAutorizavel>(alvos: T[]): T[] {
  return alvos.filter(
    (a) => (a.status === 'enviado' || a.status === 'respondido') && !a.ia_autorizada && a.telefone,
  );
}

/* --------------------------------------------------------------------------
   Resumo do slot
   -------------------------------------------------------------------------- */

export interface ResumoSlot {
  total: number;
  pendentes: number;
  enviados: number;
  respondidos: number;
  autorizados: number;
  /** Enviados que ainda não foram autorizados no NinjaBot. */
  semAutorizacao: number;
}

export function resumirSlot(alvos: AlvoAutorizavel[]): ResumoSlot {
  const conta = (s: AlvoAutorizavel['status']) => alvos.filter((a) => a.status === s).length;

  return {
    total: alvos.length,
    pendentes: conta('pendente'),
    enviados: conta('enviado'),
    respondidos: conta('respondido'),
    autorizados: alvos.filter((a) => a.ia_autorizada).length,
    semAutorizacao: autorizacoesPendentes(alvos).length,
  };
}

/**
 * Regras de pagamento — FONTE ÚNICA, compartilhada.
 *
 * Fica fora de `src/` e fora de `api/` de propósito: os dois lados importam
 * daqui por caminho relativo. O frontend usa no simulador de webhook; a função
 * serverless usa para processar o evento real do Asaas.
 *
 * Se esta lógica fosse duplicada, o simulador diria uma coisa e a produção
 * faria outra — e o bug só apareceria com dinheiro de verdade em jogo.
 *
 * Sem imports com alias (`@/`) e sem dependência de navegador ou de Node:
 * precisa resolver nos dois ambientes de build.
 */

/* --------------------------------------------------------------------------
   Tipos mínimos (espelham src/types/index.ts)
   -------------------------------------------------------------------------- */

export type StatusPagamentoInterno = 'pago' | 'pendente' | 'atrasado' | 'cancelado' | 'reembolsado';

export type StatusVendaInterno =
  | 'orcamento'
  | 'aguardando_pagamento'
  | 'parcialmente_pago'
  | 'pago'
  | 'cancelado'
  | 'reembolsado';

export type TipoEventoWebhook =
  | 'pagamento.criado'
  | 'pagamento.aprovado'
  | 'pagamento.pendente'
  | 'pagamento.recusado'
  | 'pagamento.cancelado'
  | 'pagamento.reembolsado';

/* --------------------------------------------------------------------------
   Tradução: evento do Asaas -> evento interno
   -------------------------------------------------------------------------- */

/**
 * Mapa dos eventos que o Asaas dispara.
 *
 * `null` = evento conhecido que NÃO deve mexer em estado (é informativo).
 * Ausente do mapa = evento desconhecido; o webhook registra e ignora, em vez
 * de adivinhar. Adivinhar aqui significaria marcar venda como paga por engano.
 */
const EVENTOS_ASAAS: Record<string, TipoEventoWebhook | null> = {
  PAYMENT_CREATED: 'pagamento.criado',
  PAYMENT_AWAITING_RISK_ANALYSIS: 'pagamento.pendente',
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: 'pagamento.pendente',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'pagamento.recusado',
  PAYMENT_UPDATED: null,
  PAYMENT_CONFIRMED: 'pagamento.aprovado',
  PAYMENT_RECEIVED: 'pagamento.aprovado',
  PAYMENT_RECEIVED_IN_CASH_UNDONE: 'pagamento.pendente',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'pagamento.recusado',
  PAYMENT_OVERDUE: 'pagamento.pendente',
  PAYMENT_DELETED: 'pagamento.cancelado',
  PAYMENT_RESTORED: 'pagamento.pendente',
  PAYMENT_REFUNDED: 'pagamento.reembolsado',
  PAYMENT_REFUND_IN_PROGRESS: null,
  PAYMENT_PARTIALLY_REFUNDED: 'pagamento.reembolsado',
  PAYMENT_CHARGEBACK_REQUESTED: 'pagamento.recusado',
  PAYMENT_CHARGEBACK_DISPUTE: null,
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: null,
  PAYMENT_DUNNING_RECEIVED: 'pagamento.aprovado',
  PAYMENT_DUNNING_REQUESTED: null,
  PAYMENT_BANK_SLIP_VIEWED: null,
  PAYMENT_CHECKOUT_VIEWED: null,
};

export interface ClassificacaoEvento {
  /** `true` quando o Asaas manda algo que não está no mapa. */
  desconhecido: boolean;
  /** `null` = conhecido, porém sem efeito sobre o estado. */
  tipo: TipoEventoWebhook | null;
}

export function classificarEventoAsaas(evento: string): ClassificacaoEvento {
  if (!(evento in EVENTOS_ASAAS)) return { desconhecido: true, tipo: null };
  return { desconhecido: false, tipo: EVENTOS_ASAAS[evento] };
}

/* --------------------------------------------------------------------------
   Efeito do evento sobre o pagamento
   -------------------------------------------------------------------------- */

/**
 * Para onde cada evento leva o pagamento.
 * `null` = não mexe (só registra o evento).
 *
 * Repare que "recusado" volta para `pendente`, e não para um estado terminal:
 * cartão negado não cancela a cobrança, ela continua aberta para nova tentativa.
 */
const EFEITO: Record<TipoEventoWebhook, StatusPagamentoInterno | null> = {
  'pagamento.criado': null,
  'pagamento.aprovado': 'pago',
  'pagamento.pendente': 'pendente',
  'pagamento.recusado': 'pendente',
  'pagamento.cancelado': 'cancelado',
  'pagamento.reembolsado': 'reembolsado',
};

export function efeitoNoPagamento(tipo: TipoEventoWebhook): StatusPagamentoInterno | null {
  return EFEITO[tipo];
}

/* --------------------------------------------------------------------------
   Status da venda
   -------------------------------------------------------------------------- */

/**
 * O status da venda é DERIVADO das parcelas — nunca informado pelo gateway.
 *
 * A venda é a soma das suas partes. Aceitar o status que o Asaas mandar abriria
 * espaço para venda marcada como "paga" com parcela em aberto.
 */
export function statusDaVenda(
  parcelas: { status: StatusPagamentoInterno }[],
  atual: StatusVendaInterno,
): StatusVendaInterno {
  if (parcelas.length === 0) return atual;

  const pagas = parcelas.filter((p) => p.status === 'pago').length;
  const reembolsadas = parcelas.filter((p) => p.status === 'reembolsado').length;
  const canceladas = parcelas.filter((p) => p.status === 'cancelado').length;

  if (reembolsadas === parcelas.length) return 'reembolsado';
  if (canceladas === parcelas.length) return 'cancelado';
  if (pagas === 0) return atual === 'orcamento' ? 'aguardando_pagamento' : atual;
  if (pagas === parcelas.length) return 'pago';
  return 'parcialmente_pago';
}

/* --------------------------------------------------------------------------
   Notificação
   -------------------------------------------------------------------------- */

export interface ModeloNotificacao {
  tipo:
    | 'pagamento_aprovado'
    | 'pagamento_recusado'
    | 'pagamento_pendente';
  severidade: 'info' | 'sucesso' | 'alerta' | 'erro';
  titulo: string;
}

const NOTIFICACAO: Partial<Record<TipoEventoWebhook, ModeloNotificacao>> = {
  'pagamento.aprovado': { tipo: 'pagamento_aprovado', severidade: 'sucesso', titulo: 'Pagamento aprovado' },
  'pagamento.recusado': { tipo: 'pagamento_recusado', severidade: 'erro', titulo: 'Pagamento recusado' },
  'pagamento.pendente': { tipo: 'pagamento_pendente', severidade: 'alerta', titulo: 'Pagamento pendente' },
  'pagamento.reembolsado': { tipo: 'pagamento_aprovado', severidade: 'alerta', titulo: 'Pagamento reembolsado' },
};

export function notificacaoDoEvento(tipo: TipoEventoWebhook): ModeloNotificacao | null {
  return NOTIFICACAO[tipo] ?? null;
}

/** Formata centavos em BRL sem depender de locale do servidor. */
export function formatarBRL(centavos: number): string {
  const reais = (centavos / 100).toFixed(2).replace('.', ',');
  return `R$ ${reais.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

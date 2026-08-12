/**
 * Tradutor de enum para etiqueta visual.
 *
 * Fonte unica dos rotulos em portugues e das cores de estado. Se um status
 * muda de nome, muda aqui e muda no sistema inteiro — nenhuma tela escreve
 * "Aguardando pagamento" na mao.
 */

import { Badge, type TomBadge } from '@/components/ui/primitives';
import {
  ROTULO_CATEGORIA,
  ROTULO_CONVERSA,
  ROTULO_FORMA,
  ROTULO_LEAD,
  ROTULO_ORIGEM,
  ROTULO_PAGAMENTO,
  ROTULO_PAPEL,
  ROTULO_PROJETO,
  ROTULO_VENDA,
  ROTULO_WEBHOOK,
} from '@/lib/rotulos';
import type {
  ConversationStatus,
  LeadStatus,
  PaymentStatus,
  ProjectStatus,
  SaleStatus,
  WebhookProcessStatus,
} from '@/types';

type Mapa<T extends string> = Record<T, { rotulo: string; tom: TomBadge }>;

/** Junta o texto (fonte unica em lib/rotulos.ts) com a cor de cada estado. */
function comTom<T extends string>(
  rotulos: Record<T, string>,
  tons: Record<T, TomBadge>,
): Mapa<T> {
  const saida = {} as Mapa<T>;
  for (const chave of Object.keys(rotulos) as T[]) {
    saida[chave] = { rotulo: rotulos[chave], tom: tons[chave] };
  }
  return saida;
}

export const LEAD = comTom<LeadStatus>(ROTULO_LEAD, {
  novo: 'info',
  contatado: 'neutro',
  em_conversa: 'neutro',
  qualificado: 'info',
  proposta_enviada: 'alerta',
  negociacao: 'alerta',
  pagamento_pendente: 'alerta',
  cliente: 'ok',
  perdido: 'erro',
});

export const VENDA = comTom<SaleStatus>(ROTULO_VENDA, {
  orcamento: 'neutro',
  aguardando_pagamento: 'alerta',
  parcialmente_pago: 'info',
  pago: 'ok',
  cancelado: 'neutro',
  reembolsado: 'erro',
});

export const PAGAMENTO = comTom<PaymentStatus>(ROTULO_PAGAMENTO, {
  pago: 'ok',
  pendente: 'alerta',
  atrasado: 'erro',
  cancelado: 'neutro',
  reembolsado: 'info',
});

export const PROJETO = comTom<ProjectStatus>(ROTULO_PROJETO, {
  aguardando_inicio: 'neutro',
  briefing: 'info',
  planejamento: 'info',
  design: 'info',
  desenvolvimento: 'alerta',
  revisao: 'alerta',
  ajustes: 'alerta',
  finalizacao: 'alerta',
  entregue: 'ok',
  concluido: 'ok',
});

export const CONVERSA = comTom<ConversationStatus>(ROTULO_CONVERSA, {
  aguardando_resposta: 'neutro',
  respondeu: 'info',
  em_atendimento: 'alerta',
  qualificado: 'ok',
  sem_resposta: 'neutro',
  encerrada: 'neutro',
});

export const WEBHOOK = comTom<WebhookProcessStatus>(ROTULO_WEBHOOK, {
  recebido: 'info',
  processado: 'ok',
  ignorado: 'neutro',
  erro: 'erro',
});

export const PAPEL = ROTULO_PAPEL;
export const CATEGORIA_SERVICO = ROTULO_CATEGORIA;
export const FORMA_PAGAMENTO = ROTULO_FORMA;
export const ORIGEM_LEAD = ROTULO_ORIGEM;

/** Lista pronta para alimentar um <select> de filtro. */
export function opcoesDe<T extends string>(mapa: Mapa<T>, rotuloTodos = 'Todos os status') {
  return [
    { valor: 'todos', rotulo: rotuloTodos },
    ...(Object.entries(mapa) as [T, { rotulo: string }][]).map(([valor, { rotulo }]) => ({
      valor,
      rotulo,
    })),
  ];
}

export function opcoesSimples(mapa: Record<string, string>, rotuloTodos?: string) {
  const itens = Object.entries(mapa).map(([valor, rotulo]) => ({ valor, rotulo }));
  return rotuloTodos ? [{ valor: 'todos', rotulo: rotuloTodos }, ...itens] : itens;
}

/* --------------------------------------------------------------------------
   Componentes
   -------------------------------------------------------------------------- */

export function StatusLead({ status }: { status: LeadStatus }) {
  const s = LEAD[status];
  return <Badge tom={s.tom}>{s.rotulo}</Badge>;
}

export function StatusVenda({ status }: { status: SaleStatus }) {
  const s = VENDA[status];
  return <Badge tom={s.tom}>{s.rotulo}</Badge>;
}

export function StatusPagamento({ status }: { status: PaymentStatus }) {
  const s = PAGAMENTO[status];
  return <Badge tom={s.tom}>{s.rotulo}</Badge>;
}

export function StatusProjeto({ status }: { status: ProjectStatus }) {
  const s = PROJETO[status];
  return <Badge tom={s.tom}>{s.rotulo}</Badge>;
}

export function StatusConversa({ status }: { status: ConversationStatus }) {
  const s = CONVERSA[status];
  return <Badge tom={s.tom}>{s.rotulo}</Badge>;
}

export function StatusWebhook({ status }: { status: WebhookProcessStatus }) {
  const s = WEBHOOK[status];
  return <Badge tom={s.tom}>{s.rotulo}</Badge>;
}

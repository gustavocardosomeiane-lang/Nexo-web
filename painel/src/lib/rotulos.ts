/**
 * Rotulos dos enums, em portugues.
 *
 * FONTE UNICA. Vivem aqui, e nao no componente de badge, porque a camada de
 * dados tambem precisa deles: um grafico de funil que escreve "Negociacao" sem
 * cedilha entrega que o rotulo foi gerado trocando underscore por espaco, e
 * nao escrito por alguem.
 *
 * `src/components/dominio/StatusBadge.tsx` acrescenta a cor de cada estado a
 * partir destes textos.
 */

import type {
  ConversationStatus,
  LeadStatus,
  PaymentMethod,
  PaymentStatus,
  ProjectStatus,
  SaleStatus,
  ServiceCategoria,
  UserRole,
  WebhookProcessStatus,
} from '@/types';

export const ROTULO_LEAD: Record<LeadStatus, string> = {
  novo: 'Novo',
  contatado: 'Contatado',
  em_conversa: 'Em conversa',
  qualificado: 'Qualificado',
  proposta_enviada: 'Proposta enviada',
  negociacao: 'Negociação',
  pagamento_pendente: 'Pagamento pendente',
  cliente: 'Cliente',
  perdido: 'Perdido',
};

export const ROTULO_VENDA: Record<SaleStatus, string> = {
  orcamento: 'Orçamento',
  aguardando_pagamento: 'Aguardando pagamento',
  parcialmente_pago: 'Parcialmente pago',
  pago: 'Pago',
  cancelado: 'Cancelado',
  reembolsado: 'Reembolsado',
};

export const ROTULO_PAGAMENTO: Record<PaymentStatus, string> = {
  pago: 'Pago',
  pendente: 'Pendente',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
  reembolsado: 'Reembolsado',
};

export const ROTULO_PROJETO: Record<ProjectStatus, string> = {
  aguardando_inicio: 'Aguardando início',
  briefing: 'Briefing',
  planejamento: 'Planejamento',
  design: 'Design',
  desenvolvimento: 'Desenvolvimento',
  revisao: 'Revisão',
  ajustes: 'Ajustes',
  finalizacao: 'Finalização',
  entregue: 'Entregue',
  concluido: 'Concluído',
};

export const ROTULO_CONVERSA: Record<ConversationStatus, string> = {
  aguardando_resposta: 'Aguardando resposta',
  respondeu: 'Respondeu',
  em_atendimento: 'Em atendimento',
  qualificado: 'Qualificado',
  sem_resposta: 'Sem resposta',
  encerrada: 'Encerrada',
};

export const ROTULO_WEBHOOK: Record<WebhookProcessStatus, string> = {
  recebido: 'Recebido',
  processado: 'Processado',
  ignorado: 'Ignorado (duplicado)',
  erro: 'Erro',
};

export const ROTULO_PAPEL: Record<UserRole, string> = {
  administrador: 'Administrador',
  vendedor: 'Vendedor',
  financeiro: 'Financeiro',
  colaborador: 'Colaborador',
};

export const ROTULO_CATEGORIA: Record<ServiceCategoria, string> = {
  landing_page: 'Landing Page',
  site_institucional: 'Site Institucional',
  ecommerce: 'E-commerce',
  personalizado: 'Personalizado',
  manutencao: 'Manutenção',
  outro: 'Outro',
};

export const ROTULO_FORMA: Record<PaymentMethod, string> = {
  pix: 'PIX',
  cartao: 'Cartão',
};

export const ROTULO_ORIGEM: Record<string, string> = {
  site: 'Site',
  whatsapp: 'WhatsApp',
  indicacao: 'Indicação',
  instagram: 'Instagram',
  google: 'Google',
  ninjabot: 'NinjaBot',
  outro: 'Outro',
  prospeccao_ia: 'Prospecção NEXO AI',
};

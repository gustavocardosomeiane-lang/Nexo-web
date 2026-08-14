/**
 * NEXO WEB — modelo de dominio do painel.
 *
 * Este arquivo e a fonte de verdade das entidades. O schema SQL em
 * `supabase/schema.sql` espelha exatamente o que esta aqui: mexeu num, mexa no
 * outro. Os nomes de campo usam snake_case porque e o que o PostgREST devolve —
 * evitar uma camada de traducao entre banco e interface elimina uma classe
 * inteira de bug bobo.
 */

/* ---------------------------------------------------------------------------
   Identidade e permissoes
   --------------------------------------------------------------------------- */

/** Papeis do sistema, do mais para o menos privilegiado. */
export type UserRole = 'administrador' | 'vendedor' | 'financeiro' | 'colaborador';

export interface User {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  ativo: boolean;
  criado_em: string;
}

/* ---------------------------------------------------------------------------
   Leads / CRM
   --------------------------------------------------------------------------- */

/** Etapas do funil, na ordem em que aparecem no Kanban. */
export const LEAD_STATUS = [
  'novo',
  'contatado',
  'em_conversa',
  'qualificado',
  'proposta_enviada',
  'negociacao',
  'pagamento_pendente',
  'cliente',
  'perdido',
] as const;

export type LeadStatus = (typeof LEAD_STATUS)[number];

export type LeadOrigem =
  | 'site'
  | 'whatsapp'
  | 'indicacao'
  | 'instagram'
  | 'google'
  | 'ninjabot'
  | 'outro';

export interface Lead {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  origem: LeadOrigem;
  /**
   * Etiquetas/listas. É por elas que uma campanha escolhe o público —
   * o disparo nunca sai para quem não carrega a tag selecionada.
   */
  tags: string[];
  /**
   * Trava de proteção. `true` exclui o contato de QUALQUER disparo, para
   * sempre. É onde entram contato pessoal, fornecedor, amigo e quem pediu
   * para não receber mensagem. Nenhuma campanha ignora este campo.
   */
  nao_contatar: boolean;
  campanha: string | null;
  data_entrada: string;
  responsavel_id: string | null;
  status: LeadStatus;
  observacoes: string | null;
  ultima_interacao: string | null;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  valor_potencial: number | null;
  servico_interesse_id: string | null;
  /** Preenchido quando o lead vira cliente. Mantem a rastreabilidade do funil. */
  cliente_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Tags / listas de prospecção
   --------------------------------------------------------------------------- */

export interface Tag {
  id: string;
  nome: string;
  descricao: string | null;
  criado_em: string;
}

/* ---------------------------------------------------------------------------
   Campanhas de prospecção (NinjaBot — modo assistido)
   --------------------------------------------------------------------------- */

export const CAMPAIGN_STATUS = ['rascunho', 'ativa', 'pausada', 'concluida'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[number];

export interface Campaign {
  id: string;
  nome: string;
  /** Tag que define o público. Um lead só entra se carregar esta tag. */
  tag: string;
  /**
   * Texto da primeira mensagem. Aceita `{{nome}}`, `{{primeiro_nome}}` e
   * `{{empresa}}`, substituídos por lead na hora de montar o link.
   */
  mensagem: string;
  status: CampaignStatus;
  /** Quantos contatos por lote. Padrão 10. */
  tamanho_lote: number;
  criado_em: string;
  atualizado_em: string;
  iniciada_em: string | null;
  concluida_em: string | null;
}

/**
 * SLOT / LOTE de disparo.
 *
 * Uma campanha se divide em slots. Cada slot tem a SUA mensagem e os SEUS
 * contatos, escolhidos a dedo. É o que permite:
 *   Slot 1 — 10 contatos, mensagem A
 *   Slot 2 — 10 contatos, mensagem B
 *
 * O slot é a unidade que você revisa antes de disparar, e a unidade que fica
 * registrada depois: é por ele que se sabe quem participou de qual envio.
 */
export const SLOT_STATUS = ['rascunho', 'pronto', 'disparado', 'cancelado'] as const;
export type SlotStatus = (typeof SLOT_STATUS)[number];

export interface CampaignSlot {
  id: string;
  campanha_id: string;
  nome: string;
  /** Mensagem deste slot. Aceita {{nome}}, {{primeiro_nome}} e {{empresa}}. */
  mensagem: string;
  status: SlotStatus;
  /** Ordem de exibição e execução. */
  ordem: number;
  /** Quando você confirmou que disparou este slot. */
  disparado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** Situação de um lead dentro de uma campanha. */
export const TARGET_STATUS = ['pendente', 'enviado', 'respondido', 'ignorado', 'falhou'] as const;
export type TargetStatus = (typeof TARGET_STATUS)[number];

/**
 * O LIVRO-CAIXA DO DISPARO.
 *
 * Uma linha por lead por campanha, com UNIQUE(campanha_id, lead_id) no banco.
 * É esta tabela que garante que ninguém receba a mesma campanha duas vezes,
 * mesmo que a tela seja recarregada ou dois operadores trabalhem juntos.
 */
export interface CampaignTarget {
  id: string;
  campanha_id: string;
  lead_id: string;
  status: TargetStatus;
  /** Número do lote (1, 2, 3…). Atribuído quando o lote é montado. */
  lote: number | null;
  enviado_em: string | null;
  respondido_em: string | null;
  /** Motivo, quando `ignorado` ou `falhou`. */
  observacao: string | null;

  /* ---- Participação no disparo ---- */

  /** Slot ao qual este contato foi atribuído. `null` = ainda não distribuído. */
  slot_id: string | null;
  /**
   * Telefone congelado no momento do disparo.
   *
   * Guardado aqui, e não lido do lead, de propósito: se o cadastro do lead
   * mudar de número depois, o registro de quem recebeu o quê continua fiel ao
   * que realmente aconteceu.
   */
  telefone: string | null;
  /** Mensagem exata que foi preparada para este contato, já com variáveis. */
  mensagem_final: string | null;

  /* ---- Autorização da IA ---- */

  /**
   * `true` = a IA do NinjaBot está liberada para atender este contato.
   *
   * Só vira `true` quando VOCÊ confirma o envio. É o que garante que a IA
   * responda apenas a quem participou do disparo — quem nunca passou por aqui
   * nunca foi autorizado.
   */
  ia_autorizada: boolean;
  ia_autorizada_em: string | null;
  /** Canal do NinjaBot em que a autorização foi feita. */
  ia_canal_id: number | null;
  /** Conversa correspondente no NinjaBot, quando ela aparecer. */
  conversa_externa_id: string | null;
  /**
   * Id da mensagem devolvido pela API no disparo.
   *
   * `null` é um valor legítimo e comum: o swagger do NinjaBot declara a
   * resposta do envio com `result` e `conversa` SEM tipagem, então nem sempre
   * dá para extrair um id. Preferimos `null` a inventar um — ver
   * `extrairIdMensagem` em `shared/regras-disparo.ts`.
   */
  mensagem_externa_id: string | null;

  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Clientes
   --------------------------------------------------------------------------- */

export interface Client {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  documento: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  /** De qual lead este cliente nasceu, quando veio do funil. */
  lead_origem_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Servicos
   --------------------------------------------------------------------------- */

export type ServiceCategoria =
  | 'landing_page'
  | 'site_institucional'
  | 'ecommerce'
  | 'personalizado'
  | 'manutencao'
  | 'outro';

export interface Service {
  id: string;
  nome: string;
  descricao: string | null;
  /** Em centavos. Dinheiro nunca em ponto flutuante. */
  preco: number;
  preco_promocional: number | null;
  categoria: ServiceCategoria;
  max_parcelas: number;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Vendas
   --------------------------------------------------------------------------- */

export const SALE_STATUS = [
  'orcamento',
  'aguardando_pagamento',
  'parcialmente_pago',
  'pago',
  'cancelado',
  'reembolsado',
] as const;

export type SaleStatus = (typeof SALE_STATUS)[number];

export type PaymentMethod = 'pix' | 'cartao';

export interface Sale {
  id: string;
  /** Codigo curto legivel por humano, do tipo NX-0007. */
  codigo: string;
  cliente_id: string;
  servico_id: string | null;
  /** Centavos. Valor cheio, antes do desconto. */
  valor_total: number;
  desconto: number;
  forma_pagamento: PaymentMethod;
  parcelas: number;
  status: SaleStatus;
  data: string;
  /** Adaptador que processou a cobranca. `null` enquanto nao houver gateway. */
  gateway: string | null;
  gateway_transacao_id: string | null;
  responsavel_id: string | null;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Pagamentos e parcelas
   --------------------------------------------------------------------------- */

export const PAYMENT_STATUS = [
  'pago',
  'pendente',
  'atrasado',
  'cancelado',
  'reembolsado',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export interface Payment {
  id: string;
  venda_id: string;
  cliente_id: string;
  valor: number;
  forma_pagamento: PaymentMethod;
  status: PaymentStatus;
  vencimento: string;
  pago_em: string | null;
  gateway: string | null;
  gateway_transacao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Installment {
  id: string;
  venda_id: string;
  /** Pagamento que quita esta parcela. Um para um. */
  pagamento_id: string | null;
  numero: number;
  total_parcelas: number;
  valor: number;
  vencimento: string;
  status: PaymentStatus;
  pago_em: string | null;
  gateway: string | null;
  gateway_transacao_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Projetos
   --------------------------------------------------------------------------- */

export const PROJECT_STATUS = [
  'aguardando_inicio',
  'briefing',
  'planejamento',
  'design',
  'desenvolvimento',
  'revisao',
  'ajustes',
  'finalizacao',
  'entregue',
  'concluido',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export interface Project {
  id: string;
  nome: string;
  cliente_id: string;
  servico_id: string | null;
  venda_id: string | null;
  valor: number;
  data_inicio: string | null;
  prazo: string | null;
  responsavel_id: string | null;
  status: ProjectStatus;
  /** 0 a 100. */
  progresso: number;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Conversas (NinjaBot)
   --------------------------------------------------------------------------- */

export type ConversationStatus =
  | 'aguardando_resposta'
  | 'respondeu'
  | 'em_atendimento'
  | 'qualificado'
  | 'sem_resposta'
  | 'encerrada';

export interface Conversation {
  id: string;
  lead_id: string | null;
  cliente_id: string | null;
  telefone: string;
  campanha: string | null;
  canal: 'whatsapp';
  status: ConversationStatus;
  etapa_funil: LeadStatus;
  ultima_mensagem: string | null;
  ultima_mensagem_em: string | null;
  mensagens_enviadas: number;
  mensagens_recebidas: number;
  servico_interesse_id: string | null;
  valor_potencial: number | null;
  /** ID da conversa no NinjaBot, quando a integracao existir. */
  externo_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

/* ---------------------------------------------------------------------------
   Notificacoes
   --------------------------------------------------------------------------- */

export type NotificationType =
  | 'nova_venda'
  | 'pagamento_aprovado'
  | 'pagamento_recusado'
  | 'pagamento_pendente'
  | 'parcela_vencendo'
  | 'lead_respondeu'
  | 'novo_cliente'
  | 'projeto_prazo';

export type NotificationSeverity = 'info' | 'sucesso' | 'alerta' | 'erro';

export interface Notification {
  id: string;
  tipo: NotificationType;
  severidade: NotificationSeverity;
  titulo: string;
  descricao: string;
  lida: boolean;
  /** Para onde o clique leva, dentro do painel. */
  link: string | null;
  criado_em: string;
}

/* ---------------------------------------------------------------------------
   Webhooks
   --------------------------------------------------------------------------- */

export type WebhookEventType =
  | 'pagamento.criado'
  | 'pagamento.aprovado'
  | 'pagamento.pendente'
  | 'pagamento.recusado'
  | 'pagamento.cancelado'
  | 'pagamento.reembolsado';

export type WebhookProcessStatus = 'recebido' | 'processado' | 'ignorado' | 'erro';

export interface WebhookEvent {
  id: string;
  /** ID do evento no gateway. UNIQUE no banco — e ele que garante idempotencia. */
  evento_externo_id: string;
  gateway: string;
  tipo: WebhookEventType;
  status: WebhookProcessStatus;
  transacao_id: string | null;
  venda_id: string | null;
  pagamento_id: string | null;
  payload: Record<string, unknown>;
  erro: string | null;
  recebido_em: string;
  processado_em: string | null;
}

/* ---------------------------------------------------------------------------
   Configuracoes
   --------------------------------------------------------------------------- */

export interface CompanySettings {
  nome: string;
  descricao: string;
  telefone: string;
  email: string;
  logo_url: string | null;
  site: string;
  instagram: string;
  linkedin: string;
}

export interface NotificationSettings {
  nova_venda: boolean;
  pagamento_aprovado: boolean;
  pagamento_recusado: boolean;
  pagamento_pendente: boolean;
  parcela_vencendo: boolean;
  lead_respondeu: boolean;
  novo_cliente: boolean;
  projeto_prazo: boolean;
}

export interface Settings {
  empresa: CompanySettings;
  notificacoes: NotificationSettings;
}

/* ---------------------------------------------------------------------------
   Consulta: filtros, ordenacao e paginacao
   --------------------------------------------------------------------------- */

export interface DateRange {
  /** ISO yyyy-mm-dd, inclusivo. */
  de: string;
  /** ISO yyyy-mm-dd, inclusivo. */
  ate: string;
}

export interface QueryOptions<T> {
  busca?: string;
  filtros?: Partial<Record<keyof T, unknown>>;
  periodo?: DateRange;
  ordenarPor?: keyof T;
  ordem?: 'asc' | 'desc';
  pagina?: number;
  porPagina?: number;
}

export interface Page<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/* ---------------------------------------------------------------------------
   Metricas agregadas
   --------------------------------------------------------------------------- */

export interface DashboardMetrics {
  faturamento_total: number;
  faturamento_mes: number;
  recebido: number;
  a_receber: number;
  atrasado: number;
  vendas: number;
  clientes: number;
  leads: number;
  /** Percentual 0–100: leads que viraram cliente. */
  taxa_conversao: number;
  projetos_ativos: number;
  ticket_medio: number;
}

export interface SeriePonto {
  /** Rotulo do eixo x, ja formatado para leitura. */
  rotulo: string;
  /** Chave ISO para ordenacao. */
  chave: string;
  valor: number;
}

export interface FatiaValor {
  rotulo: string;
  valor: number;
}

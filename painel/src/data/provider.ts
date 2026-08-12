/**
 * DatabaseProvider — contrato de acesso a dados.
 *
 * A aplicacao inteira fala com esta interface e nunca com o Supabase direto.
 * Trocar de banco (ou apontar para outro backend) significa escrever um novo
 * objeto que satisfaca este contrato — nenhuma tela precisa mudar.
 *
 * Duas implementacoes existem hoje:
 *   mock/mockProvider.ts      — dados ficticios, memoria + localStorage
 *   supabase/supabaseProvider.ts — PostgreSQL via PostgREST
 */

import type {
  Client,
  Conversation,
  DashboardMetrics,
  DateRange,
  FatiaValor,
  Installment,
  Lead,
  Notification,
  Page,
  Payment,
  Project,
  QueryOptions,
  Sale,
  SeriePonto,
  Service,
  Settings,
  User,
  WebhookEvent,
} from '@/types';
import type { DataMode } from '@/lib/env';

/** Campos que o sistema controla — quem cria um registro nunca os informa. */
export type Novo<T> = Omit<T, 'id' | 'criado_em' | 'atualizado_em'>;

export interface Repository<T> {
  listar(opcoes?: QueryOptions<T>): Promise<Page<T>>;
  /** Sem paginacao. Para selects, Kanban e agregacoes. */
  todos(opcoes?: QueryOptions<T>): Promise<T[]>;
  obter(id: string): Promise<T | null>;
  criar(dados: Novo<T>): Promise<T>;
  atualizar(id: string, dados: Partial<T>): Promise<T>;
  remover(id: string): Promise<void>;
}

/** Numeros agregados. Os dois providers usam o mesmo codigo de calculo. */
export interface Analytics {
  metricas(periodo?: DateRange): Promise<DashboardMetrics>;
  /** Faturamento por mes ou dia, conforme o tamanho do periodo. */
  faturamentoPorPeriodo(periodo: DateRange): Promise<SeriePonto[]>;
  vendasPorPeriodo(periodo: DateRange): Promise<SeriePonto[]>;
  /** Quantos leads em cada etapa do funil. */
  funilLeads(periodo?: DateRange): Promise<FatiaValor[]>;
  servicosMaisVendidos(periodo?: DateRange): Promise<FatiaValor[]>;
  /** Volume financeiro por forma de pagamento. */
  pixVersusCartao(periodo?: DateRange): Promise<FatiaValor[]>;
  /** Volume por situacao de pagamento: pago, pendente, atrasado, etc. */
  situacaoPagamentos(periodo?: DateRange): Promise<FatiaValor[]>;
  faturamentoPorServico(periodo?: DateRange): Promise<FatiaValor[]>;
}

export interface DatabaseProvider {
  /** Rotulo exibido na interface: "Dados de demonstração" ou "Supabase". */
  readonly nome: string;
  readonly modo: DataMode;

  usuarios: Repository<User>;
  leads: Repository<Lead>;
  clientes: Repository<Client>;
  servicos: Repository<Service>;
  vendas: Repository<Sale>;
  pagamentos: Repository<Payment>;
  parcelas: Repository<Installment>;
  projetos: Repository<Project>;
  conversas: Repository<Conversation>;
  notificacoes: Repository<Notification>;
  eventosWebhook: Repository<WebhookEvent>;

  analytics: Analytics;

  obterConfiguracoes(): Promise<Settings>;
  salvarConfiguracoes(dados: Settings): Promise<Settings>;

  /** Marca todas as notificacoes como lidas. Atalho para o caso mais comum. */
  marcarNotificacoesLidas(): Promise<void>;
}

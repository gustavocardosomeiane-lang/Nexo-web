/**
 * Provider do Supabase / PostgreSQL.
 *
 * Filtro, busca, ordenacao e paginacao acontecem NO BANCO (WHERE / ORDER BY /
 * RANGE), nao no navegador. Baixar mil linhas para filtrar no cliente e o
 * caminho mais curto para um painel lento.
 *
 * As agregacoes usam as mesmas funcoes puras do provider mock. Enquanto o
 * volume for de milhares de linhas isso e perfeitamente adequado. Quando
 * passar disso, a troca certa e mover cada agregacao para uma VIEW ou uma
 * funcao RPC no Postgres — a interface `Analytics` nao muda, so o corpo destes
 * metodos.
 */

import type {
  Campaign,
  CampaignSlot,
  CampaignTarget,
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
  Tag,
  User,
  WebhookEvent,
} from '@/types';
import type { Analytics, DatabaseProvider, Novo, Repository } from '../provider';
import * as calc from '../analytics';
import { getSupabase } from './client';

/** Tabelas do schema. Trocar um nome aqui exige trocar em schema.sql. */
const TABELA = {
  usuarios: 'users',
  leads: 'leads',
  clientes: 'clients',
  servicos: 'services',
  vendas: 'sales',
  pagamentos: 'payments',
  parcelas: 'installments',
  projetos: 'projects',
  conversas: 'conversations',
  notificacoes: 'notifications',
  eventosWebhook: 'webhook_events',
  tags: 'tags',
  campanhas: 'campaigns',
  slotsCampanha: 'campaign_slots',
  alvosCampanha: 'campaign_targets',
} as const;

interface ConfigTabela<T> {
  camposBusca: (keyof T & string)[];
  campoData?: keyof T & string;
  ordenarPorPadrao: keyof T & string;
  ordemPadrao?: 'asc' | 'desc';
}

/** Escapa o que o PostgREST trata como separador dentro de `or(...)`. */
function escaparBusca(termo: string): string {
  return termo.replace(/[(),*]/g, ' ').trim();
}

function criarRepositorio<T extends { id: string }>(
  tabela: string,
  config: ConfigTabela<T>,
): Repository<T> {
  function montar(opcoes: QueryOptions<T>, contar: boolean) {
    let q = getSupabase()
      .from(tabela)
      .select('*', contar ? { count: 'exact' } : undefined);

    if (opcoes.filtros) {
      for (const [campo, valor] of Object.entries(opcoes.filtros)) {
        if (valor === undefined || valor === null || valor === '' || valor === 'todos') continue;
        q = Array.isArray(valor) ? q.in(campo, valor) : q.eq(campo, valor as never);
      }
    }

    if (opcoes.periodo && config.campoData) {
      q = q.gte(config.campoData, opcoes.periodo.de).lte(config.campoData, `${opcoes.periodo.ate}T23:59:59.999Z`);
    }

    const busca = escaparBusca(opcoes.busca ?? '');
    if (busca && config.camposBusca.length > 0) {
      q = q.or(config.camposBusca.map((campo) => `${campo}.ilike.%${busca}%`).join(','));
    }

    const ordenarPor = (opcoes.ordenarPor as string) ?? config.ordenarPorPadrao;
    q = q.order(ordenarPor, { ascending: (opcoes.ordem ?? config.ordemPadrao ?? 'desc') === 'asc' });

    return q;
  }

  return {
    async listar(opcoes: QueryOptions<T> = {}): Promise<Page<T>> {
      let q = montar(opcoes, true);

      const porPagina = opcoes.porPagina ?? 25;
      const pagina = Math.max(1, opcoes.pagina ?? 1);
      const inicio = (pagina - 1) * porPagina;
      q = q.range(inicio, inicio + porPagina - 1);

      const { data, error, count } = await q;
      if (error) throw new Error(error.message);

      return { itens: (data ?? []) as T[], total: count ?? 0, pagina, porPagina };
    },

    async todos(opcoes: QueryOptions<T> = {}): Promise<T[]> {
      const { data, error } = await montar(opcoes, false);
      if (error) throw new Error(error.message);
      return (data ?? []) as T[];
    },

    async obter(id: string): Promise<T | null> {
      const { data, error } = await getSupabase().from(tabela).select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as T) ?? null;
    },

    async criar(novo: Novo<T>): Promise<T> {
      const { data, error } = await getSupabase().from(tabela).insert(novo as never).select().single();
      if (error) throw new Error(error.message);
      return data as T;
    },

    async atualizar(id: string, mudancas: Partial<T>): Promise<T> {
      // `atualizado_em` e responsabilidade do trigger no banco; nao mandamos daqui.
      const { data, error } = await getSupabase().from(tabela).update(mudancas as never).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data as T;
    },

    async remover(id: string): Promise<void> {
      const { error } = await getSupabase().from(tabela).delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  };
}

const usuarios = criarRepositorio<User>(TABELA.usuarios, {
  camposBusca: ['nome', 'email'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'nome',
  ordemPadrao: 'asc',
});

const leads = criarRepositorio<Lead>(TABELA.leads, {
  camposBusca: ['nome', 'empresa', 'email', 'telefone', 'campanha'],
  campoData: 'data_entrada',
  ordenarPorPadrao: 'data_entrada',
});

const clientes = criarRepositorio<Client>(TABELA.clientes, {
  camposBusca: ['nome', 'empresa', 'email', 'telefone', 'cidade'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
});

const servicos = criarRepositorio<Service>(TABELA.servicos, {
  camposBusca: ['nome', 'descricao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'nome',
  ordemPadrao: 'asc',
});

const vendas = criarRepositorio<Sale>(TABELA.vendas, {
  camposBusca: ['codigo', 'observacoes', 'gateway_transacao_id'],
  campoData: 'data',
  ordenarPorPadrao: 'data',
});

const pagamentos = criarRepositorio<Payment>(TABELA.pagamentos, {
  camposBusca: ['gateway_transacao_id'],
  campoData: 'vencimento',
  ordenarPorPadrao: 'vencimento',
});

const parcelas = criarRepositorio<Installment>(TABELA.parcelas, {
  camposBusca: ['gateway_transacao_id'],
  campoData: 'vencimento',
  ordenarPorPadrao: 'vencimento',
  ordemPadrao: 'asc',
});

const projetos = criarRepositorio<Project>(TABELA.projetos, {
  camposBusca: ['nome', 'observacoes'],
  campoData: 'data_inicio',
  ordenarPorPadrao: 'prazo',
  ordemPadrao: 'asc',
});

const conversas = criarRepositorio<Conversation>(TABELA.conversas, {
  camposBusca: ['telefone', 'campanha', 'ultima_mensagem'],
  campoData: 'atualizado_em',
  ordenarPorPadrao: 'ultima_mensagem_em',
});

const notificacoes = criarRepositorio<Notification>(TABELA.notificacoes, {
  camposBusca: ['titulo', 'descricao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
});

const eventosWebhook = criarRepositorio<WebhookEvent>(TABELA.eventosWebhook, {
  camposBusca: ['evento_externo_id', 'transacao_id', 'tipo'],
  campoData: 'recebido_em',
  ordenarPorPadrao: 'recebido_em',
});

const tags = criarRepositorio<Tag>(TABELA.tags, {
  camposBusca: ['nome', 'descricao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'nome',
  ordemPadrao: 'asc',
});

const campanhas = criarRepositorio<Campaign>(TABELA.campanhas, {
  camposBusca: ['nome', 'tag', 'mensagem'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
});

const slotsCampanha = criarRepositorio<CampaignSlot>(TABELA.slotsCampanha, {
  camposBusca: ['nome', 'mensagem'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'ordem',
  ordemPadrao: 'asc',
});

const alvosCampanha = criarRepositorio<CampaignTarget>(TABELA.alvosCampanha, {
  camposBusca: ['observacao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
  ordemPadrao: 'asc',
});

/* --------------------------------------------------------------------------
   Analytics
   -------------------------------------------------------------------------- */

/** Uma unica ida ao banco por painel de graficos, em paralelo. */
async function carregarBase() {
  const [v, p, c, l, pr, s] = await Promise.all([
    vendas.todos(),
    pagamentos.todos(),
    clientes.todos(),
    leads.todos(),
    projetos.todos(),
    servicos.todos(),
  ]);
  return { vendas: v, pagamentos: p, clientes: c, leads: l, projetos: pr, servicos: s };
}

const analytics: Analytics = {
  async metricas(periodo?: DateRange): Promise<DashboardMetrics> {
    const base = await carregarBase();
    return calc.calcularMetricas(base, periodo);
  },
  async faturamentoPorPeriodo(periodo: DateRange): Promise<SeriePonto[]> {
    return calc.faturamentoPorPeriodo(await vendas.todos(), periodo);
  },
  async vendasPorPeriodo(periodo: DateRange): Promise<SeriePonto[]> {
    return calc.vendasPorPeriodo(await vendas.todos(), periodo);
  },
  async funilLeads(periodo?: DateRange): Promise<FatiaValor[]> {
    return calc.funilLeads(await leads.todos(), periodo);
  },
  async servicosMaisVendidos(periodo?: DateRange): Promise<FatiaValor[]> {
    const [v, s] = await Promise.all([vendas.todos(), servicos.todos()]);
    return calc.servicosMaisVendidos(v, s, periodo);
  },
  async pixVersusCartao(periodo?: DateRange): Promise<FatiaValor[]> {
    return calc.pixVersusCartao(await pagamentos.todos(), periodo);
  },
  async situacaoPagamentos(periodo?: DateRange): Promise<FatiaValor[]> {
    return calc.situacaoPagamentos(await pagamentos.todos(), periodo);
  },
  async faturamentoPorServico(periodo?: DateRange): Promise<FatiaValor[]> {
    const [v, s] = await Promise.all([vendas.todos(), servicos.todos()]);
    return calc.faturamentoPorServico(v, s, periodo);
  },
};

/* --------------------------------------------------------------------------
   Provider
   -------------------------------------------------------------------------- */

const CONFIG_PADRAO: Settings = {
  empresa: {
    nome: 'NEXO WEB',
    descricao: '',
    telefone: '',
    email: '',
    logo_url: null,
    site: '',
    instagram: '',
    linkedin: '',
  },
  notificacoes: {
    nova_venda: true,
    pagamento_aprovado: true,
    pagamento_recusado: true,
    pagamento_pendente: true,
    parcela_vencendo: true,
    lead_respondeu: true,
    novo_cliente: true,
    projeto_prazo: true,
  },
};

/**
 * Configuracoes moram numa tabela chave/valor (`settings`), e nao numa tabela
 * de colunas fixas: assim adicionar uma preferencia nova nao exige migracao.
 */
async function lerConfig<T>(chave: string, padrao: T): Promise<T> {
  const { data, error } = await getSupabase()
    .from('settings')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.valor ? ({ ...padrao, ...(data.valor as object) } as T) : padrao;
}

export const supabaseProvider: DatabaseProvider = {
  nome: 'Supabase',
  modo: 'production',

  usuarios,
  leads,
  clientes,
  servicos,
  vendas,
  pagamentos,
  parcelas,
  projetos,
  conversas,
  notificacoes,
  eventosWebhook,

  tags,
  campanhas,
  slotsCampanha,
  alvosCampanha,

  analytics,

  async obterConfiguracoes(): Promise<Settings> {
    const [empresa, notificacoesCfg] = await Promise.all([
      lerConfig('empresa', CONFIG_PADRAO.empresa),
      lerConfig('notificacoes', CONFIG_PADRAO.notificacoes),
    ]);
    return { empresa, notificacoes: notificacoesCfg };
  },

  async salvarConfiguracoes(dados: Settings): Promise<Settings> {
    const { error } = await getSupabase()
      .from('settings')
      .upsert(
        [
          { chave: 'empresa', valor: dados.empresa },
          { chave: 'notificacoes', valor: dados.notificacoes },
        ],
        { onConflict: 'chave' },
      );
    if (error) throw new Error(error.message);
    return dados;
  },

  async marcarNotificacoesLidas(): Promise<void> {
    const { error } = await getSupabase()
      .from(TABELA.notificacoes)
      .update({ lida: true })
      .eq('lida', false);
    if (error) throw new Error(error.message);
  },
};

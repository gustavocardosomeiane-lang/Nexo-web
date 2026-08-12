/**
 * Provider de DEMONSTRACAO.
 *
 * Guarda tudo em memoria e espelha no localStorage, para que o que voce criar
 * ou editar sobreviva ao F5. E um brinquedo bem-comportado: nao substitui
 * banco, nao tem concorrencia, nao tem transacao. Serve para a interface ser
 * navegada de verdade antes de existir Supabase.
 *
 * Para zerar: botao "Restaurar dados de demonstração" em Configurações, ou
 * `localStorage.clear()` no console.
 */

import type {
  Campaign,
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
import { aplicarQuery, paginar, type QueryConfig } from '../query';
import * as calc from '../analytics';
import { uuid } from '@/lib/id';
import {
  alvosCampanhaMock,
  campanhasMock,
  clientesMock,
  configuracoesMock,
  conversasMock,
  eventosWebhookMock,
  leadsMock,
  notificacoesMock,
  pagamentosMock,
  parcelasMock,
  projetosMock,
  servicosMock,
  tagsMock,
  usuariosMock,
  vendasMock,
} from './seed';

const PREFIXO = 'nexo.painel.mock.';
/** Subir esta versao invalida o cache local quando o formato dos dados muda. */
const VERSAO = 'v1';

/** Latencia artificial: sem ela, skeleton e spinner nunca sao exercitados. */
const LATENCIA_MS = 90;

function dormir(ms = LATENCIA_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function carregar<T>(chave: string, inicial: T[]): T[] {
  try {
    const bruto = localStorage.getItem(`${PREFIXO}${VERSAO}.${chave}`);
    if (!bruto) return [...inicial];
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados : [...inicial];
  } catch {
    // localStorage indisponivel (modo privado, cota cheia): segue em memoria.
    return [...inicial];
  }
}

function salvar<T>(chave: string, dados: T[]): void {
  try {
    localStorage.setItem(`${PREFIXO}${VERSAO}.${chave}`, JSON.stringify(dados));
  } catch {
    /* sem persistencia; a sessao atual continua funcionando */
  }
}

export function limparDadosMock(): void {
  try {
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith(PREFIXO)) localStorage.removeItem(chave);
    }
  } catch {
    /* nada a fazer */
  }
}

/* --------------------------------------------------------------------------
   Repositório genérico
   -------------------------------------------------------------------------- */

interface ComId {
  id: string;
  criado_em?: string;
  atualizado_em?: string;
}

function criarRepositorio<T extends ComId & Record<string, unknown>>(
  chave: string,
  inicial: T[],
  config: QueryConfig<T>,
): Repository<T> & { dados(): T[] } {
  let dados = carregar<T>(chave, inicial);

  const persistir = () => salvar(chave, dados);

  return {
    dados: () => dados,

    async listar(opcoes: QueryOptions<T> = {}): Promise<Page<T>> {
      await dormir();
      const { itens, total } = aplicarQuery(dados, opcoes, config);
      return paginar(itens, total, opcoes);
    },

    async todos(opcoes: QueryOptions<T> = {}): Promise<T[]> {
      await dormir(30);
      const { itens } = aplicarQuery(dados, { ...opcoes, pagina: undefined, porPagina: undefined }, config);
      return itens;
    },

    async obter(id: string): Promise<T | null> {
      await dormir(40);
      return dados.find((item) => item.id === id) ?? null;
    },

    async criar(novo: Novo<T>): Promise<T> {
      await dormir();
      const agora = new Date().toISOString();
      const registro = { ...(novo as object), id: uuid(), criado_em: agora, atualizado_em: agora } as T;
      dados = [registro, ...dados];
      persistir();
      return registro;
    },

    async atualizar(id: string, mudancas: Partial<T>): Promise<T> {
      await dormir();
      const indice = dados.findIndex((item) => item.id === id);
      if (indice === -1) throw new Error('Registro não encontrado.');
      const atualizado = {
        ...dados[indice],
        ...mudancas,
        id,
        atualizado_em: new Date().toISOString(),
      } as T;
      dados = [...dados.slice(0, indice), atualizado, ...dados.slice(indice + 1)];
      persistir();
      return atualizado;
    },

    async remover(id: string): Promise<void> {
      await dormir();
      dados = dados.filter((item) => item.id !== id);
      persistir();
    },
  };
}

/* --------------------------------------------------------------------------
   Repositórios
   -------------------------------------------------------------------------- */

const usuarios = criarRepositorio<User & Record<string, unknown>>('usuarios', usuariosMock as never, {
  camposBusca: ['nome', 'email'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'nome',
  ordemPadrao: 'asc',
});

const leads = criarRepositorio<Lead & Record<string, unknown>>('leads', leadsMock as never, {
  camposBusca: ['nome', 'empresa', 'email', 'telefone', 'campanha'],
  campoData: 'data_entrada',
  ordenarPorPadrao: 'data_entrada',
});

const clientes = criarRepositorio<Client & Record<string, unknown>>('clientes', clientesMock as never, {
  camposBusca: ['nome', 'empresa', 'email', 'telefone', 'cidade'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
});

const servicos = criarRepositorio<Service & Record<string, unknown>>('servicos', servicosMock as never, {
  camposBusca: ['nome', 'descricao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'nome',
  ordemPadrao: 'asc',
});

const vendas = criarRepositorio<Sale & Record<string, unknown>>('vendas', vendasMock as never, {
  camposBusca: ['codigo', 'observacoes', 'gateway_transacao_id'],
  campoData: 'data',
  ordenarPorPadrao: 'data',
});

const pagamentos = criarRepositorio<Payment & Record<string, unknown>>('pagamentos', pagamentosMock as never, {
  camposBusca: ['gateway_transacao_id'],
  campoData: 'vencimento',
  ordenarPorPadrao: 'vencimento',
});

const parcelas = criarRepositorio<Installment & Record<string, unknown>>('parcelas', parcelasMock as never, {
  camposBusca: ['gateway_transacao_id'],
  campoData: 'vencimento',
  ordenarPorPadrao: 'vencimento',
  ordemPadrao: 'asc',
});

const projetos = criarRepositorio<Project & Record<string, unknown>>('projetos', projetosMock as never, {
  camposBusca: ['nome', 'observacoes'],
  campoData: 'data_inicio',
  ordenarPorPadrao: 'prazo',
  ordemPadrao: 'asc',
});

const conversas = criarRepositorio<Conversation & Record<string, unknown>>('conversas', conversasMock as never, {
  camposBusca: ['telefone', 'campanha', 'ultima_mensagem'],
  campoData: 'atualizado_em',
  ordenarPorPadrao: 'ultima_mensagem_em',
});

const notificacoes = criarRepositorio<Notification & Record<string, unknown>>('notificacoes', notificacoesMock as never, {
  camposBusca: ['titulo', 'descricao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
});

const eventosWebhook = criarRepositorio<WebhookEvent & Record<string, unknown>>('webhooks', eventosWebhookMock as never, {
  camposBusca: ['evento_externo_id', 'transacao_id', 'tipo'],
  campoData: 'recebido_em',
  ordenarPorPadrao: 'recebido_em',
});

const tags = criarRepositorio<Tag & Record<string, unknown>>('tags', tagsMock as never, {
  camposBusca: ['nome', 'descricao'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'nome',
  ordemPadrao: 'asc',
});

const campanhas = criarRepositorio<Campaign & Record<string, unknown>>('campanhas', campanhasMock as never, {
  camposBusca: ['nome', 'tag', 'mensagem'],
  campoData: 'criado_em',
  ordenarPorPadrao: 'criado_em',
});

const alvosCampanha = criarRepositorio<CampaignTarget & Record<string, unknown>>(
  'alvos-campanha',
  alvosCampanhaMock as never,
  {
    camposBusca: ['observacao'],
    campoData: 'criado_em',
    ordenarPorPadrao: 'criado_em',
    ordemPadrao: 'asc',
  },
);

/* --------------------------------------------------------------------------
   Analytics
   -------------------------------------------------------------------------- */

const analytics: Analytics = {
  async metricas(periodo?: DateRange): Promise<DashboardMetrics> {
    await dormir(50);
    return calc.calcularMetricas(
      {
        vendas: vendas.dados() as Sale[],
        pagamentos: pagamentos.dados() as Payment[],
        clientes: clientes.dados() as Client[],
        leads: leads.dados() as Lead[],
        projetos: projetos.dados() as Project[],
      },
      periodo,
    );
  },

  async faturamentoPorPeriodo(periodo: DateRange): Promise<SeriePonto[]> {
    await dormir(50);
    return calc.faturamentoPorPeriodo(vendas.dados() as Sale[], periodo);
  },

  async vendasPorPeriodo(periodo: DateRange): Promise<SeriePonto[]> {
    await dormir(50);
    return calc.vendasPorPeriodo(vendas.dados() as Sale[], periodo);
  },

  async funilLeads(periodo?: DateRange): Promise<FatiaValor[]> {
    await dormir(50);
    return calc.funilLeads(leads.dados() as Lead[], periodo);
  },

  async servicosMaisVendidos(periodo?: DateRange): Promise<FatiaValor[]> {
    await dormir(50);
    return calc.servicosMaisVendidos(vendas.dados() as Sale[], servicos.dados() as Service[], periodo);
  },

  async pixVersusCartao(periodo?: DateRange): Promise<FatiaValor[]> {
    await dormir(50);
    return calc.pixVersusCartao(pagamentos.dados() as Payment[], periodo);
  },

  async situacaoPagamentos(periodo?: DateRange): Promise<FatiaValor[]> {
    await dormir(50);
    return calc.situacaoPagamentos(pagamentos.dados() as Payment[], periodo);
  },

  async faturamentoPorServico(periodo?: DateRange): Promise<FatiaValor[]> {
    await dormir(50);
    return calc.faturamentoPorServico(vendas.dados() as Sale[], servicos.dados() as Service[], periodo);
  },
};

/* --------------------------------------------------------------------------
   Provider
   -------------------------------------------------------------------------- */

const CHAVE_CONFIG = `${PREFIXO}${VERSAO}.configuracoes`;

export const mockProvider: DatabaseProvider = {
  nome: 'Dados de demonstração',
  modo: 'mock',

  usuarios: usuarios as unknown as Repository<User>,
  leads: leads as unknown as Repository<Lead>,
  clientes: clientes as unknown as Repository<Client>,
  servicos: servicos as unknown as Repository<Service>,
  vendas: vendas as unknown as Repository<Sale>,
  pagamentos: pagamentos as unknown as Repository<Payment>,
  parcelas: parcelas as unknown as Repository<Installment>,
  projetos: projetos as unknown as Repository<Project>,
  conversas: conversas as unknown as Repository<Conversation>,
  notificacoes: notificacoes as unknown as Repository<Notification>,
  eventosWebhook: eventosWebhook as unknown as Repository<WebhookEvent>,

  tags: tags as unknown as Repository<Tag>,
  campanhas: campanhas as unknown as Repository<Campaign>,
  alvosCampanha: alvosCampanha as unknown as Repository<CampaignTarget>,

  analytics,

  async obterConfiguracoes(): Promise<Settings> {
    await dormir(40);
    try {
      const bruto = localStorage.getItem(CHAVE_CONFIG);
      if (bruto) return { ...configuracoesMock, ...JSON.parse(bruto) };
    } catch {
      /* usa o padrao */
    }
    return configuracoesMock;
  },

  async salvarConfiguracoes(dados: Settings): Promise<Settings> {
    await dormir();
    try {
      localStorage.setItem(CHAVE_CONFIG, JSON.stringify(dados));
    } catch {
      /* sem persistencia */
    }
    return dados;
  },

  async marcarNotificacoesLidas(): Promise<void> {
    await dormir(40);
    const pendentes = (notificacoes.dados() as Notification[]).filter((n) => !n.lida);
    for (const n of pendentes) {
      await notificacoes.atualizar(n.id, { lida: true } as never);
    }
  },
};

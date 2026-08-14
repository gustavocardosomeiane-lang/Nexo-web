/**
 * AI TOOL LAYER — o que a NEXO AI pode consultar.
 *
 * ===========================================================================
 * A IA NÃO FALA COM O BANCO. Ela pede a uma ferramenta, a ferramenta lê.
 *
 * Toda leitura usa o cliente `db` do USUÁRIO autenticado (ver api/_lib/auth.ts),
 * então a RLS decide o que volta — a IA não enxerga nada além do que a pessoa
 * já enxergaria na tela. E a matriz de permissões filtra ANTES: uma ferramenta
 * só é oferecida ao modelo se o usuário pode ver aquele módulo
 * (`ferramentasPermitidas` em shared/regras-nexo-ai.ts).
 *
 * FASE 1 = SOMENTE LEITURA + MEMÓRIA. Nenhuma ferramenta escreve em tabela de
 * negócio, nenhuma envia mensagem. Criar/atualizar/enviar é Fase 2.
 *
 * As ferramentas devolvem AGREGADOS, não tabelas cruas: "42 leads, 8
 * qualificados" custa uma fração dos tokens de 42 objetos JSON — e é o que
 * responde à pergunta.
 * ===========================================================================
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FerramentaModelo } from './modelo.js';
import { redigirSegredos } from '../../../shared/regras-nexo-ai.js';

export interface ContextoFerramenta {
  db: SupabaseClient;
  usuarioId: string;
}

interface Ferramenta {
  definicao: FerramentaModelo;
  executar: (args: Record<string, unknown>, ctx: ContextoFerramenta) => Promise<unknown>;
}

const semArgs = { type: 'object', properties: {}, additionalProperties: false } as const;

/** Conta linhas de uma tabela por um filtro de status, em uma ida ao banco. */
async function contarPorStatus(
  db: SupabaseClient,
  tabela: string,
): Promise<{ total: number; por_status: Record<string, number> }> {
  const { data, error } = await db.from(tabela).select('status');
  if (error) throw new Error(error.message);
  const por_status: Record<string, number> = {};
  for (const linha of data ?? []) {
    const s = String((linha as { status?: string }).status ?? 'sem_status');
    por_status[s] = (por_status[s] ?? 0) + 1;
  }
  return { total: (data ?? []).length, por_status };
}

/* --------------------------------------------------------------------------
   Catálogo
   -------------------------------------------------------------------------- */

const CATALOGO: Record<string, Ferramenta> = {
  consultar_leads: {
    definicao: {
      nome: 'consultar_leads',
      descricao: 'Total de leads e quantos há em cada etapa do funil. Use para "quantos leads temos", "leads qualificados".',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'leads'),
  },

  consultar_clientes: {
    definicao: {
      nome: 'consultar_clientes',
      descricao: 'Número de clientes na carteira.',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const { count, error } = await db.from('clients').select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return { total: count ?? 0 };
    },
  },

  consultar_vendas: {
    definicao: {
      nome: 'consultar_vendas',
      descricao: 'Vendas por status e valor total contratado. Use para "quanto vendemos", "vendas fechadas".',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const { data, error } = await db.from('sales').select('status, valor_total');
      if (error) throw new Error(error.message);
      const por_status: Record<string, number> = {};
      let valor_total_centavos = 0;
      for (const v of data ?? []) {
        const s = String((v as { status?: string }).status ?? 'sem_status');
        por_status[s] = (por_status[s] ?? 0) + 1;
        valor_total_centavos += Number((v as { valor_total?: number }).valor_total ?? 0);
      }
      return { total: (data ?? []).length, por_status, valor_total_reais: valor_total_centavos / 100 };
    },
  },

  consultar_pagamentos: {
    definicao: {
      nome: 'consultar_pagamentos',
      descricao: 'Pagamentos por status e total recebido (somente pagos). Use para "quanto recebemos".',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const { data, error } = await db.from('payments').select('status, valor');
      if (error) throw new Error(error.message);
      const por_status: Record<string, number> = {};
      let recebido_centavos = 0;
      for (const p of data ?? []) {
        const s = String((p as { status?: string }).status ?? 'sem_status');
        por_status[s] = (por_status[s] ?? 0) + 1;
        if (s === 'pago') recebido_centavos += Number((p as { valor?: number }).valor ?? 0);
      }
      return { total: (data ?? []).length, por_status, recebido_reais: recebido_centavos / 100 };
    },
  },

  consultar_projetos: {
    definicao: {
      nome: 'consultar_projetos',
      descricao: 'Projetos por status (em andamento, entregue, etc.).',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'projects'),
  },

  consultar_campanhas: {
    definicao: {
      nome: 'consultar_campanhas',
      descricao: 'Campanhas de prospecção por status.',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'campaigns'),
  },

  consultar_conversas: {
    definicao: {
      nome: 'consultar_conversas',
      descricao: 'Conversas registradas por status e etapa do funil.',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'conversations'),
  },

  consultar_metricas: {
    definicao: {
      nome: 'consultar_metricas',
      descricao: 'Visão geral do negócio: contagens de leads, clientes, vendas e projetos de uma vez. Use para "como estamos", "resumo geral".',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const contar = async (t: string) => {
        const { count } = await db.from(t).select('*', { count: 'exact', head: true });
        return count ?? 0;
      };
      const [leads, clientes, vendas, projetos] = await Promise.all([
        contar('leads'),
        contar('clients'),
        contar('sales'),
        contar('projects'),
      ]);
      return { leads, clientes, vendas, projetos };
    },
  },
};

/** Definições para o modelo, já filtradas por permissão. */
export function definicoesDe(nomes: string[]): FerramentaModelo[] {
  return nomes.map((n) => CATALOGO[n]?.definicao).filter((d): d is FerramentaModelo => Boolean(d));
}

/**
 * Executa uma ferramenta.
 *
 * `permitidas` é a lista já filtrada por permissão do usuário. Uma chamada a
 * ferramenta fora dela é recusada mesmo que o modelo peça — o modelo não é
 * autoridade sobre permissão. Toda saída passa pelo redator de segredos.
 */
export async function executarFerramenta(
  nome: string,
  args: Record<string, unknown>,
  ctx: ContextoFerramenta,
  permitidas: string[],
): Promise<string> {
  if (!permitidas.includes(nome)) {
    return JSON.stringify({ erro: 'Sem permissão para esta consulta.' });
  }
  const ferramenta = CATALOGO[nome];
  if (!ferramenta) {
    return JSON.stringify({ erro: 'Ferramenta desconhecida.' });
  }
  try {
    const resultado = await ferramenta.executar(args, ctx);
    return redigirSegredos(JSON.stringify(resultado));
  } catch (e) {
    return JSON.stringify({ erro: e instanceof Error ? e.message : 'Falha ao consultar.' });
  }
}

/** Ferramentas de leitura de dados que existem nesta fase (sem memória). */
export const FERRAMENTAS_DADOS = Object.keys(CATALOGO);

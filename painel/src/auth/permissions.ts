/**
 * Autorizacao por papel.
 *
 * Esta tabela decide o que cada papel enxerga e faz NA INTERFACE. Ela existe
 * para a experiencia fazer sentido — nao adianta mostrar um botao que vai
 * falhar depois.
 *
 * O CONTROLE DE VERDADE ESTA NO BANCO. Quem impede um vendedor de ler a
 * tabela de pagamentos e a policy de Row Level Security em
 * `supabase/schema.sql`, nao este arquivo: qualquer pessoa com o console do
 * navegador aberto contorna uma regra que vive so no cliente. As duas camadas
 * precisam contar a mesma historia, e mexer numa exige revisar a outra.
 */

import type { UserRole } from '@/types';

export type Modulo =
  | 'dashboard'
  | 'leads'
  | 'clientes'
  | 'vendas'
  | 'pagamentos'
  | 'servicos'
  | 'projetos'
  | 'financeiro'
  | 'conversas'
  | 'automacoes'
  | 'notificacoes'
  | 'relatorios'
  | 'configuracoes';

export type Acao = 'ver' | 'criar' | 'editar' | 'excluir';

const TUDO: Acao[] = ['ver', 'criar', 'editar', 'excluir'];
const SO_LEITURA: Acao[] = ['ver'];
const SEM_EXCLUIR: Acao[] = ['ver', 'criar', 'editar'];

type Matriz = Record<UserRole, Partial<Record<Modulo, Acao[]>>>;

export const PERMISSOES: Matriz = {
  /** Dono da operacao: acesso total, inclusive integracoes e exclusoes. */
  administrador: {
    dashboard: TUDO,
    leads: TUDO,
    clientes: TUDO,
    vendas: TUDO,
    pagamentos: TUDO,
    servicos: TUDO,
    projetos: TUDO,
    financeiro: TUDO,
    conversas: TUDO,
    automacoes: TUDO,
    notificacoes: TUDO,
    relatorios: TUDO,
    configuracoes: TUDO,
  },

  /** Vende: dono do funil. Ve o que vendeu, nao mexe no caixa. */
  vendedor: {
    dashboard: SO_LEITURA,
    leads: TUDO,
    clientes: SEM_EXCLUIR,
    vendas: SEM_EXCLUIR,
    pagamentos: SO_LEITURA,
    servicos: SO_LEITURA,
    projetos: SO_LEITURA,
    conversas: SEM_EXCLUIR,
    notificacoes: SO_LEITURA,
    relatorios: SO_LEITURA,
  },

  /** Cuida do dinheiro: pagamentos, parcelas e catalogo de precos. */
  financeiro: {
    dashboard: SO_LEITURA,
    leads: SO_LEITURA,
    clientes: SO_LEITURA,
    vendas: SEM_EXCLUIR,
    pagamentos: TUDO,
    servicos: SEM_EXCLUIR,
    projetos: SO_LEITURA,
    financeiro: TUDO,
    notificacoes: SO_LEITURA,
    relatorios: SO_LEITURA,
  },

  /** Executa os projetos. Nao ve faturamento nem valores de venda. */
  colaborador: {
    dashboard: SO_LEITURA,
    clientes: SO_LEITURA,
    projetos: SEM_EXCLUIR,
    conversas: SO_LEITURA,
    notificacoes: SO_LEITURA,
  },
};

export function pode(role: UserRole | undefined, modulo: Modulo, acao: Acao = 'ver'): boolean {
  if (!role) return false;
  return PERMISSOES[role]?.[modulo]?.includes(acao) ?? false;
}

export function podeVer(role: UserRole | undefined, modulo: Modulo): boolean {
  return pode(role, modulo, 'ver');
}

/**
 * Papeis que nao veem dinheiro. Usado para esconder colunas de valor em telas
 * que eles legitimamente acessam (projetos, por exemplo).
 */
export function veValores(role: UserRole | undefined): boolean {
  return role === 'administrador' || role === 'financeiro' || role === 'vendedor';
}

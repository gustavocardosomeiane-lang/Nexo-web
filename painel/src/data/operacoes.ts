/**
 * Operacoes de negocio que tocam mais de uma tabela.
 *
 * Ficam fora das telas porque nao sao interface: sao regra. A venda de R$ 2.500
 * em 2x precisa gerar duas parcelas de R$ 1.250 e dois pagamentos ligados a
 * elas, sempre — venha de onde vier o comando.
 *
 * LIMITE CONHECIDO. Nao ha transacao aqui: sao varias chamadas em sequencia, e
 * uma falha no meio deixa registro solto. Uma SPA falando com PostgREST nao tem
 * como abrir transacao. Quando isso incomodar, o caminho e mover esta funcao
 * para uma funcao PL/pgSQL chamada por RPC, que roda tudo num BEGIN/COMMIT.
 * Enquanto o volume for baixo e o operador for a propria equipe, o risco e
 * pequeno e visivel.
 */

import type { Installment, Payment, PaymentMethod, Sale, SaleStatus, Service } from '@/types';
import { db } from './index';
import { codigoVenda } from '@/lib/id';

export interface DadosNovaVenda {
  cliente_id: string;
  servico_id: string | null;
  /** Centavos, valor cheio. */
  valor_total: number;
  desconto: number;
  forma_pagamento: PaymentMethod;
  parcelas: number;
  status: SaleStatus;
  data: string;
  responsavel_id: string | null;
  observacoes: string | null;
  /** Dia do primeiro vencimento. Padrão: a data da venda. */
  primeiro_vencimento?: string;
  /** Cria também o projeto correspondente. */
  criar_projeto?: boolean;
  nome_projeto?: string;
}

/**
 * Divide o valor em parcelas sem perder centavo.
 * A ultima parcela absorve o resto da divisao: 100,00 em 3x vira
 * 33,33 + 33,33 + 33,34 — e nao tres de 33,33 sobrando um centavo.
 */
export function dividirParcelas(valor: number, quantidade: number): number[] {
  const n = Math.max(1, Math.floor(quantidade));
  const base = Math.floor(valor / n);
  const sobra = valor - base * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? base + sobra : base));
}

/** Vencimento da parcela n: mesma data da venda, mês a mês. */
function vencimentoDe(inicio: string, indice: number): string {
  const d = new Date(`${inicio}T12:00:00`);
  d.setMonth(d.getMonth() + indice);
  return d.toISOString().slice(0, 10);
}

export async function criarVendaCompleta(dados: DadosNovaVenda): Promise<Sale> {
  const liquido = Math.max(0, dados.valor_total - dados.desconto);

  // Código sequencial legível. Corrida entre dois cadastros simultâneos poderia
  // repetir o número; com a equipe atual isso não acontece, e em produção o
  // valor definitivo virá de uma sequence no Postgres.
  const existentes = await db.vendas.todos();
  const codigo = codigoVenda(existentes.length + 1);

  const venda = await db.vendas.criar({
    codigo,
    cliente_id: dados.cliente_id,
    servico_id: dados.servico_id,
    valor_total: dados.valor_total,
    desconto: dados.desconto,
    forma_pagamento: dados.forma_pagamento,
    parcelas: dados.parcelas,
    status: dados.status,
    data: dados.data,
    gateway: null,
    gateway_transacao_id: null,
    responsavel_id: dados.responsavel_id,
    observacoes: dados.observacoes,
  });

  /* Orçamento não gera cobrança: ainda não foi vendido. */
  if (dados.status === 'orcamento') return venda;

  const valores = dividirParcelas(liquido, dados.parcelas);
  const inicio = dados.primeiro_vencimento || dados.data;
  const hoje = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < valores.length; i++) {
    const vencimento = vencimentoDe(inicio, i);
    // Parcela já vencida entra como atrasada, não como pendente: o painel
    // precisa refletir a realidade no momento do cadastro.
    const status = vencimento < hoje ? 'atrasado' : 'pendente';

    const pagamento = await db.pagamentos.criar({
      venda_id: venda.id,
      cliente_id: dados.cliente_id,
      valor: valores[i],
      forma_pagamento: dados.forma_pagamento,
      status,
      vencimento,
      pago_em: null,
      gateway: null,
      gateway_transacao_id: null,
    } as Omit<Payment, 'id' | 'criado_em' | 'atualizado_em'>);

    await db.parcelas.criar({
      venda_id: venda.id,
      pagamento_id: pagamento.id,
      numero: i + 1,
      total_parcelas: valores.length,
      valor: valores[i],
      vencimento,
      status,
      pago_em: null,
      gateway: null,
      gateway_transacao_id: null,
    } as Omit<Installment, 'id' | 'criado_em' | 'atualizado_em'>);
  }

  if (dados.criar_projeto) {
    await db.projetos.criar({
      nome: dados.nome_projeto || `Projeto ${codigo}`,
      cliente_id: dados.cliente_id,
      servico_id: dados.servico_id,
      venda_id: venda.id,
      valor: liquido,
      data_inicio: dados.data,
      prazo: null,
      responsavel_id: dados.responsavel_id,
      status: 'aguardando_inicio',
      progresso: 0,
      observacoes: null,
    });
  }

  await db.notificacoes.criar({
    tipo: 'nova_venda',
    severidade: 'sucesso',
    titulo: 'Nova venda registrada',
    descricao: `${codigo} · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(liquido / 100)}`,
    lida: false,
    link: `/vendas?busca=${codigo}`,
  });

  return venda;
}

/**
 * Baixa manual de parcela — o caminho de hoje, enquanto nao ha gateway.
 * Quita a parcela, quita o pagamento e recalcula o status da venda a partir
 * das parcelas, exatamente como o webhook fara depois.
 */
export async function baixarParcela(parcela: Installment, pagoEm: string): Promise<void> {
  await db.parcelas.atualizar(parcela.id, { status: 'pago', pago_em: pagoEm });

  if (parcela.pagamento_id) {
    await db.pagamentos.atualizar(parcela.pagamento_id, { status: 'pago', pago_em: pagoEm });
  }

  const irmas = await db.parcelas.todos({ filtros: { venda_id: parcela.venda_id } });
  const atualizadas = irmas.map((p) => (p.id === parcela.id ? { ...p, status: 'pago' as const } : p));
  const pagas = atualizadas.filter((p) => p.status === 'pago').length;

  const venda = await db.vendas.obter(parcela.venda_id);
  if (!venda) return;

  const status: SaleStatus = pagas === atualizadas.length ? 'pago' : 'parcialmente_pago';
  if (venda.status !== status) await db.vendas.atualizar(venda.id, { status });
}

/** Estorna a baixa: volta a parcela para pendente ou atrasado, conforme a data. */
export async function estornarParcela(parcela: Installment): Promise<void> {
  const hoje = new Date().toISOString().slice(0, 10);
  const status = parcela.vencimento < hoje ? 'atrasado' : 'pendente';

  await db.parcelas.atualizar(parcela.id, { status, pago_em: null });
  if (parcela.pagamento_id) {
    await db.pagamentos.atualizar(parcela.pagamento_id, { status, pago_em: null });
  }

  const irmas = await db.parcelas.todos({ filtros: { venda_id: parcela.venda_id } });
  const atualizadas = irmas.map((p) => (p.id === parcela.id ? { ...p, status } : p));
  const pagas = atualizadas.filter((p) => p.status === 'pago').length;

  const venda = await db.vendas.obter(parcela.venda_id);
  if (!venda) return;

  const novoStatus: SaleStatus =
    pagas === 0 ? 'aguardando_pagamento' : pagas === atualizadas.length ? 'pago' : 'parcialmente_pago';
  if (venda.status !== novoStatus) await db.vendas.atualizar(venda.id, { status: novoStatus });
}

/** Preço vigente do serviço: promocional quando existir. */
export function precoVigente(servico: Service): number {
  return servico.preco_promocional ?? servico.preco;
}

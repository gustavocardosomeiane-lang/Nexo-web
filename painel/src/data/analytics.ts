/**
 * Calculo das metricas do painel.
 *
 * Funcoes puras sobre arrays. Os dois providers chamam exatamente estas
 * funcoes, entao mock e producao nunca divergem na conta — se o numero
 * estiver errado, esta errado igual nos dois, e conserta-se num lugar so.
 *
 * Convencoes de negocio adotadas aqui (importantes, porque definem o que cada
 * numero da tela significa):
 *
 *   FATURAMENTO  = valor liquido (total - desconto) das vendas fechadas, ou
 *                  seja com status aguardando_pagamento, parcialmente_pago ou
 *                  pago. Orcamento nao e faturamento — ainda nao foi vendido.
 *                  Cancelada e reembolsada tambem ficam de fora.
 *   RECEBIDO     = dinheiro que efetivamente entrou (pagamentos com status pago).
 *   A RECEBER    = pagamentos pendentes que ainda nao venceram.
 *   ATRASADO     = pagamentos vencidos e nao pagos.
 */

import type {
  Client,
  DashboardMetrics,
  DateRange,
  FatiaValor,
  Lead,
  Payment,
  Project,
  Sale,
  SeriePonto,
  Service,
} from '@/types';
import { ROTULO_LEAD, ROTULO_PAGAMENTO } from '@/lib/rotulos';

/** Vendas que contam como faturamento. */
const STATUS_FATURAVEL: Sale['status'][] = ['aguardando_pagamento', 'parcialmente_pago', 'pago'];

/** Projetos que ainda consomem tempo da equipe. */
const STATUS_PROJETO_ATIVO: Project['status'][] = [
  'aguardando_inicio',
  'briefing',
  'planejamento',
  'design',
  'desenvolvimento',
  'revisao',
  'ajustes',
  'finalizacao',
];

export function valorLiquido(venda: Sale): number {
  return Math.max(0, venda.valor_total - venda.desconto);
}

function noPeriodo(iso: string | null | undefined, periodo?: DateRange): boolean {
  if (!periodo) return true;
  if (!iso) return false;
  const dia = iso.slice(0, 10);
  return dia >= periodo.de && dia <= periodo.ate;
}

function somar(valores: number[]): number {
  return valores.reduce((acc, v) => acc + v, 0);
}

/* --------------------------------------------------------------------------
   Metricas do dashboard
   -------------------------------------------------------------------------- */

export interface FonteMetricas {
  vendas: Sale[];
  pagamentos: Payment[];
  clientes: Client[];
  leads: Lead[];
  projetos: Project[];
}

export function calcularMetricas(fonte: FonteMetricas, periodo?: DateRange): DashboardMetrics {
  const { vendas, pagamentos, clientes, leads, projetos } = fonte;

  const vendasFaturaveis = vendas.filter(
    (v) => STATUS_FATURAVEL.includes(v.status) && noPeriodo(v.data, periodo),
  );

  const faturamento_total = somar(vendasFaturaveis.map(valorLiquido));

  // Faturamento do mes corrente ignora o filtro de periodo de proposito: e um
  // indicador fixo de "como esta o mes", nao um recorte da tela.
  const agora = new Date();
  const prefixoMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const faturamento_mes = somar(
    vendas
      .filter((v) => STATUS_FATURAVEL.includes(v.status) && v.data.startsWith(prefixoMes))
      .map(valorLiquido),
  );

  const recebido = somar(
    pagamentos.filter((p) => p.status === 'pago' && noPeriodo(p.pago_em, periodo)).map((p) => p.valor),
  );

  const a_receber = somar(
    pagamentos
      .filter((p) => p.status === 'pendente' && noPeriodo(p.vencimento, periodo))
      .map((p) => p.valor),
  );

  const atrasado = somar(
    pagamentos
      .filter((p) => p.status === 'atrasado' && noPeriodo(p.vencimento, periodo))
      .map((p) => p.valor),
  );

  const leadsPeriodo = leads.filter((l) => noPeriodo(l.data_entrada, periodo));
  const convertidos = leadsPeriodo.filter((l) => l.status === 'cliente').length;

  return {
    faturamento_total,
    faturamento_mes,
    recebido,
    a_receber,
    atrasado,
    vendas: vendasFaturaveis.length,
    clientes: clientes.filter((c) => noPeriodo(c.criado_em, periodo)).length,
    leads: leadsPeriodo.length,
    taxa_conversao: leadsPeriodo.length === 0 ? 0 : (convertidos / leadsPeriodo.length) * 100,
    projetos_ativos: projetos.filter((p) => STATUS_PROJETO_ATIVO.includes(p.status)).length,
    ticket_medio: vendasFaturaveis.length === 0 ? 0 : Math.round(faturamento_total / vendasFaturaveis.length),
  };
}

/* --------------------------------------------------------------------------
   Series temporais
   -------------------------------------------------------------------------- */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Agrupa por dia quando o periodo cabe em ~2 meses, por mes quando e maior.
 * Evita tanto um grafico de 365 colunas quanto um de 2 colunas.
 */
function granularidade(periodo: DateRange): 'dia' | 'mes' {
  const dias = (new Date(periodo.ate).getTime() - new Date(periodo.de).getTime()) / 86_400_000;
  return dias <= 62 ? 'dia' : 'mes';
}

function baldes(periodo: DateRange): { chave: string; rotulo: string }[] {
  const modo = granularidade(periodo);
  const saida: { chave: string; rotulo: string }[] = [];
  const inicio = new Date(`${periodo.de}T00:00:00`);
  const fim = new Date(`${periodo.ate}T00:00:00`);

  if (modo === 'dia') {
    for (const d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
      const chave = d.toISOString().slice(0, 10);
      saida.push({ chave, rotulo: `${String(d.getDate()).padStart(2, '0')}/${MESES[d.getMonth()]}` });
    }
    return saida;
  }

  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  while (cursor <= fim) {
    const chave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    saida.push({ chave, rotulo: `${MESES[cursor.getMonth()]}/${String(cursor.getFullYear()).slice(2)}` });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return saida;
}

function agrupar(
  periodo: DateRange,
  registros: { data: string; valor: number }[],
): SeriePonto[] {
  const modo = granularidade(periodo);
  const corte = modo === 'dia' ? 10 : 7;
  const soma = new Map<string, number>();

  for (const r of registros) {
    if (!noPeriodo(r.data, periodo)) continue;
    const chave = r.data.slice(0, corte);
    soma.set(chave, (soma.get(chave) ?? 0) + r.valor);
  }

  return baldes(periodo).map(({ chave, rotulo }) => ({
    chave,
    rotulo,
    valor: soma.get(chave) ?? 0,
  }));
}

export function faturamentoPorPeriodo(vendas: Sale[], periodo: DateRange): SeriePonto[] {
  return agrupar(
    periodo,
    vendas
      .filter((v) => STATUS_FATURAVEL.includes(v.status))
      .map((v) => ({ data: v.data, valor: valorLiquido(v) })),
  );
}

export function vendasPorPeriodo(vendas: Sale[], periodo: DateRange): SeriePonto[] {
  return agrupar(
    periodo,
    vendas.filter((v) => STATUS_FATURAVEL.includes(v.status)).map((v) => ({ data: v.data, valor: 1 })),
  );
}

export function recebimentosPorPeriodo(pagamentos: Payment[], periodo: DateRange): SeriePonto[] {
  return agrupar(
    periodo,
    pagamentos
      .filter((p) => p.status === 'pago' && p.pago_em)
      .map((p) => ({ data: p.pago_em as string, valor: p.valor })),
  );
}

/* --------------------------------------------------------------------------
   Distribuicoes
   -------------------------------------------------------------------------- */

export function funilLeads(leads: Lead[], periodo?: DateRange): FatiaValor[] {
  const ordem: Lead['status'][] = [
    'novo',
    'contatado',
    'em_conversa',
    'qualificado',
    'proposta_enviada',
    'negociacao',
    'pagamento_pendente',
    'cliente',
    'perdido',
  ];
  const dentro = leads.filter((l) => noPeriodo(l.data_entrada, periodo));
  return ordem.map((status) => ({
    rotulo: ROTULO_LEAD[status],
    valor: dentro.filter((l) => l.status === status).length,
  }));
}

export function servicosMaisVendidos(
  vendas: Sale[],
  servicos: Service[],
  periodo?: DateRange,
): FatiaValor[] {
  const nome = new Map(servicos.map((s) => [s.id, s.nome]));
  const contagem = new Map<string, number>();

  for (const v of vendas) {
    if (!STATUS_FATURAVEL.includes(v.status) || !noPeriodo(v.data, periodo)) continue;
    const rotulo = (v.servico_id && nome.get(v.servico_id)) || 'Sem serviço';
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([rotulo, valor]) => ({ rotulo, valor }))
    .sort((a, b) => b.valor - a.valor);
}

export function faturamentoPorServico(
  vendas: Sale[],
  servicos: Service[],
  periodo?: DateRange,
): FatiaValor[] {
  const nome = new Map(servicos.map((s) => [s.id, s.nome]));
  const soma = new Map<string, number>();

  for (const v of vendas) {
    if (!STATUS_FATURAVEL.includes(v.status) || !noPeriodo(v.data, periodo)) continue;
    const rotulo = (v.servico_id && nome.get(v.servico_id)) || 'Sem serviço';
    soma.set(rotulo, (soma.get(rotulo) ?? 0) + valorLiquido(v));
  }

  return [...soma.entries()]
    .map(([rotulo, valor]) => ({ rotulo, valor }))
    .sort((a, b) => b.valor - a.valor);
}

export function pixVersusCartao(pagamentos: Payment[], periodo?: DateRange): FatiaValor[] {
  const pagos = pagamentos.filter((p) => p.status === 'pago' && noPeriodo(p.pago_em, periodo));
  return [
    { rotulo: 'PIX', valor: somar(pagos.filter((p) => p.forma_pagamento === 'pix').map((p) => p.valor)) },
    { rotulo: 'Cartão', valor: somar(pagos.filter((p) => p.forma_pagamento === 'cartao').map((p) => p.valor)) },
  ];
}

export function situacaoPagamentos(pagamentos: Payment[], periodo?: DateRange): FatiaValor[] {
  const ordem: Payment['status'][] = ['pago', 'pendente', 'atrasado', 'cancelado', 'reembolsado'];
  return ordem.map((status) => {
    const doStatus = pagamentos.filter(
      (p) => p.status === status && noPeriodo(status === 'pago' ? p.pago_em : p.vencimento, periodo),
    );
    return { rotulo: ROTULO_PAGAMENTO[status], valor: somar(doStatus.map((p) => p.valor)) };
  });
}

/**
 * Financeiro — a leitura do dinheiro.
 *
 * O Dashboard responde "como estamos?". Esta pagina responde "de onde vem e
 * para onde vai?": faturamento por servico, PIX contra cartao, situacao das
 * cobrancas e o que ja esta contratado mas ainda nao entrou.
 */

import { useMemo } from 'react';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { usePeriodo } from '@/hooks/usePeriodo';
import { brl, formatarData, percentual } from '@/lib/format';
import { valorLiquido } from '@/data/analytics';
import type { DashboardMetrics, Installment, Sale } from '@/types';
import { StatCard } from '@/components/dominio/StatCard';
import { FiltroPeriodo } from '@/components/dominio/FiltroPeriodo';
import { GraficoArea, GraficoBarrasH, GraficoRosca } from '@/components/charts/Charts';
import { CORES_STATUS } from '@/components/charts/base';
import { Card, Eyebrow, Skeleton, Vazio } from '@/components/ui/primitives';
import { StatusPagamento } from '@/components/dominio/StatusBadge';

const VAZIO: DashboardMetrics = {
  faturamento_total: 0,
  faturamento_mes: 0,
  recebido: 0,
  a_receber: 0,
  atrasado: 0,
  vendas: 0,
  clientes: 0,
  leads: 0,
  taxa_conversao: 0,
  projetos_ativos: 0,
  ticket_medio: 0,
};

export function Financeiro() {
  const { preset, periodo, escolher, definirPersonalizado } = usePeriodo('ano');
  const chave = `${periodo.de}|${periodo.ate}`;

  const metricas = useAsync(() => db.analytics.metricas(periodo), [chave], VAZIO);
  const faturamento = useAsync(() => db.analytics.faturamentoPorPeriodo(periodo), [chave], []);
  const porServico = useAsync(() => db.analytics.faturamentoPorServico(periodo), [chave], []);
  const formas = useAsync(() => db.analytics.pixVersusCartao(periodo), [chave], []);
  const situacao = useAsync(() => db.analytics.situacaoPagamentos(periodo), [chave], []);

  /* Fluxo previsto: o que ainda vai vencer, mês a mês. */
  const previsto = useAsync(
    async () => {
      const [parcelas, vendas] = await Promise.all([db.parcelas.todos(), db.vendas.todos()]);
      const hoje = new Date().toISOString().slice(0, 10);
      const abertas = parcelas
        .filter((p) => (p.status === 'pendente' || p.status === 'atrasado') && p.vencimento >= hoje)
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      return { abertas: abertas.slice(0, 8), vendas };
    },
    [chave],
    { abertas: [] as Installment[], vendas: [] as Sale[] },
  );

  const m = metricas.dado;

  const parceladas = useAsync(
    async () => {
      const vendas = await db.vendas.todos({ periodo });
      const validas = vendas.filter((v) => v.status !== 'orcamento' && v.status !== 'cancelado');
      const aVista = validas.filter((v) => v.parcelas === 1);
      const parcelado = validas.filter((v) => v.parcelas > 1);
      return [
        { rotulo: 'À vista', valor: aVista.reduce((s, v) => s + valorLiquido(v), 0) },
        { rotulo: 'Parcelado', valor: parcelado.reduce((s, v) => s + valorLiquido(v), 0) },
      ];
    },
    [chave],
    [],
  );

  const codigoDaVenda = useMemo(
    () => new Map(previsto.dado.vendas.map((v) => [v.id, v.codigo])),
    [previsto.dado.vendas],
  );

  const inadimplencia = m.faturamento_total > 0 ? (m.atrasado / m.faturamento_total) * 100 : 0;

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Financeiro</Eyebrow>
          <h1 className="pagina-titulo">Visão financeira</h1>
          <p className="pagina-descricao">
            Faturamento é o valor líquido das vendas fechadas. Recebido é o que efetivamente entrou.
            Os dois raramente são iguais — a diferença é o parcelamento.
          </p>
        </div>
      </header>

      <FiltroPeriodo
        preset={preset}
        periodo={periodo}
        aoEscolher={escolher}
        aoDefinirPersonalizado={definirPersonalizado}
      />

      <div className="grade-kpi secao">
        <StatCard rotulo="Faturamento" valor={brl(m.faturamento_total)} icone="financeiro" destaque carregando={metricas.carregando} rodape={<span>{m.vendas} vendas</span>} />
        <StatCard rotulo="Recebido" valor={brl(m.recebido)} icone="sucesso" carregando={metricas.carregando} />
        <StatCard rotulo="A receber" valor={brl(m.a_receber)} icone="relogio" carregando={metricas.carregando} />
        <StatCard rotulo="Em atraso" valor={brl(m.atrasado)} icone="alerta" carregando={metricas.carregando} rodape={<span>{percentual(inadimplencia)} do faturado</span>} />
        <StatCard rotulo="Ticket médio" valor={brl(m.ticket_medio)} icone="vendas" carregando={metricas.carregando} />
      </div>

      <section className="secao grade-larga">
        <GraficoArea
          titulo="Faturamento por período"
          descricao="Valor líquido das vendas fechadas"
          serie={faturamento.dado}
          carregando={faturamento.carregando}
        />
        <GraficoRosca
          titulo="PIX x Cartão"
          descricao="Sobre o que já foi pago"
          dados={formas.dado}
          carregando={formas.carregando}
        />
      </section>

      <section className="secao grade-2">
        <GraficoBarrasH
          titulo="Faturamento por serviço"
          descricao="Quem sustenta o caixa"
          dados={porServico.dado}
          carregando={porServico.carregando}
          formatar={brl}
        />
        <GraficoBarrasH
          titulo="Situação das cobranças"
          descricao="Valor por situação"
          dados={situacao.dado}
          carregando={situacao.carregando}
          formatar={brl}
          corPorRotulo={CORES_STATUS}
        />
      </section>

      <section className="secao grade-2">
        <GraficoRosca
          titulo="À vista x Parcelado"
          descricao="Como as vendas foram fechadas"
          dados={parceladas.dado}
          carregando={parceladas.carregando}
          cores={['var(--serie-4)', 'var(--serie-3)']}
        />

        <Card padding={false}>
          <div className="card-cabeca">
            <div>
              <div className="card-titulo">Próximos vencimentos</div>
              <div className="card-sub">O que ainda vai entrar</div>
            </div>
          </div>

          {previsto.carregando ? (
            <div style={{ padding: 20 }}>
              <Skeleton altura={140} />
            </div>
          ) : previsto.dado.abertas.length === 0 ? (
            <Vazio icone="sucesso" titulo="Nada a vencer" descricao="Nenhuma parcela em aberto para os próximos dias." />
          ) : (
            <ul className="lista-simples">
              {previsto.dado.abertas.map((p) => (
                <li key={p.id}>
                  <div className="pilha" style={{ minWidth: 0 }}>
                    <span className="mono" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                      {codigoDaVenda.get(p.venda_id) ?? '—'}
                    </span>
                    <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                      Parcela {p.numero}/{p.total_parcelas} · vence {formatarData(p.vencimento)}
                    </span>
                  </div>
                  <div className="linha" style={{ gap: 10 }}>
                    <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{brl(p.valor)}</span>
                    <StatusPagamento status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

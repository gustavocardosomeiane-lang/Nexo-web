/**
 * Dashboard — a visao geral da operacao.
 *
 * Ordem pensada para leitura de cima para baixo: primeiro o dinheiro, depois o
 * funil, depois o que exige acao hoje.
 */

import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { usePeriodo } from '@/hooks/usePeriodo';
import { brl, formatarData, percentual } from '@/lib/format';
import { useAuth } from '@/auth/AuthContext';
import { StatCard } from '@/components/dominio/StatCard';
import { FiltroPeriodo } from '@/components/dominio/FiltroPeriodo';
import { GraficoArea, GraficoBarras, GraficoBarrasH, GraficoRosca } from '@/components/charts/Charts';
import { CORES_STATUS } from '@/components/charts/base';
import { Card, Eyebrow, Skeleton, Vazio } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { StatusPagamento, StatusProjeto } from '@/components/dominio/StatusBadge';
import type { DashboardMetrics } from '@/types';

const METRICAS_VAZIAS: DashboardMetrics = {
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

export function Dashboard() {
  const { usuario, podeVer } = useAuth();
  const { preset, periodo, escolher, definirPersonalizado } = usePeriodo('30dias');

  const chave = `${periodo.de}|${periodo.ate}`;

  const metricas = useAsync(() => db.analytics.metricas(periodo), [chave], METRICAS_VAZIAS);
  const faturamento = useAsync(() => db.analytics.faturamentoPorPeriodo(periodo), [chave], []);
  const vendasSerie = useAsync(() => db.analytics.vendasPorPeriodo(periodo), [chave], []);
  const funil = useAsync(() => db.analytics.funilLeads(periodo), [chave], []);
  const servicos = useAsync(() => db.analytics.servicosMaisVendidos(periodo), [chave], []);
  const formas = useAsync(() => db.analytics.pixVersusCartao(periodo), [chave], []);
  const situacao = useAsync(() => db.analytics.situacaoPagamentos(periodo), [chave], []);

  /* A receber e projetos em risco: o que precisa de decisão hoje. */
  const carregarPendencias = useCallback(async () => {
    const [pagamentos, projetos] = await Promise.all([
      db.pagamentos.todos({ filtros: { status: 'atrasado' }, ordenarPor: 'vencimento', ordem: 'asc' }),
      db.projetos.todos({ ordenarPor: 'prazo', ordem: 'asc' }),
    ]);
    const clientes = await db.clientes.todos();
    const nome = new Map(clientes.map((c) => [c.id, c.empresa ?? c.nome]));

    const hoje = new Date().toISOString().slice(0, 10);
    return {
      atrasados: pagamentos.slice(0, 5).map((p) => ({ ...p, cliente: nome.get(p.cliente_id) ?? '—' })),
      emRisco: projetos
        .filter((p) => p.progresso < 100 && p.prazo && p.prazo >= hoje)
        .slice(0, 5),
    };
  }, []);

  const pendencias = useAsync(carregarPendencias, [], { atrasados: [], emRisco: [] });

  const m = metricas.dado;
  const carregandoKpi = metricas.carregando;

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Visão geral</Eyebrow>
          <h1 className="pagina-titulo">
            {saudacao()}, {usuario?.nome.split(' ')[0]}.
          </h1>
          <p className="pagina-descricao">
            O resumo abaixo considera o período selecionado. O faturamento do mês é sempre o mês
            corrente, independente do filtro.
          </p>
        </div>
      </header>

      <FiltroPeriodo
        preset={preset}
        periodo={periodo}
        aoEscolher={escolher}
        aoDefinirPersonalizado={definirPersonalizado}
      />

      {metricas.erro && (
        <Card className="secao">
          <span style={{ color: '#FF8A95' }}>{metricas.erro}</span>
        </Card>
      )}

      {/* ---- Dinheiro ---- */}
      <section className="secao" aria-label="Indicadores financeiros">
        <div className="grade-kpi">
          <StatCard
            rotulo="Faturamento no período"
            valor={brl(m.faturamento_total)}
            icone="financeiro"
            destaque
            carregando={carregandoKpi}
            rodape={<span>{m.vendas} vendas fechadas</span>}
          />
          <StatCard
            rotulo="Recebido"
            valor={brl(m.recebido)}
            icone="sucesso"
            carregando={carregandoKpi}
            rodape={
              <span>
                {m.faturamento_total > 0
                  ? `${percentual((m.recebido / m.faturamento_total) * 100, 0)} do faturado`
                  : '—'}
              </span>
            }
          />
          <StatCard
            rotulo="A receber"
            valor={brl(m.a_receber)}
            icone="relogio"
            carregando={carregandoKpi}
            rodape={<span>Parcelas ainda no prazo</span>}
          />
          <StatCard
            rotulo="Em atraso"
            valor={brl(m.atrasado)}
            icone="alerta"
            carregando={carregandoKpi}
            rodape={
              m.atrasado > 0 ? (
                <Link to="/pagamentos?status=atrasado" className="stat-delta desce">
                  Ver cobranças
                </Link>
              ) : (
                <span>Nenhuma pendência</span>
              )
            }
          />
          <StatCard
            rotulo="Faturamento do mês"
            valor={brl(m.faturamento_mes)}
            icone="calendario"
            carregando={carregandoKpi}
            rodape={<span>Mês corrente</span>}
          />
        </div>
      </section>

      {/* ---- Funil ---- */}
      <section className="secao" aria-label="Indicadores comerciais">
        <div className="grade-kpi">
          <StatCard rotulo="Leads" valor={String(m.leads)} icone="leads" carregando={carregandoKpi} />
          <StatCard
            rotulo="Taxa de conversão"
            valor={percentual(m.taxa_conversao)}
            icone="alvo"
            carregando={carregandoKpi}
            rodape={<span>Leads que viraram cliente</span>}
          />
          <StatCard rotulo="Clientes" valor={String(m.clientes)} icone="clientes" carregando={carregandoKpi} />
          <StatCard
            rotulo="Ticket médio"
            valor={brl(m.ticket_medio)}
            icone="vendas"
            carregando={carregandoKpi}
          />
          <StatCard
            rotulo="Projetos ativos"
            valor={String(m.projetos_ativos)}
            icone="projetos"
            carregando={carregandoKpi}
            rodape={<span>Em execução agora</span>}
          />
        </div>
      </section>

      {/* ---- Gráficos ---- */}
      <section className="secao grade-larga">
        <GraficoArea
          titulo="Faturamento"
          descricao="Valor líquido das vendas fechadas"
          serie={faturamento.dado}
          carregando={faturamento.carregando}
        />
        <GraficoRosca
          titulo="Como recebemos"
          descricao="Volume efetivamente pago"
          dados={formas.dado}
          carregando={formas.carregando}
        />
      </section>

      <section className="secao grade-2">
        <GraficoBarras
          titulo="Vendas fechadas"
          descricao="Quantidade por período"
          serie={vendasSerie.dado}
          carregando={vendasSerie.carregando}
          formatar={(v) => `${v} ${v === 1 ? 'venda' : 'vendas'}`}
        />
        <GraficoBarrasH
          titulo="Situação dos pagamentos"
          descricao="Valor por situação"
          dados={situacao.dado}
          carregando={situacao.carregando}
          formatar={brl}
          corPorRotulo={CORES_STATUS}
        />
      </section>

      <section className="secao grade-2">
        {podeVer('leads') && (
          <GraficoBarrasH
            titulo="Funil de leads"
            descricao="Quantidade em cada etapa"
            dados={funil.dado}
            carregando={funil.carregando}
            limite={9}
            formatar={(v) => `${v}`}
          />
        )}
        <GraficoBarrasH
          titulo="Serviços mais vendidos"
          descricao="Quantidade de vendas por serviço"
          dados={servicos.dado}
          carregando={servicos.carregando}
          cor="var(--serie-2)"
          formatar={(v) => `${v}`}
        />
      </section>

      {/* ---- O que precisa de ação ---- */}
      <section className="secao grade-2">
        <Card padding={false}>
          <div className="card-cabeca">
            <div>
              <div className="card-titulo">Cobranças em atraso</div>
              <div className="card-sub">As 5 mais antigas</div>
            </div>
            <Link to="/pagamentos?status=atrasado" className="btn btn-fantasma btn-sm">
              Ver todas
            </Link>
          </div>

          {pendencias.carregando ? (
            <div style={{ padding: 20 }}>
              <Skeleton altura={90} />
            </div>
          ) : pendencias.dado.atrasados.length === 0 ? (
            <Vazio
              icone="sucesso"
              titulo="Nada em atraso"
              descricao="Todas as parcelas vencidas foram quitadas."
            />
          ) : (
            <ul className="lista-simples">
              {pendencias.dado.atrasados.map((p) => (
                <li key={p.id}>
                  <div className="pilha" style={{ minWidth: 0 }}>
                    <span className="truncar" style={{ color: 'var(--fg)', fontWeight: 500 }}>
                      {p.cliente}
                    </span>
                    <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                      Venceu em {formatarData(p.vencimento)}
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

        <Card padding={false}>
          <div className="card-cabeca">
            <div>
              <div className="card-titulo">Projetos com prazo próximo</div>
              <div className="card-sub">Ordenados pela entrega</div>
            </div>
            <Link to="/projetos" className="btn btn-fantasma btn-sm">
              Ver todos
            </Link>
          </div>

          {pendencias.carregando ? (
            <div style={{ padding: 20 }}>
              <Skeleton altura={90} />
            </div>
          ) : pendencias.dado.emRisco.length === 0 ? (
            <Vazio icone="projetos" titulo="Nenhum projeto em andamento" />
          ) : (
            <ul className="lista-simples">
              {pendencias.dado.emRisco.map((p) => (
                <li key={p.id}>
                  <div className="pilha" style={{ minWidth: 0 }}>
                    <span className="truncar" style={{ color: 'var(--fg)', fontWeight: 500 }}>
                      {p.nome}
                    </span>
                    <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                      Entrega {formatarData(p.prazo)} · {p.progresso}% concluído
                    </span>
                  </div>
                  <StatusProjeto status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* ---- Atalhos ---- */}
      <section className="secao">
        <div className="grade-3">
          {podeVer('leads') && (
            <AtalhoCard
              icone="leads"
              titulo="Novo lead"
              descricao="Cadastre um contato que chegou agora e coloque no funil."
              para="/leads"
            />
          )}
          {podeVer('vendas') && (
            <AtalhoCard
              icone="vendas"
              titulo="Registrar venda"
              descricao="Gere a venda, o parcelamento e o projeto correspondente."
              para="/vendas"
            />
          )}
          <AtalhoCard
            icone="automacoes"
            titulo="Ver o funil completo"
            descricao="Do disparo do NinjaBot ao pós-venda, etapa por etapa."
            para="/automacoes"
          />
        </div>
      </section>
    </>
  );
}

function AtalhoCard({
  icone,
  titulo,
  descricao,
  para,
}: {
  icone: Parameters<typeof Icon>[0]['nome'];
  titulo: string;
  descricao: string;
  para: string;
}) {
  return (
    <Link to={para} className="card card-p card-hover atalho">
      <span className="stat-icone">
        <Icon nome={icone} />
      </span>
      <div>
        <div className="card-titulo">{titulo}</div>
        <p className="card-sub" style={{ marginTop: 4 }}>
          {descricao}
        </p>
      </div>
      <Icon nome="direita" tamanho={16} />
    </Link>
  );
}

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}


/**
 * Relatorios.
 *
 * Oito recortes, todos filtrados pelo periodo escolhido, com previa na tela e
 * exportacao em CSV. Excel e PDF ainda nao estao implementados e a interface
 * diz isso — botao que nao funciona e pior do que botao ausente.
 */

import { useCallback, useMemo, useState } from 'react';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { usePeriodo } from '@/hooks/usePeriodo';
import { valorLiquido } from '@/data/analytics';
import { baixarCSV, valorParaPlanilha, type ColunaExport } from '@/lib/exportar';
import { brl, formatarData, formatarTelefone, percentual } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import type { Client, Installment, Lead, Payment, Project, Sale, Service } from '@/types';
import { Aviso, Botao, Card, Eyebrow, Skeleton, Vazio } from '@/components/ui/primitives';
import { FiltroPeriodo } from '@/components/dominio/FiltroPeriodo';
import { Icon, type NomeIcone } from '@/components/ui/Icon';
import {
  CATEGORIA_SERVICO,
  FORMA_PAGAMENTO,
  LEAD,
  ORIGEM_LEAD,
  PAGAMENTO,
  PROJETO,
  VENDA,
} from '@/components/dominio/StatusBadge';

type ChaveRelatorio =
  | 'vendas'
  | 'faturamento'
  | 'pagamentos'
  | 'clientes'
  | 'leads'
  | 'conversao'
  | 'servicos'
  | 'projetos';

interface Definicao {
  chave: ChaveRelatorio;
  titulo: string;
  descricao: string;
  icone: NomeIcone;
}

const RELATORIOS: Definicao[] = [
  { chave: 'vendas', titulo: 'Vendas', descricao: 'Toda venda do período, com cliente, serviço, valor e situação.', icone: 'vendas' },
  { chave: 'faturamento', titulo: 'Faturamento', descricao: 'Consolidado por mês: contratado, recebido e em aberto.', icone: 'financeiro' },
  { chave: 'pagamentos', titulo: 'Pagamentos', descricao: 'Parcelas com vencimento, situação e forma de pagamento.', icone: 'pagamentos' },
  { chave: 'clientes', titulo: 'Clientes', descricao: 'Carteira com total faturado e quantidade de projetos.', icone: 'clientes' },
  { chave: 'leads', titulo: 'Leads', descricao: 'Contatos do período com origem, etapa e valor potencial.', icone: 'leads' },
  { chave: 'conversao', titulo: 'Conversão', descricao: 'Quantos leads de cada origem viraram cliente.', icone: 'alvo' },
  { chave: 'servicos', titulo: 'Serviços', descricao: 'Quanto cada serviço vendeu e faturou.', icone: 'servicos' },
  { chave: 'projetos', titulo: 'Projetos', descricao: 'Situação, progresso e prazo de cada entrega.', icone: 'projetos' },
];

interface Tabela {
  colunas: string[];
  linhas: (string | number)[][];
  /** Colunas alinhadas à direita (valores). */
  numericas: number[];
}

export function Relatorios() {
  const toast = useToast();
  const { preset, periodo, escolher, definirPersonalizado } = usePeriodo('ano');
  const [ativo, setAtivo] = useState<ChaveRelatorio>('vendas');

  const chave = `${periodo.de}|${periodo.ate}`;

  const base = useAsync(
    async () => {
      const [vendas, pagamentos, parcelas, clientes, leads, projetos, servicos] = await Promise.all([
        db.vendas.todos({ periodo }),
        db.pagamentos.todos({ periodo }),
        db.parcelas.todos({ periodo }),
        db.clientes.todos(),
        db.leads.todos({ periodo }),
        db.projetos.todos(),
        db.servicos.todos(),
      ]);
      return { vendas, pagamentos, parcelas, clientes, leads, projetos, servicos };
    },
    [chave],
    {
      vendas: [] as Sale[],
      pagamentos: [] as Payment[],
      parcelas: [] as Installment[],
      clientes: [] as Client[],
      leads: [] as Lead[],
      projetos: [] as Project[],
      servicos: [] as Service[],
    },
  );

  const { vendas, parcelas, clientes, leads, projetos, servicos } = base.dado;

  const nomeCliente = useMemo(
    () => new Map(clientes.map((c) => [c.id, c.empresa ?? c.nome])),
    [clientes],
  );
  const nomeServico = useMemo(() => new Map(servicos.map((s) => [s.id, s.nome])), [servicos]);
  const codigoVendaMap = useMemo(() => new Map(vendas.map((v) => [v.id, v.codigo])), [vendas]);

  /* ---- Montagem de cada relatório ---- */

  const tabela: Tabela = useMemo(() => {
    const faturaveis = vendas.filter((v) => v.status !== 'orcamento' && v.status !== 'cancelado');

    switch (ativo) {
      case 'vendas':
        return {
          colunas: ['Código', 'Data', 'Cliente', 'Serviço', 'Forma', 'Parcelas', 'Valor líquido', 'Situação'],
          numericas: [6],
          linhas: vendas.map((v) => [
            v.codigo,
            formatarData(v.data),
            nomeCliente.get(v.cliente_id) ?? '—',
            v.servico_id ? nomeServico.get(v.servico_id) ?? '—' : '—',
            FORMA_PAGAMENTO[v.forma_pagamento],
            `${v.parcelas}×`,
            brl(valorLiquido(v)),
            VENDA[v.status].rotulo,
          ]),
        };

      case 'faturamento': {
        const meses = new Map<string, { contratado: number; recebido: number; aberto: number }>();
        for (const v of faturaveis) {
          const mes = v.data.slice(0, 7);
          const atual = meses.get(mes) ?? { contratado: 0, recebido: 0, aberto: 0 };
          atual.contratado += valorLiquido(v);
          meses.set(mes, atual);
        }
        for (const p of base.dado.pagamentos) {
          const mes = (p.status === 'pago' ? p.pago_em ?? p.vencimento : p.vencimento).slice(0, 7);
          const atual = meses.get(mes) ?? { contratado: 0, recebido: 0, aberto: 0 };
          if (p.status === 'pago') atual.recebido += p.valor;
          else if (p.status === 'pendente' || p.status === 'atrasado') atual.aberto += p.valor;
          meses.set(mes, atual);
        }
        return {
          colunas: ['Mês', 'Contratado', 'Recebido', 'Em aberto'],
          numericas: [1, 2, 3],
          linhas: [...meses.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([mes, v]) => [
              mes.split('-').reverse().join('/'),
              brl(v.contratado),
              brl(v.recebido),
              brl(v.aberto),
            ]),
        };
      }

      case 'pagamentos':
        return {
          colunas: ['Venda', 'Parcela', 'Valor', 'Vencimento', 'Pago em', 'Situação'],
          numericas: [2],
          linhas: parcelas.map((p) => [
            codigoVendaMap.get(p.venda_id) ?? '—',
            `${p.numero}/${p.total_parcelas}`,
            brl(p.valor),
            formatarData(p.vencimento),
            formatarData(p.pago_em),
            PAGAMENTO[p.status].rotulo,
          ]),
        };

      case 'clientes': {
        const porCliente = new Map<string, { faturado: number; vendas: number; projetos: number }>();
        for (const v of faturaveis) {
          const atual = porCliente.get(v.cliente_id) ?? { faturado: 0, vendas: 0, projetos: 0 };
          atual.faturado += valorLiquido(v);
          atual.vendas += 1;
          porCliente.set(v.cliente_id, atual);
        }
        for (const p of projetos) {
          const atual = porCliente.get(p.cliente_id) ?? { faturado: 0, vendas: 0, projetos: 0 };
          atual.projetos += 1;
          porCliente.set(p.cliente_id, atual);
        }
        return {
          colunas: ['Cliente', 'Telefone', 'Cidade', 'Cadastro', 'Vendas', 'Projetos', 'Total faturado'],
          numericas: [4, 5, 6],
          linhas: clientes.map((c) => {
            const r = porCliente.get(c.id) ?? { faturado: 0, vendas: 0, projetos: 0 };
            return [
              c.empresa ?? c.nome,
              formatarTelefone(c.telefone),
              c.cidade ? `${c.cidade}${c.estado ? `/${c.estado}` : ''}` : '—',
              formatarData(c.criado_em),
              r.vendas,
              r.projetos,
              brl(r.faturado),
            ];
          }),
        };
      }

      case 'leads':
        return {
          colunas: ['Nome', 'Empresa', 'Telefone', 'Origem', 'Campanha', 'Entrada', 'Etapa', 'Potencial'],
          numericas: [7],
          linhas: leads.map((l) => [
            l.nome,
            l.empresa ?? '—',
            formatarTelefone(l.telefone),
            ORIGEM_LEAD[l.origem] ?? l.origem,
            l.campanha ?? '—',
            formatarData(l.data_entrada),
            LEAD[l.status].rotulo,
            l.valor_potencial ? brl(l.valor_potencial) : '—',
          ]),
        };

      case 'conversao': {
        const origens = new Map<string, { total: number; clientes: number; perdidos: number }>();
        for (const l of leads) {
          const atual = origens.get(l.origem) ?? { total: 0, clientes: 0, perdidos: 0 };
          atual.total += 1;
          if (l.status === 'cliente') atual.clientes += 1;
          if (l.status === 'perdido') atual.perdidos += 1;
          origens.set(l.origem, atual);
        }
        return {
          colunas: ['Origem', 'Leads', 'Viraram cliente', 'Perdidos', 'Taxa de conversão'],
          numericas: [1, 2, 3, 4],
          linhas: [...origens.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([origem, r]) => [
              ORIGEM_LEAD[origem] ?? origem,
              r.total,
              r.clientes,
              r.perdidos,
              percentual(r.total > 0 ? (r.clientes / r.total) * 100 : 0),
            ]),
        };
      }

      case 'servicos': {
        const porServico = new Map<string, { qtd: number; total: number }>();
        for (const v of faturaveis) {
          const id = v.servico_id ?? 'sem';
          const atual = porServico.get(id) ?? { qtd: 0, total: 0 };
          atual.qtd += 1;
          atual.total += valorLiquido(v);
          porServico.set(id, atual);
        }
        return {
          colunas: ['Serviço', 'Categoria', 'Preço de tabela', 'Vendas', 'Faturamento'],
          numericas: [2, 3, 4],
          linhas: servicos.map((s) => {
            const r = porServico.get(s.id) ?? { qtd: 0, total: 0 };
            return [
              s.nome,
              CATEGORIA_SERVICO[s.categoria],
              brl(s.preco_promocional ?? s.preco),
              r.qtd,
              brl(r.total),
            ];
          }),
        };
      }

      case 'projetos':
        return {
          colunas: ['Projeto', 'Cliente', 'Etapa', 'Progresso', 'Início', 'Prazo', 'Valor'],
          numericas: [3, 6],
          linhas: projetos.map((p) => [
            p.nome,
            nomeCliente.get(p.cliente_id) ?? '—',
            PROJETO[p.status].rotulo,
            `${p.progresso}%`,
            formatarData(p.data_inicio),
            formatarData(p.prazo),
            brl(p.valor),
          ]),
        };

      default:
        return { colunas: [], linhas: [], numericas: [] };
    }
  }, [ativo, vendas, parcelas, clientes, leads, projetos, servicos, nomeCliente, nomeServico, codigoVendaMap, base.dado.pagamentos]);

  const definicao = RELATORIOS.find((r) => r.chave === ativo) as Definicao;

  const exportar = useCallback(() => {
    if (tabela.linhas.length === 0) {
      toast.info('Não há dados para exportar neste período.');
      return;
    }

    const colunas: ColunaExport<(string | number)[]>[] = tabela.colunas.map((titulo, i) => ({
      titulo,
      valor: (linha) => {
        const celula = linha[i];
        // Valores em reais viram número puro, para o Excel poder somar.
        if (typeof celula === 'string' && celula.startsWith('R$')) {
          return valorParaPlanilha(Math.round(Number(celula.replace(/[^\d,-]/g, '').replace(',', '.')) * 100));
        }
        return celula;
      },
    }));

    baixarCSV(`nexo-${ativo}`, tabela.linhas, colunas);
    toast.sucesso('Relatório exportado em CSV.');
  }, [tabela, ativo, toast]);

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Análise</Eyebrow>
          <h1 className="pagina-titulo">Relatórios</h1>
          <p className="pagina-descricao">
            Escolha o recorte, ajuste o período e exporte. O CSV abre no Excel com acentos e colunas
            corretos.
          </p>
        </div>
      </header>

      <FiltroPeriodo
        preset={preset}
        periodo={periodo}
        aoEscolher={escolher}
        aoDefinirPersonalizado={definirPersonalizado}
      />

      <div className="secao grade-3">
        {RELATORIOS.map((r) => (
          <button
            key={r.chave}
            type="button"
            className={`card card-p relatorio-card ${ativo === r.chave ? 'ativo' : ''}`}
            aria-pressed={ativo === r.chave}
            onClick={() => setAtivo(r.chave)}
          >
            <span className={`stat-icone ${ativo === r.chave ? '' : 'stat-icone-neutro'}`}>
              <Icon nome={r.icone} />
            </span>
            <div>
              <div className="card-titulo">{r.titulo}</div>
              <p className="card-sub" style={{ marginTop: 3 }}>
                {r.descricao}
              </p>
            </div>
          </button>
        ))}
      </div>

      <section className="secao">
        <Card padding={false}>
          <div className="card-cabeca">
            <div>
              <div className="card-titulo">{definicao.titulo}</div>
              <div className="card-sub">
                {tabela.linhas.length} {tabela.linhas.length === 1 ? 'registro' : 'registros'} ·{' '}
                {formatarData(periodo.de)} a {formatarData(periodo.ate)}
              </div>
            </div>
            <div className="linha" style={{ gap: 8 }}>
              <Botao variante="secundario" icone="baixar" onClick={exportar}>
                Exportar CSV
              </Botao>
              <Botao variante="fantasma" icone="relatorios" onClick={() => window.print()}>
                Imprimir
              </Botao>
            </div>
          </div>

          {base.carregando ? (
            <div style={{ padding: 20 }}>
              <Skeleton altura={280} />
            </div>
          ) : tabela.linhas.length === 0 ? (
            <Vazio icone="relatorios" titulo="Sem dados no período" descricao="Amplie o intervalo de datas." />
          ) : (
            <div className="tabela-envolucro" style={{ border: 0, borderRadius: 0, maxHeight: '60vh', overflowY: 'auto' }}>
              <table className="tabela">
                <thead>
                  <tr>
                    {tabela.colunas.map((c, i) => (
                      <th key={c} className={tabela.numericas.includes(i) ? 'num' : undefined}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabela.linhas.slice(0, 200).map((linha, i) => (
                    <tr key={i}>
                      {linha.map((celula, j) => (
                        <td key={j} className={tabela.numericas.includes(j) ? 'num' : j === 0 ? 'forte' : undefined}>
                          {celula}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tabela.linhas.length > 200 && (
            <p className="campo-ajuda" style={{ padding: '12px 20px' }}>
              Mostrando os 200 primeiros na tela. A exportação leva todos os {tabela.linhas.length}.
            </p>
          )}
        </Card>
      </section>

      <Aviso tom="info" className="secao">
        <strong>Excel e PDF ainda não estão implementados.</strong> O XLSX exige uma biblioteca de
        planilha, que seria a primeira dependência pesada do projeto — o CSV acima abre corretamente
        no Excel. Para PDF, use <strong>Imprimir</strong> e escolha “Salvar como PDF”: existe folha
        de estilo de impressão preparada.
      </Aviso>
    </>
  );
}

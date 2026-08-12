/**
 * Pagamentos e parcelas.
 *
 * Duas abas sobre a mesma realidade: "Pagamentos" e a visao financeira
 * (entrou, nao entrou, atrasou) e "Parcelas" e a visao do contrato (1 de 3,
 * quando vence). Cada parcela tem exatamente um pagamento.
 *
 * Enquanto nao ha gateway, a baixa e manual. Ela chama a mesma funcao que o
 * webhook chamara depois, entao o comportamento nao muda quando a integracao
 * chegar.
 */

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/data';
import { baixarParcela, estornarParcela } from '@/data/operacoes';
import { useColecao } from '@/hooks/useColecao';
import { useAsync } from '@/hooks/useAsync';
import { usePeriodo } from '@/hooks/usePeriodo';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Client, Installment, Payment, Sale } from '@/types';
import { brl, diasAte, formatarData } from '@/lib/format';
import { DataTable, type Coluna } from '@/components/ui/DataTable';
import { Paginacao } from '@/components/ui/Pagination';
import { Confirmacao } from '@/components/ui/Modal';
import { Aviso, Botao, BotaoIcone, CampoTexto, Eyebrow } from '@/components/ui/primitives';
import { StatCard } from '@/components/dominio/StatCard';
import { FiltroPeriodo } from '@/components/dominio/FiltroPeriodo';
import {
  FORMA_PAGAMENTO,
  PAGAMENTO,
  StatusPagamento,
  opcoesDe,
  opcoesSimples,
} from '@/components/dominio/StatusBadge';

type Aba = 'pagamentos' | 'parcelas';

export function Pagamentos() {
  const { pode } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [aba, setAba] = useState<Aba>('pagamentos');
  const { preset, periodo, escolher, definirPersonalizado } = usePeriodo('ano');

  const clientes = useAsync(() => db.clientes.todos(), [], [] as Client[]);
  const vendas = useAsync(() => db.vendas.todos(), [], [] as Sale[]);

  const nomeCliente = useMemo(
    () => new Map(clientes.dado.map((c) => [c.id, c.empresa ?? c.nome])),
    [clientes.dado],
  );
  const codigoVendaMap = useMemo(
    () => new Map(vendas.dado.map((v) => [v.id, v.codigo])),
    [vendas.dado],
  );
  const clienteDaVenda = useMemo(
    () => new Map(vendas.dado.map((v) => [v.id, v.cliente_id])),
    [vendas.dado],
  );

  const pagamentos = useColecao<Payment>(db.pagamentos, {
    porPagina: 20,
    ordenarPor: 'vencimento',
    periodo,
    filtrosIniciais: {
      status: params.get('status') ?? 'todos',
      forma_pagamento: 'todos',
      cliente_id: 'todos',
    },
    ativo: aba === 'pagamentos',
  });

  const parcelas = useColecao<Installment>(db.parcelas, {
    porPagina: 20,
    ordenarPor: 'vencimento',
    ordem: 'asc',
    periodo,
    filtrosIniciais: { status: params.get('status') ?? 'todos' },
    ativo: aba === 'parcelas',
  });

  /* Resumo do período — independente de qual aba está aberta. */
  const resumo = useAsync(
    async () => {
      const todos = await db.pagamentos.todos({ periodo });
      const soma = (s: Payment['status']) =>
        todos.filter((p) => p.status === s).reduce((acc, p) => acc + p.valor, 0);
      return {
        recebido: soma('pago'),
        pendente: soma('pendente'),
        atrasado: soma('atrasado'),
        reembolsado: soma('reembolsado'),
      };
    },
    [`${periodo.de}|${periodo.ate}`, pagamentos.total, parcelas.total],
    { recebido: 0, pendente: 0, atrasado: 0, reembolsado: 0 },
  );

  const [baixando, setBaixando] = useState<Installment | null>(null);
  const [estornando, setEstornando] = useState<Installment | null>(null);
  const [processando, setProcessando] = useState(false);

  const recarregarTudo = useCallback(() => {
    pagamentos.recarregar();
    parcelas.recarregar();
    resumo.recarregar();
  }, [pagamentos, parcelas, resumo]);

  const confirmarBaixa = useCallback(async () => {
    if (!baixando) return;
    setProcessando(true);
    try {
      await baixarParcela(baixando, new Date().toISOString());
      toast.sucesso('Parcela baixada. A situação da venda foi recalculada.');
      setBaixando(null);
      recarregarTudo();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível dar baixa.');
    } finally {
      setProcessando(false);
    }
  }, [baixando, toast, recarregarTudo]);

  const confirmarEstorno = useCallback(async () => {
    if (!estornando) return;
    setProcessando(true);
    try {
      await estornarParcela(estornando);
      toast.sucesso('Baixa estornada.');
      setEstornando(null);
      recarregarTudo();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível estornar.');
    } finally {
      setProcessando(false);
    }
  }, [estornando, toast, recarregarTudo]);

  const colunasPagamento: Coluna<Payment>[] = useMemo(
    () => [
      {
        chave: 'cliente',
        titulo: 'Cliente',
        render: (p) => (
          <div className="pilha">
            <span className="forte truncar">{nomeCliente.get(p.cliente_id) ?? '—'}</span>
            <span className="mono" style={{ fontSize: '.6875rem', color: 'var(--fg-dim)' }}>
              {codigoVendaMap.get(p.venda_id) ?? '—'}
            </span>
          </div>
        ),
      },
      { chave: 'valor', titulo: 'Valor', ordenarPor: 'valor', alinharDireita: true, render: (p) => <span className="forte">{brl(p.valor)}</span> },
      {
        chave: 'forma',
        titulo: 'Forma',
        ordenarPor: 'forma_pagamento',
        ocultarNoMobile: true,
        render: (p) => FORMA_PAGAMENTO[p.forma_pagamento],
      },
      {
        chave: 'vencimento',
        titulo: 'Vencimento',
        ordenarPor: 'vencimento',
        render: (p) => <VencimentoCelula data={p.vencimento} status={p.status} />,
      },
      {
        chave: 'pago',
        titulo: 'Pago em',
        ordenarPor: 'pago_em',
        ocultarNoMobile: true,
        render: (p) => formatarData(p.pago_em),
      },
      { chave: 'status', titulo: 'Situação', ordenarPor: 'status', render: (p) => <StatusPagamento status={p.status} /> },
    ],
    [nomeCliente, codigoVendaMap],
  );

  const colunasParcela: Coluna<Installment>[] = useMemo(
    () => [
      {
        chave: 'venda',
        titulo: 'Venda',
        render: (p) => {
          const clienteId = clienteDaVenda.get(p.venda_id);
          return (
            <div className="pilha">
              <span className="forte mono">{codigoVendaMap.get(p.venda_id) ?? '—'}</span>
              <span className="truncar" style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                {clienteId ? nomeCliente.get(clienteId) ?? '—' : '—'}
              </span>
            </div>
          );
        },
      },
      {
        chave: 'numero',
        titulo: 'Parcela',
        ordenarPor: 'numero',
        render: (p) => (
          <span className="parcela-numero" style={{ display: 'inline-grid' }}>
            {p.numero}/{p.total_parcelas}
          </span>
        ),
      },
      { chave: 'valor', titulo: 'Valor', ordenarPor: 'valor', alinharDireita: true, render: (p) => <span className="forte">{brl(p.valor)}</span> },
      {
        chave: 'vencimento',
        titulo: 'Vencimento',
        ordenarPor: 'vencimento',
        render: (p) => <VencimentoCelula data={p.vencimento} status={p.status} />,
      },
      { chave: 'status', titulo: 'Situação', ordenarPor: 'status', render: (p) => <StatusPagamento status={p.status} /> },
      {
        chave: 'gateway',
        titulo: 'Transação',
        ocultarNoMobile: true,
        render: (p) =>
          p.gateway_transacao_id ? (
            <span className="mono truncar">{p.gateway_transacao_id}</span>
          ) : (
            <span style={{ color: 'var(--fg-dim)' }}>Manual</span>
          ),
      },
      {
        chave: 'acoes',
        titulo: '',
        render: (p) =>
          !pode('pagamentos', 'editar') ? null : p.status === 'pago' ? (
            <BotaoIcone
              icone="atualizar"
              rotulo={`Estornar parcela ${p.numero}`}
              onClick={(e) => {
                e.stopPropagation();
                setEstornando(p);
              }}
            />
          ) : p.status === 'pendente' || p.status === 'atrasado' ? (
            <Botao
              tamanho="sm"
              variante="secundario"
              icone="check"
              onClick={(e) => {
                e.stopPropagation();
                setBaixando(p);
              }}
            >
              Dar baixa
            </Botao>
          ) : null,
      },
    ],
    [codigoVendaMap, clienteDaVenda, nomeCliente, pode],
  );

  const ativa = aba === 'pagamentos' ? pagamentos : parcelas;

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Financeiro</Eyebrow>
          <h1 className="pagina-titulo">Pagamentos</h1>
          <p className="pagina-descricao">
            Todo dinheiro que entrou, vai entrar ou atrasou. As formas disponíveis hoje são PIX e
            cartão — a arquitetura aceita outras sem alterar as telas.
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
        <StatCard rotulo="Recebido" valor={brl(resumo.dado.recebido)} icone="sucesso" destaque carregando={resumo.carregando} />
        <StatCard rotulo="A receber" valor={brl(resumo.dado.pendente)} icone="relogio" carregando={resumo.carregando} />
        <StatCard rotulo="Em atraso" valor={brl(resumo.dado.atrasado)} icone="alerta" carregando={resumo.carregando} />
        <StatCard rotulo="Reembolsado" valor={brl(resumo.dado.reembolsado)} icone="atualizar" carregando={resumo.carregando} />
      </div>

      <div className="secao">
        <div className="abas" role="tablist" aria-label="Visão">
          <button type="button" role="tab" className="aba" aria-selected={aba === 'pagamentos'} onClick={() => setAba('pagamentos')}>
            Pagamentos
          </button>
          <button type="button" role="tab" className="aba" aria-selected={aba === 'parcelas'} onClick={() => setAba('parcelas')}>
            Parcelas
          </button>
        </div>
      </div>

      <div className="filtros" style={{ marginTop: 16 }}>
        <CampoTexto
          className="busca"
          placeholder={aba === 'pagamentos' ? 'Buscar por ID de transação' : 'Buscar por ID de transação'}
          iconeEsquerda="busca"
          value={ativa.busca}
          onChange={(e) => ativa.setBusca(e.target.value)}
          aria-label="Buscar"
        />
        <select
          className="select"
          value={String(ativa.filtros.status ?? 'todos')}
          onChange={(e) => ativa.definirFiltro('status', e.target.value)}
          aria-label="Filtrar por situação"
        >
          {opcoesDe(PAGAMENTO, 'Todas as situações').map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>

        {aba === 'pagamentos' && (
          <>
            <select
              className="select"
              value={String(pagamentos.filtros.forma_pagamento ?? 'todos')}
              onChange={(e) => pagamentos.definirFiltro('forma_pagamento', e.target.value)}
              aria-label="Filtrar por forma de pagamento"
            >
              {opcoesSimples(FORMA_PAGAMENTO, 'Todas as formas').map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={String(pagamentos.filtros.cliente_id ?? 'todos')}
              onChange={(e) => pagamentos.definirFiltro('cliente_id', e.target.value)}
              aria-label="Filtrar por cliente"
            >
              <option value="todos">Todos os clientes</option>
              {clientes.dado.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.empresa ?? c.nome}
                </option>
              ))}
            </select>
          </>
        )}

        {ativa.temFiltroAtivo && (
          <Botao variante="fantasma" tamanho="sm" icone="x" onClick={ativa.limparFiltros}>
            Limpar
          </Botao>
        )}
      </div>

      {ativa.erro && <Aviso tom="erro">{ativa.erro}</Aviso>}

      {aba === 'pagamentos' ? (
        <DataTable
          colunas={colunasPagamento}
          itens={pagamentos.itens}
          chaveDe={(p) => p.id}
          carregando={pagamentos.carregando}
          ordenarPor={pagamentos.ordenarPor}
          ordem={pagamentos.ordem}
          aoOrdenar={pagamentos.alternarOrdem}
          vazioTitulo="Nenhum pagamento no período"
        />
      ) : (
        <DataTable
          colunas={colunasParcela}
          itens={parcelas.itens}
          chaveDe={(p) => p.id}
          carregando={parcelas.carregando}
          ordenarPor={parcelas.ordenarPor}
          ordem={parcelas.ordem}
          aoOrdenar={parcelas.alternarOrdem}
          vazioTitulo="Nenhuma parcela no período"
        />
      )}

      <Paginacao
        pagina={ativa.pagina}
        porPagina={ativa.porPagina}
        total={ativa.total}
        aoMudar={ativa.setPagina}
        rotuloItem={aba === 'pagamentos' ? 'pagamentos' : 'parcelas'}
      />

      <Confirmacao
        aberto={baixando !== null}
        aoFechar={() => setBaixando(null)}
        aoConfirmar={() => void confirmarBaixa()}
        titulo="Dar baixa na parcela"
        mensagem={`Confirmar o recebimento de ${brl(baixando?.valor ?? 0)} (parcela ${baixando?.numero}/${baixando?.total_parcelas})? A situação da venda será recalculada.`}
        textoConfirmar="Confirmar recebimento"
        processando={processando}
      />

      <Confirmacao
        aberto={estornando !== null}
        aoFechar={() => setEstornando(null)}
        aoConfirmar={() => void confirmarEstorno()}
        titulo="Estornar baixa"
        mensagem={`A parcela ${estornando?.numero}/${estornando?.total_parcelas} volta para em aberto e a venda deixa de constar como paga.`}
        textoConfirmar="Estornar"
        perigo
        processando={processando}
      />
    </>
  );
}

/** Vencimento com o contexto que importa: quantos dias faltam ou passaram. */
function VencimentoCelula({ data, status }: { data: string; status: Payment['status'] }) {
  const dias = diasAte(data);
  const quitado = status === 'pago' || status === 'cancelado' || status === 'reembolsado';

  let contexto: string | null = null;
  let tom = 'var(--fg-dim)';

  if (!quitado && dias !== null) {
    if (dias < 0) {
      contexto = `${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'} em atraso`;
      tom = '#FF6070';
    } else if (dias === 0) {
      contexto = 'vence hoje';
      tom = '#FBBF24';
    } else if (dias <= 7) {
      contexto = `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
      tom = '#FBBF24';
    }
  }

  return (
    <div className="pilha">
      <span>{formatarData(data)}</span>
      {contexto && <span style={{ fontSize: '.6875rem', color: tom }}>{contexto}</span>}
    </div>
  );
}

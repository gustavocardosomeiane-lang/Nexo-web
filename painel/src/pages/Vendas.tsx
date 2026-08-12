/**
 * Vendas.
 *
 * Registrar uma venda aqui gera, de uma vez, as parcelas, os pagamentos e —
 * opcionalmente — o projeto. A regra vive em `data/operacoes.ts`.
 */

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/data';
import { criarVendaCompleta, dividirParcelas, precoVigente } from '@/data/operacoes';
import { valorLiquido } from '@/data/analytics';
import { useColecao } from '@/hooks/useColecao';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { SALE_STATUS, type Client, type Installment, type Sale, type SaleStatus, type Service } from '@/types';
import { brl, centavosParaCampo, formatarData, paraCentavos } from '@/lib/format';
import { DataTable, type Coluna } from '@/components/ui/DataTable';
import { Paginacao } from '@/components/ui/Pagination';
import { Confirmacao, Drawer, Modal } from '@/components/ui/Modal';
import {
  Aviso,
  Badge,
  Botao,
  BotaoIcone,
  CampoSelect,
  CampoTexto,
  CampoTextarea,
  Checkbox,
  Eyebrow,
} from '@/components/ui/primitives';
import { FORMA_PAGAMENTO, StatusPagamento, StatusVenda, VENDA, opcoesDe } from '@/components/dominio/StatusBadge';
import { coletarErros, inteiroEntre, limparTexto, obrigatorio, temErro, valorValido } from '@/lib/validation';
import { gatewayConfigurado } from '@/integrations/payments';

export function Vendas() {
  const { usuario, pode } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();

  const colecao = useColecao<Sale>(db.vendas, {
    porPagina: 20,
    ordenarPor: 'data',
    buscaInicial: params.get('busca') ?? '',
    filtrosIniciais: { status: params.get('status') ?? 'todos' },
  });

  const clientes = useAsync(() => db.clientes.todos(), [], [] as Client[]);
  const servicos = useAsync(() => db.servicos.todos(), [], [] as Service[]);

  const nomeCliente = useMemo(
    () => new Map(clientes.dado.map((c) => [c.id, c.empresa ?? c.nome])),
    [clientes.dado],
  );
  const nomeServico = useMemo(
    () => new Map(servicos.dado.map((s) => [s.id, s.nome])),
    [servicos.dado],
  );

  const [criando, setCriando] = useState(false);
  const [detalhe, setDetalhe] = useState<Sale | null>(null);
  const [excluindo, setExcluindo] = useState<Sale | null>(null);
  const [processando, setProcessando] = useState(false);

  const excluir = useCallback(async () => {
    if (!excluindo) return;
    setProcessando(true);
    try {
      // Remove os filhos antes: parcela órfã é pior que registro apagado.
      const [parcelas, pagamentos] = await Promise.all([
        db.parcelas.todos({ filtros: { venda_id: excluindo.id } }),
        db.pagamentos.todos({ filtros: { venda_id: excluindo.id } }),
      ]);
      await Promise.all(parcelas.map((p) => db.parcelas.remover(p.id)));
      await Promise.all(pagamentos.map((p) => db.pagamentos.remover(p.id)));
      await db.vendas.remover(excluindo.id);

      toast.sucesso('Venda excluída, junto com suas parcelas e pagamentos.');
      setExcluindo(null);
      setDetalhe(null);
      colecao.recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setProcessando(false);
    }
  }, [excluindo, toast, colecao]);

  const mudarStatus = useCallback(
    async (venda: Sale, status: SaleStatus) => {
      try {
        await db.vendas.atualizar(venda.id, { status });
        setDetalhe((atual) => (atual?.id === venda.id ? { ...atual, status } : atual));
        toast.sucesso('Situação da venda atualizada.');
        colecao.recarregar();
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Não foi possível atualizar.');
      }
    },
    [toast, colecao],
  );

  const colunas: Coluna<Sale>[] = useMemo(
    () => [
      {
        chave: 'codigo',
        titulo: 'Venda',
        ordenarPor: 'codigo',
        render: (v) => (
          <div className="pilha">
            <span className="forte mono">{v.codigo}</span>
            <span className="truncar" style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
              {nomeCliente.get(v.cliente_id) ?? '—'}
            </span>
          </div>
        ),
      },
      {
        chave: 'servico',
        titulo: 'Serviço',
        ocultarNoMobile: true,
        render: (v) => (v.servico_id ? nomeServico.get(v.servico_id) ?? '—' : '—'),
      },
      {
        chave: 'pagamento',
        titulo: 'Pagamento',
        ocultarNoMobile: true,
        render: (v) => (
          <span>
            {FORMA_PAGAMENTO[v.forma_pagamento]} · {v.parcelas}×
          </span>
        ),
      },
      {
        chave: 'valor',
        titulo: 'Valor',
        ordenarPor: 'valor_total',
        alinharDireita: true,
        render: (v) => (
          <div className="pilha" style={{ alignItems: 'flex-end' }}>
            <span className="forte">{brl(valorLiquido(v))}</span>
            {v.desconto > 0 && (
              <span style={{ fontSize: '.6875rem', color: 'var(--fg-dim)' }}>
                −{brl(v.desconto)} de desconto
              </span>
            )}
          </div>
        ),
      },
      { chave: 'status', titulo: 'Situação', ordenarPor: 'status', render: (v) => <StatusVenda status={v.status} /> },
      { chave: 'data', titulo: 'Data', ordenarPor: 'data', ocultarNoMobile: true, render: (v) => formatarData(v.data) },
      {
        chave: 'acoes',
        titulo: '',
        render: (v) =>
          pode('vendas', 'excluir') ? (
            <BotaoIcone
              icone="lixeira"
              rotulo={`Excluir venda ${v.codigo}`}
              onClick={(e) => {
                e.stopPropagation();
                setExcluindo(v);
              }}
            />
          ) : null,
      },
    ],
    [nomeCliente, nomeServico, pode],
  );

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Comercial</Eyebrow>
          <h1 className="pagina-titulo">Vendas</h1>
          <p className="pagina-descricao">
            Cada venda gera automaticamente as parcelas e os pagamentos correspondentes. Clique numa
            linha para ver o parcelamento.
          </p>
        </div>
        {pode('vendas', 'criar') && (
          <div className="pagina-acoes">
            <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
              Nova venda
            </Botao>
          </div>
        )}
      </header>

      {!gatewayConfigurado && (
        <Aviso tom="info" className="secao-aviso">
          Nenhum gateway de pagamento configurado. As vendas são registradas manualmente e a baixa
          das parcelas é feita à mão em <strong>Pagamentos</strong>. Ao conectar um gateway, o
          webhook passa a fazer isso sozinho.
        </Aviso>
      )}

      <div className="filtros">
        <CampoTexto
          className="busca"
          placeholder="Buscar por código ou observação"
          iconeEsquerda="busca"
          value={colecao.busca}
          onChange={(e) => colecao.setBusca(e.target.value)}
          aria-label="Buscar vendas"
        />
        <select
          className="select"
          value={String(colecao.filtros.status ?? 'todos')}
          onChange={(e) => colecao.definirFiltro('status', e.target.value)}
          aria-label="Filtrar por situação"
        >
          {opcoesDe(VENDA, 'Todas as situações').map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        {colecao.temFiltroAtivo && (
          <Botao variante="fantasma" tamanho="sm" icone="x" onClick={colecao.limparFiltros}>
            Limpar
          </Botao>
        )}
      </div>

      {colecao.erro && <Aviso tom="erro">{colecao.erro}</Aviso>}

      <DataTable
        colunas={colunas}
        itens={colecao.itens}
        chaveDe={(v) => v.id}
        carregando={colecao.carregando}
        aoClicar={setDetalhe}
        ordenarPor={colecao.ordenarPor}
        ordem={colecao.ordem}
        aoOrdenar={colecao.alternarOrdem}
        vazioTitulo="Nenhuma venda encontrada"
      />

      <Paginacao
        pagina={colecao.pagina}
        porPagina={colecao.porPagina}
        total={colecao.total}
        aoMudar={colecao.setPagina}
        rotuloItem="vendas"
      />

      {detalhe && (
        <DetalheVenda
          venda={detalhe}
          cliente={nomeCliente.get(detalhe.cliente_id) ?? '—'}
          servico={detalhe.servico_id ? nomeServico.get(detalhe.servico_id) ?? '—' : '—'}
          podeEditar={pode('vendas', 'editar')}
          aoFechar={() => setDetalhe(null)}
          aoMudarStatus={mudarStatus}
        />
      )}

      {criando && (
        <FormularioVenda
          clientes={clientes.dado}
          servicos={servicos.dado}
          responsavelId={usuario?.id ?? null}
          aoFechar={() => setCriando(false)}
          aoSalvar={() => {
            setCriando(false);
            colecao.recarregar();
          }}
        />
      )}

      <Confirmacao
        aberto={excluindo !== null}
        aoFechar={() => setExcluindo(null)}
        aoConfirmar={() => void excluir()}
        titulo="Excluir venda"
        mensagem={`A venda ${excluindo?.codigo} será removida junto com todas as suas parcelas e pagamentos. Esta ação não pode ser desfeita.`}
        textoConfirmar="Excluir tudo"
        perigo
        processando={processando}
      />
    </>
  );
}

/* ==========================================================================
   Detalhes — o parcelamento
   ========================================================================== */

function DetalheVenda({
  venda,
  cliente,
  servico,
  podeEditar,
  aoFechar,
  aoMudarStatus,
}: {
  venda: Sale;
  cliente: string;
  servico: string;
  podeEditar: boolean;
  aoFechar: () => void;
  aoMudarStatus: (v: Sale, s: SaleStatus) => void;
}) {
  const parcelas = useAsync(
    () => db.parcelas.todos({ filtros: { venda_id: venda.id }, ordenarPor: 'numero', ordem: 'asc' }),
    [venda.id],
    [] as Installment[],
  );

  const pagas = parcelas.dado.filter((p) => p.status === 'pago');
  const totalPago = pagas.reduce((s, p) => s + p.valor, 0);

  return (
    <Drawer aberto aoFechar={aoFechar} titulo={venda.codigo} descricao={cliente}>
      <div className="pilha" style={{ gap: 18 }}>
        {podeEditar && (
          <CampoSelect
            rotulo="Situação da venda"
            value={venda.status}
            opcoes={SALE_STATUS.map((s) => ({ valor: s, rotulo: VENDA[s].rotulo }))}
            onChange={(e) => aoMudarStatus(venda, e.target.value as SaleStatus)}
            ajuda="Ao dar baixa nas parcelas, a situação se atualiza sozinha."
          />
        )}

        <dl className="definicoes">
          <div className="definicao">
            <dt>Serviço</dt>
            <dd>{servico}</dd>
          </div>
          <div className="definicao">
            <dt>Valor cheio</dt>
            <dd>{brl(venda.valor_total)}</dd>
          </div>
          <div className="definicao">
            <dt>Desconto</dt>
            <dd>{venda.desconto > 0 ? `− ${brl(venda.desconto)}` : '—'}</dd>
          </div>
          <div className="definicao">
            <dt>Valor líquido</dt>
            <dd style={{ fontWeight: 700 }}>{brl(valorLiquido(venda))}</dd>
          </div>
          <div className="definicao">
            <dt>Recebido</dt>
            <dd>
              {brl(totalPago)}{' '}
              <span style={{ color: 'var(--fg-dim)' }}>
                ({pagas.length} de {parcelas.dado.length} parcelas)
              </span>
            </dd>
          </div>
          <div className="definicao">
            <dt>Forma</dt>
            <dd>
              {FORMA_PAGAMENTO[venda.forma_pagamento]} · {venda.parcelas}×
            </dd>
          </div>
          <div className="definicao">
            <dt>Data</dt>
            <dd>{formatarData(venda.data)}</dd>
          </div>
          <div className="definicao">
            <dt>Gateway</dt>
            <dd>
              {venda.gateway ? (
                <span className="mono">
                  {venda.gateway} · {venda.gateway_transacao_id ?? '—'}
                </span>
              ) : (
                <Badge tom="neutro">Registro manual</Badge>
              )}
            </dd>
          </div>
        </dl>

        <div>
          <div className="card-titulo" style={{ marginBottom: 8 }}>
            Parcelas
          </div>
          {parcelas.carregando ? (
            <div className="skeleton" style={{ height: 80 }} />
          ) : parcelas.dado.length === 0 ? (
            <p style={{ fontSize: '.8438rem', color: 'var(--fg-dim)' }}>
              Esta venda ainda é um orçamento — nenhuma parcela foi gerada.
            </p>
          ) : (
            <ul className="parcelas">
              {parcelas.dado.map((p) => (
                <li key={p.id}>
                  <span className="parcela-numero">
                    {p.numero}/{p.total_parcelas}
                  </span>
                  <div className="pilha" style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{brl(p.valor)}</span>
                    <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                      Vence {formatarData(p.vencimento)}
                      {p.pago_em ? ` · pago ${formatarData(p.pago_em)}` : ''}
                    </span>
                  </div>
                  <StatusPagamento status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {venda.observacoes && (
          <div>
            <div className="card-titulo" style={{ marginBottom: 6 }}>
              Observações
            </div>
            <p style={{ fontSize: '.8438rem', whiteSpace: 'pre-wrap' }}>{venda.observacoes}</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ==========================================================================
   Formulário
   ========================================================================== */

function FormularioVenda({
  clientes,
  servicos,
  responsavelId,
  aoFechar,
  aoSalvar,
}: {
  clientes: Client[];
  servicos: Service[];
  responsavelId: string | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    cliente_id: '',
    servico_id: '',
    valor_total: '',
    desconto: '',
    forma_pagamento: 'pix' as 'pix' | 'cartao',
    parcelas: '1',
    status: 'aguardando_pagamento' as SaleStatus,
    data: hoje,
    primeiro_vencimento: hoje,
    observacoes: '',
    criar_projeto: true,
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  const servicoEscolhido = servicos.find((s) => s.id === form.servico_id);
  const maxParcelas = servicoEscolhido?.max_parcelas ?? 12;

  const total = paraCentavos(form.valor_total || '0');
  const desconto = paraCentavos(form.desconto || '0');
  const liquido = Math.max(0, total - desconto);
  const quantidade = Math.max(1, Number.parseInt(form.parcelas, 10) || 1);
  const previsao = liquido > 0 ? dividirParcelas(liquido, quantidade) : [];

  function definir<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar() {
    const encontrados = coletarErros<Record<string, unknown>>({
      cliente_id: obrigatorio(form.cliente_id, 'O cliente'),
      valor_total: total <= 0 ? 'Informe o valor da venda.' : valorValido(total),
      desconto: desconto > total ? 'O desconto não pode ser maior que o valor.' : valorValido(desconto),
      parcelas: inteiroEntre(quantidade, 1, maxParcelas, 'O número de parcelas'),
    });

    if (temErro(encontrados)) {
      setErros(encontrados as Record<string, string>);
      return;
    }

    setErros({});
    setSalvando(true);

    try {
      const cliente = clientes.find((c) => c.id === form.cliente_id);
      await criarVendaCompleta({
        cliente_id: form.cliente_id,
        servico_id: form.servico_id || null,
        valor_total: total,
        desconto,
        forma_pagamento: form.forma_pagamento,
        parcelas: quantidade,
        status: form.status,
        data: form.data,
        primeiro_vencimento: form.primeiro_vencimento,
        responsavel_id: responsavelId,
        observacoes: limparTexto(form.observacoes, 2000) || null,
        criar_projeto: form.criar_projeto && form.status !== 'orcamento',
        nome_projeto: servicoEscolhido
          ? `${servicoEscolhido.nome} — ${cliente?.empresa ?? cliente?.nome ?? ''}`.trim()
          : undefined,
      });

      toast.sucesso('Venda registrada com as parcelas geradas.');
      aoSalvar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível registrar a venda.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      largo
      titulo="Nova venda"
      descricao="As parcelas e os pagamentos são criados junto, na hora de salvar."
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            Registrar venda
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoSelect
          className="col-inteira"
          rotulo="Cliente"
          value={form.cliente_id}
          erro={erros.cliente_id}
          obrigatorio
          opcoes={[
            { valor: '', rotulo: 'Selecione o cliente' },
            ...clientes.map((c) => ({ valor: c.id, rotulo: c.empresa ?? c.nome })),
          ]}
          onChange={(e) => definir('cliente_id', e.target.value)}
        />

        <CampoSelect
          rotulo="Serviço"
          value={form.servico_id}
          opcoes={[
            { valor: '', rotulo: 'Sem serviço vinculado' },
            ...servicos.filter((s) => s.ativo).map((s) => ({ valor: s.id, rotulo: s.nome })),
          ]}
          onChange={(e) => {
            const servico = servicos.find((s) => s.id === e.target.value);
            setForm((atual) => ({
              ...atual,
              servico_id: e.target.value,
              // Preenche o valor com o preço vigente, se ainda estiver vazio.
              valor_total:
                atual.valor_total === '' && servico
                  ? centavosParaCampo(precoVigente(servico))
                  : atual.valor_total,
            }));
          }}
        />

        <CampoSelect
          rotulo="Situação"
          value={form.status}
          opcoes={SALE_STATUS.map((s) => ({ valor: s, rotulo: VENDA[s].rotulo }))}
          onChange={(e) => definir('status', e.target.value as SaleStatus)}
          ajuda={form.status === 'orcamento' ? 'Orçamento não gera parcelas.' : undefined}
        />

        <CampoTexto
          rotulo="Valor da venda (R$)"
          value={form.valor_total}
          onChange={(e) => definir('valor_total', e.target.value)}
          erro={erros.valor_total}
          inputMode="decimal"
          placeholder="2500,00"
          obrigatorio
        />
        <CampoTexto
          rotulo="Desconto (R$)"
          value={form.desconto}
          onChange={(e) => definir('desconto', e.target.value)}
          erro={erros.desconto}
          inputMode="decimal"
          placeholder="0,00"
        />

        <CampoSelect
          rotulo="Forma de pagamento"
          value={form.forma_pagamento}
          opcoes={[
            { valor: 'pix', rotulo: 'PIX' },
            { valor: 'cartao', rotulo: 'Cartão' },
          ]}
          onChange={(e) => definir('forma_pagamento', e.target.value as 'pix' | 'cartao')}
        />
        <CampoTexto
          rotulo="Parcelas"
          type="number"
          min={1}
          max={maxParcelas}
          value={form.parcelas}
          onChange={(e) => definir('parcelas', e.target.value)}
          erro={erros.parcelas}
          ajuda={servicoEscolhido ? `Máximo de ${maxParcelas}× neste serviço.` : undefined}
        />

        <CampoTexto
          rotulo="Data da venda"
          type="date"
          value={form.data}
          onChange={(e) => definir('data', e.target.value)}
        />
        <CampoTexto
          rotulo="1º vencimento"
          type="date"
          value={form.primeiro_vencimento}
          onChange={(e) => definir('primeiro_vencimento', e.target.value)}
          ajuda="As demais caem de mês em mês."
        />

        {previsao.length > 0 && form.status !== 'orcamento' && (
          <div className="col-inteira previsao">
            <div className="card-titulo" style={{ marginBottom: 8 }}>
              Como ficará o parcelamento
            </div>
            <div className="previsao-lista">
              {previsao.map((valor, i) => (
                <span key={i} className="previsao-item">
                  <strong>{i + 1}ª</strong> {brl(valor)}
                </span>
              ))}
            </div>
            <p className="campo-ajuda" style={{ marginTop: 8 }}>
              Total de {brl(liquido)}
              {desconto > 0 ? ` (${brl(total)} − ${brl(desconto)} de desconto)` : ''}.
            </p>
          </div>
        )}

        {form.status !== 'orcamento' && (
          <div className="col-inteira">
            <Checkbox
              rotulo="Criar também o projeto para esta venda"
              checked={form.criar_projeto}
              onChange={(e) => definir('criar_projeto', e.target.checked)}
            />
          </div>
        )}

        <CampoTextarea
          className="col-inteira"
          rotulo="Observações"
          value={form.observacoes}
          onChange={(e) => definir('observacoes', e.target.value)}
          maxLength={2000}
        />
      </div>
    </Modal>
  );
}

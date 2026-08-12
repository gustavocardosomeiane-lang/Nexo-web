/**
 * Projetos — a execucao depois da venda.
 *
 * Duas visoes: quadro por etapa (onde esta cada projeto) e lista (comparar
 * prazos). O progresso e um numero editavel, mas cada etapa ja sugere o seu:
 * quem move para "Revisão" quase sempre quer 80%.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/data';
import { useColecao } from '@/hooks/useColecao';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { veValores } from '@/auth/permissions';
import { useToast } from '@/components/ui/Toast';
import { PROJECT_STATUS, type Client, type Project, type ProjectStatus, type Service } from '@/types';
import { brl, centavosParaCampo, diasAte, formatarData, paraCentavos } from '@/lib/format';
import { DataTable, type Coluna } from '@/components/ui/DataTable';
import { Paginacao } from '@/components/ui/Pagination';
import { Confirmacao, Modal } from '@/components/ui/Modal';
import {
  Aviso,
  Botao,
  BotaoIcone,
  CampoSelect,
  CampoTexto,
  CampoTextarea,
  Eyebrow,
  Progresso,
  Vazio,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { PROJETO, StatusProjeto, opcoesDe } from '@/components/dominio/StatusBadge';
import { coletarErros, inteiroEntre, limparTexto, obrigatorio, temErro } from '@/lib/validation';

/** Progresso sugerido por etapa. O usuário pode sobrescrever. */
const PROGRESSO_SUGERIDO: Record<ProjectStatus, number> = {
  aguardando_inicio: 0,
  briefing: 10,
  planejamento: 25,
  design: 45,
  desenvolvimento: 65,
  revisao: 80,
  ajustes: 90,
  finalizacao: 95,
  entregue: 100,
  concluido: 100,
};

type Visao = 'quadro' | 'lista';

export function Projetos() {
  const { usuario, pode } = useAuth();
  const toast = useToast();
  const [visao, setVisao] = useState<Visao>('quadro');
  const mostraValores = veValores(usuario?.role);

  const colecao = useColecao<Project>(db.projetos, {
    porPagina: 20,
    ordenarPor: 'prazo',
    ordem: 'asc',
    filtrosIniciais: { status: 'todos' },
  });

  const clientes = useAsync(() => db.clientes.todos(), [], [] as Client[]);
  const servicos = useAsync(() => db.servicos.todos(), [], [] as Service[]);
  const nomeCliente = useMemo(
    () => new Map(clientes.dado.map((c) => [c.id, c.empresa ?? c.nome])),
    [clientes.dado],
  );

  const todos = useAsync(
    () => (visao === 'quadro' ? db.projetos.todos({ busca: colecao.busca }) : Promise.resolve([])),
    [visao, colecao.busca, colecao.total],
    [] as Project[],
  );

  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Project | null>(null);
  const [excluindo, setExcluindo] = useState<Project | null>(null);
  const [processando, setProcessando] = useState(false);

  const recarregarTudo = useCallback(() => {
    colecao.recarregar();
    todos.recarregar();
  }, [colecao, todos]);

  const excluir = useCallback(async () => {
    if (!excluindo) return;
    setProcessando(true);
    try {
      await db.projetos.remover(excluindo.id);
      toast.sucesso('Projeto excluído.');
      setExcluindo(null);
      recarregarTudo();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setProcessando(false);
    }
  }, [excluindo, toast, recarregarTudo]);

  const colunas: Coluna<Project>[] = useMemo(
    () => [
      {
        chave: 'nome',
        titulo: 'Projeto',
        ordenarPor: 'nome',
        render: (p) => (
          <div className="pilha" style={{ minWidth: 0 }}>
            <span className="forte truncar">{p.nome}</span>
            <Link
              to={`/clientes/${p.cliente_id}`}
              className="truncar"
              style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {nomeCliente.get(p.cliente_id) ?? '—'}
            </Link>
          </div>
        ),
      },
      { chave: 'status', titulo: 'Etapa', ordenarPor: 'status', render: (p) => <StatusProjeto status={p.status} /> },
      {
        chave: 'progresso',
        titulo: 'Progresso',
        ordenarPor: 'progresso',
        largura: '160px',
        render: (p) => (
          <div style={{ minWidth: 120 }}>
            <Progresso valor={p.progresso} rotulo={`${p.nome}: ${p.progresso}%`} />
            <span style={{ fontSize: '.6875rem', color: 'var(--fg-dim)' }}>{p.progresso}%</span>
          </div>
        ),
      },
      {
        chave: 'prazo',
        titulo: 'Prazo',
        ordenarPor: 'prazo',
        render: (p) => <PrazoCelula prazo={p.prazo} concluido={p.progresso >= 100} />,
      },
      ...(mostraValores
        ? [
            {
              chave: 'valor',
              titulo: 'Valor',
              ordenarPor: 'valor' as const,
              alinharDireita: true,
              ocultarNoMobile: true,
              render: (p: Project) => brl(p.valor),
            },
          ]
        : []),
      {
        chave: 'acoes',
        titulo: '',
        render: (p) => (
          <div className="linha" style={{ gap: 2, justifyContent: 'flex-end' }}>
            {pode('projetos', 'editar') && (
              <BotaoIcone
                icone="editar"
                rotulo={`Editar ${p.nome}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditando(p);
                }}
              />
            )}
            {pode('projetos', 'excluir') && (
              <BotaoIcone
                icone="lixeira"
                rotulo={`Excluir ${p.nome}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExcluindo(p);
                }}
              />
            )}
          </div>
        ),
      },
    ],
    [nomeCliente, pode, mostraValores],
  );

  const porEtapa = useMemo(() => {
    const mapa = new Map<ProjectStatus, Project[]>();
    for (const s of PROJECT_STATUS) mapa.set(s, []);
    for (const p of todos.dado) mapa.get(p.status)?.push(p);
    return mapa;
  }, [todos.dado]);

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Entrega</Eyebrow>
          <h1 className="pagina-titulo">Projetos</h1>
          <p className="pagina-descricao">
            Do briefing à entrega. Um projeto nasce automaticamente quando você registra uma venda,
            mas também pode ser criado à parte.
          </p>
        </div>
        <div className="pagina-acoes">
          <div className="chips" role="group" aria-label="Modo de visualização">
            <button type="button" className="chip" aria-pressed={visao === 'quadro'} onClick={() => setVisao('quadro')}>
              <Icon nome="colunas" tamanho={14} /> Quadro
            </button>
            <button type="button" className="chip" aria-pressed={visao === 'lista'} onClick={() => setVisao('lista')}>
              <Icon nome="lista" tamanho={14} /> Lista
            </button>
          </div>
          {pode('projetos', 'criar') && (
            <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
              Novo projeto
            </Botao>
          )}
        </div>
      </header>

      <div className="filtros">
        <CampoTexto
          className="busca"
          placeholder="Buscar projeto"
          iconeEsquerda="busca"
          value={colecao.busca}
          onChange={(e) => colecao.setBusca(e.target.value)}
          aria-label="Buscar projetos"
        />
        {visao === 'lista' && (
          <select
            className="select"
            value={String(colecao.filtros.status ?? 'todos')}
            onChange={(e) => colecao.definirFiltro('status', e.target.value)}
            aria-label="Filtrar por etapa"
          >
            {opcoesDe(PROJETO, 'Todas as etapas').map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        )}
      </div>

      {colecao.erro && <Aviso tom="erro">{colecao.erro}</Aviso>}

      {visao === 'lista' ? (
        <>
          <DataTable
            colunas={colunas}
            itens={colecao.itens}
            chaveDe={(p) => p.id}
            carregando={colecao.carregando}
            aoClicar={pode('projetos', 'editar') ? setEditando : undefined}
            ordenarPor={colecao.ordenarPor}
            ordem={colecao.ordem}
            aoOrdenar={colecao.alternarOrdem}
            vazioTitulo="Nenhum projeto encontrado"
          />
          <Paginacao
            pagina={colecao.pagina}
            porPagina={colecao.porPagina}
            total={colecao.total}
            aoMudar={colecao.setPagina}
            rotuloItem="projetos"
          />
        </>
      ) : todos.carregando ? (
        <div className="kanban">
          {PROJECT_STATUS.slice(0, 5).map((s) => (
            <div key={s} className="kanban-coluna">
              <div className="kanban-cabeca">
                <span className="kanban-titulo">{PROJETO[s].rotulo}</span>
              </div>
              <div className="kanban-lista">
                <div className="skeleton" style={{ height: 84 }} />
              </div>
            </div>
          ))}
        </div>
      ) : todos.dado.length === 0 ? (
        <div className="card">
          <Vazio icone="projetos" titulo="Nenhum projeto" descricao="Registre uma venda para gerar o primeiro." />
        </div>
      ) : (
        <div className="kanban">
          {PROJECT_STATUS.map((status) => {
            const itens = porEtapa.get(status) ?? [];
            return (
              <div key={status} className="kanban-coluna">
                <div className="kanban-cabeca">
                  <span className="kanban-titulo">{PROJETO[status].rotulo}</span>
                  <span className="kanban-contador">{itens.length}</span>
                </div>
                <div className="kanban-lista">
                  {itens.length === 0 ? (
                    <p className="kanban-vazio">Vazio</p>
                  ) : (
                    itens.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="kanban-card"
                        onClick={() => pode('projetos', 'editar') && setEditando(p)}
                      >
                        <div className="kanban-card-nome truncar">{p.nome}</div>
                        <div className="kanban-card-empresa truncar">
                          {nomeCliente.get(p.cliente_id) ?? '—'}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <Progresso valor={p.progresso} rotulo={`${p.nome}: ${p.progresso}%`} />
                        </div>
                        <div className="kanban-card-rodape">
                          <PrazoCelula prazo={p.prazo} concluido={p.progresso >= 100} compacto />
                          <span className="kanban-card-valor">{p.progresso}%</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(criando || editando) && (
        <FormularioProjeto
          projeto={editando}
          clientes={clientes.dado}
          servicos={servicos.dado}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={() => {
            setCriando(false);
            setEditando(null);
            recarregarTudo();
          }}
        />
      )}

      <Confirmacao
        aberto={excluindo !== null}
        aoFechar={() => setExcluindo(null)}
        aoConfirmar={() => void excluir()}
        titulo="Excluir projeto"
        mensagem={`“${excluindo?.nome}” será removido. A venda correspondente continua registrada.`}
        textoConfirmar="Excluir"
        perigo
        processando={processando}
      />
    </>
  );
}

function PrazoCelula({
  prazo,
  concluido,
  compacto = false,
}: {
  prazo: string | null;
  concluido: boolean;
  compacto?: boolean;
}) {
  if (!prazo) return <span style={{ color: 'var(--fg-dim)' }}>Sem prazo</span>;

  const dias = diasAte(prazo);
  let contexto: string | null = null;
  let tom = 'var(--fg-dim)';

  if (!concluido && dias !== null) {
    if (dias < 0) {
      contexto = `${Math.abs(dias)}d atrasado`;
      tom = '#FF6070';
    } else if (dias === 0) {
      contexto = 'entrega hoje';
      tom = '#FBBF24';
    } else if (dias <= 5) {
      contexto = `em ${dias}d`;
      tom = '#FBBF24';
    }
  }

  if (compacto) {
    return <span style={{ color: contexto ? tom : 'var(--fg-dim)' }}>{contexto ?? formatarData(prazo)}</span>;
  }

  return (
    <div className="pilha">
      <span>{formatarData(prazo)}</span>
      {contexto && <span style={{ fontSize: '.6875rem', color: tom }}>{contexto}</span>}
    </div>
  );
}

function FormularioProjeto({
  projeto,
  clientes,
  servicos,
  aoFechar,
  aoSalvar,
}: {
  projeto: Project | null;
  clientes: Client[];
  servicos: Service[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    nome: projeto?.nome ?? '',
    cliente_id: projeto?.cliente_id ?? '',
    servico_id: projeto?.servico_id ?? '',
    valor: projeto ? centavosParaCampo(projeto.valor) : '',
    data_inicio: projeto?.data_inicio ?? new Date().toISOString().slice(0, 10),
    prazo: projeto?.prazo ?? '',
    status: (projeto?.status ?? 'aguardando_inicio') as ProjectStatus,
    progresso: String(projeto?.progresso ?? 0),
    observacoes: projeto?.observacoes ?? '',
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const progresso = Number.parseInt(form.progresso, 10) || 0;
    const encontrados = coletarErros<Record<string, unknown>>({
      nome: obrigatorio(form.nome, 'O nome'),
      cliente_id: obrigatorio(form.cliente_id, 'O cliente'),
      progresso: inteiroEntre(progresso, 0, 100, 'O progresso'),
    });

    if (temErro(encontrados)) {
      setErros(encontrados as Record<string, string>);
      return;
    }

    setErros({});
    setSalvando(true);

    const dados = {
      nome: limparTexto(form.nome, 160),
      cliente_id: form.cliente_id,
      servico_id: form.servico_id || null,
      valor: paraCentavos(form.valor || '0'),
      data_inicio: form.data_inicio || null,
      prazo: form.prazo || null,
      status: form.status,
      progresso,
      observacoes: limparTexto(form.observacoes, 2000) || null,
    };

    try {
      if (projeto) {
        await db.projetos.atualizar(projeto.id, dados);
        toast.sucesso('Projeto atualizado.');
      } else {
        await db.projetos.criar({ ...dados, venda_id: null, responsavel_id: null });
        toast.sucesso('Projeto criado.');
      }
      aoSalvar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      largo
      titulo={projeto ? 'Editar projeto' : 'Novo projeto'}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            {projeto ? 'Salvar alterações' : 'Criar projeto'}
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoTexto
          className="col-inteira"
          rotulo="Nome do projeto"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          erro={erros.nome}
          maxLength={160}
          obrigatorio
          autoFocus
        />
        <CampoSelect
          rotulo="Cliente"
          value={form.cliente_id}
          erro={erros.cliente_id}
          obrigatorio
          opcoes={[
            { valor: '', rotulo: 'Selecione' },
            ...clientes.map((c) => ({ valor: c.id, rotulo: c.empresa ?? c.nome })),
          ]}
          onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}
        />
        <CampoSelect
          rotulo="Serviço"
          value={form.servico_id}
          opcoes={[{ valor: '', rotulo: 'Nenhum' }, ...servicos.map((s) => ({ valor: s.id, rotulo: s.nome }))]}
          onChange={(e) => setForm({ ...form, servico_id: e.target.value })}
        />
        <CampoSelect
          rotulo="Etapa"
          value={form.status}
          opcoes={PROJECT_STATUS.map((s) => ({ valor: s, rotulo: PROJETO[s].rotulo }))}
          onChange={(e) => {
            const status = e.target.value as ProjectStatus;
            setForm((atual) => ({ ...atual, status, progresso: String(PROGRESSO_SUGERIDO[status]) }));
          }}
          ajuda="Trocar a etapa sugere um progresso; você pode ajustar."
        />
        <CampoTexto
          rotulo="Progresso (%)"
          type="number"
          min={0}
          max={100}
          value={form.progresso}
          onChange={(e) => setForm({ ...form, progresso: e.target.value })}
          erro={erros.progresso}
        />
        <CampoTexto
          rotulo="Início"
          type="date"
          value={form.data_inicio ?? ''}
          onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
        />
        <CampoTexto
          rotulo="Prazo de entrega"
          type="date"
          value={form.prazo ?? ''}
          onChange={(e) => setForm({ ...form, prazo: e.target.value })}
        />
        <CampoTexto
          rotulo="Valor (R$)"
          value={form.valor}
          onChange={(e) => setForm({ ...form, valor: e.target.value })}
          inputMode="decimal"
        />
        <CampoTextarea
          className="col-inteira"
          rotulo="Observações"
          value={form.observacoes}
          onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
          maxLength={2000}
        />
      </div>
    </Modal>
  );
}

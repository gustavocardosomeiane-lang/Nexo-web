/**
 * CRM de leads.
 *
 * Tres visoes sobre os mesmos dados: tabela (comparar), Kanban (mover no
 * funil) e cards (ler rapido no celular).
 *
 * O Kanban aceita arrastar e soltar, mas mover etapa NUNCA depende so disso:
 * o mesmo comando existe como <select> dentro dos detalhes do lead. Arrastar
 * e soltar nao funciona com teclado nem com leitor de tela, entao seria a
 * unica forma de fazer algo essencial — o que reprovaria em acessibilidade.
 */

import { useCallback, useMemo, useState } from 'react';
import { db } from '@/data';
import { useColecao } from '@/hooks/useColecao';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { LEAD_STATUS, type Lead, type LeadStatus, type Service, type Tag } from '@/types';
import { brl, formatarData, formatarTelefone, tempoRelativo, whatsappLink } from '@/lib/format';
import { DataTable, type Coluna } from '@/components/ui/DataTable';
import { Paginacao } from '@/components/ui/Pagination';
import { Confirmacao, Drawer, Modal } from '@/components/ui/Modal';
import {
  Aviso,
  Avatar,
  Botao,
  BotaoIcone,
  CampoSelect,
  CampoTexto,
  CampoTextarea,
  Eyebrow,
  Switch,
  Vazio,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import {
  LEAD,
  ORIGEM_LEAD,
  StatusLead,
  opcoesDe,
  opcoesSimples,
} from '@/components/dominio/StatusBadge';
import { coletarErros, emailValido, limparTexto, obrigatorio, telefoneValido, temErro } from '@/lib/validation';
import { paraCentavos, centavosParaCampo } from '@/lib/format';

type Visao = 'tabela' | 'kanban' | 'cards';

const VAZIO_FORM = {
  nome: '',
  empresa: '',
  telefone: '',
  email: '',
  origem: 'site',
  campanha: '',
  status: 'novo' as LeadStatus,
  valor_potencial: '',
  servico_interesse_id: '',
  proxima_acao: '',
  proxima_acao_em: '',
  observacoes: '',
  /** Listas de prospecção às quais o lead pertence. */
  tags: [] as string[],
  /** Trava permanente contra disparo. Ver campanhas.ts. */
  nao_contatar: false,
};

type FormLead = typeof VAZIO_FORM;

export function Leads() {
  const { pode } = useAuth();
  const toast = useToast();
  const [visao, setVisao] = useState<Visao>('tabela');

  const colecao = useColecao<Lead>(db.leads, {
    porPagina: 20,
    ordenarPor: 'data_entrada',
    filtrosIniciais: { status: 'todos', origem: 'todos' },
  });

  const servicos = useAsync(() => db.servicos.todos(), [], [] as Service[]);
  const tags = useAsync(() => db.tags.todos(), [], [] as Tag[]);
  const nomeServico = useMemo(
    () => new Map(servicos.dado.map((s) => [s.id, s.nome])),
    [servicos.dado],
  );

  /* O Kanban precisa de todos os leads, não da página atual. */
  const kanban = useAsync(
    () =>
      visao === 'kanban'
        ? db.leads.todos({ busca: colecao.busca, filtros: { origem: colecao.filtros.origem } })
        : Promise.resolve([]),
    [visao, colecao.busca, colecao.filtros.origem, colecao.total],
    [] as Lead[],
  );

  const [editando, setEditando] = useState<Lead | null>(null);
  const [criando, setCriando] = useState(false);
  const [detalhe, setDetalhe] = useState<Lead | null>(null);
  const [excluindo, setExcluindo] = useState<Lead | null>(null);
  const [processando, setProcessando] = useState(false);

  const recarregarTudo = useCallback(() => {
    colecao.recarregar();
    kanban.recarregar();
  }, [colecao, kanban]);

  const moverEtapa = useCallback(
    async (lead: Lead, status: LeadStatus) => {
      if (lead.status === status) return;
      try {
        await db.leads.atualizar(lead.id, {
          status,
          ultima_interacao: new Date().toISOString(),
        });
        toast.sucesso(`${lead.nome} movido para “${LEAD[status].rotulo}”.`);
        setDetalhe((atual) => (atual?.id === lead.id ? { ...atual, status } : atual));
        recarregarTudo();
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Não foi possível mover o lead.');
      }
    },
    [toast, recarregarTudo],
  );

  const excluir = useCallback(async () => {
    if (!excluindo) return;
    setProcessando(true);
    try {
      await db.leads.remover(excluindo.id);
      toast.sucesso('Lead excluído.');
      setExcluindo(null);
      setDetalhe(null);
      recarregarTudo();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setProcessando(false);
    }
  }, [excluindo, toast, recarregarTudo]);

  const colunas: Coluna<Lead>[] = useMemo(
    () => [
      {
        chave: 'nome',
        titulo: 'Lead',
        ordenarPor: 'nome',
        render: (l) => (
          <div className="linha" style={{ gap: 10 }}>
            <Avatar nome={l.nome} tamanho="sm" />
            <div className="pilha" style={{ minWidth: 0 }}>
              <span className="forte truncar">{l.nome}</span>
              <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }} className="truncar">
                {l.empresa ?? 'Sem empresa'}
              </span>
            </div>
          </div>
        ),
      },
      {
        chave: 'contato',
        titulo: 'Contato',
        ocultarNoMobile: true,
        render: (l) => (
          <div className="pilha">
            <span>{formatarTelefone(l.telefone)}</span>
            <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }} className="truncar">
              {l.email ?? '—'}
            </span>
          </div>
        ),
      },
      {
        chave: 'origem',
        titulo: 'Origem',
        ordenarPor: 'origem',
        ocultarNoMobile: true,
        render: (l) => (
          <div className="pilha">
            <span>{ORIGEM_LEAD[l.origem] ?? l.origem}</span>
            {l.campanha && (
              <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }} className="truncar">
                {l.campanha}
              </span>
            )}
          </div>
        ),
      },
      {
        chave: 'status',
        titulo: 'Etapa',
        ordenarPor: 'status',
        render: (l) => <StatusLead status={l.status} />,
      },
      {
        chave: 'valor',
        titulo: 'Potencial',
        ordenarPor: 'valor_potencial',
        alinharDireita: true,
        render: (l) => (l.valor_potencial ? brl(l.valor_potencial) : '—'),
      },
      {
        chave: 'entrada',
        titulo: 'Entrada',
        ordenarPor: 'data_entrada',
        ocultarNoMobile: true,
        render: (l) => formatarData(l.data_entrada),
      },
      {
        chave: 'acoes',
        titulo: '',
        render: (l) => (
          <div className="linha" style={{ gap: 2, justifyContent: 'flex-end' }}>
            {l.whatsapp && (
              <a
                className="btn-icone"
                href={whatsappLink(l.whatsapp, `Olá, ${l.nome.split(' ')[0]}!`) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir WhatsApp de ${l.nome}`}
                title="WhatsApp"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon nome="whatsapp" />
              </a>
            )}
            {pode('leads', 'editar') && (
              <BotaoIcone
                icone="editar"
                rotulo={`Editar ${l.nome}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditando(l);
                }}
              />
            )}
            {pode('leads', 'excluir') && (
              <BotaoIcone
                icone="lixeira"
                rotulo={`Excluir ${l.nome}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExcluindo(l);
                }}
              />
            )}
          </div>
        ),
      },
    ],
    [pode],
  );

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>CRM</Eyebrow>
          <h1 className="pagina-titulo">Leads</h1>
          <p className="pagina-descricao">
            Todo contato que chega entra aqui e caminha pelas nove etapas do funil até virar
            cliente — ou ser marcado como perdido.
          </p>
        </div>
        <div className="pagina-acoes">
          <div className="chips" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              className="chip"
              aria-pressed={visao === 'tabela'}
              onClick={() => setVisao('tabela')}
            >
              <Icon nome="lista" tamanho={14} /> Tabela
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={visao === 'kanban'}
              onClick={() => setVisao('kanban')}
            >
              <Icon nome="colunas" tamanho={14} /> Kanban
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={visao === 'cards'}
              onClick={() => setVisao('cards')}
            >
              <Icon nome="grade" tamanho={14} /> Cards
            </button>
          </div>
          {pode('leads', 'criar') && (
            <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
              Novo lead
            </Botao>
          )}
        </div>
      </header>

      <div className="filtros">
        <CampoTexto
          className="busca"
          placeholder="Buscar por nome, empresa, e-mail ou telefone"
          iconeEsquerda="busca"
          value={colecao.busca}
          onChange={(e) => colecao.setBusca(e.target.value)}
          aria-label="Buscar leads"
        />
        {visao !== 'kanban' && (
          <select
            className="select"
            value={String(colecao.filtros.status ?? 'todos')}
            onChange={(e) => colecao.definirFiltro('status', e.target.value)}
            aria-label="Filtrar por etapa"
          >
            {opcoesDe(LEAD, 'Todas as etapas').map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        )}
        <select
          className="select"
          value={String(colecao.filtros.origem ?? 'todos')}
          onChange={(e) => colecao.definirFiltro('origem', e.target.value)}
          aria-label="Filtrar por origem"
        >
          {opcoesSimples(ORIGEM_LEAD, 'Todas as origens').map((o) => (
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

      {visao === 'tabela' && (
        <>
          <DataTable
            colunas={colunas}
            itens={colecao.itens}
            chaveDe={(l) => l.id}
            carregando={colecao.carregando}
            aoClicar={setDetalhe}
            ordenarPor={colecao.ordenarPor}
            ordem={colecao.ordem}
            aoOrdenar={colecao.alternarOrdem}
            vazioTitulo="Nenhum lead encontrado"
            vazioDescricao="Ajuste a busca e os filtros, ou cadastre o primeiro lead."
            vazioAcao={
              pode('leads', 'criar') ? (
                <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
                  Novo lead
                </Botao>
              ) : undefined
            }
          />
          <Paginacao
            pagina={colecao.pagina}
            porPagina={colecao.porPagina}
            total={colecao.total}
            aoMudar={colecao.setPagina}
            rotuloItem="leads"
          />
        </>
      )}

      {visao === 'kanban' && (
        <QuadroKanban
          leads={kanban.dado}
          carregando={kanban.carregando}
          podeMover={pode('leads', 'editar')}
          aoAbrir={setDetalhe}
          aoMover={moverEtapa}
          nomeServico={nomeServico}
        />
      )}

      {visao === 'cards' && (
        <>
          {colecao.carregando ? (
            <div className="grade-cards">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card card-p">
                  <div className="skeleton" style={{ height: 76 }} />
                </div>
              ))}
            </div>
          ) : colecao.itens.length === 0 ? (
            <div className="card">
              <Vazio icone="busca" titulo="Nenhum lead encontrado" />
            </div>
          ) : (
            <div className="grade-cards">
              {colecao.itens.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="card card-p card-hover lead-card"
                  onClick={() => setDetalhe(l)}
                >
                  <div className="linha" style={{ gap: 10 }}>
                    <Avatar nome={l.nome} tamanho="sm" />
                    <div className="pilha" style={{ minWidth: 0, flex: 1 }}>
                      <span className="truncar" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                        {l.nome}
                      </span>
                      <span className="truncar" style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                        {l.empresa ?? 'Sem empresa'}
                      </span>
                    </div>
                  </div>
                  <div className="linha-entre" style={{ marginTop: 12 }}>
                    <StatusLead status={l.status} />
                    <span style={{ fontWeight: 700, color: 'var(--fg)' }}>
                      {l.valor_potencial ? brl(l.valor_potencial) : '—'}
                    </span>
                  </div>
                  <div
                    className="linha-entre"
                    style={{ marginTop: 10, fontSize: '.75rem', color: 'var(--fg-dim)' }}
                  >
                    <span>{ORIGEM_LEAD[l.origem] ?? l.origem}</span>
                    <span>{tempoRelativo(l.ultima_interacao)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <Paginacao
            pagina={colecao.pagina}
            porPagina={colecao.porPagina}
            total={colecao.total}
            aoMudar={colecao.setPagina}
            rotuloItem="leads"
          />
        </>
      )}

      {/* ---- Detalhes ---- */}
      <DetalheLead
        lead={detalhe}
        nomeServico={nomeServico}
        podeEditar={pode('leads', 'editar')}
        podeExcluir={pode('leads', 'excluir')}
        aoFechar={() => setDetalhe(null)}
        aoEditar={(l) => {
          setDetalhe(null);
          setEditando(l);
        }}
        aoExcluir={(l) => setExcluindo(l)}
        aoMover={moverEtapa}
      />

      {/* ---- Formulário ---- */}
      {(criando || editando) && (
        <FormularioLead
          lead={editando}
          servicos={servicos.dado}
          tags={tags.dado}
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
        titulo="Excluir lead"
        mensagem={`O lead “${excluindo?.nome}” será removido definitivamente. Esta ação não pode ser desfeita.`}
        textoConfirmar="Excluir"
        perigo
        processando={processando}
      />
    </>
  );
}

/* ==========================================================================
   Kanban
   ========================================================================== */

function QuadroKanban({
  leads,
  carregando,
  podeMover,
  aoAbrir,
  aoMover,
  nomeServico,
}: {
  leads: Lead[];
  carregando: boolean;
  podeMover: boolean;
  aoAbrir: (l: Lead) => void;
  aoMover: (l: Lead, s: LeadStatus) => void;
  nomeServico: Map<string, string>;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<LeadStatus | null>(null);

  const porEtapa = useMemo(() => {
    const mapa = new Map<LeadStatus, Lead[]>();
    for (const status of LEAD_STATUS) mapa.set(status, []);
    for (const lead of leads) mapa.get(lead.status)?.push(lead);
    return mapa;
  }, [leads]);

  if (carregando) {
    return (
      <div className="kanban">
        {LEAD_STATUS.slice(0, 5).map((s) => (
          <div key={s} className="kanban-coluna">
            <div className="kanban-cabeca">
              <span className="kanban-titulo">{LEAD[s].rotulo}</span>
            </div>
            <div className="kanban-lista">
              <div className="skeleton" style={{ height: 72 }} />
              <div className="skeleton" style={{ height: 72 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="kanban">
      {LEAD_STATUS.map((status) => {
        const itens = porEtapa.get(status) ?? [];
        const total = itens.reduce((s, l) => s + (l.valor_potencial ?? 0), 0);

        return (
          <div
            key={status}
            className={`kanban-coluna ${alvo === status ? 'recebendo' : ''}`}
            onDragOver={(e) => {
              if (!podeMover) return;
              e.preventDefault();
              setAlvo(status);
            }}
            onDragLeave={() => setAlvo((a) => (a === status ? null : a))}
            onDrop={(e) => {
              e.preventDefault();
              setAlvo(null);
              const id = e.dataTransfer.getData('text/plain');
              const lead = leads.find((l) => l.id === id);
              if (lead) aoMover(lead, status);
            }}
          >
            <div className="kanban-cabeca">
              <span className="kanban-titulo">{LEAD[status].rotulo}</span>
              <span className="kanban-contador">{itens.length}</span>
            </div>

            {total > 0 && (
              <div className="kanban-total">
                {brl(total)} <span>em potencial</span>
              </div>
            )}

            <div className="kanban-lista">
              {itens.length === 0 ? (
                <p className="kanban-vazio">Nenhum lead nesta etapa.</p>
              ) : (
                itens.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`kanban-card ${arrastando === l.id ? 'arrastando' : ''}`}
                    draggable={podeMover}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', l.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setArrastando(l.id);
                    }}
                    onDragEnd={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    onClick={() => aoAbrir(l)}
                  >
                    <div className="kanban-card-nome truncar">{l.nome}</div>
                    <div className="kanban-card-empresa truncar">{l.empresa ?? 'Sem empresa'}</div>
                    {l.servico_interesse_id && (
                      <div className="kanban-card-servico truncar">
                        {nomeServico.get(l.servico_interesse_id) ?? '—'}
                      </div>
                    )}
                    <div className="kanban-card-rodape">
                      <span>{ORIGEM_LEAD[l.origem] ?? l.origem}</span>
                      <span className="kanban-card-valor">
                        {l.valor_potencial ? brl(l.valor_potencial) : '—'}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Detalhes
   ========================================================================== */

function DetalheLead({
  lead,
  nomeServico,
  podeEditar,
  podeExcluir,
  aoFechar,
  aoEditar,
  aoExcluir,
  aoMover,
}: {
  lead: Lead | null;
  nomeServico: Map<string, string>;
  podeEditar: boolean;
  podeExcluir: boolean;
  aoFechar: () => void;
  aoEditar: (l: Lead) => void;
  aoExcluir: (l: Lead) => void;
  aoMover: (l: Lead, s: LeadStatus) => void;
}) {
  if (!lead) return null;

  const wa = whatsappLink(lead.whatsapp, `Olá, ${lead.nome.split(' ')[0]}!`);

  return (
    <Drawer
      aberto
      aoFechar={aoFechar}
      titulo={lead.nome}
      descricao={lead.empresa ?? 'Sem empresa'}
      rodape={
        <>
          {podeExcluir && (
            <Botao variante="perigo" icone="lixeira" onClick={() => aoExcluir(lead)}>
              Excluir
            </Botao>
          )}
          {podeEditar && (
            <Botao variante="primario" icone="editar" onClick={() => aoEditar(lead)}>
              Editar
            </Botao>
          )}
        </>
      }
    >
      <div className="pilha" style={{ gap: 18 }}>
        {podeEditar && (
          <CampoSelect
            rotulo="Etapa do funil"
            value={lead.status}
            opcoes={LEAD_STATUS.map((s) => ({ valor: s, rotulo: LEAD[s].rotulo }))}
            onChange={(e) => aoMover(lead, e.target.value as LeadStatus)}
            ajuda="Mudar aqui move o lead no Kanban."
          />
        )}

        {wa && (
          <a className="btn btn-secundario btn-bloco" href={wa} target="_blank" rel="noopener noreferrer">
            <Icon nome="whatsapp" />
            Conversar no WhatsApp
          </a>
        )}

        <dl className="definicoes">
          <div className="definicao">
            <dt>Etapa</dt>
            <dd>
              <StatusLead status={lead.status} />
            </dd>
          </div>
          <div className="definicao">
            <dt>Telefone</dt>
            <dd>{formatarTelefone(lead.telefone)}</dd>
          </div>
          <div className="definicao">
            <dt>E-mail</dt>
            <dd>{lead.email ?? '—'}</dd>
          </div>
          <div className="definicao">
            <dt>Origem</dt>
            <dd>{ORIGEM_LEAD[lead.origem] ?? lead.origem}</dd>
          </div>
          <div className="definicao">
            <dt>Campanha</dt>
            <dd>{lead.campanha ?? '—'}</dd>
          </div>
          <div className="definicao">
            <dt>Serviço de interesse</dt>
            <dd>{lead.servico_interesse_id ? nomeServico.get(lead.servico_interesse_id) ?? '—' : '—'}</dd>
          </div>
          <div className="definicao">
            <dt>Valor potencial</dt>
            <dd>{lead.valor_potencial ? brl(lead.valor_potencial) : '—'}</dd>
          </div>
          <div className="definicao">
            <dt>Entrada</dt>
            <dd>{formatarData(lead.data_entrada)}</dd>
          </div>
          <div className="definicao">
            <dt>Última interação</dt>
            <dd>{tempoRelativo(lead.ultima_interacao)}</dd>
          </div>
          <div className="definicao">
            <dt>Próxima ação</dt>
            <dd>
              {lead.proxima_acao ?? '—'}
              {lead.proxima_acao_em && (
                <span style={{ color: 'var(--fg-dim)' }}> · {formatarData(lead.proxima_acao_em)}</span>
              )}
            </dd>
          </div>
        </dl>

        {lead.observacoes && (
          <div>
            <div className="card-titulo" style={{ marginBottom: 6 }}>
              Observações
            </div>
            <p style={{ fontSize: '.8438rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {lead.observacoes}
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ==========================================================================
   Formulário
   ========================================================================== */

function FormularioLead({
  lead,
  servicos,
  tags,
  aoFechar,
  aoSalvar,
}: {
  lead: Lead | null;
  servicos: Service[];
  tags: Tag[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormLead>(() =>
    lead
      ? {
          nome: lead.nome,
          empresa: lead.empresa ?? '',
          telefone: lead.telefone ?? '',
          email: lead.email ?? '',
          origem: lead.origem,
          campanha: lead.campanha ?? '',
          status: lead.status,
          valor_potencial: lead.valor_potencial ? centavosParaCampo(lead.valor_potencial) : '',
          servico_interesse_id: lead.servico_interesse_id ?? '',
          proxima_acao: lead.proxima_acao ?? '',
          proxima_acao_em: lead.proxima_acao_em ?? '',
          observacoes: lead.observacoes ?? '',
          tags: lead.tags ?? [],
          nao_contatar: lead.nao_contatar ?? false,
        }
      : VAZIO_FORM,
  );
  const [erros, setErros] = useState<Partial<Record<keyof FormLead, string>>>({});
  const [salvando, setSalvando] = useState(false);

  // Genérico no campo para o tipo do valor acompanhar: `tags` é array e
  // `nao_contatar` é booleano, não dá para fixar em string.
  const definir = <K extends keyof FormLead>(campo: K, valor: FormLead[K]) =>
    setForm((atual) => ({ ...atual, [campo]: valor }));

  async function salvar() {
    const encontrados = coletarErros<FormLead>({
      nome: obrigatorio(form.nome, 'O nome'),
      telefone: telefoneValido(form.telefone, true),
      email: form.email.trim() ? emailValido(form.email) : null,
    });

    if (temErro(encontrados)) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setSalvando(true);

    const telefone = form.telefone.replace(/\D/g, '') || null;
    const dados = {
      nome: limparTexto(form.nome, 120),
      empresa: limparTexto(form.empresa, 120) || null,
      telefone,
      whatsapp: telefone,
      email: limparTexto(form.email, 120) || null,
      origem: form.origem as Lead['origem'],
      campanha: limparTexto(form.campanha, 120) || null,
      status: form.status,
      observacoes: limparTexto(form.observacoes, 2000) || null,
      valor_potencial: form.valor_potencial ? paraCentavos(form.valor_potencial) : null,
      servico_interesse_id: form.servico_interesse_id || null,
      proxima_acao: limparTexto(form.proxima_acao, 160) || null,
      proxima_acao_em: form.proxima_acao_em || null,
      tags: form.tags,
      nao_contatar: form.nao_contatar,
    };

    try {
      if (lead) {
        await db.leads.atualizar(lead.id, dados);
        toast.sucesso('Lead atualizado.');
      } else {
        await db.leads.criar({
          ...dados,
          data_entrada: new Date().toISOString().slice(0, 10),
          responsavel_id: null,
          ultima_interacao: new Date().toISOString(),
          cliente_id: null,
          // Cadastro manual: nenhum campo de prospecção automática se aplica.
          cidade: null,
          endereco: null,
          nicho: null,
          site: null,
          place_id: null,
          score_oportunidade: null,
          motivo_score: null,
          analise_site: null,
          analisado_em: null,
        });
        toast.sucesso('Lead cadastrado.');
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
      titulo={lead ? 'Editar lead' : 'Novo lead'}
      descricao={lead ? undefined : 'Só o nome é obrigatório. O resto pode ser completado depois.'}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            {lead ? 'Salvar alterações' : 'Cadastrar lead'}
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoTexto
          className="col-inteira"
          rotulo="Nome"
          value={form.nome}
          onChange={(e) => definir('nome', e.target.value)}
          erro={erros.nome}
          maxLength={120}
          obrigatorio
          autoFocus
        />
        <CampoTexto
          rotulo="Empresa"
          value={form.empresa}
          onChange={(e) => definir('empresa', e.target.value)}
          maxLength={120}
        />
        <CampoTexto
          rotulo="Telefone / WhatsApp"
          value={form.telefone}
          onChange={(e) => definir('telefone', e.target.value)}
          erro={erros.telefone}
          placeholder="(62) 98474-7979"
          inputMode="tel"
          maxLength={20}
        />
        <CampoTexto
          rotulo="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => definir('email', e.target.value)}
          erro={erros.email}
          maxLength={120}
        />
        <CampoSelect
          rotulo="Origem"
          value={form.origem}
          opcoes={opcoesSimples(ORIGEM_LEAD)}
          onChange={(e) => definir('origem', e.target.value)}
        />
        <CampoTexto
          rotulo="Campanha"
          value={form.campanha}
          onChange={(e) => definir('campanha', e.target.value)}
          maxLength={120}
          ajuda="Ex.: disparo do NinjaBot, Google Ads."
        />
        <CampoSelect
          rotulo="Etapa"
          value={form.status}
          opcoes={LEAD_STATUS.map((s) => ({ valor: s, rotulo: LEAD[s].rotulo }))}
          onChange={(e) => definir('status', e.target.value as LeadStatus)}
        />
        <CampoSelect
          rotulo="Serviço de interesse"
          value={form.servico_interesse_id}
          opcoes={[
            { valor: '', rotulo: 'Não definido' },
            ...servicos.map((s) => ({ valor: s.id, rotulo: s.nome })),
          ]}
          onChange={(e) => {
            const servico = servicos.find((s) => s.id === e.target.value);
            setForm((atual) => ({
              ...atual,
              servico_interesse_id: e.target.value,
              // Preenche o potencial com o preço do serviço, se ainda vazio.
              valor_potencial:
                atual.valor_potencial === '' && servico
                  ? centavosParaCampo(servico.preco_promocional ?? servico.preco)
                  : atual.valor_potencial,
            }));
          }}
        />
        <CampoTexto
          rotulo="Valor potencial (R$)"
          value={form.valor_potencial}
          onChange={(e) => definir('valor_potencial', e.target.value)}
          inputMode="decimal"
          placeholder="2500,00"
        />
        <CampoTexto
          rotulo="Próxima ação"
          value={form.proxima_acao}
          onChange={(e) => definir('proxima_acao', e.target.value)}
          maxLength={160}
        />
        <CampoTexto
          rotulo="Quando"
          type="date"
          value={form.proxima_acao_em?.slice(0, 10) ?? ''}
          onChange={(e) => definir('proxima_acao_em', e.target.value)}
        />
        <CampoTextarea
          className="col-inteira"
          rotulo="Observações"
          value={form.observacoes}
          onChange={(e) => definir('observacoes', e.target.value)}
          maxLength={2000}
        />

        {/* ---- Prospecção ---- */}
        <div className="col-inteira campo">
          <span className="campo-rotulo">Listas de prospecção</span>
          <div className="chips">
            {tags.length === 0 ? (
              <span className="campo-ajuda">
                Nenhuma lista cadastrada ainda. Crie em Automações.
              </span>
            ) : (
              tags.map((t) => {
                const marcada = form.tags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="chip"
                    aria-pressed={marcada}
                    onClick={() =>
                      setForm((atual) => ({
                        ...atual,
                        tags: marcada
                          ? atual.tags.filter((x) => x !== t.id)
                          : [...atual.tags, t.id],
                      }))
                    }
                  >
                    {t.nome}
                  </button>
                );
              })
            )}
          </div>
          <span className="campo-ajuda">
            Uma campanha só dispara para quem carrega a lista escolhida.
          </span>
        </div>

        <div className="col-inteira">
          <Switch
            rotulo="Não contatar"
            descricao="Exclui este contato de qualquer campanha, para sempre. Use em contato pessoal, fornecedor ou quem pediu para não receber mensagem."
            checked={form.nao_contatar}
            onChange={(e) => definir('nao_contatar', e.target.checked)}
          />
        </div>
      </div>
    </Modal>
  );
}

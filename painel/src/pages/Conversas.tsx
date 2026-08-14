/**
 * Conversas — a area que o NinjaBot vai alimentar.
 *
 * Hoje ela le a tabela `conversations` do proprio banco. Quando a integracao
 * existir, um adaptador NinjaBotProvider sincroniza essa tabela e esta tela
 * continua exatamente igual: e o ponto da camada de integracao.
 *
 * Nada aqui inventa comportamento do NinjaBot. Os campos exibidos sao os que
 * voce listou: lead, telefone, campanha, ultima mensagem, status, etapa do
 * funil, servico de interesse e valor potencial.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/data';
import { useColecao } from '@/hooks/useColecao';
import { useAsync } from '@/hooks/useAsync';
import type { Conversation, Lead, Service } from '@/types';
import { brl, formatarDataHora, formatarTelefone, tempoRelativo, whatsappLink } from '@/lib/format';
import { DataTable, type Coluna } from '@/components/ui/DataTable';
import { Paginacao } from '@/components/ui/Pagination';
import { Drawer } from '@/components/ui/Modal';
import { Aviso, Botao, CampoTexto, CampoTextarea, Eyebrow } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { CONVERSA, StatusConversa, StatusLead, opcoesDe } from '@/components/dominio/StatusBadge';
import { registrarResposta } from '@/prospeccao/campanhas';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';

export function Conversas() {
  const colecao = useColecao<Conversation>(db.conversas, {
    porPagina: 20,
    ordenarPor: 'ultima_mensagem_em',
    filtrosIniciais: { status: 'todos' },
  });

  const leads = useAsync(() => db.leads.todos(), [], [] as Lead[]);
  const servicos = useAsync(() => db.servicos.todos(), [], [] as Service[]);

  const nomeLead = useMemo(() => new Map(leads.dado.map((l) => [l.id, l.nome])), [leads.dado]);
  const nomeServico = useMemo(() => new Map(servicos.dado.map((s) => [s.id, s.nome])), [servicos.dado]);

  const [detalhe, setDetalhe] = useState<Conversation | null>(null);
  const [resposta, setResposta] = useState("");
  const [registrando, setRegistrando] = useState(false);

  const { pode } = useAuth();
  const toast = useToast();
  const podeEditar = pode('conversas', 'editar');

  const registrar = useCallback(
    async (conversaId: string) => {
      setRegistrando(true);
      try {
        await registrarResposta(conversaId, resposta.trim() || null);
        toast.sucesso("Resposta registrada. O lead avançou no funil.");
        setResposta("");
        setDetalhe(null);
        colecao.recarregar();
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : "Não foi possível registrar.");
      } finally {
        setRegistrando(false);
      }
    },
    [resposta, toast, colecao],
  );

  const colunas: Coluna<Conversation>[] = useMemo(
    () => [
      {
        chave: 'lead',
        titulo: 'Lead',
        render: (c) => (
          <div className="pilha" style={{ minWidth: 0 }}>
            <span className="forte truncar">
              {c.lead_id ? nomeLead.get(c.lead_id) ?? 'Lead removido' : 'Sem lead vinculado'}
            </span>
            <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
              {formatarTelefone(c.telefone)}
            </span>
          </div>
        ),
      },
      {
        chave: 'campanha',
        titulo: 'Campanha',
        ocultarNoMobile: true,
        render: (c) => <span className="truncar">{c.campanha ?? '—'}</span>,
      },
      {
        chave: 'mensagem',
        titulo: 'Última mensagem',
        render: (c) => (
          <div className="pilha" style={{ minWidth: 0 }}>
            <span className="truncar">{c.ultima_mensagem ?? '—'}</span>
            <span style={{ fontSize: '.6875rem', color: 'var(--fg-dim)' }}>
              {tempoRelativo(c.ultima_mensagem_em)}
            </span>
          </div>
        ),
      },
      { chave: 'status', titulo: 'Status', ordenarPor: 'status', render: (c) => <StatusConversa status={c.status} /> },
      {
        chave: 'etapa',
        titulo: 'Etapa do funil',
        ocultarNoMobile: true,
        render: (c) => <StatusLead status={c.etapa_funil} />,
      },
      {
        chave: 'valor',
        titulo: 'Potencial',
        ordenarPor: 'valor_potencial',
        alinharDireita: true,
        render: (c) => (c.valor_potencial ? brl(c.valor_potencial) : '—'),
      },
    ],
    [nomeLead],
  );

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Atendimento</Eyebrow>
          <h1 className="pagina-titulo">Conversas</h1>
          <p className="pagina-descricao">
            Cada disparo que virou conversa, com a etapa do funil em que o lead parou.
          </p>
        </div>
      </header>

      {/* A integração com o NinjaBot foi removida do projeto. Esta tela lê a
          tabela `conversations` do próprio painel — nada vem de fora. */}
      <Aviso tom="info" className="secao-aviso">
        <strong>Sem integração de mensageria.</strong> As conversas abaixo vêm da tabela{' '}
        <code className="mono">conversations</code> do painel, alimentada pelo registro dos
        disparos. Nada é sincronizado automaticamente.
      </Aviso>

      <div className="filtros">
        <CampoTexto
          className="busca"
          placeholder="Buscar por telefone, campanha ou mensagem"
          iconeEsquerda="busca"
          value={colecao.busca}
          onChange={(e) => colecao.setBusca(e.target.value)}
          aria-label="Buscar conversas"
        />
        <select
          className="select"
          value={String(colecao.filtros.status ?? 'todos')}
          onChange={(e) => colecao.definirFiltro('status', e.target.value)}
          aria-label="Filtrar por status"
        >
          {opcoesDe(CONVERSA, 'Todos os status').map((o) => (
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
        chaveDe={(c) => c.id}
        carregando={colecao.carregando}
        aoClicar={setDetalhe}
        ordenarPor={colecao.ordenarPor}
        ordem={colecao.ordem}
        aoOrdenar={colecao.alternarOrdem}
        vazioTitulo="Nenhuma conversa"
        vazioDescricao="As conversas aparecerão aqui conforme os disparos forem respondidos."
      />

      <Paginacao
        pagina={colecao.pagina}
        porPagina={colecao.porPagina}
        total={colecao.total}
        aoMudar={colecao.setPagina}
        rotuloItem="conversas"
      />

      {detalhe && (
        <Drawer
          aberto
          aoFechar={() => setDetalhe(null)}
          titulo={detalhe.lead_id ? nomeLead.get(detalhe.lead_id) ?? 'Conversa' : 'Conversa'}
          descricao={formatarTelefone(detalhe.telefone)}
        >
          <div className="pilha" style={{ gap: 18 }}>
            {whatsappLink(detalhe.telefone) && (
              <a
                className="btn btn-secundario btn-bloco"
                href={whatsappLink(detalhe.telefone) as string}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon nome="whatsapp" />
                Abrir conversa no WhatsApp
              </a>
            )}

            <dl className="definicoes">
              <div className="definicao">
                <dt>Status</dt>
                <dd>
                  <StatusConversa status={detalhe.status} />
                </dd>
              </div>
              <div className="definicao">
                <dt>Etapa do funil</dt>
                <dd>
                  <StatusLead status={detalhe.etapa_funil} />
                </dd>
              </div>
              <div className="definicao">
                <dt>Campanha</dt>
                <dd>{detalhe.campanha ?? '—'}</dd>
              </div>
              <div className="definicao">
                <dt>Disparo</dt>
                <dd>{formatarDataHora(detalhe.criado_em)}</dd>
              </div>
              <div className="definicao">
                <dt>Mensagens</dt>
                <dd>
                  {detalhe.mensagens_enviadas} enviadas · {detalhe.mensagens_recebidas} recebidas
                </dd>
              </div>
              <div className="definicao">
                <dt>Serviço de interesse</dt>
                <dd>
                  {detalhe.servico_interesse_id ? nomeServico.get(detalhe.servico_interesse_id) ?? '—' : '—'}
                </dd>
              </div>
              <div className="definicao">
                <dt>Valor potencial</dt>
                <dd>{detalhe.valor_potencial ? brl(detalhe.valor_potencial) : '—'}</dd>
              </div>
              <div className="definicao">
                <dt>ID no NinjaBot</dt>
                <dd className="mono">{detalhe.externo_id ?? 'Não integrado'}</dd>
              </div>
            </dl>

            <div>
              <div className="card-titulo" style={{ marginBottom: 8 }}>
                Última mensagem
              </div>
              <div className="mensagem-bolha">
                {detalhe.ultima_mensagem ?? 'Nenhuma mensagem recebida.'}
                <span className="mensagem-hora">{formatarDataHora(detalhe.ultima_mensagem_em)}</span>
              </div>
              <p className="campo-ajuda" style={{ marginTop: 10 }}>
                O histórico completo da conversa fica no NinjaBot. Quando a API for integrada, ele
                poderá ser exibido aqui.
              </p>
            </div>

            {/* O passo que faz o funil andar: no fluxo real é aqui que a IA do
                NinjaBot assume. Como não há API, quem registra é o operador. */}
            {podeEditar && detalhe.status !== 'em_atendimento' && detalhe.status !== 'encerrada' && (
              <div className="pilha" style={{ gap: 8 }}>
                <CampoTextarea
                  rotulo="O lead respondeu?"
                  placeholder="Cole aqui a resposta dele (opcional)"
                  value={resposta}
                  onChange={(e) => setResposta(e.target.value)}
                  maxLength={1000}
                  ajuda="Registrar move a conversa para atendimento e avança o lead no funil."
                />
                <Botao
                  variante="primario"
                  icone="conversas"
                  bloco
                  carregando={registrando}
                  onClick={() => void registrar(detalhe.id)}
                >
                  Registrar resposta
                </Botao>
              </div>
            )}

            {detalhe.lead_id && (
              <Link to="/leads" className="btn btn-fantasma btn-bloco">
                Ver o lead no CRM
              </Link>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}

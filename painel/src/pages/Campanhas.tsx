/**
 * Campanhas de prospecção — NinjaBot em modo assistido.
 *
 * O painel organiza; o envio acontece no WhatsApp/NinjaBot. Nada sai daqui
 * automaticamente, e isso é intencional: o NinjaBot que operamos não tem API,
 * e disparar em massa sem confirmação humana é como conta é banida.
 *
 * O ciclo de uma campanha:
 *   1. escolher a lista (tag) e escrever a mensagem;
 *   2. ver a prévia do público — quem entra, quem fica de fora e por quê;
 *   3. gerar os alvos;
 *   4. abrir lotes de 10, enviar um a um e confirmar;
 *   5. quando o lead responder, registrar em Conversas.
 */

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Campaign, CampaignStatus, Tag } from '@/types';
import { formatarData, formatarTelefone } from '@/lib/format';
import {
  MOTIVO_TEXTO,
  TAMANHO_LOTE_PADRAO,
  VARIAVEIS_DISPONIVEIS,
  confirmarEnvio,
  gerarAlvos,
  marcarFalha,
  montarMensagem,
  previaDaCampanha,
  proximoLote,
  resumirCampanha,
  type ItemLote,
  type Lote,
  type MotivoInelegivel,
} from '@/prospeccao/campanhas';
import { Confirmacao, Modal } from '@/components/ui/Modal';
import {
  Aviso,
  Badge,
  Botao,
  BotaoIcone,
  CampoSelect,
  CampoTexto,
  CampoTextarea,
  Card,
  Eyebrow,
  Progresso,
  Skeleton,
  Vazio,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { StatCard } from '@/components/dominio/StatCard';

const ROTULO_STATUS: Record<CampaignStatus, { texto: string; tom: 'neutro' | 'ok' | 'alerta' | 'info' }> = {
  rascunho: { texto: 'Rascunho', tom: 'neutro' },
  ativa: { texto: 'Ativa', tom: 'ok' },
  pausada: { texto: 'Pausada', tom: 'alerta' },
  concluida: { texto: 'Concluída', tom: 'info' },
};

export function Campanhas() {
  const { pode } = useAuth();
  const toast = useToast();

  const campanhas = useAsync(
    () => db.campanhas.todos({ ordenarPor: 'criado_em', ordem: 'desc' }),
    [],
    [] as Campaign[],
  );
  const tags = useAsync(() => db.tags.todos(), [], [] as Tag[]);

  const [selecionada, setSelecionada] = useState<Campaign | null>(null);
  const [editando, setEditando] = useState<Campaign | null>(null);
  const [criando, setCriando] = useState(false);
  const [excluindo, setExcluindo] = useState<Campaign | null>(null);
  const [processando, setProcessando] = useState(false);

  const podeOperar = pode('automacoes', 'editar');

  const excluir = useCallback(async () => {
    if (!excluindo) return;
    setProcessando(true);
    try {
      const alvos = await db.alvosCampanha.todos({ filtros: { campanha_id: excluindo.id } });
      await Promise.all(alvos.map((a) => db.alvosCampanha.remover(a.id)));
      await db.campanhas.remover(excluindo.id);
      toast.sucesso('Campanha excluída.');
      setExcluindo(null);
      setSelecionada(null);
      campanhas.recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setProcessando(false);
    }
  }, [excluindo, toast, campanhas]);

  const nomeTag = (id: string) => tags.dado.find((t) => t.id === id)?.nome ?? id;

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Prospecção</Eyebrow>
          <h1 className="pagina-titulo">Campanhas</h1>
          <p className="pagina-descricao">
            Selecione a lista, escreva a mensagem e dispare em lotes de {TAMANHO_LOTE_PADRAO}. O
            painel controla quem já foi contatado; o envio é feito por você no WhatsApp.
          </p>
        </div>
        {podeOperar && (
          <div className="pagina-acoes">
            <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
              Nova campanha
            </Botao>
          </div>
        )}
      </header>

      {/* Texto fixo voltou a ser a verdade: não existe integração que possa
          mudar este estado. O painel organiza; o envio é sempre seu. */}
      <Aviso tom="info" className="secao-aviso">
        <strong>Modo assistido.</strong> Nenhuma mensagem sai daqui sozinha. O painel monta o lote
        com a mensagem pronta, você envia pelo WhatsApp e confirma — é assim que o controle de
        duplicidade e o funil ficam corretos.
      </Aviso>

      {campanhas.carregando ? (
        <Skeleton altura={200} />
      ) : campanhas.dado.length === 0 ? (
        <Card>
          <Vazio
            icone="enviar"
            titulo="Nenhuma campanha ainda"
            descricao="Crie a primeira escolhendo uma lista de prospecção e escrevendo a mensagem de abertura."
            acao={
              podeOperar ? (
                <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
                  Nova campanha
                </Botao>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grade-2">
          {campanhas.dado.map((c) => (
            <CartaoCampanha
              key={c.id}
              campanha={c}
              nomeTag={nomeTag(c.tag)}
              podeOperar={podeOperar}
              aoAbrir={() => setSelecionada(c)}
              aoEditar={() => setEditando(c)}
              aoExcluir={() => setExcluindo(c)}
            />
          ))}
        </div>
      )}

      {selecionada && (
        <PainelCampanha
          campanha={selecionada}
          nomeTag={nomeTag(selecionada.tag)}
          podeOperar={podeOperar}
          aoFechar={() => {
            setSelecionada(null);
            campanhas.recarregar();
          }}
        />
      )}

      {(criando || editando) && (
        <FormularioCampanha
          campanha={editando}
          tags={tags.dado}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={() => {
            setCriando(false);
            setEditando(null);
            campanhas.recarregar();
          }}
        />
      )}

      <Confirmacao
        aberto={excluindo !== null}
        aoFechar={() => setExcluindo(null)}
        aoConfirmar={() => void excluir()}
        titulo="Excluir campanha"
        mensagem={`“${excluindo?.nome}” e todo o histórico de disparo dela serão removidos. Os leads continuam no CRM, mas o registro de quem já foi contatado nesta campanha se perde.`}
        textoConfirmar="Excluir"
        perigo
        processando={processando}
      />
    </>
  );
}

/* ==========================================================================
   Cartão
   ========================================================================== */

function CartaoCampanha({
  campanha,
  nomeTag,
  podeOperar,
  aoAbrir,
  aoEditar,
  aoExcluir,
}: {
  campanha: Campaign;
  nomeTag: string;
  podeOperar: boolean;
  aoAbrir: () => void;
  aoEditar: () => void;
  aoExcluir: () => void;
}) {
  const alvos = useAsync(
    () => db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } }),
    [campanha.id],
    [],
  );

  const resumo = resumirCampanha(alvos.dado);
  const contatados = resumo.enviados + resumo.respondidos;
  const progresso = resumo.total === 0 ? 0 : (contatados / resumo.total) * 100;
  const rotulo = ROTULO_STATUS[campanha.status];

  return (
    <Card padding={false}>
      <div className="card-cabeca">
        <div style={{ minWidth: 0 }}>
          <div className="card-titulo truncar">{campanha.nome}</div>
          <div className="card-sub">
            Lista: {nomeTag} · criada em {formatarData(campanha.criado_em)}
          </div>
        </div>
        <div className="linha" style={{ gap: 4 }}>
          <Badge tom={rotulo.tom}>{rotulo.texto}</Badge>
          {podeOperar && (
            <>
              <BotaoIcone icone="editar" rotulo={`Editar ${campanha.nome}`} onClick={aoEditar} />
              <BotaoIcone icone="lixeira" rotulo={`Excluir ${campanha.nome}`} onClick={aoExcluir} />
            </>
          )}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {alvos.carregando ? (
          <Skeleton altura={70} />
        ) : resumo.total === 0 ? (
          <p style={{ fontSize: '.8438rem', color: 'var(--fg-dim)' }}>
            Público ainda não gerado. Abra a campanha para ver quem se encaixa.
          </p>
        ) : (
          <>
            <Progresso valor={progresso} rotulo={`${campanha.nome}: ${Math.round(progresso)}% contatado`} />
            <div className="linha-entre" style={{ marginTop: 10, fontSize: '.75rem', color: 'var(--fg-dim)' }}>
              <span>
                {contatados} de {resumo.total} contatados
              </span>
              <span>{resumo.respondidos} responderam</span>
            </div>
          </>
        )}

        <div className="linha" style={{ gap: 8, marginTop: 14 }}>
          <Botao variante="secundario" icone="enviar" onClick={aoAbrir} style={{ flex: 1 }}>
            Abrir campanha
          </Botao>
          {/* Fluxo de seleção manual: escolher contato a contato e montar
              slots com mensagens diferentes. */}
          <Link to={`/campanhas/${campanha.id}`} className="btn btn-primario" style={{ flex: 1 }}>
            <Icon nome="colunas" />
            Disparo manual
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* ==========================================================================
   Painel de operação
   ========================================================================== */

function PainelCampanha({
  campanha,
  nomeTag,
  podeOperar,
  aoFechar,
}: {
  campanha: Campaign;
  nomeTag: string;
  podeOperar: boolean;
  aoFechar: () => void;
}) {
  const toast = useToast();
  const [lote, setLote] = useState<Lote | null>(null);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);

  const dados = useAsync(
    async () => {
      const [alvos, previa] = await Promise.all([
        db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } }),
        previaDaCampanha(campanha),
      ]);
      return { alvos, previa };
    },
    [campanha.id, versao],
    null as null | { alvos: Awaited<ReturnType<typeof db.alvosCampanha.todos>>; previa: Awaited<ReturnType<typeof previaDaCampanha>> },
  );

  const recarregar = () => setVersao((v) => v + 1);

  const gerar = useCallback(async () => {
    setOcupado(true);
    try {
      const { criados, total } = await gerarAlvos(campanha);
      toast.sucesso(
        criados === 0
          ? 'Nenhum lead novo se encaixa nos critérios.'
          : `${criados} ${criados === 1 ? 'lead entrou' : 'leads entraram'} na campanha. Total: ${total}.`,
      );
      recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível gerar o público.');
    } finally {
      setOcupado(false);
    }
  }, [campanha, toast]);

  const abrirLote = useCallback(async () => {
    setOcupado(true);
    try {
      const novo = await proximoLote(campanha);
      if (novo.itens.length === 0) {
        toast.info('Não há mais leads pendentes nesta campanha.');
        setLote(null);
        recarregar();
        return;
      }
      setLote(novo);
      setEnviados(new Set());
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível montar o lote.');
    } finally {
      setOcupado(false);
    }
  }, [campanha, toast]);

  const confirmar = useCallback(
    async (item: ItemLote) => {
      try {
        const r = await confirmarEnvio(campanha, item);
        setEnviados((atual) => new Set(atual).add(item.alvo.id));

        // Silenciar a falha de autorização foi o bug: o registro dava certo,
        // a IA nunca era liberada, e a tela dizia que estava tudo bem.
        if (r.bloqueado) {
          toast.erro(`${item.lead.nome} está marcado como “não contatar”. Nada foi registrado.`);
        } else if (!r.autorizada) {
          toast.erro(
            `Envio registrado, mas a IA NÃO foi autorizada para ${item.lead.nome}` +
              (r.erroAutorizacao ? `: ${r.erroAutorizacao}` : '.') +
              ' O NinjaBot não vai assumir essa conversa.',
          );
        }
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Não foi possível registrar o envio.');
      }
    },
    [campanha, toast],
  );

  const pular = useCallback(
    async (item: ItemLote) => {
      try {
        await marcarFalha(item.alvo, 'Pulado pelo operador');
        setEnviados((atual) => new Set(atual).add(item.alvo.id));
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Não foi possível pular.');
      }
    },
    [toast],
  );

  const fecharLote = () => {
    setLote(null);
    recarregar();
  };

  const resumo = dados.dado ? resumirCampanha(dados.dado.alvos) : null;
  const previa = dados.dado?.previa;

  return (
    <Modal
      aberto
      aoFechar={lote ? fecharLote : aoFechar}
      largo
      titulo={campanha.nome}
      descricao={`Lista: ${nomeTag}`}
      rodape={
        lote ? (
          <>
            <span style={{ marginRight: 'auto', fontSize: '.8125rem', color: 'var(--fg-dim)' }}>
              {enviados.size} de {lote.itens.length} tratados neste lote
            </span>
            <Botao variante="primario" onClick={fecharLote}>
              Concluir lote
            </Botao>
          </>
        ) : (
          <>
            <Botao variante="fantasma" onClick={aoFechar}>
              Fechar
            </Botao>
            {podeOperar && (resumo?.pendentes ?? 0) > 0 && (
              <Botao variante="primario" icone="enviar" onClick={() => void abrirLote()} carregando={ocupado}>
                Abrir lote de {Math.min(campanha.tamanho_lote, resumo?.pendentes ?? 0)}
              </Botao>
            )}
          </>
        )
      }
    >
      {dados.carregando || !resumo || !previa ? (
        <Skeleton altura={260} />
      ) : lote ? (
        <VisaoLote
          lote={lote}
          enviados={enviados}
          aoConfirmar={confirmar}
          aoPular={pular}
        />
      ) : (
        <div className="pilha" style={{ gap: 18 }}>
          <div className="grade-kpi">
            <StatCard rotulo="No público" valor={String(resumo.total)} icone="leads" destaque />
            <StatCard rotulo="Pendentes" valor={String(resumo.pendentes)} icone="relogio" />
            <StatCard rotulo="Enviados" valor={String(resumo.enviados)} icone="enviar" />
            <StatCard rotulo="Responderam" valor={String(resumo.respondidos)} icone="conversas" />
          </div>

          {resumo.total === 0 ? (
            <>
              <Aviso tom="alerta">
                O público ainda não foi gerado. Confira a prévia abaixo e gere quando estiver certo
                — nada é enviado nesse passo.
              </Aviso>
              <PreviaPublico previa={previa} />
              {podeOperar && (
                <Botao variante="primario" bloco icone="leads" onClick={() => void gerar()} carregando={ocupado}>
                  Gerar público ({previa.elegiveis.length} {previa.elegiveis.length === 1 ? 'lead' : 'leads'})
                </Botao>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="card-titulo" style={{ marginBottom: 8 }}>
                  Mensagem de abertura
                </div>
                <div className="mensagem-bolha">{campanha.mensagem}</div>
              </div>

              {(resumo.ignorados > 0 || resumo.falhas > 0) && (
                <Aviso tom="alerta">
                  {/* Conta alvos com status `ignorado` — ou seja, marcados como
                      “não contatar”. O texto antigo dizia “saíram do público na
                      revalidação”, que descrevia outra coisa e mandava procurar
                      o problema no lugar errado. */}
                  {resumo.ignorados > 0 && (
                    <>
                      {resumo.ignorados} lead(s) marcado(s) como “não contatar” — não serão
                      abordados.{' '}
                    </>
                  )}
                  {resumo.falhas > 0 && <>{resumo.falhas} pulado(s) pelo operador.</>}
                </Aviso>
              )}

              {previa.elegiveis.length > 0 && podeOperar && (
                <Botao variante="secundario" bloco icone="atualizar" onClick={() => void gerar()} carregando={ocupado}>
                  Incluir {previa.elegiveis.length} lead(s) novo(s) que passaram a se encaixar
                </Botao>
              )}

              {/* “Tratados” só é verdade se alguém foi realmente contatado.
                  Com total > 0 e nenhum enviado, a campanha está PARADA, não
                  concluída — e dizer o contrário em verde escondia o problema. */}
              {resumo.pendentes === 0 &&
                (resumo.enviados + resumo.respondidos > 0 ? (
                  <Aviso tom="ok">
                    Todos os leads desta campanha já foram tratados. Taxa de resposta:{' '}
                    <strong>{resumo.taxa_resposta.toFixed(0)}%</strong>.
                  </Aviso>
                ) : resumo.total > 0 ? (
                  <Aviso tom="alerta">
                    Esta campanha tem <strong>{resumo.total} lead(s)</strong> e{' '}
                    <strong>nenhum pendente</strong>, mas nada foi enviado. Eles estão marcados como
                    “não contatar” ou foram pulados — confira a lista antes de concluir.
                  </Aviso>
                ) : null)}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ==========================================================================
   Prévia do público
   ========================================================================== */

function PreviaPublico({ previa }: { previa: Awaited<ReturnType<typeof previaDaCampanha>> }) {
  const exclusoes = Object.entries(previa.exclusoes) as [MotivoInelegivel, number][];

  return (
    <div>
      <div className="card-titulo" style={{ marginBottom: 8 }}>
        Quem entra
      </div>
      <p style={{ fontSize: '.875rem', marginBottom: 12 }}>
        <strong style={{ color: 'var(--fg)' }}>{previa.elegiveis.length}</strong> leads elegíveis.
      </p>

      {exclusoes.length > 0 && (
        <>
          <div className="card-titulo" style={{ marginBottom: 8 }}>
            Quem fica de fora
          </div>
          <dl className="definicoes">
            {exclusoes
              .sort((a, b) => b[1] - a[1])
              .map(([motivo, quantos]) => (
                <div className="definicao" key={motivo}>
                  <dt>{MOTIVO_TEXTO[motivo]}</dt>
                  <dd>{quantos}</dd>
                </div>
              ))}
          </dl>
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   Lote
   ========================================================================== */

function VisaoLote({
  lote,
  enviados,
  aoConfirmar,
  aoPular,
}: {
  lote: Lote;
  enviados: Set<string>;
  aoConfirmar: (i: ItemLote) => void;
  aoPular: (i: ItemLote) => void;
}) {
  return (
    <div className="pilha" style={{ gap: 14 }}>
      <Aviso tom="alerta">
        <strong>Lote {lote.numero}.</strong> Abra cada conversa, envie a mensagem e confirme aqui.
        Confirmar é o que registra o contato e move o lead no funil — sem isso, ele volta a aparecer
        no próximo lote.
      </Aviso>

      {lote.itens.map((item) => {
        const tratado = enviados.has(item.alvo.id);
        return (
          <div key={item.alvo.id} className={`lote-item ${tratado ? 'tratado' : ''}`}>
            <div className="linha-entre" style={{ alignItems: 'flex-start' }}>
              <div className="pilha" style={{ minWidth: 0 }}>
                <span style={{ color: 'var(--fg)', fontWeight: 600 }} className="truncar">
                  {item.lead.nome}
                </span>
                <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                  {item.lead.empresa ?? 'Sem empresa'} · {formatarTelefone(item.lead.whatsapp ?? item.lead.telefone)}
                </span>
              </div>
              {tratado && <Badge tom="ok">Registrado</Badge>}
            </div>

            <div className="mensagem-bolha" style={{ marginTop: 10, fontSize: '.8125rem' }}>
              {item.mensagem}
            </div>

            {!tratado && (
              <div className="linha" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {item.link ? (
                  <a className="btn btn-secundario btn-sm" href={item.link} target="_blank" rel="noopener noreferrer">
                    <Icon nome="whatsapp" />
                    Abrir conversa
                  </a>
                ) : (
                  <Badge tom="erro">Número inválido</Badge>
                )}
                <Botao tamanho="sm" variante="primario" icone="check" onClick={() => aoConfirmar(item)}>
                  Enviei
                </Botao>
                <Botao tamanho="sm" variante="fantasma" onClick={() => aoPular(item)}>
                  Pular
                </Botao>
              </div>
            )}
          </div>
        );
      })}

      {lote.restantes > 0 && (
        <p className="campo-ajuda">
          Ainda restam {lote.restantes} leads pendentes depois deste lote.
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
   Formulário
   ========================================================================== */

function FormularioCampanha({
  campanha,
  tags,
  aoFechar,
  aoSalvar,
}: {
  campanha: Campaign | null;
  tags: Tag[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    nome: campanha?.nome ?? '',
    tag: campanha?.tag ?? (tags[0]?.id ?? ''),
    mensagem: campanha?.mensagem ?? '',
    status: (campanha?.status ?? 'rascunho') as CampaignStatus,
    tamanho_lote: String(campanha?.tamanho_lote ?? TAMANHO_LOTE_PADRAO),
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  const exemplo = montarMensagem(form.mensagem, {
    nome: 'Maria Aparecida Santos',
    empresa: 'Padaria Grão Dourado',
  } as never);

  async function salvar() {
    const encontrados: Record<string, string> = {};
    if (!form.nome.trim()) encontrados.nome = 'Dê um nome à campanha.';
    if (!form.tag) encontrados.tag = 'Escolha a lista de prospecção.';
    if (form.mensagem.trim().length < 20) encontrados.mensagem = 'A mensagem precisa de pelo menos 20 caracteres.';

    const lote = Number.parseInt(form.tamanho_lote, 10);
    if (!Number.isInteger(lote) || lote < 1 || lote > 50) {
      encontrados.tamanho_lote = 'O lote precisa estar entre 1 e 50.';
    }

    if (Object.keys(encontrados).length > 0) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setSalvando(true);

    const dados = {
      nome: form.nome.trim().slice(0, 120),
      tag: form.tag,
      mensagem: form.mensagem.trim().slice(0, 1200),
      status: form.status,
      tamanho_lote: lote,
    };

    try {
      if (campanha) {
        await db.campanhas.atualizar(campanha.id, dados);
        toast.sucesso('Campanha atualizada.');
      } else {
        await db.campanhas.criar({ ...dados, iniciada_em: null, concluida_em: null });
        toast.sucesso('Campanha criada. Gere o público quando quiser.');
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
      titulo={campanha ? 'Editar campanha' : 'Nova campanha'}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            {campanha ? 'Salvar' : 'Criar campanha'}
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoTexto
          className="col-inteira"
          rotulo="Nome da campanha"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          erro={erros.nome}
          maxLength={120}
          obrigatorio
          autoFocus
        />

        <CampoSelect
          rotulo="Lista de prospecção"
          value={form.tag}
          erro={erros.tag}
          obrigatorio
          opcoes={
            tags.length === 0
              ? [{ valor: '', rotulo: 'Nenhuma lista cadastrada' }]
              : tags.map((t) => ({ valor: t.id, rotulo: t.nome }))
          }
          onChange={(e) => setForm({ ...form, tag: e.target.value })}
          ajuda="Só quem tem esta lista recebe."
        />

        <CampoTexto
          rotulo="Contatos por lote"
          type="number"
          min={1}
          max={50}
          value={form.tamanho_lote}
          onChange={(e) => setForm({ ...form, tamanho_lote: e.target.value })}
          erro={erros.tamanho_lote}
          ajuda="Combinado: 10 por vez."
        />

        <CampoTextarea
          className="col-inteira"
          rotulo="Mensagem de abertura"
          value={form.mensagem}
          onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
          erro={erros.mensagem}
          maxLength={1200}
          rows={5}
          obrigatorio
          ajuda={`Variáveis: ${VARIAVEIS_DISPONIVEIS.join(' · ')}`}
        />

        {form.mensagem.trim().length > 0 && (
          <div className="col-inteira">
            <div className="card-titulo" style={{ marginBottom: 6 }}>
              Como o lead vai receber
            </div>
            <div className="mensagem-bolha">{exemplo}</div>
            <p className="campo-ajuda" style={{ marginTop: 6 }}>
              Exemplo com um lead fictício, só para conferir as variáveis.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

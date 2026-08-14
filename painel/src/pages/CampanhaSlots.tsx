/**
 * Área de trabalho de disparo manual — a tela onde você monta os lotes.
 *
 * FLUXO, na ordem da tela:
 *   1. cria um slot (nome + mensagem);
 *   2. seleciona à mão QUEM entra nele;
 *   3. revisa contato por contato, podendo trocar a mensagem de um só;
 *   4. abre o WhatsApp e ENVIA VOCÊ MESMO;
 *   5. confirma aqui — só então o contato fica registrado e a IA autorizada.
 *
 * ===========================================================================
 * DOIS CAMINHOS PARA O PASSO 4, E NENHUM DELES É AUTOMÁTICO
 *
 *   "Disparar"   envia de verdade pela API do NinjaBot, contato a contato,
 *                depois de uma confirmação que lista os números um a um. Só
 *                habilita quando o SERVIDOR abre o portão
 *                (`NINJABOT_ENVIO_LIBERADO=true`) — o frontend nunca decide
 *                isso, ele pergunta e reflete a resposta.
 *
 *   "Já enviei"  continua existindo para quem mandou pelo WhatsApp na mão:
 *                apenas REGISTRA o que já saiu e autoriza a IA.
 *
 * Em nenhum dos dois há laço automático, agendamento ou reenvio. Uma mensagem
 * sai por clique seu, e cada resultado é gravado antes do contato seguinte.
 *
 * A garantia não é este comentário: enquanto o portão estiver fechado,
 * `/api/ninjabot/disparar` responde 403, e o proxy de LEITURA
 * (`chamarNinjaBot`) recusa qualquer caminho de envio, sem bypass.
 * ===========================================================================
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Campaign, CampaignSlot, CampaignTarget, Lead } from '@/types';
import { formatarTelefone, tempoRelativo } from '@/lib/format';
import {
  atribuirAoSlot,
  avaliarSelecao,
  BLOQUEIO_TEXTO,
  confirmarDisparoSlot,
  contarBloqueios,
  criarSlot,
  definirMensagemDoContato,
  detectarTelefonesRepetidos,
  prepararSlot,
  regerarMensagens,
  removerDoSlot,
  resumirSlot,
  type EstadoSelecao,
  type ItemPreparado,
  type MotivoBloqueio,
} from '@/prospeccao/slots';
import { VARIAVEIS_DISPONIVEIS, variaveisVazias } from '@/prospeccao/campanhas';
import { Confirmacao, Modal } from '@/components/ui/Modal';
import {
  Aviso,
  Avatar,
  Badge,
  Botao,
  BotaoIcone,
  CampoTexto,
  CampoTextarea,
  Card,
  Eyebrow,
  Skeleton,
  Vazio,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { StatCard } from '@/components/dominio/StatCard';


/* ==========================================================================
   Página
   ========================================================================== */

export function CampanhaSlots() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const { pode } = useAuth();
  const toast = useToast();

  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const dados = useAsync(
    async () => {
      const campanha = await db.campanhas.obter(id);
      if (!campanha) return null;
      const [slots, alvos] = await Promise.all([
        db.slotsCampanha.todos({ filtros: { campanha_id: id } }),
        db.alvosCampanha.todos({ filtros: { campanha_id: id } }),
      ]);
      return { campanha, slots, alvos };
    },
    [id, versao],
    null as null | { campanha: Campaign; slots: CampaignSlot[]; alvos: CampaignTarget[] },
  );

  const [criandoSlot, setCriandoSlot] = useState(false);
  const [slotAberto, setSlotAberto] = useState<CampaignSlot | null>(null);

  const podeOperar = pode('automacoes', 'editar');

  if (dados.carregando) {
    return (
      <div className="pilha" style={{ gap: 16 }}>
        <Skeleton altura={90} />
        <Skeleton altura={240} />
      </div>
    );
  }

  if (!dados.dado) {
    return (
      <Card>
        <Vazio
          icone="enviar"
          titulo="Campanha não encontrada"
          descricao="Ela pode ter sido removida."
          acao={
            <Botao variante="secundario" icone="esquerda" onClick={() => navegar('/campanhas')}>
              Voltar
            </Botao>
          }
        />
      </Card>
    );
  }

  const { campanha, slots, alvos } = dados.dado;
  const geral = resumirSlot(alvos);

  return (
    <>
      <nav className="migalhas" aria-label="Trilha de navegação">
        <Link to="/campanhas">Campanhas</Link>
        <Icon nome="direita" tamanho={13} />
        <span>{campanha.nome}</span>
      </nav>

      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Disparo manual</Eyebrow>
          <h1 className="pagina-titulo">{campanha.nome}</h1>
          <p className="pagina-descricao">
            Monte os lotes, escolha quem entra em cada um e revise. O envio é feito por você no
            WhatsApp — o painel registra quem participou e libera a IA só para esses contatos.
          </p>
        </div>
        {podeOperar && (
          <div className="pagina-acoes">
            <Botao variante="primario" icone="mais" onClick={() => setCriandoSlot(true)}>
              Novo slot
            </Botao>
          </div>
        )}
      </header>

      {/* Texto fixo agora é a verdade: não existe mais integração que possa
          mudar esse estado. Nenhuma API é chamada por esta tela. */}
      <Aviso tom="info" className="secao-aviso">
        <strong>Modo assistido.</strong> Este painel não envia mensagem. “Abrir conversa” abre o
        WhatsApp com o texto pronto — apertar enviar é você — e “Já enviei” apenas registra o que
        saiu, para o controle de duplicidade e o funil ficarem corretos.
      </Aviso>

      <div className="grade-kpi">
        <StatCard rotulo="No disparo" valor={String(geral.total)} icone="leads" destaque />
        <StatCard rotulo="A enviar" valor={String(geral.pendentes)} icone="relogio" />
        <StatCard rotulo="Enviados" valor={String(geral.enviados + geral.respondidos)} icone="enviar" />
        <StatCard
          rotulo="IA autorizada"
          valor={String(geral.autorizados)}
          icone="robo"
          rodape={
            geral.semAutorizacao > 0 ? (
              <span style={{ color: '#FF6070' }}>{geral.semAutorizacao} sem autorização</span>
            ) : undefined
          }
        />
      </div>

      <section className="secao">
        <div className="secao-cabeca">
          <h2 style={{ fontSize: '1rem' }}>Slots / lotes</h2>
          <span style={{ fontSize: '.8125rem', color: 'var(--fg-dim)' }}>
            Cada slot tem sua própria mensagem e seus próprios contatos
          </span>
        </div>

        {slots.length === 0 ? (
          <Card>
            <Vazio
              icone="colunas"
              titulo="Nenhum slot ainda"
              descricao="Crie o primeiro lote, escreva a mensagem dele e escolha quem vai receber."
              acao={
                podeOperar ? (
                  <Botao variante="primario" icone="mais" onClick={() => setCriandoSlot(true)}>
                    Criar slot
                  </Botao>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grade-2">
            {slots.map((slot) => (
              <CartaoSlot
                key={slot.id}
                slot={slot}
                alvos={alvos.filter((a) => a.slot_id === slot.id)}
                aoAbrir={() => setSlotAberto(slot)}
              />
            ))}
          </div>
        )}
      </section>

      {criandoSlot && (
        <FormularioSlot
          campanha={campanha}
          proximaOrdem={slots.length + 1}
          aoFechar={() => setCriandoSlot(false)}
          aoSalvar={() => {
            setCriandoSlot(false);
            recarregar();
            toast.sucesso('Slot criado. Agora escolha os contatos.');
          }}
        />
      )}

      {slotAberto && (
        <OficinaSlot
          campanha={campanha}
          slot={slotAberto}
          podeOperar={podeOperar}
          aoFechar={() => {
            setSlotAberto(null);
            recarregar();
          }}
        />
      )}
    </>
  );
}

/* ==========================================================================
   Cartão de slot
   ========================================================================== */

function CartaoSlot({
  slot,
  alvos,
  aoAbrir,
}: {
  slot: CampaignSlot;
  alvos: CampaignTarget[];
  aoAbrir: () => void;
}) {
  const r = resumirSlot(alvos);
  const disparado = slot.status === 'disparado';

  return (
    <Card padding={false}>
      <div className="card-cabeca">
        <div style={{ minWidth: 0 }}>
          <div className="card-titulo truncar">{slot.nome}</div>
          <div className="card-sub">
            {r.total} {r.total === 1 ? 'contato' : 'contatos'}
            {disparado && slot.disparado_em ? ` · disparado ${tempoRelativo(slot.disparado_em)}` : ''}
          </div>
        </div>
        <Badge tom={disparado ? 'ok' : r.total > 0 ? 'alerta' : 'neutro'}>
          {disparado ? 'Disparado' : r.total > 0 ? 'Pronto' : 'Vazio'}
        </Badge>
      </div>

      <div style={{ padding: 20 }}>
        <div className="mensagem-bolha" style={{ fontSize: '.8125rem' }}>
          {slot.mensagem.slice(0, 180)}
          {slot.mensagem.length > 180 ? '…' : ''}
        </div>

        <div className="linha" style={{ gap: 14, marginTop: 12, fontSize: '.75rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--fg-dim)' }}>A enviar: {r.pendentes}</span>
          <span style={{ color: 'var(--fg-dim)' }}>Enviados: {r.enviados + r.respondidos}</span>
          <span style={{ color: r.semAutorizacao > 0 ? '#FF6070' : 'var(--fg-dim)' }}>
            IA: {r.autorizados}
          </span>
        </div>

        <Botao variante="secundario" bloco icone="colunas" onClick={aoAbrir} style={{ marginTop: 14 }}>
          {disparado ? 'Ver o slot' : 'Montar e revisar'}
        </Botao>
      </div>
    </Card>
  );
}

/* ==========================================================================
   Oficina do slot — seleção + revisão + confirmação
   ========================================================================== */

type Etapa = 'selecao' | 'revisao';

function OficinaSlot({
  campanha,
  slot,
  podeOperar,
  aoFechar,
}: {
  campanha: Campaign;
  slot: CampaignSlot;
  podeOperar: boolean;
  aoFechar: () => void;
}) {
  const toast = useToast();
  const [etapa, setEtapa] = useState<Etapa>('selecao');
  const [versao, setVersao] = useState(0);
  const recarregar = () => setVersao((v) => v + 1);

  const dados = useAsync(
    async () => {
      const [leads, alvos, preparados] = await Promise.all([
        db.leads.todos(),
        db.alvosCampanha.todos({ filtros: { campanha_id: campanha.id } }),
        prepararSlot(slot),
      ]);
      return { leads, alvos, preparados };
    },
    [slot.id, versao],
    null as null | { leads: Lead[]; alvos: CampaignTarget[]; preparados: ItemPreparado[] },
  );

  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);




  const estados: EstadoSelecao[] = useMemo(() => {
    if (!dados.dado) return [];
    return avaliarSelecao(dados.dado.leads, dados.dado.alvos, slot.id);
  }, [dados.dado, slot.id]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return estados;
    return estados.filter(
      (e) =>
        e.lead.nome.toLowerCase().includes(termo) ||
        (e.lead.empresa ?? '').toLowerCase().includes(termo) ||
        (e.lead.whatsapp ?? e.lead.telefone ?? '').includes(termo),
    );
  }, [estados, busca]);

  const bloqueios = useMemo(() => contarBloqueios(estados), [estados]);
  const disponiveis = visiveis.filter((e) => e.selecionavel && !e.jaNoSlot);

  const alternar = (leadId: string) => {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(leadId)) proximo.delete(leadId);
      else proximo.add(leadId);
      return proximo;
    });
  };

  const adicionar = useCallback(async () => {
    if (marcados.size === 0) return;
    setOcupado(true);
    try {
      const { atribuidos, recusados } = await atribuirAoSlot(campanha, slot, [...marcados]);
      toast.sucesso(
        `${atribuidos} ${atribuidos === 1 ? 'contato adicionado' : 'contatos adicionados'} ao slot.` +
          (recusados.length > 0 ? ` ${recusados.length} recusado(s).` : ''),
      );
      setMarcados(new Set());
      recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível adicionar.');
    } finally {
      setOcupado(false);
    }
  }, [marcados, campanha, slot, toast]);


  const confirmar = useCallback(async () => {
    setOcupado(true);
    try {
      // 0 = o servidor usa NINJABOT_CANAL_ID. O id do canal e configuracao
      // de servidor e nao precisa (nem deve) viajar pelo frontend.
      const r = await confirmarDisparoSlot(slot);

      // Zero trabalho NÃO é sucesso. Antes isto mostrava "0 contato(s)
      // registrados" num toast verde, o operador lia como concluído, e o
      // contato nunca chegava à whitelist — sem nenhuma pista do motivo.
      if (r.registrados === 0) {
        const porQue =
          r.totalNoSlot === 0
            ? 'Este slot não tem nenhum contato. Adicione leads antes de registrar.'
            : r.ignorados.length > 0
              ? `Nada foi registrado. ${r.ignorados
                  .slice(0, 3)
                  .map((i) => `${i.nome}: ${i.motivo}`)
                  .join(' · ')}${r.ignorados.length > 3 ? ` · e mais ${r.ignorados.length - 3}` : ''}`
              : 'Nada foi registrado e não há motivo declarado — isso é um bug, me avise.';
        toast.erro(porQue);
      } else if (r.falhasAutorizacao.length > 0) {
        toast.erro(
          `${r.registrados} registrado(s), mas ${r.falhasAutorizacao.length} SEM autorização da IA. ` +
            'O NinjaBot não vai assumir essas conversas. Use “Reautorizar” depois de conferir o canal.',
        );
      } else {
        toast.sucesso(
          `${r.registrados} contato(s) registrados e ${r.autorizados} autorizados na IA.` +
            (r.ignorados.length > 0 ? ` ${r.ignorados.length} pulado(s).` : ''),
        );
      }
      setConfirmando(false);
      recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível confirmar.');
    } finally {
      setOcupado(false);
    }
  }, [slot, toast]);

  const preparados = dados.dado?.preparados ?? [];

  const resumo = resumirSlot(preparados.map((p) => p.alvo));
  const repetidos = detectarTelefonesRepetidos(
    preparados.map((p) => ({ leadId: p.lead.id, telefone: p.telefone })),
  );

  return (
    <>
      <Modal
        aberto
        aoFechar={aoFechar}
        largo
        titulo={slot.nome}
        descricao={etapa === 'selecao' ? 'Escolha quem entra neste lote' : 'Revise antes de disparar'}
        rodape={
          <>
            <div className="linha" style={{ marginRight: 'auto', gap: 8 }}>
              <button
                type="button"
                className="chip"
                aria-pressed={etapa === 'selecao'}
                onClick={() => setEtapa('selecao')}
              >
                1. Selecionar
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={etapa === 'revisao'}
                onClick={() => setEtapa('revisao')}
              >
                2. Revisar ({resumo.total})
              </button>
            </div>

            {etapa === 'selecao' ? (
              <Botao
                variante="primario"
                icone="mais"
                onClick={() => void adicionar()}
                carregando={ocupado}
                disabled={marcados.size === 0 || !podeOperar}
              >
                Adicionar {marcados.size > 0 ? `${marcados.size} ao slot` : 'ao slot'}
              </Botao>
            ) : (
              podeOperar &&
              resumo.pendentes > 0 && (
                // Um caminho só: você envia pelo WhatsApp e registra aqui.
                // O botão "Disparar" saiu junto com a integração do NinjaBot.
                <Botao variante="primario" icone="check" onClick={() => setConfirmando(true)}>
                  Já enviei — registrar {resumo.pendentes}
                </Botao>
              )
            )}
          </>
        }
      >
        {dados.carregando ? (
          <Skeleton altura={320} />
        ) : etapa === 'selecao' ? (
          <div className="pilha" style={{ gap: 14 }}>
            <div className="linha-entre" style={{ flexWrap: 'wrap', gap: 10 }}>
              <CampoTexto
                className="busca"
                placeholder="Buscar por nome, empresa ou telefone"
                iconeEsquerda="busca"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar contatos"
              />
              <div className="linha" style={{ gap: 8 }}>
                <Botao
                  variante="fantasma"
                  tamanho="sm"
                  onClick={() => setMarcados(new Set(disponiveis.map((e) => e.lead.id)))}
                  disabled={disponiveis.length === 0}
                >
                  Marcar os {disponiveis.length} visíveis
                </Botao>
                {marcados.size > 0 && (
                  <Botao variante="fantasma" tamanho="sm" icone="x" onClick={() => setMarcados(new Set())}>
                    Limpar
                  </Botao>
                )}
              </div>
            </div>

            <div className="contador-selecao">
              <strong>{marcados.size}</strong> selecionado{marcados.size === 1 ? '' : 's'} ·{' '}
              {resumo.total} já no slot · {disponiveis.length} disponíveis
            </div>

            {Object.keys(bloqueios).length > 0 && (
              <Aviso tom="info">
                Fora da seleção:{' '}
                {(Object.entries(bloqueios) as [MotivoBloqueio, number][])
                  .map(([m, n]) => `${n} ${BLOQUEIO_TEXTO[m].toLowerCase()}`)
                  .join(' · ')}
                .
              </Aviso>
            )}

            <ul className="lista-selecao">
              {visiveis.slice(0, 200).map((e) => (
                <li key={e.lead.id} className={e.selecionavel ? '' : 'bloqueado'}>
                  <label className="check" style={{ width: '100%', gap: 12 }}>
                    <input
                      type="checkbox"
                      checked={marcados.has(e.lead.id)}
                      disabled={!e.selecionavel || e.jaNoSlot || !podeOperar}
                      onChange={() => alternar(e.lead.id)}
                    />
                    <Avatar nome={e.lead.nome} tamanho="sm" />
                    <span className="pilha" style={{ flex: 1, minWidth: 0 }}>
                      <span className="truncar" style={{ color: 'var(--fg)', fontWeight: 500 }}>
                        {e.lead.nome}
                      </span>
                      <span className="truncar" style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                        {e.lead.empresa ?? 'Sem empresa'} ·{' '}
                        {formatarTelefone(e.lead.whatsapp ?? e.lead.telefone)}
                      </span>
                    </span>
                    {e.jaNoSlot ? (
                      <Badge tom="ok">Neste slot</Badge>
                    ) : e.motivo ? (
                      <Badge tom="neutro">{BLOQUEIO_TEXTO[e.motivo]}</Badge>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>

            {visiveis.length > 200 && (
              <p className="campo-ajuda">
                Mostrando 200 de {visiveis.length}. Use a busca para achar o resto.
              </p>
            )}
          </div>
        ) : (
          <RevisaoSlot
            slot={slot}
            preparados={preparados}
            repetidos={repetidos.length}
            podeOperar={podeOperar}
            aoMudar={recarregar}
          />
        )}
      </Modal>

      <Confirmacao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        aoConfirmar={() => void confirmar()}
        titulo="Registrar o disparo"
        mensagem={
          `Isto NÃO envia mensagem. Confirme apenas se você já enviou as ${resumo.pendentes} ` +
          'mensagens pelo WhatsApp. Ao confirmar, os contatos ficam registrados como participantes ' +
          'e a IA do NinjaBot passa a ser autorizada a atendê-los.'
        }
        textoConfirmar="Já enviei, registrar"
        processando={ocupado}
      />
    </>
  );
}

/* ==========================================================================
   Revisão
   ========================================================================== */

function RevisaoSlot({
  slot,
  preparados,
  repetidos,
  podeOperar,
  aoMudar,
}: {
  slot: CampaignSlot;
  preparados: ItemPreparado[];
  repetidos: number;
  podeOperar: boolean;
  aoMudar: () => void;
}) {
  const toast = useToast();
  const [editando, setEditando] = useState<ItemPreparado | null>(null);
  const [texto, setTexto] = useState('');

  const salvarMensagem = useCallback(async () => {
    if (!editando) return;
    try {
      await definirMensagemDoContato(editando.alvo, texto);
      toast.sucesso(`Mensagem personalizada para ${editando.lead.nome.split(' ')[0]}.`);
      setEditando(null);
      aoMudar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    }
  }, [editando, texto, toast, aoMudar]);

  const remover = useCallback(
    async (item: ItemPreparado) => {
      try {
        await removerDoSlot(item.alvo);
        toast.sucesso('Contato removido do slot.');
        aoMudar();
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Não foi possível remover.');
      }
    },
    [toast, aoMudar],
  );

  const regerar = useCallback(async () => {
    try {
      const n = await regerarMensagens(slot);
      toast.sucesso(`${n} mensagem(ns) regerada(s) a partir do modelo do slot.`);
      aoMudar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível regerar.');
    }
  }, [slot, toast, aoMudar]);

  if (preparados.length === 0) {
    return (
      <Vazio
        icone="leads"
        titulo="Nenhum contato neste slot"
        descricao="Volte para a etapa 1 e selecione quem vai receber."
      />
    );
  }

  return (
    <>
      <div className="pilha" style={{ gap: 14 }}>
        {(() => {
          // Variavel vazia deixa a frase quebrada ("sobre a ."), e isso nao
          // tem conserto automatico: o artigo pendurado e do modelo.
          const comBuraco = preparados.filter(
            (i) => !i.alvo.mensagem_final || variaveisVazias(slot.mensagem, i.lead).length > 0,
          ).filter((i) => variaveisVazias(slot.mensagem, i.lead).length > 0);
          if (comBuraco.length === 0) return null;
          return (
            <Aviso tom="alerta">
              <strong>{comBuraco.length} contato(s) com variável vazia.</strong> A mensagem sai
              incompleta para eles (ex.: “sobre a .”). Ajuste o texto do slot, preencha o cadastro
              ou escreva uma mensagem individual.
            </Aviso>
          );
        })()}

        {repetidos > 0 && (
          <Aviso tom="alerta">
            <strong>{repetidos} número(s) repetido(s) no slot.</strong> Dois leads diferentes com o
            mesmo telefone — a pessoa receberia a mensagem duas vezes. Remova um deles.
          </Aviso>
        )}

        {podeOperar && (
          <div className="linha" style={{ justifyContent: 'flex-end' }}>
            <Botao variante="fantasma" tamanho="sm" icone="atualizar" onClick={() => void regerar()}>
              Regerar mensagens do modelo
            </Botao>
          </div>
        )}

        {preparados.map((item) => {
          const enviado = item.alvo.status === 'enviado' || item.alvo.status === 'respondido';
          const personalizada = item.alvo.observacao === 'mensagem personalizada';

          return (
            <div key={item.alvo.id} className={`lote-item ${enviado ? 'tratado' : ''}`}>
              <div className="linha-entre" style={{ alignItems: 'flex-start' }}>
                <div className="pilha" style={{ minWidth: 0 }}>
                  <span className="truncar" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                    {item.lead.nome}
                  </span>
                  <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                    {item.lead.empresa ?? 'Sem empresa'} · {formatarTelefone(item.telefone)}
                  </span>
                </div>
                <div className="linha" style={{ gap: 6 }}>
                  {personalizada && <Badge tom="info">Personalizada</Badge>}
                  {enviado && <Badge tom="ok">Registrado</Badge>}
                  {item.alvo.ia_autorizada && <Badge tom="ok">IA liberada</Badge>}
                </div>
              </div>

              <div className="mensagem-bolha" style={{ marginTop: 10, fontSize: '.8125rem' }}>
                {item.mensagem}
              </div>

              {!enviado && podeOperar && (
                <div className="linha" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {item.link ? (
                    <a
                      className="btn btn-secundario btn-sm"
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon nome="whatsapp" />
                      Abrir conversa
                    </a>
                  ) : (
                    <Badge tom="erro">Número inválido</Badge>
                  )}
                  <Botao
                    tamanho="sm"
                    variante="fantasma"
                    icone="editar"
                    onClick={() => {
                      setEditando(item);
                      setTexto(item.mensagem);
                    }}
                  >
                    Mensagem só para este
                  </Botao>
                  <BotaoIcone
                    icone="lixeira"
                    rotulo={`Remover ${item.lead.nome} do slot`}
                    onClick={() => void remover(item)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editando && (
        <Modal
          aberto
          aoFechar={() => setEditando(null)}
          titulo={`Mensagem para ${editando.lead.nome}`}
          descricao="Só este contato recebe este texto."
          rodape={
            <>
              <Botao variante="fantasma" onClick={() => setEditando(null)}>
                Cancelar
              </Botao>
              <Botao variante="primario" onClick={() => void salvarMensagem()}>
                Salvar
              </Botao>
            </>
          }
        >
          <CampoTextarea
            rotulo="Mensagem"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            maxLength={4000}
            ajuda="O texto já vem com as variáveis resolvidas. Edite livremente."
          />
        </Modal>
      )}
    </>
  );
}

/* ==========================================================================
   Formulário de slot
   ========================================================================== */

function FormularioSlot({
  campanha,
  proximaOrdem,
  aoFechar,
  aoSalvar,
}: {
  campanha: Campaign;
  proximaOrdem: number;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(`Slot ${proximaOrdem}`);
  const [mensagem, setMensagem] = useState(campanha.mensagem);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (mensagem.trim().length < 20) {
      setErro('A mensagem precisa de pelo menos 20 caracteres.');
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await criarSlot(campanha, { nome, mensagem });
      aoSalvar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível criar o slot.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      largo
      titulo="Novo slot"
      descricao="Cada slot tem sua própria mensagem e seus próprios contatos."
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            Criar slot
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoTexto
          className="col-inteira"
          rotulo="Nome do slot"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={80}
          autoFocus
        />
        <CampoTextarea
          className="col-inteira"
          rotulo="Mensagem deste slot"
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          erro={erro ?? undefined}
          rows={5}
          maxLength={1200}
          ajuda={`Variáveis: ${VARIAVEIS_DISPONIVEIS.join(' · ')}`}
        />
      </div>
    </Modal>
  );
}


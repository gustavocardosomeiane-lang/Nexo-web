/**
 * Automacoes — o funil desenhado, do disparo ao pos-venda.
 *
 * Cada etapa mostra o numero real do banco. Onde a etapa depende de uma
 * integracao que ainda nao existe (NinjaBot, gateway), isso e dito na propria
 * etapa em vez de exibir um numero inventado.
 */

import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { valorLiquido } from '@/data/analytics';
import { brl } from '@/lib/format';
import { Aviso, Badge, Card, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { Icon, type NomeIcone } from '@/components/ui/Icon';
import { gatewayConfigurado } from '@/integrations/payments';
import { ninjaBotConfigurado } from '@/integrations/ninjabot';

interface Etapa {
  chave: string;
  titulo: string;
  descricao: string;
  icone: NomeIcone;
  numero: number;
  unidade: string;
  /** `false` quando a etapa depende de integração ainda inexistente. */
  ativa: boolean;
  nota?: string;
  link?: string;
}

export function Automacoes() {
  const carregar = useCallback(async () => {
    const [leads, conversas, vendas, pagamentos, clientes, projetos] = await Promise.all([
      db.leads.todos(),
      db.conversas.todos(),
      db.vendas.todos(),
      db.pagamentos.todos(),
      db.clientes.todos(),
      db.projetos.todos(),
    ]);

    const respondeu = conversas.filter((c) => c.status !== 'aguardando_resposta' && c.status !== 'sem_resposta');
    const qualificados = leads.filter((l) =>
      ['qualificado', 'proposta_enviada', 'negociacao', 'pagamento_pendente', 'cliente'].includes(l.status),
    );
    const propostas = leads.filter((l) =>
      ['proposta_enviada', 'negociacao', 'pagamento_pendente'].includes(l.status),
    );
    const fechadas = vendas.filter((v) => v.status !== 'orcamento' && v.status !== 'cancelado');
    const pagas = pagamentos.filter((p) => p.status === 'pago');
    const entregues = projetos.filter((p) => p.status === 'entregue' || p.status === 'concluido');

    return {
      disparos: conversas.length,
      respondeu: respondeu.length,
      emIA: conversas.filter((c) => c.status === 'em_atendimento').length,
      qualificados: qualificados.length,
      propostas: propostas.length,
      vendas: fechadas.length,
      recebido: pagas.reduce((s, p) => s + p.valor, 0),
      contratado: fechadas.reduce((s, v) => s + valorLiquido(v), 0),
      clientes: clientes.length,
      projetos: projetos.length,
      entregues: entregues.length,
    };
  }, []);

  const { dado, carregando } = useAsync(carregar, [], {
    disparos: 0,
    respondeu: 0,
    emIA: 0,
    qualificados: 0,
    propostas: 0,
    vendas: 0,
    recebido: 0,
    contratado: 0,
    clientes: 0,
    projetos: 0,
    entregues: 0,
  });

  const etapas: Etapa[] = [
    {
      chave: 'disparo',
      titulo: 'Disparo',
      descricao: 'O NinjaBot envia a primeira mensagem para a lista da campanha.',
      icone: 'enviar',
      numero: dado.disparos,
      unidade: 'conversas iniciadas',
      ativa: ninjaBotConfigurado,
      nota: ninjaBotConfigurado ? undefined : 'Depende da integração com o NinjaBot.',
      link: '/conversas',
    },
    {
      chave: 'resposta',
      titulo: 'Lead responde',
      descricao: 'Quem responde vira lead no CRM e entra no funil.',
      icone: 'conversas',
      numero: dado.respondeu,
      unidade: 'responderam',
      ativa: true,
      link: '/conversas',
    },
    {
      chave: 'ia',
      titulo: 'IA inicia a conversa',
      descricao: 'A IA do NinjaBot conduz o atendimento e levanta a necessidade.',
      icone: 'robo',
      numero: dado.emIA,
      unidade: 'em atendimento',
      ativa: ninjaBotConfigurado,
      nota: ninjaBotConfigurado ? undefined : 'Depende da integração com o NinjaBot.',
    },
    {
      chave: 'qualificacao',
      titulo: 'Lead qualificado',
      descricao: 'Tem necessidade, orçamento e decisão. Vale proposta.',
      icone: 'alvo',
      numero: dado.qualificados,
      unidade: 'qualificados',
      ativa: true,
      link: '/leads',
    },
    {
      chave: 'proposta',
      titulo: 'Proposta',
      descricao: 'Serviço, valor e prazo enviados ao lead.',
      icone: 'relatorios',
      numero: dado.propostas,
      unidade: 'em negociação',
      ativa: true,
      link: '/leads',
    },
    {
      chave: 'checkout',
      titulo: 'Checkout',
      descricao: 'Link de pagamento gerado pelo gateway, com PIX ou cartão.',
      icone: 'pagamentos',
      numero: 0,
      unidade: 'checkouts',
      ativa: gatewayConfigurado,
      nota: gatewayConfigurado ? undefined : 'Nenhum gateway contratado — hoje a cobrança é manual.',
    },
    {
      chave: 'pagamento',
      titulo: 'Pagamento',
      descricao: 'O gateway confirma e o webhook atualiza venda, parcela e pagamento.',
      icone: 'financeiro',
      numero: dado.recebido,
      unidade: 'recebido',
      ativa: true,
      link: '/pagamentos',
    },
    {
      chave: 'cliente',
      titulo: 'Cliente',
      descricao: 'Venda confirmada: o lead vira cliente na carteira.',
      icone: 'clientes',
      numero: dado.clientes,
      unidade: 'clientes',
      ativa: true,
      link: '/clientes',
    },
    {
      chave: 'projeto',
      titulo: 'Projeto',
      descricao: 'A execução começa: briefing, design, desenvolvimento e entrega.',
      icone: 'projetos',
      numero: dado.projetos,
      unidade: 'projetos',
      ativa: true,
      link: '/projetos',
    },
    {
      chave: 'posvenda',
      titulo: 'Pós-venda',
      descricao: 'Entregue o site, o NinjaBot conduz o acompanhamento e a recompra.',
      icone: 'sucesso',
      numero: dado.entregues,
      unidade: 'entregues',
      ativa: ninjaBotConfigurado,
      nota: ninjaBotConfigurado ? undefined : 'Depende da integração com o NinjaBot.',
    },
  ];

  const conversaoDisparo = dado.disparos > 0 ? (dado.respondeu / dado.disparos) * 100 : 0;
  const conversaoVenda = dado.qualificados > 0 ? (dado.vendas / dado.qualificados) * 100 : 0;

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Fluxo</Eyebrow>
          <h1 className="pagina-titulo">Automações</h1>
          <p className="pagina-descricao">
            O caminho completo que um contato percorre até virar projeto entregue. Os números vêm do
            banco; as etapas que dependem de integração ainda não conectada estão marcadas.
          </p>
        </div>
      </header>

      {(!ninjaBotConfigurado || !gatewayConfigurado) && (
        <Aviso tom="info" className="secao-aviso">
          <strong>Fluxo parcialmente automatizado.</strong> Falta conectar{' '}
          {!ninjaBotConfigurado && 'o NinjaBot'}
          {!ninjaBotConfigurado && !gatewayConfigurado && ' e '}
          {!gatewayConfigurado && 'o gateway de pagamento'}. As etapas dependentes seguem sendo
          feitas à mão, e o painel registra tudo do mesmo jeito. Ver{' '}
          <Link to="/configuracoes" style={{ textDecoration: 'underline' }}>
            Configurações › Integrações
          </Link>
          .
        </Aviso>
      )}

      <div className="grade-2 secao">
        <Card>
          <div className="stat-rotulo">Taxa de resposta ao disparo</div>
          <div className="stat-valor" style={{ marginTop: 8 }}>
            {conversaoDisparo.toFixed(1).replace('.', ',')}%
          </div>
          <div className="stat-rodape">
            {dado.respondeu} de {dado.disparos} conversas iniciadas
          </div>
        </Card>
        <Card>
          <div className="stat-rotulo">Qualificado → venda</div>
          <div className="stat-valor" style={{ marginTop: 8 }}>
            {conversaoVenda.toFixed(1).replace('.', ',')}%
          </div>
          <div className="stat-rodape">
            {dado.vendas} vendas · {brl(dado.contratado)} contratados
          </div>
        </Card>
      </div>

      <section className="secao">
        <Card padding={false}>
          <div className="card-cabeca">
            <div>
              <div className="card-titulo">O funil, etapa por etapa</div>
              <div className="card-sub">Do disparo ao pós-venda</div>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {carregando ? (
              <Skeleton altura={420} />
            ) : (
              <div className="funil">
                {etapas.map((e) => (
                  <div key={e.chave} className={`funil-etapa ${e.ativa ? 'ativa' : 'pendente'}`}>
                    <div className="funil-no">
                      <Icon nome={e.icone} />
                    </div>
                    <div className="funil-corpo">
                      <div className="linha" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span className="funil-titulo">{e.titulo}</span>
                        {!e.ativa && <Badge tom="neutro">Aguardando integração</Badge>}
                      </div>
                      <p className="funil-desc">{e.descricao}</p>

                      {e.ativa ? (
                        <div className="linha" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <span className="funil-metrica">
                            <span className="funil-numero">
                              {e.unidade === 'recebido' ? brl(e.numero) : e.numero}
                            </span>
                            <span className="funil-unidade">
                              {e.unidade === 'recebido' ? 'recebido' : e.unidade}
                            </span>
                          </span>
                          {e.link && (
                            <Link to={e.link} className="btn btn-fantasma btn-sm">
                              Abrir
                            </Link>
                          )}
                        </div>
                      ) : (
                        <p className="campo-ajuda" style={{ marginTop: 8 }}>
                          {e.nota}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </section>
    </>
  );
}

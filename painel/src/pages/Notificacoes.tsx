/**
 * Central de notificacoes.
 *
 * As notificacoes nascem de fatos: venda registrada, pagamento confirmado
 * pelo webhook, parcela vencendo, projeto perto do prazo. Nenhuma e decorativa.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/data';
import { useColecao } from '@/hooks/useColecao';
import { useToast } from '@/components/ui/Toast';
import type { Notification, NotificationSeverity } from '@/types';
import { formatarDataHora, tempoRelativo } from '@/lib/format';
import { Aviso, Botao, Card, Eyebrow, Skeleton, Vazio } from '@/components/ui/primitives';
import { Icon, type NomeIcone } from '@/components/ui/Icon';
import { Paginacao } from '@/components/ui/Pagination';

const ICONE: Record<Notification['tipo'], NomeIcone> = {
  nova_venda: 'vendas',
  pagamento_aprovado: 'sucesso',
  pagamento_recusado: 'erro',
  pagamento_pendente: 'relogio',
  parcela_vencendo: 'calendario',
  lead_respondeu: 'conversas',
  novo_cliente: 'clientes',
  projeto_prazo: 'projetos',
};

const TOM: Record<NotificationSeverity, string> = {
  sucesso: 'ok',
  alerta: 'alerta',
  erro: 'erro',
  info: 'info',
};

export function Notificacoes() {
  const toast = useToast();
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false);

  const colecao = useColecao<Notification>(db.notificacoes, {
    porPagina: 25,
    ordenarPor: 'criado_em',
    filtrosIniciais: {},
  });

  const visiveis = useMemo(
    () => (somenteNaoLidas ? colecao.itens.filter((n) => !n.lida) : colecao.itens),
    [colecao.itens, somenteNaoLidas],
  );

  const naoLidas = useMemo(() => colecao.itens.filter((n) => !n.lida).length, [colecao.itens]);

  const marcarTodas = useCallback(async () => {
    try {
      await db.marcarNotificacoesLidas();
      toast.sucesso('Todas as notificações foram marcadas como lidas.');
      colecao.recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    }
  }, [toast, colecao]);

  const marcarUma = useCallback(
    async (n: Notification) => {
      if (n.lida) return;
      try {
        await db.notificacoes.atualizar(n.id, { lida: true });
        colecao.recarregar();
      } catch {
        /* silencioso: marcar como lida não é uma ação crítica */
      }
    },
    [colecao],
  );

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Alertas</Eyebrow>
          <h1 className="pagina-titulo">Notificações</h1>
          <p className="pagina-descricao">
            O que aconteceu na operação enquanto você não estava olhando. Escolha em Configurações
            quais eventos geram alerta.
          </p>
        </div>
        <div className="pagina-acoes">
          <Botao
            variante="secundario"
            aria-pressed={somenteNaoLidas}
            onClick={() => setSomenteNaoLidas((v) => !v)}
          >
            {somenteNaoLidas ? 'Ver todas' : `Só não lidas${naoLidas > 0 ? ` (${naoLidas})` : ''}`}
          </Botao>
          {naoLidas > 0 && (
            <Botao variante="primario" icone="check" onClick={() => void marcarTodas()}>
              Marcar todas como lidas
            </Botao>
          )}
        </div>
      </header>

      {colecao.erro && <Aviso tom="erro">{colecao.erro}</Aviso>}

      {colecao.carregando ? (
        <Card>
          <Skeleton altura={220} />
        </Card>
      ) : visiveis.length === 0 ? (
        <Card>
          <Vazio
            icone="notificacoes"
            titulo={somenteNaoLidas ? 'Nenhuma notificação não lida' : 'Nenhuma notificação'}
            descricao="Vendas, pagamentos e prazos aparecerão aqui automaticamente."
          />
        </Card>
      ) : (
        <ul className="notificacoes">
          {visiveis.map((n) => {
            const conteudo = (
              <>
                <span className={`notif-icone notif-${TOM[n.severidade]}`}>
                  <Icon nome={ICONE[n.tipo]} />
                </span>
                <div className="notif-corpo">
                  <div className="notif-titulo">
                    {n.titulo}
                    {!n.lida && <span className="notif-ponto" aria-label="Não lida" />}
                  </div>
                  <p className="notif-descricao">{n.descricao}</p>
                  <time className="notif-hora" dateTime={n.criado_em} title={formatarDataHora(n.criado_em)}>
                    {tempoRelativo(n.criado_em)}
                  </time>
                </div>
              </>
            );

            return (
              <li key={n.id} className={n.lida ? 'lida' : ''}>
                {n.link ? (
                  <Link to={n.link} className="notif-item" onClick={() => void marcarUma(n)}>
                    {conteudo}
                    <Icon nome="direita" tamanho={15} />
                  </Link>
                ) : (
                  <button type="button" className="notif-item" onClick={() => void marcarUma(n)}>
                    {conteudo}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Paginacao
        pagina={colecao.pagina}
        porPagina={colecao.porPagina}
        total={colecao.total}
        aoMudar={colecao.setPagina}
        rotuloItem="notificações"
      />
    </>
  );
}

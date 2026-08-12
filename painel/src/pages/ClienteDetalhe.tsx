/**
 * Ficha do cliente: tudo que aconteceu com ele em um lugar so.
 *
 * Carrega as colecoes em paralelo e cruza pelos ids — e o que uma consulta
 * com JOIN faria no banco. Quando o volume justificar, isto vira uma VIEW no
 * Postgres e este arquivo so troca a origem dos dados.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '@/data';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { veValores } from '@/auth/permissions';
import type { Client, Conversation, Installment, Payment, Project, Sale, Service } from '@/types';
import { brl, formatarData, formatarDataHora, formatarTelefone, tempoRelativo, whatsappLink } from '@/lib/format';
import { valorLiquido } from '@/data/analytics';
import { Avatar, Botao, Card, Eyebrow, Progresso, Skeleton, Vazio } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { StatCard } from '@/components/dominio/StatCard';
import {
  FORMA_PAGAMENTO,
  StatusConversa,
  StatusPagamento,
  StatusProjeto,
  StatusVenda,
} from '@/components/dominio/StatusBadge';
import { FormularioCliente } from './Clientes';

interface Ficha {
  cliente: Client | null;
  vendas: Sale[];
  pagamentos: Payment[];
  parcelas: Installment[];
  projetos: Project[];
  conversas: Conversation[];
  servicos: Map<string, Service>;
}

const FICHA_VAZIA: Ficha = {
  cliente: null,
  vendas: [],
  pagamentos: [],
  parcelas: [],
  projetos: [],
  conversas: [],
  servicos: new Map(),
};

type Aba = 'vendas' | 'pagamentos' | 'projetos' | 'conversas';

export function ClienteDetalhe() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const { usuario, pode } = useAuth();
  const [aba, setAba] = useState<Aba>('vendas');
  const [editando, setEditando] = useState(false);

  const mostraValores = veValores(usuario?.role);

  const carregar = useCallback(async (): Promise<Ficha> => {
    const cliente = await db.clientes.obter(id);
    if (!cliente) return FICHA_VAZIA;

    const [vendas, pagamentos, projetos, conversas, servicos] = await Promise.all([
      db.vendas.todos({ filtros: { cliente_id: id } }),
      db.pagamentos.todos({ filtros: { cliente_id: id } }),
      db.projetos.todos({ filtros: { cliente_id: id } }),
      db.conversas.todos({ filtros: { cliente_id: id } }),
      db.servicos.todos(),
    ]);

    // Parcelas não têm cliente_id: chegam pelas vendas dele.
    const idsVenda = new Set(vendas.map((v) => v.id));
    const todasParcelas = await db.parcelas.todos();
    const parcelas = todasParcelas.filter((p) => idsVenda.has(p.venda_id));

    return {
      cliente,
      vendas,
      pagamentos,
      parcelas,
      projetos,
      conversas,
      servicos: new Map(servicos.map((s) => [s.id, s])),
    };
  }, [id]);

  const { dado, carregando, erro, recarregar } = useAsync(carregar, [id], FICHA_VAZIA);
  const { cliente, vendas, pagamentos, parcelas, projetos, conversas, servicos } = dado;

  if (carregando) {
    return (
      <div className="pilha" style={{ gap: 16 }}>
        <Skeleton altura={96} />
        <Skeleton altura={220} />
      </div>
    );
  }

  if (erro || !cliente) {
    return (
      <Card>
        <Vazio
          icone="clientes"
          titulo="Cliente não encontrado"
          descricao={erro ?? 'O cliente pode ter sido removido.'}
          acao={
            <Botao variante="secundario" icone="esquerda" onClick={() => navegar('/clientes')}>
              Voltar para a lista
            </Botao>
          }
        />
      </Card>
    );
  }

  const faturado = vendas
    .filter((v) => v.status !== 'orcamento' && v.status !== 'cancelado')
    .reduce((s, v) => s + valorLiquido(v), 0);
  const recebido = pagamentos.filter((p) => p.status === 'pago').reduce((s, p) => s + p.valor, 0);
  const emAberto = pagamentos
    .filter((p) => p.status === 'pendente' || p.status === 'atrasado')
    .reduce((s, p) => s + p.valor, 0);

  const wa = whatsappLink(cliente.whatsapp);

  return (
    <>
      <nav className="migalhas" aria-label="Trilha de navegação">
        <Link to="/clientes">Clientes</Link>
        <Icon nome="direita" tamanho={13} />
        <span>{cliente.empresa ?? cliente.nome}</span>
      </nav>

      <header className="pagina-cabeca">
        <div className="linha" style={{ gap: 14, alignItems: 'flex-start' }}>
          <Avatar nome={cliente.empresa ?? cliente.nome} tamanho="lg" />
          <div>
            <Eyebrow>Cliente desde {formatarData(cliente.criado_em)}</Eyebrow>
            <h1 className="pagina-titulo">{cliente.empresa ?? cliente.nome}</h1>
            <p className="pagina-descricao">
              {cliente.empresa ? `${cliente.nome} · ` : ''}
              {formatarTelefone(cliente.telefone)}
              {cliente.email ? ` · ${cliente.email}` : ''}
              {cliente.cidade ? ` · ${cliente.cidade}${cliente.estado ? `/${cliente.estado}` : ''}` : ''}
            </p>
          </div>
        </div>

        <div className="pagina-acoes">
          {wa && (
            <a className="btn btn-secundario" href={wa} target="_blank" rel="noopener noreferrer">
              <Icon nome="whatsapp" />
              WhatsApp
            </a>
          )}
          {pode('clientes', 'editar') && (
            <Botao variante="primario" icone="editar" onClick={() => setEditando(true)}>
              Editar
            </Botao>
          )}
        </div>
      </header>

      {mostraValores && (
        <div className="grade-kpi">
          <StatCard rotulo="Total faturado" valor={brl(faturado)} icone="financeiro" destaque />
          <StatCard rotulo="Recebido" valor={brl(recebido)} icone="sucesso" />
          <StatCard rotulo="Em aberto" valor={brl(emAberto)} icone="relogio" />
          <StatCard rotulo="Projetos" valor={String(projetos.length)} icone="projetos" />
        </div>
      )}

      {cliente.observacoes && (
        <Card className="secao">
          <div className="card-titulo" style={{ marginBottom: 6 }}>
            Observações
          </div>
          <p style={{ fontSize: '.8438rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {cliente.observacoes}
          </p>
        </Card>
      )}

      <div className="secao">
        <div className="abas" role="tablist" aria-label="Histórico do cliente">
          {(
            [
              ['vendas', 'Vendas', vendas.length],
              ['pagamentos', 'Pagamentos e parcelas', pagamentos.length],
              ['projetos', 'Projetos', projetos.length],
              ['conversas', 'Conversas', conversas.length],
            ] as [Aba, string, number][]
          ).map(([chave, rotulo, contador]) => (
            <button
              key={chave}
              type="button"
              role="tab"
              className="aba"
              aria-selected={aba === chave}
              onClick={() => setAba(chave)}
            >
              {rotulo}
              <span className="aba-contador">{contador}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16 }} role="tabpanel">
          {aba === 'vendas' &&
            (vendas.length === 0 ? (
              <Card>
                <Vazio icone="vendas" titulo="Nenhuma venda registrada" />
              </Card>
            ) : (
              <Card padding={false}>
                <ul className="lista-simples">
                  {vendas.map((v) => (
                    <li key={v.id}>
                      <div className="pilha" style={{ minWidth: 0 }}>
                        <span style={{ color: 'var(--fg)', fontWeight: 600 }}>
                          {v.codigo} · {v.servico_id ? servicos.get(v.servico_id)?.nome ?? '—' : '—'}
                        </span>
                        <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                          {formatarData(v.data)} · {FORMA_PAGAMENTO[v.forma_pagamento]} ·{' '}
                          {v.parcelas}× {v.desconto > 0 ? `· desconto de ${brl(v.desconto)}` : ''}
                        </span>
                      </div>
                      <div className="linha" style={{ gap: 12 }}>
                        {mostraValores && (
                          <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{brl(valorLiquido(v))}</span>
                        )}
                        <StatusVenda status={v.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

          {aba === 'pagamentos' &&
            (parcelas.length === 0 ? (
              <Card>
                <Vazio icone="pagamentos" titulo="Nenhuma parcela lançada" />
              </Card>
            ) : (
              <Card padding={false}>
                <ul className="lista-simples">
                  {[...parcelas]
                    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
                    .map((p) => {
                      const venda = vendas.find((v) => v.id === p.venda_id);
                      return (
                        <li key={p.id}>
                          <div className="pilha" style={{ minWidth: 0 }}>
                            <span style={{ color: 'var(--fg)', fontWeight: 500 }}>
                              {venda?.codigo ?? '—'} · parcela {p.numero}/{p.total_parcelas}
                            </span>
                            <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                              Vence em {formatarData(p.vencimento)}
                              {p.pago_em ? ` · pago em ${formatarData(p.pago_em)}` : ''}
                            </span>
                          </div>
                          <div className="linha" style={{ gap: 12 }}>
                            {mostraValores && (
                              <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{brl(p.valor)}</span>
                            )}
                            <StatusPagamento status={p.status} />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </Card>
            ))}

          {aba === 'projetos' &&
            (projetos.length === 0 ? (
              <Card>
                <Vazio icone="projetos" titulo="Nenhum projeto para este cliente" />
              </Card>
            ) : (
              <div className="grade-2">
                {projetos.map((p) => (
                  <Card key={p.id}>
                    <div className="linha-entre" style={{ marginBottom: 10 }}>
                      <span style={{ color: 'var(--fg)', fontWeight: 600 }} className="truncar">
                        {p.nome}
                      </span>
                      <StatusProjeto status={p.status} />
                    </div>
                    <Progresso valor={p.progresso} rotulo={`${p.nome}: ${p.progresso}% concluído`} />
                    <div
                      className="linha-entre"
                      style={{ marginTop: 10, fontSize: '.75rem', color: 'var(--fg-dim)' }}
                    >
                      <span>Entrega {formatarData(p.prazo)}</span>
                      <span>{p.progresso}%</span>
                    </div>
                  </Card>
                ))}
              </div>
            ))}

          {aba === 'conversas' &&
            (conversas.length === 0 ? (
              <Card>
                <Vazio
                  icone="conversas"
                  titulo="Nenhuma conversa registrada"
                  descricao="As conversas aparecerão aqui quando a integração com o NinjaBot estiver ativa."
                />
              </Card>
            ) : (
              <Card padding={false}>
                <ul className="lista-simples">
                  {conversas.map((c) => (
                    <li key={c.id}>
                      <div className="pilha" style={{ minWidth: 0 }}>
                        <span className="truncar" style={{ color: 'var(--fg)' }}>
                          {c.ultima_mensagem ?? 'Sem mensagens'}
                        </span>
                        <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                          {c.campanha ?? 'Sem campanha'} · {formatarDataHora(c.ultima_mensagem_em)} (
                          {tempoRelativo(c.ultima_mensagem_em)})
                        </span>
                      </div>
                      <StatusConversa status={c.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </div>
      </div>

      {editando && (
        <FormularioCliente
          cliente={cliente}
          aoFechar={() => setEditando(false)}
          aoSalvar={() => {
            setEditando(false);
            recarregar();
          }}
        />
      )}
    </>
  );
}

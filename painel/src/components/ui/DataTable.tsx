/**
 * Tabela generica dirigida por configuracao de colunas.
 *
 * Toda listagem do painel (leads, clientes, vendas, pagamentos, parcelas,
 * servicos, projetos) usa esta mesma tabela. Uma correcao de acessibilidade ou
 * de responsividade aqui vale para o sistema inteiro.
 *
 * No celular a tabela nao encolhe: ela vira uma lista de cartoes, porque
 * tabela de 8 colunas em 375px nao e usavel de jeito nenhum.
 */

import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { SkeletonTabela, Vazio } from './primitives';

export interface Coluna<T> {
  chave: string;
  titulo: string;
  /** Conteudo da celula. */
  render: (item: T) => ReactNode;
  /** Campo real usado na ordenacao pelo servidor. Ausente = coluna nao ordena. */
  ordenarPor?: keyof T & string;
  alinharDireita?: boolean;
  /** Colunas secundarias somem no celular para o cartao nao virar parede. */
  ocultarNoMobile?: boolean;
  largura?: string;
}

interface Props<T> {
  colunas: Coluna<T>[];
  itens: T[];
  chaveDe: (item: T) => string;
  carregando?: boolean;
  aoClicar?: (item: T) => void;
  ordenarPor?: string;
  ordem?: 'asc' | 'desc';
  aoOrdenar?: (campo: string) => void;
  vazioTitulo?: string;
  vazioDescricao?: string;
  vazioAcao?: ReactNode;
}

export function DataTable<T>({
  colunas,
  itens,
  chaveDe,
  carregando = false,
  aoClicar,
  ordenarPor,
  ordem = 'desc',
  aoOrdenar,
  vazioTitulo = 'Nenhum registro encontrado',
  vazioDescricao = 'Ajuste os filtros ou cadastre o primeiro item.',
  vazioAcao,
}: Props<T>) {
  if (carregando) return <SkeletonTabela colunas={Math.min(colunas.length, 6)} />;

  if (itens.length === 0) {
    return (
      <div className="card">
        <Vazio icone="busca" titulo={vazioTitulo} descricao={vazioDescricao} acao={vazioAcao} />
      </div>
    );
  }

  return (
    <>
      {/* ---- Tabela: tablet e desktop ---- */}
      <div className="tabela-envolucro esconder-mobile">
        <table className="tabela">
          <thead>
            <tr>
              {colunas.map((c) => {
                const ativa = ordenarPor === c.ordenarPor;
                const podeOrdenar = Boolean(c.ordenarPor && aoOrdenar);
                return (
                  <th
                    key={c.chave}
                    className={[
                      podeOrdenar ? 'ordenavel' : '',
                      c.alinharDireita ? 'num' : '',
                      c.ocultarNoMobile ? 'col-secundaria' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={c.largura ? { width: c.largura } : undefined}
                    aria-sort={ativa ? (ordem === 'asc' ? 'ascending' : 'descending') : undefined}
                    onClick={podeOrdenar ? () => aoOrdenar?.(c.ordenarPor as string) : undefined}
                  >
                    {podeOrdenar ? (
                      <button
                        type="button"
                        style={{ font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
                      >
                        {c.titulo}
                        <span className="seta" aria-hidden="true">
                          {ativa ? (ordem === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr
                key={chaveDe(item)}
                className={aoClicar ? 'clicavel' : ''}
                onClick={aoClicar ? () => aoClicar(item) : undefined}
                onKeyDown={
                  aoClicar
                    ? (e) => {
                        if (e.key === 'Enter') aoClicar(item);
                      }
                    : undefined
                }
                tabIndex={aoClicar ? 0 : undefined}
              >
                {colunas.map((c) => (
                  <td
                    key={c.chave}
                    className={[c.alinharDireita ? 'num' : '', c.ocultarNoMobile ? 'col-secundaria' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {c.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Cartões: celular ---- */}
      <div className="lista-cartoes mostrar-mobile">
        {itens.map((item) => {
          const [principal, ...demais] = colunas;
          return (
            <div
              key={chaveDe(item)}
              className={`cartao-linha ${aoClicar ? 'clicavel' : ''}`}
              onClick={aoClicar ? () => aoClicar(item) : undefined}
              onKeyDown={
                aoClicar
                  ? (e) => {
                      if (e.key === 'Enter') aoClicar(item);
                    }
                  : undefined
              }
              tabIndex={aoClicar ? 0 : undefined}
              role={aoClicar ? 'button' : undefined}
            >
              <div className="cartao-linha-topo">{principal.render(item)}</div>
              <dl className="cartao-linha-campos">
                {demais
                  .filter((c) => c.chave !== 'acoes')
                  .map((c) => (
                    <div key={c.chave}>
                      <dt>{c.titulo}</dt>
                      <dd>{c.render(item)}</dd>
                    </div>
                  ))}
              </dl>
              {colunas.some((c) => c.chave === 'acoes') && (
                <div className="cartao-linha-acoes">
                  {colunas.find((c) => c.chave === 'acoes')?.render(item)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Cabeçalho de coluna clicável fora da tabela (usado no Kanban e nos cards). */
export function BotaoOrdenar({
  rotulo,
  ativo,
  ordem,
  onClick,
}: {
  rotulo: string;
  ativo: boolean;
  ordem: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <button type="button" className="chip" aria-pressed={ativo} onClick={onClick}>
      {rotulo}
      {ativo && <Icon nome={ordem === 'asc' ? 'cima' : 'baixo'} tamanho={13} />}
    </button>
  );
}

/**
 * Fundacao dos graficos: moldura, medicao do container e tooltip.
 *
 * Os graficos deste painel sao SVG escrito a mao, sem biblioteca. Nao e
 * teimosia: uma lib de grafico custa 90–150 KB, traz o proprio tema para
 * brigar com o nosso e ainda assim exigiria sobrescrever cor, grade e fonte
 * item por item. O que precisamos aqui — area, barra, rosca, sparkline — sao
 * poucas linhas de geometria.
 *
 * Toda moldura oferece "Ver tabela": grafico nenhum e acessivel sozinho, e
 * essa tabela e a versao textual dos mesmos numeros.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Skeleton, Vazio } from '@/components/ui/primitives';

/** Cores das series, na ordem fixa definida em tokens.css. */
export const CORES_SERIE = [
  'var(--serie-1)',
  'var(--serie-2)',
  'var(--serie-3)',
  'var(--serie-4)',
  'var(--serie-5)',
] as const;

/** Cores de estado. Reservadas: nunca viram "serie 4". */
export const CORES_STATUS: Record<string, string> = {
  Pago: 'var(--ok)',
  Pendente: 'var(--alerta)',
  Atrasado: 'var(--red)',
  Cancelado: '#64748B',
  Reembolsado: 'var(--info)',
};

/* --------------------------------------------------------------------------
   Medição do container
   -------------------------------------------------------------------------- */

/**
 * Largura real do elemento. SVG responsivo sem distorcer texto.
 *
 * Usa CALLBACK REF, e nao `useRef` + `useEffect`. O motivo e concreto: enquanto
 * a moldura mostra o skeleton de carregamento, o elemento medido ainda nao
 * existe no DOM. Um efeito de montagem rodaria com `ref.current === null`,
 * jamais ligaria o observer, e a largura ficaria presa em zero — o grafico
 * nunca desenharia. A callback ref e chamada no instante em que o no aparece,
 * seja na primeira renderizacao ou depois.
 */
export function useLargura<T extends HTMLElement>() {
  const [largura, setLargura] = useState(0);
  const observador = useRef<ResizeObserver | null>(null);

  const ref = useCallback((no: T | null) => {
    observador.current?.disconnect();

    if (!no) {
      observador.current = null;
      return;
    }

    observador.current = new ResizeObserver((entradas) => {
      // Arredonda: variacao subpixel geraria re-render a cada quadro.
      setLargura(Math.round(entradas[0]?.contentRect.width ?? 0));
    });
    observador.current.observe(no);
    setLargura(Math.round(no.getBoundingClientRect().width));
  }, []);

  return { ref, largura };
}

/* --------------------------------------------------------------------------
   Moldura
   -------------------------------------------------------------------------- */

export interface ItemLegenda {
  rotulo: string;
  cor: string;
}

interface MolduraProps {
  titulo: string;
  descricao?: string;
  legenda?: ItemLegenda[];
  acoes?: ReactNode;
  carregando?: boolean;
  vazio?: boolean;
  mensagemVazio?: string;
  /** Dados em formato de tabela, para o modo textual. */
  tabela?: { colunas: string[]; linhas: (string | number)[][] };
  children: ReactNode;
  altura?: number;
}

export function MolduraGrafico({
  titulo,
  descricao,
  legenda,
  acoes,
  carregando = false,
  vazio = false,
  mensagemVazio = 'Sem dados no período selecionado.',
  tabela,
  children,
  altura = 240,
}: MolduraProps) {
  const [verTabela, setVerTabela] = useState(false);

  return (
    <section className="card grafico">
      <div className="card-cabeca">
        <div>
          <div className="card-titulo">{titulo}</div>
          {descricao && <div className="card-sub">{descricao}</div>}
        </div>
        <div className="linha" style={{ gap: 4 }}>
          {acoes}
          {tabela && (
            <button
              type="button"
              className="btn-icone"
              aria-pressed={verTabela}
              aria-label={verTabela ? 'Ver gráfico' : 'Ver tabela de dados'}
              title={verTabela ? 'Ver gráfico' : 'Ver tabela de dados'}
              onClick={() => setVerTabela((v) => !v)}
            >
              <Icon nome={verTabela ? 'dashboard' : 'lista'} />
            </button>
          )}
        </div>
      </div>

      <div className="grafico-corpo">
        {carregando ? (
          <div style={{ padding: 20 }}>
            <Skeleton altura={altura - 40} />
          </div>
        ) : vazio ? (
          <Vazio icone="relatorios" titulo="Nada para mostrar" descricao={mensagemVazio} />
        ) : verTabela && tabela ? (
          <div className="tabela-envolucro" style={{ border: 0, borderRadius: 0 }}>
            <table className="tabela">
              <thead>
                <tr>
                  {tabela.colunas.map((c, i) => (
                    <th key={c} className={i > 0 ? 'num' : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabela.linhas.map((linha, i) => (
                  <tr key={i}>
                    {linha.map((celula, j) => (
                      <td key={j} className={j > 0 ? 'num' : 'forte'}>
                        {celula}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            {children}
            {legenda && legenda.length > 1 && (
              <ul className="legenda">
                {legenda.map((l) => (
                  <li key={l.rotulo}>
                    <span className="legenda-marca" style={{ background: l.cor }} aria-hidden="true" />
                    {l.rotulo}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Tooltip
   -------------------------------------------------------------------------- */

export interface PosicaoTooltip {
  x: number;
  y: number;
  titulo: string;
  linhas: { rotulo: string; valor: string; cor?: string }[];
}

export function Tooltip({ dados, largura }: { dados: PosicaoTooltip | null; largura: number }) {
  if (!dados) return null;

  // Vira para o outro lado perto da borda direita, senao o balao sai do card.
  const viraEsquerda = dados.x > largura - 150;

  return (
    <div
      className="grafico-tooltip"
      style={{
        left: dados.x,
        top: dados.y,
        transform: `translate(${viraEsquerda ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
      }}
      role="presentation"
    >
      <div className="grafico-tooltip-titulo">{dados.titulo}</div>
      {dados.linhas.map((l) => (
        <div key={l.rotulo} className="grafico-tooltip-linha">
          {l.cor && <span className="legenda-marca" style={{ background: l.cor }} aria-hidden="true" />}
          <span className="grafico-tooltip-rotulo">{l.rotulo}</span>
          <span className="grafico-tooltip-valor">{l.valor}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Escala
   -------------------------------------------------------------------------- */

/**
 * Topo "redondo" do eixo: 1, 2, 2.5 ou 5 vezes uma potencia de 10. Um eixo que
 * termina em 18.437 nao ajuda ninguem a ler o grafico.
 */
export function tetoAgradavel(maximo: number): number {
  if (maximo <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(maximo));
  const normalizado = maximo / magnitude;
  const passo = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 2.5 ? 2.5 : normalizado <= 5 ? 5 : 10;
  return passo * magnitude;
}

/** Marcas do eixo Y, do topo até zero. */
export function marcasY(teto: number, quantidade = 4): number[] {
  return Array.from({ length: quantidade + 1 }, (_, i) => (teto / quantidade) * (quantidade - i));
}

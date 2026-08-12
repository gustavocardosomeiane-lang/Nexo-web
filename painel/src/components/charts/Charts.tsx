/**
 * Os graficos.
 *
 * Especificacao de marca seguida aqui: traco de 2px, ponta de barra arredondada
 * em 4px ancorada na linha de base, marcador de 8px, 2px de respiro entre
 * segmentos de uma pilha, grade discreta e rotulo direto quando cabe.
 */

import { useMemo, useState } from 'react';
import type { FatiaValor, SeriePonto } from '@/types';
import { brl, brlCompacto } from '@/lib/format';
import {
  CORES_SERIE,
  MolduraGrafico,
  Tooltip,
  marcasY,
  tetoAgradavel,
  useLargura,
  type ItemLegenda,
  type PosicaoTooltip,
} from './base';

const ALTURA = 240;
const MARGEM = { topo: 14, direita: 12, base: 28, esquerda: 54 };

/* ==========================================================================
   Área — evolução no tempo
   ========================================================================== */

interface AreaProps {
  titulo: string;
  descricao?: string;
  serie: SeriePonto[];
  carregando?: boolean;
  formatar?: (v: number) => string;
  acoes?: React.ReactNode;
}

export function GraficoArea({
  titulo,
  descricao,
  serie,
  carregando = false,
  formatar = brl,
  acoes,
}: AreaProps) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);

  const vazio = !carregando && (serie.length === 0 || serie.every((p) => p.valor === 0));

  const geometria = useMemo(() => {
    if (largura === 0 || serie.length === 0) return null;

    const l = largura - MARGEM.esquerda - MARGEM.direita;
    const a = ALTURA - MARGEM.topo - MARGEM.base;
    const teto = tetoAgradavel(Math.max(...serie.map((p) => p.valor)));

    const px = (i: number) =>
      MARGEM.esquerda + (serie.length === 1 ? l / 2 : (i / (serie.length - 1)) * l);
    const py = (v: number) => MARGEM.topo + a - (v / teto) * a;

    const pontos = serie.map((p, i) => ({ x: px(i), y: py(p.valor), ...p }));
    const linha = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const area = `${linha} L${pontos[pontos.length - 1].x},${MARGEM.topo + a} L${pontos[0].x},${MARGEM.topo + a} Z`;

    return { pontos, linha, area, teto, alturaPlot: a };
  }, [largura, serie]);

  /* Um rótulo de eixo a cada N pontos: 30 datas empilhadas viram borrão. */
  const passoRotulo = Math.max(1, Math.ceil(serie.length / (largura > 720 ? 10 : 5)));

  const tooltip: PosicaoTooltip | null =
    ativo !== null && geometria?.pontos[ativo]
      ? {
          x: geometria.pontos[ativo].x,
          y: geometria.pontos[ativo].y,
          titulo: geometria.pontos[ativo].rotulo,
          linhas: [
            {
              rotulo: titulo,
              valor: formatar(geometria.pontos[ativo].valor),
              cor: CORES_SERIE[0],
            },
          ],
        }
      : null;

  return (
    <MolduraGrafico
      titulo={titulo}
      descricao={descricao}
      carregando={carregando}
      vazio={vazio}
      acoes={acoes}
      tabela={{
        colunas: ['Período', 'Valor'],
        linhas: serie.map((p) => [p.rotulo, formatar(p.valor)]),
      }}
    >
      <div className="grafico-area" ref={ref} onMouseLeave={() => setAtivo(null)}>
        {geometria && (
          <svg width={largura} height={ALTURA} role="img" aria-label={`${titulo} por período`}>
            <defs>
              <linearGradient id="preenchimento-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--serie-1)" stopOpacity=".28" />
                <stop offset="100%" stopColor="var(--serie-1)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grade e eixo Y */}
            {marcasY(geometria.teto).map((valor) => {
              const y = MARGEM.topo + geometria.alturaPlot - (valor / geometria.teto) * geometria.alturaPlot;
              return (
                <g key={valor}>
                  <line
                    x1={MARGEM.esquerda}
                    y1={y}
                    x2={largura - MARGEM.direita}
                    y2={y}
                    stroke="var(--grade)"
                    strokeWidth="1"
                  />
                  <text x={MARGEM.esquerda - 8} y={y + 4} textAnchor="end" className="grafico-eixo">
                    {formatar === brl ? brlCompacto(valor) : Math.round(valor)}
                  </text>
                </g>
              );
            })}

            <path d={geometria.area} fill="url(#preenchimento-area)" />
            <path
              d={geometria.linha}
              fill="none"
              stroke="var(--serie-1)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Eixo X */}
            {geometria.pontos.map((p, i) =>
              i % passoRotulo === 0 || i === geometria.pontos.length - 1 ? (
                <text key={p.chave} x={p.x} y={ALTURA - 9} textAnchor="middle" className="grafico-eixo">
                  {p.rotulo}
                </text>
              ) : null,
            )}

            {/* Cursor */}
            {ativo !== null && geometria.pontos[ativo] && (
              <g>
                <line
                  x1={geometria.pontos[ativo].x}
                  y1={MARGEM.topo}
                  x2={geometria.pontos[ativo].x}
                  y2={MARGEM.topo + geometria.alturaPlot}
                  stroke="rgba(255,255,255,.18)"
                  strokeWidth="1"
                />
                <circle
                  cx={geometria.pontos[ativo].x}
                  cy={geometria.pontos[ativo].y}
                  r="5"
                  fill="var(--serie-1)"
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              </g>
            )}

            {/* Faixas invisíveis de captura: alvo bem maior que o ponto. */}
            {geometria.pontos.map((p, i) => {
              const meia =
                geometria.pontos.length > 1
                  ? (geometria.pontos[1].x - geometria.pontos[0].x) / 2
                  : largura / 2;
              return (
                <rect
                  key={`hit-${p.chave}`}
                  x={p.x - meia}
                  y={MARGEM.topo}
                  width={meia * 2}
                  height={geometria.alturaPlot}
                  fill="transparent"
                  onMouseEnter={() => setAtivo(i)}
                />
              );
            })}
          </svg>
        )}
        <Tooltip dados={tooltip} largura={largura} />
      </div>
    </MolduraGrafico>
  );
}

/* ==========================================================================
   Barras verticais — contagem por período
   ========================================================================== */

export function GraficoBarras({
  titulo,
  descricao,
  serie,
  carregando = false,
  formatar = (v: number) => String(v),
  cor = CORES_SERIE[1],
  acoes,
}: AreaProps & { cor?: string }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);

  const vazio = !carregando && (serie.length === 0 || serie.every((p) => p.valor === 0));

  const geometria = useMemo(() => {
    if (largura === 0 || serie.length === 0) return null;

    const l = largura - MARGEM.esquerda - MARGEM.direita;
    const a = ALTURA - MARGEM.topo - MARGEM.base;
    const teto = tetoAgradavel(Math.max(...serie.map((p) => p.valor)));
    const passo = l / serie.length;
    // 2px de respiro entre barras vizinhas; largura maxima para nao virar bloco.
    const largBarra = Math.min(passo - 4, 42);

    const barras = serie.map((p, i) => {
      const altura = teto === 0 ? 0 : (p.valor / teto) * a;
      return {
        ...p,
        x: MARGEM.esquerda + passo * i + (passo - largBarra) / 2,
        y: MARGEM.topo + a - altura,
        largura: Math.max(largBarra, 3),
        altura,
        centro: MARGEM.esquerda + passo * i + passo / 2,
      };
    });

    return { barras, teto, alturaPlot: a, passo };
  }, [largura, serie]);

  const passoRotulo = Math.max(1, Math.ceil(serie.length / (largura > 720 ? 10 : 5)));

  const tooltip: PosicaoTooltip | null =
    ativo !== null && geometria?.barras[ativo]
      ? {
          x: geometria.barras[ativo].centro,
          y: geometria.barras[ativo].y,
          titulo: geometria.barras[ativo].rotulo,
          linhas: [{ rotulo: titulo, valor: formatar(geometria.barras[ativo].valor), cor }],
        }
      : null;

  return (
    <MolduraGrafico
      titulo={titulo}
      descricao={descricao}
      carregando={carregando}
      vazio={vazio}
      acoes={acoes}
      tabela={{
        colunas: ['Período', 'Valor'],
        linhas: serie.map((p) => [p.rotulo, formatar(p.valor)]),
      }}
    >
      <div className="grafico-area" ref={ref} onMouseLeave={() => setAtivo(null)}>
        {geometria && (
          <svg width={largura} height={ALTURA} role="img" aria-label={`${titulo} por período`}>
            {marcasY(geometria.teto).map((valor) => {
              const y = MARGEM.topo + geometria.alturaPlot - (valor / geometria.teto) * geometria.alturaPlot;
              return (
                <g key={valor}>
                  <line
                    x1={MARGEM.esquerda}
                    y1={y}
                    x2={largura - MARGEM.direita}
                    y2={y}
                    stroke="var(--grade)"
                    strokeWidth="1"
                  />
                  <text x={MARGEM.esquerda - 8} y={y + 4} textAnchor="end" className="grafico-eixo">
                    {formatar === brl ? brlCompacto(valor) : Math.round(valor)}
                  </text>
                </g>
              );
            })}

            {geometria.barras.map((b, i) => (
              <g key={b.chave}>
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.largura}
                  height={Math.max(b.altura, b.valor > 0 ? 2 : 0)}
                  rx="4"
                  fill={cor}
                  opacity={ativo === null || ativo === i ? 1 : 0.45}
                  style={{ transition: 'opacity 140ms' }}
                />
                <rect
                  x={b.x - 2}
                  y={MARGEM.topo}
                  width={b.largura + 4}
                  height={geometria.alturaPlot}
                  fill="transparent"
                  onMouseEnter={() => setAtivo(i)}
                />
              </g>
            ))}

            {geometria.barras.map((b, i) =>
              i % passoRotulo === 0 || i === geometria.barras.length - 1 ? (
                <text key={`r-${b.chave}`} x={b.centro} y={ALTURA - 9} textAnchor="middle" className="grafico-eixo">
                  {b.rotulo}
                </text>
              ) : null,
            )}
          </svg>
        )}
        <Tooltip dados={tooltip} largura={largura} />
      </div>
    </MolduraGrafico>
  );
}

/* ==========================================================================
   Barras horizontais — ranking e funil
   ========================================================================== */

interface BarrasHProps {
  titulo: string;
  descricao?: string;
  dados: FatiaValor[];
  carregando?: boolean;
  formatar?: (v: number) => string;
  /** Uma cor só: magnitude não é identidade, cada barra não precisa de cor própria. */
  cor?: string;
  /** Cor por rótulo — para status, onde a cor tem significado próprio. */
  corPorRotulo?: Record<string, string>;
  limite?: number;
  acoes?: React.ReactNode;
}

export function GraficoBarrasH({
  titulo,
  descricao,
  dados,
  carregando = false,
  formatar = (v: number) => String(v),
  cor = CORES_SERIE[0],
  corPorRotulo,
  limite = 8,
  acoes,
}: BarrasHProps) {
  const visiveis = dados.slice(0, limite);
  const maximo = Math.max(1, ...visiveis.map((d) => d.valor));
  const vazio = !carregando && (visiveis.length === 0 || visiveis.every((d) => d.valor === 0));

  return (
    <MolduraGrafico
      titulo={titulo}
      descricao={descricao}
      carregando={carregando}
      vazio={vazio}
      acoes={acoes}
      tabela={{
        colunas: ['Item', 'Valor'],
        linhas: dados.map((d) => [d.rotulo, formatar(d.valor)]),
      }}
    >
      {/* Rótulo e valor ficam escritos ao lado da barra: a leitura não depende
          de medir o comprimento no olho. */}
      <ul className="barras-h">
        {visiveis.map((d) => (
          <li key={d.rotulo}>
            <div className="barras-h-topo">
              <span className="barras-h-rotulo truncar">{d.rotulo}</span>
              <span className="barras-h-valor">{formatar(d.valor)}</span>
            </div>
            <div className="barras-h-trilho">
              <div
                className="barras-h-barra"
                style={{
                  width: `${Math.max((d.valor / maximo) * 100, d.valor > 0 ? 1.5 : 0)}%`,
                  background: corPorRotulo?.[d.rotulo] ?? cor,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </MolduraGrafico>
  );
}

/* ==========================================================================
   Rosca — composição de um total
   ========================================================================== */

interface RoscaProps {
  titulo: string;
  descricao?: string;
  dados: FatiaValor[];
  carregando?: boolean;
  formatar?: (v: number) => string;
  cores?: readonly string[];
  corPorRotulo?: Record<string, string>;
  acoes?: React.ReactNode;
}

const TAMANHO_ROSCA = 168;
const RAIO = 72;
const ESPESSURA = 20;

export function GraficoRosca({
  titulo,
  descricao,
  dados,
  carregando = false,
  formatar = brl,
  cores = CORES_SERIE,
  corPorRotulo,
  acoes,
}: RoscaProps) {
  // Máximo de 4 fatias: numa rosca qualquer par pode encostar, e é com 4 que a
  // paleta passa no teste de separação todos-contra-todos. O resto vira "Outros".
  const preparados = useMemo(() => {
    const positivos = dados.filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor);
    if (positivos.length <= 4) return positivos;
    const principais = positivos.slice(0, 3);
    const resto = positivos.slice(3).reduce((soma, d) => soma + d.valor, 0);
    return [...principais, { rotulo: 'Outros', valor: resto }];
  }, [dados]);

  const total = preparados.reduce((s, d) => s + d.valor, 0);
  const vazio = !carregando && total === 0;

  const fatias = useMemo(() => {
    if (total === 0) return [];
    const circunferencia = 2 * Math.PI * RAIO;
    let acumulado = 0;

    return preparados.map((d, i) => {
      const fracao = d.valor / total;
      const comprimento = fracao * circunferencia;
      // 2px de respiro entre fatias vizinhas.
      const respiro = preparados.length > 1 ? 2 : 0;
      const inicio = acumulado;
      acumulado += comprimento;

      return {
        ...d,
        cor: corPorRotulo?.[d.rotulo] ?? cores[i % cores.length],
        dash: `${Math.max(comprimento - respiro, 0)} ${circunferencia - Math.max(comprimento - respiro, 0)}`,
        offset: -inicio,
        percentual: fracao * 100,
      };
    });
  }, [preparados, total, cores, corPorRotulo]);

  const legenda: ItemLegenda[] = fatias.map((f) => ({ rotulo: f.rotulo, cor: f.cor }));

  return (
    <MolduraGrafico
      titulo={titulo}
      descricao={descricao}
      carregando={carregando}
      vazio={vazio}
      legenda={legenda}
      acoes={acoes}
      tabela={{
        colunas: ['Item', 'Valor', 'Participação'],
        linhas: fatias.map((f) => [f.rotulo, formatar(f.valor), `${f.percentual.toFixed(1)}%`]),
      }}
    >
      <div className="rosca">
        <svg
          width={TAMANHO_ROSCA}
          height={TAMANHO_ROSCA}
          viewBox={`0 0 ${TAMANHO_ROSCA} ${TAMANHO_ROSCA}`}
          role="img"
          aria-label={titulo}
        >
          <g transform={`rotate(-90 ${TAMANHO_ROSCA / 2} ${TAMANHO_ROSCA / 2})`}>
            {fatias.map((f) => (
              <circle
                key={f.rotulo}
                cx={TAMANHO_ROSCA / 2}
                cy={TAMANHO_ROSCA / 2}
                r={RAIO}
                fill="none"
                stroke={f.cor}
                strokeWidth={ESPESSURA}
                strokeDasharray={f.dash}
                strokeDashoffset={f.offset}
              />
            ))}
          </g>
          <text
            x={TAMANHO_ROSCA / 2}
            y={TAMANHO_ROSCA / 2 - 4}
            textAnchor="middle"
            className="rosca-total"
          >
            {formatar(total)}
          </text>
          <text
            x={TAMANHO_ROSCA / 2}
            y={TAMANHO_ROSCA / 2 + 15}
            textAnchor="middle"
            className="grafico-eixo"
          >
            total
          </text>
        </svg>

        {/* Cada fatia também aparece escrita, com valor e percentual. */}
        <ul className="rosca-itens">
          {fatias.map((f) => (
            <li key={f.rotulo}>
              <span className="legenda-marca" style={{ background: f.cor }} aria-hidden="true" />
              <span className="rosca-item-rotulo truncar">{f.rotulo}</span>
              <span className="rosca-item-valor">{formatar(f.valor)}</span>
              <span className="rosca-item-pct">{f.percentual.toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </MolduraGrafico>
  );
}

/* ==========================================================================
   Sparkline — tendência dentro de um KPI
   ========================================================================== */

export function Sparkline({ serie, cor = 'var(--serie-1)' }: { serie: number[]; cor?: string }) {
  if (serie.length < 2) return null;

  const largura = 84;
  const altura = 26;
  const maximo = Math.max(...serie);
  const minimo = Math.min(...serie);
  const faixa = maximo - minimo || 1;

  const d = serie
    .map((v, i) => {
      const x = (i / (serie.length - 1)) * largura;
      const y = altura - ((v - minimo) / faixa) * altura;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={largura} height={altura} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={cor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

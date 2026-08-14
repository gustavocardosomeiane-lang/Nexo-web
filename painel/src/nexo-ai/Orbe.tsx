/**
 * Orbe da NEXO AI — emaranhado de filamentos luminosos.
 *
 * ===========================================================================
 * NÃO EXISTE ESFERA AQUI.
 *
 * Não há geometria de esfera, nem malha 3D, nem círculo, nem borda, nem raio,
 * nem ponto branco. O volume nasce EXCLUSIVAMENTE do acúmulo de filamentos
 * curvos atravessando profundidades diferentes. Se você apagar os filamentos,
 * não sobra nada — não há um objeto por baixo com efeitos aplicados em cima.
 *
 * O BRILHO CENTRAL TAMBÉM NÃO É DESENHADO. Ele aparece porque os filamentos se
 * cruzam mais no centro da projeção e a composição é aditiva (`lighter`):
 * onde muitas linhas se sobrepõem, a luz soma. É o mesmo motivo pelo qual um
 * novelo de fio parece mais denso no meio.
 * ===========================================================================
 *
 * COMO CADA FILAMENTO É CONSTRUÍDO
 *
 * Um filamento é uma curva 3D paramétrica: um arco em torno de um eixo próprio,
 * com raio próprio, deformado por três senoides de baixa frequência com fases
 * independentes. Isso produz curva irregular e orgânica — nunca um círculo.
 *
 * Cada um tem raio, eixo, extensão angular, espessura, brilho, velocidade e
 * fases diferentes. Alguns passam por dentro, outros ultrapassam levemente o
 * contorno. Alguns são arcos parciais, então aparecem só em parte.
 *
 * PROFUNDIDADE: cada segmento calcula seu z. O z governa opacidade, espessura
 * e posição na rampa de vermelho. Segmento ao fundo quase some no preto;
 * segmento à frente puxa para o vermelho intenso. É daí que vem o 3D.
 *
 * Canvas 2D, zero dependência. Uma malha WebGL resolveria o mesmo com mais
 * peso e mais superfície de erro — aqui são ~1500 segmentos por quadro, que o
 * Canvas 2D desenha com folga.
 */

import { useEffect, useRef, useState } from 'react';
import type { EstadoNexoAI } from '../../shared/regras-nexo-ai';

/* ==========================================================================
   Paleta — preto dominante, vermelho em camadas
   ========================================================================== */

/**
 * Rampa do quase-preto ao vermelho quente.
 *
 * Nada de vermelho neon chapado: o filamento do fundo é praticamente preto com
 * um resíduo de vermelho, e só o cruzamento mais energético chega ao topo da
 * rampa. A soma aditiva faz o resto do trabalho.
 */
const RAMPA: [number, number, number][] = [
  [22, 5, 8],
  [58, 10, 16],
  [104, 15, 25],
  [163, 20, 33],
  [206, 26, 42],
  [242, 48, 66],
];

function corDaRampa(t: number): [number, number, number] {
  const p = Math.max(0, Math.min(0.9999, t)) * (RAMPA.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  const a = RAMPA[i];
  const b = RAMPA[Math.min(i + 1, RAMPA.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/* ==========================================================================
   Aleatoriedade determinística
   ========================================================================== */

/** Mesma semente, mesmo emaranhado. A orbe não muda de cara a cada F5. */
function prng(semente: number) {
  let a = semente;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ==========================================================================
   Modelo de filamento
   ========================================================================== */

interface Filamento {
  /** Raio base, relativo ao raio nominal da orbe. */
  raio: number;
  /** Eixo de rotação próprio (define o plano do arco). */
  eixoX: number;
  eixoY: number;
  eixoZ: number;
  /** Onde o arco começa e quanto ele cobre. */
  inicio: number;
  extensao: number;
  /** Deformação: amplitude e frequência de três senoides. */
  ampA: number;
  freqA: number;
  ampB: number;
  freqB: number;
  ampC: number;
  freqC: number;
  /** Fases independentes — é o que faz a curva respirar. */
  faseA: number;
  faseB: number;
  faseC: number;
  /** Velocidade própria de deriva. */
  velocidade: number;
  /** Espessura base. */
  espessura: number;
  /** Brilho base (0..1) — posição na rampa. */
  brilho: number;
  /** Ciclo de aparecer/sumir. */
  cicloFase: number;
  cicloVel: number;
  /** Quantos segmentos traçar. */
  segmentos: number;
  /** `true` = fragmento solto, fora da massa principal. */
  fragmento: boolean;
}

function criarFilamentos(rand: () => number): Filamento[] {
  const lista: Filamento[] = [];

  // --- Massa principal ---
  // Raios variados: parte por dentro, parte encostando no contorno, parte
  // ultrapassando um pouco. É o que impede a silhueta de virar um círculo.
  // 66 filamentos: denso o bastante para o emaranhado ler como volume, leve o
  // bastante para o Canvas 2D desenhar sem custar quadro.
  for (let i = 0; i < 66; i++) {
    const interno = i % 3 === 0;
    lista.push({
      raio: interno ? 0.34 + rand() * 0.3 : 0.72 + rand() * 0.34,
      eixoX: rand() * 2 - 1,
      eixoY: rand() * 2 - 1,
      eixoZ: rand() * 2 - 1,
      inicio: rand() * Math.PI * 2,
      // Arcos parciais: alguns filamentos aparecem só em parte, como na
      // referência. Poucos fecham a volta inteira.
      extensao: Math.PI * (0.7 + rand() * 1.5),
      ampA: 0.08 + rand() * 0.22,
      freqA: 1 + Math.floor(rand() * 3),
      ampB: 0.05 + rand() * 0.16,
      freqB: 2 + Math.floor(rand() * 4),
      ampC: 0.03 + rand() * 0.1,
      freqC: 4 + Math.floor(rand() * 5),
      faseA: rand() * Math.PI * 2,
      faseB: rand() * Math.PI * 2,
      faseC: rand() * Math.PI * 2,
      velocidade: 0.04 + rand() * 0.16,
      espessura: 0.5 + rand() * 1.5,
      brilho: 0.22 + rand() * 0.72,
      cicloFase: rand() * Math.PI * 2,
      cicloVel: 0.06 + rand() * 0.22,
      segmentos: 30 + Math.floor(rand() * 18),
      fragmento: false,
    });
  }

  // --- Fragmentos soltos ---
  // Não são partículas: são pedaços curtos de filamento, com a mesma
  // linguagem de curva, flutuando a distâncias diferentes da massa.
  for (let i = 0; i < 14; i++) {
    lista.push({
      raio: 1.1 + rand() * 0.42,
      eixoX: rand() * 2 - 1,
      eixoY: rand() * 2 - 1,
      eixoZ: rand() * 2 - 1,
      inicio: rand() * Math.PI * 2,
      extensao: Math.PI * (0.06 + rand() * 0.24),
      ampA: 0.1 + rand() * 0.3,
      freqA: 1 + Math.floor(rand() * 3),
      ampB: 0.06 + rand() * 0.2,
      freqB: 2 + Math.floor(rand() * 3),
      ampC: 0.02 + rand() * 0.08,
      freqC: 3 + Math.floor(rand() * 4),
      faseA: rand() * Math.PI * 2,
      faseB: rand() * Math.PI * 2,
      faseC: rand() * Math.PI * 2,
      // Deriva mais lenta: o fragmento flutua, não corre.
      velocidade: 0.02 + rand() * 0.07,
      espessura: 0.4 + rand() * 0.8,
      brilho: 0.18 + rand() * 0.5,
      cicloFase: rand() * Math.PI * 2,
      cicloVel: 0.1 + rand() * 0.3,
      segmentos: 10 + Math.floor(rand() * 10),
      fragmento: true,
    });
  }

  return lista;
}

/* ==========================================================================
   Intensidade por estado
   ========================================================================== */

interface Perfil {
  /** Multiplicador de velocidade da deriva. */
  ritmo: number;
  /** Multiplicador de brilho geral. */
  luz: number;
  /** Amplitude do pulso lento. */
  pulso: number;
  /** Deslocamento na rampa de cor (negativo = mais escuro). */
  tom: number;
}

/**
 * O estado modula INTENSIDADE, nunca a estética. A orbe é sempre a mesma
 * criatura; ela só respira diferente.
 */
const PERFIL: Record<EstadoNexoAI, Perfil> = {
  idle: { ritmo: 0.55, luz: 0.82, pulso: 0.05, tom: -0.04 },
  listening: { ritmo: 0.85, luz: 1.0, pulso: 0.1, tom: 0.02 },
  thinking: { ritmo: 1.45, luz: 1.08, pulso: 0.14, tom: 0.06 },
  responding: { ritmo: 1.1, luz: 1.12, pulso: 0.1, tom: 0.08 },
  speaking: { ritmo: 1.2, luz: 1.15, pulso: 0.16, tom: 0.1 },
  error: { ritmo: 0.4, luz: 0.62, pulso: 0.03, tom: -0.16 },
};

/* ==========================================================================
   Componente
   ========================================================================== */

export function Orbe({
  estado,
  nivel = 0,
  tamanho = 260,
}: {
  estado: EstadoNexoAI;
  nivel?: number;
  tamanho?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hospedeiroRef = useRef<HTMLDivElement>(null);

  // Estado vivo em refs: o laço de animação lê sem forçar re-render.
  const estadoRef = useRef(estado);
  const nivelRef = useRef(nivel);
  const [reduzirMovimento, setReduzirMovimento] = useState(false);

  estadoRef.current = estado;
  nivelRef.current = Math.max(0, Math.min(1, nivel));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicar = () => setReduzirMovimento(mq.matches);
    aplicar();
    mq.addEventListener?.('change', aplicar);
    return () => mq.removeEventListener?.('change', aplicar);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hospedeiro = hospedeiroRef.current;
    if (!canvas || !hospedeiro) return;

    const ctx2d = canvas.getContext('2d', { alpha: true });
    if (!ctx2d) return;
    // Const nao-nulo: `desenhar` e uma funcao aninhada e o TypeScript nao
    // consegue manter o narrowing de `ctx2d` la dentro.
    const ctx = ctx2d;

    const filamentos = criarFilamentos(prng(0x4e58f0));

    // DPR limitado a 2: acima disso o custo por pixel quadruplica sem ganho
    // visível numa peça de 260px.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let largura = tamanho;
    let altura = tamanho;

    const dimensionar = () => {
      const caixa = hospedeiro.getBoundingClientRect();
      largura = Math.max(1, Math.round(caixa.width || tamanho));
      altura = Math.max(1, Math.round(caixa.height || tamanho));
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(altura * dpr);
      canvas.style.width = `${largura}px`;
      canvas.style.height = `${altura}px`;
      // Atribuir a canvas.width LIMPA o canvas, mas o laço de animação roda
      // sempre (ver `desenhar`) — o próximo quadro, a no máximo ~16ms, repinta
      // sozinho. Não há mais um "modo estático" que dependa de repintar aqui.
    };

    // `dimensionar` só mexe em canvas/DOM; `desenhar` é declarada abaixo e
    // reagendada por si mesma — não há dependência de ordem entre as duas.
    const ro = new ResizeObserver(dimensionar);
    ro.observe(hospedeiro);

    /* ---- Pausa quando não está à vista ----
       Orbe fora da tela não pode continuar queimando GPU. A troca de aba é
       tratada pelo `document.hidden` checado a cada frame em `desenhar`,
       sem precisar de estado extra — o rAF do navegador já reduz a cadência
       em abas de fundo. */
    let visivel = true;
    const io = new IntersectionObserver(
      ([entrada]) => {
        visivel = entrada.isIntersecting;
      },
      { threshold: 0.01 },
    );
    io.observe(hospedeiro);

    let quadro = 0;
    let tempo = 0;
    let ultimo = performance.now();

    function desenhar(agora: number) {
      const dt = Math.min((agora - ultimo) / 1000, 0.05);
      ultimo = agora;

      if (!visivel || document.hidden) {
        quadro = requestAnimationFrame(desenhar);
        return;
      }

      const perfil = PERFIL[estadoRef.current] ?? PERFIL.idle;
      const nv = nivelRef.current;

      const amortecedor = reduzirMovimento ? 0.8 : 1;
      tempo += dt * perfil.ritmo * amortecedor;

      const cx = largura / 2;
      const cy = altura / 2;
      // 0.42 do menor lado: a massa ocupa o quadro sem os fragmentos (raio até
      // ~1.5) escaparem da borda do canvas.
      const R = Math.min(largura, altura) * 0.42;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, largura, altura);

      // Pulso lento e a voz somando um pouco de energia.
      const pulso = 1 + Math.sin(tempo * 0.7) * perfil.pulso * amortecedor + nv * 0.18 * amortecedor;
      const luz = perfil.luz * pulso;

      // ADITIVO: é isto que faz o cruzamento das linhas virar brilho, e o
      // núcleo aparecer sozinho onde a densidade é maior.
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const f of filamentos) {
        // Envelope de aparecer/sumir: alguns filamentos entram e saem.
        const env = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tempo * f.cicloVel + f.cicloFase));

        // Normaliza o eixo próprio uma vez por filamento.
        const n = Math.hypot(f.eixoX, f.eixoY, f.eixoZ) || 1;
        const ex = f.eixoX / n;
        const ey = f.eixoY / n;
        const ez = f.eixoZ / n;

        // Base ortonormal do plano do arco (Rodrigues simplificado).
        let ux = -ey;
        let uy = ex;
        let uz = 0;
        const un = Math.hypot(ux, uy, uz) || 1;
        ux /= un;
        uy /= un;
        uz /= un;
        const vx = ey * uz - ez * uy;
        const vy = ez * ux - ex * uz;
        const vz = ex * uy - ey * ux;

        const deriva = tempo * f.velocidade;
        const passos = f.segmentos;

        let px = 0;
        let py = 0;
        let pz = 0;
        let temAnterior = false;

        for (let s = 0; s <= passos; s++) {
          const t = s / passos;
          const ang = f.inicio + deriva + t * f.extensao;

          // Deformação orgânica: três senoides de fases independentes fazem a
          // curva ondular e mudar de forma ao longo do tempo.
          const d =
            f.ampA * Math.sin(f.freqA * ang + f.faseA + tempo * 0.35) +
            f.ampB * Math.sin(f.freqB * ang + f.faseB - tempo * 0.22) +
            f.ampC * Math.sin(f.freqC * ang + f.faseC + tempo * 0.5);

          const r = f.raio * (1 + d);

          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          // Ponto no plano do arco, empurrado ao longo do eixo pela deformação.
          const x = (ux * c + vx * sn) * r + ex * d * 0.5;
          const y = (uy * c + vy * sn) * r + ey * d * 0.5;
          const z = (uz * c + vz * sn) * r + ez * d * 0.5;

          if (!temAnterior) {
            px = x;
            py = y;
            pz = z;
            temAnterior = true;
            continue;
          }

          // Profundidade do segmento: -1 (fundo) .. +1 (frente).
          const zm = (pz + z) / 2;
          const prof = Math.max(-1, Math.min(1, zm / 1.2));
          // Perspectiva fraca: o que está à frente cresce um pouco.
          const escala = 1 + prof * 0.16;

          const x1 = cx + px * R * escala;
          const y1 = cy + py * R * escala;
          const x2 = cx + x * R * escala;
          const y2 = cy + y * R * escala;

          // Fundo quase some; frente ganha corpo.
          const frente = (prof + 1) / 2;
          const alfa =
            Math.max(0, Math.min(1, (0.07 + frente * 0.62) * f.brilho * env * luz)) *
            (f.fragmento ? 0.85 : 1);

          if (alfa > 0.004) {
            const tom = Math.max(
              0,
              Math.min(1, f.brilho * 0.45 + frente * 0.5 + perfil.tom + nv * 0.1),
            );
            const [cr, cg, cb] = corDaRampa(tom);
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alfa.toFixed(3)})`;
            ctx.lineWidth = Math.max(0.35, f.espessura * (0.45 + frente * 0.85));
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }

          px = x;
          py = y;
          pz = z;
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      // O laço nunca para sozinho — só a limpeza do efeito (unmount, troca de
      // `tamanho`/`reduzirMovimento`) cancela via `cancelAnimationFrame`. Isso
      // vale também sob `prefers-reduced-motion`: a diferença é o amortecedor
      // acima, não a existência do próximo quadro.
      quadro = requestAnimationFrame(desenhar);
    }

    dimensionar();
    quadro = requestAnimationFrame(desenhar);

    return () => {
      cancelAnimationFrame(quadro);
      ro.disconnect();
      io.disconnect();
    };
  }, [tamanho, reduzirMovimento]);

  return (
    <div
      ref={hospedeiroRef}
      className={`orbe orbe-${estado}`}
      data-estado={estado}
      role="img"
      aria-label={`NEXO AI — ${ROTULO_ESTADO[estado]}`}
      style={{ width: tamanho, height: tamanho }}
    >
      <canvas ref={canvasRef} className="orbe-canvas" />
    </div>
  );
}

const ROTULO_ESTADO: Record<EstadoNexoAI, string> = {
  idle: 'em repouso',
  listening: 'captando',
  thinking: 'processando',
  responding: 'respondendo',
  speaking: 'falando',
  error: 'com um problema',
};

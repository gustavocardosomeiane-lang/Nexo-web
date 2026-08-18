/**
 * Regras puras da NEXO AI.
 *
 * Módulo sem rede, sem DOM, sem alias — roda no navegador, nas funções da
 * Vercel e no `node --test`. É aqui que ficam as decisões que custam dinheiro
 * ou que protegem dado, justamente para poderem ser testadas sem gastar um
 * único token.
 */

/* ==========================================================================
   1. ORÇAMENTO DE CONTEXTO
   ========================================================================== */

/**
 * Estimativa de tokens.
 *
 * Aproximação por caracteres, de propósito: contar de verdade exigiria o
 * tokenizador do modelo — outra dependência, para uma decisão que só precisa
 * ser conservadora. ~3,5 chars/token em português (pior que inglês por causa
 * de acentos), arredondado para cima.
 */
export function estimarTokens(texto: string): number {
  return Math.ceil(String(texto ?? '').length / 3.5);
}

/**
 * Teto de contexto por requisição.
 *
 * Não é limite do modelo — é limite de CUSTO. O modelo aceita muito mais; o
 * ponto é nunca mandar "tudo o que temos" só porque cabe.
 */
export const ORCAMENTO = {
  /** Total do contexto montado (fora a resposta). */
  total: 6000,
  /** Quanto do total pode ir para memórias de longo prazo. */
  memorias: 1200,
  /** Quanto pode ir para histórico da sessão. */
  historico: 2000,
  /** Quanto pode ir para resultado de ferramenta. */
  ferramentas: 1500,
} as const;

/** Nunca mandar a sessão inteira: as últimas N trocas resolvem quase sempre. */
export const MAX_MENSAGENS_HISTORICO = 8;

export interface MensagemChat {
  papel: 'user' | 'assistant';
  conteudo: string;
  criado_em?: string;
}

/**
 * Recorta o histórico para caber no orçamento, do mais recente para trás.
 *
 * Mantém a ordem cronológica no resultado — o modelo precisa da sequência,
 * não da ordem de descarte.
 */
export function recortarHistorico(
  mensagens: MensagemChat[],
  limiteTokens: number = ORCAMENTO.historico,
  maxMensagens: number = MAX_MENSAGENS_HISTORICO,
): MensagemChat[] {
  const recentes = mensagens.slice(-maxMensagens);
  const mantidas: MensagemChat[] = [];
  let usado = 0;

  for (let i = recentes.length - 1; i >= 0; i--) {
    const custo = estimarTokens(recentes[i]!.conteudo);
    if (usado + custo > limiteTokens && mantidas.length > 0) break;
    mantidas.unshift(recentes[i]!);
    usado += custo;
  }

  return mantidas;
}

/* ==========================================================================
   2. MEMÓRIA DE LONGO PRAZO
   ========================================================================== */

export type TipoMemoria = 'empresa' | 'preferencia' | 'decisao' | 'projeto' | 'fato';

export interface Memoria {
  id: string;
  tipo: TipoMemoria;
  /** Texto da memória. É o que vai para o contexto. */
  conteudo: string;
  /** Palavras-chave para recuperação. */
  chaves?: string[];
  /** 0..1 — quanto o operador considera isso importante. */
  relevancia?: number;
  usuario_id?: string | null;
  criado_em?: string;
}

/** Normaliza para comparação: minúsculas, sem acento, sem pontuação. */
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras curtas e conectivos não ajudam a discriminar nada. */
const VAZIAS = new Set([
  'a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas',
  'um','uma','uns','umas','para','por','com','sem','que','se','ao','aos','à','às',
  'the','of','and','to','is','me','meu','minha','nosso','nossa','qual','quais',
  'como','quando','onde','isso','esse','essa','ele','ela','eu','voce','você',
]);

export function palavrasChave(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length >= 3 && !VAZIAS.has(p));
}

/**
 * Relevância de uma memória para a pergunta — 0..1.
 *
 * Sobreposição de palavras (Jaccard assimétrico) somada a um empurrão pela
 * relevância declarada. Não é embedding, e isso é deliberado: embedding exige
 * um segundo modelo, custo por gravação e uma coluna vetorial. Para dezenas
 * ou centenas de memórias, sobreposição resolve. O dia em que não resolver,
 * troca-se só esta função — a assinatura não muda.
 */
export function pontuarMemoria(memoria: Memoria, pergunta: string): number {
  const alvo = new Set(palavrasChave(pergunta));
  if (alvo.size === 0) return 0;

  const fonte = new Set([
    ...palavrasChave(memoria.conteudo),
    ...(memoria.chaves ?? []).flatMap(palavrasChave),
  ]);
  if (fonte.size === 0) return 0;

  let comuns = 0;
  for (const p of alvo) if (fonte.has(p)) comuns++;

  const sobreposicao = comuns / alvo.size;
  const peso = typeof memoria.relevancia === 'number' ? memoria.relevancia : 0.5;

  // 80% pela aderência à pergunta, 20% pela importância declarada.
  return sobreposicao * 0.8 + peso * 0.2;
}

/**
 * Escolhe as memórias que entram no contexto.
 *
 * Memórias do tipo `empresa` entram sempre que couberem: são o "quem somos",
 * úteis mesmo quando a pergunta não as menciona. O resto compete por
 * relevância e precisa passar de um piso — sem piso, uma pergunta genérica
 * arrastaria memórias aleatórias e pagaríamos tokens por ruído.
 */
export function selecionarMemorias(
  memorias: Memoria[],
  pergunta: string,
  limiteTokens: number = ORCAMENTO.memorias,
  piso = 0.15,
): Memoria[] {
  const daEmpresa = memorias.filter((m) => m.tipo === 'empresa');
  const demais = memorias
    .filter((m) => m.tipo !== 'empresa')
    .map((m) => ({ m, p: pontuarMemoria(m, pergunta) }))
    .filter((x) => x.p >= piso)
    .sort((a, b) => b.p - a.p)
    .map((x) => x.m);

  const escolhidas: Memoria[] = [];
  let usado = 0;

  for (const m of [...daEmpresa, ...demais]) {
    const custo = estimarTokens(m.conteudo);
    if (usado + custo > limiteTokens) continue;
    escolhidas.push(m);
    usado += custo;
  }

  return escolhidas;
}

/* ==========================================================================
   3. PROTEÇÃO DE DADOS
   ========================================================================== */

/**
 * Remove segredos de qualquer texto que vá para o modelo.
 *
 * Rede de segurança, não a defesa principal — a defesa é o servidor nunca
 * colocar credencial no contexto. Mas o contexto inclui dados do CRM escritos
 * por gente, e já vi chave de API colada em campo de observação.
 */
export function redigirSegredos(texto: string): string {
  return String(texto ?? '')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[REDIGIDO]')
    .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/gi, '[REDIGIDO]')
    .replace(/\$aact_[A-Za-z0-9_=-]{8,}/g, '[REDIGIDO]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDIGIDO]')
    .replace(/\b[A-Z_]{4,}_(KEY|TOKEN|SECRET)\s*=\s*\S+/g, '$1=[REDIGIDO]');
}

/* ==========================================================================
   4. FERRAMENTAS — o que cada papel pode consultar
   ========================================================================== */

/**
 * Mapa ferramenta -> módulo do painel.
 *
 * A IA não ganha permissão própria: ela herda a de quem pergunta. Uma
 * ferramenta só é oferecida ao modelo se o usuário já poderia ver aquele
 * módulo na interface. Assim não existe caminho pela IA que contorne a
 * matriz de permissões.
 */
export const FERRAMENTA_MODULO: Record<string, string> = {
  consultar_leads: 'leads',
  consultar_clientes: 'clientes',
  consultar_vendas: 'vendas',
  consultar_pagamentos: 'pagamentos',
  consultar_projetos: 'projetos',
  consultar_metricas: 'dashboard',
  consultar_campanhas: 'automacoes',
  consultar_conversas: 'conversas',
  buscar_memoria: 'dashboard',
  salvar_memoria: 'dashboard',
};

/** Filtra as ferramentas que este usuário pode usar. */
export function ferramentasPermitidas(
  todas: string[],
  podeVerModulo: (modulo: string) => boolean,
): string[] {
  return todas.filter((f) => {
    const modulo = FERRAMENTA_MODULO[f];
    // Ferramenta sem módulo declarado não é oferecida. Falha fechado: é mais
    // seguro esquecer de liberar do que liberar por esquecimento.
    return modulo ? podeVerModulo(modulo) : false;
  });
}

/* ==========================================================================
   5. ESTADOS DA INTERFACE
   ========================================================================== */

export type EstadoNexoAI =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'responding'
  | 'speaking'
  | 'error';

/** Transições válidas. Impede a interface de ficar num estado impossível. */
const TRANSICOES: Record<EstadoNexoAI, EstadoNexoAI[]> = {
  idle: ['listening', 'thinking', 'error'],
  listening: ['thinking', 'idle', 'error'],
  thinking: ['responding', 'error', 'idle'],
  responding: ['speaking', 'idle', 'error'],
  // 'listening' incluído: clicar no microfone enquanto a NEXO fala cancela a
  // fala (voz.ts) e entra direto em escuta — sem passar por 'idle' no meio.
  speaking: ['idle', 'error', 'listening'],
  error: ['idle'],
};

export function podeTransitar(de: EstadoNexoAI, para: EstadoNexoAI): boolean {
  return TRANSICOES[de]?.includes(para) ?? false;
}

/* ==========================================================================
   6. SEGMENTAÇÃO DE FALA — streaming de texto para TTS incremental
   ========================================================================== */

/** Pontuação que fecha uma frase falável. */
const PONTUACAO_FINAL = /[.!?;]/;

/**
 * Piso pra não mandar fragmento minúsculo pro TTS (tipo "Ok." sozinho —
 * gastaria uma chamada de voz inteira por interjeição). NÃO é o alvo de
 * 40–60 caracteres sugerido como ideal: uma frase completa mais curta que
 * isso (ex.: "Temos 42 leads qualificados." = 29 caracteres) ainda é um
 * pensamento inteiro e é falada assim que fecha — esperar só pra "engordar"
 * o segmento atrasaria o primeiro áudio sem ganho nenhum.
 */
const TAMANHO_MINIMO_SEGMENTO = 20;

/** Corte de segurança: sem pontuação nenhuma até aqui, corta mesmo assim. */
const TAMANHO_MAXIMO_BUFFER = 220;

export interface ResultadoSegmentacao {
  /** Trechos prontos pra virar áudio, na ordem em que devem ser falados. */
  segmentos: string[];
  /** O que sobrou no buffer, ainda sem fechar frase — passa pra próxima chamada. */
  restante: string;
}

/**
 * Acumula o novo chunk no buffer e extrai quantos segmentos faláveis
 * estiverem prontos. Chamada uma vez por chunk do streaming — o buffer vai e
 * volta entre chamadas, então funciona mesmo se a pontuação ou uma palavra
 * vier partida entre dois chunks (a busca sempre roda no texto concatenado,
 * nunca isolada por chunk).
 */
export function segmentarParaFala(bufferAtual: string, chunkNovo: string): ResultadoSegmentacao {
  let texto = `${bufferAtual}${chunkNovo}`;
  const segmentos: string[] = [];

  for (;;) {
    const corte = encontrarCorte(texto);
    if (corte === -1) break;
    const segmento = texto.slice(0, corte).trim();
    texto = texto.slice(corte);
    if (segmento) segmentos.push(segmento);
  }

  return { segmentos, restante: texto };
}

function encontrarCorte(texto: string): number {
  for (let i = 0; i < texto.length; i++) {
    if (PONTUACAO_FINAL.test(texto[i]!) && i + 1 >= TAMANHO_MINIMO_SEGMENTO) {
      return i + 1;
    }
  }
  if (texto.length > TAMANHO_MAXIMO_BUFFER) {
    const espaco = texto.lastIndexOf(' ', TAMANHO_MAXIMO_BUFFER);
    // Só corta no espaço se sobrar um segmento que valha a pena; senão corta
    // no limite mesmo (caso raríssimo: uma "palavra" de 220+ caracteres).
    return espaco > TAMANHO_MINIMO_SEGMENTO ? espaco + 1 : TAMANHO_MAXIMO_BUFFER;
  }
  return -1;
}

/**
 * Chamada só quando o texto INTEIRO da resposta já terminou (stream do
 * modelo encerrado): o que sobrou no buffer sem pontuação — incluindo uma
 * frase final sem ponto — ainda precisa ser falado. `null` se não sobrou
 * nada de verdade (só espaço em branco).
 */
export function finalizarSegmentacao(restante: string): string | null {
  const texto = restante.trim();
  return texto ? texto : null;
}

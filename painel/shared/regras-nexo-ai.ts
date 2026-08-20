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
  /** Palavras-chave para recuperação. O primeiro elemento é a "chave" de dedupe/atualização. */
  chaves?: string[];
  /** 0..1 — quanto o operador (ou a extração) considera isso importante. */
  relevancia?: number;
  usuario_id?: string | null;
  criado_em?: string;
  atualizado_em?: string;
  /** Quando esta memória foi usada pela última vez numa resposta — alimenta a recência da pontuação. */
  last_used_at?: string | null;
  source_conversation_id?: string | null;
  /** Soft-delete: "esquecer" desativa em vez de apagar. `carregarMemorias` só traz `ativo = true`. */
  ativo?: boolean;
}

/**
 * Acima disso, a memória é tratada como "core": entra tentando SEMPRE, igual
 * às memórias `tipo: 'empresa'`, mesmo sem sobreposição de palavras com a
 * pergunta atual. É o mecanismo por trás de "nome/apelido preferido, idioma,
 * forma de tratamento, identidade do negócio" sempre disponíveis — sem isso,
 * "bom dia" nunca teria sobreposição de palavras com "me chama de Iong" e a
 * NEXO nunca chamaria o usuário pelo nome preferido numa conversa nova.
 */
export const LIMIAR_MEMORIA_CORE = 0.85;

/** Memória usada nos últimos N dias ganha um pequeno empurrão na pontuação — "usada recentemente" importa. */
const JANELA_RECENCIA_DIAS = 7;

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
export function pontuarMemoria(memoria: Memoria, pergunta: string, agora: number = Date.now()): number {
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

  // Pequeno empurrão de recência — não domina a pontuação (por isso o peso
  // baixo), só desempata a favor do que foi útil há pouco tempo.
  let bonusRecencia = 0;
  if (memoria.last_used_at) {
    const diasDesdeUso = (agora - new Date(memoria.last_used_at).getTime()) / 86_400_000;
    if (Number.isFinite(diasDesdeUso) && diasDesdeUso >= 0 && diasDesdeUso <= JANELA_RECENCIA_DIAS) {
      bonusRecencia = 0.1 * (1 - diasDesdeUso / JANELA_RECENCIA_DIAS);
    }
  }

  // 70% pela aderência à pergunta, 20% pela importância declarada, 10% de recência.
  return sobreposicao * 0.7 + peso * 0.2 + bonusRecencia;
}

/** "Core": memória de empresa, ou relevância declarada acima do limiar — tenta entrar sempre, sem depender de sobreposição de palavras. */
function ehMemoriaCore(memoria: Memoria): boolean {
  return memoria.tipo === 'empresa' || (memoria.relevancia ?? 0) >= LIMIAR_MEMORIA_CORE;
}

/**
 * Escolhe as memórias que entram no contexto.
 *
 * Memórias "core" (tipo `empresa`, ou relevância >= `LIMIAR_MEMORIA_CORE`)
 * entram sempre que couberem — são o "quem somos"/"como me chamar", úteis
 * mesmo quando a pergunta não as menciona (ex.: nome preferido deve valer
 * pra "bom dia", não só pra perguntas sobre nome). O resto compete por
 * relevância e precisa passar de um piso — sem piso, uma pergunta genérica
 * arrastaria memórias aleatórias e pagaríamos tokens por ruído.
 */
export function selecionarMemorias(
  memorias: Memoria[],
  pergunta: string,
  limiteTokens: number = ORCAMENTO.memorias,
  piso = 0.15,
): Memoria[] {
  const core = memorias.filter(ehMemoriaCore);
  const demais = memorias
    .filter((m) => !ehMemoriaCore(m))
    .map((m) => ({ m, p: pontuarMemoria(m, pergunta) }))
    .filter((x) => x.p >= piso)
    .sort((a, b) => b.p - a.p)
    .map((x) => x.m);

  const escolhidas: Memoria[] = [];
  let usado = 0;

  for (const m of [...core, ...demais]) {
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
  /**
   * Mesmo módulo de `consultar_leads` — mas atenção: este mapa só decide
   * quem ENXERGA o módulo `leads` (`financeiro` enxerga, só não pode
   * CRIAR). `buscar_leads_locais` grava lead novo, então o gate aqui é só a
   * primeira camada; a autorização fina (só administrador/vendedor, que são
   * quem tem `leads:criar` em `src/auth/permissions.ts`) é checada de novo
   * dentro de `executarBuscaEImportacao` (api/_lib/nexo-ai/ferramentas.ts) —
   * porque este mapa não tem a granularidade de "ver" vs. "criar".
   */
  buscar_leads_locais: 'leads',
  /** Memória pessoal não é feature de módulo — todo papel autenticado pode ter algo lembrado dele. Mesmo módulo já reservado (sem uso até agora) pra `buscar_memoria`/`salvar_memoria` logo acima. */
  registrar_memoria: 'dashboard',
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
 * Alvo de tamanho do bloco — não é mais "corta na primeira pontuação".
 *
 * Cada bloco falável vira UMA requisição a /api/nexo-ai/falar. Cortar cedo
 * demais (ex.: em toda frase curta) gera rajadas de requisições quase
 * simultâneas — foi exatamente isso que estourou a quota do Gemini TTS em
 * produção (vários 429 RESOURCE_EXHAUSTED seguidos). Por isso agora só corta
 * quando o bloco já atingiu ALVO_MINIMO; frases curtas ("Ok.", "Certo.") se
 * juntam com a próxima até lá. ALVO_MAXIMO é o teto pra não empilhar um
 * parágrafo inteiro — mesmo sem ter alcançado o alvo mínimo, corta na última
 * pontuação vista assim que o buffer passa desse tamanho.
 */
const ALVO_MINIMO = 80;
const ALVO_MAXIMO = 160;

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
  // Passo 1: procura pontuação que já feche um bloco grande o bastante
  // (ALVO_MINIMO). Se a pontuação vier antes disso (frase curta), guarda a
  // posição mas continua — a frase seguinte pode se juntar a ela.
  let ultimaPontuacaoPequena = -1;
  for (let i = 0; i < texto.length; i++) {
    if (PONTUACAO_FINAL.test(texto[i]!)) {
      const tamanho = i + 1;
      if (tamanho >= ALVO_MINIMO) return tamanho;
      ultimaPontuacaoPequena = tamanho;
    }
  }

  // Passo 2: ainda não atingiu o alvo mínimo em nenhuma pontuação — só corta
  // se o buffer já passou do teto (ALVO_MAXIMO), pra não crescer sem limite.
  if (texto.length < ALVO_MAXIMO) return -1;
  if (ultimaPontuacaoPequena !== -1) return ultimaPontuacaoPequena;

  // Run-on sem pontuação nenhuma até o teto: corta no último espaço antes
  // dele — nunca no meio de uma palavra.
  const espaco = texto.lastIndexOf(' ', ALVO_MAXIMO);
  return espaco > 10 ? espaco + 1 : ALVO_MAXIMO;
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

/* ==========================================================================
   8. IDIOMA DA RESPOSTA — detecção de contaminação por árabe

   INCIDENTE: a resposta final da NEXO (Groq, openai/gpt-oss-20b) às vezes
   inseria trechos em árabe no meio de uma explicação em português. Nenhum
   prompt estático do projeto contém árabe (conferido por busca em todo
   `api/`, `src/` e `shared/`) — é troca de idioma do próprio modelo, não
   contaminação de dado nosso. A defesa certa por isso é na SAÍDA (o que o
   modelo devolveu), nunca tentar filtrar a ENTRADA: dado de lead/memória
   pode legitimamente ter caractere estrangeiro (nome de empresa, endereço)
   e "limpar" isso na entrada corromperia dado real sem resolver o sintoma.
   ========================================================================== */

/**
 * Faixas Unicode do alfabeto árabe e extensões relacionadas — o bastante
 * para pegar o caso real do incidente, sem tentar ser um detector de idioma
 * completo. Em `\uXXXX` (não o caractere literal) de propósito: precisão
 * auditável num arquivo de segurança, sem depender do editor/encoding
 * preservar corretamente um caractere árabe colado no código-fonte.
 *
 *   U+0600–U+06FF  Arabic
 *   U+0750–U+077F  Arabic Supplement
 *   U+08A0–U+08FF  Arabic Extended-A
 *   U+FB50–U+FDFF  Arabic Presentation Forms-A
 *   U+FE70–U+FEFE  Arabic Presentation Forms-B
 *
 * `U+FEFF` (BOM, usado no export de CSV em `src/lib/exportar.ts`) fica de
 * FORA do último bloco de propósito: é pontuação invisível de codificação,
 * não um caractere árabe — incluí-la seria falso positivo.
 */
const FAIXA_ARABE = new RegExp('[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFE]', 'g');

/** A resposta contém algum caractere de escrita árabe? */
export function contemCaracteresArabes(texto: string): boolean {
  FAIXA_ARABE.lastIndex = 0;
  return FAIXA_ARABE.test(String(texto ?? ''));
}

/** Quantos caracteres árabes aparecem — só para o log de diagnóstico (nunca o texto em si). */
export function contarCaracteresArabes(texto: string): number {
  FAIXA_ARABE.lastIndex = 0;
  return String(texto ?? '').match(FAIXA_ARABE)?.length ?? 0;
}

/** Índice do primeiro caractere árabe em `texto`, ou -1 se não houver nenhum. */
function primeiroIndiceArabe(texto: string): number {
  FAIXA_ARABE.lastIndex = 0;
  const m = FAIXA_ARABE.exec(texto);
  return m ? m.index : -1;
}

/**
 * Tamanho da janela retida em buffer antes de liberar qualquer trecho ao
 * cliente durante o streaming da resposta final. Grande o bastante pra
 * pegar a maioria dos casos reais de contaminação por árabe (que tendem a
 * aparecer em rajadas de várias letras, não um caractere isolado) antes de
 * ele ser transmitido; pequeno o bastante pra não ser perceptível como
 * atraso na experiência de "digitando" da NEXO.
 */
export const MARGEM_SEGURANCA_IDIOMA = 64;

export interface PassoFiltroIdioma {
  /** Trecho novo, seguro para enviar agora — '' quando nada ficou liberável neste passo, ou quando `bloqueado`. */
  trecho: string;
  /** Até onde (índice em `textoAcumulado`) já foi liberado ao todo, contando este passo. */
  liberadoAte: number;
  /** true assim que árabe aparece no texto acumulado além do que já foi liberado — quem chama deve parar de consumir o stream: nada mais será liberado nesta tentativa. */
  bloqueado: boolean;
}

/**
 * Decide quanto de `textoAcumulado` pode ser liberado ao cliente AGORA,
 * mantendo sempre `margem` caracteres retidos no final — texto "ainda por
 * vir" o bastante pra um trecho árabe ser pego antes de ser transmitido.
 * Chamada uma vez por chunk recebido do modelo, sempre com o texto
 * ACUMULADO inteiro (nunca só o chunk novo): é o único jeito de garantir
 * que nada seja liberado antes de sobreviver pelo menos uma rodada dentro
 * da margem.
 *
 * INVARIANTE que sustenta a segurança: como só se libera até
 * `length - margem`, e o texto só cresce por append (o modelo nunca reedita
 * o que já mandou), qualquer árabe que apareça está SEMPRE numa posição
 * >= `liberadoAte` no momento em que aparece — nunca dentro do que já foi
 * liberado antes. Por isso, uma vez `bloqueado`, o que já foi liberado até
 * aqui continua garantidamente limpo.
 */
export function proximoTrechoSeguro(
  textoAcumulado: string,
  liberadoAte: number,
  margem: number = MARGEM_SEGURANCA_IDIOMA,
): PassoFiltroIdioma {
  if (primeiroIndiceArabe(textoAcumulado) !== -1) {
    return { trecho: '', liberadoAte, bloqueado: true };
  }
  const limite = Math.max(liberadoAte, textoAcumulado.length - margem);
  return { trecho: textoAcumulado.slice(liberadoAte, limite), liberadoAte: limite, bloqueado: false };
}

/**
 * Libera o que sobrou retido na margem — chamada só quando o stream
 * terminou por completo SEM nunca ter sido bloqueado (`primeiroIndiceArabe`
 * nunca achou nada em nenhuma chamada de `proximoTrechoSeguro` anterior).
 */
export function liberarRestante(textoAcumulado: string, liberadoAte: number): string {
  return textoAcumulado.slice(liberadoAte);
}

/**
 * O usuário pediu árabe explicitamente NESTE turno? Cobre os dois jeitos
 * naturais de pedir: escrever a mensagem em árabe (o pedido já está no
 * idioma) ou pedir em português ("responda em árabe", "fale em árabe").
 * Decide só pela mensagem ATUAL — pedir árabe há 10 turnos não autoriza o
 * modelo a continuar nesse idioma para sempre.
 */
export function usuarioPediuArabe(mensagemUsuario: string): boolean {
  if (contemCaracteresArabes(mensagemUsuario)) return true;
  return normalizar(mensagemUsuario).includes('arabe');
}

/* ==========================================================================
   7. COOLDOWN DE TTS — extração segura do tempo de espera num 429

   Genérico por design: não assume o formato de erro de um provedor
   específico. Já serviu para o Gemini TTS; serve igual para a ElevenLabs (ou
   qualquer outro) sem precisar reescrever nada — só reconhece mais um
   formato de corpo, além do header HTTP padrão.
   ========================================================================== */

/** Nunca esperar mais que isso, mesmo que o provedor sugira um valor maior. */
const RETRY_MS_MAXIMO = 60_000;
/** Usado quando o 429 não informa tempo nenhum (nem header, nem corpo). */
export const RETRY_MS_PADRAO = 20_000;

/**
 * Extrai, com segurança, quanto tempo esperar antes de tentar sintetizar
 * fala de novo depois de um 429. Nunca faz `eval`/parsing solto — só regex
 * simples e limitado, e todo valor é validado (finito, positivo) e limitado
 * a RETRY_MS_MAXIMO antes de ser usado. Ordem de preferência:
 *
 *   1. Header HTTP `Retry-After` (segundos) — o mais confiável quando existe,
 *      e não depende do formato de erro de nenhum provedor específico.
 *   2. Campos numéricos diretos comuns em corpos de erro JSON
 *      (`retry_after`, `retryAfter`, `retry_in`, `retryIn`, em segundos).
 *   3. Formato estruturado do Google (Gemini): `error.details[].retryDelay`
 *      (ex.: "20s").
 *   4. Texto livre "retry in/after Xs" em qualquer campo de mensagem
 *      reconhecido (`error.message`, `detail`/`detail.message`, `message`) —
 *      último recurso, só um padrão numérico simples, nunca conteúdo
 *      arbitrário interpretado.
 *
 * `corpo` é tratado como formato desconhecido (`unknown`) de propósito — a
 * função não presume QUAL provedor respondeu. `null` quando nenhuma fonte
 * tem um valor utilizável — quem chama decide o fallback (RETRY_MS_PADRAO).
 */
export function extrairRetryDelayMs(corpo: unknown, headerRetryAfter?: string | null): number | null {
  const limitar = (segundos: number): number | null =>
    Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos * 1000, RETRY_MS_MAXIMO) : null;

  if (headerRetryAfter) {
    const doHeader = limitar(Number(headerRetryAfter));
    if (doHeader !== null) return doHeader;
  }

  if (!corpo || typeof corpo !== 'object') return null;
  const raiz = corpo as Record<string, unknown>;

  for (const chave of ['retry_after', 'retryAfter', 'retry_in', 'retryIn']) {
    const valor = raiz[chave];
    if (typeof valor === 'number') {
      const doCampo = limitar(valor);
      if (doCampo !== null) return doCampo;
    }
  }

  const erro = raiz.error as { message?: unknown; details?: unknown } | undefined;
  const details = erro?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const bruto = (d as Record<string, unknown> | null)?.retryDelay;
      if (typeof bruto !== 'string') continue;
      const m = /^(\d+(?:\.\d+)?)s$/.exec(bruto.trim());
      if (!m) continue;
      const doDetalhe = limitar(Number(m[1]));
      if (doDetalhe !== null) return doDetalhe;
    }
  }

  const detail = raiz.detail as { message?: unknown } | string | undefined;
  const candidatosMensagem = [
    typeof erro?.message === 'string' ? erro.message : undefined,
    typeof detail === 'string' ? detail : undefined,
    typeof detail === 'object' && detail && typeof detail.message === 'string' ? detail.message : undefined,
    typeof raiz.message === 'string' ? (raiz.message as string) : undefined,
  ];
  for (const mensagem of candidatosMensagem) {
    if (!mensagem) continue;
    const m = /retry (?:in|after)\s+(\d+(?:\.\d+)?)\s*s/i.exec(mensagem);
    if (m) {
      const doTexto = limitar(Number(m[1]));
      if (doTexto !== null) return doTexto;
    }
  }

  return null;
}

/* ==========================================================================
   8. CIRCUIT BREAKER DE CREDENCIAL DE TTS — investigação do 401 recorrente

   INCIDENTE: a ElevenLabs recusou a chave (401) e o frontend continuou
   tentando — não em looping de RETRY da mesma chamada, mas porque a fila de
   fala (voz.ts) enfileira UM /api/nexo-ai/falar por SEGMENTO da resposta
   (ver `segmentarParaFala` acima — uma resposta de 400+ caracteres já vira
   3-5 segmentos), e cada segmento tentava a síntese de forma independente.
   Sem um freio, os 5 segmentos de uma resposta bateram os 5 na ElevenLabs e
   levaram 5 401 — exatamente o padrão observado em produção (várias
   chamadas em poucos segundos).

   Este predicado é o critério ÚNICO de "essa falha não é transitória, não
   adianta tentar de novo" — usado tanto pelo backend (falar.ts, pra decidir
   o `codigo: 'tts_credencial'` da resposta) quanto pelo frontend (voz.ts,
   pra travar a fila inteira assim que o primeiro segmento falhar assim).
   Compartilhado aqui porque `voz.ts` roda em `typeof window !== 'undefined'`
   e não pode ser exercitado pelo `node --test` deste projeto — mas esta
   função, sem DOM nenhum, pode.
   ========================================================================== */

/**
 * 401 (credencial inválida) e 403 (sem permissão) nunca são transitórios —
 * ao contrário de um 429 (limite de uso, que expira sozinho), tentar de
 * novo bate no mesmo erro sempre. `codigo` cobre o caso em que o status já
 * não é mais 401/403 na hora em que o frontend olha (ex.: um proxy
 * intermediário reembalando a resposta), mas o backend já identificou a
 * causa como credencial — ver `MENSAGENS_POR_STATUS`/`codigo` em falar.ts.
 */
export function deveTravarPorCredencial(status: number, codigo?: string | null): boolean {
  return status === 401 || status === 403 || codigo === 'tts_credencial';
}

/* ==========================================================================
   9. SANITIZAÇÃO DE TEXTO PARA TTS — emojis não são pronunciáveis

   CAUSA: o Google Cloud TTS (Chirp3 HD) narra o SIGNIFICADO de um emoji
   ("🚀" vira "foguete", "💪" vira "bíceps") em vez de ignorá-lo — comportamento
   documentado da síntese, não um bug do provedor. A resposta VISUAL da NEXO
   pode continuar com emoji (faz parte da UX do chat); só o texto que vai pro
   TTS precisa ser limpo, e só nesse ponto — nunca no que é persistido em
   `ai_messages` (ver falar.ts: `limparParaVoz` chama `sanitizarTextoParaTts`
   por último, imediatamente antes do fetch ao Cloud TTS).

   Remove, nesta ordem (ordem importa: keycap e bandeira usam caracteres que
   também apareceriam soltos nas limpezas genéricas de seletor/ZWJ abaixo):
     1. sequências de keycap (dígito/#/* + seletor de variação + combining
        enclosing keycap — ex.: "1️⃣");
     2. bandeiras (par de indicadores regionais — ex.: "🇧🇷");
     3. sequências de emoji "normais", incluindo ZWJ (emoji composto, ex.:
        família "👨‍👩‍👧") e modificador de tom de pele;
     4. seletor de variação solto e ZWJ solto que sobrarem.

   Cada remoção deixa uma "marca" de pausa em vez de simplesmente desaparecer:
   sem isso, "leads 🚀 Agora" viraria "leads  Agora" (duas metades de frase
   coladas sem pontuação, incoerente na voz). A marca vira "." só quando NÃO
   há pontuação terminal logo ali (evita "..") e nunca sobra ponto solto no
   início/fim do texto.
   ========================================================================== */

// Codepoints por escape explícito (\uXXXX), de propósito — são caracteres
// invisíveis/combinantes; literal no código-fonte seria ilegível e frágil a
// qualquer reencode do arquivo. U+FE0F = variation selector-16 (força estilo
// emoji), U+20E3 = combining enclosing keycap, U+200D = zero-width joiner.
const VS16 = '\u{FE0F}';
const ZWJ = '\u{200D}';
const KEYCAP = '\u{20E3}';

const TTS_REGEX_KEYCAP = new RegExp(`[0-9#*]${VS16}?${KEYCAP}`, 'gu');
const TTS_REGEX_BANDEIRA = /\p{Regional_Indicator}{2}/gu;
const TTS_REGEX_EMOJI_SEQ = new RegExp(
  `\\p{Extended_Pictographic}${VS16}?(?:\\p{Emoji_Modifier})?(?:${ZWJ}\\p{Extended_Pictographic}${VS16}?(?:\\p{Emoji_Modifier})?)*`,
  'gu',
);
const TTS_REGEX_SELETOR_SOLTO = /[\u{FE00}-\u{FE0F}]/gu;
const TTS_REGEX_ZWJ_SOLTO = new RegExp(ZWJ, 'gu');

const TTS_MARCADOR = ' EMOJI ';
const TTS_REGEX_MARCADORES_SEGUIDOS = new RegExp(`${TTS_MARCADOR}(?:\\s*${TTS_MARCADOR})+`, 'g');
const TTS_PONTUACAO_TERMINAL = /[.!?…]$/;
const TTS_COMECA_COM_PONTUACAO = /^[,;:.!?…]/;

/**
 * Sanitiza texto para o TTS: remove emoji/símbolos pictográficos decorativos
 * sem tocar em acento, número, moeda, porcentagem, sigla ou nome próprio —
 * nenhum deles usa os intervalos Unicode removidos aqui. Nunca quebra
 * palavra (só caracteres de emoji/seletor/ZWJ são alvo). Idempotente: rodar
 * duas vezes no mesmo texto dá o mesmo resultado.
 */
export function sanitizarTextoParaTts(textoOriginal: string): string {
  let texto = String(textoOriginal ?? '');
  if (!texto) return '';

  texto = texto.replace(TTS_REGEX_KEYCAP, TTS_MARCADOR);
  texto = texto.replace(TTS_REGEX_BANDEIRA, TTS_MARCADOR);
  texto = texto.replace(TTS_REGEX_EMOJI_SEQ, TTS_MARCADOR);
  texto = texto.replace(TTS_REGEX_SELETOR_SOLTO, '');
  texto = texto.replace(TTS_REGEX_ZWJ_SOLTO, '');
  texto = texto.replace(TTS_REGEX_MARCADORES_SEGUIDOS, TTS_MARCADOR);

  if (!texto.includes(TTS_MARCADOR)) {
    return texto.replace(/[ \t]+/g, ' ').trim();
  }

  const partes = texto.split(TTS_MARCADOR);
  let resultado = '';

  for (let i = 0; i < partes.length; i++) {
    const parte = partes[i]!.replace(/[ \t]+/g, ' ').trim();
    if (i === 0) {
      resultado = parte;
      continue;
    }

    const parteComecaComPontuacao = TTS_COMECA_COM_PONTUACAO.test(parte);
    if (resultado && !TTS_PONTUACAO_TERMINAL.test(resultado) && !parteComecaComPontuacao) {
      resultado += '.';
    }
    if (!parte) continue;
    resultado += parteComecaComPontuacao ? parte : (resultado ? ' ' : '') + parte;
  }

  return resultado.trim();
}

/* ==========================================================================
   10. MEMÓRIA — EXTRAÇÃO, VALIDAÇÃO E HEURÍSTICA DE CUSTO

   A recuperação (seção 2 acima) já existia. O que faltava era o lado da
   ESCRITA: decidir, por código determinístico, se o que o modelo extraiu
   (via tool-calling, na ferramenta `registrar_memoria` — ver ferramentas.ts)
   é seguro/coerente o bastante pra virar uma linha em `ai_memories`. A IA
   nunca grava sozinha: ela só propõe `{acao, categoria, chave, conteudo,
   importancia}`; `normalizarExtracaoMemoria` valida e normaliza tudo antes
   de qualquer INSERT/UPDATE (ver api/_lib/nexo-ai/memoria.ts).
   ========================================================================== */

export type AcaoMemoria = 'criar' | 'atualizar' | 'esquecer' | 'nenhuma';

/** O que a extração (Groq) devolve — não confiável ainda, por isso `unknown` nos campos livres. */
export interface ExtracaoMemoriaBruta {
  acao?: unknown;
  categoria?: unknown;
  chave?: unknown;
  conteudo?: unknown;
  importancia?: unknown;
}

export interface MemoriaNormalizada {
  acao: AcaoMemoria;
  categoria: TipoMemoria;
  /** Identificador curto e estável (slug) — usado pra achar a MESMA memória depois. */
  chave: string;
  conteudo: string;
  /** 0..1 — já convertido da escala 0-100 que a extração usa. */
  relevancia: number;
}

const CATEGORIAS_VALIDAS = new Set<TipoMemoria>(['empresa', 'preferencia', 'decisao', 'projeto', 'fato']);

/**
 * Sinônimos de categoria que a extração pode produzir apesar da instrução —
 * mapeia pro enum real que `ai_memories.tipo` já usa, em vez de rejeitar a
 * memória inteira por causa de um rótulo. Nunca inventa um enum novo no
 * banco: `identidade`/`pessoa`/`rotina`/`contexto`/`negocio` (vocabulário
 * mais natural, que apareceria num pedido em linguagem comum) caem num dos 5
 * valores que já existem.
 */
const SINONIMOS_CATEGORIA: Record<string, TipoMemoria> = {
  identidade: 'preferencia',
  pessoa: 'fato',
  rotina: 'fato',
  contexto: 'fato',
  negocio: 'empresa',
  negócio: 'empresa',
};

function normalizarCategoria(bruta: unknown): TipoMemoria {
  const t = typeof bruta === 'string' ? bruta.trim().toLowerCase() : '';
  if (CATEGORIAS_VALIDAS.has(t as TipoMemoria)) return t as TipoMemoria;
  return SINONIMOS_CATEGORIA[t] ?? 'fato';
}

/** Slug estável: sem acento, minúsculo, espaço/pontuação vira "_", sem "_" duplicado nem nas pontas. */
export function normalizarChave(bruta: string): string {
  return normalizar(String(bruta ?? ''))
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const TAMANHO_MAXIMO_CONTEUDO_MEMORIA = 500;

/**
 * Valida e normaliza a extração bruta do modelo — a ÚNICA porta de entrada
 * pra uma memória virar linha no banco. `null` = recusa (nada é gravado):
 * ação desconhecida, sem conteúdo, conteúdo vazio depois de aparado, acima
 * do tamanho máximo, ou contendo algo que `redigirSegredos` reconheceria
 * como segredo — memória parcialmente redigida ainda vazaria a FORMA do
 * segredo, então a resposta correta é recusar inteira, não gravar censurada.
 */
export function normalizarExtracaoMemoria(bruto: ExtracaoMemoriaBruta): MemoriaNormalizada | null {
  const acaoBruta = typeof bruto.acao === 'string' ? bruto.acao : 'nenhuma';
  const acao: AcaoMemoria = (['criar', 'atualizar', 'esquecer', 'nenhuma'] as const).includes(acaoBruta as AcaoMemoria)
    ? (acaoBruta as AcaoMemoria)
    : 'nenhuma';

  if (acao === 'nenhuma') return null;

  const conteudoBruto = typeof bruto.conteudo === 'string' ? bruto.conteudo.trim() : '';
  // "esquecer" pode vir só com a chave (ex.: "não me chame mais de Iong" ->
  // esquecer chave=nome_preferido, sem precisar repetir o conteúdo).
  if (acao !== 'esquecer' && !conteudoBruto) return null;
  if (conteudoBruto.length > TAMANHO_MAXIMO_CONTEUDO_MEMORIA) return null;
  if (conteudoBruto && redigirSegredos(conteudoBruto) !== conteudoBruto) return null;

  const chaveBruta = typeof bruto.chave === 'string' ? bruto.chave : conteudoBruto.slice(0, 60);
  const chave = normalizarChave(chaveBruta);
  if (acao !== 'esquecer' && !chave) return null;

  const categoria = normalizarCategoria(bruto.categoria);

  const importanciaBruta = Number(bruto.importancia);
  const importancia = Number.isFinite(importanciaBruta) ? Math.min(100, Math.max(0, importanciaBruta)) : 50;

  return { acao, categoria, chave, conteudo: conteudoBruto, relevancia: importancia / 100 };
}

/**
 * A nova memória é a MESMA que uma já existente (mesma coisa, dita de novo
 * ou de outro jeito) — usado pra decidir UPDATE em vez de duplicar. Duas
 * checagens, na ordem de confiança: chave idêntica (mesma categoria) é o
 * sinal forte; sem isso, sobreposição forte de palavras do conteúdo (Jaccard
 * >= 0.6) pega paráfrase da mesma ideia sem exigir a chave igual.
 */
export function mesmaMemoria(
  candidata: Pick<MemoriaNormalizada, 'chave' | 'categoria' | 'conteudo'>,
  existente: Pick<Memoria, 'tipo' | 'conteudo' | 'chaves'>,
): boolean {
  if (existente.tipo !== candidata.categoria) return false;

  const chaveExistente = (existente.chaves ?? [])[0];
  if (chaveExistente && normalizarChave(chaveExistente) === candidata.chave) return true;

  const a = new Set(palavrasChave(candidata.conteudo));
  const b = new Set(palavrasChave(existente.conteudo));
  if (a.size === 0 || b.size === 0) return false;

  let comuns = 0;
  for (const p of a) if (b.has(p)) comuns++;
  const uniao = new Set([...a, ...b]).size;
  return uniao > 0 && comuns / uniao >= 0.6;
}

/**
 * Heurística barata (sem chamar o modelo) pra decidir se vale a pena gastar
 * uma chamada de EXTRAÇÃO de memória nesta mensagem — o controle de custo
 * pedido: nem toda mensagem merece essa chamada extra. Saudação,
 * agradecimento e comando operacional (já roteados por outra classificação —
 * prospecção, criar campanha, consulta de dado) não passam daqui.
 *
 * TRADE-OFF DELIBERADO: lista de sinais, não um classificador. Recall não é
 * 100% — uma frase memorável mas fora do vocabulário abaixo não dispara a
 * extração. Prefere-se perder uma memória ocasional a pagar uma chamada ao
 * modelo em toda mensagem só pra descobrir que não tinha nada pra guardar.
 */
const SINAIS_MEMORIA = [
  'me chama', 'me chame', 'pode me chamar', 'me chamo', 'meu nome e',
  'prefiro', 'prefiro que', 'gosto que', 'nao gosto que',
  'nao quero mais', 'a partir de agora', 'de agora em diante',
  'sempre que', 'nunca mais', 'passo a', 'passamos a',
  'cuida de', 'cuida da', 'cuida do', 'e responsavel por', 'responsavel pelo', 'responsavel pela',
  'decidimos', 'ficou decidido', 'vamos usar', 'deixamos de usar',
  'nosso foco', 'nosso objetivo', 'nosso publico', 'nossa prioridade',
  'a nexo usa', 'a nexo e', 'nossa marca', 'nossa identidade', 'nossa empresa',
  'esquece que', 'esquecer que', 'nao lembra mais', 'apaga essa', 'apague essa',
  'nao me chame mais', 'para de me chamar',
].map(normalizar);

const IGNORAR_MEMORIA = new Set(
  ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'obrigado', 'obrigada', 'valeu', 'tchau', 'ok', 'blz', 'beleza', 'obg'].map(
    normalizar,
  ),
);

/**
 * Acha o `id` da memória ativa que um pedido de "esquecer" se refere — mais
 * permissivo que `mesmaMemoria` de propósito: um pedido de esquecimento
 * ("não me chame mais de Iong") pode não vir com a categoria certa, então a
 * chave (em QUALQUER categoria) já é sinal suficiente. Sem chave batendo,
 * cai para a mesma lógica de conteúdo de `mesmaMemoria`. `null` = nada pra
 * esquecer — quem chama não erra, só não faz nada.
 */
export function encontrarMemoriaParaEsquecer(
  candidata: Pick<MemoriaNormalizada, 'chave' | 'categoria' | 'conteudo'>,
  existentes: Pick<Memoria, 'id' | 'tipo' | 'conteudo' | 'chaves'>[],
): string | null {
  if (candidata.chave) {
    const porChave = existentes.find((m) => normalizarChave((m.chaves ?? [])[0] ?? '') === candidata.chave);
    if (porChave) return porChave.id;
  }
  if (candidata.conteudo) {
    const porConteudo = existentes.find((m) => mesmaMemoria(candidata, m));
    if (porConteudo) return porConteudo.id;
  }
  return null;
}

/**
 * Um erro de `fetch`/leitura de stream é um ABORTO INTENCIONAL (chamamos
 * `AbortController.abort()` nós mesmos, ex.: "Nova conversa" cancelando uma
 * resposta ainda em streaming) — nunca um erro de rede de verdade. Usada em
 * `src/nexo-ai/cliente.ts` para não mostrar "conexão interrompida" quando a
 * interrupção foi proposital.
 *
 * Não exige `instanceof DOMException` de propósito: o que a spec de Fetch
 * garante é `name === 'AbortError'` — checar só isso funciona com o
 * DOMException real do navegador e com qualquer mock/polyfill em teste, sem
 * depender de uma classe global específica.
 */
export function ehAbortoIntencional(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && (erro as { name?: unknown }).name === 'AbortError';
}

export function podeConterMemoria(mensagem: string): boolean {
  const t = normalizar(mensagem);
  if (!t || t.length < 6) return false;
  if (IGNORAR_MEMORIA.has(t)) return false;
  return SINAIS_MEMORIA.some((s) => t.includes(s));
}

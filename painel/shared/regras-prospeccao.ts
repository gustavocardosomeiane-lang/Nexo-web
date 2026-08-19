/**
 * Regras de prospecção automática da NEXO AI — parte PURA, sem rede, sem banco.
 *
 * Fica fora de `src/` e fora de `api/` pelo mesmo motivo dos outros módulos
 * em `shared/`: sem import com alias (`@/`) e sem dependência de navegador ou
 * de Node, roda igual no test runner, no frontend e nas funções serverless.
 * Nenhum arquivo em `shared/` importa outro — cada um é autocontido de
 * propósito, então os tipos mínimos abaixo são cópias deliberadas (não
 * imports) do que já existe em `src/types/index.ts`. Mexeu num, mexa no
 * outro.
 *
 * ESCOPO DESTE MÓDULO (Etapa 2 da prospecção automática):
 *   1. normalização de telefone, domínio, nome, endereço e texto geral;
 *   2. deduplicação — decidir se um candidato já existe;
 *   3. score de oportunidade a partir de uma análise de site JÁ FEITA.
 *
 * O QUE NÃO MORA AQUI (etapas futuras, propositalmente fora deste arquivo):
 *   busca no Google Places, fetch de site real, escrita no Supabase. Este
 *   módulo só decide, a partir de dados já coletados — nunca coleta nada.
 */

/* ============================================================================
   1. NORMALIZAÇÃO
   ========================================================================== */

/**
 * Normalização de texto geral: minúsculas, sem acento, sem pontuação, sem
 * espaço duplicado. Base para nome e endereço — comparar "Clínica São José"
 * com "clinica sao jose" precisa dar igual.
 */
export function normalizarTexto(texto: string | null | undefined): string {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    // Marcas de acento combinantes, depois do NFD. Escapado como \uXXXX (e
    // não colado literal na regex) de propósito — mesmo padrão de
    // `normalizar()` em regras-nexo-ai.ts, para não depender da fonte/editor
    // interpretar corretamente um caractere combinante solto no arquivo.
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarNome(nome: string | null | undefined): string {
  return normalizarTexto(nome);
}

export function normalizarEndereco(endereco: string | null | undefined): string {
  return normalizarTexto(endereco);
}

/**
 * Normaliza telefone para COMPARAÇÃO — não para exibição.
 *
 * Compara pelos últimos 11 dígitos: ignora diferença de DDI (55) e de nono
 * dígito ausente, que é onde o mesmo número se disfarça entre formatos.
 * Mesmo padrão já usado em `detectarTelefonesRepetidos`
 * (`shared/regras-slots.ts`) — não reinventa o critério, só reaproveita a
 * regra em um módulo que roda antes de o lead existir no banco.
 *
 * Telefone ausente ou curto demais para ser um número real vira string
 * vazia, de propósito: duas strings vazias NUNCA devem ser tratadas como
 * "o mesmo telefone" pela deduplicação — ver `verificarDuplicidade`.
 */
export function normalizarTelefone(telefone: string | null | undefined): string {
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  return digitos.length < 10 ? '' : digitos.slice(-11);
}

/**
 * Normaliza URL/domínio para COMPARAÇÃO: sem protocolo, sem "www.", sem
 * caminho/query/hash, sem porta, em minúsculas.
 *
 * "https://www.exemplo.com.br/pagina?x=1", "http://exemplo.com.br" e
 * "WWW.EXEMPLO.COM.BR" precisam virar o mesmo valor — é o que permite
 * reconhecer o mesmo negócio quando o site aparece grafado de formas
 * diferentes em fontes diferentes.
 */
export function normalizarDominio(url: string | null | undefined): string {
  const bruto = String(url ?? '').trim().toLowerCase();
  if (!bruto) return '';

  const semProtocolo = bruto.replace(/^[a-z]+:\/\//, '');
  const soHost = semProtocolo.split('/')[0]!.split('?')[0]!.split('#')[0]!;
  const semWww = soHost.replace(/^www\./, '');
  return semWww.replace(/:\d+$/, '');
}

/* ============================================================================
   2. DEDUPLICAÇÃO
   ========================================================================== */

/**
 * Só o que a decisão de duplicidade precisa saber — de um lead já salvo no
 * banco OU de um candidato ainda não importado. `id` identifica quem bateu
 * (id real do lead existente, ou um id sintético atribuído pelo chamador ao
 * candidato, quando a comparação é dentro do mesmo lote — ver
 * `deduplicarLote`).
 */
export interface RegistroDedup {
  id: string;
  place_id: string | null;
  telefone: string | null;
  site: string | null;
  nome: string;
  endereco: string | null;
}

export type MotivoDuplicidade = 'place_id' | 'telefone' | 'dominio' | 'nome_endereco';

export interface ResultadoDedup {
  duplicado: boolean;
  motivo: MotivoDuplicidade | null;
  /** `id` do registro (existente no banco, ou candidato anterior do mesmo lote) que bateu. */
  correspondeA: string | null;
}

/**
 * Decide se `candidato` já é um dos `existentes` — em ordem de confiança.
 *
 * A ORDEM IMPORTA E É A COMBINADA COM VOCÊ:
 *   1. place_id igual        -> mesmo negócio, sem dúvida.
 *   2. telefone normalizado  -> provável mesmo negócio.
 *   3. domínio normalizado   -> provável mesmo negócio.
 *   4. nome + endereço       -> provável mesmo negócio, só quando OS DOIS
 *      normalizados batem — nome sozinho tem colisão demais (duas empresas
 *      podem se chamar "Clínica São José" em bairros diferentes).
 *
 * Cada critério só compara quando o candidato tem o dado (place_id/telefone/
 * site/nome+endereço) NÃO VAZIO após normalizar — dois campos vazios nunca
 * contam como "iguais". Sem essa guarda, dois leads sem telefone cadastrado
 * se marcariam como duplicados um do outro, o que é o oposto de deduplicar
 * direito.
 */
export function verificarDuplicidade(
  candidato: RegistroDedup,
  existentes: RegistroDedup[],
): ResultadoDedup {
  if (candidato.place_id) {
    const achado = existentes.find((e) => e.place_id === candidato.place_id);
    if (achado) return { duplicado: true, motivo: 'place_id', correspondeA: achado.id };
  }

  const telCandidato = normalizarTelefone(candidato.telefone);
  if (telCandidato) {
    const achado = existentes.find((e) => normalizarTelefone(e.telefone) === telCandidato);
    if (achado) return { duplicado: true, motivo: 'telefone', correspondeA: achado.id };
  }

  const domCandidato = normalizarDominio(candidato.site);
  if (domCandidato) {
    const achado = existentes.find((e) => normalizarDominio(e.site) === domCandidato);
    if (achado) return { duplicado: true, motivo: 'dominio', correspondeA: achado.id };
  }

  const nomeCandidato = normalizarNome(candidato.nome);
  const enderecoCandidato = normalizarEndereco(candidato.endereco);
  if (nomeCandidato && enderecoCandidato) {
    const achado = existentes.find(
      (e) => normalizarNome(e.nome) === nomeCandidato && normalizarEndereco(e.endereco) === enderecoCandidato,
    );
    if (achado) return { duplicado: true, motivo: 'nome_endereco', correspondeA: achado.id };
  }

  return { duplicado: false, motivo: null, correspondeA: null };
}

/**
 * Aplica `verificarDuplicidade` a um LOTE inteiro de candidatos, na ordem em
 * que aparecem — comparando cada um contra os leads já existentes E contra
 * os candidatos ANTERIORES do mesmo lote que já passaram na checagem.
 *
 * Por quê: a mesma busca pode trazer o mesmo negócio duas vezes (o Google
 * Places às vezes devolve resultados próximos repetidos), e sem essa
 * checagem entre os próprios candidatos o segundo entraria como lead novo
 * mesmo nunca tendo sido comparado com o primeiro — só com o que já estava
 * no banco antes da busca começar.
 */
export function deduplicarLote(
  candidatos: RegistroDedup[],
  existentes: RegistroDedup[],
): ResultadoDedup[] {
  const conhecidos = [...existentes];
  const resultados: ResultadoDedup[] = [];

  for (const candidato of candidatos) {
    const resultado = verificarDuplicidade(candidato, conhecidos);
    resultados.push(resultado);
    if (!resultado.duplicado) conhecidos.push(candidato);
  }

  return resultados;
}

/* ============================================================================
   3. ANÁLISE DE SITE -> SCORE DE OPORTUNIDADE
   ========================================================================== */

/**
 * Achados técnicos de um site — espelha `AnaliseSite` em `src/types/index.ts`.
 * Esta etapa NUNCA faz o fetch: recebe o objeto já preenchido (etapa
 * seguinte da prospecção) e só calcula a nota em cima dele.
 */
export interface AnaliseSite {
  tem_site: boolean;
  acessivel: boolean;
  status_http: number | null;
  https: boolean;
  viewport_mobile: boolean;
  tempo_resposta_ms: number | null;
  tamanho_bytes: number | null;
  tem_cta: boolean;
  erro: string | null;
}

/**
 * Pesos do score, TODOS explícitos e num lugar só — mude aqui, nunca
 * espalhado pela função de cálculo.
 *
 * A LÓGICA POR TRÁS DOS NÚMEROS:
 *   - Sem site OU site fora do ar é a MAIOR oportunidade: o negócio não tem
 *     presença digital nenhuma agora. `semSite` e `siteNaoAcessivel` ficam
 *     perto do teto (90-100 = "oportunidade muito forte", ver
 *     `FAIXAS_OPORTUNIDADE`).
 *   - Site que responde começa de uma base BAIXA (`baseSiteAcessivel`): ele
 *     já é um ativo real, então a oportunidade cai bastante em relação a não
 *     ter nada — e SOBE conforme problemas técnicos concretos aparecem.
 *   - A soma máxima de um site que responde mas falha em tudo
 *     (`baseSiteAcessivel + semHttps + semViewportMobile + respostaLenta +
 *     semCta` = 10+15+20+10+15 = 70) fica na faixa "boa oportunidade" — pior
 *     que não ter site, melhor que um site saudável.
 *   - `semViewportMobile` pesa mais que os outros sinais porque a maior parte
 *     da busca local (o público-alvo da NEXO WEB) acontece no celular — um
 *     site que não se adapta perde o cliente na primeira olhada.
 */
export const PESOS_SCORE = {
  semSite: 95,
  siteNaoAcessivel: 90,
  baseSiteAcessivel: 10,
  semHttps: 15,
  semViewportMobile: 20,
  respostaLenta: 10,
  semCta: 15,
  /** Acima disto (em ms), a resposta do site é considerada lenta. */
  limiteRespostaLentaMs: 3000,
} as const;

/** Faixas de leitura do score — mesmas da conversa original com você. */
const FAIXAS_OPORTUNIDADE: readonly [limiteInferior: number, rotulo: string][] = [
  [90, 'Oportunidade muito forte'],
  [70, 'Boa oportunidade'],
  [40, 'Oportunidade média'],
  [0, 'Baixa prioridade'],
];

function rotuloDaFaixa(score: number): string {
  for (const [limite, rotulo] of FAIXAS_OPORTUNIDADE) {
    if (score >= limite) return rotulo;
  }
  return 'Baixa prioridade';
}

export interface FatorScore {
  /** Chave estável, para o código (ex.: filtrar/agrupar). */
  fator: string;
  /** Pontos que este fator somou ao score. */
  pontos: number;
  /** Texto para gente ler. */
  descricao: string;
}

export interface ResultadoScore {
  /** 0-100, já dentro dos limites — nunca sai da faixa, mesmo em combinações extremas. */
  score_oportunidade: number;
  /** Frase pronta para mostrar ao vendedor: faixa + fatores, em português. */
  motivo_score: string;
  /** Cada fator que compôs o score, individualmente — para auditoria/depuração. */
  fatores: FatorScore[];
}

function finalizarScore(fatores: FatorScore[]): ResultadoScore {
  const soma = fatores.reduce((total, f) => total + f.pontos, 0);
  const score = Math.max(0, Math.min(100, Math.round(soma)));
  const descricoes = fatores.map((f) => f.descricao).join(' ');

  return {
    score_oportunidade: score,
    motivo_score: `${rotuloDaFaixa(score)} (${score}/100). ${descricoes}`.trim(),
    fatores,
  };
}

/**
 * Calcula o score de oportunidade a partir de uma análise de site já pronta.
 *
 * DETERMINÍSTICO DE PROPÓSITO: nenhum modelo de IA participa desta conta.
 * Mesma `analise` sempre devolve o mesmo `ResultadoScore` — é assim que o
 * pipeline de importação (etapa seguinte) pode confiar no número sem
 * reabrir a análise, e é assim que este código pode ser testado sem gastar
 * um único token.
 */
export function calcularScoreOportunidade(analise: AnaliseSite): ResultadoScore {
  if (!analise.tem_site) {
    return finalizarScore([
      { fator: 'sem_site', pontos: PESOS_SCORE.semSite, descricao: 'Não tem site.' },
    ]);
  }

  if (!analise.acessivel) {
    return finalizarScore([
      {
        fator: 'site_nao_acessivel',
        pontos: PESOS_SCORE.siteNaoAcessivel,
        descricao: analise.erro ? `Site não responde (${analise.erro}).` : 'Site não responde.',
      },
    ]);
  }

  const fatores: FatorScore[] = [
    { fator: 'base_site_acessivel', pontos: PESOS_SCORE.baseSiteAcessivel, descricao: 'Site existe e responde.' },
  ];

  if (!analise.https) {
    fatores.push({ fator: 'sem_https', pontos: PESOS_SCORE.semHttps, descricao: 'Sem HTTPS.' });
  }

  if (!analise.viewport_mobile) {
    fatores.push({
      fator: 'sem_viewport_mobile',
      pontos: PESOS_SCORE.semViewportMobile,
      descricao: 'Não adaptado para celular (sem viewport mobile).',
    });
  }

  if (analise.tempo_resposta_ms !== null && analise.tempo_resposta_ms > PESOS_SCORE.limiteRespostaLentaMs) {
    fatores.push({
      fator: 'resposta_lenta',
      pontos: PESOS_SCORE.respostaLenta,
      descricao: `Resposta lenta (${analise.tempo_resposta_ms}ms).`,
    });
  }

  // "Sem CTA claro" e "sem contato visível" são o MESMO sinal técnico aqui:
  // link de telefone/WhatsApp ou formulário detectável. Não existem como
  // campos separados em `AnaliseSite` — ver a definição do tipo acima.
  if (!analise.tem_cta) {
    fatores.push({
      fator: 'sem_cta',
      pontos: PESOS_SCORE.semCta,
      descricao: 'Sem chamada para ação ou contato visível (telefone, WhatsApp ou formulário).',
    });
  }

  return finalizarScore(fatores);
}

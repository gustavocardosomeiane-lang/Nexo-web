/**
 * AI TOOL LAYER — o que a NEXO AI pode consultar.
 *
 * ===========================================================================
 * A IA NÃO FALA COM O BANCO. Ela pede a uma ferramenta, a ferramenta lê.
 *
 * Toda leitura usa o cliente `db` do USUÁRIO autenticado (ver api/_lib/auth.ts),
 * então a RLS decide o que volta — a IA não enxerga nada além do que a pessoa
 * já enxergaria na tela. E a matriz de permissões filtra ANTES: uma ferramenta
 * só é oferecida ao modelo se o usuário pode ver aquele módulo
 * (`ferramentasPermitidas` em shared/regras-nexo-ai.ts).
 *
 * FASE 1 = SOMENTE LEITURA + MEMÓRIA. Nenhuma ferramenta escreve em tabela de
 * negócio, nenhuma envia mensagem. Criar/atualizar/enviar é Fase 2.
 *
 * As ferramentas devolvem AGREGADOS, não tabelas cruas: "42 leads, 8
 * qualificados" custa uma fração dos tokens de 42 objetos JSON — e é o que
 * responde à pergunta.
 * ===========================================================================
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FerramentaModelo, ModeloProvider, MensagemModelo, ChamadaFerramenta } from './modelo';
import { redigirSegredos } from '../../../shared/regras-nexo-ai.js';
import { buscarLeadsLocais, carregarRegistrosDedup, type LeadPreparado } from './prospeccao.js';
import { ErroGooglePlaces } from './google-places.js';

export interface ContextoFerramenta {
  db: SupabaseClient;
  usuarioId: string;
  /**
   * Papel do usuário. As ferramentas de leitura não precisam disso — a
   * permissão delas já foi decidida antes, por módulo, em `permitidas`. Só
   * existe aqui porque `buscar_leads_locais` (a única ferramenta que
   * ESCREVE) precisa de uma checagem mais fina do que "enxerga o módulo
   * leads": ver o comentário de `buscar_leads_locais` em
   * `shared/regras-nexo-ai.ts`.
   */
  papel: string;
}

interface Ferramenta {
  definicao: FerramentaModelo;
  executar: (args: Record<string, unknown>, ctx: ContextoFerramenta) => Promise<unknown>;
}

const semArgs = { type: 'object', properties: {}, additionalProperties: false } as const;

/** Conta linhas de uma tabela por um filtro de status, em uma ida ao banco. */
async function contarPorStatus(
  db: SupabaseClient,
  tabela: string,
): Promise<{ total: number; por_status: Record<string, number> }> {
  const { data, error } = await db.from(tabela).select('status');
  if (error) throw new Error(error.message);
  const por_status: Record<string, number> = {};
  for (const linha of data ?? []) {
    const s = String((linha as { status?: string }).status ?? 'sem_status');
    por_status[s] = (por_status[s] ?? 0) + 1;
  }
  return { total: (data ?? []).length, por_status };
}

/* --------------------------------------------------------------------------
   Prospecção automática — buscar_leads_locais

   A ÚNICA ferramenta desta fase que ESCREVE no banco. Busca, análise, score
   e deduplicação continuam 100% em api/_lib/nexo-ai/prospeccao.ts e
   shared/regras-prospeccao.ts (Etapas 2 e 3) — este arquivo só valida a
   entrada, chama esse pipeline já pronto e faz o INSERT. Nenhuma lógica de
   busca/score/dedup é duplicada aqui.
   -------------------------------------------------------------------------- */

/** Só `nome` é NOT NULL em `leads` — é o único critério real de "dado mínimo suficiente". */
function temDadosMinimos(p: LeadPreparado): boolean {
  return Boolean(p.nome && p.nome.trim().length > 0);
}

function paraLinhaLead(p: LeadPreparado, dataEntrada: string): Record<string, unknown> {
  return {
    nome: p.nome,
    telefone: p.telefone,
    whatsapp: p.telefone,
    origem: p.origem,
    status: p.status,
    data_entrada: dataEntrada,
    cidade: p.cidade,
    endereco: p.endereco,
    nicho: p.nicho,
    site: p.site,
    place_id: p.place_id,
    score_oportunidade: p.score_oportunidade,
    motivo_score: p.motivo_score,
    analise_site: p.analise_site,
    analisado_em: p.analisado_em,
  };
}

interface LinhaImportada {
  id: string;
  place_id: string | null;
  nome: string;
  cidade: string | null;
  score_oportunidade: number | null;
}

/**
 * INSERT puro — nunca UPDATE, nunca upsert que sobrescreva um lead já
 * existente. Tenta em lote primeiro (rápido, e seguro quando não há
 * conflito); se o Postgres recusar por violação de unicidade de `place_id`
 * (condição de corrida real: alguém importou o mesmo negócio entre a
 * checagem de dedup e este insert), refaz linha a linha para salvar quem não
 * colide — em vez de perder o lote inteiro por causa de UMA colisão rara.
 */
async function importarLote(
  db: SupabaseClient,
  linhas: Record<string, unknown>[],
): Promise<{ inseridas: LinhaImportada[]; puladosPorConflito: number }> {
  if (linhas.length === 0) return { inseridas: [], puladosPorConflito: 0 };

  const CAMPOS_RETORNO = 'id, place_id, nome, cidade, score_oportunidade';

  const { data, error } = await db.from('leads').insert(linhas).select(CAMPOS_RETORNO);
  if (!error) return { inseridas: (data ?? []) as LinhaImportada[], puladosPorConflito: 0 };

  if (error.code !== '23505') throw new Error(error.message);

  const inseridas: LinhaImportada[] = [];
  let puladosPorConflito = 0;
  for (const linha of linhas) {
    const { data: linhaInserida, error: erroLinha } = await db
      .from('leads')
      .insert(linha)
      .select(CAMPOS_RETORNO)
      .single();
    if (erroLinha) {
      if (erroLinha.code === '23505') {
        puladosPorConflito += 1;
        continue;
      }
      throw new Error(erroLinha.message);
    }
    inseridas.push(linhaInserida as LinhaImportada);
  }
  return { inseridas, puladosPorConflito };
}

/** Mensagens FIXAS — nunca ecoam o texto bruto do Google, para nenhum detalhe vazar por acidente. */
function mensagemAmigavelGoogle(e: ErroGooglePlaces): string {
  if (e.codigo === 'sem_credencial') {
    return 'A busca de leads locais ainda não está configurada neste servidor.';
  }
  if (e.status === 429) {
    return 'O Google Places atingiu o limite de requisições agora. Tente de novo em alguns instantes.';
  }
  if (e.codigo === 'timeout' || e.codigo === 'rede') {
    return 'Não foi possível alcançar o Google Places agora. Tente de novo em instantes.';
  }
  return 'Não foi possível buscar negócios locais agora. Tente de novo em instantes.';
}

const QUANTIDADE_PADRAO_BUSCA = 30;
const QUANTIDADE_MAXIMA_BUSCA = 30;

/**
 * Espelha quem tem `leads:criar` em `src/auth/permissions.ts` (administrador
 * e vendedor). `financeiro` e `colaborador` enxergam o módulo `leads` na
 * matriz de visibilidade do servidor (`permissao.ts`), mas não podem criar
 * lead pela UI — e não podem aqui também.
 */
const PAPEIS_QUE_PODEM_IMPORTAR = new Set(['administrador', 'vendedor']);

async function executarBuscaEImportacao(
  args: Record<string, unknown>,
  ctx: ContextoFerramenta,
): Promise<Record<string, unknown>> {
  if (!PAPEIS_QUE_PODEM_IMPORTAR.has(ctx.papel)) {
    throw new Error('Importar leads automaticamente é permitido só para administradores e vendedores.');
  }

  const nicho = typeof args.nicho === 'string' ? args.nicho.trim() : '';
  const cidade = typeof args.cidade === 'string' ? args.cidade.trim() : '';
  if (!nicho) {
    throw new Error('Para buscar leads, preciso saber o nicho do negócio — por exemplo, "clínica de estética".');
  }
  if (!cidade) {
    throw new Error('Para buscar leads, preciso saber em qual cidade procurar.');
  }

  const quantidadeBruta = Number(args.quantidade);
  const quantidade = Number.isFinite(quantidadeBruta)
    ? Math.min(QUANTIDADE_MAXIMA_BUSCA, Math.max(1, Math.trunc(quantidadeBruta)))
    : QUANTIDADE_PADRAO_BUSCA;

  let preparados: LeadPreparado[];
  try {
    const existentes = await carregarRegistrosDedup(ctx.db);
    preparados = await buscarLeadsLocais({ nicho, cidade, quantidade }, existentes);
  } catch (e) {
    if (e instanceof ErroGooglePlaces) {
      console.error('[NEXO AI] prospecção — Google Places:', e.codigo, e.status, e.message);
      console.log('[NEXO AI] prospecção etapa=ferramenta executou=nao motivo=google_places');
      throw new Error(mensagemAmigavelGoogle(e));
    }
    console.error('[NEXO AI] prospecção — falha inesperada na busca:', e instanceof Error ? e.message : e);
    console.log('[NEXO AI] prospecção etapa=ferramenta executou=nao motivo=busca');
    throw new Error('Não foi possível buscar negócios locais agora. Tente de novo em instantes.');
  }

  // Duplicado (calculado por shared/regras-prospeccao.ts) nunca é importado.
  const duplicados = preparados.filter((p) => p.duplicado);
  // "Dado mínimo suficiente" = tem nome. Não é duplicado, mas também não
  // entra: sem nome, o INSERT falharia mesmo (constraint do banco).
  const semDadosMinimos = preparados.filter((p) => !p.duplicado && !temDadosMinimos(p));
  const elegiveis = preparados.filter((p) => !p.duplicado && temDadosMinimos(p));
  // Nunca importa mais que a quantidade pedida, mesmo que a busca tenha
  // achado mais candidatos elegíveis do que isso.
  const aImportar = elegiveis.slice(0, quantidade);
  const excedentes = elegiveis.length - aImportar.length;

  const dataEntrada = new Date().toISOString().slice(0, 10);
  const linhas = aImportar.map((p) => paraLinhaLead(p, dataEntrada));

  let inseridas: LinhaImportada[];
  let puladosPorConflito: number;
  try {
    ({ inseridas, puladosPorConflito } = await importarLote(ctx.db, linhas));
  } catch (e) {
    console.error('[NEXO AI] prospecção — falha ao importar no Supabase:', e instanceof Error ? e.message : e);
    console.log('[NEXO AI] prospecção etapa=ferramenta executou=nao motivo=supabase');
    throw new Error('Encontrei os leads, mas não consegui salvá-los agora. Tente de novo em instantes.');
  }

  console.log(
    '[NEXO AI] prospecção etapa=ferramenta',
    'executou=sim',
    'encontrados=' + preparados.length,
    'importados=' + inseridas.length,
  );

  return {
    solicitados: quantidade,
    encontrados: preparados.length,
    analisados: preparados.length,
    // Conflito de place_id por corrida é, na prática, mais um duplicado —
    // só descoberto um instante depois da checagem de dedup.
    duplicados: duplicados.length + puladosPorConflito,
    importados: inseridas.length,
    descartados: semDadosMinimos.length + excedentes,
    leads: inseridas.map((l) => ({ nome: l.nome, cidade: l.cidade, score_oportunidade: l.score_oportunidade })),
  };
}

/* --------------------------------------------------------------------------
   Catálogo
   -------------------------------------------------------------------------- */

const CATALOGO: Record<string, Ferramenta> = {
  consultar_leads: {
    definicao: {
      nome: 'consultar_leads',
      descricao: 'Total de leads e quantos há em cada etapa do funil. Use para "quantos leads temos", "leads qualificados".',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'leads'),
  },

  consultar_clientes: {
    definicao: {
      nome: 'consultar_clientes',
      descricao: 'Número de clientes na carteira.',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const { count, error } = await db.from('clients').select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return { total: count ?? 0 };
    },
  },

  consultar_vendas: {
    definicao: {
      nome: 'consultar_vendas',
      descricao: 'Vendas por status e valor total contratado. Use para "quanto vendemos", "vendas fechadas".',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const { data, error } = await db.from('sales').select('status, valor_total');
      if (error) throw new Error(error.message);
      const por_status: Record<string, number> = {};
      let valor_total_centavos = 0;
      for (const v of data ?? []) {
        const s = String((v as { status?: string }).status ?? 'sem_status');
        por_status[s] = (por_status[s] ?? 0) + 1;
        valor_total_centavos += Number((v as { valor_total?: number }).valor_total ?? 0);
      }
      return { total: (data ?? []).length, por_status, valor_total_reais: valor_total_centavos / 100 };
    },
  },

  consultar_pagamentos: {
    definicao: {
      nome: 'consultar_pagamentos',
      descricao: 'Pagamentos por status e total recebido (somente pagos). Use para "quanto recebemos".',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const { data, error } = await db.from('payments').select('status, valor');
      if (error) throw new Error(error.message);
      const por_status: Record<string, number> = {};
      let recebido_centavos = 0;
      for (const p of data ?? []) {
        const s = String((p as { status?: string }).status ?? 'sem_status');
        por_status[s] = (por_status[s] ?? 0) + 1;
        if (s === 'pago') recebido_centavos += Number((p as { valor?: number }).valor ?? 0);
      }
      return { total: (data ?? []).length, por_status, recebido_reais: recebido_centavos / 100 };
    },
  },

  consultar_projetos: {
    definicao: {
      nome: 'consultar_projetos',
      descricao: 'Projetos por status (em andamento, entregue, etc.).',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'projects'),
  },

  consultar_campanhas: {
    definicao: {
      nome: 'consultar_campanhas',
      descricao: 'Campanhas de prospecção por status.',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'campaigns'),
  },

  consultar_conversas: {
    definicao: {
      nome: 'consultar_conversas',
      descricao: 'Conversas registradas por status e etapa do funil.',
      parametros: semArgs,
    },
    executar: (_a, { db }) => contarPorStatus(db, 'conversations'),
  },

  consultar_metricas: {
    definicao: {
      nome: 'consultar_metricas',
      descricao: 'Visão geral do negócio: contagens de leads, clientes, vendas e projetos de uma vez. Use para "como estamos", "resumo geral".',
      parametros: semArgs,
    },
    executar: async (_a, { db }) => {
      const contar = async (t: string) => {
        const { count } = await db.from(t).select('*', { count: 'exact', head: true });
        return count ?? 0;
      };
      const [leads, clientes, vendas, projetos] = await Promise.all([
        contar('leads'),
        contar('clients'),
        contar('sales'),
        contar('projects'),
      ]);
      return { leads, clientes, vendas, projetos };
    },
  },

  buscar_leads_locais: {
    definicao: {
      nome: 'buscar_leads_locais',
      descricao:
        'Busca negócios locais no Google Places, analisa os sites, calcula um score de oportunidade e IMPORTA os melhores como leads novos no CRM. Use quando o usuário pedir para procurar, buscar ou encontrar empresas/negócios de um nicho numa cidade — ex.: "procure 30 clínicas de estética em Goiânia". Nunca chame sem nicho e cidade.',
      parametros: {
        type: 'object',
        properties: {
          nicho: {
            type: 'string',
            description: 'Tipo de negócio a procurar, como o usuário descreveu — ex.: "clínica de estética".',
          },
          cidade: { type: 'string', description: 'Cidade onde procurar — ex.: "Goiânia".' },
          quantidade: {
            type: 'integer',
            description: `Quantos leads importar, entre 1 e ${QUANTIDADE_MAXIMA_BUSCA}. Se o usuário não disser, use ${QUANTIDADE_PADRAO_BUSCA}.`,
          },
        },
        required: ['nicho', 'cidade'],
        additionalProperties: false,
      },
    },
    executar: executarBuscaEImportacao,
  },
};

/** Definições para o modelo, já filtradas por permissão. */
export function definicoesDe(nomes: string[]): FerramentaModelo[] {
  return nomes.map((n) => CATALOGO[n]?.definicao).filter((d): d is FerramentaModelo => Boolean(d));
}

/**
 * Executa uma ferramenta.
 *
 * `permitidas` é a lista já filtrada por permissão do usuário. Uma chamada a
 * ferramenta fora dela é recusada mesmo que o modelo peça — o modelo não é
 * autoridade sobre permissão. Toda saída passa pelo redator de segredos.
 */
export async function executarFerramenta(
  nome: string,
  args: Record<string, unknown>,
  ctx: ContextoFerramenta,
  permitidas: string[],
): Promise<string> {
  if (!permitidas.includes(nome)) {
    return JSON.stringify({ erro: 'Sem permissão para esta consulta.' });
  }
  const ferramenta = CATALOGO[nome];
  if (!ferramenta) {
    return JSON.stringify({ erro: 'Ferramenta desconhecida.' });
  }
  try {
    const resultado = await ferramenta.executar(args, ctx);
    return redigirSegredos(JSON.stringify(resultado));
  } catch (e) {
    return JSON.stringify({ erro: e instanceof Error ? e.message : 'Falha ao consultar.' });
  }
}

/**
 * Ferramentas que existem nesta fase (sem memória). Quase todas são leitura
 * pura; `buscar_leads_locais` é a única exceção — grava leads novos, nunca
 * modifica um lead existente (ver `executarBuscaEImportacao` acima).
 */
export const FERRAMENTAS_DADOS = Object.keys(CATALOGO);

/* --------------------------------------------------------------------------
   Extração de parâmetros por linguagem natural — SÓ para buscar_leads_locais

   A ÚNICA coisa que o modelo decide nesta ferramenta: OS PARÂMETROS da busca
   (nicho/cidade/quantidade), a partir do texto livre do usuário. Score,
   dedup e o que é importado continuam 100% em `executarBuscaEImportacao`
   acima — código determinístico, nunca o modelo.
   -------------------------------------------------------------------------- */

function normalizarParaDeteccao(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

/**
 * Sinal direto, numa mensagem só — sem olhar histórico.
 *
 * DESCOBERTA (fora do CRM) vs. LEITURA (dentro do CRM) são a mesma palavra
 * "leads" na boca do usuário na maior parte das vezes — "3 leads novos" e
 * "quantos leads eu tenho" compartilham o substantivo. Por isso a palavra
 * sozinha nunca decide aqui: ou vem com um VERBO de descoberta
 * (procure/buscar/traga/...), ou vem com um SINAL específico de
 * descoberta ("leads novos", "sem site", "site ruim") que uma pergunta de
 * leitura do CRM não usaria — e mesmo esse sinal recua na frente de um
 * verbo de LEITURA explícito ("filtre os leads novos" continua leitura).
 */
function sinalDiretoDeProspeccao(mensagem: string): boolean {
  const t = normalizarParaDeteccao(mensagem);

  const verbosDescoberta = [
    'procure', 'procurar', 'busque', 'buscar', 'encontre', 'encontrar',
    'prospecte', 'prospectar', 'traga', 'trazer',
  ];
  const contexto = [
    'empresa', 'empresas', 'negocio', 'negocios', 'cliente', 'clientes',
    'lead', 'leads', 'clinica', 'clinicas', 'loja', 'lojas', 'salao', 'saloes',
    'academia', 'academias', 'consultorio', 'consultorios', 'restaurante', 'restaurantes',
  ];
  if (verbosDescoberta.some((v) => t.includes(v)) && contexto.some((c) => t.includes(c))) return true;

  // "site ruim"/"sem site" só fazem sentido pedindo descoberta de negócio
  // novo — ninguém filtra o próprio CRM por qualidade de site.
  const sinaisSite = [
    'sem site', 'site ruim', 'site quebrado', 'site desatualizado',
    'sem presenca digital', 'presenca digital fraca', 'precisam de site', 'precisa de site',
  ];
  if (sinaisSite.some((s) => t.includes(s))) return true;

  // "leads novos"/"novos leads" é forte, mas recua se vier junto de um
  // verbo de LEITURA do CRM — "filtre os leads novos" não é prospecção.
  const verbosLeituraCrm = ['filtre', 'filtrar', 'mostre', 'mostrar', 'liste', 'listar', 'quantos', 'quantas', 'quais sao'];
  const combosNovosLeads = ['leads novos', 'novos leads', 'novo lead', 'clientes novos', 'novos clientes'];
  if (combosNovosLeads.some((c) => t.includes(c)) && !verbosLeituraCrm.some((v) => t.includes(v))) return true;

  return false;
}

/**
 * Uma resposta em formato de formulário ("Nicho: ... / Localização: ... /
 * Quantidade: ...") não tem verbo nenhum — não é uma FRASE, é dado
 * estruturado. Só conta como prospecção se o turno anterior já estava
 * nesse fluxo (ver `conversaRecenteEmProspeccao`).
 */
function pareceContinuacaoEstruturada(mensagem: string): boolean {
  const t = normalizarParaDeteccao(mensagem);
  const rotulos = ['nicho:', 'localizacao:', 'cidade:', 'quantidade:', 'segmento:', 'regiao:'];
  return rotulos.filter((r) => t.includes(r)).length >= 2;
}

/** O usuário pediu uma descoberta de negócio recentemente nesta conversa? */
function conversaRecenteEmProspeccao(historico: MensagemModelo[]): boolean {
  // Só os últimos turnos — não reabre um fluxo de prospecção de muitas
  // mensagens atrás só porque o assunto passou por perto antes.
  const recentes = historico.slice(-6);
  return recentes.some((m) => m.papel === 'user' && sinalDiretoDeProspeccao(m.conteudo));
}

/**
 * Detecção barata por palavra-chave, ANTES de gastar uma chamada ao
 * modelo. `historico` (já recortado pelo orçamento de tokens de quem
 * chama) é o que permite reconhecer uma resposta estruturada
 * ("Nicho: ... / Localização: ... / Quantidade: ...") como continuação de
 * um pedido de prospecção começado num turno anterior, em vez de cair na
 * leitura do CRM só porque a mensagem também menciona "leads".
 */
export function pareceComandoDeProspeccao(mensagem: string, historico: MensagemModelo[] = []): boolean {
  if (sinalDiretoDeProspeccao(mensagem)) return true;
  return pareceContinuacaoEstruturada(mensagem) && conversaRecenteEmProspeccao(historico);
}

const SISTEMA_EXTRACAO_PROSPECCAO = `Você extrai os parâmetros de uma busca de leads locais a partir do pedido do usuário — considerando a conversa INTEIRA, não só a última mensagem.

Se o usuário pedir para procurar, buscar ou encontrar empresas/negócios de um tipo numa cidade, chame a ferramenta buscar_leads_locais com nicho, cidade e, se ele disser um número, quantidade.

O PEDIDO PODE TER SIDO MONTADO EM VÁRIAS MENSAGENS. Se o nicho foi dito numa mensagem anterior e a cidade só apareceu agora (ou vice-versa), combine as duas e chame a ferramenta — não trate como se faltasse informação só porque ela não está toda na última mensagem.

Se o usuário mencionar "sem site", "site ruim", "site quebrado" ou algo parecido, ISSO NÃO É UM PARÂMETRO da ferramenta — é automático, a busca já prioriza esses casos sozinha. Nunca deixe de chamar a ferramenta, e nunca peça confirmação, por causa disso.

NUNCA peça confirmação de um dado que o usuário já informou — em qualquer mensagem da conversa. Só deixe de chamar a ferramenta quando o nicho OU a cidade realmente nunca tiverem sido ditos; nesse caso, não chame nenhuma ferramenta — a falta dessa informação é tratada por outra parte do sistema, você não precisa responder nada aqui.

Se precisar escrever algum texto (por exemplo, ao pedir a informação que falta), responda exclusivamente em português do Brasil.`;

/** Recorte mínimo de `ModeloProvider` — só o que esta função precisa, para poder ser testada com um provedor falso. */
export interface ProvedorExtracao {
  conversar: ModeloProvider['conversar'];
}

/**
 * Chama o modelo SÓ para extrair nicho/cidade/quantidade — nunca para
 * decidir o que fazer com o resultado da busca.
 *
 * `historico` é o que já foi dito ANTES desta mensagem, na mesma conversa —
 * já recortado pelo orçamento de tokens de quem chama (mesmo histórico que
 * a resposta final usa). SEM ISSO, um pedido de prospecção montado em dois
 * turnos ("procure clínicas de estética" → "qual cidade?" → "Goiânia")
 * nunca se completa: cada mensagem seria extraída isoladamente, e a segunda
 * ("Goiânia") sozinha não tem nicho nenhum para a ferramenta exigir.
 *
 * `null` quando o modelo não chamou a ferramenta (geralmente porque faltou
 * nicho ou cidade em toda a conversa) ou quando a chamada ao modelo falhou —
 * os dois casos são tratados como "não é uma prospecção executável agora",
 * nunca como erro fatal da conversa: quem chama simplesmente segue sem os
 * dados de prospecção, e a resposta normal da NEXO conduz o resto.
 */
export async function extrairParametrosBusca(
  mensagem: string,
  historico: MensagemModelo[],
  provedor: ProvedorExtracao,
): Promise<Record<string, unknown> | null> {
  const mensagens: MensagemModelo[] = [...historico, { papel: 'user', conteudo: mensagem }];
  try {
    const resposta = await provedor.conversar({
      sistema: SISTEMA_EXTRACAO_PROSPECCAO,
      mensagens,
      ferramentas: definicoesDe(['buscar_leads_locais']),
      maxTokensSaida: 200,
      etapa: 'extracao',
    });
    const chamada = resposta.chamadas.find((c: ChamadaFerramenta) => c.nome === 'buscar_leads_locais');
    return chamada?.argumentos ?? null;
  } catch (e) {
    console.error('[NEXO AI] prospecção — falha ao extrair parâmetros:', e instanceof Error ? e.message : e);
    return null;
  }
}

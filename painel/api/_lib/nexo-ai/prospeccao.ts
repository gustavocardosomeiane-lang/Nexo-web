/**
 * Orquestração determinística da prospecção automática — Etapa 3.
 *
 * ===========================================================================
 *   pedido -> Google Places -> candidatos -> análise dos sites -> score ->
 *   dedup -> resultado PREPARADO (nada é gravado no Supabase ainda — isso é
 *   Etapa 4).
 *
 * NENHUMA decisão de score, dedup ou "o que vale a pena salvar" passa pelo
 * Groq: `calcularScoreOportunidade` e `deduplicarLote` são as mesmas funções
 * puras de `shared/regras-prospeccao.ts`, testadas sem rede na Etapa 2 — este
 * arquivo só alimenta elas com dado real.
 * ===========================================================================
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarCandidatosGooglePlaces, mapComConcorrenciaLimitada, type CandidatoGooglePlaces } from './google-places.js';
import { analisarSite, type AnaliseSite } from './analise-site.js';
import {
  calcularScoreOportunidade,
  deduplicarLote,
  type RegistroDedup,
} from '../../../shared/regras-prospeccao.js';

/** Quantas análises de site rodam em paralelo, no máximo — combinado com você. */
export const CONCORRENCIA_ANALISE_SITE = 8;

/**
 * Folga sobre a quantidade pedida: buscamos um pouco mais do que o
 * necessário, porque parte dos candidatos vira duplicado ou não tem dado
 * mínimo suficiente — sem margem, um pedido de 30 raramente IMPORTARIA 30.
 * `buscarCandidatosGooglePlaces` continua com seu próprio teto absoluto
 * (nunca busca ilimitada, ver google-places.ts); esta folga só afeta quanto
 * pedimos DENTRO desse teto.
 */
const FOLGA_BUSCA = 10;

/** Usado quando o candidato não tem site: nenhum fetch é feito, o score reconhece "sem site" direto. */
const ANALISE_SEM_SITE: AnaliseSite = {
  tem_site: false,
  acessivel: false,
  status_http: null,
  https: false,
  viewport_mobile: false,
  tempo_resposta_ms: null,
  tamanho_bytes: null,
  tem_cta: false,
  erro: null,
};

export interface PedidoBusca {
  nicho: string;
  cidade: string;
  quantidade: number;
}

/**
 * Resultado por candidato — pronto para uma futura importação, mas ainda
 * não importado. Espelha os campos de `leads` (migration 003) mais os dois
 * campos de decisão de dedup, que não vão para o banco: servem só para quem
 * for revisar/importar decidir o que fazer com um candidato duplicado.
 */
export interface LeadPreparado {
  nome: string;
  telefone: string | null;
  endereco: string | null;
  cidade: string | null;
  /** Nicho pesquisado — mesmo texto do pedido, não o que o Google devolveu. */
  nicho: string;
  site: string | null;
  place_id: string;
  /** Mirrora `LeadOrigem` em src/types/index.ts. */
  origem: 'prospeccao_ia';
  /** Mirrora `LeadStatus` em src/types/index.ts — todo lead novo entra aqui. */
  status: 'novo';
  score_oportunidade: number;
  motivo_score: string;
  /** `null` quando o candidato não tem site — não há análise para guardar. */
  analise_site: AnaliseSite | null;
  analisado_em: string | null;
  duplicado: boolean;
  motivo_duplicidade: string | null;
}

function paraRegistroDedup(c: CandidatoGooglePlaces): RegistroDedup {
  return {
    id: c.place_id,
    place_id: c.place_id,
    telefone: c.telefone,
    site: c.site,
    nome: c.nome,
    endereco: c.endereco,
  };
}

/**
 * Busca, analisa, pontua e deduplica — sem gravar nada.
 *
 * `existentes` é opcional de propósito: em produção vem de
 * `carregarRegistrosDedup` (abaixo), mas em teste é só um array literal — a
 * função não sabe nem precisa saber de onde os dados vieram, só compara.
 */
export interface OpcoesBuscaLeadsLocais {
  /** Override só para teste — evita esperar o timeout real de 5s por site. */
  timeoutAnaliseSiteMs?: number;
}

export async function buscarLeadsLocais(
  pedido: PedidoBusca,
  existentes: RegistroDedup[] = [],
  opcoes: OpcoesBuscaLeadsLocais = {},
): Promise<LeadPreparado[]> {
  const candidatos = await buscarCandidatosGooglePlaces(
    pedido.nicho,
    pedido.cidade,
    pedido.quantidade + FOLGA_BUSCA,
  );

  const analisados = await mapComConcorrenciaLimitada(candidatos, CONCORRENCIA_ANALISE_SITE, async (candidato) => {
    const temSiteReal = Boolean(candidato.site);
    const analise = temSiteReal
      ? await analisarSite(candidato.site!, { timeoutMs: opcoes.timeoutAnaliseSiteMs })
      : ANALISE_SEM_SITE;
    return { candidato, temSiteReal, analise };
  });

  const registrosCandidatos = analisados.map(({ candidato }) => paraRegistroDedup(candidato));
  const resultadosDedup = deduplicarLote(registrosCandidatos, existentes);

  const agora = new Date().toISOString();

  return analisados.map(({ candidato, temSiteReal, analise }, indice) => {
    const score = calcularScoreOportunidade(analise);
    const dedup = resultadosDedup[indice]!;

    return {
      nome: candidato.nome,
      telefone: candidato.telefone,
      endereco: candidato.endereco,
      // O Google às vezes não devolve `locality` para um endereço específico
      // (bairro sem componente próprio, por exemplo) — a cidade pesquisada é
      // um fallback honesto, nunca inventado.
      cidade: candidato.cidade ?? pedido.cidade,
      nicho: pedido.nicho,
      site: candidato.site,
      place_id: candidato.place_id,
      origem: 'prospeccao_ia',
      status: 'novo',
      score_oportunidade: score.score_oportunidade,
      motivo_score: score.motivo_score,
      analise_site: temSiteReal ? analise : null,
      analisado_em: temSiteReal ? agora : null,
      duplicado: dedup.duplicado,
      motivo_duplicidade: dedup.motivo,
    };
  });
}

/**
 * Lê os leads existentes na forma mínima que a deduplicação precisa.
 *
 * SÓ LEITURA — nenhuma escrita acontece aqui, e nenhuma acontece em
 * `buscarLeadsLocais` acima. Usa o `db` do usuário autenticado (RLS), nunca
 * `service_role` — mesma regra de `api/_lib/auth.ts` para toda leitura da
 * NEXO AI. Ainda não é chamada por nenhum endpoint (isso é Etapa 4); existe
 * aqui pronta para quando a importação real precisar dela.
 */
export async function carregarRegistrosDedup(db: SupabaseClient): Promise<RegistroDedup[]> {
  const { data, error } = await db.from('leads').select('id, place_id, telefone, site, nome, endereco');
  if (error) throw new Error(error.message);

  return (data ?? []).map((linha) => {
    const l = linha as Record<string, unknown>;
    return {
      id: String(l.id),
      place_id: (l.place_id as string | null) ?? null,
      telefone: (l.telefone as string | null) ?? null,
      site: (l.site as string | null) ?? null,
      nome: String(l.nome ?? ''),
      endereco: (l.endereco as string | null) ?? null,
    };
  });
}

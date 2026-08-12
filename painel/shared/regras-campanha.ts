/**
 * Regras de campanha — a parte PURA, sem banco.
 *
 * Fica fora de `src/` pelo mesmo motivo de `regras-pagamento.ts`: sem imports
 * com alias (`@/`), estas funções rodam no test runner do Node sem arrastar a
 * aplicação inteira junto. E são exatamente elas que decidem quem recebe
 * mensagem — a lógica que mais merece teste.
 *
 * O orquestrador que fala com o banco vive em
 * `src/integrations/ninjabot/campanhas.ts` e reexporta tudo daqui.
 */

/* --------------------------------------------------------------------------
   Tipos mínimos
   -------------------------------------------------------------------------- */

/** Só o que a decisão precisa saber sobre o lead. */
export interface LeadAvaliavel {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  whatsapp: string | null;
  tags: string[];
  nao_contatar: boolean;
  status: string;
}

export interface AlvoContavel {
  status: 'pendente' | 'enviado' | 'respondido' | 'ignorado' | 'falhou';
}

/* --------------------------------------------------------------------------
   Constantes
   -------------------------------------------------------------------------- */

/** Lote padrão. Combinado: 10 por vez. */
export const TAMANHO_LOTE_PADRAO = 10;

/** Dias que um lead fica em carência depois de contatado por qualquer campanha. */
export const CARENCIA_DIAS = 30;

export const VARIAVEIS_DISPONIVEIS = ['{{nome}}', '{{primeiro_nome}}', '{{empresa}}'] as const;

/* --------------------------------------------------------------------------
   Mensagem
   -------------------------------------------------------------------------- */

/**
 * Substitui as variáveis do modelo pelos dados do lead.
 * Variável sem valor vira string vazia — nunca "undefined" na mensagem.
 */
export function montarMensagem(modelo: string, lead: Pick<LeadAvaliavel, 'nome' | 'empresa'>): string {
  const primeiroNome = lead.nome.trim().split(/\s+/)[0] ?? '';
  return modelo
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiroNome)
    .replace(/\{\{\s*nome\s*\}\}/gi, lead.nome.trim())
    .replace(/\{\{\s*empresa\s*\}\}/gi, lead.empresa?.trim() ?? '')
    // Espaço duplo sobra quando uma variável fica vazia.
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* --------------------------------------------------------------------------
   Elegibilidade — AS TRAVAS
   -------------------------------------------------------------------------- */

export type MotivoInelegivel =
  | 'sem_whatsapp'
  | 'nao_contatar'
  | 'fora_da_tag'
  | 'ja_cliente'
  | 'em_carencia'
  | 'ja_na_campanha';

export const MOTIVO_TEXTO: Record<MotivoInelegivel, string> = {
  sem_whatsapp: 'Sem número de WhatsApp',
  nao_contatar: 'Marcado como “não contatar”',
  fora_da_tag: 'Não tem a tag da campanha',
  ja_cliente: 'Já é cliente',
  em_carencia: `Contatado nos últimos ${CARENCIA_DIAS} dias`,
  ja_na_campanha: 'Já está nesta campanha',
};

export interface Avaliacao<T extends LeadAvaliavel = LeadAvaliavel> {
  lead: T;
  elegivel: boolean;
  motivo?: MotivoInelegivel;
}

export function temTag(lead: LeadAvaliavel, tag: string): boolean {
  return Array.isArray(lead.tags) && lead.tags.includes(tag);
}

/**
 * Decide, lead a lead, quem pode receber a campanha.
 *
 * A ORDEM DAS CHECAGENS IMPORTA. `nao_contatar` vem logo depois da tag para
 * que um contato pessoal marcado assim nunca escape por outra combinação — e
 * para que o motivo relatado seja o mais grave, não o primeiro por acaso.
 *
 * Devolve também os inelegíveis, com o motivo: a tela mostra "42 entram, 7
 * ficam de fora" e explica cada exclusão. Filtro silencioso esconde erro de
 * cadastro.
 */
export function avaliarPublico<T extends LeadAvaliavel>(
  leads: T[],
  campanha: { tag: string },
  contexto: { jaNaCampanha: Set<string>; emCarencia: Set<string> },
): Avaliacao<T>[] {
  return leads.map((lead) => {
    const reprovar = (motivo: MotivoInelegivel): Avaliacao<T> => ({ lead, elegivel: false, motivo });

    if (!temTag(lead, campanha.tag)) return reprovar('fora_da_tag');
    if (lead.nao_contatar) return reprovar('nao_contatar');
    if (!lead.whatsapp && !lead.telefone) return reprovar('sem_whatsapp');
    if (lead.status === 'cliente') return reprovar('ja_cliente');
    if (contexto.jaNaCampanha.has(lead.id)) return reprovar('ja_na_campanha');
    if (contexto.emCarencia.has(lead.id)) return reprovar('em_carencia');

    return { lead, elegivel: true };
  });
}

/* --------------------------------------------------------------------------
   Resumo
   -------------------------------------------------------------------------- */

export interface ResumoCampanha {
  total: number;
  pendentes: number;
  enviados: number;
  respondidos: number;
  ignorados: number;
  falhas: number;
  /** Percentual de resposta sobre quem foi efetivamente contatado. */
  taxa_resposta: number;
}

export function resumirCampanha(alvos: AlvoContavel[]): ResumoCampanha {
  const conta = (s: AlvoContavel['status']) => alvos.filter((a) => a.status === s).length;

  const enviados = conta('enviado');
  const respondidos = conta('respondido');
  // Quem respondeu também recebeu: a base é a soma dos dois. Usar só
  // `enviados` inflaria a taxa a cada resposta.
  const contatados = enviados + respondidos;

  return {
    total: alvos.length,
    pendentes: conta('pendente'),
    enviados,
    respondidos,
    ignorados: conta('ignorado'),
    falhas: conta('falhou'),
    taxa_resposta: contatados === 0 ? 0 : (respondidos / contatados) * 100,
  };
}

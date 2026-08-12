/**
 * Leitura das variaveis de ambiente e decisao de MODO.
 *
 * Ponto unico onde `import.meta.env` e tocado. Se alguem precisar saber se o
 * painel esta em mock ou em producao, pergunta aqui — nao espalhe `if (env...)`
 * pela aplicacao.
 */

export type DataMode = 'mock' | 'production';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

const SUPABASE_URL = texto(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = texto(import.meta.env.VITE_SUPABASE_ANON_KEY);
const MODO_PEDIDO = texto(import.meta.env.VITE_DATA_MODE).toLowerCase();

const supabaseConfigurado = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

/**
 * `production` so vale se o Supabase estiver realmente configurado.
 *
 * A regra e deliberadamente rigida: um painel que pediu producao e nao tem
 * banco deve falhar visivelmente, e nao cair de volta em dados ficticios
 * fingindo que o faturamento e real. Ver `configuracaoInvalida` abaixo.
 */
export const DATA_MODE: DataMode = MODO_PEDIDO === 'production' ? 'production' : 'mock';

/** Producao pedida, Supabase ausente. A aplicacao mostra um erro e para. */
export const configuracaoInvalida =
  DATA_MODE === 'production' && !supabaseConfigurado;

export const isMock = DATA_MODE === 'mock';

export const supabaseEnv = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  configurado: supabaseConfigurado,
};

export const paymentEnv = {
  /** Identificador do adaptador. `none` = nenhum gateway contratado ainda. */
  provider: texto(import.meta.env.VITE_PAYMENT_PROVIDER) || 'none',
  apiUrl: texto(import.meta.env.VITE_PAYMENT_API_URL),
  /** Chave publica de checkout. Secret key NUNCA chega ate aqui. */
  publicKey: texto(import.meta.env.VITE_PAYMENT_PUBLIC_KEY),
  get configurado(): boolean {
    return this.provider !== 'none' && this.apiUrl !== '';
  },
};

export const ninjabotEnv = {
  provider: texto(import.meta.env.VITE_NINJABOT_PROVIDER) || 'none',
  apiUrl: texto(import.meta.env.VITE_NINJABOT_API_URL),
  get configurado(): boolean {
    return this.provider !== 'none' && this.apiUrl !== '';
  },
};

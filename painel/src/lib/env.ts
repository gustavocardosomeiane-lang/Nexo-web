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

/**
 * Normaliza a URL do projeto Supabase.
 *
 * O supabase-js espera a RAIZ do projeto (`https://xxx.supabase.co`) e monta
 * sozinho os caminhos de cada serviço: `/auth/v1`, `/rest/v1`, `/storage/v1`.
 *
 * O painel do Supabase mostra a URL com `/rest/v1` em alguns lugares da
 * documentação, e é fácil copiar dali. Quando isso acontece, o login vira
 * `https://xxx.supabase.co/rest/v1/auth/v1/token` — o PostgREST responde 404
 * "PGRST125: Invalid path specified in request URL", e o app só sabe dizer
 * "não foi possível entrar". O banco funciona, a autenticação não, e não há
 * nenhuma pista na tela.
 *
 * Cortar o sufixo aqui é barato e elimina a classe inteira de erro.
 */
export function normalizarUrlSupabase(bruta: string): string {
  const limpa = bruta.trim().replace(/\/+$/, '');
  if (!limpa) return '';
  // Remove qualquer caminho de serviço colado no fim.
  return limpa.replace(/\/(rest|auth|storage|realtime|functions)\/v\d+$/i, '');
}

const SUPABASE_URL = normalizarUrlSupabase(texto(import.meta.env.VITE_SUPABASE_URL));
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

/**
 * URL canônica do painel, usada para montar o link do e-mail de recuperação.
 *
 * POR QUE NÃO USAR SÓ `window.location.origin`: o Supabase valida o
 * `redirect_to` contra a lista de Redirect URLs do projeto. Um deploy de
 * preview da Vercel tem origem diferente a cada build
 * (`nexo-painel-git-abc123.vercel.app`), que jamais estará nessa lista — e o
 * link chega com `{"error":"requested path is invalid"}`.
 *
 * Com `VITE_APP_URL` definida, o link sempre aponta para o domínio oficial,
 * independente de onde a recuperação foi pedida.
 */
const APP_URL = texto(import.meta.env.VITE_APP_URL).replace(/\/+$/, '');

export function urlDoPainel(caminho = ''): string {
  const base = APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${caminho}`;
}

export const paymentEnv = {
  /** Identificador do adaptador. `none` = nenhum gateway contratado ainda. */
  provider: texto(import.meta.env.VITE_PAYMENT_PROVIDER) || 'none',
  /**
   * Só para adaptadores que falam com uma API externa direto do navegador.
   * O Asaas NÃO usa: ele passa pelas funções em `/api/asaas`, na mesma origem,
   * porque a chave não pode sair do servidor.
   */
  apiUrl: texto(import.meta.env.VITE_PAYMENT_API_URL),
  /** Chave publica de checkout. Secret key NUNCA chega ate aqui. */
  publicKey: texto(import.meta.env.VITE_PAYMENT_PUBLIC_KEY),

  /**
   * Adaptadores servidos pelas nossas próprias funções serverless. Para eles,
   * exigir `VITE_PAYMENT_API_URL` seria pedir uma configuração que não existe.
   */
  get viaServidor(): boolean {
    return this.provider === 'asaas';
  },

  get configurado(): boolean {
    if (this.provider === 'none') return false;
    return this.viaServidor || this.apiUrl !== '';
  },
};

/* A integração com o NinjaBot foi removida do projeto. O bloco `ninjabotEnv`
   que existia aqui saiu junto — não há mais nenhuma variável `VITE_NINJABOT_*`
   nem `NINJABOT_*` lida por este painel. */

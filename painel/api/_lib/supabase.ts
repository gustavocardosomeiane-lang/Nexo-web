/**
 * Cliente Supabase do SERVIDOR.
 *
 * Usa a `SUPABASE_SERVICE_ROLE_KEY`, que **ignora Row Level Security**. Ela só
 * pode existir aqui, nas funções serverless. Nunca no frontend, nunca com
 * prefixo `VITE_`.
 *
 * O webhook precisa dela: quem chama é o Asaas, não um usuário logado, então
 * não há sessão para as policies avaliarem.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let instancia: SupabaseClient | null = null;

export class SupabaseIndisponivel extends Error {
  constructor(faltando: string[]) {
    super(`Supabase não configurado no servidor. Faltando: ${faltando.join(', ')}.`);
    this.name = 'SupabaseIndisponivel';
  }
}

/** `true` quando dá para falar com o banco. */
export function supabaseConfigurado(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL ?? '').trim() && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
  );
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const chave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

  const faltando: string[] = [];
  if (!url) faltando.push('SUPABASE_URL');
  if (!chave) faltando.push('SUPABASE_SERVICE_ROLE_KEY');
  if (faltando.length > 0) throw new SupabaseIndisponivel(faltando);

  if (!instancia) {
    instancia = createClient(url, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return instancia;
}

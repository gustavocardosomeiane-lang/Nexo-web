/**
 * Cliente Supabase — instancia unica.
 *
 * So a ANON KEY chega aqui. Ela e publica por natureza e nao da acesso a
 * nada: quem decide o que cada usuario enxerga sao as policies de Row Level
 * Security definidas em `supabase/schema.sql`. Sem RLS ativo, a anon key
 * viraria acesso total — por isso o schema liga RLS em todas as tabelas.
 *
 * A service_role key NUNCA entra neste projeto. Ela ignora RLS e so pode
 * existir no servidor que trata webhooks.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@/lib/env';

let instancia: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseEnv.configurado) {
    throw new Error(
      'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.',
    );
  }
  if (!instancia) {
    instancia = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'nexo.painel.auth',
      },
    });
  }
  return instancia;
}

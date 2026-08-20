import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cria uma `ai_conversation` nova e vazia para o usuário — nenhuma outra
 * tabela é tocada (nenhuma mensagem, nenhuma memória). Extraído para ser
 * reaproveitado nos dois lugares que precisam de "uma conversa nova, sem
 * condição": `garantirConversa` (api/nexo-ai/conversar.ts, quando nenhum
 * `conversa_id` é enviado) e o endpoint dedicado `POST /api/nexo-ai/conversas`
 * (o botão "Nova conversa" do frontend) — mesmo INSERT, uma vez só.
 */
export async function criarConversa(db: SupabaseClient, usuarioId: string): Promise<string> {
  const { data, error } = await db
    .from('ai_conversations')
    .insert({ usuario_id: usuarioId, titulo: 'Nova conversa' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

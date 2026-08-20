/**
 * NEXO AI — ciclo de vida da conversa.
 *
 *   POST /api/nexo-ai/conversas   cria uma ai_conversation nova e vazia
 *
 * Usado pelo botão "Nova conversa" do frontend: cria a conversa ANTES da
 * primeira mensagem, pra trocar a conversa ativa de forma imediata e
 * observável (em vez de só zerar o `conversa_id` local e esperar o próximo
 * envio criar a linha, como `garantirConversa` já faz em conversar.ts).
 *
 * Não apaga nada — nenhuma `ai_conversations`/`ai_messages`/`ai_memories`
 * existente é tocada. RLS do usuário autenticado, igual a todo o resto da
 * NEXO AI.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';
import { criarConversa } from '../_lib/nexo-ai/conversas.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  let usuario;
  try {
    usuario = await autenticar(req);
  } catch (e) {
    return responderNaoAutenticado(res, e);
  }

  try {
    const conversaId = await criarConversa(usuario.db, usuario.id);
    return res.status(200).json({ ok: true, conversa_id: conversaId });
  } catch (e) {
    console.error('[nexo-ai/conversas] erro:', e instanceof Error ? e.message : e);
    return res.status(500).json({ ok: false, erro: 'Não foi possível criar a conversa.' });
  }
}

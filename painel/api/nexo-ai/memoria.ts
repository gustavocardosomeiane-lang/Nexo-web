/**
 * NEXO AI — memória de longo prazo (CRUD).
 *
 *   GET    /api/nexo-ai/memoria            lista as memórias do usuário
 *   POST   /api/nexo-ai/memoria            { tipo, conteudo, chaves?, relevancia? }
 *   DELETE /api/nexo-ai/memoria?id=<uuid>  remove uma memória
 *
 * Tudo com a RLS do usuário: ele só mexe nas próprias memórias (e lê as de
 * escopo de empresa, com usuario_id nulo). Nada aqui envia mensagem nem toca
 * em tabela de negócio.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';
import { redigirSegredos } from '../../shared/regras-nexo-ai.js';

const TIPOS = new Set(['empresa', 'preferencia', 'decisao', 'projeto', 'fato']);
const LIMITE_CONTEUDO = 2000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let usuario;
  try {
    usuario = await autenticar(req);
  } catch (e) {
    return responderNaoAutenticado(res, e);
  }
  const { db, id: usuarioId } = usuario;

  try {
    if (req.method === 'GET') {
      const { data, error } = await db
        .from('ai_memories')
        .select('id, tipo, conteudo, chaves, relevancia, usuario_id, criado_em')
        .or(`usuario_id.eq.${usuarioId},usuario_id.is.null`)
        .order('criado_em', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, memorias: data ?? [] });
    }

    if (req.method === 'POST') {
      const corpo = lerCorpo(req);
      const tipo = String(corpo.tipo ?? 'fato');
      const conteudo = redigirSegredos(String(corpo.conteudo ?? '').trim()).slice(0, LIMITE_CONTEUDO);

      if (!TIPOS.has(tipo)) {
        return res.status(400).json({ ok: false, erro: 'Tipo de memória inválido.', codigo: 'tipo_invalido' });
      }
      if (!conteudo) {
        return res.status(400).json({ ok: false, erro: 'Conteúdo vazio.', codigo: 'conteudo_vazio' });
      }

      const { data, error } = await db
        .from('ai_memories')
        .insert({
          usuario_id: usuarioId,
          tipo,
          conteudo,
          chaves: Array.isArray(corpo.chaves) ? corpo.chaves.slice(0, 12).map(String) : [],
          relevancia: clamp(corpo.relevancia),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, id: (data as { id: string }).id });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '').trim();
      if (!id) return res.status(400).json({ ok: false, erro: 'Informe o id.', codigo: 'sem_id' });
      // A RLS garante que o usuário só apaga o que é dele; não precisamos
      // repetir o filtro de dono aqui, mas fazemos por clareza.
      const { error } = await db.from('ai_memories').delete().eq('id', id).eq('usuario_id', usuarioId);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  } catch (e) {
    console.error('[nexo-ai/memoria] erro:', e instanceof Error ? e.message : e);
    return res.status(500).json({ ok: false, erro: 'Falha ao acessar a memória.' });
  }
}

interface CorpoMemoria {
  tipo?: string;
  conteudo?: string;
  chaves?: unknown[];
  relevancia?: number;
}

function lerCorpo(req: VercelRequest): CorpoMemoria {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as CorpoMemoria;
    } catch {
      return {};
    }
  }
  return (req.body ?? {}) as CorpoMemoria;
}

/** Relevância entre 0 e 1; padrão 0,5 quando ausente ou inválida. */
function clamp(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

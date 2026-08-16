/**
 * Cliente da NEXO AI — a ponte do navegador para as funções serverless.
 *
 * Roda no navegador e nunca fala com o modelo direto: chama `/api/nexo-ai/*`
 * na própria origem, que guardam a credencial do modelo. O único segredo que
 * este arquivo manuseia é o token de SESSÃO do usuário — e ele já está no
 * navegador, emitido pelo Supabase Auth. Vai no header `Authorization` para o
 * servidor saber quem pergunta e aplicar a RLS. Ver `api/_lib/auth.ts`.
 */

import { getSupabase } from '@/data/supabase/client';
import type { Memoria, TipoMemoria } from '../../shared/regras-nexo-ai';

const API = '/api/nexo-ai';

export interface RespostaConversa {
  conversaId: string;
  resposta: string;
  tokens?: { entrada?: number; saida?: number } | null;
}

/** Token da sessão atual. Sem sessão, a chamada falha como não autenticada. */
async function autorizacao(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${API}${caminho}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(await autorizacao()),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error('Não foi possível falar com a NEXO AI. Verifique a conexão.');
  }

  const corpo = (await resposta.json().catch(() => null)) as
    | (Record<string, unknown> & { ok?: boolean; erro?: string })
    | null;

  if (resposta.status === 401) {
    throw new Error('Sua sessão expirou. Entre novamente para falar com a NEXO AI.');
  }
  if (resposta.status === 429) {
    throw new Error(
      (corpo?.erro as string) ??
        'A NEXO AI está recebendo muitas requisições. Aguarde alguns segundos e tente novamente.',
    );
  }
  if (resposta.status === 503) {
    throw new Error(
      (corpo?.erro as string) ??
        'A NEXO AI ainda não foi configurada no servidor (falta a chave do modelo).',
    );
  }
  if (!resposta.ok || corpo?.ok === false) {
    throw new Error((corpo?.erro as string) ?? 'A NEXO AI encontrou um problema.');
  }
  return corpo as T;
}

/** Envia uma mensagem e recebe a resposta. `conversaId` mantém a sessão. */
export async function conversar(mensagem: string, conversaId?: string): Promise<RespostaConversa> {
  const r = await chamar<{ conversa_id: string; resposta: string; tokens?: RespostaConversa['tokens'] }>(
    '/conversar',
    { method: 'POST', body: JSON.stringify({ mensagem, conversa_id: conversaId }) },
  );
  return { conversaId: r.conversa_id, resposta: r.resposta, tokens: r.tokens ?? null };
}

/* --------------------------------------------------------------------------
   Memória de longo prazo
   -------------------------------------------------------------------------- */

export async function listarMemorias(): Promise<Memoria[]> {
  const r = await chamar<{ memorias: Memoria[] }>('/memoria');
  return r.memorias ?? [];
}

export async function salvarMemoria(entrada: {
  tipo: TipoMemoria;
  conteudo: string;
  chaves?: string[];
  relevancia?: number;
}): Promise<string> {
  const r = await chamar<{ id: string }>('/memoria', {
    method: 'POST',
    body: JSON.stringify(entrada),
  });
  return r.id;
}

export async function removerMemoria(id: string): Promise<void> {
  await chamar('/memoria', { method: 'DELETE', body: JSON.stringify({ id }) });
}

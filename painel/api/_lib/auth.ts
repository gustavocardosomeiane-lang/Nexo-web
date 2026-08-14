/**
 * Identidade do chamador nas funções serverless.
 *
 * ===========================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Até aqui o servidor só tinha `getSupabaseAdmin()` — cliente com
 * `service_role`, que **ignora RLS por completo**. Nenhuma função verificava
 * quem estava chamando. Na prática: qualquer requisição a `/api/*` lia
 * qualquer dado, e a matriz de permissões de `src/auth/permissions.ts`
 * protegia apenas a interface, nunca o dado.
 *
 * Para a NEXO AI isso seria fatal. A IA lê o CRM para responder; sem saber
 * quem pergunta, um usuário de papel restrito perguntaria "quanto faturamos?"
 * e receberia o faturamento. A permissão precisa valer no servidor.
 *
 * A REGRA DESTE ARQUIVO: no caminho da IA, `service_role` é proibida. Toda
 * leitura de dado do usuário passa por `clienteDoUsuario()`, que devolve um
 * cliente autenticado COM O TOKEN DELE — então a mesma RLS que protege o
 * navegador protege o servidor. Uma fonte de verdade, não duas.
 * ===========================================================================
 */

import type { VercelRequest } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class NaoAutenticado extends Error {
  readonly status = 401;
  constructor(motivo = 'Sessão ausente ou expirada.') {
    super(motivo);
    this.name = 'NaoAutenticado';
  }
}

export interface UsuarioAutenticado {
  id: string;
  email: string | null;
  /** Papel lido de `public.users`. Nunca vem do cliente. */
  papel: string;
  nome: string | null;
  /** Cliente Supabase com o token DO USUÁRIO — sujeito a RLS. */
  db: SupabaseClient;
}

/** URL pública do projeto. A anon key também é pública por natureza. */
function ambiente(): { url: string; anonKey: string } {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) {
    throw new NaoAutenticado(
      'Servidor sem SUPABASE_URL / SUPABASE_ANON_KEY para validar a sessão.',
    );
  }
  return { url, anonKey };
}

/** Extrai o token do header `Authorization: Bearer <jwt>`. */
export function tokenDaRequisicao(req: VercelRequest): string {
  const bruto = req.headers.authorization ?? '';
  const [esquema, valor] = String(bruto).split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !valor) return '';
  return valor.trim();
}

/**
 * Valida a sessão e devolve o usuário + um cliente que respeita RLS.
 *
 * O papel é lido do banco, nunca aceito do cliente: um header dizendo
 * "sou admin" não pode virar permissão.
 */
export async function autenticar(req: VercelRequest): Promise<UsuarioAutenticado> {
  const token = tokenDaRequisicao(req);
  if (!token) throw new NaoAutenticado();

  const { url, anonKey } = ambiente();

  // O token viaja no header do cliente. Toda consulta feita por ele é
  // avaliada pela RLS como se viesse do navegador do usuário.
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new NaoAutenticado();

  const { data: perfil } = await db
    .from('users')
    .select('nome, role, ativo')
    .eq('id', data.user.id)
    .maybeSingle();

  // Sem linha em `users` ou inativo: trata como não autenticado. Falha
  // fechado — inventar um papel padrão seria conceder acesso por omissão.
  if (!perfil || perfil.ativo === false) {
    throw new NaoAutenticado('Usuário sem perfil ativo no painel.');
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    papel: String(perfil.role ?? ''),
    nome: (perfil.nome as string | null) ?? null,
    db,
  };
}

/** Resposta padronizada para falha de autenticação. Nunca vaza detalhe interno. */
export function responderNaoAutenticado(res: { status: (c: number) => { json: (b: unknown) => unknown } }, erro: unknown) {
  const msg = erro instanceof NaoAutenticado ? erro.message : 'Não autenticado.';
  return res.status(401).json({ ok: false, erro: msg, codigo: 'nao_autenticado' });
}

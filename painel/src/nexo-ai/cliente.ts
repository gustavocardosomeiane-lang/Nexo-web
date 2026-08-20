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
import { ehAbortoIntencional, type Memoria, type TipoMemoria } from '../../shared/regras-nexo-ai';

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

/**
 * Cria uma conversa nova e vazia — usado pelo botão "Nova conversa". Não
 * apaga nada: mensagens, conversas e memórias anteriores continuam intactas,
 * isso só cria mais uma linha em `ai_conversations` e devolve o id dela.
 */
export async function criarNovaConversa(): Promise<string> {
  const r = await chamar<{ conversa_id: string }>('/conversas', { method: 'POST' });
  return r.conversa_id;
}

/** Envia uma mensagem e recebe a resposta inteira de uma vez (sem streaming). */
export async function conversar(mensagem: string, conversaId?: string): Promise<RespostaConversa> {
  const r = await chamar<{ conversa_id: string; resposta: string; tokens?: RespostaConversa['tokens'] }>(
    '/conversar',
    { method: 'POST', body: JSON.stringify({ mensagem, conversa_id: conversaId }) },
  );
  return { conversaId: r.conversa_id, resposta: r.resposta, tokens: r.tokens ?? null };
}

/* --------------------------------------------------------------------------
   Streaming de /conversar

   O backend responde em text/event-stream — cada frame é uma linha
   `data: <json>\n\n` com um campo `tipo`: 'inicio' | 'chunk' | 'fim' | 'erro'.
   Não usamos EventSource (só GET, sem Authorization/body); é fetch + POST +
   leitura manual de response.body, para poder mandar o Bearer token e o
   corpo JSON normalmente.
   -------------------------------------------------------------------------- */

export interface CallbacksConversaStream {
  /** conversaId chega aqui assim que o backend cria/confirma a sessão — antes do 1º chunk. */
  aoIniciar?: (conversaId: string) => void;
  /** Um pedaço de texto (delta, não cumulativo) — concatenar na mesma mensagem. */
  aoChunk?: (texto: string) => void;
  aoFim?: (info: { conversaId: string; tokens?: RespostaConversa['tokens'] }) => void;
  aoErro?: (motivo: string) => void;
}

interface FrameStream {
  tipo?: string;
  conversaId?: string;
  texto?: string;
  tokens?: RespostaConversa['tokens'];
  erro?: string;
}

/**
 * Envia uma mensagem e consome a resposta em streaming. Nunca rejeita — toda
 * falha (rede, autenticação, erro do backend antes ou durante o stream)
 * chega via `cb.aoErro`, nunca como exceção.
 *
 * `signal` (opcional) permite cancelar de fora — "Nova conversa" usa isso
 * pra encerrar uma resposta ainda em voo antes de trocar de conversa, sem
 * desperdiçar tokens gerando um texto que ninguém vai ver. Um cancelamento
 * assim NUNCA chama `cb.aoErro`: não é falha, é intencional (ver
 * `ehAbortoIntencional`, checada nos dois pontos abaixo que podem lançar
 * por causa do abort — o fetch em si e a leitura do stream).
 */
export async function conversarStream(
  mensagem: string,
  conversaId: string | undefined,
  cb: CallbacksConversaStream,
  signal?: AbortSignal,
): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(`${API}/conversar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await autorizacao()) },
      body: JSON.stringify({ mensagem, conversa_id: conversaId }),
      signal,
    });
  } catch (e) {
    if (ehAbortoIntencional(e)) return;
    cb.aoErro?.('Não foi possível falar com a NEXO AI. Verifique a conexão.');
    return;
  }

  if (resposta.status === 401) {
    cb.aoErro?.('Sua sessão expirou. Entre novamente para falar com a NEXO AI.');
    return;
  }

  const tipoConteudo = resposta.headers.get('content-type') ?? '';
  if (!resposta.ok || !tipoConteudo.includes('text/event-stream')) {
    // Erro detectado ANTES do streaming começar (auth, quota, sem
    // credencial...) — o backend ainda responde um JSON normal nesse caso.
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    cb.aoErro?.(corpo?.erro ?? 'A NEXO AI encontrou um problema.');
    return;
  }

  if (!resposta.body) {
    cb.aoErro?.('Este navegador não suporta streaming de resposta. Atualize-o e tente novamente.');
    return;
  }

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let restante = '';

  const processarBloco = (bloco: string) => {
    for (const linha of bloco.split('\n')) {
      const l = linha.trim();
      if (!l.startsWith('data:')) continue;
      const dado = l.slice(5).trim();
      if (!dado) continue;
      let frame: FrameStream;
      try {
        frame = JSON.parse(dado) as FrameStream;
      } catch {
        continue;
      }
      if (frame.tipo === 'inicio') cb.aoIniciar?.(frame.conversaId ?? '');
      else if (frame.tipo === 'chunk') cb.aoChunk?.(frame.texto ?? '');
      else if (frame.tipo === 'fim') cb.aoFim?.({ conversaId: frame.conversaId ?? '', tokens: frame.tokens ?? null });
      else if (frame.tipo === 'erro') cb.aoErro?.(frame.erro ?? 'A NEXO AI encontrou um problema.');
    }
  };

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      restante += decodificador.decode(value, { stream: true });
      let indice: number;
      while ((indice = restante.indexOf('\n\n')) !== -1) {
        processarBloco(restante.slice(0, indice));
        restante = restante.slice(indice + 2);
      }
    }
    if (restante.trim()) processarBloco(restante);
  } catch (e) {
    if (ehAbortoIntencional(e)) return;
    cb.aoErro?.('A conexão com a NEXO AI foi interrompida. Tente novamente.');
  }
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

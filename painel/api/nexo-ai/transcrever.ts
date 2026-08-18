/**
 * NEXO AI — endpoint de transcrição de voz.
 *
 *   POST /api/nexo-ai/transcrever   multipart/form-data { audio: <arquivo> }
 *
 * Autentica o usuário, encaminha o áudio gravado pelo MediaRecorder do
 * navegador para a Groq (Whisper) e devolve só o texto transcrito. A
 * GROQ_API_KEY nunca sai do servidor — o frontend nunca a vê.
 *
 * Corpo desabilitado no parser padrão da Vercel (multipart não é JSON nem
 * urlencoded) — lemos o stream bruto e usamos o FormData/Request nativos do
 * Node para decodificar o multipart, sem dependência nova.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const GROQ_TRANSCRICAO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELO_TRANSCRICAO = 'whisper-large-v3-turbo';
/** Folga generosa para poucos minutos de voz — não é upload de arquivo. */
const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20000;

const MENSAGEM_INDISPONIVEL = 'A NEXO está temporariamente indisponível. Tente novamente em alguns instantes.';

async function lerCorpoBruto(req: VercelRequest): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  for await (const pedaco of req) {
    pedacos.push(Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco as ArrayBuffer));
  }
  return Buffer.concat(pedacos);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  try {
    await autenticar(req);
  } catch (e) {
    return responderNaoAutenticado(res, e);
  }

  const key = (process.env.GROQ_API_KEY ?? '').trim();
  if (!key) {
    return res.status(503).json({ ok: false, erro: 'Transcrição de voz ainda não configurada no servidor.' });
  }

  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return res.status(400).json({ ok: false, erro: 'Envie o áudio como multipart/form-data.' });
  }

  let bruto: Buffer;
  try {
    bruto = await lerCorpoBruto(req);
  } catch {
    return res.status(400).json({ ok: false, erro: 'Não foi possível ler o áudio enviado.' });
  }

  if (!bruto.length) {
    return res.status(400).json({ ok: false, erro: 'Áudio vazio.' });
  }
  if (bruto.length > TAMANHO_MAXIMO_BYTES) {
    return res.status(413).json({ ok: false, erro: 'Áudio maior que o permitido.' });
  }

  let arquivo: File;
  try {
    // Truque sem dependência nova: o Node (>=18) já tem Request/FormData
    // nativos com um parser de multipart completo — só precisamos alimentar
    // o corpo bruto que já lemos do stream da Vercel.
    const requisicaoWeb = new Request('http://localhost/transcrever', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bruto,
    });
    const formulario = await requisicaoWeb.formData();
    const campo = formulario.get('audio');
    if (!(campo instanceof Blob) || !campo.size) {
      return res.status(400).json({ ok: false, erro: 'Áudio ausente ou vazio no formulário.' });
    }
    const tipo = (campo.type || '').toLowerCase();
    if (!tipo.startsWith('audio/')) {
      return res.status(400).json({ ok: false, erro: 'Formato de áudio não suportado.' });
    }
    arquivo = campo instanceof File ? campo : new File([campo], 'gravacao.webm', { type: campo.type || 'audio/webm' });
  } catch {
    return res.status(400).json({ ok: false, erro: 'Não foi possível interpretar o áudio enviado.' });
  }

  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const formGroq = new FormData();
    formGroq.append('file', arquivo);
    formGroq.append('model', MODELO_TRANSCRICAO);
    formGroq.append('language', 'pt');
    formGroq.append('response_format', 'json');

    let resposta: Response;
    try {
      resposta = await fetch(GROQ_TRANSCRICAO_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formGroq,
        signal: controlador.signal,
      });
    } catch (e) {
      const timeout = e instanceof Error && e.name === 'AbortError';
      console.error('[NEXO AI] Groq transcrição erro:', timeout ? 'tempo limite excedido' : 'falha de rede');
      return res.status(timeout ? 504 : 502).json({ ok: false, erro: MENSAGEM_INDISPONIVEL });
    }

    const dados = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;

    if (!resposta.ok || !dados) {
      const erro = dados?.error as { message?: string } | undefined;
      console.error('[NEXO AI] Groq transcrição erro:', resposta.status, erro?.message ?? '');
      return res
        .status(resposta.status >= 400 && resposta.status < 600 ? resposta.status : 502)
        .json({ ok: false, erro: MENSAGEM_INDISPONIVEL });
    }

    const texto = typeof dados.text === 'string' ? dados.text.trim() : '';
    console.log('[NEXO AI] Groq transcrição respondeu com sucesso:', MODELO_TRANSCRICAO);

    return res.status(200).json({ ok: true, texto });
  } finally {
    clearTimeout(timeoutId);
  }
}

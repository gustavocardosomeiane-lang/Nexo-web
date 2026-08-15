/**
 * POST /api/nexo-ai/tts   { texto: string }
 *
 * Proxy de TTS para o Gemini: converte texto em áudio no servidor
 * (a chave fica só no servidor) e devolve o áudio para o navegador
 * tocar. O cliente nunca toca na credencial.
 *
 * Retorna audio/wav (converte PCM linear16 → WAV se necessário para
 * que AudioContext.decodeAudioData() funcione em todos os browsers).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TTS_MODELO = process.env.GEMINI_TTS_MODELO ?? 'gemini-2.5-flash-preview-tts';
const LIMITE_TEXTO = 2000;

function lerCorpo(req: VercelRequest): { texto?: string } {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) as { texto?: string }; } catch { return {}; }
  }
  return (req.body ?? {}) as { texto?: string };
}

/**
 * Envolve PCM linear-16 mono 24 kHz num cabeçalho WAV para que o
 * AudioContext do browser possa decodificar sem bibliotecas externas.
 */
function pcmParaWav(pcm: Buffer, sampleRate = 24000, canais = 1, bits = 16): Buffer {
  const dataLen = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(canais, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * canais * bits) / 8, 28);
  header.writeUInt16LE((canais * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

function corpoGeminiTTS(textoLimpo: string): string {
  return JSON.stringify({
    contents: [{ parts: [{ text: textoLimpo }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Aoede' },
        },
      },
    },
  });
}

async function chamarGemini(key: string, textoLimpo: string): Promise<Response> {
  const url = `${GEMINI_BASE}/${TTS_MODELO}:generateContent?key=${encodeURIComponent(key)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpoGeminiTTS(textoLimpo),
  });
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

  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) {
    return res.status(503).json({ ok: false, erro: 'GEMINI_API_KEY não configurada.' });
  }

  const { texto } = lerCorpo(req);
  const textoLimpo = String(texto ?? '').trim().slice(0, LIMITE_TEXTO);
  if (!textoLimpo) {
    return res.status(400).json({ ok: false, erro: 'Texto vazio.' });
  }

  let resposta: Response;
  try {
    resposta = await chamarGemini(key, textoLimpo);
  } catch {
    return res.status(502).json({ ok: false, erro: 'Não foi possível alcançar o Gemini TTS.' });
  }

  const dados = await resposta.json().catch(() => null) as Record<string, unknown> | null;

  if (!resposta.ok || !dados) {
    const msg =
      ((dados?.error as { message?: string } | undefined)?.message) ??
      `Gemini TTS respondeu ${resposta.status}.`;
    console.error('[nexo-ai/tts]', msg);
    return res
      .status(resposta.status >= 400 && resposta.status < 600 ? resposta.status : 500)
      .json({ ok: false, erro: msg });
  }

  type Part = { inlineData?: { mimeType?: string; data?: string } };
  const parts: Part[] =
    ((dados as { candidates?: { content?: { parts?: Part[] } }[] })
      ?.candidates?.[0]?.content?.parts) ?? [];

  for (const part of parts) {
    const raw = part?.inlineData?.data;
    if (!raw) continue;

    const mime = (part.inlineData?.mimeType ?? 'audio/wav').toLowerCase();
    const buf = Buffer.from(raw, 'base64');

    // PCM linear-16 não tem cabeçalho → envolve em WAV antes de enviar.
    const isPcm = mime.includes('l16') || mime.includes('pcm') || mime.includes('raw');
    const audioFinal = isPcm ? pcmParaWav(buf) : buf;
    const mimeType = isPcm ? 'audio/wav' : mime;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Model', TTS_MODELO);
    return res.status(200).send(audioFinal);
  }

  // Nenhum dado de áudio na resposta — loga o máximo possível para diagnóstico.
  const resumo = JSON.stringify(dados).slice(0, 500);
  console.error(`[nexo-ai/tts] sem áudio na resposta (modelo: ${TTS_MODELO}):`, resumo);
  return res.status(500).json({
    ok: false,
    erro: `Gemini TTS (${TTS_MODELO}) não retornou dados de áudio.`,
  });
}

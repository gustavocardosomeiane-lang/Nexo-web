/**
 * POST /api/nexo-ai/tts   { texto: string }
 *
 * Proxy de TTS para o Gemini: converte texto em áudio no servidor
 * (a chave fica só no servidor) e devolve o áudio para o navegador
 * tocar. O cliente nunca toca na credencial.
 *
 * Usa generateContent com responseModalities: ['AUDIO'].
 * Retorna audio/wav (converte PCM linear16 → WAV para que
 * AudioContext.decodeAudioData() funcione em todos os browsers).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TTS_MODELO = process.env.GEMINI_TTS_MODELO ?? 'gemini-3.1-flash-tts-preview';
const TTS_VOZ = process.env.GEMINI_TTS_VOZ ?? 'Kore';
const LIMITE_TEXTO = 2000;

function lerCorpo(req: VercelRequest): { texto?: string } {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) as { texto?: string }; } catch { return {}; }
  }
  return (req.body ?? {}) as { texto?: string };
}

/**
 * Envolve PCM linear-16 num cabeçalho WAV para que o AudioContext do
 * browser possa decodificar sem bibliotecas externas.
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

/**
 * Corpo para a generateContent API do Gemini com áudio como modalidade de saída.
 * Referência: https://ai.google.dev/api/generate-content#v1beta.GenerateContentRequest
 */
function corpoGeminiTTS(textoLimpo: string): string {
  const promptText =
    'Fale em português brasileiro, com voz feminina jovem, natural, calorosa e conversacional. ' +
    'Soe como uma assistente de IA moderna, confiante e humana. ' +
    'Não soe robótica, não fale como narradora de GPS, não exagere na entonação. ' +
    `Texto a ser falado: ${textoLimpo}`;

  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: TTS_VOZ },
        },
      },
    },
  });
}

async function chamarGeminiTTS(key: string, textoLimpo: string): Promise<Response> {
  // Endpoint padrão do Gemini para geração de conteúdo (inclui áudio).
  const url = `${GEMINI_BASE}/models/${TTS_MODELO}:generateContent?key=${encodeURIComponent(key)}`;
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
    resposta = await chamarGeminiTTS(key, textoLimpo);
  } catch {
    return res.status(502).json({ ok: false, erro: 'Não foi possível alcançar o Gemini TTS.' });
  }

  const dados = await resposta.json().catch(() => null) as Record<string, unknown> | null;

  if (!resposta.ok || !dados) {
    const msg =
      ((dados?.error as { message?: string } | undefined)?.message) ??
      `Gemini TTS respondeu ${resposta.status}.`;
    console.error('[nexo-ai/tts]', { status: resposta.status, modelo: TTS_MODELO, msg }, JSON.stringify(dados).slice(0, 300));
    return res
      .status(resposta.status >= 400 && resposta.status < 600 ? resposta.status : 500)
      .json({ ok: false, erro: msg });
  }

  // Extrai o áudio de candidates[].content.parts[].inlineData (formato generateContent).
  type InlineData = { mimeType?: string; data?: string };
  type Part = { text?: string; inlineData?: InlineData };
  type Content = { parts?: Part[] };
  type Candidate = { content?: Content };
  const candidates = (dados as { candidates?: Candidate[] }).candidates;
  const audioInline = candidates
    ?.flatMap((c) => c.content?.parts ?? [])
    .find((p) => p.inlineData?.data)
    ?.inlineData;

  if (audioInline?.data) {
    const mime = (audioInline.mimeType ?? '').toLowerCase();
    // mimeType pode ser "audio/pcm;rate=24000" — extrai a taxa de amostragem.
    const rateMatch = mime.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1]!, 10) : 24000;
    const buf = Buffer.from(audioInline.data, 'base64');
    const isPcm = mime.includes('pcm') || mime.includes('l16') || mime.includes('raw') || !mime.includes('wav');
    const audioFinal = isPcm ? pcmParaWav(buf, sampleRate) : buf;
    const mimeType = isPcm ? 'audio/wav' : (mime.split(';')[0] ?? 'audio/wav');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Model', TTS_MODELO);
    return res.status(200).send(audioFinal);
  }

  const resumo = JSON.stringify(dados).slice(0, 500);
  console.error(`[nexo-ai/tts] sem áudio na resposta (modelo: ${TTS_MODELO}):`, resumo);
  return res.status(500).json({
    ok: false,
    erro: `Gemini TTS (${TTS_MODELO}) não retornou dados de áudio.`,
    debug: resumo,
  });
}

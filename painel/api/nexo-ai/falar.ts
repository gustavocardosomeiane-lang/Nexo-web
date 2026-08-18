import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELO_TTS = (process.env.NEXO_AI_TTS_MODELO ?? 'gemini-3.1-flash-tts-preview').trim();
const VOZ_TTS = (process.env.NEXO_AI_TTS_VOZ ?? 'Kore').trim();

function limparParaVoz(texto: string): string {
  return texto
    .replace(/[*_~`#]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

function pcmParaWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const bits = 16;
  const blockAlign = channels * bits / 8;
  const byteRate = sampleRate * blockAlign;
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bits, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  const tInicio = Date.now();
  try {
    await autenticar(req);
  } catch (e) {
    return responderNaoAutenticado(res, e);
  }
  console.log('[NEXO LATENCIA] auth /falar', Date.now() - tInicio, 'ms');

  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) return res.status(503).json({ ok: false, erro: 'TTS não configurado.' });

  const corpo = (req.body ?? {}) as { texto?: unknown };
  const texto = limparParaVoz(String(corpo.texto ?? ''));
  if (!texto) return res.status(400).json({ ok: false, erro: 'Texto vazio.' });

  try {
    const tTts = Date.now();
    const resposta = await fetch(
      `${GEMINI_BASE}/${MODELO_TTS}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: texto }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ_TTS } },
            },
          },
        }),
      },
    );

    const dados = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
    console.log('[NEXO LATENCIA] TTS', Date.now() - tTts, 'ms');
    if (!resposta.ok || !dados) {
      console.error('[nexo-ai/tts]', resposta.status, dados);
      return res.status(502).json({ ok: false, erro: 'Não foi possível gerar a voz.' });
    }

    const candidatos = Array.isArray(dados.candidates) ? dados.candidates : [];
    const content = (candidatos[0] as Record<string, unknown> | undefined)?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const audio = parts
      .map((p) => (p as Record<string, unknown>).inlineData as { data?: string; mimeType?: string } | undefined)
      .find((p) => typeof p?.data === 'string');

    if (!audio?.data) {
      console.error('[nexo-ai/tts] resposta sem áudio', dados);
      return res.status(502).json({ ok: false, erro: 'O TTS não retornou áudio.' });
    }

    const pcm = Buffer.from(audio.data, 'base64');
    const wav = pcmParaWav(pcm);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(wav.length));
    console.log('[NEXO LATENCIA] total /falar', Date.now() - tInicio, 'ms');
    return res.status(200).send(wav);
  } catch (e) {
    console.error('[nexo-ai/tts] falha', e);
    return res.status(502).json({ ok: false, erro: 'Falha ao gerar a voz.' });
  }
}

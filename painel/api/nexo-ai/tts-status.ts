/**
 * GET /api/nexo-ai/tts-status
 *
 * Diagnóstico sem autenticação: testa se o Gemini TTS está acessível com
 * a GEMINI_API_KEY configurada no servidor. Não devolve áudio — só JSON
 * com o resultado do teste. Não expõe a chave.
 *
 * Abra no browser: /api/nexo-ai/tts-status
 * Resultado esperado quando tudo OK:
 *   {"ok":true,"modelo":"gemini-2.5-flash-preview-tts","voz":"Aoede","bytes_audio":12345}
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TTS_MODELO = process.env.GEMINI_TTS_MODELO ?? 'gemini-2.5-flash-preview-tts';
const TTS_VOZ = 'Aoede';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, erro: 'Use GET.' });
  }

  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) {
    return res.status(200).json({
      ok: false,
      problema: 'GEMINI_API_KEY não está configurada no Vercel.',
      acao: 'Adicione GEMINI_API_KEY em Settings → Environment Variables do projeto nexo-painel no Vercel.',
    });
  }

  let resp: Response;
  try {
    resp = await fetch(
      `${GEMINI_BASE}/${TTS_MODELO}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Olá, tudo bem?' }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOZ } },
            },
          },
        }),
      },
    );
  } catch (e) {
    return res.status(200).json({
      ok: false,
      problema: `Erro de rede: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const dados = await resp.json().catch(() => null) as Record<string, unknown> | null;

  if (!resp.ok) {
    const msg = ((dados?.error as { message?: string } | undefined)?.message) ?? `HTTP ${resp.status}`;
    return res.status(200).json({
      ok: false,
      modelo: TTS_MODELO,
      problema: msg,
      acao: 'Verifique se a GEMINI_API_KEY tem acesso ao modelo TTS.',
    });
  }

  type Part = { inlineData?: { mimeType?: string; data?: string } };
  const parts: Part[] =
    ((dados as { candidates?: { content?: { parts?: Part[] } }[] })
      ?.candidates?.[0]?.content?.parts) ?? [];

  for (const part of parts) {
    const raw = part?.inlineData?.data;
    if (!raw) continue;
    return res.status(200).json({
      ok: true,
      modelo: TTS_MODELO,
      voz: TTS_VOZ,
      bytes_audio: Buffer.from(raw, 'base64').length,
      mime_type: part.inlineData?.mimeType ?? 'desconhecido',
    });
  }

  return res.status(200).json({
    ok: false,
    modelo: TTS_MODELO,
    problema: 'API respondeu 200 mas sem dados de áudio.',
    resposta_resumo: JSON.stringify(dados).slice(0, 300),
  });
}

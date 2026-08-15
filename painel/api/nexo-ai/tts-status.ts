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
const TTS_MODELO_PRINCIPAL = process.env.GEMINI_TTS_MODELO ?? 'gemini-2.5-flash-preview-tts';
const TTS_MODELO_FALLBACK = 'gemini-2.5-flash';

async function testarModelo(modelo: string, key: string): Promise<{
  ok: boolean;
  bytes?: number;
  mimeType?: string;
  erro?: string;
}> {
  let resp: Response;
  try {
    resp = await fetch(
      `${GEMINI_BASE}/${modelo}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Olá' }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            },
          },
        }),
      },
    );
  } catch (e) {
    return { ok: false, erro: `Rede: ${e instanceof Error ? e.message : String(e)}` };
  }

  const dados = await resp.json().catch(() => null) as Record<string, unknown> | null;

  if (!resp.ok) {
    const msg = ((dados?.error as { message?: string } | undefined)?.message) ?? `status ${resp.status}`;
    return { ok: false, erro: msg };
  }

  type Part = { inlineData?: { mimeType?: string; data?: string } };
  const parts: Part[] =
    ((dados as { candidates?: { content?: { parts?: Part[] } }[] })
      ?.candidates?.[0]?.content?.parts) ?? [];

  for (const part of parts) {
    const raw = part?.inlineData?.data;
    if (!raw) continue;
    return {
      ok: true,
      bytes: Buffer.from(raw, 'base64').length,
      mimeType: part.inlineData?.mimeType ?? 'desconhecido',
    };
  }

  return { ok: false, erro: 'API respondeu 200 mas sem dados de áudio na resposta.' };
}

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

  // Testa o modelo principal
  const resultadoPrincipal = await testarModelo(TTS_MODELO_PRINCIPAL, key);
  if (resultadoPrincipal.ok) {
    return res.status(200).json({
      ok: true,
      modelo: TTS_MODELO_PRINCIPAL,
      voz: 'Aoede',
      bytes_audio: resultadoPrincipal.bytes,
      mime_type: resultadoPrincipal.mimeType,
    });
  }

  // Testa o modelo de fallback
  const resultadoFallback = await testarModelo(TTS_MODELO_FALLBACK, key);
  if (resultadoFallback.ok) {
    return res.status(200).json({
      ok: true,
      modelo: TTS_MODELO_FALLBACK,
      aviso: `Modelo principal (${TTS_MODELO_PRINCIPAL}) falhou: ${resultadoPrincipal.erro}`,
      voz: 'Aoede',
      bytes_audio: resultadoFallback.bytes,
      mime_type: resultadoFallback.mimeType,
    });
  }

  return res.status(200).json({
    ok: false,
    problema: 'Nenhum modelo TTS do Gemini respondeu com áudio.',
    modelo_principal: { modelo: TTS_MODELO_PRINCIPAL, erro: resultadoPrincipal.erro },
    modelo_fallback: { modelo: TTS_MODELO_FALLBACK, erro: resultadoFallback.erro },
    acao: 'Verifique se a GEMINI_API_KEY tem acesso aos modelos de geração de áudio do Gemini.',
  });
}

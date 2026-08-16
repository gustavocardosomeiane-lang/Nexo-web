/**
 * GET /api/nexo-ai/tts-status
 *
 * Diagnóstico sem autenticação: testa exatamente o mesmo endpoint e
 * payload usado por /api/nexo-ai/tts. Não devolve áudio — só JSON
 * com o resultado do teste. Não expõe a chave.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TTS_MODELO = process.env.GEMINI_TTS_MODELO ?? 'gemini-3.1-flash-tts-preview';
const TTS_VOZ = process.env.GEMINI_TTS_VOZ ?? 'Kore';

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
      acao: 'Adicione GEMINI_API_KEY em Settings → Environment Variables.',
    });
  }

  const textoTeste = 'Olá, tudo bem?';
  const input =
    'Fale em português brasileiro, com voz feminina jovem, natural, calorosa e conversacional. ' +
    'Soe como uma assistente de IA moderna, confiante e humana. ' +
    'Não soe robótica, não fale como narradora de GPS, não exagere na entonação. ' +
    `Texto a ser falado: ${textoTeste}`;

  let resp: Response;
  try {
    resp = await fetch(
      `${GEMINI_BASE}/interactions?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: TTS_MODELO,
          input,
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: TTS_VOZ }],
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
      voz: TTS_VOZ,
      http_status: resp.status,
      problema: msg,
      resposta_completa: dados,
    });
  }

  type ContentItem = { type?: string; data?: string; mime_type?: string; sample_rate?: number; channels?: number };
  type Step = { type?: string; content?: ContentItem[] };
  const steps = (dados as { steps?: Step[] }).steps;
  const audioContent = steps?.flatMap(s => s.content ?? []).find(c => c.type === 'audio' && c.data);

  if (audioContent?.data) {
    return res.status(200).json({
      ok: true,
      modelo: TTS_MODELO,
      voz: TTS_VOZ,
      bytes_audio: Buffer.from(audioContent.data, 'base64').length,
      mime_type: audioContent.mime_type ?? 'desconhecido',
      sample_rate: audioContent.sample_rate ?? 24000,
      channels: audioContent.channels ?? 1,
    });
  }

  return res.status(200).json({
    ok: false,
    modelo: TTS_MODELO,
    voz: TTS_VOZ,
    problema: 'API respondeu 200 mas sem audio em steps[].content[].',
    resposta_completa: dados,
  });
}

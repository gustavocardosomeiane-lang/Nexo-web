import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';
import { extrairRetryDelayMs, RETRY_MS_PADRAO } from '../../shared/regras-nexo-ai.js';

/**
 * NEXO AI — endpoint de voz (TTS).
 *
 *   POST /api/nexo-ai/falar   { texto }
 *
 * Provider: ElevenLabs (eleven_flash_v2_5). A ELEVENLABS_API_KEY nunca sai
 * do servidor — o frontend só recebe os bytes de áudio já prontos. A rota
 * (e o contrato com o frontend) continua a mesma de antes; só o provedor
 * por trás mudou.
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODELO_TTS = 'eleven_flash_v2_5';
/** MP3 compacto, amplamente suportado pelo navegador — leve o bastante pra fila incremental. */
const FORMATO_AUDIO = 'mp3_22050_32';
/** Sem isso, uma chamada travada na ElevenLabs nunca solta a requisição do usuário. */
const TIMEOUT_MS = 20_000;

function limparParaVoz(texto: string): string {
  return texto
    .replace(/[*_~`#]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

const MENSAGENS_POR_STATUS: Record<number, string> = {
  401: 'Credencial de voz inválida.',
  403: 'Sem permissão para usar esta voz.',
  422: 'Não foi possível processar este texto para voz.',
};

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

  const key = (process.env.ELEVENLABS_API_KEY ?? '').trim();
  const voiceId = (process.env.ELEVENLABS_VOICE_ID ?? '').trim();
  if (!key || !voiceId) {
    console.error('[NEXO TTS] ElevenLabs não configurado:', !key ? 'falta ELEVENLABS_API_KEY' : 'falta ELEVENLABS_VOICE_ID');
    return res.status(503).json({ ok: false, erro: 'TTS não configurado.' });
  }

  const corpo = (req.body ?? {}) as { texto?: unknown };
  const texto = limparParaVoz(String(corpo.texto ?? ''));
  if (!texto) return res.status(400).json({ ok: false, erro: 'Texto vazio.' });

  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const tTts = Date.now();
    let resposta: Response;
    try {
      resposta = await fetch(
        `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}/stream?output_format=${FORMATO_AUDIO}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: texto,
            model_id: MODELO_TTS,
            language_code: 'pt',
          }),
          signal: controlador.signal,
        },
      );
    } catch (e) {
      const timeout = e instanceof Error && e.name === 'AbortError';
      console.error('[NEXO TTS] ElevenLabs erro:', timeout ? 'tempo limite excedido' : 'falha de rede');
      return res.status(timeout ? 504 : 502).json({ ok: false, erro: 'Não foi possível gerar a voz.' });
    }

    console.log('[NEXO TTS] ElevenLabs respondeu', Date.now() - tTts, 'ms');

    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => null) as Record<string, unknown> | null;
      console.error('[nexo-ai/tts] ElevenLabs', resposta.status);

      if (resposta.status === 429) {
        const retryMs = extrairRetryDelayMs(dados, resposta.headers.get('retry-after')) ?? RETRY_MS_PADRAO;
        console.log('[NEXO TTS] ElevenLabs 429 cooldown', retryMs, 'ms');
        res.setHeader('Retry-After', String(Math.ceil(retryMs / 1000)));
        return res.status(429).json({
          ok: false,
          erro: 'A voz da NEXO está temporariamente indisponível (limite de uso atingido).',
          codigo: 'tts_quota',
          retryMs,
        });
      }

      const erroPublico = MENSAGENS_POR_STATUS[resposta.status] ?? 'Não foi possível gerar a voz.';
      const status = resposta.status >= 500 ? 502 : resposta.status;
      return res.status(status).json({ ok: false, erro: erroPublico });
    }

    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (!bytes.length) {
      console.error('[nexo-ai/tts] ElevenLabs respondeu sem áudio');
      return res.status(502).json({ ok: false, erro: 'O TTS não retornou áudio.' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(bytes.length));
    console.log('[NEXO LATENCIA] total /falar', Date.now() - tInicio, 'ms');
    return res.status(200).send(bytes);
  } catch (e) {
    console.error('[nexo-ai/tts] falha', e instanceof Error ? e.message : 'erro desconhecido');
    return res.status(502).json({ ok: false, erro: 'Falha ao gerar a voz.' });
  } finally {
    clearTimeout(timeoutId);
  }
}

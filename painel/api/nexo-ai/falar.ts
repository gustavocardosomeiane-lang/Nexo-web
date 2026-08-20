import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado } from '../_lib/auth.js';
import { extrairRetryDelayMs, RETRY_MS_PADRAO, deveTravarPorCredencial } from '../../shared/regras-nexo-ai.js';

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

/**
 * Diagnóstico da credencial — investigação do 401 recorrente da ElevenLabs.
 * NUNCA loga prefixo, sufixo ou valor da chave (nem os 4 primeiros
 * caracteres, ao contrário do diagnóstico do Google Places): só existência,
 * tamanho e se houve trim. `voiceId` não é segredo (é só um identificador de
 * recurso, não dá acesso a nada sozinho) — logar o valor dele ajuda a
 * descartar a hipótese de a voz pertencer a uma conta/workspace diferente
 * da chave nova, sem risco nenhum de expor credencial.
 *
 * Throttlado por VALOR (mesmo padrão de google-places.ts): loga de novo só
 * se a chave ou o voice_id mudarem — não repete a cada requisição de TTS.
 */
let ultimaChaveTtsDiagnosticada: string | null = null;
let ultimoVoiceIdDiagnosticado: string | null = null;

export function logDiagnosticoCredencialTts(chaveBruta: string, voiceIdBruto: string): void {
  if (chaveBruta === ultimaChaveTtsDiagnosticada && voiceIdBruto === ultimoVoiceIdDiagnosticado) return;
  ultimaChaveTtsDiagnosticada = chaveBruta;
  ultimoVoiceIdDiagnosticado = voiceIdBruto;
  const chaveAparada = chaveBruta.trim();
  const voiceIdAparado = voiceIdBruto.trim();
  console.log(
    '[NEXO TTS] diagnostico_credencial',
    'chave_existe=' + (chaveBruta.length > 0 ? 'sim' : 'nao'),
    'tamanho_da_chave=' + chaveAparada.length,
    'houve_trim=' + (chaveBruta !== chaveAparada ? 'sim' : 'nao'),
    'voice_id=' + (voiceIdAparado || 'ausente'),
    'houve_trim_voice_id=' + (voiceIdBruto !== voiceIdAparado ? 'sim' : 'nao'),
    'ambiente=' + (process.env.VERCEL_ENV ?? 'desconhecido'),
  );
}

/**
 * Monta URL + opções da chamada à ElevenLabs — extraído do handler só para
 * poder ser testado sem precisar mockar autenticação: confirma que o
 * endpoint é o de streaming (`/text-to-speech/{voice_id}/stream`), o header
 * de auth é `xi-api-key` (nunca `Authorization`/`Bearer`) e o `model_id` vai
 * no corpo. Nenhuma mudança de comportamento — só isolamento.
 */
export function montarRequisicaoElevenLabs(
  voiceId: string,
  key: string,
  texto: string,
): { url: string; opcoes: { method: 'POST'; headers: Record<string, string>; body: string } } {
  return {
    url: `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}/stream?output_format=${FORMATO_AUDIO}`,
    opcoes: {
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
    },
  };
}

/**
 * Corpo de erro típico da ElevenLabs: `{ detail: { status, message } }` ou,
 * às vezes, `{ detail: "mensagem solta" }`. Extrai com segurança, sem
 * presumir o formato — nunca lança se vier algo inesperado.
 */
export function extrairDetalheElevenLabs(dados: unknown): { status: string | null; message: string | null } {
  const raiz = (dados ?? null) as Record<string, unknown> | null;
  const detail = raiz?.detail;
  if (typeof detail === 'string') return { status: null, message: detail };
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    return {
      status: typeof d.status === 'string' ? d.status : null,
      message: typeof d.message === 'string' ? d.message : null,
    };
  }
  return { status: null, message: null };
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

  const keyBruta = process.env.ELEVENLABS_API_KEY ?? '';
  const voiceIdBruto = process.env.ELEVENLABS_VOICE_ID ?? '';
  logDiagnosticoCredencialTts(keyBruta, voiceIdBruto);
  const key = keyBruta.trim();
  const voiceId = voiceIdBruto.trim();
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
    const { url, opcoes } = montarRequisicaoElevenLabs(voiceId, key, texto);
    let resposta: Response;
    try {
      resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
    } catch (e) {
      const timeout = e instanceof Error && e.name === 'AbortError';
      console.error('[NEXO TTS] ElevenLabs erro:', timeout ? 'tempo limite excedido' : 'falha de rede');
      return res.status(timeout ? 504 : 502).json({ ok: false, erro: 'Não foi possível gerar a voz.' });
    }

    console.log('[NEXO TTS] ElevenLabs respondeu', Date.now() - tTts, 'ms');

    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => null) as Record<string, unknown> | null;
      const detalhe = extrairDetalheElevenLabs(dados);
      // Request-id/trace-id, se a ElevenLabs mandar — nomes de header variam
      // por provedor, então checa os candidatos mais comuns em vez de
      // presumir um só. Nunca é segredo (é só um identificador de log).
      const requestId =
        resposta.headers.get('request-id') ??
        resposta.headers.get('x-request-id') ??
        resposta.headers.get('elevenlabs-request-id') ??
        null;
      console.error(
        '[nexo-ai/tts] ElevenLabs erro_corpo',
        'status_http=' + resposta.status,
        'detail_status=' + (detalhe.status ?? 'ausente'),
        'detail_message=' + (detalhe.message ?? 'ausente'),
        'request_id=' + (requestId ?? 'ausente'),
      );

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
      // `tts_credencial` — sinal explícito pro frontend nunca tentar de novo
      // automaticamente (ver deveTravarPorCredencial / voz.ts).
      const codigo = deveTravarPorCredencial(resposta.status) ? 'tts_credencial' : undefined;
      return res.status(status).json({ ok: false, erro: erroPublico, ...(codigo ? { codigo } : {}) });
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

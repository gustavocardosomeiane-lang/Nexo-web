/**
 * GET /api/asaas/conexao — diagnóstico da integração.
 *
 * Responde se a credencial funciona, em qual ambiente e o que está faltando.
 * É o primeiro lugar a olhar quando "o Asaas não está funcionando".
 *
 * NÃO devolve a chave, nem parte dela.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ambienteAsaas, baseAsaas, chamarAsaas, metodoInvalido, ErroAsaas } from '../_lib/asaas.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (metodoInvalido(req, res, ['GET'])) return;

  const ambiente = ambienteAsaas();
  const temChave = Boolean((process.env.ASAAS_API_KEY ?? '').trim());
  const temTokenWebhook = Boolean((process.env.ASAAS_WEBHOOK_TOKEN ?? '').trim());

  const base = {
    ambiente,
    url: baseAsaas(),
    api_key_configurada: temChave,
    webhook_token_configurado: temTokenWebhook,
  };

  if (!temChave) {
    return res.status(200).json({
      ...base,
      ok: false,
      conectado: false,
      erro: 'ASAAS_API_KEY não configurada no ambiente do servidor.',
    });
  }

  try {
    // Consulta barata só para provar que a credencial é aceita.
    const resposta = await chamarAsaas<{ totalCount: number }>('/customers?limit=1');
    return res.status(200).json({
      ...base,
      ok: true,
      conectado: true,
      clientes_cadastrados: resposta.totalCount ?? 0,
    });
  } catch (erro) {
    const detalhe = erro instanceof ErroAsaas ? erro.message : 'Falha ao conectar com o Asaas.';
    const codigo = erro instanceof ErroAsaas ? erro.codigo : undefined;

    // 200 de propósito: a rota respondeu bem; quem falhou foi o Asaas. O painel
    // precisa distinguir "diagnóstico funcionou e deu ruim" de "rota quebrada".
    return res.status(200).json({ ...base, ok: false, conectado: false, erro: detalhe, codigo });
  }
}

/**
 * Operações sobre uma cobrança existente.
 *
 *   GET    /api/asaas/cobranca?id=pay_xxx              consulta o status
 *   DELETE /api/asaas/cobranca?id=pay_xxx              cancela
 *   POST   /api/asaas/cobranca?id=pay_xxx&acao=estornar  estorna (total ou parcial)
 *
 * Os três num arquivo só porque cada arquivo em `api/` vira uma função
 * serverless na Vercel, e o plano tem teto de funções. Agrupar operações da
 * mesma entidade é mais barato e não confunde.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  chamarAsaas,
  corpoJson,
  metodoInvalido,
  responderErro,
  type PagamentoAsaas,
} from '../_lib/asaas';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (metodoInvalido(req, res, ['GET', 'POST', 'DELETE'])) return;

  const id = String(req.query.id ?? '').trim();
  if (!id) {
    return res.status(400).json({ ok: false, erro: 'Informe o id da cobrança.', codigo: 'sem_id' });
  }

  try {
    if (req.method === 'GET') {
      const cobranca = await chamarAsaas<PagamentoAsaas>(`/payments/${id}`);
      return res.status(200).json({ ok: true, cobranca });
    }

    if (req.method === 'DELETE') {
      const resultado = await chamarAsaas<{ deleted: boolean; id: string }>(`/payments/${id}`, {
        metodo: 'DELETE',
      });
      return res.status(200).json({ ok: true, cancelada: resultado.deleted, id: resultado.id });
    }

    // POST — estorno
    const acao = String(req.query.acao ?? '').trim();
    if (acao !== 'estornar') {
      return res.status(400).json({ ok: false, erro: 'Ação não reconhecida.', codigo: 'acao_invalida' });
    }

    // Sem valor = estorno total. Com valor = parcial (em reais).
    const { valor } = corpoJson<{ valor?: number }>(req);
    const corpo = typeof valor === 'number' && valor > 0 ? { value: Number(valor.toFixed(2)) } : undefined;

    const cobranca = await chamarAsaas<PagamentoAsaas>(`/payments/${id}/refund`, {
      metodo: 'POST',
      corpo,
    });

    return res.status(200).json({ ok: true, cobranca });
  } catch (erro) {
    return responderErro(res, erro);
  }
}

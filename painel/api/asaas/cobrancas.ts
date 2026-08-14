/**
 * POST /api/asaas/cobrancas — cria a cobrança (PIX, cartão, com ou sem parcelas).
 *
 * DOIS DETALHES QUE IMPORTAM:
 *
 *   externalReference recebe o id da venda no nosso banco. É por ele que o
 *   webhook reencontra a venda depois — sem isso, o evento chega e não há como
 *   saber a que ele pertence.
 *
 *   asaas-idempotency-key impede cobrança duplicada. Se a rede cair depois do
 *   Asaas criar mas antes de nós recebermos a resposta, o reenvio devolve a
 *   MESMA cobrança em vez de criar outra.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  chamarAsaas,
  corpoJson,
  dataAsaas,
  metodoInvalido,
  responderErro,
  type PagamentoAsaas,
  type PixQrCodeAsaas,
} from '../_lib/asaas.js';

interface Entrada {
  customer?: string;
  billingType?: 'PIX' | 'CREDIT_CARD' | 'BOLETO';
  /** Reais decimais (ex.: 2500.00). */
  value?: number;
  dueDate?: string;
  description?: string;
  /** Id da venda no painel. */
  externalReference?: string;
  /** Só para cartão. */
  installmentCount?: number;
  /** Chave de idempotência gerada pelo painel. */
  idempotencia?: string;
}

const MAX_PARCELAS = 21; // limite do Asaas para cartão

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (metodoInvalido(req, res, ['POST'])) return;

  try {
    const entrada = corpoJson<Entrada>(req);
    const { customer, billingType, value, dueDate, description, externalReference } = entrada;

    if (!customer || !billingType || !value || !dueDate) {
      return res.status(400).json({
        ok: false,
        erro: 'customer, billingType, value e dueDate são obrigatórios.',
        codigo: 'campos_obrigatorios',
      });
    }

    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ ok: false, erro: 'O valor precisa ser maior que zero.', codigo: 'valor_invalido' });
    }

    const parcelas = Number(entrada.installmentCount ?? 1);
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS) {
      return res.status(400).json({
        ok: false,
        erro: `O número de parcelas precisa estar entre 1 e ${MAX_PARCELAS}.`,
        codigo: 'parcelas_invalidas',
      });
    }

    // Parcelamento no Asaas só existe para cartão. Pedir 3x no PIX geraria
    // três cobranças mensais, que não é o que "parcelar no PIX" significa.
    if (parcelas > 1 && billingType !== 'CREDIT_CARD') {
      return res.status(400).json({
        ok: false,
        erro: 'Parcelamento só é aceito em cartão de crédito. Para PIX, gere uma cobrança por parcela.',
        codigo: 'parcelamento_nao_suportado',
      });
    }

    const corpo: Record<string, unknown> = {
      customer,
      billingType,
      value: Number(value.toFixed(2)),
      dueDate: dataAsaas(dueDate),
      ...(description ? { description: description.slice(0, 500) } : {}),
      ...(externalReference ? { externalReference } : {}),
    };

    if (parcelas > 1) {
      corpo.installmentCount = parcelas;
      // O Asaas aceita installmentValue OU totalValue. `totalValue` evita erro
      // de centavo: a divisão passa a ser problema dele, não nosso.
      corpo.totalValue = Number(value.toFixed(2));
      delete corpo.value;
    }

    const cobranca = await chamarAsaas<PagamentoAsaas>('/payments', {
      metodo: 'POST',
      corpo,
      idempotencia: entrada.idempotencia,
    });

    // PIX precisa do QR Code; sem ele o cliente não tem como pagar.
    let pix: PixQrCodeAsaas | null = null;
    if (billingType === 'PIX') {
      try {
        pix = await chamarAsaas<PixQrCodeAsaas>(`/payments/${cobranca.id}/pixQrCode`);
      } catch (e) {
        // A cobrança já existe; falhar tudo por causa do QR seria pior.
        // O painel mostra o link do checkout como alternativa.
        console.error('[asaas] cobrança criada, mas o QR Code do PIX falhou:', e instanceof Error ? e.message : e);
      }
    }

    return res.status(201).json({ ok: true, cobranca, pix });
  } catch (erro) {
    return responderErro(res, erro);
  }
}

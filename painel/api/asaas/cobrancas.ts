import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      erro: 'Método não permitido',
    });
  }

  try {
    const apiKey = process.env.ASAAS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        erro: 'ASAAS_API_KEY não configurada',
      });
    }

    const {
      customer,
      billingType,
      value,
      dueDate,
      description,
    } = req.body ?? {};

    if (!customer || !billingType || !value || !dueDate) {
      return res.status(400).json({
        ok: false,
        erro: 'customer, billingType, value e dueDate são obrigatórios',
      });
    }

    const cobranca: Record<string, unknown> = {
      customer,
      billingType,
      value,
      dueDate,
    };

    if (description) {
      cobranca.description = description;
    }

    const resposta = await fetch('https://api.asaas.com/v3/payments', {
      method: 'POST',
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cobranca),
    });

    const dados = await resposta.json();

    return res.status(resposta.status).json({
      ok: resposta.ok,
      cobranca: dados,
    });
  } catch {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao criar cobrança no Asaas',
    });
  }
}

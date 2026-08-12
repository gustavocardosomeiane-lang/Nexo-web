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

    const { name, email, cpfCnpj, phone } = req.body ?? {};

    if (!name || !cpfCnpj) {
      return res.status(400).json({
        ok: false,
        erro: 'Nome e CPF/CNPJ são obrigatórios',
      });
    }

    const cliente: Record<string, string> = {
      name,
      cpfCnpj,
    };

    if (email) {
      cliente.email = email;
    }

    if (phone) {
      cliente.phone = phone;
    }

    const resposta = await fetch('https://api.asaas.com/v3/customers', {
      method: 'POST',
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cliente),
    });

    const dados = await resposta.json();

    return res.status(resposta.status).json({
      ok: resposta.ok,
      cliente: dados,
    });
  } catch {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao criar cliente no Asaas',
    });
  }
}

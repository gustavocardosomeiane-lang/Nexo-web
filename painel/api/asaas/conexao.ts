import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!process.env.ASAAS_API_KEY) {
      return res.status(500).json({
        ok: false,
        erro: "ASAAS_API_KEY não configurada",
      });
    }

    const resposta = await fetch("https://api.asaas.com/v3/customers?limit=1", {
      headers: {
        access_token: process.env.ASAAS_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const dados = await resposta.json();

    return res.status(resposta.status).json({
      ok: resposta.ok,
      asaas: dados,
    });
  } catch (erro) {
    return res.status(500).json({
      ok: false,
      erro: "Falha ao conectar com o Asaas",
    });
  }
}

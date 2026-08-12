/**
 * POST /api/asaas/clientes — cria (ou reaproveita) um cliente no Asaas.
 *
 * REAPROVEITAMENTO. Antes de criar, procura pelo CPF/CNPJ. O Asaas aceita
 * cadastrar duas vezes a mesma pessoa e passaria a existir cliente duplicado,
 * cada um com suas cobranças — bagunça difícil de desfazer depois.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  chamarAsaas,
  corpoJson,
  metodoInvalido,
  responderErro,
  soDigitos,
  type ClienteAsaas,
} from '../_lib/asaas';

interface Entrada {
  name?: string;
  email?: string;
  cpfCnpj?: string;
  phone?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (metodoInvalido(req, res, ['POST'])) return;

  try {
    const { name, email, cpfCnpj, phone } = corpoJson<Entrada>(req);

    const nome = (name ?? '').trim();
    const documento = soDigitos(cpfCnpj);

    if (!nome) {
      return res.status(400).json({ ok: false, erro: 'O nome do cliente é obrigatório.' });
    }

    // O Asaas exige CPF (11) ou CNPJ (14). Barrar aqui devolve uma mensagem
    // melhor do que o erro genérico da API.
    if (documento.length !== 11 && documento.length !== 14) {
      return res.status(400).json({
        ok: false,
        erro: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.',
        codigo: 'documento_invalido',
      });
    }

    const existentes = await chamarAsaas<{ data: ClienteAsaas[] }>(
      `/customers?cpfCnpj=${documento}&limit=1`,
    );

    const jaExiste = existentes.data?.find((c) => !c.deleted);
    if (jaExiste) {
      return res.status(200).json({ ok: true, cliente: jaExiste, reaproveitado: true });
    }

    const telefone = soDigitos(phone);
    const cliente = await chamarAsaas<ClienteAsaas>('/customers', {
      metodo: 'POST',
      corpo: {
        name: nome,
        cpfCnpj: documento,
        ...(email?.trim() ? { email: email.trim() } : {}),
        ...(telefone ? { mobilePhone: telefone } : {}),
      },
    });

    return res.status(201).json({ ok: true, cliente, reaproveitado: false });
  } catch (erro) {
    return responderErro(res, erro);
  }
}

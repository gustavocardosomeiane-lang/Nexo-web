/**
 * Camada compartilhada de acesso ao Asaas.
 *
 * TUDO AQUI RODA NO SERVIDOR (Vercel Functions). A `ASAAS_API_KEY` nunca sai
 * daqui: o navegador fala com `/api/asaas/*`, e só estas funções falam com o
 * Asaas. Nenhuma variável deste arquivo leva prefixo `VITE_`, justamente para
 * não poder ser empacotada no frontend.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

/* --------------------------------------------------------------------------
   Ambiente
   -------------------------------------------------------------------------- */

const BASES = {
  producao: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
} as const;

export type AmbienteAsaas = keyof typeof BASES;

/**
 * Produção é o padrão. Sandbox só entra quando `ASAAS_ENV=sandbox` for
 * definido explicitamente — decisão registrada com você. Trocar de ambiente é
 * mudar essa variável na Vercel, sem tocar em código.
 */
export function ambienteAsaas(): AmbienteAsaas {
  return (process.env.ASAAS_ENV ?? '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'producao';
}

export function baseAsaas(): string {
  return BASES[ambienteAsaas()];
}

/* --------------------------------------------------------------------------
   Erros
   -------------------------------------------------------------------------- */

export class ErroAsaas extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(message);
    this.name = 'ErroAsaas';
  }
}

/** Formato de erro do Asaas: `{ errors: [{ code, description }] }`. */
interface RespostaErroAsaas {
  errors?: { code?: string; description?: string }[];
}

/**
 * Traduz o erro do Asaas para algo que o painel possa mostrar.
 *
 * A conta em análise devolve `invalid_action` ou 401/403 — casos previstos
 * aqui para a mensagem explicar o motivo real em vez de "erro desconhecido".
 */
function mensagemDeErro(status: number, corpo: unknown): { mensagem: string; codigo?: string } {
  const erro = (corpo as RespostaErroAsaas)?.errors?.[0];

  if (erro?.description) {
    return { mensagem: erro.description, codigo: erro.code };
  }

  if (status === 401 || status === 403) {
    return {
      mensagem:
        'O Asaas recusou a credencial. Verifique se a ASAAS_API_KEY corresponde ao ambiente ' +
        `configurado (${ambienteAsaas()}) e se a conta já foi aprovada.`,
      codigo: 'credencial_recusada',
    };
  }

  if (status === 429) {
    return { mensagem: 'Limite de requisições do Asaas atingido. Tente de novo em instantes.', codigo: 'rate_limit' };
  }

  return { mensagem: `O Asaas respondeu ${status} sem detalhar o motivo.`, codigo: 'resposta_inesperada' };
}

/* --------------------------------------------------------------------------
   Cliente HTTP
   -------------------------------------------------------------------------- */

function chave(): string {
  const k = (process.env.ASAAS_API_KEY ?? '').trim();
  if (!k) {
    throw new ErroAsaas(
      'ASAAS_API_KEY não configurada no ambiente do servidor.',
      500,
      'sem_credencial',
    );
  }
  return k;
}

interface OpcoesChamada {
  metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  corpo?: unknown;
  /**
   * Enviado como header `asaas-idempotency-key`. O Asaas devolve a MESMA
   * cobrança em vez de criar outra quando a chave se repete — é o que impede
   * cobrar o cliente duas vezes se a rede cair no meio e a tela reenviar.
   */
  idempotencia?: string;
}

export async function chamarAsaas<T>(caminho: string, opcoes: OpcoesChamada = {}): Promise<T> {
  const { metodo = 'GET', corpo, idempotencia } = opcoes;

  const headers: Record<string, string> = {
    access_token: chave(),
    'Content-Type': 'application/json',
    // O Asaas pede identificação do integrador nos headers.
    'User-Agent': 'NEXO WEB Painel',
  };

  if (idempotencia) headers['asaas-idempotency-key'] = idempotencia;

  let resposta: Response;
  try {
    resposta = await fetch(`${baseAsaas()}${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroAsaas('Não foi possível alcançar o Asaas. Verifique a conexão.', 502, 'rede');
  }

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const { mensagem, codigo } = mensagemDeErro(resposta.status, dados);
    throw new ErroAsaas(mensagem, resposta.status, codigo);
  }

  return dados as T;
}

/* --------------------------------------------------------------------------
   Utilidades de handler
   -------------------------------------------------------------------------- */

/** Resposta de erro padronizada. Nunca inclui a chave nem o corpo bruto. */
export function responderErro(res: VercelResponse, erro: unknown) {
  if (erro instanceof ErroAsaas) {
    // Log do servidor: útil para depurar, e sem segredo — `chamarAsaas` nunca
    // coloca a credencial na mensagem.
    console.error(`[asaas] ${erro.codigo ?? 'erro'} (${erro.status}): ${erro.message}`);
    return res.status(erro.status).json({ ok: false, erro: erro.message, codigo: erro.codigo });
  }

  console.error('[asaas] erro inesperado:', erro instanceof Error ? erro.message : erro);
  return res.status(500).json({ ok: false, erro: 'Falha inesperada ao falar com o Asaas.' });
}

/** Recusa qualquer método fora da lista. Devolve `true` se já respondeu. */
export function metodoInvalido(
  req: VercelRequest,
  res: VercelResponse,
  permitidos: string[],
): boolean {
  if (permitidos.includes(req.method ?? '')) return false;
  res.setHeader('Allow', permitidos.join(', '));
  res.status(405).json({ ok: false, erro: 'Método não permitido' });
  return true;
}

/**
 * O corpo pode chegar como objeto (Vercel já parseou) ou string.
 * Normalizar aqui evita `req.body.x is undefined` intermitente.
 */
export function corpoJson<T = Record<string, unknown>>(req: VercelRequest): T {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return {} as T;
    }
  }
  return (req.body ?? {}) as T;
}

/* --------------------------------------------------------------------------
   Conversões
   -------------------------------------------------------------------------- */

/** O painel guarda centavos; o Asaas trabalha em reais decimais. */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}

/** Só dígitos — o Asaas rejeita CPF/CNPJ formatado. */
export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** ISO yyyy-mm-dd, formato exigido pelo campo `dueDate`. */
export function dataAsaas(valor?: string | Date): string {
  const d = valor ? new Date(valor) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------
   Tipos do Asaas
   -------------------------------------------------------------------------- */

export interface ClienteAsaas {
  id: string;
  name: string;
  email?: string | null;
  cpfCnpj?: string | null;
  mobilePhone?: string | null;
  deleted?: boolean;
}

export type StatusPagamentoAsaas =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'RECEIVED_IN_CASH'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'APPROVED_BY_RISK_ANALYSIS'
  | 'REPROVED_BY_RISK_ANALYSIS'
  | 'CANCELED';

export interface PagamentoAsaas {
  id: string;
  customer: string;
  status: StatusPagamentoAsaas;
  billingType: 'PIX' | 'CREDIT_CARD' | 'BOLETO' | 'UNDEFINED';
  value: number;
  netValue?: number;
  dueDate: string;
  description?: string | null;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  confirmedDate?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  installment?: string | null;
  installmentCount?: number | null;
  deleted?: boolean;
}

export interface PixQrCodeAsaas {
  encodedImage: string;
  payload: string;
  expirationDate?: string | null;
}

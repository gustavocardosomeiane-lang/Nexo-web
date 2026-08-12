/**
 * Adaptador do Asaas.
 *
 * Este arquivo roda NO NAVEGADOR e por isso não fala com o Asaas diretamente:
 * ele chama as funções serverless em `/api/asaas/*`, que guardam a
 * `ASAAS_API_KEY`. Toda operação que exige a chave é uma operação de servidor,
 * exatamente como declarado na interface `PaymentProvider`.
 *
 * A verificação de assinatura do webhook também não acontece aqui — quem
 * valida é `api/webhooks/asaas.ts`, com o token e comparação em tempo
 * constante. `verificarAssinatura` devolve `false` de propósito: se alguém um
 * dia chamar essa função pelo cliente, o correto é recusar.
 */

import type {
  CobrancaCriada,
  EventoPagamento,
  PaymentProvider,
  PedidoCobranca,
  StatusCobranca,
} from './PaymentProvider';
import type { PaymentMethod, WebhookEventType } from '@/types';
import { classificarEventoAsaas } from '../../../shared/regras-pagamento';

const API = '/api/asaas';

/* --------------------------------------------------------------------------
   Tipos da resposta
   -------------------------------------------------------------------------- */

interface PagamentoAsaas {
  id: string;
  status: string;
  value: number;
  billingType: string;
  dueDate: string;
  invoiceUrl?: string | null;
  externalReference?: string | null;
  paymentDate?: string | null;
  confirmedDate?: string | null;
}

interface PixAsaas {
  encodedImage: string;
  payload: string;
  expirationDate?: string | null;
}

/* --------------------------------------------------------------------------
   Traduções
   -------------------------------------------------------------------------- */

function metodoAsaas(metodo: PaymentMethod): 'PIX' | 'CREDIT_CARD' {
  return metodo === 'pix' ? 'PIX' : 'CREDIT_CARD';
}

function metodoInterno(billingType: string): PaymentMethod | null {
  if (billingType === 'PIX') return 'pix';
  if (billingType === 'CREDIT_CARD' || billingType === 'DEBIT_CARD') return 'cartao';
  return null;
}

/** Status de cobrança do Asaas -> vocabulário do painel. */
function statusCobranca(status: string): StatusCobranca['status'] {
  switch (status) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
      return 'aprovado';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return 'reembolsado';
    case 'CANCELED':
      return 'cancelado';
    case 'REPROVED_BY_RISK_ANALYSIS':
    case 'CHARGEBACK_REQUESTED':
      return 'recusado';
    default:
      // PENDING, OVERDUE, AWAITING_RISK_ANALYSIS e afins seguem em aberto.
      return 'pendente';
  }
}

function statusCriacao(status: string): CobrancaCriada['status'] {
  const s = statusCobranca(status);
  return s === 'aprovado' ? 'aprovado' : s === 'recusado' ? 'recusado' : 'pendente';
}

/* --------------------------------------------------------------------------
   HTTP
   -------------------------------------------------------------------------- */

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error('Não foi possível falar com o servidor de pagamentos.');
  }

  const dados = (await resposta.json().catch(() => null)) as
    | (Record<string, unknown> & { erro?: string })
    | null;

  if (!resposta.ok || dados?.ok === false) {
    throw new Error(dados?.erro ?? 'Falha na comunicação com o Asaas.');
  }
  return dados as T;
}

const postJson = <T>(url: string, corpo: unknown) =>
  chamar<T>(url, { method: 'POST', body: JSON.stringify(corpo) });

/* --------------------------------------------------------------------------
   Provider
   -------------------------------------------------------------------------- */

export const asaasProvider: PaymentProvider = {
  nome: 'asaas',
  configurado: true,

  recursos: {
    pix: true,
    cartao: true,
    // Só no cartão. O endpoint recusa parcelamento em PIX e explica o motivo.
    parcelamento: true,
    checkoutHospedado: true,
    reembolso: true,
  },

  async criarCobranca(pedido: PedidoCobranca): Promise<CobrancaCriada> {
    // 1. Cliente. O endpoint reaproveita quem já existe pelo CPF/CNPJ.
    const { cliente } = await postJson<{ cliente: { id: string } }>(`${API}/clientes`, {
      name: pedido.pagador.nome,
      email: pedido.pagador.email ?? undefined,
      cpfCnpj: pedido.pagador.documento ?? undefined,
      phone: pedido.pagador.telefone ?? undefined,
    });

    // 2. Cobrança. A referência é o id da venda: é por ela que o webhook
    //    reencontra o registro depois.
    const descricao =
      pedido.itens.map((i) => `${i.quantidade}× ${i.descricao}`).join(', ').slice(0, 500) ||
      `Venda ${pedido.referencia}`;

    const { cobranca, pix } = await postJson<{ cobranca: PagamentoAsaas; pix: PixAsaas | null }>(
      `${API}/cobrancas`,
      {
        customer: cliente.id,
        billingType: metodoAsaas(pedido.metodo),
        value: pedido.valor / 100,
        dueDate: new Date().toISOString().slice(0, 10),
        description: descricao,
        externalReference: pedido.referencia,
        installmentCount: pedido.metodo === 'cartao' && pedido.parcelas > 1 ? pedido.parcelas : undefined,
        // Mesma venda reenviada não gera segunda cobrança.
        idempotencia: `venda-${pedido.referencia}-${pedido.metodo}-${pedido.parcelas}`,
      },
    );

    return {
      id: cobranca.id,
      status: statusCriacao(cobranca.status),
      urlCheckout: cobranca.invoiceUrl ?? undefined,
      pixCopiaECola: pix?.payload,
      pixQrCode: pix?.encodedImage ? `data:image/png;base64,${pix.encodedImage}` : undefined,
      expiraEm: pix?.expirationDate ?? undefined,
    };
  },

  async consultarCobranca(transacaoId: string): Promise<StatusCobranca> {
    const { cobranca } = await chamar<{ cobranca: PagamentoAsaas }>(
      `${API}/cobranca?id=${encodeURIComponent(transacaoId)}`,
    );

    return {
      id: cobranca.id,
      status: statusCobranca(cobranca.status),
      pagoEm: cobranca.paymentDate ?? cobranca.confirmedDate ?? null,
      valorPago: Math.round(cobranca.value * 100),
    };
  },

  async cancelarCobranca(transacaoId: string): Promise<void> {
    await chamar(`${API}/cobranca?id=${encodeURIComponent(transacaoId)}`, { method: 'DELETE' });
  },

  async reembolsar(transacaoId: string, valor?: number): Promise<void> {
    await postJson(`${API}/cobranca?id=${encodeURIComponent(transacaoId)}&acao=estornar`, {
      valor: typeof valor === 'number' ? valor / 100 : undefined,
    });
  },

  async verificarAssinatura(): Promise<boolean> {
    // Validação é responsabilidade do servidor (api/webhooks/asaas.ts).
    // Recusar aqui evita que alguém confie nesta função por engano.
    return false;
  },

  /**
   * Traduz o corpo do webhook do Asaas para o formato interno.
   * Usa a MESMA tabela de eventos que a função serverless — módulo compartilhado.
   */
  interpretarEvento(payload: unknown): EventoPagamento | null {
    const corpo = payload as
      | {
          id?: string;
          event?: string;
          payment?: {
            id?: string;
            value?: number;
            billingType?: string;
            externalReference?: string | null;
            paymentDate?: string | null;
            confirmedDate?: string | null;
          };
        }
      | null;

    if (!corpo?.id || !corpo.event || !corpo.payment?.id) return null;

    const { desconhecido, tipo } = classificarEventoAsaas(corpo.event);
    if (desconhecido || tipo === null) return null;

    return {
      id: corpo.id,
      tipo: tipo as WebhookEventType,
      transacaoId: corpo.payment.id,
      referencia: corpo.payment.externalReference ?? null,
      valor: typeof corpo.payment.value === 'number' ? Math.round(corpo.payment.value * 100) : null,
      metodo: corpo.payment.billingType ? metodoInterno(corpo.payment.billingType) : null,
      ocorridoEm: corpo.payment.paymentDate ?? corpo.payment.confirmedDate ?? new Date().toISOString(),
      bruto: corpo as unknown as Record<string, unknown>,
    };
  },
};

export default asaasProvider;

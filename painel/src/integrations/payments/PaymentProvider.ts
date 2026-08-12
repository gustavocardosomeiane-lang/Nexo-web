/**
 * PaymentProvider — contrato do gateway de pagamento.
 *
 * NENHUM GATEWAY FOI ESCOLHIDO. Este arquivo define o formato do encaixe, nao
 * uma integracao. Quando um gateway real for contratado, ele entra como um
 * adaptador novo em `src/integrations/payments/` que satisfaz esta interface —
 * e nada no painel precisa mudar.
 *
 * Requisitos que o gateway escolhido precisa atender:
 *   PIX · cartao · parcelamento · checkout · API · webhooks
 *
 * ONDE CADA CHAVE MORA
 *   PAYMENT_PUBLIC_KEY   -> frontend (VITE_PAYMENT_PUBLIC_KEY). E publica.
 *   PAYMENT_SECRET_KEY   -> SO no servidor. Nunca no navegador.
 *   PAYMENT_WEBHOOK_SECRET -> SO no servidor. Valida a assinatura do webhook.
 *
 * Por isso `criarCobranca` esta marcado como operacao de servidor: se o
 * navegador pudesse criar cobranca sozinho, a secret key estaria no bundle.
 */

import type { PaymentMethod, WebhookEventType } from '@/types';

/* --------------------------------------------------------------------------
   Cobrança
   -------------------------------------------------------------------------- */

export interface ItemCobranca {
  descricao: string;
  /** Centavos. */
  valor: number;
  quantidade: number;
}

export interface PagadorCobranca {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  documento?: string | null;
}

export interface PedidoCobranca {
  /** Id da venda no nosso banco. Volta no webhook como referencia externa. */
  referencia: string;
  /** Centavos, ja com desconto aplicado. */
  valor: number;
  metodo: PaymentMethod;
  parcelas: number;
  itens: ItemCobranca[];
  pagador: PagadorCobranca;
  /** Para onde o cliente volta depois de pagar. */
  urlRetorno?: string;
}

export interface CobrancaCriada {
  /** Id da transacao no gateway. */
  id: string;
  status: 'pendente' | 'aprovado' | 'recusado';
  /** Link do checkout hospedado, quando o gateway oferecer. */
  urlCheckout?: string;
  /** Copia e cola do PIX. */
  pixCopiaECola?: string;
  /** QR Code em data URI. */
  pixQrCode?: string;
  expiraEm?: string;
}

export interface StatusCobranca {
  id: string;
  status: 'pendente' | 'aprovado' | 'recusado' | 'cancelado' | 'reembolsado';
  pagoEm?: string | null;
  valorPago?: number | null;
}

/* --------------------------------------------------------------------------
   Webhook
   -------------------------------------------------------------------------- */

/** Formato normalizado. Cada adaptador traduz o payload do seu gateway para cá. */
export interface EventoPagamento {
  /** Id do evento NO GATEWAY. É a chave da idempotência. */
  id: string;
  tipo: WebhookEventType;
  transacaoId: string;
  /** Id da venda que enviamos como referência ao criar a cobrança. */
  referencia: string | null;
  valor: number | null;
  metodo: PaymentMethod | null;
  ocorridoEm: string;
  bruto: Record<string, unknown>;
}

/* --------------------------------------------------------------------------
   Interface
   -------------------------------------------------------------------------- */

export interface PaymentProvider {
  /** Identificador curto, gravado em `sales.gateway` e `payments.gateway`. */
  readonly nome: string;
  readonly configurado: boolean;
  /** O que este gateway suporta. A interface se adapta ao que existe. */
  readonly recursos: {
    pix: boolean;
    cartao: boolean;
    parcelamento: boolean;
    checkoutHospedado: boolean;
    reembolso: boolean;
  };

  /** OPERAÇÃO DE SERVIDOR — exige a secret key. */
  criarCobranca(pedido: PedidoCobranca): Promise<CobrancaCriada>;
  /** OPERAÇÃO DE SERVIDOR. */
  consultarCobranca(transacaoId: string): Promise<StatusCobranca>;
  /** OPERAÇÃO DE SERVIDOR. */
  cancelarCobranca(transacaoId: string): Promise<void>;
  /** OPERAÇÃO DE SERVIDOR. `valor` ausente = reembolso total. */
  reembolsar(transacaoId: string, valor?: number): Promise<void>;

  /**
   * Confere a assinatura do webhook com PAYMENT_WEBHOOK_SECRET.
   * SEMPRE no servidor. Um webhook sem verificação de assinatura é um endpoint
   * público que qualquer pessoa pode usar para marcar vendas como pagas.
   */
  verificarAssinatura(corpoBruto: string, assinatura: string, segredo: string): Promise<boolean>;

  /** Traduz o payload do gateway para o formato normalizado. */
  interpretarEvento(payload: unknown): EventoPagamento | null;
}

/* --------------------------------------------------------------------------
   Adaptador nulo
   -------------------------------------------------------------------------- */

class GatewayNaoConfigurado extends Error {
  constructor(operacao: string) {
    super(
      `Nenhum gateway de pagamento configurado — "${operacao}" não pode ser executado. ` +
        'Escolha um gateway, crie o adaptador em src/integrations/payments/ e ' +
        'defina VITE_PAYMENT_PROVIDER e VITE_PAYMENT_API_URL.',
    );
    this.name = 'GatewayNaoConfigurado';
  }
}

/**
 * Provider padrao: recusa tudo com uma mensagem clara.
 *
 * Deliberadamente nao simula sucesso. Um provider falso que "aprova" pagamento
 * mascara a ausencia da integracao e um dia alguem descobre em producao.
 */
export const nullPaymentProvider: PaymentProvider = {
  nome: 'none',
  configurado: false,
  recursos: {
    pix: false,
    cartao: false,
    parcelamento: false,
    checkoutHospedado: false,
    reembolso: false,
  },

  async criarCobranca() {
    throw new GatewayNaoConfigurado('criar cobrança');
  },
  async consultarCobranca() {
    throw new GatewayNaoConfigurado('consultar cobrança');
  },
  async cancelarCobranca() {
    throw new GatewayNaoConfigurado('cancelar cobrança');
  },
  async reembolsar() {
    throw new GatewayNaoConfigurado('reembolsar');
  },
  async verificarAssinatura() {
    // Falha fechado: sem gateway, nenhuma assinatura pode ser considerada válida.
    return false;
  },
  interpretarEvento() {
    return null;
  },
};

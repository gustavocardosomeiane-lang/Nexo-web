/**
 * Selecao do gateway ativo e a porta de dados do webhook.
 *
 * Para plugar um gateway real:
 *   1. crie `src/integrations/payments/<nome>Provider.ts` implementando PaymentProvider;
 *   2. registre no mapa ADAPTADORES abaixo;
 *   3. defina VITE_PAYMENT_PROVIDER=<nome> e VITE_PAYMENT_API_URL no ambiente;
 *   4. suba a funcao de webhook com PAYMENT_SECRET_KEY e PAYMENT_WEBHOOK_SECRET
 *      (variaveis de SERVIDOR — nunca com prefixo VITE_).
 */

import { paymentEnv } from '@/lib/env';
import { db } from '@/data';
import { nullPaymentProvider, type PaymentProvider } from './PaymentProvider';
import type { PortaWebhook } from './webhookHandler';

/** Nenhum adaptador real existe ainda — nenhum gateway foi contratado. */
const ADAPTADORES: Record<string, PaymentProvider> = {
  none: nullPaymentProvider,
};

export const paymentProvider: PaymentProvider =
  ADAPTADORES[paymentEnv.provider] ?? nullPaymentProvider;

export const gatewayConfigurado = paymentProvider.configurado && paymentEnv.configurado;

/**
 * Porta do webhook ligada ao provider de dados ativo.
 *
 * No modo demonstracao isso permite ver o fluxo inteiro funcionando pela tela
 * de Integracoes. Numa Edge Function, escreva outra porta contra o cliente
 * `service_role` — o handler em si nao muda uma linha.
 */
export const portaWebhook: PortaWebhook = {
  async eventoJaProcessado(eventoExternoId) {
    const encontrados = await db.eventosWebhook.todos({
      filtros: { evento_externo_id: eventoExternoId },
    });
    return encontrados.length > 0;
  },

  async registrarEvento(evento) {
    return db.eventosWebhook.criar(evento as never);
  },

  async concluirEvento(id, dados) {
    await db.eventosWebhook.atualizar(id, dados);
  },

  async buscarVenda(referencia, transacaoId) {
    if (referencia) {
      const porId = await db.vendas.obter(referencia);
      if (porId) return porId;

      // A referência também pode vir como o código legível (NX-0007).
      const porCodigo = await db.vendas.todos({ filtros: { codigo: referencia } });
      if (porCodigo.length > 0) return porCodigo[0];
    }

    const porTransacao = await db.vendas.todos({ filtros: { gateway_transacao_id: transacaoId } });
    return porTransacao[0] ?? null;
  },

  async pagamentosDaVenda(vendaId) {
    return db.pagamentos.todos({ filtros: { venda_id: vendaId } });
  },

  async parcelasDaVenda(vendaId) {
    return db.parcelas.todos({ filtros: { venda_id: vendaId } });
  },

  async atualizarPagamento(id, dados) {
    await db.pagamentos.atualizar(id, dados);
  },

  async atualizarParcela(id, dados) {
    await db.parcelas.atualizar(id, dados);
  },

  async atualizarVenda(id, dados) {
    await db.vendas.atualizar(id, dados);
  },

  async criarNotificacao(dados) {
    await db.notificacoes.criar(dados as never);
  },
};

export * from './PaymentProvider';
export * from './webhookHandler';

/**
 * Processamento de evento de pagamento.
 *
 * FUNCAO PURA quanto ao transporte: nao conhece HTTP, nao conhece Supabase.
 * Recebe o evento normalizado e um conjunto de operacoes de banco (`Porta`).
 * Isso permite rodar o MESMO codigo em dois lugares:
 *
 *   1. no navegador, contra o provider mock, para simular e ver o fluxo;
 *   2. numa Edge Function do Supabase, contra o banco real.
 *
 * Trocar o transporte nao pode trocar a regra de negocio. Ver painel/README.md,
 * secao "Webhooks".
 *
 * SEQUENCIA (a ordem importa):
 *   1. registra o evento (a chave unica ja barra duplicata);
 *   2. localiza a venda pela referencia ou pelo id da transacao;
 *   3. atualiza o pagamento;
 *   4. atualiza a parcela correspondente;
 *   5. recalcula o status da venda a partir das parcelas;
 *   6. marca o evento como processado;
 *   7. gera a notificacao.
 *
 * IDEMPOTENCIA. Gateway reenvia evento: por retry, por timeout, por instabilidade.
 * O mesmo `evento_externo_id` chegando duas vezes NAO pode cobrar, quitar ou
 * notificar duas vezes. A garantia forte e a constraint UNIQUE em
 * `webhook_events.evento_externo_id`; a verificacao aqui evita o trabalho a toa
 * e transforma a segunda chegada em "ignorado".
 */

import type {
  Installment,
  Notification,
  Payment,
  PaymentStatus,
  Sale,
  SaleStatus,
  WebhookEvent,
  WebhookEventType,
} from '@/types';
import type { EventoPagamento } from './PaymentProvider';

/* --------------------------------------------------------------------------
   Porta de dados
   -------------------------------------------------------------------------- */

export interface PortaWebhook {
  eventoJaProcessado(eventoExternoId: string): Promise<boolean>;
  registrarEvento(evento: Omit<WebhookEvent, 'id'>): Promise<WebhookEvent>;
  concluirEvento(id: string, dados: Partial<WebhookEvent>): Promise<void>;

  buscarVenda(referencia: string | null, transacaoId: string): Promise<Sale | null>;
  pagamentosDaVenda(vendaId: string): Promise<Payment[]>;
  parcelasDaVenda(vendaId: string): Promise<Installment[]>;

  atualizarPagamento(id: string, dados: Partial<Payment>): Promise<void>;
  atualizarParcela(id: string, dados: Partial<Installment>): Promise<void>;
  atualizarVenda(id: string, dados: Partial<Sale>): Promise<void>;

  criarNotificacao(dados: Omit<Notification, 'id'>): Promise<void>;
}

export interface ResultadoWebhook {
  status: 'processado' | 'ignorado' | 'erro';
  mensagem: string;
  vendaId?: string;
  pagamentoId?: string;
}

/* --------------------------------------------------------------------------
   Máquina de estados
   -------------------------------------------------------------------------- */

/** Para onde cada tipo de evento leva o pagamento. */
const STATUS_POR_EVENTO: Record<WebhookEventType, PaymentStatus | null> = {
  'pagamento.criado': null, // só registra; nada muda de estado ainda
  'pagamento.aprovado': 'pago',
  'pagamento.pendente': 'pendente',
  'pagamento.recusado': 'pendente', // recusa não quita: a cobrança segue aberta
  'pagamento.cancelado': 'cancelado',
  'pagamento.reembolsado': 'reembolsado',
};

const NOTIFICACAO_POR_EVENTO: Partial<
  Record<WebhookEventType, { tipo: Notification['tipo']; severidade: Notification['severidade']; titulo: string }>
> = {
  'pagamento.aprovado': { tipo: 'pagamento_aprovado', severidade: 'sucesso', titulo: 'Pagamento aprovado' },
  'pagamento.recusado': { tipo: 'pagamento_recusado', severidade: 'erro', titulo: 'Pagamento recusado' },
  'pagamento.pendente': { tipo: 'pagamento_pendente', severidade: 'alerta', titulo: 'Pagamento pendente' },
  'pagamento.reembolsado': { tipo: 'pagamento_aprovado', severidade: 'alerta', titulo: 'Pagamento reembolsado' },
};

/**
 * Status da venda derivado das parcelas — nunca informado pelo gateway.
 * A venda e a soma das suas partes; deixar o gateway decidir isso abriria
 * espaco para venda "paga" com parcela em aberto.
 */
export function statusDaVenda(parcelas: Installment[], atual: SaleStatus): SaleStatus {
  if (parcelas.length === 0) return atual;

  const pagas = parcelas.filter((p) => p.status === 'pago').length;
  const reembolsadas = parcelas.filter((p) => p.status === 'reembolsado').length;
  const canceladas = parcelas.filter((p) => p.status === 'cancelado').length;

  if (reembolsadas === parcelas.length) return 'reembolsado';
  if (canceladas === parcelas.length) return 'cancelado';
  if (pagas === 0) return atual === 'orcamento' ? 'aguardando_pagamento' : atual;
  if (pagas === parcelas.length) return 'pago';
  return 'parcialmente_pago';
}

/* --------------------------------------------------------------------------
   Processamento
   -------------------------------------------------------------------------- */

export async function processarEventoPagamento(
  evento: EventoPagamento,
  gateway: string,
  porta: PortaWebhook,
): Promise<ResultadoWebhook> {
  /* ---- 1. Idempotência ---- */
  if (await porta.eventoJaProcessado(evento.id)) {
    return {
      status: 'ignorado',
      mensagem: `Evento ${evento.id} já havia sido processado. Nada foi alterado.`,
    };
  }

  const registro = await porta.registrarEvento({
    evento_externo_id: evento.id,
    gateway,
    tipo: evento.tipo,
    status: 'recebido',
    transacao_id: evento.transacaoId,
    venda_id: null,
    pagamento_id: null,
    payload: evento.bruto,
    erro: null,
    recebido_em: new Date().toISOString(),
    processado_em: null,
  });

  try {
    /* ---- 2. Localiza a venda ---- */
    const venda = await porta.buscarVenda(evento.referencia, evento.transacaoId);
    if (!venda) {
      const mensagem = `Nenhuma venda encontrada para a referência "${evento.referencia ?? '—'}" / transação "${evento.transacaoId}".`;
      await porta.concluirEvento(registro.id, {
        status: 'erro',
        erro: mensagem,
        processado_em: new Date().toISOString(),
      });
      return { status: 'erro', mensagem };
    }

    const novoStatus = STATUS_POR_EVENTO[evento.tipo];

    /* "pagamento.criado" não muda estado: só deixa o rastro do evento. */
    if (novoStatus === null) {
      await porta.concluirEvento(registro.id, {
        status: 'processado',
        venda_id: venda.id,
        processado_em: new Date().toISOString(),
      });
      return {
        status: 'processado',
        mensagem: `Cobrança criada para a venda ${venda.codigo}. Nenhum estado alterado.`,
        vendaId: venda.id,
      };
    }

    /* ---- 3. Escolhe qual pagamento o evento atinge ---- */
    const pagamentos = await porta.pagamentosDaVenda(venda.id);
    const parcelas = await porta.parcelasDaVenda(venda.id);

    // Preferência: o pagamento que já carrega este id de transação. Sem ele,
    // a parcela em aberto mais antiga — que é a que o cliente está quitando.
    const alvo =
      pagamentos.find((p) => p.gateway_transacao_id === evento.transacaoId) ??
      pagamentos
        .filter((p) => p.status === 'pendente' || p.status === 'atrasado')
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];

    if (!alvo) {
      const mensagem = `A venda ${venda.codigo} não tem parcela em aberto para este evento.`;
      await porta.concluirEvento(registro.id, {
        status: 'erro',
        venda_id: venda.id,
        erro: mensagem,
        processado_em: new Date().toISOString(),
      });
      return { status: 'erro', mensagem, vendaId: venda.id };
    }

    const agora = new Date().toISOString();
    const pagoEm = novoStatus === 'pago' ? evento.ocorridoEm || agora : null;

    /* ---- 4. Pagamento ---- */
    await porta.atualizarPagamento(alvo.id, {
      status: novoStatus,
      pago_em: pagoEm,
      gateway,
      gateway_transacao_id: evento.transacaoId,
    });

    /* ---- 5. Parcela ---- */
    const parcela = parcelas.find((p) => p.pagamento_id === alvo.id);
    if (parcela) {
      await porta.atualizarParcela(parcela.id, {
        status: novoStatus,
        pago_em: pagoEm,
        gateway,
        gateway_transacao_id: evento.transacaoId,
      });
    }

    /* ---- 6. Venda, recalculada a partir das parcelas ---- */
    const parcelasAtualizadas = parcelas.map((p) =>
      p.id === parcela?.id ? { ...p, status: novoStatus, pago_em: pagoEm } : p,
    );
    const statusVenda = statusDaVenda(parcelasAtualizadas, venda.status);

    if (statusVenda !== venda.status || venda.gateway !== gateway) {
      await porta.atualizarVenda(venda.id, {
        status: statusVenda,
        gateway,
        gateway_transacao_id: evento.transacaoId,
      });
    }

    await porta.concluirEvento(registro.id, {
      status: 'processado',
      venda_id: venda.id,
      pagamento_id: alvo.id,
      processado_em: agora,
    });

    /* ---- 7. Notificação ---- */
    const modelo = NOTIFICACAO_POR_EVENTO[evento.tipo];
    if (modelo) {
      await porta.criarNotificacao({
        tipo: modelo.tipo,
        severidade: modelo.severidade,
        titulo: modelo.titulo,
        descricao: `${venda.codigo} · ${formatarValor(evento.valor ?? alvo.valor)}${
          parcela ? ` · parcela ${parcela.numero}/${parcela.total_parcelas}` : ''
        }`,
        lida: false,
        link: '/pagamentos',
        criado_em: agora,
      });
    }

    return {
      status: 'processado',
      mensagem: `Venda ${venda.codigo}: pagamento marcado como “${novoStatus}”. Situação da venda agora é “${statusVenda}”.`,
      vendaId: venda.id,
      pagamentoId: alvo.id,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Falha ao processar o evento.';
    await porta.concluirEvento(registro.id, {
      status: 'erro',
      erro: mensagem,
      processado_em: new Date().toISOString(),
    });
    return { status: 'erro', mensagem };
  }
}

function formatarValor(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
}

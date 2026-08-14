/**
 * POST /api/webhooks/asaas — recebe os eventos de cobrança do Asaas.
 *
 * ESTE É O ÚNICO CAMINHO pelo qual um pagamento vira "pago" sozinho no painel.
 * Por isso ele é conservador em tudo: valida o token, grava o evento antes de
 * agir, recusa evento repetido, e nunca aceita o status que o gateway sugere
 * para a venda — o status da venda é recalculado a partir das parcelas.
 *
 * SOBRE O CÓDIGO DE RESPOSTA. O Asaas reenvia quando não recebe 2xx e, depois
 * de muitas falhas, desativa a fila de webhooks do projeto. Então:
 *   200 — processado, ignorado (duplicado) ou evento que não nos interessa
 *   401 — token inválido (não é para reenviar; está errado na configuração)
 *   503 — banco fora do ar (é para reenviar mais tarde)
 * Erro de processamento devolve 200 com o evento marcado como `erro` no banco:
 * ficar reenviando um evento que sempre falha só derruba a fila.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin, supabaseConfigurado } from '../_lib/supabase.js';
import { reaisParaCentavos } from '../_lib/asaas.js';
import {
  classificarEventoAsaas,
  efeitoNoPagamento,
  formatarBRL,
  notificacaoDoEvento,
  statusDaVenda,
  type StatusPagamentoInterno,
  type StatusVendaInterno,
} from '../../shared/regras-pagamento.js';

/* --------------------------------------------------------------------------
   Segurança
   -------------------------------------------------------------------------- */

/**
 * Comparação em tempo constante.
 *
 * `a === b` vaza informação pelo tempo de resposta: quanto mais caracteres
 * iniciais acertados, mais demora para falhar. Com paciência dá para descobrir
 * o token caractere a caractere.
 */
function tokensIguais(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* --------------------------------------------------------------------------
   Corpo do evento
   -------------------------------------------------------------------------- */

interface PagamentoEvento {
  id: string;
  customer?: string;
  value?: number;
  netValue?: number;
  billingType?: string;
  status?: string;
  dueDate?: string;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  externalReference?: string | null;
  installment?: string | null;
}

interface CorpoWebhook {
  id?: string;
  event?: string;
  dateCreated?: string;
  payment?: PagamentoEvento;
}

/** O que precisamos da venda para decidir o efeito do evento. */
interface VendaMinima {
  id: string;
  codigo: string;
  status: StatusVendaInterno;
}

function lerCorpo(req: VercelRequest): CorpoWebhook {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as CorpoWebhook;
    } catch {
      return {};
    }
  }
  return (req.body ?? {}) as CorpoWebhook;
}

/* --------------------------------------------------------------------------
   Handler
   -------------------------------------------------------------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido' });
  }

  /* ---- 1. Token ---- */
  const esperado = (process.env.ASAAS_WEBHOOK_TOKEN ?? '').trim();
  if (!esperado) {
    // Falha fechado. Sem token configurado, este endpoint seria público e
    // qualquer um poderia marcar vendas como pagas.
    console.error('[webhook asaas] ASAAS_WEBHOOK_TOKEN não configurado — evento recusado.');
    return res.status(401).json({ ok: false, erro: 'Webhook não configurado.' });
  }

  const recebido = String(req.headers['asaas-access-token'] ?? '');
  if (!recebido || !tokensIguais(recebido, esperado)) {
    console.error('[webhook asaas] token inválido; evento descartado.');
    return res.status(401).json({ ok: false, erro: 'Token inválido.' });
  }

  /* ---- 2. Conteúdo ---- */
  const corpo = lerCorpo(req);
  const eventoId = (corpo.id ?? '').trim();
  const nomeEvento = (corpo.event ?? '').trim();
  const pagamento = corpo.payment;

  if (!eventoId || !nomeEvento) {
    return res.status(400).json({ ok: false, erro: 'Evento sem id ou sem tipo.' });
  }

  const classificacao = classificarEventoAsaas(nomeEvento);

  /* ---- 3. Banco ---- */
  if (!supabaseConfigurado()) {
    console.error('[webhook asaas] Supabase não configurado; peça reenvio.');
    return res.status(503).json({ ok: false, erro: 'Banco indisponível. Reenvie mais tarde.' });
  }
  const sb = getSupabaseAdmin();

  /* ---- 4. Registro + idempotência ----
     O INSERT é a trava. A constraint UNIQUE em evento_externo_id é o que
     realmente impede processar duas vezes: duas entregas simultâneas do mesmo
     evento não conseguem passar as duas por aqui. */
  const { data: registro, error: erroInsert } = await sb
    .from('webhook_events')
    .insert({
      evento_externo_id: eventoId,
      gateway: 'asaas',
      tipo: classificacao.tipo ?? 'pagamento.criado',
      status: 'recebido',
      transacao_id: pagamento?.id ?? null,
      payload: corpo as unknown as Record<string, unknown>,
      recebido_em: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (erroInsert) {
    // 23505 = unique_violation. Já processamos este evento antes.
    if (erroInsert.code === '23505') {
      return res.status(200).json({ ok: true, status: 'ignorado', motivo: 'evento já processado' });
    }
    console.error('[webhook asaas] falha ao registrar evento:', erroInsert.message);
    return res.status(503).json({ ok: false, erro: 'Não foi possível registrar o evento.' });
  }

  const registroId = registro.id as string;

  const concluir = async (dados: Record<string, unknown>) => {
    await sb
      .from('webhook_events')
      .update({ ...dados, processado_em: new Date().toISOString() })
      .eq('id', registroId);
  };

  try {
    /* ---- 5. Eventos que não mexem em estado ---- */
    if (classificacao.desconhecido) {
      console.warn(`[webhook asaas] evento desconhecido "${nomeEvento}" — registrado e ignorado.`);
      await concluir({ status: 'ignorado', erro: `Evento não mapeado: ${nomeEvento}` });
      return res.status(200).json({ ok: true, status: 'ignorado', motivo: 'evento não mapeado' });
    }

    if (classificacao.tipo === null) {
      await concluir({ status: 'ignorado' });
      return res.status(200).json({ ok: true, status: 'ignorado', motivo: 'evento informativo' });
    }

    if (!pagamento?.id) {
      await concluir({ status: 'erro', erro: 'Evento sem objeto de pagamento.' });
      return res.status(200).json({ ok: true, status: 'erro', motivo: 'sem pagamento no corpo' });
    }

    /* ---- 6. Localizar a venda ----
       externalReference carrega o id da venda; foi gravado na criação da
       cobrança. O id da transação é o caminho alternativo. */
    const referencia = (pagamento.externalReference ?? '').trim();

    let venda: VendaMinima | null = null;

    if (referencia) {
      const { data } = await sb
        .from('sales')
        .select('id, codigo, status')
        .eq('id', referencia)
        .maybeSingle();
      venda = (data as VendaMinima | null) ?? null;
    }

    if (!venda) {
      const { data } = await sb
        .from('sales')
        .select('id, codigo, status')
        .eq('gateway_transacao_id', pagamento.id)
        .maybeSingle();
      venda = (data as VendaMinima | null) ?? null;
    }

    if (!venda) {
      const msg = `Nenhuma venda para a referência "${referencia || '—'}" / transação "${pagamento.id}".`;
      console.error(`[webhook asaas] ${msg}`);
      await concluir({ status: 'erro', erro: msg });
      return res.status(200).json({ ok: true, status: 'erro', motivo: msg });
    }

    const novoStatus = efeitoNoPagamento(classificacao.tipo);
    if (novoStatus === null) {
      await concluir({ status: 'processado', venda_id: venda.id });
      return res.status(200).json({ ok: true, status: 'processado', motivo: 'sem efeito de estado' });
    }

    /* ---- 7. Escolher a parcela atingida ----
       Preferência: a que já carrega este id de transação. Sem ela, a mais
       antiga ainda em aberto — que é a que o cliente está quitando. */
    const { data: parcelasBrutas } = await sb
      .from('installments')
      .select('id, numero, total_parcelas, valor, vencimento, status, pagamento_id, gateway_transacao_id')
      .eq('venda_id', venda.id)
      .order('numero', { ascending: true });

    const parcelas = (parcelasBrutas ?? []) as {
      id: string;
      numero: number;
      total_parcelas: number;
      valor: number;
      vencimento: string;
      status: StatusPagamentoInterno;
      pagamento_id: string | null;
      gateway_transacao_id: string | null;
    }[];

    const alvo =
      parcelas.find((p) => p.gateway_transacao_id === pagamento.id) ??
      parcelas.find((p) => p.status === 'pendente' || p.status === 'atrasado');

    if (!alvo) {
      const msg = `A venda ${venda.codigo} não tem parcela em aberto para este evento.`;
      await concluir({ status: 'erro', venda_id: venda.id, erro: msg });
      return res.status(200).json({ ok: true, status: 'erro', motivo: msg });
    }

    const quandoPagou =
      pagamento.paymentDate ?? pagamento.confirmedDate ?? pagamento.clientPaymentDate ?? null;
    const pagoEm = novoStatus === 'pago' ? (quandoPagou ?? new Date().toISOString()) : null;

    /* ---- 8. Atualizar pagamento, parcela e venda ---- */
    if (alvo.pagamento_id) {
      await sb
        .from('payments')
        .update({
          status: novoStatus,
          pago_em: pagoEm,
          gateway: 'asaas',
          gateway_transacao_id: pagamento.id,
        })
        .eq('id', alvo.pagamento_id);
    }

    await sb
      .from('installments')
      .update({
        status: novoStatus,
        pago_em: pagoEm,
        gateway: 'asaas',
        gateway_transacao_id: pagamento.id,
      })
      .eq('id', alvo.id);

    const projetadas = parcelas.map((p) => (p.id === alvo.id ? { status: novoStatus } : { status: p.status }));
    const statusVenda = statusDaVenda(projetadas, venda.status);

    if (statusVenda !== venda.status) {
      await sb
        .from('sales')
        .update({ status: statusVenda, gateway: 'asaas', gateway_transacao_id: pagamento.id })
        .eq('id', venda.id);
    }

    /* ---- 9. Notificação ---- */
    const modelo = notificacaoDoEvento(classificacao.tipo);
    if (modelo) {
      const centavos = pagamento.value ? reaisParaCentavos(pagamento.value) : alvo.valor;
      await sb.from('notifications').insert({
        tipo: modelo.tipo,
        severidade: modelo.severidade,
        titulo: modelo.titulo,
        descricao: `${venda.codigo} · ${formatarBRL(centavos)} · parcela ${alvo.numero}/${alvo.total_parcelas}`,
        lida: false,
        link: '/pagamentos',
      });
    }

    await concluir({ status: 'processado', venda_id: venda.id, pagamento_id: alvo.pagamento_id });

    return res.status(200).json({
      ok: true,
      status: 'processado',
      venda: venda.codigo,
      parcela: `${alvo.numero}/${alvo.total_parcelas}`,
      pagamento: novoStatus,
      venda_status: statusVenda,
    });
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : 'Falha ao processar o evento.';
    console.error('[webhook asaas] erro no processamento:', msg);
    await concluir({ status: 'erro', erro: msg }).catch(() => undefined);
    // 200 de propósito: ver o comentário no topo sobre a fila do Asaas.
    return res.status(200).json({ ok: false, status: 'erro', erro: msg });
  }
}

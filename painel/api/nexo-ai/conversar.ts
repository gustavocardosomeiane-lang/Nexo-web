/**
 * NEXO AI — endpoint de conversa.
 *
 *   POST /api/nexo-ai/conversar   { conversa_id?, mensagem }
 *
 * ===========================================================================
 * O CAMINHO COMPLETO, numa requisição:
 *
 *   1. AUTENTICA  — valida o JWT, descobre quem é e monta um cliente com RLS.
 *   2. CONTEXTO   — persona + empresa + usuário + memórias relevantes +
 *                   histórico recortado, tudo sob orçamento de tokens.
 *   3. MODELO     — uma chamada. O modelo responde ou pede ferramenta.
 *   4. FERRAMENTA — se pediu, executa (leitura com a RLS do usuário) e devolve
 *                   ao modelo para concluir. NO MÁXIMO uma rodada de
 *                   ferramentas — sem loop, sem custo aberto.
 *   5. PERSISTE   — grava as duas mensagens na sessão.
 *
 * SEGURANÇA: nenhuma consulta usa service_role. A IA só vê o que o usuário vê.
 * ESCOPO FASE 1: leitura + memória. Nada escreve em tabela de negócio, nada
 * envia mensagem.
 * ===========================================================================
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { autenticar, responderNaoAutenticado, NaoAutenticado } from '../_lib/auth.js';
import { provedorAtivo, ErroModelo, type MensagemModelo } from '../_lib/nexo-ai/modelo.js';
import {
  definicoesDe,
  executarFerramenta,
  FERRAMENTAS_DADOS,
} from '../_lib/nexo-ai/ferramentas.js';
import { montarSistema } from '../_lib/nexo-ai/persona.js';
import {
  ferramentasPermitidas,
  recortarHistorico,
  selecionarMemorias,
  redigirSegredos,
  type Memoria,
  type MensagemChat,
} from '../../shared/regras-nexo-ai.js';
import { podePorPapel } from '../_lib/nexo-ai/permissao.js';

const LIMITE_MENSAGEM = 4000;

interface Entrada {
  conversa_id?: string;
  mensagem?: string;
}

function lerCorpo(req: VercelRequest): Entrada {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Entrada;
    } catch {
      return {};
    }
  }
  return (req.body ?? {}) as Entrada;
}

function detectarFerramentas(mensagem: string, permitidas: string[]): string[] {
  const t = mensagem
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ');

  const regras: Record<string, RegExp> = {
    consultar_leads: /\b(leads?|prospects?|qualificados?|funil)\b/,
    consultar_clientes: /\b(clientes?|carteira|customer)\b/,
    consultar_vendas: /\b(vendas?|vendemos|fechamentos?|contratos?|faturamento)\b/,
    consultar_pagamentos: /\b(pagamentos?|recebemos|recebido|receita|recebimento)\b/,
    consultar_projetos: /\b(projetos?|entregas?|em andamento)\b/,
    consultar_campanhas: /\b(campanhas?|prospeccao|prospecção)\b/,
    consultar_conversas: /\b(conversas?|atendimentos?)\b/,
    consultar_metricas: /\b(metricas?|métricas|resumo|como estamos|visao geral|visão geral|indicadores)\b/,
  };

  const encontradas = Object.entries(regras)
    .filter(([nome, regex]) => permitidas.includes(nome) && regex.test(t))
    .map(([nome]) => nome);

  // Uma pergunta de visão geral pede o agregado completo; nesse caso não
  // precisamos disparar as outras consultas também.
  if (encontradas.includes('consultar_metricas')) return ['consultar_metricas'];
  return encontradas;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  let usuario;
  try {
    usuario = await autenticar(req);
  } catch (e) {
    return responderNaoAutenticado(res, e);
  }

  const modelo = provedorAtivo();
  if (!modelo.configurado) {
    return res.status(503).json({
      ok: false,
      erro: 'NEXO AI ainda não configurada: falta NEXO_AI_API_KEY no servidor.',
      codigo: 'sem_credencial',
    });
  }

  const entrada = lerCorpo(req);
  const mensagem = redigirSegredos(String(entrada.mensagem ?? '').trim()).slice(0, LIMITE_MENSAGEM);
  if (!mensagem) {
    return res.status(400).json({ ok: false, erro: 'Mensagem vazia.', codigo: 'mensagem_vazia' });
  }

  const { db, id: usuarioId } = usuario;

  try {
    /* ---- Sessão ---- */
    const conversaId = await garantirConversa(db, usuarioId, entrada.conversa_id);

    /* ---- Contexto ---- */
    const [historico, memorias, empresa] = await Promise.all([
      carregarHistorico(db, conversaId),
      carregarMemorias(db, usuarioId),
      carregarContextoEmpresa(db),
    ]);

    const sistema = montarSistema({
      usuario: { nome: usuario.nome, papel: usuario.papel, email: usuario.email },
      empresa,
      memorias: selecionarMemorias(memorias, mensagem),
    });

    const mensagens: MensagemModelo[] = [
      ...recortarHistorico(historico).map((m) => ({ papel: m.papel, conteudo: m.conteudo })),
      { papel: 'user', conteudo: mensagem },
    ];

    /* ---- Dados reais: pré-consulta determinística, sem segunda chamada ao modelo ---- */
    const permitidas = ferramentasPermitidas(FERRAMENTAS_DADOS, (mod) =>
      podePorPapel(usuario.papel, mod),
    );
    const necessarias = detectarFerramentas(mensagem, permitidas);
    let sistemaComDados = sistema;

    if (necessarias.length > 0) {
      const resultados = await Promise.all(
        necessarias.map(async (nome) => ({
          nome,
          conteudo: await executarFerramenta(nome, {}, { db, usuarioId }, permitidas),
        })),
      );
      const contextoDados = resultados
        .map((r) => `DADO REAL — ${r.nome}: ${r.conteudo}`)
        .join('\n');
      sistemaComDados = `${sistema}\n\n---\n\n${contextoDados}\nUse somente esses dados reais para responder à pergunta. Não invente números.`;
    }

    /* ---- Exatamente uma chamada ao modelo por mensagem do usuário ---- */
    const resposta = await modelo.conversar({
      sistema: sistemaComDados,
      mensagens,
      maxTokensSaida: 1024,
    });

    const texto = resposta.texto || 'Não consegui formular uma resposta agora.';

    /* ---- Persiste ---- */
    await salvarTurno(db, conversaId, mensagem, texto);

    return res.status(200).json({
      ok: true,
      conversa_id: conversaId,
      resposta: texto,
      tokens: resposta.tokens,
    });
  } catch (e) {
    if (e instanceof NaoAutenticado) return responderNaoAutenticado(res, e);

    const msg = e instanceof Error ? e.message : String(e);
    console.error('[nexo-ai] erro:', msg);

    if (e instanceof ErroModelo) {
      const billingKeywords = ['credit balance', 'billing', 'payment required', 'quota'];
      const isBilling = billingKeywords.some((k) => msg.toLowerCase().includes(k));
      if (isBilling) {
        return res.status(502).json({
          ok: false,
          erro: 'A NEXO AI está temporariamente indisponível por uma questão de configuração do servidor. Avise o administrador.',
          codigo: 'modelo_billing',
        });
      }
      return res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({
        ok: false,
        erro: 'O modelo de IA não conseguiu responder. Tente novamente em instantes.',
        codigo: e.codigo ?? 'modelo_erro',
      });
    }

    return res.status(500).json({ ok: false, erro: 'Falha ao conversar com a NEXO AI.' });
  }
}

/* --------------------------------------------------------------------------
   Acesso ao banco — sempre com o cliente do usuário (RLS)
   -------------------------------------------------------------------------- */

async function garantirConversa(
  db: import('@supabase/supabase-js').SupabaseClient,
  usuarioId: string,
  conversaId?: string,
): Promise<string> {
  if (conversaId) {
    const { data } = await db
      .from('ai_conversations')
      .select('id')
      .eq('id', conversaId)
      .maybeSingle();
    if (data) return String((data as { id: string }).id);
  }
  const { data, error } = await db
    .from('ai_conversations')
    .insert({ usuario_id: usuarioId, titulo: 'Nova conversa' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

async function carregarHistorico(
  db: import('@supabase/supabase-js').SupabaseClient,
  conversaId: string,
): Promise<MensagemChat[]> {
  const { data } = await db
    .from('ai_messages')
    .select('papel, conteudo, criado_em')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: true })
    .limit(40);
  return (data ?? []) as MensagemChat[];
}

async function carregarMemorias(
  db: import('@supabase/supabase-js').SupabaseClient,
  usuarioId: string,
): Promise<Memoria[]> {
  const { data } = await db
    .from('ai_memories')
    .select('id, tipo, conteudo, chaves, relevancia, usuario_id')
    .or(`usuario_id.eq.${usuarioId},usuario_id.is.null`)
    .limit(200);
  return (data ?? []) as Memoria[];
}

async function carregarContextoEmpresa(
  db: import('@supabase/supabase-js').SupabaseClient,
): Promise<string | null> {
  const { data } = await db.from('settings').select('valor').eq('chave', 'nexo_ai_contexto').maybeSingle();
  const valor = (data as { valor?: { texto?: string } } | null)?.valor;
  return valor?.texto ?? null;
}

async function salvarTurno(
  db: import('@supabase/supabase-js').SupabaseClient,
  conversaId: string,
  pergunta: string,
  resposta: string,
): Promise<void> {
  await db.from('ai_messages').insert([
    { conversa_id: conversaId, papel: 'user', conteudo: pergunta },
    { conversa_id: conversaId, papel: 'assistant', conteudo: resposta },
  ]);
  await db.from('ai_conversations').update({ atualizado_em: new Date().toISOString() }).eq('id', conversaId);
}

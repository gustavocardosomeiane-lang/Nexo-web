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
 *   3. DADOS      — quando a mensagem pede dados, consulta apenas as
 *                   ferramentas necessárias com a RLS do usuário.
 *   4. MODELO     — exatamente uma chamada, recebendo os dados reais como
 *                   contexto quando necessário.
 *   5. PERSISTE  — grava as duas mensagens na sessão.
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
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), ' ');

  const termos: Record<string, string[]> = {
    consultar_leads: ['lead', 'leads', 'prospect', 'prospects', 'qualificado', 'qualificados', 'funil'],
    consultar_clientes: ['cliente', 'clientes', 'carteira', 'customer'],
    consultar_vendas: ['venda', 'vendas', 'vendemos', 'fechamento', 'fechamentos', 'contrato', 'contratos', 'faturamento'],
    consultar_pagamentos: ['pagamento', 'pagamentos', 'recebemos', 'recebido', 'receita', 'recebimento'],
    consultar_projetos: ['projeto', 'projetos', 'entrega', 'entregas', 'em andamento'],
    consultar_campanhas: ['campanha', 'campanhas', 'prospeccao'],
    consultar_conversas: ['conversa', 'conversas', 'atendimento', 'atendimentos'],
    consultar_metricas: ['metrica', 'metricas', 'resumo', 'como estamos', 'visao geral', 'indicador', 'indicadores'],
  };

  const encontradas = Object.entries(termos)
    .filter(([nome, palavras]) =>
      permitidas.includes(nome) &&
      palavras.some((palavra) => t.includes(palavra)),
    )
    .map(([nome]) => nome);

  // Uma pergunta de visão geral pede somente o agregado.
  if (encontradas.includes('consultar_metricas')) return ['consultar_metricas'];

  return encontradas;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  const tInicio = Date.now();
  let usuario;
  try {
    usuario = await autenticar(req);
  } catch (e) {
    return responderNaoAutenticado(res, e);
  }
  console.log('[NEXO LATENCIA] auth', Date.now() - tInicio, 'ms');

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
    const tConversa = Date.now();
    const conversaId = await garantirConversa(db, usuarioId, entrada.conversa_id);
    console.log('[NEXO LATENCIA] garantirConversa', Date.now() - tConversa, 'ms');

    /* ---- Dados reais: quais ferramentas esta mensagem pede.
       Não depende de historico/memorias/empresa — só de `mensagem` e do papel
       (já conhecido pela autenticação) — então pode ser calculado e disparado
       em paralelo com o resto do contexto, em vez de numa segunda onda depois. ---- */
    const permitidas = ferramentasPermitidas(FERRAMENTAS_DADOS, (mod) =>
      podePorPapel(usuario.papel, mod),
    );
    const necessarias = detectarFerramentas(mensagem, permitidas);

    /* ---- Contexto + ferramentas: tudo que não depende de resultado anterior, em paralelo ---- */
    const tContexto = Date.now();
    const tFerramentas = Date.now();
    const promessaFerramentas = (
      necessarias.length > 0
        ? Promise.all(
            necessarias.map(async (nome) => ({
              nome,
              conteudo: await executarFerramenta(nome, {}, { db, usuarioId }, permitidas),
            })),
          )
        : Promise.resolve([])
    ).then((r) => {
      console.log('[NEXO LATENCIA] ferramentas', Date.now() - tFerramentas, 'ms');
      return r;
    });

    const [historico, memorias, empresa, resultadosFerramentas] = await Promise.all([
      carregarHistorico(db, conversaId),
      carregarMemorias(db, usuarioId),
      carregarContextoEmpresa(db),
      promessaFerramentas,
    ]);
    console.log('[NEXO LATENCIA] contexto', Date.now() - tContexto, 'ms');

    const sistema = montarSistema({
      usuario: { nome: usuario.nome, papel: usuario.papel, email: usuario.email },
      empresa,
      memorias: selecionarMemorias(memorias, mensagem),
    });

    const mensagens: MensagemModelo[] = [
      ...recortarHistorico(historico).map((m) => ({ papel: m.papel, conteudo: m.conteudo })),
      { papel: 'user', conteudo: mensagem },
    ];

    let sistemaComDados = sistema;
    if (resultadosFerramentas.length > 0) {
      const contextoDados = resultadosFerramentas
        .map((r) => `DADO REAL — ${r.nome}: ${r.conteudo}`)
        .join('\n');
      sistemaComDados = `${sistema}\n\n---\n\n${contextoDados}\nUse somente esses dados reais para responder à pergunta. Não invente números.`;
    }

    /* ---- Exatamente uma chamada ao modelo por mensagem do usuário ---- */
    const tModelo = Date.now();
    const resposta = await modelo.conversar({
      sistema: sistemaComDados,
      mensagens,
      maxTokensSaida: 512,
    });
    console.log('[NEXO LATENCIA] modelo', Date.now() - tModelo, 'ms');

    const texto = resposta.texto || 'Não consegui formular uma resposta agora.';

    /* ---- Persiste ---- */
    const tPersiste = Date.now();
    await salvarTurno(db, conversaId, mensagem, texto);
    console.log('[NEXO LATENCIA] persistencia', Date.now() - tPersiste, 'ms');
    console.log('[NEXO LATENCIA] total /conversar', Date.now() - tInicio, 'ms');

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
  // As duas escritas não dependem uma da outra — tabelas diferentes, nenhuma
  // lê o resultado da outra — então rodam em paralelo. Ambas ainda são
  // aguardadas antes de responder ao cliente; só a ordem de execução muda.
  await Promise.all([
    db.from('ai_messages').insert([
      { conversa_id: conversaId, papel: 'user', conteudo: pergunta },
      { conversa_id: conversaId, papel: 'assistant', conteudo: resposta },
    ]),
    db.from('ai_conversations').update({ atualizado_em: new Date().toISOString() }).eq('id', conversaId),
  ]);
}

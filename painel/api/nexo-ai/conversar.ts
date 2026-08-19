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
import { provedorAtivo, groqStream, ErroModelo, type MensagemModelo, type RespostaModelo } from '../_lib/nexo-ai/modelo.js';
import {
  definicoesDe,
  executarFerramenta,
  FERRAMENTAS_DADOS,
  pareceComandoDeProspeccao,
  extrairParametrosBusca,
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

/* --------------------------------------------------------------------------
   Streaming SSE — contrato consumido por src/nexo-ai/cliente.ts

   Cada frame é uma linha `data: <json>\n\n`. Não usamos a lib EventSource do
   navegador (só GET, sem Authorization/body); o cliente lê response.body na
   mão, então o formato aqui só precisa ser consistente com o parser de lá.
   -------------------------------------------------------------------------- */
type FrameStream =
  | { tipo: 'inicio'; conversaId: string }
  | { tipo: 'chunk'; texto: string }
  | { tipo: 'fim'; conversaId: string; tokens: { entrada: number; saida: number } }
  | { tipo: 'erro'; erro: string; codigo?: string };

function enviarFrame(res: VercelResponse, frame: FrameStream): void {
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
}

const MENSAGEM_INDISPONIVEL = 'A NEXO está temporariamente indisponível. Tente novamente em alguns instantes.';

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
      erro: 'NEXO AI ainda não configurada: falta GROQ_API_KEY no servidor.',
      codigo: 'sem_credencial',
    });
  }

  const entrada = lerCorpo(req);
  const mensagem = redigirSegredos(String(entrada.mensagem ?? '').trim()).slice(0, LIMITE_MENSAGEM);
  if (!mensagem) {
    return res.status(400).json({ ok: false, erro: 'Mensagem vazia.', codigo: 'mensagem_vazia' });
  }

  const { db, id: usuarioId } = usuario;
  let streamIniciado = false;

  try {
    /* ---- Sessão ---- */
    const tConversa = Date.now();
    const conversaId = await garantirConversa(db, usuarioId, entrada.conversa_id);
    console.log('[NEXO LATENCIA] garantirConversa', Date.now() - tConversa, 'ms');

    const permitidas = ferramentasPermitidas(FERRAMENTAS_DADOS, (mod) =>
      podePorPapel(usuario.papel, mod),
    );

    /* ---- Contexto + ferramentas: tudo que não depende de resultado anterior, em paralelo ---- */
    const tContexto = Date.now();
    const tFerramentas = Date.now();
    const ctxFerramenta = { db, usuarioId, papel: usuario.papel };

    /* ---- Classificação da mensagem: prospecção (descobrir negócio NOVO,
       fora do CRM) ou leitura (consultar o que já existe no CRM).

       As DUAS coisas abaixo (`detectarFerramentas` e `pareceComandoDeProspeccao`)
       disputam o MESMO vocabulário — "3 leads novos" e "quantos leads eu
       tenho" compartilham a palavra "leads". Sem uma classificação única
       decidindo primeiro, as duas rodavam em paralelo e o agregado "você já
       tem 269 leads" entrava como DADO REAL ao lado da prospecção,
       confundindo a resposta. A classificação também PRECISA do histórico —
       uma resposta em formato de formulário ("Nicho: ... / Localização: ...
       / Quantidade: ...") não tem verbo nenhum; só é reconhecida como
       continuação de prospecção se o turno anterior já estava nesse fluxo.
       Por isso a classificação encadeia em `promessaHistorico` em vez de
       rodar solta. ---- */
    const promessaHistorico = carregarHistorico(db, conversaId);
    const podeProspectar = permitidas.includes('buscar_leads_locais');

    const promessaClassificacao = promessaHistorico.then((historicoCarregado) => {
      const historicoRecortado = recortarHistorico(historicoCarregado).map((m) => ({
        papel: m.papel,
        conteudo: m.conteudo,
      }));
      const ehProspeccao = podeProspectar && pareceComandoDeProspeccao(mensagem, historicoRecortado);
      return { ehProspeccao, historicoRecortado };
    });

    const promessaFerramentas = promessaClassificacao.then(async ({ ehProspeccao }) => {
      // Prospecção tem prioridade: quando a mensagem é sobre descobrir
      // negócio novo, nenhuma ferramenta de leitura do CRM roda para ela —
      // evita a resposta competir com o agregado de leads já existentes.
      const necessarias = ehProspeccao ? [] : detectarFerramentas(mensagem, permitidas);
      if (necessarias.length === 0) return [];
      const resultados = await Promise.all(
        necessarias.map(async (nome) => ({
          nome,
          conteudo: await executarFerramenta(nome, {}, ctxFerramenta, permitidas),
        })),
      );
      console.log('[NEXO LATENCIA] ferramentas', Date.now() - tFerramentas, 'ms');
      return resultados;
    });

    /* ---- Prospecção automática (Etapa 4).
       Os PARÂMETROS (nicho/cidade/quantidade) exigem uma extração pelo
       modelo — a ÚNICA coisa que ele decide aqui. Busca, análise, score,
       dedup e importação são código determinístico
       (executarBuscaEImportacao, em ferramentas.ts) — o resultado real
       entra como "DADO REAL" abaixo, igual a qualquer outra ferramenta. ---- */
    const promessaProspeccao = promessaClassificacao.then(async ({ ehProspeccao, historicoRecortado }) => {
      if (!ehProspeccao) return null;
      const parametros = await extrairParametrosBusca(mensagem, historicoRecortado, modelo);
      // `null` = o modelo não chamou a ferramenta (faltou nicho/cidade em
      // TODA a conversa, ou a extração falhou). Sem "DADO REAL" pra este
      // turno; a persona já instrui a NEXO a pedir o que falta em vez de
      // adivinhar.
      if (!parametros) return null;
      const conteudo = await executarFerramenta('buscar_leads_locais', parametros, ctxFerramenta, permitidas);
      return { nome: 'buscar_leads_locais', conteudo };
    });

    const [historico, memorias, empresa, resultadosFerramentas, resultadoProspeccao] = await Promise.all([
      promessaHistorico,
      carregarMemorias(db, usuarioId),
      carregarContextoEmpresa(db),
      promessaFerramentas,
      promessaProspeccao,
    ]);
    console.log('[NEXO LATENCIA] contexto', Date.now() - tContexto, 'ms');

    const todosResultados = resultadoProspeccao
      ? [...resultadosFerramentas, resultadoProspeccao]
      : resultadosFerramentas;

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
    if (todosResultados.length > 0) {
      const contextoDados = todosResultados
        .map((r) => `DADO REAL — ${r.nome}: ${r.conteudo}`)
        .join('\n');
      sistemaComDados = `${sistema}\n\n---\n\n${contextoDados}\nUse somente esses dados reais para responder à pergunta. Não invente números.`;
    }

    /* ---- Exatamente uma chamada ao modelo por mensagem do usuário, em
       streaming. Groq (openai/gpt-oss-20b) é o único provedor de texto —
       ver modelo.ts. Cabeçalhos SSE só são escritos aqui, depois que auth,
       sessão e contexto já resolveram sem erro — se algo acima falhar, o
       cliente ainda recebe um JSON de erro normal (ver catch). ---- */
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Evita que um proxy intermediário acumule os chunks antes de entregar.
      'X-Accel-Buffering': 'no',
    });
    streamIniciado = true;
    enviarFrame(res, { tipo: 'inicio', conversaId });

    const tModelo = Date.now();
    let tPrimeiroChunk: number | null = null;
    let textoAcumulado = '';
    let resultado: RespostaModelo | undefined;

    const gerador = groqStream({ sistema: sistemaComDados, mensagens, maxTokensSaida: 512, etapa: 'resposta_final' });
    while (true) {
      const passo = await gerador.next();
      if (passo.done) {
        resultado = passo.value;
        break;
      }
      if (tPrimeiroChunk === null) {
        tPrimeiroChunk = Date.now();
        console.log('[NEXO LATENCIA] primeiro_chunk_modelo', tPrimeiroChunk - tModelo, 'ms');
        console.log('[NEXO LATENCIA] primeiro_chunk_cliente', tPrimeiroChunk - tInicio, 'ms');
      }
      textoAcumulado += passo.value;
      enviarFrame(res, { tipo: 'chunk', texto: passo.value });
    }
    console.log('[NEXO LATENCIA] modelo_total', Date.now() - tModelo, 'ms');

    const texto = (resultado?.texto || textoAcumulado).trim() || 'Não consegui formular uma resposta agora.';

    /* ---- Persiste: depois dos chunks visuais (o usuário já viu a resposta
       inteira), mas ANTES de fechar a resposta — a consistência do turno não
       fica pendurada num "fire and forget" que a Vercel Node não garante. ---- */
    const tPersiste = Date.now();
    await salvarTurno(db, conversaId, mensagem, texto);
    console.log('[NEXO LATENCIA] persistencia', Date.now() - tPersiste, 'ms');
    console.log('[NEXO LATENCIA] total /conversar', Date.now() - tInicio, 'ms');

    enviarFrame(res, {
      tipo: 'fim',
      conversaId,
      tokens: resultado?.tokens ?? { entrada: 0, saida: 0 },
    });
    res.end();
  } catch (e) {
    if (!streamIniciado) {
      if (e instanceof NaoAutenticado) return responderNaoAutenticado(res, e);

      const msg = e instanceof Error ? e.message : String(e);
      console.error('[nexo-ai] erro:', msg);

      if (e instanceof ErroModelo) {
        // 'quota' saiu daqui: sem fallback, um 429 do Groq é limite transitório
        // ("tente de novo"), não problema de configuração do servidor.
        const billingKeywords = ['credit balance', 'billing', 'payment required'];
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
          erro: MENSAGEM_INDISPONIVEL,
          codigo: e.codigo ?? 'modelo_erro',
        });
      }

      return res.status(500).json({ ok: false, erro: 'Falha ao conversar com a NEXO AI.' });
    }

    // O stream já começou — os cabeçalhos HTTP já foram enviados, então não
    // dá mais para responder com um JSON de status de erro. O jeito é mandar
    // um frame `erro` pelo próprio stream e fechar a conexão; o cliente
    // (conversarStream em cliente.ts) trata isso como falha.
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[nexo-ai] erro (stream em andamento):', msg);
    try {
      enviarFrame(res, {
        tipo: 'erro',
        erro: MENSAGEM_INDISPONIVEL,
        codigo: e instanceof ErroModelo ? e.codigo : undefined,
      });
    } catch {
      // Conexão já pode ter caído do lado do cliente — nada a fazer.
    }
    res.end();
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

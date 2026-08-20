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
import {
  provedorAtivo,
  groqStream,
  ErroModelo,
  type MensagemModelo,
  type PedidoModelo,
  type RespostaModelo,
} from '../_lib/nexo-ai/modelo.js';
import {
  definicoesDe,
  executarFerramenta,
  FERRAMENTAS_DADOS,
  pareceComandoDeProspeccao,
  extrairParametrosBusca,
  extrairMemoria,
} from '../_lib/nexo-ai/ferramentas.js';
import { montarSistema } from '../_lib/nexo-ai/persona.js';
import {
  ferramentasPermitidas,
  recortarHistorico,
  selecionarMemorias,
  redigirSegredos,
  usuarioPediuArabe,
  proximoTrechoSeguro,
  liberarRestante,
  podeConterMemoria,
  type Memoria,
  type MensagemChat,
} from '../../shared/regras-nexo-ai.js';
import { podePorPapel } from '../_lib/nexo-ai/permissao.js';
import { registrarMemoria, atualizarUsoMemorias } from '../_lib/nexo-ai/memoria.js';
import { criarConversa } from '../_lib/nexo-ai/conversas.js';

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

/**
 * Resultado bruto de `buscar_leads_locais` — só os campos que o fallback
 * precisa ler (ver `executarBuscaEImportacao` em ferramentas.ts).
 */
interface ResultadoProspeccaoBruto {
  encontrados?: number;
  importados?: number;
  /** Presente quando a FERRAMENTA falhou (Google Places, Supabase, etc.) —
   * nesse caso não é "sucesso sem texto", é falha de verdade, e o fallback
   * não se aplica: cabe ao erro normal do Groq (ou ao "DADO REAL" de erro
   * já injetado no sistema) explicar o que houve. */
  erro?: string;
}

function palavraNoPlural(quantidade: number, singular: string, plural: string): string {
  return quantidade === 1 ? singular : plural;
}

/**
 * Resposta local, SEM nova chamada ao Groq e SEM reexecutar a ferramenta —
 * lê só o JSON que `buscar_leads_locais` já produziu nesta mesma
 * requisição. Existe para o caso em que a prospecção terminou com sucesso
 * (negócios buscados, leads importados) mas a etapa de texto final não
 * devolveu nada utilizável: o trabalho real já foi feito, então a resposta
 * não pode virar "temporariamente indisponível" por causa só da última
 * etapa, cosmética, de transformar o resultado em frase.
 *
 * `null` quando o conteúdo não é um JSON de sucesso reconhecível — nesses
 * casos quem chama deve deixar o erro original seguir seu caminho normal.
 */
export function respostaFallbackProspeccao(conteudoJson: string): string | null {
  let dados: ResultadoProspeccaoBruto;
  try {
    dados = JSON.parse(conteudoJson) as ResultadoProspeccaoBruto;
  } catch {
    return null;
  }
  if (typeof dados.erro === 'string') return null;

  const { encontrados, importados } = dados;
  if (typeof encontrados !== 'number' || typeof importados !== 'number') return null;

  const empresas = palavraNoPlural(encontrados, 'empresa', 'empresas');
  if (importados > 0) {
    const leads = palavraNoPlural(importados, 'novo lead', 'novos leads');
    const estavam = palavraNoPlural(importados, 'estava', 'estavam');
    return `Busca concluída. Encontrei ${encontrados} ${empresas} e importei ${importados} ${leads} que ainda não ${estavam} cadastrado${importados === 1 ? '' : 's'}.`;
  }
  return `Busca concluída. Analisei ${encontrados} ${empresas}, mas nenhuma nova passou pelos critérios ou todas já estavam cadastradas.`;
}

/* --------------------------------------------------------------------------
   Idioma da resposta — defesa contra o incidente de mistura com árabe

   `groqStream` já entrega SÓ `content` (nunca raciocínio — ver modelo.ts),
   mas o próprio `content` pode vir com árabe misturado: incidente real em
   produção com openai/gpt-oss-20b. A defesa é na SAÍDA da chamada, nunca na
   entrada — dado de lead/memória pode legitimamente ter caractere
   estrangeiro, então "limpar" o contexto não resolveria e ainda corromperia
   dado real.

   ESTRATÉGIA (streaming progressivo preservado): em vez de esperar a
   resposta inteira antes de mandar qualquer coisa, mantém-se uma pequena
   JANELA DE SEGURANÇA (`MARGEM_SEGURANCA_IDIOMA` caracteres) sempre retida
   no fim do texto ainda não confirmado — só o que já "sobrou pra trás" da
   margem é liberado ao cliente. Ver `proximoTrechoSeguro` em
   shared/regras-nexo-ai.ts para a prova de que isso garante que nada
   liberado pode conter árabe. Resultado prático: resposta normal em pt-BR
   continua chegando em streaming quase em tempo real (a margem é pequena);
   só quando árabe realmente aparece é que a entrega para.
   -------------------------------------------------------------------------- */

/** Reforço adicionado ao sistema SÓ na tentativa de regeneração — nunca na primeira chamada, para não pagar tokens à toa quando o idioma já sai certo (o caso comum). */
const REFORCO_PT_BR =
  '\n\n---\n\nATENÇÃO: a resposta anterior misturou caracteres de outro idioma (árabe) de forma indevida. Responda AGORA exclusivamente em português do Brasil, sem nenhum caractere árabe. Preserve nomes próprios, marcas e termos técnicos como estão.';

type ResultadoConsumoSeguro =
  | { status: 'completo'; resultado: RespostaModelo }
  /** Árabe apareceu, mas a margem segurou tudo — NADA chegou ao cliente ainda. Seguro regenerar do zero. */
  | { status: 'bloqueado_sem_envio' }
  /** Árabe apareceu DEPOIS de parte do texto já ter sido liberada. O que já foi liberado é garantidamente limpo (ver invariante em `proximoTrechoSeguro`), mas não dá pra continuar nem regenerar por cima sem risco de resposta incoerente. */
  | { status: 'bloqueado_parcial'; textoEnviado: string };

/**
 * Consome `groqStream` liberando trechos ao cliente (`enviarChunk`)
 * conforme chegam, sempre atrás da margem de segurança. Para de consumir o
 * gerador (fecha a stream) no instante em que árabe aparece — nunca lê nem
 * decide em cima do resto da resposta depois disso.
 */
async function consumirComFiltroIdioma(
  pedido: PedidoModelo,
  enviarChunk: (texto: string) => void,
): Promise<ResultadoConsumoSeguro> {
  const gerador = groqStream(pedido);
  let textoBruto = '';
  let liberadoAte = 0;

  while (true) {
    const passo = await gerador.next();
    if (passo.done) {
      // Terminou sem nunca ter sido bloqueado — libera o que ainda estava
      // retido na margem (é a última fatia, não tem mais texto vindo atrás
      // dela pra justificar retê-la).
      const restante = liberarRestante(textoBruto, liberadoAte);
      if (restante) enviarChunk(restante);
      return { status: 'completo', resultado: passo.value };
    }

    textoBruto += passo.value;
    const passoFiltro = proximoTrechoSeguro(textoBruto, liberadoAte);
    liberadoAte = passoFiltro.liberadoAte;
    if (passoFiltro.trecho) enviarChunk(passoFiltro.trecho);

    if (passoFiltro.bloqueado) {
      // Valor de retorno descartado — só encerra o gerador (fecha o reader
      // da SSE do Groq) sem consumir o resto da resposta.
      await gerador.return({ texto: '', chamadas: [], tokens: { entrada: 0, saida: 0 } }).catch(() => {});
      return liberadoAte > 0
        ? { status: 'bloqueado_parcial', textoEnviado: textoBruto.slice(0, liberadoAte) }
        : { status: 'bloqueado_sem_envio' };
    }
  }
}

/**
 * Gera a resposta final já validada quanto a idioma, transmitindo em
 * streaming — NUNCA entrega ao cliente um caractere árabe inesperado.
 *
 * Três desfechos possíveis:
 *   1. Idioma correto do início ao fim → streaming normal, sem regeneração.
 *   2. Árabe aparece ANTES de qualquer chunk ter sido enviado → descarta,
 *      regenera 1x com instrução reforçada (também em streaming filtrado).
 *      Se a regeneração falhar ou ainda vier com árabe antes de enviar
 *      algo, lança `ErroModelo('idioma_incorreto')` — quem chama decide o
 *      fallback (nunca uma 3ª tentativa).
 *   3. Árabe aparece DEPOIS de parte do texto já ter sido enviada → a
 *      resposta termina ali mesmo, no último ponto confirmadamente limpo.
 *      NÃO regenera por cima (concatenar texto novo depois de um corte no
 *      meio de uma frase pode produzir resposta incoerente) e NÃO usa o
 *      fallback da prospecção nesse caso, pelo mesmo motivo — o cliente já
 *      viu um começo de resposta; a coisa mais coerente é fechar ali, não
 *      emendar um texto diferente em cima.
 *
 * `permiteArabe` vem de `usuarioPediuArabe(mensagem)`, calculado uma vez por
 * turno: se o usuário pediu árabe explicitamente, todo este filtro é
 * ignorado — streaming puro, idêntico ao de antes desta correção.
 */
export async function gerarRespostaFinalSegura(
  pedidoBase: PedidoModelo,
  permiteArabe: boolean,
  enviarChunk: (texto: string) => void,
): Promise<RespostaModelo> {
  if (permiteArabe) {
    const gerador = groqStream(pedidoBase);
    while (true) {
      const passo = await gerador.next();
      if (passo.done) return passo.value;
      enviarChunk(passo.value);
    }
  }

  const primeira = await consumirComFiltroIdioma(pedidoBase, enviarChunk);
  if (primeira.status === 'completo') return primeira.resultado;

  if (primeira.status === 'bloqueado_parcial') {
    console.error(
      '[NEXO AI] idioma_incorreto',
      'etapa=' + (pedidoBase.etapa ?? 'desconhecida'),
      'motivo=arabe_apos_envio_parcial',
      'tamanho_ja_enviado=' + primeira.textoEnviado.length,
      '— encerrando a resposta no último ponto confirmadamente limpo, sem regenerar por cima',
    );
    return { texto: primeira.textoEnviado, chamadas: [], tokens: { entrada: 0, saida: 0 } };
  }

  // bloqueado_sem_envio: nada chegou ao cliente ainda — seguro regenerar.
  console.error(
    '[NEXO AI] idioma_incorreto',
    'etapa=' + (pedidoBase.etapa ?? 'desconhecida'),
    'motivo=arabe_antes_do_envio',
    '— regenerando 1x com instrução reforçada de pt-BR',
  );

  const pedidoReforcado: PedidoModelo = {
    ...pedidoBase,
    sistema: pedidoBase.sistema + REFORCO_PT_BR,
    etapa: 'resposta_final_regeneracao',
  };
  const segunda = await consumirComFiltroIdioma(pedidoReforcado, enviarChunk).catch((e: unknown) => {
    console.error('[NEXO AI] idioma_incorreto — regeneração falhou:', e instanceof Error ? e.message : String(e));
    return null;
  });

  if (segunda === null) {
    throw new ErroModelo('A NEXO não conseguiu manter a resposta em português agora.', 500, 'idioma_incorreto');
  }
  if (segunda.status === 'completo') return segunda.resultado;
  if (segunda.status === 'bloqueado_parcial') {
    console.error(
      '[NEXO AI] idioma_incorreto',
      'etapa=resposta_final_regeneracao',
      'motivo=arabe_apos_envio_parcial',
      'tamanho_ja_enviado=' + segunda.textoEnviado.length,
      '— encerrando a resposta no último ponto confirmadamente limpo, sem 3ª tentativa',
    );
    return { texto: segunda.textoEnviado, chamadas: [], tokens: { entrada: 0, saida: 0 } };
  }

  // bloqueado_sem_envio de novo, mesmo na regeneração — desiste. Nunca uma 3ª tentativa.
  console.error(
    '[NEXO AI] idioma_incorreto',
    'etapa=resposta_final_regeneracao',
    'motivo=arabe_persistiu',
    '— sem nova tentativa, quem chama decide o fallback',
  );
  throw new ErroModelo('A NEXO não conseguiu manter a resposta em português agora.', 500, 'idioma_incorreto');
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
    const ctxFerramenta = { db, usuarioId, papel: usuario.papel, conversaId };

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

    /* ---- Memória de longo prazo: extração + gravação.
       NÃO compete com prospecção/campanha/leitura — roda em paralelo com
       qualquer uma delas, porque uma mensagem pode ser as duas coisas ao
       mesmo tempo ("busque 5 leads e me chama de Iong daqui pra frente").
       `podeConterMemoria` é o freio de custo: só chama o modelo quando a
       mensagem tem QUALQUER sinal de conter algo memorável — a maioria das
       mensagens (saudação, comando, pergunta) nunca chega a essa chamada.
       O resultado NUNCA vira "DADO REAL": é um efeito colateral (gravar no
       banco), não informação para a resposta deste turno — a persona já
       instrui a usar memória com naturalidade, sem "explicar de onde
       lembrou", então a resposta não precisa saber que acabou de gravar. ---- */
    const promessaMemoria = promessaClassificacao.then(async ({ historicoRecortado }) => {
      if (!podeConterMemoria(mensagem)) return null;
      const bruto = await extrairMemoria(mensagem, historicoRecortado, modelo);
      if (!bruto) return null;
      return registrarMemoria({ db, usuarioId, conversaId }, bruto);
    });

    const [historico, memorias, empresa, resultadosFerramentas, resultadoProspeccao, resultadoMemoria] =
      await Promise.all([
        promessaHistorico,
        carregarMemorias(db, usuarioId),
        carregarContextoEmpresa(db),
        promessaFerramentas,
        promessaProspeccao,
        promessaMemoria,
      ]);
    console.log('[NEXO LATENCIA] contexto', Date.now() - tContexto, 'ms');
    if (resultadoMemoria) {
      console.log('[NEXO LATENCIA] memoria', 'status=' + resultadoMemoria.status);
    }

    const todosResultados = [
      ...resultadosFerramentas,
      ...(resultadoProspeccao ? [resultadoProspeccao] : []),
    ];

    const memoriasSelecionadas = selecionarMemorias(memorias, mensagem);
    const sistema = montarSistema({
      usuario: { nome: usuario.nome, papel: usuario.papel, email: usuario.email },
      empresa,
      memorias: memoriasSelecionadas,
    });

    const mensagens: MensagemModelo[] = [
      ...recortarHistorico(historico).map((m) => ({ papel: m.papel, conteudo: m.conteudo })),
      { papel: 'user', conteudo: mensagem },
    ];

    // `todosResultados.length > 0` já é o sinal de "uma ferramenta rodou de
    // verdade" — reaproveitado aqui como classificação leve de modo
    // tarefa/conversa, sem nenhuma chamada extra ao modelo só pra decidir isso.
    let sistemaComDados = sistema;
    if (todosResultados.length > 0) {
      const contextoDados = todosResultados
        .map((r) => `DADO REAL — ${r.nome}: ${r.conteudo}`)
        .join('\n');
      sistemaComDados = `${sistema}\n\n---\n\n${contextoDados}\nUse somente esses dados reais para responder à pergunta. Não invente números. Modo tarefa: resuma o resultado real de forma objetiva, sem bate-papo antes — só depois de resumir você pode sugerir um próximo passo, se fizer sentido.`;
    }

    /* ---- Uma chamada ao modelo por mensagem do usuário (mais uma, no
       máximo, só se precisar regenerar por idioma — ver
       gerarRespostaFinalSegura). Groq (openai/gpt-oss-20b) é o único
       provedor de texto — ver modelo.ts. O texto continua chegando ao
       cliente em streaming, chunk a chunk, como sempre — só que atrás de
       uma pequena margem de segurança que verifica árabe antes de cada
       liberação (ver o comentário grande acima de `gerarRespostaFinalSegura`).
       Cabeçalhos SSE só são escritos aqui, depois que auth, sessão e
       contexto já resolveram sem erro — se algo acima falhar, o cliente
       ainda recebe um JSON de erro normal (ver catch). ---- */
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

    // Calculado da mensagem ATUAL, não do histórico: pedir árabe há vários
    // turnos não autoriza o modelo a continuar nesse idioma para sempre.
    const permiteArabe = usuarioPediuArabe(mensagem);

    const enviarChunkAoCliente = (texto: string) => {
      if (tPrimeiroChunk === null) {
        tPrimeiroChunk = Date.now();
        console.log('[NEXO LATENCIA] primeiro_chunk_modelo', tPrimeiroChunk - tModelo, 'ms');
        console.log('[NEXO LATENCIA] primeiro_chunk_cliente', tPrimeiroChunk - tInicio, 'ms');
      }
      textoAcumulado += texto;
      enviarFrame(res, { tipo: 'chunk', texto });
    };

    try {
      resultado = await gerarRespostaFinalSegura(
        { sistema: sistemaComDados, mensagens, maxTokensSaida: 512, etapa: 'resposta_final' },
        permiteArabe,
        enviarChunkAoCliente,
      );
    } catch (erroRespostaFinal) {
      // A etapa de texto final falhou de forma irrecuperável (sem conteúdo
      // utilizável, timeout, erro do Groq, ou árabe que persistiu mesmo
      // após a única regeneração — sempre ANTES de qualquer chunk ter
      // chegado ao cliente; ver gerarRespostaFinalSegura). Se a prospecção
      // já rodou com sucesso NESTA mesma requisição, o resultado real já
      // existe e não depende do Groq: usa ele para montar uma resposta
      // determinística, em vez de jogar fora um trabalho que já terminou.
      // Nem a ferramenta nem o Google Places são chamados de novo aqui —
      // `resultadoProspeccao` é só reaproveitado do que já rodou antes
      // desta chamada ao modelo.
      const fallback = resultadoProspeccao ? respostaFallbackProspeccao(resultadoProspeccao.conteudo) : null;
      if (fallback === null) throw erroRespostaFinal;

      console.error(
        '[NEXO AI] resposta_final sem conteúdo utilizável do Groq — usando fallback determinístico da prospecção:',
        erroRespostaFinal instanceof Error ? erroRespostaFinal.message : String(erroRespostaFinal),
      );
      enviarChunkAoCliente(fallback);
      resultado = { texto: fallback, chamadas: [], tokens: { entrada: 0, saida: 0 } };
    }
    console.log('[NEXO LATENCIA] modelo_total', Date.now() - tModelo, 'ms');

    const texto = (resultado?.texto || textoAcumulado).trim() || 'Não consegui formular uma resposta agora.';

    /* ---- Persiste: depois dos chunks visuais (o usuário já viu a resposta
       inteira), mas ANTES de fechar a resposta — a consistência do turno não
       fica pendurada num "fire and forget" que a Vercel Node não garante. ---- */
    const tPersiste = Date.now();
    await Promise.all([
      salvarTurno(db, conversaId, mensagem, texto),
      // Melhor esforço — alimenta a recência da próxima recuperação
      // (pontuarMemoria). Nunca lança, nunca atrasa a resposta por isso.
      atualizarUsoMemorias(db, memoriasSelecionadas.map((m) => m.id)),
    ]);
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

/**
 * `conversaId` ausente ou não encontrado (pertence a outro usuário, foi
 * removido) sempre cai para `criarConversa` — é esse fallback que faz o
 * botão "Nova conversa" funcionar: o frontend só precisa mandar
 * `conversa_id: undefined`, sem nenhuma flag especial nem endpoint dedicado
 * de "forçar nova" aqui (esse endpoint existe, mas separado — ver
 * api/nexo-ai/conversas.ts — para criar a conversa ANTES da 1ª mensagem).
 */
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
  return criarConversa(db, usuarioId);
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

/**
 * Exportada só para teste — confirma que a memória é buscada por
 * `usuarioId` sozinho, nunca por `conversaId` (não recebe esse parâmetro):
 * trocar de conversa não muda quais memórias entram no contexto.
 */
export async function carregarMemorias(
  db: import('@supabase/supabase-js').SupabaseClient,
  usuarioId: string,
): Promise<Memoria[]> {
  // `error` ignorado de propósito (mesmo padrão já usado aqui): se a
  // migration 004 (last_used_at/ativo) ainda não tiver sido aplicada, a
  // consulta falha e `data` vem `null` — cai pra lista vazia, a conversa
  // continua normalmente sem memória, em vez de derrubar a resposta.
  const { data } = await db
    .from('ai_memories')
    .select('id, tipo, conteudo, chaves, relevancia, usuario_id, last_used_at')
    .or(`usuario_id.eq.${usuarioId},usuario_id.is.null`)
    .eq('ativo', true)
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

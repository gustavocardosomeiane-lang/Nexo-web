import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizarExtracaoMemoria,
  mesmaMemoria,
  encontrarMemoriaParaEsquecer,
  type ExtracaoMemoriaBruta,
  type Memoria,
} from '../../../shared/regras-nexo-ai.js';

/**
 * Escrita de memória de longo prazo — a parte que FALA COM O BANCO. Toda
 * decisão de negócio (o que é válido, o que é a mesma memória, o que é
 * segredo) já aconteceu em `shared/regras-nexo-ai.ts`
 * (`normalizarExtracaoMemoria`/`mesmaMemoria`/`encontrarMemoriaParaEsquecer`,
 * puras, sem banco); este módulo só consulta o necessário e grava.
 *
 * REQUER a migration 004 (supabase/migrations/004-memoria-longo-prazo.sql)
 * aplicada — as colunas `atualizado_em`/`last_used_at`/
 * `source_conversation_id`/`ativo` ainda não existem em produção. Enquanto
 * não for aplicada, todo INSERT/UPDATE aqui falha (Postgres "column does not
 * exist") e `registrarMemoria` devolve `{status:'erro'}` — nunca lança,
 * nunca derruba a conversa (mesmo padrão de `carregarMemorias` em
 * conversar.ts, que já ignora erro de leitura e cai para lista vazia).
 */

export interface ContextoMemoria {
  db: SupabaseClient;
  usuarioId: string;
  conversaId: string;
}

export type ResultadoRegistroMemoria =
  | { status: 'ignorado' }
  | { status: 'criada'; id: string }
  | { status: 'atualizada'; id: string }
  | { status: 'esquecida'; id: string }
  | { status: 'nada_para_esquecer' }
  | { status: 'erro'; motivo: string };

type LinhaMemoriaExistente = Pick<Memoria, 'id' | 'tipo' | 'conteudo' | 'chaves' | 'relevancia'>;

/**
 * Valida a extração, checa dedupe contra as memórias ATIVAS deste usuário, e
 * grava (criar/atualizar) ou desativa (esquecer). Nunca escreve memória de
 * OUTRO usuário: a consulta de dedupe já filtra por `usuario_id`, e o INSERT
 * sempre usa `ctx.usuarioId` — nunca `usuario_id: null` (memória de empresa),
 * que exigiria papel administrador na RLS; escopo desta v1 é só memória
 * pessoal (ver relatório da migração).
 */
export async function registrarMemoria(
  ctx: ContextoMemoria,
  bruto: ExtracaoMemoriaBruta,
): Promise<ResultadoRegistroMemoria> {
  const normalizada = normalizarExtracaoMemoria(bruto);
  if (!normalizada) return { status: 'ignorado' };

  const { data, error } = await ctx.db
    .from('ai_memories')
    .select('id, tipo, conteudo, chaves, relevancia')
    .eq('usuario_id', ctx.usuarioId)
    .eq('ativo', true);
  if (error) return { status: 'erro', motivo: error.message };
  const existentes = (data ?? []) as LinhaMemoriaExistente[];

  if (normalizada.acao === 'esquecer') {
    const idAlvo = encontrarMemoriaParaEsquecer(normalizada, existentes);
    if (!idAlvo) return { status: 'nada_para_esquecer' };
    const { error: erroEsquecer } = await ctx.db.from('ai_memories').update({ ativo: false }).eq('id', idAlvo);
    if (erroEsquecer) return { status: 'erro', motivo: erroEsquecer.message };
    return { status: 'esquecida', id: idAlvo };
  }

  // criar / atualizar: mesma lógica de gravação — se já existe a MESMA
  // memória, vira UPDATE; senão, INSERT. `acao: 'atualizar'` explícito sem
  // uma correspondente existente também cai pra INSERT (nada a atualizar
  // ainda, mas o fato é real e vale registrar).
  const existente = existentes.find((m) => mesmaMemoria(normalizada, m));

  if (existente) {
    const { error: erroUpdate } = await ctx.db
      .from('ai_memories')
      .update({
        conteudo: normalizada.conteudo,
        relevancia: normalizada.relevancia,
        chaves: [normalizada.chave],
        source_conversation_id: ctx.conversaId,
      })
      .eq('id', existente.id);
    if (erroUpdate) return { status: 'erro', motivo: erroUpdate.message };
    return { status: 'atualizada', id: existente.id };
  }

  const { data: criada, error: erroInsert } = await ctx.db
    .from('ai_memories')
    .insert({
      usuario_id: ctx.usuarioId,
      tipo: normalizada.categoria,
      conteudo: normalizada.conteudo,
      chaves: [normalizada.chave],
      relevancia: normalizada.relevancia,
      source_conversation_id: ctx.conversaId,
    })
    .select('id')
    .single();
  if (erroInsert) return { status: 'erro', motivo: erroInsert.message };
  return { status: 'criada', id: (criada as { id: string }).id };
}

/**
 * Marca as memórias USADAS nesta resposta — alimenta a recência da próxima
 * recuperação (`pontuarMemoria`). Melhor esforço: nunca lança, nunca atrasa
 * nem derruba a resposta por causa disso (é só telemetria de uso).
 */
export async function atualizarUsoMemorias(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db.from('ai_memories').update({ last_used_at: new Date().toISOString() }).in('id', ids);
  } catch {
    // best-effort — sem log nem propagação, não é crítico.
  }
}

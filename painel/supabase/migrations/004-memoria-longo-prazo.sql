-- =============================================================================
-- MIGRATION 004 — Memória de longo prazo da NEXO AI (extensão de ai_memories)
-- =============================================================================
--
-- `ai_memories` já existe (migration 002) e já é LIDA em toda conversa
-- (api/nexo-ai/conversar.ts -> carregarMemorias -> selecionarMemorias, em
-- shared/regras-nexo-ai.ts). O que faltava era o lado da ESCRITA — e, pro
-- lado da leitura funcionar direito, quatro colunas que a tabela original
-- não tinha:
--
--   atualizado_em            quando a memória foi editada pela última vez
--                             (a tabela só tinha criado_em);
--   last_used_at             quando ela foi USADA numa resposta pela última
--                             vez — alimenta a recência na pontuação de
--                             recuperação (pontuarMemoria);
--   source_conversation_id   de qual conversa ela veio — auditoria, nunca
--                             exibido ao usuário;
--   ativo                    soft-delete: "esquecer" desativa em vez de
--                             apagar (auditável, reversível). A leitura
--                             (carregarMemorias) passa a filtrar
--                             `ativo = true` — RLS não muda, porque RLS
--                             decide OWNERSHIP, não estado de soft-delete.
--
-- NENHUMA tabela nova, NENHUMA política de RLS nova: as políticas de
-- UPDATE/DELETE que já existem (`ai_memoria_atualizar`, `ai_memoria_remover`)
-- já cobrem "atualizar minha memória" e "esquecer é um UPDATE de ativo". As
-- policies não referenciam nenhuma coluna nova — continuam válidas como
-- estão, sem precisar de ALTER POLICY nenhum.
--
-- REVISÃO (idempotência de `atualizado_em`): a primeira versão deste arquivo
-- adicionava `atualizado_em timestamptz not null default now()` e depois
-- rodava `update ... where atualizado_em is distinct from criado_em`. Isso
-- tem dois problemas numa SEGUNDA execução da migration:
--   1. Uma memória legitimamente atualizada depois da 1ª execução já tem
--      atualizado_em != criado_em de propósito — o filtro `is distinct from`
--      voltaria a bater nela e reescreveria o timestamp real por
--      criado_em, apagando a informação de quando ela foi editada de
--      verdade.
--   2. Pior: o trigger só era recriado no FIM do arquivo, então numa 2ª
--      execução ele já existe DURANTE esse UPDATE — e o trigger sobrescreve
--      qualquer valor que o UPDATE tentasse gravar por `now()`, então nem
--      o backfill (errado) acontecia como escrito; virava `now()` pra toda
--      linha que batesse no filtro.
-- Corrigido com o padrão abaixo: coluna nasce sem default/NOT NULL, trigger
-- é derrubado ANTES do backfill (mesmo que já exista de execução anterior),
-- o backfill mira só `is null` (nunca reprocessa quem já tem valor — seja
-- de backfill anterior, seja de edição real), e só then a coluna vira
-- obrigatória com o default valendo pra próxima linha nova.
--
-- COMPATIBILIDADE COM DADOS EXISTENTES:
--   - atualizado_em: nasce NULL pra toda linha existente, preenchida pelo
--     backfill (= criado_em) antes de virar NOT NULL — nenhuma linha fica
--     sem valor no fim.
--   - source_conversation_id: nasce NULL em toda linha existente. FK não
--     valida NULL, então não há violação possível; nada a migrar.
--   - ativo: NOT NULL DEFAULT true resolvido pelo próprio ADD COLUMN — o
--     Postgres aplica o default a cada linha existente sem reescrever a
--     tabela (comportamento de coluna com default não-volátil desde o
--     PG11). Numa 2ª execução o comando inteiro é pulado (coluna já
--     existe), então nunca sobrescreve um `ativo=false` real de um
--     "esquecer" que já tenha acontecido.
--   - last_used_at: nasce NULL, sem default — nada a fazer até uma memória
--     ser usada de verdade.
--
-- `tocar_atualizado_em()` já existe (schema.sql) e é genérica — só faz
-- `new.atualizado_em = now()`, já usada por ai_conversations/campaigns/etc.
-- Funciona com qualquer tabela que tenha a coluna `atualizado_em`, então
-- serve pra ai_memories sem precisar de uma função nova.
--
-- SEM PERDA DE DADO em nenhum cenário: só ADD COLUMN, UPDATE condicional
-- (nunca DELETE/DROP COLUMN), índice e trigger. RLS existente não é tocada.
--
-- Idempotente de verdade agora: pode rodar 2, 3, N vezes sem alterar
-- timestamp legítimo nenhum e sem duplicar índice/trigger.
--
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo → Run.
-- NÃO APLICADA AINDA — aguardando autorização.
-- =============================================================================

-- 1) Coluna nasce SEM default/NOT NULL — evita o Postgres preencher toda
--    linha existente com `now()` no instante do ADD COLUMN, o que tornaria
--    o backfill do passo 3 inútil (todo mundo já teria um valor "pronto"
--    pra passar pelo filtro `is null`).
alter table public.ai_memories
  add column if not exists atualizado_em timestamptz;

-- 2) Derruba o trigger ANTES do backfill, mesmo que já exista de uma
--    execução anterior — sem isso, o UPDATE do passo 3 dispara o trigger,
--    que sobrescreveria o valor pretendido (criado_em) por now().
drop trigger if exists trg_ai_memories_touch on public.ai_memories;

-- 3) Backfill SÓ onde ainda é NULL. Uma memória legitimamente atualizada
--    depois da 1ª execução desta migration já tem atualizado_em preenchido
--    (pelo trigger, quando ele existir) e NUNCA entra aqui de novo, mesmo
--    rodando a migration mais uma vez.
update public.ai_memories
   set atualizado_em = criado_em
 where atualizado_em is null;

-- 4) Só agora a coluna vira obrigatória, com o default valendo pra
--    inserções futuras. Rodar isto de novo é inofensivo: mesmo default,
--    mesma constraint, sem reescrever dado nenhum.
alter table public.ai_memories
  alter column atualizado_em set default now(),
  alter column atualizado_em set not null;

-- As outras três colunas são seguras com ADD COLUMN IF NOT EXISTS puro:
-- nenhuma delas tem um backfill em UPDATE que possa colidir consigo mesmo
-- numa segunda execução (ver COMPATIBILIDADE acima).
alter table public.ai_memories
  add column if not exists last_used_at timestamptz,
  add column if not exists source_conversation_id uuid references public.ai_conversations(id) on delete set null,
  add column if not exists ativo boolean not null default true;

create index if not exists idx_ai_memories_ativo
  on public.ai_memories (usuario_id, ativo)
  where ativo;

-- 5) Recria o trigger por último, só depois que a coluna já está estável.
create trigger trg_ai_memories_touch
  before update on public.ai_memories
  for each row execute function public.tocar_atualizado_em();

notify pgrst, 'reload schema';

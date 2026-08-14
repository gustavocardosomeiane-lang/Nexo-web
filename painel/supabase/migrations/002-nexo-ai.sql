-- =============================================================================
-- MIGRATION 002 — NEXO AI (memória e conversas da IA interna)
-- =============================================================================
--
-- Cria a base de dados da NEXO AI SEM tocar em nenhuma tabela existente.
-- Três tabelas novas:
--
--   ai_conversations  sessões de conversa (memória de curto prazo por sessão)
--   ai_messages       mensagens de cada sessão
--   ai_memories       memória de longo prazo, estruturada
--
-- Tudo idempotente (`if not exists`, `drop policy if exists`): pode rodar mais
-- de uma vez. RLS reaproveita `auth.uid()` e o padrão já usado no schema.
--
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo → Run.
-- =============================================================================

-- Conversas -------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references public.users(id) on delete cascade,
  titulo        text not null default 'Nova conversa',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_ai_conversations_usuario
  on public.ai_conversations (usuario_id, atualizado_em desc);

-- Mensagens (curto prazo) -----------------------------------------------------
create table if not exists public.ai_messages (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.ai_conversations(id) on delete cascade,
  papel       text not null check (papel in ('user', 'assistant')),
  conteudo    text not null,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_ai_messages_conversa
  on public.ai_messages (conversa_id, criado_em);

-- Memória (longo prazo) -------------------------------------------------------
-- `usuario_id` nulo = memória de escopo da EMPRESA, visível a toda a equipe.
-- Com dono = memória pessoal daquele usuário.
create table if not exists public.ai_memories (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid references public.users(id) on delete cascade,
  tipo        text not null default 'fato'
              check (tipo in ('empresa', 'preferencia', 'decisao', 'projeto', 'fato')),
  conteudo    text not null check (length(trim(conteudo)) > 0),
  chaves      text[] not null default '{}',
  relevancia  real not null default 0.5 check (relevancia >= 0 and relevancia <= 1),
  criado_em   timestamptz not null default now()
);

create index if not exists idx_ai_memories_usuario on public.ai_memories (usuario_id);
create index if not exists idx_ai_memories_tipo on public.ai_memories (tipo);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_memories       enable row level security;

-- Conversas: cada um mexe só nas suas.
drop policy if exists ai_conversas_proprias on public.ai_conversations;
create policy ai_conversas_proprias on public.ai_conversations
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Mensagens: acessíveis só através de uma conversa que é sua.
drop policy if exists ai_mensagens_proprias on public.ai_messages;
create policy ai_mensagens_proprias on public.ai_messages
  for all using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversa_id and c.usuario_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversa_id and c.usuario_id = auth.uid()
    )
  );

-- Memória: leitura das próprias + as da empresa (dono nulo). Escrita/remoção
-- só das próprias.
drop policy if exists ai_memoria_ler on public.ai_memories;
create policy ai_memoria_ler on public.ai_memories
  for select using (usuario_id = auth.uid() or usuario_id is null);

drop policy if exists ai_memoria_inserir on public.ai_memories;
create policy ai_memoria_inserir on public.ai_memories
  for insert with check (usuario_id = auth.uid());

drop policy if exists ai_memoria_atualizar on public.ai_memories;
create policy ai_memoria_atualizar on public.ai_memories
  for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists ai_memoria_remover on public.ai_memories;
create policy ai_memoria_remover on public.ai_memories
  for delete using (usuario_id = auth.uid());

-- Memória da empresa (usuario_id nulo) só um administrador cria/edita.
drop policy if exists ai_memoria_empresa_admin on public.ai_memories;
create policy ai_memoria_empresa_admin on public.ai_memories
  for all using (usuario_id is null and public.tem_papel(array['administrador']::user_role[]))
  with check (usuario_id is null and public.tem_papel(array['administrador']::user_role[]));

-- Trigger de atualizado_em, no mesmo padrão do schema.
drop trigger if exists trg_ai_conversations_touch on public.ai_conversations;
create trigger trg_ai_conversations_touch
  before update on public.ai_conversations
  for each row execute function public.tocar_atualizado_em();

grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert, update, delete on public.ai_messages to authenticated;
grant select, insert, update, delete on public.ai_memories to authenticated;

-- Contexto institucional da empresa, lido pela IA. Editável em Configurações.
insert into public.settings (chave, valor)
values ('nexo_ai_contexto', '{"texto": "A NEXO WEB cria sites profissionais para pequenas e médias empresas. Planos: Básico R$ 1.400, Profissional R$ 2.500, Premium R$ 4.000."}'::jsonb)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';

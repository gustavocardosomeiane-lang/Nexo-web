-- =============================================================================
-- MIGRATION 001 — Prospeccao, slots de disparo e autorizacao da IA
-- =============================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O painel publicado falhou com:
--   Could not find the 'nao_contatar' column of 'leads' in the schema cache
--
-- Causa: as secoes 8, 9 e 10 do schema.sql nunca foram executadas neste banco.
-- Nao e so a coluna "nao_contatar": faltam as tabelas de prospeccao inteiras
-- (tags, campaigns, campaign_targets, campaign_slots), as colunas de disparo e
-- as policies de RLS. Corrigir so a coluna do erro faria o proximo campo
-- faltante aparecer no clique seguinte.
--
-- SEGURANCA PARA RODAR EM BANCO POPULADO
--
-- Tudo aqui e idempotente: "create table if not exists",
-- "add column if not exists", "create index if not exists" e
-- "drop policy if exists" antes de recriar.
-- Rodar duas vezes nao duplica nem apaga dado.
-- O conteudo e copia literal das secoes 8-10 de supabase/schema.sql — nao ha
-- divergencia entre os dois arquivos.
--
-- COMO APLICAR
--   Supabase -> SQL Editor -> cole este arquivo inteiro -> Run
-- =============================================================================

-- =============================================================================
-- 8. PROSPECÇÃO — tags, campanhas e controle de disparo
--
-- Acrescentado junto com o modo assistido do NinjaBot. Roda sobre um banco que
-- já tenha as seções 1–7; é idempotente como o resto do arquivo.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'campaign_status') then
    create type campaign_status as enum ('rascunho', 'ativa', 'pausada', 'concluida');
  end if;

  if not exists (select 1 from pg_type where typname = 'target_status') then
    create type target_status as enum ('pendente', 'enviado', 'respondido', 'ignorado', 'falhou');
  end if;
end $$;

-- tags -------------------------------------------------------------------------
create table if not exists public.tags (
  id        uuid primary key default gen_random_uuid(),
  nome      text        not null unique check (length(trim(nome)) > 0),
  descricao text,
  criado_em timestamptz not null default now()
);

-- Campos novos em leads. ADD COLUMN IF NOT EXISTS deixa rodar em banco já populado.
alter table public.leads add column if not exists tags text[] not null default '{}';
alter table public.leads add column if not exists nao_contatar boolean not null default false;

comment on column public.leads.nao_contatar is
  'Trava permanente contra disparo: contato pessoal, fornecedor ou quem pediu para não receber. Nenhuma campanha ignora este campo.';

-- Índice GIN: `tags @> ARRAY['x']` fica rápido mesmo com muitos leads.
create index if not exists idx_leads_tags on public.leads using gin (tags);
create index if not exists idx_leads_contatavel on public.leads (status) where not nao_contatar;

-- campaigns --------------------------------------------------------------------
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  nome          text            not null check (length(trim(nome)) > 0),
  -- Guarda o id da tag como texto: a campanha continua legível mesmo que a tag
  -- seja renomeada, e apagar uma tag não apaga o histórico da campanha.
  tag           text            not null,
  mensagem      text            not null check (length(trim(mensagem)) >= 20),
  status        campaign_status not null default 'rascunho',
  tamanho_lote  smallint        not null default 10 check (tamanho_lote between 1 and 50),
  criado_em     timestamptz     not null default now(),
  atualizado_em timestamptz     not null default now(),
  iniciada_em   timestamptz,
  concluida_em  timestamptz
);

-- campaign_targets --------------------------------------------------------------
-- O LIVRO-CAIXA DO DISPARO. O UNIQUE abaixo é a trava anti-duplicidade: nem
-- recarregar a tela, nem dois operadores ao mesmo tempo conseguem contatar o
-- mesmo lead duas vezes na mesma campanha.
create table if not exists public.campaign_targets (
  id            uuid          primary key default gen_random_uuid(),
  campanha_id   uuid          not null references public.campaigns(id) on delete cascade,
  lead_id       uuid          not null references public.leads(id)     on delete cascade,
  status        target_status not null default 'pendente',
  lote          smallint      check (lote is null or lote > 0),
  enviado_em    timestamptz,
  respondido_em timestamptz,
  observacao    text,
  criado_em     timestamptz   not null default now(),
  atualizado_em timestamptz   not null default now(),
  constraint alvo_unico_por_campanha unique (campanha_id, lead_id)
);

create index if not exists idx_targets_campanha on public.campaign_targets (campanha_id, status);
create index if not exists idx_targets_lead     on public.campaign_targets (lead_id);
-- Consulta da carência: "quem foi contatado nos últimos 30 dias".
create index if not exists idx_targets_enviado  on public.campaign_targets (enviado_em)
  where enviado_em is not null;

-- Triggers de atualizado_em
do $$
declare t text;
begin
  foreach t in array array['campaigns', 'campaign_targets']
  loop
    execute format('drop trigger if exists trg_%s_atualizado_em on public.%I', t, t);
    execute format(
      'create trigger trg_%s_atualizado_em before update on public.%I
       for each row execute function public.tocar_atualizado_em()', t, t
    );
  end loop;
end $$;

-- RLS ---------------------------------------------------------------------------
alter table public.tags             enable row level security;
alter table public.campaigns        enable row level security;
alter table public.campaign_targets enable row level security;

drop policy if exists tags_ler on public.tags;
create policy tags_ler on public.tags
  for select using (public.eh_equipe());

drop policy if exists tags_escrever on public.tags;
create policy tags_escrever on public.tags
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

drop policy if exists campaigns_ler on public.campaigns;
create policy campaigns_ler on public.campaigns
  for select using (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

drop policy if exists campaigns_escrever on public.campaigns;
create policy campaigns_escrever on public.campaigns
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

drop policy if exists targets_ler on public.campaign_targets;
create policy targets_ler on public.campaign_targets
  for select using (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

drop policy if exists targets_escrever on public.campaign_targets;
create policy targets_escrever on public.campaign_targets
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

-- Listas iniciais. Ajuste ou apague conforme a sua operação.
insert into public.tags (nome, descricao) values
  ('Comércio local', 'Lojas e serviços de bairro'),
  ('Clínicas e consultórios', 'Saúde e bem-estar'),
  ('Prestadores de serviço', 'Profissionais liberais'),
  ('Sem site', 'Negócios sem presença digital')
on conflict (nome) do nothing;

-- =============================================================================
-- 9. SLOTS DE DISPARO E AUTORIZAÇÃO DA IA
--
-- Acrescentado com a integração real do NinjaBot. Aditivo: roda sobre um banco
-- que já tenha as seções 1–8 sem apagar nada.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'slot_status') then
    create type slot_status as enum ('rascunho', 'pronto', 'disparado', 'cancelado');
  end if;
end $$;

-- campaign_slots ----------------------------------------------------------------
-- Cada slot é um lote com SUA mensagem e SEUS contatos. É a unidade que você
-- revisa antes de disparar e a que fica registrada depois.
create table if not exists public.campaign_slots (
  id            uuid        primary key default gen_random_uuid(),
  campanha_id   uuid        not null references public.campaigns(id) on delete cascade,
  nome          text        not null check (length(trim(nome)) > 0),
  mensagem      text        not null check (length(trim(mensagem)) > 0),
  status        slot_status not null default 'rascunho',
  ordem         smallint    not null default 1 check (ordem > 0),
  disparado_em  timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_slots_campanha on public.campaign_slots (campanha_id, ordem);

-- Campos de participação e autorização em campaign_targets.
-- ADD COLUMN IF NOT EXISTS: não recria a tabela nem perde dado existente.
alter table public.campaign_targets
  add column if not exists slot_id uuid references public.campaign_slots(id) on delete set null;
alter table public.campaign_targets add column if not exists telefone text;
alter table public.campaign_targets add column if not exists mensagem_final text;
alter table public.campaign_targets add column if not exists ia_autorizada boolean not null default false;
alter table public.campaign_targets add column if not exists ia_autorizada_em timestamptz;
alter table public.campaign_targets add column if not exists ia_canal_id integer;
alter table public.campaign_targets add column if not exists conversa_externa_id text;
-- Id da mensagem devolvido pela API no disparo. Nulo quando a resposta do
-- NinjaBot nao traz id (o swagger declara `result`/`conversa` sem tipagem).
alter table public.campaign_targets add column if not exists mensagem_externa_id text;

comment on column public.campaign_targets.ia_autorizada is
  'A IA do NinjaBot está liberada para atender este contato. Só vira true quando o operador confirma o disparo — quem nunca participou nunca é autorizado.';
comment on column public.campaign_targets.telefone is
  'Telefone congelado no momento do disparo. Se o cadastro do lead mudar depois, o registro de quem recebeu o quê continua fiel ao que aconteceu.';

create index if not exists idx_targets_slot on public.campaign_targets (slot_id);
-- Consulta central: "este número participou e está autorizado?"
create index if not exists idx_targets_telefone on public.campaign_targets (telefone)
  where telefone is not null;
create index if not exists idx_targets_autorizados on public.campaign_targets (ia_autorizada)
  where ia_autorizada;

-- Trigger de atualizado_em
drop trigger if exists trg_campaign_slots_atualizado_em on public.campaign_slots;
create trigger trg_campaign_slots_atualizado_em before update on public.campaign_slots
  for each row execute function public.tocar_atualizado_em();

-- RLS ---------------------------------------------------------------------------
alter table public.campaign_slots enable row level security;

drop policy if exists slots_ler on public.campaign_slots;
create policy slots_ler on public.campaign_slots
  for select using (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

drop policy if exists slots_escrever on public.campaign_slots;
create policy slots_escrever on public.campaign_slots
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

-- =============================================================================
-- 10. CORREÇÃO: "permission denied for table conversations"
--
-- O erro aparece quando RLS está ligado e NENHUMA policy casa para o usuário —
-- o Postgres nega por padrão, que é o comportamento correto e desejado.
--
-- As policies abaixo são idempotentes e restauram o acesso da equipe SEM
-- desligar RLS. Desligar RLS resolveria o sintoma e abriria a tabela inteira
-- para a anon key, que é pública: qualquer visitante leria as conversas.
-- =============================================================================

alter table public.conversations enable row level security;

drop policy if exists conversations_ler on public.conversations;
create policy conversations_ler on public.conversations
  for select using (public.eh_equipe());

drop policy if exists conversations_escrever on public.conversations;
create policy conversations_escrever on public.conversations
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

-- DIAGNÓSTICO. Se o erro persistir depois disso, quase sempre é uma destas
-- duas causas — e as duas são de configuração, não de policy:
--
--   1. O usuário logado não tem linha em public.users, então papel_atual()
--      devolve NULL e eh_equipe() é false. Confira com:
--        select id, email, role, ativo from public.users where email = 'SEU@EMAIL';
--
--   2. A role `authenticated` perdeu o GRANT de tabela. RLS filtra LINHAS;
--      GRANT libera a TABELA. Sem o GRANT, nem a melhor policy salva:
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;


-- =============================================================================
-- SCHEMA CACHE DO POSTGREST
-- =============================================================================
--
-- O erro original foi do PostgREST, nao do Postgres: ele mantem um cache do
-- schema e nao percebe DDL sozinho. Sem este aviso, a coluna existe no banco e
-- a API continua respondendo "could not find the column" ate o proximo restart.
notify pgrst, 'reload schema';

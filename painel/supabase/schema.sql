-- =============================================================================
-- NEXO WEB — Painel administrativo
-- Schema PostgreSQL / Supabase
--
-- Espelha exatamente src/types/index.ts. Mexeu num, mexa no outro.
--
-- COMO APLICAR
--   Supabase → SQL Editor → cole este arquivo inteiro → Run.
--   É idempotente: pode rodar de novo sem quebrar o que já existe.
--
-- DECISÕES QUE VALE ENTENDER ANTES DE ALTERAR
--
--   1. DINHEIRO EM BIGINT, EM CENTAVOS. Nunca float, nunca money.
--      R$ 1.400,00 é gravado como 140000. NUMERIC(12,2) também serviria;
--      centavo inteiro é escolhido por casar com o JavaScript sem conversão e
--      eliminar erro de arredondamento de ponto flutuante.
--
--   2. RLS LIGADO EM TODAS AS TABELAS. A anon key usada pelo painel é pública
--      por natureza; sem RLS ela viraria acesso irrestrito ao banco. As
--      policies abaixo são o controle de acesso real do sistema — a matriz de
--      permissões do frontend (src/auth/permissions.ts) é só conveniência de
--      interface e precisa contar a mesma história.
--
--   3. ON DELETE. Apagar cliente NÃO apaga histórico financeiro (SET NULL onde
--      é seguro, RESTRICT onde não é). Apagar venda apaga as parcelas e os
--      pagamentos dela — são partes da venda, não têm vida própria.
--
--   4. webhook_events.evento_externo_id É UNIQUE. É essa constraint que garante
--      idempotência de verdade. A checagem em código evita trabalho à toa; a
--      garantia contra pagamento duplicado é aqui.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. TIPOS
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('administrador', 'vendedor', 'financeiro', 'colaborador');
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum (
      'novo', 'contatado', 'em_conversa', 'qualificado', 'proposta_enviada',
      'negociacao', 'pagamento_pendente', 'cliente', 'perdido'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_origem') then
    create type lead_origem as enum ('site', 'whatsapp', 'indicacao', 'instagram', 'google', 'ninjabot', 'outro');
  end if;

  if not exists (select 1 from pg_type where typname = 'service_categoria') then
    create type service_categoria as enum (
      'landing_page', 'site_institucional', 'ecommerce', 'personalizado', 'manutencao', 'outro'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'sale_status') then
    create type sale_status as enum (
      'orcamento', 'aguardando_pagamento', 'parcialmente_pago', 'pago', 'cancelado', 'reembolsado'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_method') then
    -- Novas formas entram com ALTER TYPE ... ADD VALUE, sem migração de dados.
    create type payment_method as enum ('pix', 'cartao');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('pago', 'pendente', 'atrasado', 'cancelado', 'reembolsado');
  end if;

  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type project_status as enum (
      'aguardando_inicio', 'briefing', 'planejamento', 'design', 'desenvolvimento',
      'revisao', 'ajustes', 'finalizacao', 'entregue', 'concluido'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'conversation_status') then
    create type conversation_status as enum (
      'aguardando_resposta', 'respondeu', 'em_atendimento', 'qualificado', 'sem_resposta', 'encerrada'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type notification_type as enum (
      'nova_venda', 'pagamento_aprovado', 'pagamento_recusado', 'pagamento_pendente',
      'parcela_vencendo', 'lead_respondeu', 'novo_cliente', 'projeto_prazo'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_severity') then
    create type notification_severity as enum ('info', 'sucesso', 'alerta', 'erro');
  end if;

  if not exists (select 1 from pg_type where typname = 'webhook_event_type') then
    create type webhook_event_type as enum (
      'pagamento.criado', 'pagamento.aprovado', 'pagamento.pendente',
      'pagamento.recusado', 'pagamento.cancelado', 'pagamento.reembolsado'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'webhook_process_status') then
    create type webhook_process_status as enum ('recebido', 'processado', 'ignorado', 'erro');
  end if;
end $$;

-- =============================================================================
-- 2. TABELAS
-- =============================================================================

-- users -----------------------------------------------------------------------
-- O id é o MESMO de auth.users. É o que liga a sessão do Supabase Auth ao
-- perfil e ao papel. Sem essa amarração, RLS não sabe quem está perguntando.
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text        not null check (length(trim(nome)) > 0),
  email       text        not null unique,
  role        user_role   not null default 'colaborador',
  avatar_url  text,
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now()
);

-- clients ---------------------------------------------------------------------
create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  nome           text        not null check (length(trim(nome)) > 0),
  empresa        text,
  telefone       text,
  whatsapp       text,
  email          text,
  documento      text,
  cidade         text,
  estado         char(2),
  observacoes    text,
  lead_origem_id uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- services --------------------------------------------------------------------
create table if not exists public.services (
  id                 uuid primary key default gen_random_uuid(),
  nome               text              not null check (length(trim(nome)) > 0),
  descricao          text,
  preco              bigint            not null check (preco >= 0),
  preco_promocional  bigint            check (preco_promocional >= 0 and preco_promocional < preco),
  categoria          service_categoria not null default 'outro',
  max_parcelas       smallint          not null default 1 check (max_parcelas between 1 and 24),
  ativo              boolean           not null default true,
  criado_em          timestamptz       not null default now(),
  atualizado_em      timestamptz       not null default now()
);

-- leads -----------------------------------------------------------------------
create table if not exists public.leads (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text        not null check (length(trim(nome)) > 0),
  empresa              text,
  telefone             text,
  whatsapp             text,
  email                text,
  origem               lead_origem not null default 'outro',
  campanha             text,
  data_entrada         date        not null default current_date,
  responsavel_id       uuid references public.users(id)    on delete set null,
  status               lead_status not null default 'novo',
  observacoes          text,
  ultima_interacao     timestamptz,
  proxima_acao         text,
  proxima_acao_em      date,
  valor_potencial      bigint      check (valor_potencial >= 0),
  servico_interesse_id uuid references public.services(id) on delete set null,
  cliente_id           uuid references public.clients(id)  on delete set null,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);

-- A referência inversa só pode ser criada depois que leads existe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_lead_origem_id_fkey'
  ) then
    alter table public.clients
      add constraint clients_lead_origem_id_fkey
      foreign key (lead_origem_id) references public.leads(id) on delete set null;
  end if;
end $$;

-- sales -----------------------------------------------------------------------
-- ON DELETE RESTRICT no cliente: apagar cliente com venda registrada apagaria
-- histórico financeiro. O banco recusa e obriga uma decisão consciente.
create table if not exists public.sales (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text           not null unique,
  cliente_id           uuid           not null references public.clients(id)  on delete restrict,
  servico_id           uuid           references public.services(id)          on delete set null,
  valor_total          bigint         not null check (valor_total >= 0),
  desconto             bigint         not null default 0 check (desconto >= 0),
  forma_pagamento      payment_method not null default 'pix',
  parcelas             smallint       not null default 1 check (parcelas between 1 and 24),
  status               sale_status    not null default 'orcamento',
  data                 date           not null default current_date,
  gateway              text,
  gateway_transacao_id text,
  responsavel_id       uuid           references public.users(id) on delete set null,
  observacoes          text,
  criado_em            timestamptz    not null default now(),
  atualizado_em        timestamptz    not null default now(),
  -- Desconto maior que o valor produziria faturamento negativo.
  constraint desconto_menor_que_total check (desconto <= valor_total)
);

-- payments --------------------------------------------------------------------
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  venda_id             uuid           not null references public.sales(id)   on delete cascade,
  cliente_id           uuid           not null references public.clients(id) on delete restrict,
  valor                bigint         not null check (valor > 0),
  forma_pagamento      payment_method not null,
  status               payment_status not null default 'pendente',
  vencimento           date           not null,
  pago_em              timestamptz,
  gateway              text,
  gateway_transacao_id text,
  criado_em            timestamptz    not null default now(),
  atualizado_em        timestamptz    not null default now(),
  -- Pago sem data de pagamento é dado corrompido esperando para confundir.
  constraint pago_tem_data check (status <> 'pago' or pago_em is not null)
);

-- installments ----------------------------------------------------------------
create table if not exists public.installments (
  id                   uuid primary key default gen_random_uuid(),
  venda_id             uuid           not null references public.sales(id)    on delete cascade,
  pagamento_id         uuid           references public.payments(id)          on delete set null,
  numero               smallint       not null check (numero > 0),
  total_parcelas       smallint       not null check (total_parcelas > 0),
  valor                bigint         not null check (valor > 0),
  vencimento           date           not null,
  status               payment_status not null default 'pendente',
  pago_em              timestamptz,
  gateway              text,
  gateway_transacao_id text,
  criado_em            timestamptz    not null default now(),
  atualizado_em        timestamptz    not null default now(),
  constraint numero_dentro_do_total check (numero <= total_parcelas),
  -- Duas parcelas "2 de 3" na mesma venda seria erro silencioso de duplicação.
  constraint parcela_unica_por_venda unique (venda_id, numero)
);

-- projects --------------------------------------------------------------------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  nome           text           not null check (length(trim(nome)) > 0),
  cliente_id     uuid           not null references public.clients(id)  on delete restrict,
  servico_id     uuid           references public.services(id)          on delete set null,
  venda_id       uuid           references public.sales(id)             on delete set null,
  valor          bigint         not null default 0 check (valor >= 0),
  data_inicio    date,
  prazo          date,
  responsavel_id uuid           references public.users(id)             on delete set null,
  status         project_status not null default 'aguardando_inicio',
  progresso      smallint       not null default 0 check (progresso between 0 and 100),
  observacoes    text,
  criado_em      timestamptz    not null default now(),
  atualizado_em  timestamptz    not null default now()
);

-- conversations ---------------------------------------------------------------
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid                references public.leads(id)     on delete set null,
  cliente_id           uuid                references public.clients(id)   on delete set null,
  telefone             text                not null,
  campanha             text,
  canal                text                not null default 'whatsapp',
  status               conversation_status not null default 'aguardando_resposta',
  etapa_funil          lead_status         not null default 'novo',
  ultima_mensagem      text,
  ultima_mensagem_em   timestamptz,
  mensagens_enviadas   integer             not null default 0 check (mensagens_enviadas >= 0),
  mensagens_recebidas  integer             not null default 0 check (mensagens_recebidas >= 0),
  servico_interesse_id uuid                references public.services(id)  on delete set null,
  valor_potencial      bigint              check (valor_potencial >= 0),
  -- Id da conversa no NinjaBot. UNIQUE para a sincronização poder fazer upsert
  -- sem duplicar quando o mesmo evento chegar duas vezes.
  externo_id           text                unique,
  criado_em            timestamptz         not null default now(),
  atualizado_em        timestamptz         not null default now()
);

-- notifications ---------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tipo        notification_type     not null,
  severidade  notification_severity not null default 'info',
  titulo      text                  not null,
  descricao   text                  not null default '',
  lida        boolean               not null default false,
  link        text,
  criado_em   timestamptz           not null default now()
);

-- webhook_events --------------------------------------------------------------
create table if not exists public.webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  -- A GARANTIA DE IDEMPOTÊNCIA. Não remova este UNIQUE.
  evento_externo_id  text                   not null unique,
  gateway            text                   not null,
  tipo               webhook_event_type     not null,
  status             webhook_process_status not null default 'recebido',
  transacao_id       text,
  venda_id           uuid                   references public.sales(id)    on delete set null,
  pagamento_id       uuid                   references public.payments(id) on delete set null,
  payload            jsonb                  not null default '{}'::jsonb,
  erro               text,
  recebido_em        timestamptz            not null default now(),
  processado_em      timestamptz
);

-- settings --------------------------------------------------------------------
-- Chave/valor em jsonb: preferência nova não exige migração de schema.
create table if not exists public.settings (
  chave         text primary key,
  valor         jsonb       not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- =============================================================================
-- 3. ÍNDICES
-- Cobrem exatamente o que o painel filtra e ordena.
-- =============================================================================

create index if not exists idx_leads_status        on public.leads (status);
create index if not exists idx_leads_data_entrada  on public.leads (data_entrada desc);
create index if not exists idx_leads_origem        on public.leads (origem);
create index if not exists idx_leads_responsavel   on public.leads (responsavel_id);
create index if not exists idx_leads_cliente       on public.leads (cliente_id);

create index if not exists idx_clients_criado      on public.clients (criado_em desc);

create index if not exists idx_sales_cliente       on public.sales (cliente_id);
create index if not exists idx_sales_status        on public.sales (status);
create index if not exists idx_sales_data          on public.sales (data desc);
create index if not exists idx_sales_transacao     on public.sales (gateway_transacao_id);

create index if not exists idx_payments_venda      on public.payments (venda_id);
create index if not exists idx_payments_cliente    on public.payments (cliente_id);
create index if not exists idx_payments_status     on public.payments (status);
create index if not exists idx_payments_vencimento on public.payments (vencimento);
create index if not exists idx_payments_transacao  on public.payments (gateway_transacao_id);

create index if not exists idx_installments_venda      on public.installments (venda_id);
create index if not exists idx_installments_status     on public.installments (status);
create index if not exists idx_installments_vencimento on public.installments (vencimento);

create index if not exists idx_projects_cliente    on public.projects (cliente_id);
create index if not exists idx_projects_status     on public.projects (status);
create index if not exists idx_projects_prazo      on public.projects (prazo);

create index if not exists idx_conversations_lead    on public.conversations (lead_id);
create index if not exists idx_conversations_cliente on public.conversations (cliente_id);
create index if not exists idx_conversations_status  on public.conversations (status);

-- Parcial: o contador do sino só pergunta pelas não lidas.
create index if not exists idx_notifications_nao_lidas on public.notifications (criado_em desc) where not lida;

create index if not exists idx_webhook_events_externo on public.webhook_events (evento_externo_id);
create index if not exists idx_webhook_events_venda   on public.webhook_events (venda_id);

-- =============================================================================
-- 4. TRIGGERS
-- =============================================================================

create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'services', 'leads', 'sales', 'payments',
    'installments', 'projects', 'conversations'
  ]
  loop
    execute format('drop trigger if exists trg_%s_atualizado_em on public.%I', t, t);
    execute format(
      'create trigger trg_%s_atualizado_em before update on public.%I
       for each row execute function public.tocar_atualizado_em()', t, t
    );
  end loop;
end $$;

-- Marca como atrasado tudo que venceu e não foi pago.
-- Chame por cron diário (Supabase → Database → Cron):
--   select cron.schedule('marcar-atrasados', '5 3 * * *', 'select public.marcar_atrasados()');
create or replace function public.marcar_atrasados()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afetados integer;
begin
  update public.payments
     set status = 'atrasado'
   where status = 'pendente' and vencimento < current_date;
  get diagnostics afetados = row_count;

  update public.installments
     set status = 'atrasado'
   where status = 'pendente' and vencimento < current_date;

  return afetados;
end;
$$;

-- =============================================================================
-- 5. ROW LEVEL SECURITY
--
-- Ligado em todas as tabelas. Sem policy que case, a linha simplesmente não
-- existe para aquele usuário — o padrão do Postgres é negar, e é o que
-- queremos.
-- =============================================================================

alter table public.users          enable row level security;
alter table public.clients        enable row level security;
alter table public.services       enable row level security;
alter table public.leads          enable row level security;
alter table public.sales          enable row level security;
alter table public.payments       enable row level security;
alter table public.installments   enable row level security;
alter table public.projects       enable row level security;
alter table public.conversations  enable row level security;
alter table public.notifications  enable row level security;
alter table public.webhook_events enable row level security;
alter table public.settings       enable row level security;

-- Papel do usuário logado.
-- SECURITY DEFINER porque a função precisa ler public.users sem cair na policy
-- da própria tabela — seria recursão infinita.
create or replace function public.papel_atual()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid() and ativo;
$$;

create or replace function public.tem_papel(papeis user_role[])
returns boolean
language sql
stable
as $$
  select public.papel_atual() = any(papeis);
$$;

-- Qualquer pessoa da equipe, autenticada e ativa.
create or replace function public.eh_equipe()
returns boolean
language sql
stable
as $$
  select public.papel_atual() is not null;
$$;

-- ---- users ------------------------------------------------------------------
drop policy if exists users_ler on public.users;
create policy users_ler on public.users
  for select using (public.eh_equipe());

drop policy if exists users_editar_proprio on public.users;
create policy users_editar_proprio on public.users
  for update using (id = auth.uid())
  -- Sem esta segunda condição, qualquer um se promoveria a administrador
  -- editando o próprio perfil.
  with check (id = auth.uid() and role = public.papel_atual());

drop policy if exists users_admin_tudo on public.users;
create policy users_admin_tudo on public.users
  for all using (public.tem_papel(array['administrador']::user_role[]))
  with check (public.tem_papel(array['administrador']::user_role[]));

-- ---- clients ----------------------------------------------------------------
drop policy if exists clients_ler on public.clients;
create policy clients_ler on public.clients
  for select using (public.eh_equipe());

drop policy if exists clients_escrever on public.clients;
create policy clients_escrever on public.clients
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

-- ---- services ---------------------------------------------------------------
drop policy if exists services_ler on public.services;
create policy services_ler on public.services
  for select using (public.eh_equipe());

drop policy if exists services_escrever on public.services;
create policy services_escrever on public.services
  for all using (public.tem_papel(array['administrador', 'financeiro']::user_role[]))
  with check (public.tem_papel(array['administrador', 'financeiro']::user_role[]));

-- ---- leads ------------------------------------------------------------------
-- Colaborador não vê o funil comercial.
drop policy if exists leads_ler on public.leads;
create policy leads_ler on public.leads
  for select using (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]));

drop policy if exists leads_escrever on public.leads;
create policy leads_escrever on public.leads
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

-- ---- sales ------------------------------------------------------------------
drop policy if exists sales_ler on public.sales;
create policy sales_ler on public.sales
  for select using (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]));

drop policy if exists sales_inserir on public.sales;
create policy sales_inserir on public.sales
  for insert with check (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]));

drop policy if exists sales_atualizar on public.sales;
create policy sales_atualizar on public.sales
  for update using (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]));

drop policy if exists sales_apagar on public.sales;
create policy sales_apagar on public.sales
  for delete using (public.tem_papel(array['administrador']::user_role[]));

-- ---- payments e installments ------------------------------------------------
-- Colaborador não enxerga dinheiro.
drop policy if exists payments_ler on public.payments;
create policy payments_ler on public.payments
  for select using (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]));

drop policy if exists payments_escrever on public.payments;
create policy payments_escrever on public.payments
  for all using (public.tem_papel(array['administrador', 'financeiro']::user_role[]))
  with check (public.tem_papel(array['administrador', 'financeiro']::user_role[]));

drop policy if exists installments_ler on public.installments;
create policy installments_ler on public.installments
  for select using (public.tem_papel(array['administrador', 'vendedor', 'financeiro']::user_role[]));

drop policy if exists installments_escrever on public.installments;
create policy installments_escrever on public.installments
  for all using (public.tem_papel(array['administrador', 'financeiro']::user_role[]))
  with check (public.tem_papel(array['administrador', 'financeiro']::user_role[]));

-- ---- projects ---------------------------------------------------------------
drop policy if exists projects_ler on public.projects;
create policy projects_ler on public.projects
  for select using (public.eh_equipe());

drop policy if exists projects_escrever on public.projects;
create policy projects_escrever on public.projects
  for all using (public.tem_papel(array['administrador', 'colaborador']::user_role[]))
  with check (public.tem_papel(array['administrador', 'colaborador']::user_role[]));

-- ---- conversations ----------------------------------------------------------
drop policy if exists conversations_ler on public.conversations;
create policy conversations_ler on public.conversations
  for select using (public.eh_equipe());

drop policy if exists conversations_escrever on public.conversations;
create policy conversations_escrever on public.conversations
  for all using (public.tem_papel(array['administrador', 'vendedor']::user_role[]))
  with check (public.tem_papel(array['administrador', 'vendedor']::user_role[]));

-- ---- notifications ----------------------------------------------------------
drop policy if exists notifications_ler on public.notifications;
create policy notifications_ler on public.notifications
  for select using (public.eh_equipe());

drop policy if exists notifications_atualizar on public.notifications;
create policy notifications_atualizar on public.notifications
  for update using (public.eh_equipe()) with check (public.eh_equipe());

drop policy if exists notifications_admin on public.notifications;
create policy notifications_admin on public.notifications
  for all using (public.tem_papel(array['administrador']::user_role[]))
  with check (public.tem_papel(array['administrador']::user_role[]));

-- ---- webhook_events ---------------------------------------------------------
-- Só leitura, e só para quem administra. A escrita é feita pela função de
-- webhook, que roda com service_role e passa por cima do RLS — nenhum cliente
-- pode inserir evento de pagamento à mão.
drop policy if exists webhook_events_ler on public.webhook_events;
create policy webhook_events_ler on public.webhook_events
  for select using (public.tem_papel(array['administrador', 'financeiro']::user_role[]));

-- ---- settings ---------------------------------------------------------------
drop policy if exists settings_ler on public.settings;
create policy settings_ler on public.settings
  for select using (public.eh_equipe());

drop policy if exists settings_escrever on public.settings;
create policy settings_escrever on public.settings
  for all using (public.tem_papel(array['administrador']::user_role[]))
  with check (public.tem_papel(array['administrador']::user_role[]));

-- =============================================================================
-- 6. CRIAÇÃO AUTOMÁTICA DE PERFIL
--
-- Convidou pelo Supabase Auth, a linha em public.users nasce junto — com o
-- papel MAIS RESTRITO. Promover é um ato consciente do administrador, nunca o
-- padrão.
-- =============================================================================

create or replace function public.criar_perfil_do_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, nome, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'colaborador'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_criar_perfil on auth.users;
create trigger trg_criar_perfil
  after insert on auth.users
  for each row execute function public.criar_perfil_do_usuario();

-- =============================================================================
-- 7. DADOS INICIAIS
--
-- Só o catálogo de serviços, com os preços REAIS da NEXO WEB. Nenhum cliente,
-- lead ou venda fictícia entra em banco de produção.
-- =============================================================================

insert into public.services (nome, descricao, preco, categoria, max_parcelas, ativo)
values
  ('Plano Básico',
   'Site de até 5 páginas, design responsivo, botão WhatsApp, formulário de contato, SEO básico, Google Maps e integração com redes sociais.',
   140000, 'site_institucional', 3, true),
  ('Plano Profissional',
   'Site de até 10 páginas, design personalizado, SEO avançado, Google Analytics, CMS, integrações personalizadas, otimização para conversão e 30 dias de suporte pós-entrega.',
   250000, 'site_institucional', 6, true),
  ('Plano Premium',
   'Site completo, design exclusivo, e-commerce ou funcionalidades avançadas, SEO avançado, Google Analytics e relatórios, automações, integração com IA/WhatsApp e 60 dias de suporte pós-entrega.',
   400000, 'ecommerce', 12, true)
on conflict do nothing;

insert into public.settings (chave, valor)
values
  ('empresa', jsonb_build_object(
    'nome', 'NEXO WEB',
    'descricao', 'Sites profissionais para negócios que querem crescer no digital.',
    'telefone', '5562984747979',
    'email', '',
    'logo_url', null,
    'site', 'https://nexoweb.com.br',
    'instagram', '',
    'linkedin', ''
  )),
  ('notificacoes', jsonb_build_object(
    'nova_venda', true, 'pagamento_aprovado', true, 'pagamento_recusado', true,
    'pagamento_pendente', true, 'parcela_vencendo', true, 'lead_respondeu', true,
    'novo_cliente', true, 'projeto_prazo', true
  ))
on conflict (chave) do nothing;

-- =============================================================================
-- FIM
--
-- Depois de rodar:
--   1. Authentication → Users → convide o seu e-mail.
--   2. update public.users set role = 'administrador' where email = 'SEU@EMAIL';
--      (o gatilho cria como 'colaborador' de propósito)
--   3. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
--   4. VITE_DATA_MODE=production.
-- =============================================================================

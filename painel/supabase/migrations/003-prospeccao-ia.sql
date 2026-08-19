-- =============================================================================
-- MIGRATION 003 — Prospecção automática da NEXO AI
-- =============================================================================
--
-- Adiciona à tabela `leads` os campos que a NEXO AI precisa para prospectar
-- negócios locais (Google Places), analisar o site de cada um e calcular um
-- score de oportunidade — SEM criar nenhuma tabela nova.
--
-- POR QUE REAPROVEITAR `leads` EM VEZ DE UMA TABELA NOVA
--
-- Um lead descoberto pela IA é um lead como outro qualquer: precisa aparecer
-- no Kanban, no funil, ser editável na tela de Leads, poder entrar numa
-- campanha depois. Duplicar em `prospects` (ou similar) criaria dois sistemas
-- de funil — o `lead_status` de 9 etapas que já existe, e outro — duas telas,
-- e uma sincronização que ninguém pediu. Os leads da NEXO AI entram com
-- `status = 'novo'`, igual a qualquer lead cadastrado manualmente, e seguem o
-- MESMO funil que o Kanban, o dashboard e as campanhas já usam.
--
-- "DATA DA DESCOBERTA" NÃO É UMA COLUNA NOVA
--
-- `leads.data_entrada` já registra a data em que o lead entrou no CRM — para
-- um lead descoberto pela IA, a data de descoberta É a data de entrada.
-- Criar `descoberto_em` ao lado seria a mesma informação com dois nomes.
--
-- SEGURANÇA PARA RODAR EM BANCO POPULADO
--
-- Idempotente como as migrations anteriores: `add column if not exists`,
-- `create index if not exists`, `add value if not exists`, checagem de
-- constraint por `pg_constraint` antes de criar. Rodar duas vezes não
-- duplica nem apaga dado. Nenhuma tabela nova, nenhuma policy de RLS nova —
-- RLS é por LINHA, não por coluna, e as policies de `leads` (schema.sql,
-- seção 5) já cobrem os campos novos automaticamente.
--
-- COMO APLICAR
--   Supabase → SQL Editor → cole este arquivo inteiro → Run.
--   Cópia literal da seção 11 de supabase/schema.sql — não há divergência
--   entre os dois arquivos.
-- =============================================================================

-- Origem nova: um lead pode ter sido descoberto pela busca automática da IA,
-- e não só cadastrado manualmente ou vindo de um canal já existente.
alter type lead_origem add value if not exists 'prospeccao_ia';

-- Onde o negócio fica e o que foi pesquisado -----------------------------------
alter table public.leads add column if not exists cidade   text;
alter table public.leads add column if not exists endereco text;
-- Nicho pesquisado (ex.: "clínica de estética"), texto livre vindo do comando
-- dado à NEXO AI — não é o mesmo conceito de `services.categoria`, que é
-- sobre o que a NEXO WEB vende, não sobre o ramo do lead.
alter table public.leads add column if not exists nicho    text;
alter table public.leads add column if not exists site     text;

-- Identificador externo (Google Place ID) --------------------------------------
alter table public.leads add column if not exists place_id text;

comment on column public.leads.place_id is
  'Identificador do negócio na fonte de busca (Google Places). Chave de dedup mais confiável: mesmo place_id = mesmo negócio, sempre. NULL para leads que não vieram de busca automática.';

-- UNIQUE parcial: só entre quem TEM place_id. Leads manuais ou de outras
-- origens nunca preenchem este campo, e não faz sentido exigir unicidade de
-- um monte de NULLs.
create unique index if not exists idx_leads_place_id_unico
  on public.leads (place_id) where place_id is not null;

-- Score de oportunidade ---------------------------------------------------------
alter table public.leads add column if not exists score_oportunidade smallint;
alter table public.leads add column if not exists motivo_score       text;

comment on column public.leads.score_oportunidade is
  '0-100. Calculado por código determinístico (nunca pelo modelo) a partir da análise do site: sem site, site quebrado, sem HTTPS, sem viewport mobile etc. Ver shared/regras-prospeccao.ts.';
comment on column public.leads.motivo_score is
  'Fatores que compuseram o score, em texto legível — nunca só o número, para o vendedor entender a nota sem reabrir a análise técnica.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_score_oportunidade_faixa'
  ) then
    alter table public.leads
      add constraint leads_score_oportunidade_faixa
      check (score_oportunidade is null or score_oportunidade between 0 and 100);
  end if;
end $$;

-- Análise técnica do site -------------------------------------------------------
alter table public.leads add column if not exists analise_site jsonb;
alter table public.leads add column if not exists analisado_em timestamptz;

comment on column public.leads.analise_site is
  'Achados técnicos estruturados de analisar_site (responde? HTTPS? viewport mobile? tempo de resposta? tem CTA?). jsonb para os campos poderem evoluir sem nova migration. NULL enquanto o site não foi analisado, ou quando o lead não tem site.';
comment on column public.leads.analisado_em is
  'Quando analisar_site rodou pela última vez para este lead. NULL = ainda não analisado.';

-- Índices para as buscas que a deduplicação e o dashboard vão fazer -----------
-- Telefone e domínio do site são a 2ª e 3ª linha de defesa do dedup (depois
-- do place_id) — ver shared/regras-prospeccao.ts. Nome + endereço, a 4ª
-- linha, é comparação em código (normalização de texto), não em índice.
create index if not exists idx_leads_telefone
  on public.leads (telefone) where telefone is not null;

create index if not exists idx_leads_site
  on public.leads (lower(site)) where site is not null;

-- "Leads de hoje", melhores primeiro.
create index if not exists idx_leads_score
  on public.leads (score_oportunidade desc) where score_oportunidade is not null;

-- =============================================================================
-- SCHEMA CACHE DO POSTGREST
-- =============================================================================
notify pgrst, 'reload schema';

-- Kavora Kundhjälp, ekonomi och integrationer
-- Idempotent komplettering till kavor-admin-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 100),
  email text not null check (length(trim(email)) between 3 and 200),
  subject text not null check (length(trim(subject)) between 1 and 1000),
  initial_message text,
  transcript jsonb not null default '[]'::jsonb,
  language text not null default 'sv' check (language in ('sv','en','es')),
  status text not null default 'new' check (status in ('new','in_progress','resolved')),
  internal_notes text,
  consent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 months'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_chat_rate_limits (
  session_hash text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null default 'other' check (category in ('software','marketing','services','equipment','other')),
  supplier text,
  description text not null check (length(trim(description)) > 0),
  amount_ex_vat numeric(12,2) not null check (amount_ex_vat >= 0),
  vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0),
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kavora_integrations (
  provider text primary key check (provider in ('app_store_connect','google_play','meta_ads')),
  status text not null default 'not_connected' check (status in ('not_connected','connected','error')),
  last_synced_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.kavora_integrations(provider)
values ('app_store_connect'),('google_play'),('meta_ads')
on conflict (provider) do nothing;

create index if not exists support_cases_status_idx on public.support_cases(status,created_at desc);
create index if not exists support_cases_email_idx on public.support_cases(lower(email));
create index if not exists business_expenses_date_idx on public.business_expenses(expense_date desc);

drop trigger if exists touch_support_cases on public.support_cases;
create trigger touch_support_cases before update on public.support_cases
for each row execute function public.touch_updated_at();

drop trigger if exists touch_support_chat_rate_limits on public.support_chat_rate_limits;
create trigger touch_support_chat_rate_limits before update on public.support_chat_rate_limits
for each row execute function public.touch_updated_at();

drop trigger if exists touch_business_expenses on public.business_expenses;
create trigger touch_business_expenses before update on public.business_expenses
for each row execute function public.touch_updated_at();

drop trigger if exists touch_kavora_integrations on public.kavora_integrations;
create trigger touch_kavora_integrations before update on public.kavora_integrations
for each row execute function public.touch_updated_at();

alter table public.support_cases enable row level security;
alter table public.support_chat_rate_limits enable row level security;
alter table public.business_expenses enable row level security;
alter table public.kavora_integrations enable row level security;

grant select,insert,update,delete on public.support_cases to authenticated;
grant select,insert,update,delete on public.business_expenses to authenticated;
grant select,update on public.kavora_integrations to authenticated;

drop policy if exists "Kavor admins manage support cases" on public.support_cases;
create policy "Kavor admins manage support cases" on public.support_cases
for all to authenticated using (public.is_kavor_admin()) with check (public.is_kavor_admin());

drop policy if exists "Kavor admins manage business expenses" on public.business_expenses;
create policy "Kavor admins manage business expenses" on public.business_expenses
for all to authenticated using (public.is_kavor_admin()) with check (public.is_kavor_admin());

drop policy if exists "Kavor admins read integrations" on public.kavora_integrations;
create policy "Kavor admins read integrations" on public.kavora_integrations
for select to authenticated using (public.is_kavor_admin());

drop policy if exists "Kavor admins update integrations" on public.kavora_integrations;
create policy "Kavor admins update integrations" on public.kavora_integrations
for update to authenticated using (public.is_kavor_admin()) with check (public.is_kavor_admin());

-- support_chat_rate_limits och publika insättningar i support_cases görs endast
-- av Edge Function med service role. Anon får därför inga tabellrättigheter.
revoke all on public.support_chat_rate_limits from anon, authenticated;
revoke all on public.support_cases from anon;

create or replace function public.cleanup_expired_support_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.support_cases where expires_at < now();
  get diagnostics deleted_count = row_count;
  delete from public.support_chat_rate_limits where updated_at < now() - interval '2 days';
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_support_data() from public;
grant execute on function public.cleanup_expired_support_data() to service_role;

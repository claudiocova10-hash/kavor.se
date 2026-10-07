-- Kavor account and business-licence schema for Supabase.
-- Run this file once in the Supabase SQL editor.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  preferred_language text not null default 'sv' check (preferred_language in ('sv','en','es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activation_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text not null,
  quantity integer not null check (quantity > 0),
  license_days integer not null default 365 check (license_days between 1 and 3660),
  activate_by timestamptz not null,
  status text not null default 'active' check (status in ('active','paused','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.activation_codes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.activation_batches(id) on delete restrict,
  code_hash text not null unique check (length(code_hash)=64),
  code_suffix text not null check (length(code_suffix)=4),
  status text not null default 'unused' check (status in ('unused','redeemed','revoked')),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint redeemed_fields_match_status check (
    (status='redeemed' and redeemed_by is not null and redeemed_at is not null)
    or status<>'redeemed'
  )
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  source text not null check (source in ('business_code','manual_support')),
  source_reference uuid,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until > valid_from)
);

create table if not exists private.activation_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null default false
);

alter table private.activation_attempts enable row level security;

alter table public.profiles enable row level security;
alter table public.activation_batches enable row level security;
alter table public.activation_codes enable row level security;
alter table public.entitlements enable row level security;

revoke all on public.activation_batches from anon, authenticated;
revoke all on public.activation_codes from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.entitlements from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(preferred_language,updated_at) on public.profiles to authenticated;
grant select on public.entitlements to authenticated;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated
using ((select auth.uid())=id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated
using ((select auth.uid())=id) with check ((select auth.uid())=id);

drop policy if exists "Users read own entitlements" on public.entitlements;
create policy "Users read own entitlements" on public.entitlements for select to authenticated
using ((select auth.uid())=user_id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profiles(id) values(new.id) on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.redeem_activation_code_internal(p_code text)
returns table(result text, valid_until timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_normalized text;
  v_hash text;
  v_code record;
  v_attempt_id bigint;
  v_current_until timestamptz;
  v_new_until timestamptz;
begin
  if v_user_id is null then
    return query select 'not_authenticated'::text,null::timestamptz;
    return;
  end if;

  -- Serialize redemptions for the same account so two simultaneous requests
  -- cannot consume two codes while only extending the entitlement once.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text,0));

  if (select count(*) from private.activation_attempts
      where user_id=v_user_id and success=false and attempted_at>now()-interval '15 minutes')>=10 then
    return query select 'rate_limited'::text,null::timestamptz;
    return;
  end if;

  insert into private.activation_attempts(user_id) values(v_user_id) returning id into v_attempt_id;
  v_normalized:=upper(regexp_replace(trim(coalesce(p_code,'')),'[^A-Z0-9]','','g'));
  if length(v_normalized)<16 or length(v_normalized)>32 then
    return query select 'invalid'::text,null::timestamptz;
    return;
  end if;
  v_hash:=encode(extensions.digest(v_normalized,'sha256'),'hex');

  select c.id,c.status,c.redeemed_by,b.id as batch_id,b.license_days,b.activate_by,b.status as batch_status
  into v_code
  from public.activation_codes c
  join public.activation_batches b on b.id=c.batch_id
  where c.code_hash=v_hash
  for update of c;

  if not found or v_code.batch_status<>'active' or v_code.activate_by<now() or v_code.status='revoked' then
    return query select 'invalid'::text,null::timestamptz;
    return;
  end if;

  if v_code.status='redeemed' then
    if v_code.redeemed_by=v_user_id then
      select e.valid_until into v_current_until from public.entitlements e where e.user_id=v_user_id;
      update private.activation_attempts set success=true where id=v_attempt_id;
      return query select 'already_redeemed'::text,v_current_until;
    else
      return query select 'invalid'::text,null::timestamptz;
    end if;
    return;
  end if;

  select e.valid_until into v_current_until
  from public.entitlements e
  where e.user_id=v_user_id and e.status='active'
  for update;
  v_new_until:=greatest(coalesce(v_current_until,now()),now())+make_interval(days=>v_code.license_days);

  insert into public.entitlements(user_id,source,source_reference,status,valid_from,valid_until)
  values(v_user_id,'business_code',v_code.batch_id,'active',now(),v_new_until)
  on conflict(user_id) do update set
    source='business_code',source_reference=excluded.source_reference,status='active',
    valid_until=excluded.valid_until,updated_at=now();

  update public.activation_codes set status='redeemed',redeemed_by=v_user_id,redeemed_at=now() where id=v_code.id;
  update private.activation_attempts set success=true where id=v_attempt_id;
  return query select 'activated'::text,v_new_until;
end;
$$;

create or replace function public.redeem_activation_code(p_code text)
returns table(result text, valid_until timestamptz)
language sql
security invoker
set search_path=''
as $$ select * from private.redeem_activation_code_internal(p_code) $$;

revoke all on function public.redeem_activation_code(text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.redeem_activation_code_internal(text) to authenticated;
grant execute on function public.redeem_activation_code(text) to authenticated;

notify pgrst,'reload schema';

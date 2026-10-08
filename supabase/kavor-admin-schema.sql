-- Kavora – Kavors adminassistent
-- Kör hela filen en gång i Supabase SQL Editor.
-- Filen är idempotent och kan köras igen vid framtida uppdateringar.

create extension if not exists pgcrypto;

create table if not exists public.kavor_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.kavor_admins enable row level security;

create or replace function public.is_kavor_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kavor_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_kavor_admin() from public;
grant execute on function public.is_kavor_admin() to authenticated;

drop policy if exists "Admins can read their own admin row" on public.kavor_admins;
create policy "Admins can read their own admin row"
on public.kavor_admins for select to authenticated
using (user_id = auth.uid());

create table if not exists public.business_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  org_number text,
  contact_name text,
  email text,
  phone text,
  billing_email text,
  billing_address text,
  postal_code text,
  city text,
  country text not null default 'Sverige',
  status text not null default 'lead' check (status in ('lead','active','paused')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.business_companies(id) on delete restrict,
  package_months integer not null check (package_months in (6,12)),
  quantity integer not null check (quantity > 0),
  unit_price_sek numeric(12,2) not null check (unit_price_sek >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  invoice_reference text,
  due_date date,
  status text not null default 'draft' check (status in ('draft','invoice_ready','sent','paid','licenses_delivered','cancelled')),
  ordered_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.business_companies(id) on delete cascade,
  order_id uuid references public.business_orders(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  due_date date not null,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'open' check (status in ('open','done')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.business_companies(id) on delete cascade,
  order_id uuid references public.business_orders(id) on delete set null,
  category text not null check (category in ('quote_agreement','order','invoice','license_codes','communication','other')),
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.business_license_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.business_companies(id) on delete restrict,
  order_id uuid not null references public.business_orders(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  duration_months integer not null check (duration_months in (6,12)),
  status text not null default 'planned' check (status in ('planned','generated','delivered','cancelled')),
  delivered_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique(order_id)
);

create index if not exists business_companies_name_idx on public.business_companies using btree(name);
create index if not exists business_orders_company_idx on public.business_orders(company_id);
create index if not exists business_orders_status_idx on public.business_orders(status);
create index if not exists business_tasks_due_idx on public.business_tasks(status,due_date);
create index if not exists business_documents_company_idx on public.business_documents(company_id,category);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_business_companies on public.business_companies;
create trigger touch_business_companies before update on public.business_companies
for each row execute function public.touch_updated_at();

drop trigger if exists touch_business_orders on public.business_orders;
create trigger touch_business_orders before update on public.business_orders
for each row execute function public.touch_updated_at();

drop trigger if exists touch_business_tasks on public.business_tasks;
create trigger touch_business_tasks before update on public.business_tasks
for each row execute function public.touch_updated_at();

alter table public.business_companies enable row level security;
alter table public.business_orders enable row level security;
alter table public.business_tasks enable row level security;
alter table public.business_documents enable row level security;
alter table public.business_license_batches enable row level security;

grant select on public.kavor_admins to authenticated;
grant select,insert,update,delete on public.business_companies to authenticated;
grant select,insert,update,delete on public.business_orders to authenticated;
grant select,insert,update,delete on public.business_tasks to authenticated;
grant select,insert,update,delete on public.business_documents to authenticated;
grant select,insert,update,delete on public.business_license_batches to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['business_companies','business_orders','business_tasks','business_documents','business_license_batches']
  loop
    execute format('drop policy if exists "Kavor admins manage %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "Kavor admins manage %s" on public.%I for all to authenticated using (public.is_kavor_admin()) with check (public.is_kavor_admin())',
      table_name,
      table_name
    );
  end loop;
end $$;

insert into storage.buckets (id,name,public,file_size_limit)
values ('kavor-business-documents','kavor-business-documents',false,20971520)
on conflict (id) do update set public=false,file_size_limit=20971520;

drop policy if exists "Kavor admins upload business documents" on storage.objects;
create policy "Kavor admins upload business documents"
on storage.objects for insert to authenticated
with check (bucket_id='kavor-business-documents' and public.is_kavor_admin());

drop policy if exists "Kavor admins read business documents" on storage.objects;
create policy "Kavor admins read business documents"
on storage.objects for select to authenticated
using (bucket_id='kavor-business-documents' and public.is_kavor_admin());

drop policy if exists "Kavor admins update business documents" on storage.objects;
create policy "Kavor admins update business documents"
on storage.objects for update to authenticated
using (bucket_id='kavor-business-documents' and public.is_kavor_admin())
with check (bucket_id='kavor-business-documents' and public.is_kavor_admin());

drop policy if exists "Kavor admins delete business documents" on storage.objects;
create policy "Kavor admins delete business documents"
on storage.objects for delete to authenticated
using (bucket_id='kavor-business-documents' and public.is_kavor_admin());

-- Lägg till Claudio efter att han har loggat in minst en gång.
-- Ersätt värdet och kör raden separat:
-- insert into public.kavor_admins(user_id,display_name)
-- values ('DIN-KOPIERADE-ANVANDAR-ID-HÄR','Claudio')
-- on conflict (user_id) do update set display_name=excluded.display_name;

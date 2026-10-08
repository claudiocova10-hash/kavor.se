-- Kavora Ekonomiassistent
-- Kör hela filen en gång i Supabase SQL Editor. Filen kan köras igen.

alter table public.business_expenses
  add column if not exists status text not null default 'missing_receipt',
  add column if not exists payment_method text not null default 'card',
  add column if not exists vat_rate numeric(5,2) not null default 25,
  add column if not exists receipt_storage_path text,
  add column if not exists receipt_file_name text,
  add column if not exists receipt_mime_type text,
  add column if not exists receipt_file_size bigint,
  add column if not exists booked_at timestamptz;

update public.business_expenses
set status = case when receipt_storage_path is null then 'missing_receipt' else 'ready' end
where status is null or status not in ('missing_receipt','ready','booked');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'business_expenses_status_check'
      and conrelid = 'public.business_expenses'::regclass
  ) then
    alter table public.business_expenses
      add constraint business_expenses_status_check
      check (status in ('missing_receipt','ready','booked'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'business_expenses_payment_method_check'
      and conrelid = 'public.business_expenses'::regclass
  ) then
    alter table public.business_expenses
      add constraint business_expenses_payment_method_check
      check (payment_method in ('card','invoice','bank','private','other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'business_expenses_receipt_size_check'
      and conrelid = 'public.business_expenses'::regclass
  ) then
    alter table public.business_expenses
      add constraint business_expenses_receipt_size_check
      check (receipt_file_size is null or receipt_file_size between 0 and 20971520);
  end if;
end $$;

create index if not exists business_expenses_status_date_idx
  on public.business_expenses(status,expense_date desc);

create index if not exists business_expenses_period_idx
  on public.business_expenses((date_trunc('month',expense_date::timestamp)));

comment on table public.business_expenses is
  'Kavors privata kostnadsinkorg. Underlag lagras i den privata bucketen kavor-business-documents under _ekonomi/år/månad/kategori.';

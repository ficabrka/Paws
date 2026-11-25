-- Paws v5: ads in the feed (businesses create them in the app, you approve them).
-- Run once after supabase_v4.sql. Safe to run again.

create table if not exists public.ads (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  business     text not null check (char_length(business) between 1 and 40),
  title        text not null check (char_length(title) between 1 and 60),
  body         text check (char_length(body) <= 160),
  image_path   text,
  link         text,
  phone        text,
  email        text,
  country_code text,
  city         text,                       -- null = whole country
  plan         text not null check (plan in ('7d', '30d', '90d')),
  pay_terms    text not null check (pay_terms in ('standard', 'invoice', 'installments', 'shelter', 'custom')),
  terms_note   text,
  price_rsd    int,
  status       text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'ended')),
  active_until timestamptz,
  views        int not null default 0,
  clicks       int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.ads enable row level security;

-- everyone sees live ads; owners also see their own (pending, rejected, ended)
drop policy if exists ads_read on public.ads;
create policy ads_read on public.ads for select
  using ((status = 'active' and active_until > now()) or owner_id = auth.uid());
-- anyone signed in can send an ad, but it always starts as pending and unpaid
drop policy if exists ads_insert on public.ads;
create policy ads_insert on public.ads for insert
  with check (owner_id = auth.uid() and status = 'pending' and active_until is null and views = 0 and clicks = 0);
drop policy if exists ads_delete on public.ads;
create policy ads_delete on public.ads for delete using (owner_id = auth.uid() and status <> 'active');
revoke update on public.ads from anon, authenticated;

-- view / click counters (called by the app)
create or replace function public.ad_event(p_id uuid, p_kind text) returns void
language sql security definer set search_path = public as $$
  update ads set views  = views  + case when p_kind = 'view'  then 1 else 0 end,
                 clicks = clicks + case when p_kind = 'click' then 1 else 0 end
  where id = p_id and status = 'active';
$$;
grant execute on function public.ad_event(uuid, text) to anon, authenticated;

-- HOW TO APPROVE AN AD after payment (Table Editor → ads, or run):
--   update public.ads set status = 'active',
--          active_until = now() + case plan when '7d' then interval '7 days' when '30d' then interval '30 days' else interval '90 days' end
--   where id = '<ad id>';
-- Reject: update public.ads set status = 'rejected' where id = '<ad id>';

notify pgrst, 'reload schema';

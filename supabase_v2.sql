-- Paws v2: contact, song, city/country/monthly/yearly competition, stricter animal check.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- 1) Contact and song on each post
alter table public.pets add column if not exists contact_phone text;
alter table public.pets add column if not exists contact_apps  text[];
alter table public.pets add column if not exists song_id     bigint;
alter table public.pets add column if not exists song_title  text;
alter table public.pets add column if not exists song_artist text;
alter table public.pets add column if not exists song_cover  text;

alter table public.pets drop constraint if exists pets_contact_phone_chk;
alter table public.pets add constraint pets_contact_phone_chk
  check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()./-]{6,22}$');

revoke update on public.pets from anon, authenticated;
grant update (name, city, caption, contact_phone, contact_apps, song_id, song_title, song_artist, song_cover)
  on public.pets to authenticated;

create index if not exists pets_country_idx on public.pets (country_code, paws_count desc);
create index if not exists pets_city_idx    on public.pets (country_code, lower(trim(city)), paws_count desc);

-- 2) Server-side guard: only posts the on-phone check accepted as an animal
create or replace function public.pets_animal_guard() returns trigger
language plpgsql as $$
begin
  if new.ai_label is null or new.ai_label !~ '^[0-9]+$'
     or new.ai_label::int > 397 or coalesce(new.ai_confidence, 0) < 0.5 then
    raise exception 'not_an_animal' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists pets_animal_guard on public.pets;
create trigger pets_animal_guard before insert on public.pets
  for each row execute function public.pets_animal_guard();

-- remove the price-list photo that slipped through the old check
update public.pets set status = 'removed' where id = '4213fcd7-2a38-42ed-821b-8bfda6008d6c';
delete from public.pets where id = 'fa79fb77-5e88-4085-9843-9785733809d0'; -- test row from my check of the Moji tab

-- 3) Monthly city winners and the yearly final
create table if not exists public.monthly_winners (
  month_start  date not null,
  country_code text not null,
  city         text not null,
  pet_id       uuid not null references public.pets(id) on delete cascade,
  paws         int  not null,
  primary key (month_start, country_code, city)
);
create table if not exists public.yearly_winners (
  year   int  not null,
  scope  text not null,            -- 'world' or 'country:RS'
  pet_id uuid not null references public.pets(id) on delete cascade,
  paws   int  not null,
  primary key (year, scope)
);
alter table public.monthly_winners enable row level security;
alter table public.yearly_winners  enable row level security;
drop policy if exists monthly_read on public.monthly_winners;
create policy monthly_read on public.monthly_winners for select using (true);
drop policy if exists yearly_read on public.yearly_winners;
create policy yearly_read on public.yearly_winners for select using (true);

-- paws a pet got in one period, per city (used by the app for "best in my city this month")
create or replace function public.city_top(p_cc text, p_city text, p_from timestamptz, p_limit int default 30)
returns table (pet_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select p.id, count(w.pet_id) as n
  from pets p join paws w on w.pet_id = p.id and w.created_at >= p_from
  where p.status = 'active' and p.country_code = p_cc and lower(trim(p.city)) = lower(trim(p_city))
  group by p.id order by n desc limit least(p_limit, 100);
$$;
grant execute on function public.city_top(text, text, timestamptz, int) to anon, authenticated;

-- runs on the 1st of every month: winner of each city for the month that just ended
create or replace function public.compute_monthly_winners() returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', now() - interval '1 day')::date;
begin
  insert into monthly_winners (month_start, country_code, city, pet_id, paws)
  select distinct on (x.country_code, lower(x.city)) m, x.country_code, x.city, x.id, x.n
  from (
    select p.id, p.country_code, initcap(trim(p.city)) as city, count(*)::int as n
    from pets p join paws w on w.pet_id = p.id
    where p.status = 'active' and p.country_code is not null and coalesce(trim(p.city), '') <> ''
      and w.created_at >= m and w.created_at < m + interval '1 month'
    group by p.id
  ) x
  order by x.country_code, lower(x.city), x.n desc
  on conflict (month_start, country_code, city) do update set pet_id = excluded.pet_id, paws = excluded.paws;
end $$;

-- runs on 1 January: the final. City winners of January–November compete in December.
create or replace function public.compute_yearly_winners() returns void
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now() - interval '1 day')::int;
        d0 timestamptz := make_timestamptz(y, 12, 1, 0, 0, 0, 'UTC');
        d1 timestamptz := make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'UTC');
begin
  with fin as (
    select distinct pet_id from monthly_winners
    where month_start >= make_date(y, 1, 1) and month_start < make_date(y, 12, 1)
  ), score as (
    select p.id, p.country_code, count(w.pet_id)::int as n
    from fin join pets p on p.id = fin.pet_id and p.status = 'active'
    left join paws w on w.pet_id = p.id and w.created_at >= d0 and w.created_at < d1
    group by p.id
  )
  insert into yearly_winners (year, scope, pet_id, paws)
  select * from (
    (select y, 'world', id, n from score order by n desc limit 1)
    union all
    (select distinct on (country_code) y, 'country:' || country_code, id, n
       from score where country_code is not null order by country_code, n desc)
  ) t
  on conflict (year, scope) do update set pet_id = excluded.pet_id, paws = excluded.paws;
end $$;

select cron.unschedule('paws-monthly-winners') where exists (select 1 from cron.job where jobname = 'paws-monthly-winners');
select cron.schedule('paws-monthly-winners', '5 0 1 * *', $$select public.compute_monthly_winners()$$);
select cron.unschedule('paws-yearly-winners') where exists (select 1 from cron.job where jobname = 'paws-yearly-winners');
select cron.schedule('paws-yearly-winners', '20 0 1 1 *', $$select public.compute_yearly_winners()$$);

notify pgrst, 'reload schema';

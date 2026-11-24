-- Paws v3: invite bonus (5 friends through your link = 24 h at the top).
-- Run once in Supabase → SQL Editor, after supabase_v2.sql. Safe to run again.

alter table public.paws add column if not exists via text;
alter table public.paws drop constraint if exists paws_via_chk;
alter table public.paws add constraint paws_via_chk check (via is null or via in ('app', 'link'));

alter table public.pets add column if not exists link_paws int not null default 0;
alter table public.pets add column if not exists invite_bonus_at timestamptz;

-- count paws that came through a shared link; the 5th one puts the pet on top for 24 hours (once per post)
create or replace function public.on_link_paw() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; b timestamptz;
begin
  if tg_op = 'INSERT' and new.via = 'link' then
    update pets set link_paws = link_paws + 1 where id = new.pet_id returning link_paws, invite_bonus_at into n, b;
    if n >= 5 and b is null then
      update pets set invite_bonus_at = now(),
        featured_until = greatest(coalesce(featured_until, now()), now()) + interval '24 hours'
      where id = new.pet_id;
    end if;
  elsif tg_op = 'DELETE' and old.via = 'link' then
    update pets set link_paws = greatest(link_paws - 1, 0) where id = old.pet_id;
  end if;
  return null;
end $$;

drop trigger if exists paws_link on public.paws;
create trigger paws_link after insert or delete on public.paws
  for each row execute function public.on_link_paw();

notify pgrst, 'reload schema';

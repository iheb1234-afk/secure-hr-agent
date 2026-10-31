-- Migration 02: interview scheduling (run once in Supabase SQL Editor)

alter table public.drafts add column if not exists slots jsonb not null default '[]';

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'busy' check (kind in ('busy','interview')),
  status text not null default 'confirmed' check (status in ('proposed','confirmed')),
  candidate_id uuid references public.candidates(id) on delete cascade,
  draft_id uuid references public.drafts(id) on delete cascade,
  created_at timestamptz default now()
);

alter table public.calendar_events enable row level security;
drop policy if exists "calendar_all" on public.calendar_events;
create policy "calendar_all" on public.calendar_events for all to authenticated
  using (public.my_role() in ('recruiter','admin'))
  with check (public.my_role() in ('recruiter','admin'));

-- Fictional recruiter calendar for NEXT week (Tunis time = UTC+1)
delete from public.calendar_events where kind = 'busy';
with mon as (select (date_trunc('week', now() at time zone 'Africa/Tunis') + interval '7 days') as d)
insert into public.calendar_events (title, starts_at, ends_at, kind)
select t.title,
       ((select d from mon) + t.day * interval '1 day' + t.h_start * interval '1 hour') at time zone 'Africa/Tunis',
       ((select d from mon) + t.day * interval '1 day' + t.h_end   * interval '1 hour') at time zone 'Africa/Tunis',
       'busy'
from (values
  ('Weekly HR team meeting', 0, 9, 11),
  ('Lunch with hiring manager', 0, 12, 14),
  ('Onboarding session', 1, 9, 12),
  ('Payroll review', 1, 14, 17),
  ('Interview (other role)', 2, 10, 11),
  ('Training: labour law update', 3, 9, 13),
  ('Interview (other role)', 3, 15, 16),
  ('Monthly reporting', 4, 14, 17)
) as t(title, day, h_start, h_end);

-- Migration 06: candidate follow-ups (run once in Supabase SQL Editor)

-- 1) New draft kind: a reminder to a candidate who has not answered
alter table public.drafts drop constraint if exists drafts_kind_check;
alter table public.drafts add constraint drafts_kind_check
  check (kind in ('invite','rejection','request_info','follow_up'));

-- 2) A reminder points to the message it follows up on
alter table public.drafts add column if not exists followup_of uuid references public.drafts(id) on delete cascade;

-- 3) At most ONE reminder waiting for approval per original message (two clicks can't create two)
create unique index if not exists drafts_one_pending_followup
  on public.drafts (followup_of) where status = 'pending' and kind = 'follow_up';

-- 4) The recruiter records that the candidate answered: no more reminders after that
alter table public.candidates add column if not exists replied_at timestamptz;

-- Table privileges from migration_05 still apply: the browser stays read-only on these columns.

-- Secure HR Agent — database schema + Row Level Security
-- Paste in Supabase: SQL Editor → New query → Run

-- ========== PROFILES (roles) ==========
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'recruiter' check (role in ('recruiter','admin')),
  created_at timestamptz default now()
);

-- auto-create a profile for every new user (default role = recruiter)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- backfill users created before this script ran
insert into public.profiles (id, email)
select id, email from auth.users on conflict (id) do nothing;

-- helper: role of the current user
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ========== JOBS ==========
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  criteria jsonb not null default '[]',      -- list of job-related criteria
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now()
);

-- ========== CANDIDATES ==========
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  code text not null,                         -- anonymous label, e.g. C-07
  file_name text not null,
  full_name text,                             -- PII: kept for the reply only, never sent to the AI
  email text,                                 -- PII: idem
  visible_text text not null,                 -- text a human sees in the CV
  anonymized_text text not null,              -- what the AI sees (PII removed, hidden text removed)
  hidden_text text,                           -- text invisible to humans (white / tiny / off-page)
  injection_flag boolean not null default false,
  injection_reasons jsonb not null default '[]',
  score int check (score between 0 and 100),
  justification text,
  matched_criteria jsonb default '[]',
  missing_criteria jsonb default '[]',
  status text not null default 'new'
    check (status in ('new','flagged','ranked','shortlisted','rejected','review')),
  created_at timestamptz default now()
);

-- ========== REPLY DRAFTS (approval queue) ==========
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  kind text not null check (kind in ('invite','rejection','request_info')),
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent','discarded')),
  created_by uuid references auth.users(id) default auth.uid(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz default now()
);

-- ========== AUDIT LOG (append-only) ==========
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) default auth.uid(),
  actor_type text not null check (actor_type in ('human','ai','system')),
  action text not null,
  entity text,
  entity_id text,
  details jsonb default '{}',
  created_at timestamptz default now()
);

-- ========== ROW LEVEL SECURITY ==========
alter table public.profiles  enable row level security;
alter table public.jobs      enable row level security;
alter table public.candidates enable row level security;
alter table public.drafts    enable row level security;
alter table public.audit_log enable row level security;

-- profiles: you see your own profile; admins see all. Nobody can change roles from the app.
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');

-- jobs / candidates / drafts: only logged-in HR staff (recruiter or admin)
drop policy if exists "jobs_all" on public.jobs;
create policy "jobs_all" on public.jobs for all to authenticated
  using (public.my_role() in ('recruiter','admin'))
  with check (public.my_role() in ('recruiter','admin'));

drop policy if exists "candidates_all" on public.candidates;
create policy "candidates_all" on public.candidates for all to authenticated
  using (public.my_role() in ('recruiter','admin'))
  with check (public.my_role() in ('recruiter','admin'));

-- only admins can delete candidates
drop policy if exists "candidates_no_delete" on public.candidates;
create policy "candidates_no_delete" on public.candidates as restrictive for delete to authenticated
  using (public.my_role() = 'admin');

drop policy if exists "drafts_all" on public.drafts;
create policy "drafts_all" on public.drafts for all to authenticated
  using (public.my_role() in ('recruiter','admin'))
  with check (public.my_role() in ('recruiter','admin'));

-- audit log: anyone logged in can ADD entries (as themselves); only admins can READ; nobody can edit or delete
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_insert" on public.audit_log for insert to authenticated
  with check (actor = auth.uid());

drop policy if exists "audit_read_admin" on public.audit_log;
create policy "audit_read_admin" on public.audit_log for select to authenticated
  using (public.my_role() = 'admin');

-- make the admin account an admin (change the email if needed)
update public.profiles set role = 'admin' where email = 'admin@demo.tn';

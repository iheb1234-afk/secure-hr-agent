-- Migration 05: lockdown (after the independent security audit)
-- Run ONLY after the new app version is live (it writes with the server-only key).

-- 1) New "employee" role, and least privilege by default: a new account is an employee, not a recruiter
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('employee','recruiter','admin'));
alter table public.profiles alter column role set default 'employee';

-- 2) The browser becomes READ-ONLY. All writes go through the API routes (role check, validation,
--    approval gate, audit log), which use the server-only service key. RLS still filters every read.
revoke insert, update, delete, truncate on
  public.profiles, public.jobs, public.candidates, public.drafts, public.audit_log,
  public.calendar_events, public.inbox_emails, public.policy_sections, public.employee_questions
from anon, authenticated;

-- 3) Nothing at all for anonymous visitors
revoke select on
  public.profiles, public.jobs, public.candidates, public.drafts, public.audit_log,
  public.calendar_events, public.inbox_emails, public.policy_sections, public.employee_questions
from anon;

-- Check: should list only SELECT for 'authenticated'
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' order by table_name, privilege_type;

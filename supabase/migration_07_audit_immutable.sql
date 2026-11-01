-- Migration 07: make the audit log truly append-only.
-- RLS already refuses edits/deletes from the app, but the server's service key and the
-- project owner bypass RLS. A trigger runs for EVERYONE, service key included.

create or replace function public.audit_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op;
end;
$$;

drop trigger if exists audit_log_no_update_delete on public.audit_log;
create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- Check (should fail with "audit_log is append-only: DELETE is not allowed"):
-- delete from public.audit_log where id = (select min(id) from public.audit_log);

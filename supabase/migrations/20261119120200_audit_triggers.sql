-- F-04: auditoría de cambios en tablas sensibles.
-- El trigger corre con security definer porque ningún rol de usuario tiene
-- INSERT sobre audit_log.

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (
    coalesce(auth.uid()::text, 'system:' || session_user),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new))
  );
  return null;
end;
$$;

revoke all on function private.audit_row_change() from public, anon, authenticated;

create trigger audit_exceptions
  after insert or update or delete on public.exceptions
  for each row execute function private.audit_row_change();

create trigger audit_user_roles
  after insert or update or delete on public.user_roles
  for each row execute function private.audit_row_change();

create trigger audit_indicators
  after insert or update or delete on public.indicators
  for each row execute function private.audit_row_change();

create trigger audit_commitments
  after insert or update or delete on public.commitments
  for each row execute function private.audit_row_change();

-- updated_at de commitments
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger commitments_touch_updated_at
  before update on public.commitments
  for each row execute function private.touch_updated_at();

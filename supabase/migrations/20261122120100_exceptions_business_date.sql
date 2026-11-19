-- C-02 (revisión, H-C02-04 / H-C02-QA-03): la fecha de negocio es la de
-- America/Guayaquil, no current_date (UTC en Supabase). Aditiva: reemplaza la
-- función del trigger y la política de inserción; no toca datos.

create or replace function private.enforce_exception_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'America/Guayaquil')::date;
  max_expiry date;
begin
  -- Solo usuarios finales; el backend y las migraciones son de confianza.
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- Sin rol de comité no hay nada que validar: RLS rechaza la escritura.
  if uid is null or not private.has_role('committee') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.approved_by is distinct from uid or new.expires_on < today then
      return new; -- la política exceptions_insert la rechaza con 42501
    end if;
    new.created_at := now();
    new.revoked_at := null;
    new.revoked_by := null;
  else
    if new.approved_by is distinct from old.approved_by then
      raise exception 'La firma de una excepción (approved_by) no se puede cambiar'
        using errcode = '42501';
    end if;
    if new.created_at is distinct from old.created_at or new.revoked_by is distinct from old.revoked_by then
      raise exception 'created_at y revoked_by no se editan' using errcode = '42501';
    end if;
    if old.approved_by is distinct from uid then
      raise exception 'Solo quien aprobó la excepción puede editarla'
        using errcode = '42501';
    end if;
    if old.revoked_at is not null then
      raise exception 'Una excepción revocada ya no se edita' using errcode = '42501';
    end if;
    if new.revoked_at is not null then
      -- Revocar: la hora y el autor los fija el servidor.
      new.revoked_at := now();
      new.revoked_by := uid;
    end if;
  end if;

  -- En UPDATE solo se exige si cambia el alcance o el change: las filas
  -- anteriores a C-02 (sin change_ref) se pueden acortar o revocar.
  if new.scope = 'change_start'
     and (new.change_ref is null or length(trim(new.change_ref)) = 0)
     and (tg_op = 'INSERT' or new.scope is distinct from old.scope or new.change_ref is distinct from old.change_ref) then
    raise exception 'Una excepción change_start debe indicar el change autorizado (change_ref)'
      using errcode = '23514';
  end if;

  max_expiry := (new.created_at at time zone 'America/Guayaquil')::date + private.exception_max_days();
  -- Acortar siempre se permite; crear o alargar respeta el tope.
  if (tg_op = 'INSERT' or new.expires_on > old.expires_on) and new.expires_on > max_expiry then
    raise exception 'La vigencia máxima de una excepción es de % días (hasta %)',
      private.exception_max_days(), max_expiry
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.expires_on is distinct from old.expires_on and new.expires_on < today then
    raise exception 'El nuevo vencimiento no puede quedar en el pasado; para terminarla, revócala'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_exception_rules() from public, anon, authenticated;

drop policy exceptions_insert on public.exceptions;
create policy exceptions_insert on public.exceptions for insert to authenticated
  with check (
    (select private.has_role('committee'))
    and approved_by = (select auth.uid())
    and expires_on >= (now() at time zone 'America/Guayaquil')::date
  );

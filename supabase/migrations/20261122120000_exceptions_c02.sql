-- C-02: excepciones aprobadas por el comité (aditiva).
-- - change_ref: qué change concreto autoriza una excepción change_start
--   (ADR 0003, decisión 2: inicio puntual que no levanta el congelamiento).
-- - Revocación: revoked_at / revoked_by (no se borra nada: sin DELETE).
-- - Tope de vigencia: expires_on <= fecha de creación (America/Guayaquil) +
--   private.exception_max_days() días (90). Se cambia con una migración.
-- - H-S03-04 / H-F03-05: solo quien aprobó edita su excepción; approved_by,
--   created_at y unit_id son inmutables; una revocada ya no se edita.
--
-- Las reglas de negocio las aplica un trigger a las escrituras de usuarios
-- finales (rol `authenticated`). El backend (`service_role`, la clave
-- sb_secret_ de las Actions) y las migraciones son de confianza y no pasan
-- por él. Si la escritura no la autorizaría RLS, el trigger no responde y
-- deja que RLS la rechace con 42501 (no revela reglas a quien no tiene rol).

alter table public.exceptions
  add column change_ref text
    check (change_ref is null or (length(trim(change_ref)) > 0 and length(change_ref) <= 200)),
  add column revoked_at timestamptz,
  add column revoked_by uuid references auth.users (id) on delete set null,
  add constraint exceptions_reason_max_len check (length(reason) <= 2000),
  add constraint exceptions_revoked_by_needs_at check (revoked_by is null or revoked_at is not null);

comment on column public.exceptions.change_ref is
  'Change concreto autorizado (obligatorio para scope change_start creadas por el comité)';
comment on column public.exceptions.revoked_at is 'Momento de la revocación; una revocada no aplica';

-- Tope de vigencia en días (configurable por migración).
create or replace function private.exception_max_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 90 $$;
revoke all on function private.exception_max_days() from public, anon;
grant execute on function private.exception_max_days() to authenticated, service_role;

-- Privilegios: el comité puede corregir su propia excepción y revocarla.
-- unit_id, created_at y revoked_by no se conceden (revoked_by lo pone el trigger).
revoke update on public.exceptions from authenticated;
grant update (scope, reason, change_ref, expires_on, approved_by, revoked_at) on public.exceptions to authenticated;

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
    if new.approved_by is distinct from uid or new.expires_on < current_date then
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

create trigger exceptions_enforce_rules
  before insert or update on public.exceptions
  for each row execute function private.enforce_exception_rules();

create index exceptions_active_idx on public.exceptions (unit_id, expires_on) where revoked_at is null;

-- F-04: endurecimiento tras revisión (H-F03-01..06, QA-3, QA-5) y columnas
-- aditivas para M-05.

-- ---------------------------------------------------------------------------
-- M-05 (aditivo): paquete por categoría y tipo de movimiento de la medición
-- ---------------------------------------------------------------------------
alter table public.commitments
  add column package_by_category jsonb
    check (package_by_category is null or jsonb_typeof(package_by_category) = 'object');

alter table public.measurements
  add column kind text check (kind is null or kind in ('resolved', 'detected'));

-- ---------------------------------------------------------------------------
-- H-F03-01: columnas inmutables para usuarios en measurements y commitments.
-- UPDATE solo sobre columnas editables; unit_id, indicator_id, created_by y
-- source no se pueden cambiar desde la API.
-- ---------------------------------------------------------------------------
revoke update on public.measurements from authenticated;
grant update (value, measured_on, app_id, compliant, category, kind)
  on public.measurements to authenticated;

revoke update on public.commitments from authenticated;
grant update (period, green_override, yellow_override, package_total, package_by_category, notes)
  on public.commitments to authenticated;

-- source = 'automatic' solo lo pone el backend (clave secreta, salta RLS).
drop policy measurements_insert on public.measurements;
create policy measurements_insert on public.measurements for insert to authenticated
  with check (
    private.is_custodian_of(indicator_id)
    and created_by = (select auth.uid())
    and source = 'manual'
  );

-- ---------------------------------------------------------------------------
-- H-F03-05 + QA-5: exceptions.unit_id inmutable; vencimiento no pasado al crear.
-- ---------------------------------------------------------------------------
revoke update on public.exceptions from authenticated;
grant update (scope, reason, expires_on, approved_by) on public.exceptions to authenticated;

drop policy exceptions_insert on public.exceptions;
create policy exceptions_insert on public.exceptions for insert to authenticated
  with check (
    (select private.has_role('committee'))
    and approved_by = (select auth.uid())
    and expires_on >= current_date
  );

-- Inmutabilidad también para el backend.
create or replace function private.forbid_exception_unit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_id is distinct from old.unit_id then
    raise exception 'exceptions.unit_id es inmutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.forbid_exception_unit_change() from public, anon, authenticated;

create trigger exceptions_unit_immutable
  before update on public.exceptions
  for each row execute function private.forbid_exception_unit_change();

-- ---------------------------------------------------------------------------
-- H-F03-02 + QA-3: auditoría también en measurements, targets y units.
-- ---------------------------------------------------------------------------
create trigger audit_measurements
  after insert or update or delete on public.measurements
  for each row execute function private.audit_row_change();

create trigger audit_targets
  after insert or update or delete on public.targets
  for each row execute function private.audit_row_change();

create trigger audit_units
  after insert or update or delete on public.units
  for each row execute function private.audit_row_change();

-- FKs con ON DELETE RESTRICT para preservar el historial: no se puede borrar
-- una unidad o un indicador con datos asociados.
alter table public.commitments
  drop constraint commitments_unit_id_fkey,
  drop constraint commitments_indicator_id_fkey,
  add constraint commitments_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict,
  add constraint commitments_indicator_id_fkey
    foreign key (indicator_id) references public.indicators (id) on delete restrict;

alter table public.measurements
  drop constraint measurements_unit_id_fkey,
  drop constraint measurements_indicator_id_fkey,
  add constraint measurements_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict,
  add constraint measurements_indicator_id_fkey
    foreign key (indicator_id) references public.indicators (id) on delete restrict;

alter table public.targets
  drop constraint targets_unit_id_fkey,
  drop constraint targets_indicator_id_fkey,
  add constraint targets_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict,
  add constraint targets_indicator_id_fkey
    foreign key (indicator_id) references public.indicators (id) on delete restrict;

alter table public.evaluations
  drop constraint evaluations_unit_id_fkey,
  drop constraint evaluations_indicator_id_fkey,
  add constraint evaluations_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict,
  add constraint evaluations_indicator_id_fkey
    foreign key (indicator_id) references public.indicators (id) on delete restrict;

alter table public.exceptions
  drop constraint exceptions_unit_id_fkey,
  add constraint exceptions_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict;

alter table public.alerts
  drop constraint alerts_unit_id_fkey,
  add constraint alerts_unit_id_fkey
    foreign key (unit_id) references public.units (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- H-F03-03: audit_log append-only, incluso para service_role.
-- ---------------------------------------------------------------------------
revoke update, delete, truncate on public.audit_log from service_role;

create or replace function private.forbid_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log es solo de inserción (% bloqueado)', tg_op
    using errcode = '42501';
end;
$$;
revoke all on function private.forbid_audit_log_change() from public, anon, authenticated;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_audit_log_change();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.forbid_audit_log_change();

-- ---------------------------------------------------------------------------
-- H-F03-04: las tablas, secuencias y funciones nuevas que cree postgres en
-- public no heredan privilegios para anon ni authenticated: cada migración
-- debe conceder explícitamente lo necesario.
-- Nota: EXECUTE a PUBLIC sobre funciones es un default global de Postgres que
-- no se puede quitar por esquema; quitarlo global afectaría a extensiones
-- (p. ej. pgTAP). Por eso cada función nueva debe hacer su propio
-- `revoke ... from public` (lo verifica supabase/tests/security/041).
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

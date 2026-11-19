-- F-04: RLS por rol.
-- Roles de negocio (public.user_roles): kpi_manager, custodian, committee,
-- unit_leader. El rol Postgres de cualquier usuario con sesión es
-- `authenticated`; `anon` no tiene acceso a nada. El backend (GitHub Actions
-- con la clave secreta) se salta RLS y es el único que escribe evaluations,
-- alerts y audit_log.

-- ---------------------------------------------------------------------------
-- Funciones auxiliares en el esquema `private` (no expuesto por la API).
-- security definer para leer user_roles sin recursión de RLS.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.has_role(r public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = r
  );
$$;

create or replace function private.has_any_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid());
$$;

create or replace function private.is_leader_of(unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'unit_leader' and ur.unit_id = unit
  );
$$;

create or replace function private.is_custodian_of(indicator uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'custodian' and ur.indicator_id = indicator
  );
$$;

revoke all on function private.has_role(public.app_role) from public, anon;
revoke all on function private.has_any_role() from public, anon;
revoke all on function private.is_leader_of(uuid) from public, anon;
revoke all on function private.is_custodian_of(uuid) from public, anon;
grant execute on function private.has_role(public.app_role) to authenticated, service_role;
grant execute on function private.has_any_role() to authenticated, service_role;
grant execute on function private.is_leader_of(uuid) to authenticated, service_role;
grant execute on function private.is_custodian_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilegios de tabla (defensa en profundidad bajo RLS).
-- Supabase concede ALL (incluido TRUNCATE, que ignora RLS) a anon y
-- authenticated por defecto: se revoca y se concede solo lo necesario.
-- ---------------------------------------------------------------------------
revoke all on
  public.units, public.user_roles, public.indicators, public.commitments,
  public.measurements, public.targets, public.evaluations, public.exceptions,
  public.alerts, public.audit_log
from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

grant select, insert, update, delete on public.units to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert, update, delete on public.indicators to authenticated;
grant select, insert, update, delete on public.targets to authenticated;
grant select, insert, update on public.commitments to authenticated;
grant select, insert, update on public.measurements to authenticated;
grant select, insert, update on public.exceptions to authenticated;
grant select on public.evaluations to authenticated;
grant select on public.alerts to authenticated;
grant update (read_at) on public.alerts to authenticated;
grant select on public.audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------
create policy units_select on public.units for select to authenticated
  using (
    (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
    or (select private.has_role('custodian'))
    or private.is_leader_of(id)
  );
create policy units_insert on public.units for insert to authenticated
  with check ((select private.has_role('kpi_manager')));
create policy units_update on public.units for update to authenticated
  using ((select private.has_role('kpi_manager')))
  with check ((select private.has_role('kpi_manager')));
create policy units_delete on public.units for delete to authenticated
  using ((select private.has_role('kpi_manager')));

-- ---------------------------------------------------------------------------
-- user_roles: cada usuario lee sus filas; gestora y comité leen todas; solo
-- la gestora escribe (nadie se cambia el rol a sí mismo).
-- ---------------------------------------------------------------------------
create policy user_roles_select on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
  );
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check ((select private.has_role('kpi_manager')));
create policy user_roles_update on public.user_roles for update to authenticated
  using ((select private.has_role('kpi_manager')))
  with check ((select private.has_role('kpi_manager')));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using ((select private.has_role('kpi_manager')));

-- ---------------------------------------------------------------------------
-- indicators: lectura para cualquier usuario con rol; escritura gestora.
-- ---------------------------------------------------------------------------
create policy indicators_select on public.indicators for select to authenticated
  using ((select private.has_any_role()));
create policy indicators_insert on public.indicators for insert to authenticated
  with check ((select private.has_role('kpi_manager')));
create policy indicators_update on public.indicators for update to authenticated
  using ((select private.has_role('kpi_manager')))
  with check ((select private.has_role('kpi_manager')));
create policy indicators_delete on public.indicators for delete to authenticated
  using ((select private.has_role('kpi_manager')));

-- ---------------------------------------------------------------------------
-- targets: lectura gestora, comité, custodios y líder de la unidad;
-- escritura gestora.
-- ---------------------------------------------------------------------------
create policy targets_select on public.targets for select to authenticated
  using (
    (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
    or (select private.has_role('custodian'))
    or private.is_leader_of(unit_id)
  );
create policy targets_insert on public.targets for insert to authenticated
  with check ((select private.has_role('kpi_manager')));
create policy targets_update on public.targets for update to authenticated
  using ((select private.has_role('kpi_manager')))
  with check ((select private.has_role('kpi_manager')));
create policy targets_delete on public.targets for delete to authenticated
  using ((select private.has_role('kpi_manager')));

-- ---------------------------------------------------------------------------
-- commitments y measurements: el custodio lee y escribe solo los de sus
-- indicadores; gestora y comité leen todo; el líder lee su unidad.
-- Sin delete para nadie (no hay privilegio DELETE).
-- ---------------------------------------------------------------------------
create policy commitments_select on public.commitments for select to authenticated
  using (
    (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
    or private.is_custodian_of(indicator_id)
    or private.is_leader_of(unit_id)
  );
create policy commitments_insert on public.commitments for insert to authenticated
  with check (private.is_custodian_of(indicator_id) and created_by = (select auth.uid()));
create policy commitments_update on public.commitments for update to authenticated
  using (private.is_custodian_of(indicator_id))
  with check (private.is_custodian_of(indicator_id));

create policy measurements_select on public.measurements for select to authenticated
  using (
    (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
    or private.is_custodian_of(indicator_id)
    or private.is_leader_of(unit_id)
  );
create policy measurements_insert on public.measurements for insert to authenticated
  with check (private.is_custodian_of(indicator_id) and created_by = (select auth.uid()));
create policy measurements_update on public.measurements for update to authenticated
  using (private.is_custodian_of(indicator_id))
  with check (private.is_custodian_of(indicator_id));

-- ---------------------------------------------------------------------------
-- evaluations: solo lectura (las escribe el backend).
-- ---------------------------------------------------------------------------
create policy evaluations_select on public.evaluations for select to authenticated
  using (
    (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
    or (indicator_id is not null and private.is_custodian_of(indicator_id))
    or private.is_leader_of(unit_id)
  );

-- ---------------------------------------------------------------------------
-- exceptions: el comité crea y actualiza (approved_by = quien aprueba);
-- gestora y comité leen todas; el líder lee las de su unidad.
-- ---------------------------------------------------------------------------
create policy exceptions_select on public.exceptions for select to authenticated
  using (
    (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
    or private.is_leader_of(unit_id)
  );
create policy exceptions_insert on public.exceptions for insert to authenticated
  with check ((select private.has_role('committee')) and approved_by = (select auth.uid()));
create policy exceptions_update on public.exceptions for update to authenticated
  using ((select private.has_role('committee')))
  with check ((select private.has_role('committee')) and approved_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- alerts: cada usuario lee las suyas y marca read_at (único privilegio de
-- columna); gestora y comité leen todas. Inserción solo backend.
-- ---------------------------------------------------------------------------
create policy alerts_select on public.alerts for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    or (select private.has_role('kpi_manager'))
    or (select private.has_role('committee'))
  );
create policy alerts_update_own on public.alerts for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_log: lectura gestora y comité. Nadie actualiza ni borra.
-- ---------------------------------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select private.has_role('kpi_manager')) or (select private.has_role('committee')));

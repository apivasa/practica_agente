-- C-06: omisión del correo de una alerta (email_skipped_at, email_skip_reason).
-- Solo el backend (service_role) marca una alerta como omitida; ningún rol de usuario
-- puede marcarla ni desmarcarla. Restricciones: motivo cerrado, par fecha/motivo y una
-- alerta no puede quedar enviada y omitida a la vez.
begin;
select plan(24);

select has_column('public', 'alerts', 'email_skipped_at', 'alerts.email_skipped_at existe');
select has_column('public', 'alerts', 'email_skip_reason', 'alerts.email_skip_reason existe');
select col_is_null('public', 'alerts', 'email_skipped_at', 'email_skipped_at admite nulo (pendiente)');
select ok((select relrowsecurity from pg_class where oid = 'public.alerts'::regclass), 'alerts mantiene RLS');

-- Privilegios por rol.
select ok(not has_column_privilege('authenticated', 'public.alerts', 'email_skipped_at', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.alerts', 'email_skip_reason', 'UPDATE'),
  'authenticated: no actualiza las columnas de omisión');
select ok(has_column_privilege('authenticated', 'public.alerts', 'read_at', 'UPDATE'),
  'authenticated: sigue actualizando read_at');
select ok(not has_any_column_privilege('anon', 'public.alerts', 'SELECT')
          and not has_any_column_privilege('anon', 'public.alerts', 'UPDATE'),
  'anon: sin acceso a alerts');
select ok(has_column_privilege('service_role', 'public.alerts', 'email_skipped_at', 'UPDATE')
          and has_column_privilege('service_role', 'public.alerts', 'email_skip_reason', 'UPDATE')
          and has_table_privilege('service_role', 'public.alerts', 'SELECT'),
  'service_role (backend): lee alerts y escribe la omisión');
select ok(has_table_privilege('service_role', 'public.user_roles', 'SELECT'),
  'service_role (backend): lee user_roles para comprobar el rol vigente');
select ok(has_table_privilege('service_role', 'public.audit_log', 'INSERT')
          and not has_table_privilege('service_role', 'public.audit_log', 'UPDATE'),
  'service_role: audita alert_email_skipped y audit_log sigue append-only');

-- Fixture propio (UUID distintos a la semilla y a C-05).
insert into auth.users (id, email, aud, role) values
  ('c0600000-0000-4000-8000-000000000001', 'c06-gestora@example.test', 'authenticated', 'authenticated'),
  ('c0600000-0000-4000-8000-000000000002', 'c06-comite@example.test', 'authenticated', 'authenticated'),
  ('c0600000-0000-4000-8000-000000000003', 'c06-lider1@example.test', 'authenticated', 'authenticated'),
  ('c0600000-0000-4000-8000-000000000004', 'c06-lider2@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('c0610000-0000-4000-8000-000000000001', 'C06 Unidad 1'),
  ('c0610000-0000-4000-8000-000000000002', 'C06 Unidad 2');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('c0600000-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('c0600000-0000-4000-8000-000000000002', 'committee', null, null),
  ('c0600000-0000-4000-8000-000000000003', 'unit_leader', 'c0610000-0000-4000-8000-000000000001', null),
  ('c0600000-0000-4000-8000-000000000004', 'unit_leader', 'c0610000-0000-4000-8000-000000000002', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload) values
  ('c0630000-0000-4000-8000-000000000001', 'c0610000-0000-4000-8000-000000000001', 'c0600000-0000-4000-8000-000000000003', 'color_change', '{}'),
  ('c0630000-0000-4000-8000-000000000002', 'c0610000-0000-4000-8000-000000000002', 'c0600000-0000-4000-8000-000000000004', 'color_change', '{}');

-- Restricciones (como postgres / backend).
select is((select email_skipped_at from public.alerts where id = 'c0630000-0000-4000-8000-000000000001'), null,
  'una alerta nueva no está omitida');
select throws_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'otra_cosa' where id = 'c0630000-0000-4000-8000-000000000001' $$,
  '23514', null, 'motivo fuera de la lista se rechaza');
select throws_ok(
  $$ update public.alerts set email_skipped_at = now() where id = 'c0630000-0000-4000-8000-000000000001' $$,
  '23514', null, 'fecha de omisión sin motivo se rechaza');
select throws_ok(
  $$ update public.alerts set email_skip_reason = 'expired' where id = 'c0630000-0000-4000-8000-000000000001' $$,
  '23514', null, 'motivo sin fecha de omisión se rechaza');
select throws_ok(
  $$ update public.alerts set emailed_at = now(), email_skipped_at = now(), email_skip_reason = 'expired' where id = 'c0630000-0000-4000-8000-000000000001' $$,
  '23514', null, 'una alerta no puede quedar enviada y omitida a la vez');

-- Backend: la marca condicional solo toca alertas abiertas (idempotente).
set local role service_role;
select lives_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'recipient_no_role'
     where id = 'c0630000-0000-4000-8000-000000000002' and emailed_at is null and email_skipped_at is null $$,
  'service_role: marca la alerta como omitida');
select is((select email_skip_reason from public.alerts where id = 'c0630000-0000-4000-8000-000000000002'),
  'recipient_no_role', 'service_role: la omisión queda con su motivo');
select lives_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired'
     where id = 'c0630000-0000-4000-8000-000000000002' and emailed_at is null and email_skipped_at is null $$,
  'service_role: una segunda marca condicional no falla');
select is((select email_skip_reason from public.alerts where id = 'c0630000-0000-4000-8000-000000000002'),
  'recipient_no_role', 'service_role: la segunda marca no cambia el motivo (idempotente)');
reset role;

set local role authenticated;

-- Líder: no marca ni desmarca la omisión de su alerta.
set local request.jwt.claims = '{"sub":"c0600000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = 'c0630000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder: no marca su alerta como omitida');

-- Otro líder: no ve la alerta ajena ni puede desmarcar la omisión de la suya.
set local request.jwt.claims = '{"sub":"c0600000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c0630000-0000-4000-8000-000000000002' $$,
  '42501', null, 'líder: no desmarca la omisión');

-- Comité y gestora: leen, no escriben la omisión.
set local request.jwt.claims = '{"sub":"c0600000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skip_reason = null, email_skipped_at = null where id = 'c0630000-0000-4000-8000-000000000002' $$,
  '42501', null, 'comité: no desmarca la omisión');
set local request.jwt.claims = '{"sub":"c0600000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = 'c0630000-0000-4000-8000-000000000001' $$,
  '42501', null, 'gestora: no marca la omisión');

-- Anónimo: nada.
reset role;
set local role anon;
select throws_ok(
  $$ select email_skip_reason from public.alerts $$,
  '42501', null, 'anon: no lee alerts');

select * from finish();
rollback;

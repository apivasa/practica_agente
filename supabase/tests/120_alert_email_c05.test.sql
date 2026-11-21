-- C-05: columnas de envío por correo de alerts (emailed_at, email_attempts).
-- Ningún rol de usuario puede marcar ni desmarcar un correo como enviado; cada
-- destinatario sigue viendo solo sus alertas (gestora y comité, todas) y marcando
-- read_at. Solo el backend (service_role / clave secreta) escribe estas columnas.
begin;
select plan(24);

select has_column('public', 'alerts', 'emailed_at', 'alerts.emailed_at existe');
select has_column('public', 'alerts', 'email_attempts', 'alerts.email_attempts existe');
select col_default_is('public', 'alerts', 'email_attempts', '0', 'email_attempts empieza en 0');
select col_not_null('public', 'alerts', 'email_attempts', 'email_attempts no es nula');
select ok((select relrowsecurity from pg_class where oid = 'public.alerts'::regclass), 'alerts mantiene RLS');

-- Privilegios por rol sobre las columnas nuevas.
select ok(not has_column_privilege('authenticated', 'public.alerts', 'emailed_at', 'UPDATE'),
  'authenticated: no actualiza emailed_at');
select ok(not has_column_privilege('authenticated', 'public.alerts', 'email_attempts', 'UPDATE'),
  'authenticated: no actualiza email_attempts');
select ok(not has_any_column_privilege('anon', 'public.alerts', 'SELECT')
          and not has_any_column_privilege('anon', 'public.alerts', 'UPDATE'),
  'anon: sin acceso a alerts');
select ok(has_column_privilege('service_role', 'public.alerts', 'emailed_at', 'UPDATE'),
  'service_role (backend): actualiza emailed_at');

-- Fixture propio (UUID distintos a la semilla).
insert into auth.users (id, email, aud, role) values
  ('c0500000-0000-4000-8000-000000000001', 'c05-gestora@example.test', 'authenticated', 'authenticated'),
  ('c0500000-0000-4000-8000-000000000002', 'c05-custodio@example.test', 'authenticated', 'authenticated'),
  ('c0500000-0000-4000-8000-000000000003', 'c05-comite@example.test', 'authenticated', 'authenticated'),
  ('c0500000-0000-4000-8000-000000000004', 'c05-lider1@example.test', 'authenticated', 'authenticated'),
  ('c0500000-0000-4000-8000-000000000005', 'c05-lider2@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('c0510000-0000-4000-8000-000000000001', 'C05 Unidad 1'),
  ('c0510000-0000-4000-8000-000000000002', 'C05 Unidad 2');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('c0520000-0000-4000-8000-000000000001', 'C05_X', 'C05 KPI', 'window_average', 'higher_is_better', 99, 95);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('c0500000-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('c0500000-0000-4000-8000-000000000002', 'custodian', null, 'c0520000-0000-4000-8000-000000000001'),
  ('c0500000-0000-4000-8000-000000000003', 'committee', null, null),
  ('c0500000-0000-4000-8000-000000000004', 'unit_leader', 'c0510000-0000-4000-8000-000000000001', null),
  ('c0500000-0000-4000-8000-000000000005', 'unit_leader', 'c0510000-0000-4000-8000-000000000002', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload) values
  ('c0530000-0000-4000-8000-000000000001', 'c0510000-0000-4000-8000-000000000001', 'c0500000-0000-4000-8000-000000000004', 'color_change', '{}'),
  ('c0530000-0000-4000-8000-000000000002', 'c0510000-0000-4000-8000-000000000002', 'c0500000-0000-4000-8000-000000000005', 'color_change', '{}'),
  ('c0530000-0000-4000-8000-000000000003', 'c0510000-0000-4000-8000-000000000001', 'c0500000-0000-4000-8000-000000000003', 'color_change', '{}');

-- Restricciones (como postgres / backend).
select is((select emailed_at from public.alerts where id = 'c0530000-0000-4000-8000-000000000001'), null,
  'una alerta nueva queda pendiente de correo');
select throws_ok(
  $$ update public.alerts set email_attempts = -1 where id = 'c0530000-0000-4000-8000-000000000001' $$,
  '23514', null, 'email_attempts negativo se rechaza');

set local role authenticated;

-- Líder: ve solo la suya, no puede marcarla como enviada, sí como leída.
set local request.jwt.claims = '{"sub":"c0500000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c0530000%'), 1, 'líder: ve solo su alerta');
select throws_ok(
  $$ update public.alerts set emailed_at = now() where id = 'c0530000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder: no marca emailed_at de su alerta');
select throws_ok(
  $$ update public.alerts set email_attempts = 99 where id = 'c0530000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder: no cambia email_attempts');
select lives_ok(
  $$ update public.alerts set read_at = now() where id = 'c0530000-0000-4000-8000-000000000001' $$,
  'líder: sigue marcando read_at de su alerta');

-- Otro líder: no ve la alerta ajena ni su estado de correo.
set local request.jwt.claims = '{"sub":"c0500000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id = 'c0530000-0000-4000-8000-000000000001'), 0,
  'otro líder: no ve la alerta (ni su estado de correo) de otra unidad');
select throws_ok(
  $$ update public.alerts set emailed_at = null where id = 'c0530000-0000-4000-8000-000000000002' $$,
  '42501', null, 'otro líder: no desmarca emailed_at');

-- Comité: lee todas, no escribe el estado de correo.
set local request.jwt.claims = '{"sub":"c0500000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c0530000%'), 3, 'comité: lee todas');
select throws_ok(
  $$ update public.alerts set emailed_at = now() where id = 'c0530000-0000-4000-8000-000000000003' $$,
  '42501', null, 'comité: no marca emailed_at');

-- Gestora: lee todas, no escribe el estado de correo.
set local request.jwt.claims = '{"sub":"c0500000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c0530000%'), 3, 'gestora: lee todas');
select throws_ok(
  $$ update public.alerts set email_attempts = 0 where id = 'c0530000-0000-4000-8000-000000000002' $$,
  '42501', null, 'gestora: no cambia email_attempts');

-- Custodio: no ve alertas ajenas ni escribe.
set local request.jwt.claims = '{"sub":"c0500000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c0530000%'), 0, 'custodio: no ve alertas ajenas');
select throws_ok(
  $$ update public.alerts set emailed_at = now() where id = 'c0530000-0000-4000-8000-000000000001' $$,
  '42501', null, 'custodio: no marca emailed_at');

-- Anónimo: nada.
reset role;
set local role anon;
select throws_ok(
  $$ select emailed_at from public.alerts $$,
  '42501', null, 'anon: no lee alerts');

select * from finish();
rollback;

-- Seguridad (C-06), categorías 1, 2 y 8: la omisión del correo (email_skipped_at,
-- email_skip_reason) solo la escribe el backend. Si un usuario pudiera marcarla
-- silenciaría el correo de una alerta; si pudiera borrarla forzaría un envío a un
-- destinatario que perdió el rol. Tampoco puede falsificar la auditoría de la omisión
-- ni hacerse elegible cambiando sus roles.
begin;
select plan(22);

-- Catálogo tras la migración de C-06.
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'alerts'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['read_at'],
  'authenticated: UPDATE sigue solo en alerts.read_at');
select ok(not has_column_privilege('authenticated', 'public.alerts', 'email_skipped_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.alerts', 'email_skip_reason', 'INSERT'),
  'authenticated: no inserta columnas de omisión');
select ok(not has_any_column_privilege('anon', 'public.alerts', 'SELECT')
          and not has_any_column_privilege('anon', 'public.alerts', 'UPDATE')
          and not has_any_column_privilege('anon', 'public.alerts', 'INSERT'),
  'anon: sin acceso a alerts');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'alerts'),
  2, 'alerts sigue con sus dos políticas (select y update propio)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* 'email_skip'
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0, 'ninguna función ejecutable por usuarios escribe la omisión');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
          and not has_table_privilege('service_role', 'public.audit_log', 'DELETE')
          and not has_table_privilege('authenticated', 'public.audit_log', 'INSERT'),
  'audit_log append-only para el backend y sin INSERT de usuarios');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'ninguna tabla de public sin RLS');

-- Fixture propio (UUID distintos de la semilla, de C-05 y de la prueba 122).
insert into auth.users (id, email, aud, role) values
  ('5ec60000-0000-4000-8000-000000000001', 'sec6-gestora@example.test', 'authenticated', 'authenticated'),
  ('5ec60000-0000-4000-8000-000000000002', 'sec6-comite@example.test', 'authenticated', 'authenticated'),
  ('5ec60000-0000-4000-8000-000000000003', 'sec6-lider-a@example.test', 'authenticated', 'authenticated'),
  ('5ec60000-0000-4000-8000-000000000004', 'sec6-lider-b@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('5ec61000-0000-4000-8000-000000000001', 'SEC6 Unidad A'),
  ('5ec61000-0000-4000-8000-000000000002', 'SEC6 Unidad B');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec60000-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('5ec60000-0000-4000-8000-000000000002', 'committee', null, null),
  ('5ec60000-0000-4000-8000-000000000003', 'unit_leader', '5ec61000-0000-4000-8000-000000000001', null),
  ('5ec60000-0000-4000-8000-000000000004', 'unit_leader', '5ec61000-0000-4000-8000-000000000002', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload, email_skipped_at, email_skip_reason, emailed_at) values
  ('5ec62000-0000-4000-8000-000000000001', '5ec61000-0000-4000-8000-000000000001', '5ec60000-0000-4000-8000-000000000003', 'color_change', '{}', null, null, null),
  ('5ec62000-0000-4000-8000-000000000002', '5ec61000-0000-4000-8000-000000000002', '5ec60000-0000-4000-8000-000000000004', 'color_change', '{}', now(), 'recipient_no_role', null),
  ('5ec62000-0000-4000-8000-000000000003', '5ec61000-0000-4000-8000-000000000001', '5ec60000-0000-4000-8000-000000000003', 'color_change', '{}', null, null, now());

-- Backend: una alerta ya enviada no se puede marcar omitida (la restricción lo impide).
set local role service_role;
select throws_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = '5ec62000-0000-4000-8000-000000000003' $$,
  '23514', null, 'service_role: no marca omitida una alerta ya enviada');
reset role;

set local role authenticated;

-- Líder A (destinatario de su alerta).
set local request.jwt.claims = '{"sub":"5ec60000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set read_at = now(), email_skipped_at = now(), email_skip_reason = 'expired' where id = '5ec62000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder A: read_at + omisión se rechaza (no silencia su correo)');
select throws_ok(
  $$ update public.alerts set email_skip_reason = 'expired' where id = '5ec62000-0000-4000-8000-000000000002' $$,
  '42501', null, 'líder A: no toca la omisión de la alerta de B');
select is(
  (select count(*)::int from public.alerts where id = '5ec62000-0000-4000-8000-000000000002'),
  0, 'líder A: no ve la alerta de B');
select is(
  (select count(*)::int from public.alerts where email_skip_reason is not null),
  0, 'líder A: filtrar por email_skip_reason no revela alertas ajenas');
select throws_ok(
  $$ insert into public.audit_log (actor, action, entity, entity_id, details)
     values ('system:alert-email', 'alert_email_skipped', 'alerts', '5ec62000-0000-4000-8000-000000000002', '{}') $$,
  '42501', null, 'líder A: no falsifica la auditoría de una omisión');
select throws_ok(
  $$ insert into public.user_roles (user_id, role, unit_id, indicator_id)
     values ('5ec60000-0000-4000-8000-000000000003', 'unit_leader', '5ec61000-0000-4000-8000-000000000002', null) $$,
  '42501', null, 'líder A: no se hace líder de B para recibir sus correos');
select throws_ok(
  $$ insert into public.user_roles (user_id, role, unit_id, indicator_id)
     values ('5ec60000-0000-4000-8000-000000000003', 'committee', null, null) $$,
  '42501', null, 'líder A: no se hace comité');
select lives_ok(
  $$ update public.alerts set read_at = now() where id = '5ec62000-0000-4000-8000-000000000001' $$,
  'líder A: sigue marcando read_at');

-- Líder B: no desmarca su propia omisión (forzaría un envío tras perder el rol).
set local request.jwt.claims = '{"sub":"5ec60000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skipped_at = null, email_skip_reason = null where id = '5ec62000-0000-4000-8000-000000000002' $$,
  '42501', null, 'líder B: no desmarca su omisión');

-- Comité y gestora: leen todas, no escriben omisión.
set local request.jwt.claims = '{"sub":"5ec60000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = '5ec62000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: no marca omisión');
set local request.jwt.claims = '{"sub":"5ec60000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_skipped_at = null, email_skip_reason = null where id = '5ec62000-0000-4000-8000-000000000002' $$,
  '42501', null, 'gestora: no desmarca omisión');

-- Anónimo.
reset role;
set local role anon;
select throws_ok(
  $$ update public.alerts set email_skipped_at = null, email_skip_reason = null $$,
  '42501', null, 'anon: no toca la omisión');

reset role;
-- Estado intacto tras los ataques.
select ok(
  (select email_skipped_at is null and email_skip_reason is null from public.alerts where id = '5ec62000-0000-4000-8000-000000000001'),
  'alerta de A sigue sin omisión');
select is(
  (select email_skip_reason from public.alerts where id = '5ec62000-0000-4000-8000-000000000002'),
  'recipient_no_role', 'omisión de B intacta');

select * from finish();
rollback;

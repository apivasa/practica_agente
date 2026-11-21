-- Seguridad (C-05), categorías 1, 2 y 8: el estado de correo de las alertas
-- (emailed_at, email_attempts) solo lo escribe el backend. Si un usuario pudiera
-- ponerlo a null / 0 forzaría reenvíos (spam a su nombre); si pudiera fijarlo,
-- silenciaría el correo de una alerta. Tampoco puede leer correos de otros
-- usuarios (auth.users) ni el estado de correo de alertas ajenas.
begin;
select plan(20);

-- Catálogo: el único privilegio de columna de authenticated en alerts sigue siendo read_at.
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'alerts'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['read_at'],
  'authenticated: UPDATE solo en alerts.read_at');
select ok(not has_table_privilege('authenticated', 'public.alerts', 'UPDATE'),
  'authenticated: sin UPDATE de tabla completa en alerts');
select ok(not has_column_privilege('authenticated', 'public.alerts', 'emailed_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.alerts', 'email_attempts', 'INSERT'),
  'authenticated: no inserta columnas de correo');
select ok(not has_table_privilege('authenticated', 'public.alerts', 'DELETE'),
  'authenticated: no borra alertas (no puede ocultar un correo pendiente)');
select ok(not has_any_column_privilege('anon', 'public.alerts', 'SELECT')
          and not has_any_column_privilege('anon', 'public.alerts', 'UPDATE')
          and not has_any_column_privilege('anon', 'public.alerts', 'INSERT'),
  'anon: sin acceso a alerts');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'alerts'),
  2, 'alerts conserva solo sus dos políticas (select y update propio)');
select ok((select relrowsecurity from pg_class where oid = 'public.alerts'::regclass), 'alerts mantiene RLS');

-- Correos de los usuarios: ningún rol de usuario lee auth.users.
select ok(not has_table_privilege('authenticated', 'auth.users', 'SELECT'), 'authenticated: no lee auth.users');
select ok(not has_table_privilege('anon', 'auth.users', 'SELECT'), 'anon: no lee auth.users');
-- Ninguna función ejecutable por usuarios en public/private toca auth.users (fuga de correos).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* 'auth\.users'
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0, 'ninguna función de usuario lee auth.users');

-- Fixture propio.
insert into auth.users (id, email, aud, role) values
  ('5ec50000-0000-4000-8000-000000000001', 'sec5-lider-a@example.test', 'authenticated', 'authenticated'),
  ('5ec50000-0000-4000-8000-000000000002', 'sec5-lider-b@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('5ec51000-0000-4000-8000-000000000001', 'SEC5 Unidad A'),
  ('5ec51000-0000-4000-8000-000000000002', 'SEC5 Unidad B');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec50000-0000-4000-8000-000000000001', 'unit_leader', '5ec51000-0000-4000-8000-000000000001', null),
  ('5ec50000-0000-4000-8000-000000000002', 'unit_leader', '5ec51000-0000-4000-8000-000000000002', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload, emailed_at, email_attempts) values
  ('5ec52000-0000-4000-8000-000000000001', '5ec51000-0000-4000-8000-000000000001', '5ec50000-0000-4000-8000-000000000001', 'color_change', '{}', now(), 1),
  ('5ec52000-0000-4000-8000-000000000002', '5ec51000-0000-4000-8000-000000000002', '5ec50000-0000-4000-8000-000000000002', 'color_change', '{}', null, 2);

set local role authenticated;
set local request.jwt.claims = '{"sub":"5ec50000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Mezclar read_at (permitido) con columnas de correo no abre la escritura.
select throws_ok(
  $$ update public.alerts set read_at = now(), emailed_at = null where id = '5ec52000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder A: read_at + emailed_at=null se rechaza (no fuerza reenvío)');
select throws_ok(
  $$ update public.alerts set read_at = now(), email_attempts = 0 where id = '5ec52000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder A: read_at + email_attempts=0 se rechaza');
select throws_ok(
  $$ update public.alerts set emailed_at = now() where id = '5ec52000-0000-4000-8000-000000000002' $$,
  '42501', null, 'líder A: no silencia el correo de la alerta de B');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, emailed_at)
     values ('5ec51000-0000-4000-8000-000000000002', '5ec50000-0000-4000-8000-000000000002', 'color_change', null) $$,
  '42501', null, 'líder A: no crea alertas para que se envíen por correo a B');
select is(
  (select count(*)::int from public.alerts where id = '5ec52000-0000-4000-8000-000000000002'),
  0, 'líder A: no ve el estado de correo de la alerta de B');
select is(
  (select count(*)::int from public.alerts where email_attempts > 0 and unit_id = '5ec51000-0000-4000-8000-000000000002'),
  0, 'líder A: filtrar por columnas de correo no revela alertas de B');
select throws_ok(
  $$ select email from auth.users $$,
  '42501', null, 'líder A: no lee correos de auth.users');
select lives_ok(
  $$ update public.alerts set read_at = now() where id = '5ec52000-0000-4000-8000-000000000001' $$,
  'líder A: sigue marcando read_at de su alerta');

reset role;
-- El estado de correo quedó intacto tras los intentos.
select is(
  (select email_attempts from public.alerts where id = '5ec52000-0000-4000-8000-000000000002'),
  2::smallint, 'email_attempts de B intacto');
select ok(
  (select emailed_at is not null from public.alerts where id = '5ec52000-0000-4000-8000-000000000001'),
  'emailed_at de A intacto');

select * from finish();
rollback;

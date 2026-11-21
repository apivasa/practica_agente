-- F-12 (H-ARQ-C06-04): public.mark_alerts_email_expired marca `expired` y audita en la
-- misma transacción. Solo service_role la ejecuta; anon, authenticated y PUBLIC no.
begin;
select plan(20);

select has_function('public', 'mark_alerts_email_expired',
  array['uuid[]', 'timestamp with time zone', 'integer', 'timestamp with time zone', 'integer'],
  'existe public.mark_alerts_email_expired');
select ok((select not p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)'::regprocedure),
  'security invoker con search_path vacío');

-- Privilegios por rol.
select ok(has_function_privilege('service_role',
  'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)', 'EXECUTE'),
  'service_role: ejecuta la RPC');
select ok(not has_function_privilege('authenticated',
  'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)', 'EXECUTE'),
  'authenticated: no ejecuta la RPC');
select ok(not has_function_privilege('anon',
  'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)', 'EXECUTE'),
  'anon: no ejecuta la RPC');
select is_empty(
  $$ select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = 'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)'::regprocedure
        and a.grantee = 0 and a.privilege_type = 'EXECUTE' $$,
  'PUBLIC: sin EXECUTE');

-- Fixture propio (UUID distintos a la semilla y a C-05/C-06).
insert into auth.users (id, email, aud, role) values
  ('f1200000-0000-4000-8000-000000000001', 'f12-lider@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('f1210000-0000-4000-8000-000000000001', 'F12 Unidad 1');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('f1200000-0000-4000-8000-000000000001', 'unit_leader', 'f1210000-0000-4000-8000-000000000001', null);
-- 1: vencida y abierta; 2: reciente; 3: vencida pero agotada; 4: vencida pero enviada;
-- 5: vencida y abierta (segunda del lote).
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload, sent_at, email_attempts, emailed_at) values
  ('f1230000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001', 'color_change', '{}', now() - interval '10 days', 1, null),
  ('f1230000-0000-4000-8000-000000000002', 'f1210000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001', 'color_change', '{}', now() - interval '1 day', 0, null),
  ('f1230000-0000-4000-8000-000000000003', 'f1210000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001', 'color_change', '{}', now() - interval '10 days', 3, null),
  ('f1230000-0000-4000-8000-000000000004', 'f1210000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001', 'color_change', '{}', now() - interval '10 days', 1, now() - interval '9 days'),
  ('f1230000-0000-4000-8000-000000000005', 'f1210000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001', 'escalation', '{}', now() - interval '8 days', 0, null);

-- Usuarios: no la invocan.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1200000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1230000-0000-4000-8000-000000000001']::uuid[],
       now() - interval '7 days', 3, now(), 7) $$,
  '42501', null, 'líder: no ejecuta la RPC');
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1230000-0000-4000-8000-000000000001']::uuid[],
       now() - interval '7 days', 3, now(), 7) $$,
  '42501', null, 'anon: no ejecuta la RPC');
reset role;
select is((select count(*)::int from public.alerts where id::text like 'f1230000-%' and email_skipped_at is not null), 0,
  'tras los intentos sin permiso nada quedó marcado');

-- Backend: marca solo las vencidas y abiertas, y audita cada una.
set local role service_role;
select results_eq(
  $$ select alert_id from public.mark_alerts_email_expired(
       array['f1230000-0000-4000-8000-000000000001', 'f1230000-0000-4000-8000-000000000002',
             'f1230000-0000-4000-8000-000000000003', 'f1230000-0000-4000-8000-000000000004',
             'f1230000-0000-4000-8000-000000000005']::uuid[],
       now() - interval '7 days', 3, now(), 7) order by alert_id $$,
  $$ values ('f1230000-0000-4000-8000-000000000001'::uuid), ('f1230000-0000-4000-8000-000000000005'::uuid) $$,
  'service_role: devuelve solo las vencidas y abiertas');
reset role;
select results_eq(
  $$ select id::text, email_skip_reason from public.alerts where id::text like 'f1230000-%' and email_skipped_at is not null order by id $$,
  $$ values ('f1230000-0000-4000-8000-000000000001', 'expired'), ('f1230000-0000-4000-8000-000000000005', 'expired') $$,
  'las dos quedan marcadas expired; reciente, agotada y enviada no');
select results_eq(
  $$ select entity_id, actor, entity, details->>'reason', (details->>'lookback_days')::int, (details->>'attempts')::int
       from public.audit_log where action = 'alert_email_skipped' and entity_id like 'f1230000-%' order by entity_id $$,
  $$ values ('f1230000-0000-4000-8000-000000000001', 'system:alert-email', 'alerts', 'expired', 7, 1),
            ('f1230000-0000-4000-8000-000000000005', 'system:alert-email', 'alerts', 'expired', 7, 0) $$,
  'una fila alert_email_skipped por alerta marcada, con motivo, ventana e intentos');
select ok(not exists (select 1 from public.audit_log where entity_id like 'f1230000-%' and details::text like '%@%'),
  'la auditoría no contiene correos');

-- Idempotente: una segunda llamada no marca ni audita.
set local role service_role;
select is_empty(
  $$ select * from public.mark_alerts_email_expired(
       array['f1230000-0000-4000-8000-000000000001', 'f1230000-0000-4000-8000-000000000005']::uuid[],
       now() - interval '7 days', 3, now(), 7) $$,
  'segunda llamada: no marca nada');
reset role;
select is((select count(*)::int from public.audit_log where action = 'alert_email_skipped' and entity_id like 'f1230000-%'), 2,
  'segunda llamada: no duplica la auditoría');

-- Validación de parámetros.
set local role service_role;
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(null, now(), 3, now(), 7) $$,
  '22004', null, 'ids nulos se rechazan');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array_fill('f1230000-0000-4000-8000-000000000002'::uuid, array[1001]),
       now(), 3, now(), 7) $$,
  '22023', null, 'más de 1000 ids se rechazan');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1230000-0000-4000-8000-000000000002']::uuid[], now(), 0, now(), 7) $$,
  '22023', null, 'intentos fuera de rango se rechazan');
reset role;

-- Atomicidad: si la auditoría falla, la marca se deshace (misma sentencia). El trigger y
-- su función son de esta prueba y desaparecen con el rollback.
create function public.f12_test_fail_audit() returns trigger language plpgsql as $f$
begin
  raise exception 'auditoría caída (prueba F-12)';
end;
$f$;
create trigger f12_fail_audit before insert on public.audit_log
  for each row when (new.entity_id = 'f1230000-0000-4000-8000-000000000002') execute function public.f12_test_fail_audit();
update public.alerts set sent_at = now() - interval '10 days' where id = 'f1230000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1230000-0000-4000-8000-000000000002']::uuid[],
       now() - interval '7 days', 3, now(), 7) $$,
  'P0001', 'auditoría caída (prueba F-12)', 'si falla la auditoría la llamada falla');
select is((select email_skipped_at from public.alerts where id = 'f1230000-0000-4000-8000-000000000002'), null,
  'si falla la auditoría la alerta no queda marcada');
drop trigger f12_fail_audit on public.audit_log;

select * from finish();
rollback;

-- Seguridad (F-12), categorías 1, 3 y 8: public.mark_alerts_email_expired es la primera
-- función de public expuesta por /rpc. Solo el backend (service_role) la ejecuta; aun si
-- un grant futuro se la abriera a authenticated, SECURITY INVOKER impide que un usuario
-- marque alertas o escriba auditoría (defensa en profundidad). Sin SQL dinámico.
begin;
select plan(14);

-- Catálogo: única función de public, sin elevar privilegios, sin SQL dinámico.
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['mark_alerts_email_expired'],
  'public: la única función propia es mark_alerts_email_expired (cualquier otra exige revisión)');
select ok((select not p.prosecdef from pg_proc p
            where p.oid = 'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)'::regprocedure),
  'SECURITY INVOKER (no definer)');
select ok((select p.proconfig = array['search_path=""'] from pg_proc p
            where p.oid = 'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)'::regprocedure),
  'search_path fijado vacío y sin otras opciones');
select ok((select p.prosrc !~* '\mexecute\M' and p.prosrc !~* '\mformat\s*\(' from pg_proc p
            where p.oid = 'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)'::regprocedure),
  'sin SQL dinámico (EXECUTE / format)');
select is_empty(
  $$ select a.grantee from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = 'public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer)'::regprocedure
        and a.privilege_type = 'EXECUTE'
        and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'authenticator')) $$,
  'EXECUTE: ni PUBLIC, ni anon, ni authenticated, ni authenticator');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') $$,
  'public: ninguna función propia ejecutable por anon ni authenticated');

-- Fixture propio.
insert into auth.users (id, email, aud, role) values
  ('f1240000-0000-4000-8000-000000000001', 'f12-sec-lider@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values ('f1241000-0000-4000-8000-000000000001', 'F12 Sec Unidad');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('f1240000-0000-4000-8000-000000000001', 'unit_leader', 'f1241000-0000-4000-8000-000000000001', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload, sent_at, email_attempts) values
  ('f1243000-0000-4000-8000-000000000001', 'f1241000-0000-4000-8000-000000000001',
   'f1240000-0000-4000-8000-000000000001', 'color_change', '{}', now() - interval '20 days', 0);

-- Usuario sin EXECUTE: 42501.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1240000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1243000-0000-4000-8000-000000000001']::uuid[],
       now(), 3, now(), 7) $$,
  '42501', null, 'líder de la unidad de la alerta: no ejecuta la RPC');
reset role;

-- Defensa en profundidad: con EXECUTE concedido por error, SECURITY INVOKER deja al
-- líder sin UPDATE de email_skipped_at ni INSERT en audit_log (el grant se deshace con
-- el rollback de la prueba).
grant execute on function public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer) to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1240000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1243000-0000-4000-8000-000000000001']::uuid[],
       now(), 3, now(), 7) $$,
  '42501', null, 'con EXECUTE por error: sigue sin poder marcar (security invoker)');
reset role;
revoke execute on function public.mark_alerts_email_expired(uuid[], timestamptz, integer, timestamptz, integer) from authenticated;
select is((select email_skipped_at from public.alerts where id = 'f1243000-0000-4000-8000-000000000001'), null,
  'la alerta sigue sin marcar tras los intentos de usuario');
select is((select count(*)::int from public.audit_log where entity_id = 'f1243000-0000-4000-8000-000000000001'
             and action = 'alert_email_skipped'), 0,
  'sin auditoría de omisión tras los intentos de usuario');

-- Inyección por parámetros: los ids son uuid[] tipados; texto hostil no llega a SQL.
set local role service_role;
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['x''); delete from public.audit_log; --']::uuid[],
       now(), 3, now(), 7) $$,
  '22P02', null, 'id hostil: error de tipo, sin ejecución');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f1243000-0000-4000-8000-000000000001']::uuid[],
       now(), 3, now(), 366) $$,
  '22023', null, 'ventana fuera de rango se rechaza');

-- Backend: marca y audita; la fila de auditoría queda inmutable incluso para service_role.
select is((select count(*)::int from public.mark_alerts_email_expired(
             array['f1243000-0000-4000-8000-000000000001']::uuid[], now() - interval '7 days', 3, now(), 7)), 1,
  'service_role: marca la alerta vencida');
select throws_ok(
  $$ update public.audit_log set details = '{}'::jsonb
      where entity_id = 'f1243000-0000-4000-8000-000000000001' and action = 'alert_email_skipped' $$,
  '42501', null, 'service_role: no edita la auditoría que dejó la RPC');
reset role;

select * from finish();
rollback;

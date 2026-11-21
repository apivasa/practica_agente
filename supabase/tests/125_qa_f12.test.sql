-- QA F-12 (tester), punto (d) del criterio: «la ruta `expired` del correo marca y audita
-- atómicamente vía RPC public.mark_alerts_email_expired, EXECUTE solo a service_role».
-- Complementa 124_* (desarrollador) con bordes de las condiciones de vencida (sent_at
-- exactamente igual al corte, intentos = tope - 1 y = tope, ya omitida con otro motivo,
-- vencida fuera de p_ids), atomicidad de un lote de varias alertas, rangos de parámetros
-- y un rol de usuario con más privilegios (gestora) que tampoco la ejecuta.
begin;
select plan(19);

-- Fixture propio (UUID distintos a la semilla y a 124_*). Corte fijo: 2027-01-10 00:00 UTC.
insert into auth.users (id, email, aud, role) values
  ('f12a0000-0000-4000-8000-000000000001', 'qa-f12-gestora@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('f12b0000-0000-4000-8000-000000000001', 'QA F12 Unidad');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('f12a0000-0000-4000-8000-000000000001', 'kpi_manager', null, null);
-- 1: sent_at = corte (no es «antes»); 2: un segundo antes del corte e intentos = tope - 1;
-- 3: vencida con intentos = tope; 4: vencida ya omitida con otro motivo; 5: vencida y
-- abierta pero no se pasa en p_ids; 6 y 7: lote para la prueba de atomicidad.
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload, sent_at, email_attempts, emailed_at, email_skipped_at, email_skip_reason) values
  ('f12c0000-0000-4000-8000-000000000001', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'color_change', '{}', '2027-01-10T00:00:00Z', 0, null, null, null),
  ('f12c0000-0000-4000-8000-000000000002', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'pace_behind', '{}', '2027-01-09T23:59:59Z', 2, null, null, null),
  ('f12c0000-0000-4000-8000-000000000003', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'color_change', '{}', '2027-01-01T00:00:00Z', 3, null, null, null),
  ('f12c0000-0000-4000-8000-000000000004', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'color_change', '{}', '2027-01-01T00:00:00Z', 0, null, '2027-01-02T00:00:00Z', 'recipient_no_role'),
  ('f12c0000-0000-4000-8000-000000000005', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'color_change', '{}', '2027-01-01T00:00:00Z', 0, null, null, null),
  ('f12c0000-0000-4000-8000-000000000006', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'color_change', '{}', '2027-01-01T00:00:00Z', 0, null, null, null),
  ('f12c0000-0000-4000-8000-000000000007', 'f12b0000-0000-4000-8000-000000000001', 'f12a0000-0000-4000-8000-000000000001', 'color_change', '{}', '2027-01-01T00:00:00Z', 0, null, null, null);

-- «EXECUTE solo a service_role»: la gestora (rol de usuario con más alcance) tampoco.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f12a0000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array['f12c0000-0000-4000-8000-000000000005']::uuid[],
       '2027-01-10T00:00:00Z', 3, '2027-01-11T00:00:00Z', 7) $$,
  '42501', null, 'gestora (authenticated): no ejecuta la RPC');
reset role;
select is((select email_skipped_at from public.alerts where id = 'f12c0000-0000-4000-8000-000000000005'), null,
  'gestora: su intento no marcó nada');

-- Bordes de «vencida y abierta».
set local role service_role;
select results_eq(
  $$ select alert_id from public.mark_alerts_email_expired(
       array['f12c0000-0000-4000-8000-000000000001', 'f12c0000-0000-4000-8000-000000000002',
             'f12c0000-0000-4000-8000-000000000003', 'f12c0000-0000-4000-8000-000000000004']::uuid[],
       '2027-01-10T00:00:00Z', 3, '2027-01-11T00:00:00Z', 7) $$,
  $$ values ('f12c0000-0000-4000-8000-000000000002'::uuid) $$,
  'service_role: solo marca la de sent_at < corte con intentos < tope');
reset role;
select is((select email_skipped_at from public.alerts where id = 'f12c0000-0000-4000-8000-000000000001'), null,
  'sent_at exactamente igual al corte: no se marca (estrictamente antes)');
select is((select email_skip_reason from public.alerts where id = 'f12c0000-0000-4000-8000-000000000002'), 'expired',
  'intentos = tope - 1: se marca expired');
select is((select email_skipped_at from public.alerts where id = 'f12c0000-0000-4000-8000-000000000002'), '2027-01-11T00:00:00Z'::timestamptz,
  'email_skipped_at = p_skipped_at');
select is((select email_skipped_at from public.alerts where id = 'f12c0000-0000-4000-8000-000000000003'), null,
  'intentos = tope: no se marca');
select results_eq(
  $$ select email_skip_reason, email_skipped_at from public.alerts where id = 'f12c0000-0000-4000-8000-000000000004' $$,
  $$ values ('recipient_no_role'::text, '2027-01-02T00:00:00Z'::timestamptz) $$,
  'ya omitida con otro motivo: no se sobrescribe');
select is((select email_skipped_at from public.alerts where id = 'f12c0000-0000-4000-8000-000000000005'), null,
  'vencida que no está en p_ids: no se toca');

-- Auditoría: exactamente una fila por id devuelto, con los datos de la alerta.
select results_eq(
  $$ select entity_id from public.audit_log where action = 'alert_email_skipped' and entity_id like 'f12c0000-%' order by entity_id $$,
  $$ values ('f12c0000-0000-4000-8000-000000000002'::text) $$,
  'solo la alerta marcada tiene fila alert_email_skipped');
select results_eq(
  $$ select actor, details->>'kind', (details->>'unit_id')::uuid, (details->>'recipient_user_id')::uuid,
            (details->>'sent_at')::timestamptz, (details->>'attempts')::int
       from public.audit_log where action = 'alert_email_skipped' and entity_id = 'f12c0000-0000-4000-8000-000000000002' $$,
  $$ values ('system:alert-email'::text, 'pace_behind'::text, 'f12b0000-0000-4000-8000-000000000001'::uuid,
             'f12a0000-0000-4000-8000-000000000001'::uuid, '2027-01-09T23:59:59Z'::timestamptz, 2) $$,
  'la fila de auditoría lleva actor, tipo, unidad, destinatario, sent_at e intentos de la alerta');

-- Lote vacío y rangos de parámetros.
set local role service_role;
select is_empty(
  $$ select * from public.mark_alerts_email_expired(array[]::uuid[], '2027-01-10T00:00:00Z', 3, '2027-01-11T00:00:00Z', 31) $$,
  'lote vacío con ventana de 31 días (máximo del job): no marca nada y no falla');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array[]::uuid[], '2027-01-10T00:00:00Z', 3, '2027-01-11T00:00:00Z', 0) $$,
  '22023', null, 'ventana de 0 días: se rechaza');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array[]::uuid[], '2027-01-10T00:00:00Z', 3, '2027-01-11T00:00:00Z', 366) $$,
  '22023', null, 'ventana de 366 días: se rechaza');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array[]::uuid[], '2027-01-10T00:00:00Z', null, '2027-01-11T00:00:00Z', 7) $$,
  '22004', null, 'tope de intentos nulo: se rechaza');
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(array[]::uuid[], '2027-01-10T00:00:00Z', 3, null, 7) $$,
  '22004', null, 'p_skipped_at nulo: se rechaza (no deja marcas sin fecha)');
reset role;

-- Atomicidad con un lote de dos: si falla la auditoría de una, ninguna del lote queda
-- marcada ni auditada (todo o nada, no solo por alerta). Trigger de prueba, se va con el rollback.
create function public.qa_f12_fail_audit() returns trigger language plpgsql as $f$
begin
  raise exception 'auditoría caída (QA F-12)';
end;
$f$;
create trigger qa_f12_fail_audit before insert on public.audit_log
  for each row when (new.entity_id = 'f12c0000-0000-4000-8000-000000000007') execute function public.qa_f12_fail_audit();
set local role service_role;
select throws_ok(
  $$ select * from public.mark_alerts_email_expired(
       array['f12c0000-0000-4000-8000-000000000006', 'f12c0000-0000-4000-8000-000000000007']::uuid[],
       '2027-01-10T00:00:00Z', 3, '2027-01-11T00:00:00Z', 7) $$,
  'P0001', 'auditoría caída (QA F-12)', 'lote: si falla la auditoría de una alerta, la llamada falla');
reset role;
select is((select count(*)::int from public.alerts
            where id in ('f12c0000-0000-4000-8000-000000000006', 'f12c0000-0000-4000-8000-000000000007')
              and email_skipped_at is not null), 0,
  'lote: ninguna alerta queda marcada');
select is((select count(*)::int from public.audit_log
            where entity_id in ('f12c0000-0000-4000-8000-000000000006', 'f12c0000-0000-4000-8000-000000000007')), 0,
  'lote: ninguna fila de auditoría queda escrita');
drop trigger qa_f12_fail_audit on public.audit_log;

select * from finish();
rollback;

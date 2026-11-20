-- QA M-09: casos que no cubren las pruebas del desarrollador (090).
-- Trazas:
--  - plan-maestro M-09: "grant UPDATE por columna (`target_value`) en `targets`" -> el flujo de
--    la pantalla de metas (M-07: insertar y editar target_value) sigue funcionando para la
--    gestora y los demás roles siguen sin poder escribir (RLS, CLAUDE.md 4: prueba por rol).
--  - plan-maestro M-09: "mediciones rechazan NaN, Infinity y enteros no seguros" -> también por
--    UPDATE (no solo INSERT), -Infinity y decimales por encima de 2^53 - 1 en VULN.
begin;
select plan(18);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000911', 'fx-qa-m09-gestora@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000912', 'fx-qa-m09-custodio@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000913', 'fx-qa-m09-comite@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000914', 'fx-qa-m09-lider@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000000911', 'FX QA M09 Unidad 1');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('cccccccc-0000-4000-8000-000000000911', 'FX_QA_M09_VULN', 'FX QA M09 VULN', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('cccccccc-0000-4000-8000-000000000912', 'FX_QA_M09_AVG', 'FX QA M09 promedio', 'window_average', 'higher_is_better', 99.9, 99.5, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000000911', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000912', 'custodian', null, 'cccccccc-0000-4000-8000-000000000911'),
  ('aaaaaaaa-0000-4000-8000-000000000912', 'custodian', null, 'cccccccc-0000-4000-8000-000000000912'),
  ('aaaaaaaa-0000-4000-8000-000000000913', 'committee', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000914', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000000911', null);
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('dddddddd-0000-4000-8000-000000000911', 'bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000912', '2031-03', 50);
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, category, kind) values
  ('eeeeeeee-0000-4000-8000-000000000911', 'bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000911', '2031-03-05', 5, 'P0P1', 'resolved'),
  ('eeeeeeee-0000-4000-8000-000000000912', 'bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000912', '2031-03-05', 99.9, null, null);

-- ---------------------------------------------------------------------------
-- Metas: la pantalla M-07 (target-admin.js) sigue funcionando con el permiso por columna
-- ---------------------------------------------------------------------------
select ok(has_table_privilege('authenticated', 'public.targets', 'INSERT'),
  'authenticated conserva INSERT en targets (crear la meta del mes, M-07)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000911","role":"authenticated"}';
select results_eq(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000911', '2031-03', 7)
     returning month, target_value $$,
  $$ values ('2031-03'::text, 7::numeric) $$,
  'gestora: crea una meta nueva (rama insert de saveTarget)');
-- Mismo patrón que saveTarget: update de target_value + returning de las columnas de COLUMNS.
select results_eq(
  $$ update public.targets set target_value = 55 where id = 'dddddddd-0000-4000-8000-000000000911'
     returning id, unit_id, indicator_id, month, target_value $$,
  $$ values ('dddddddd-0000-4000-8000-000000000911'::uuid, 'bbbbbbbb-0000-4000-8000-000000000911'::uuid,
             'cccccccc-0000-4000-8000-000000000912'::uuid, '2031-03'::text, 55::numeric) $$,
  'gestora: edita target_value con returning de todas las columnas (rama update de saveTarget)');
select throws_ok(
  $$ update public.targets set target_value = -1 where id = 'dddddddd-0000-4000-8000-000000000911' $$,
  '23514', null, 'gestora: la meta negativa sigue rechazada por CHECK (23514, mensaje de la pantalla)');

-- Roles que NO deben escribir metas: tienen el privilegio de columna, pero RLS no les deja filas.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000912","role":"authenticated"}';
select is_empty(
  $$ update public.targets set target_value = 1 where id = 'dddddddd-0000-4000-8000-000000000911' returning id $$,
  'custodio: no actualiza target_value (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000913","role":"authenticated"}';
select is_empty(
  $$ update public.targets set target_value = 1 where id = 'dddddddd-0000-4000-8000-000000000911' returning id $$,
  'comité: no actualiza target_value (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000914","role":"authenticated"}';
select is_empty(
  $$ update public.targets set target_value = 1 where id = 'dddddddd-0000-4000-8000-000000000911' returning id $$,
  'líder de unidad: no actualiza target_value (RLS)');
reset role;
select is((select target_value from public.targets where id = 'dddddddd-0000-4000-8000-000000000911'), 55::numeric,
  'la meta solo cambió por la gestora');

-- ---------------------------------------------------------------------------
-- Mediciones: valores no finitos también por UPDATE, y enteros no seguros en VULN
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000912","role":"authenticated"}';
select throws_ok(
  $$ update public.measurements set value = 'NaN' where id = 'eeeeeeee-0000-4000-8000-000000000912' $$,
  '23514', null, 'custodio: UPDATE a NaN en un promedio se rechaza');
select throws_ok(
  $$ update public.measurements set value = 'Infinity' where id = 'eeeeeeee-0000-4000-8000-000000000912' $$,
  '23514', null, 'custodio: UPDATE a Infinity en un promedio se rechaza');
select throws_ok(
  $$ update public.measurements set value = 'NaN' where id = 'eeeeeeee-0000-4000-8000-000000000911' $$,
  '23514', null, 'custodio: UPDATE a NaN en VULN se rechaza');
select throws_ok(
  $$ update public.measurements set value = 9007199254740992 where id = 'eeeeeeee-0000-4000-8000-000000000911' $$,
  '23514', null, 'custodio: UPDATE a 2^53 en VULN se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000911', '2031-03-06', '-Infinity', 'P2P3', 'resolved') $$,
  '23514', null, 'custodio: -Infinity en VULN se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000911', '2031-03-06', 9007199254740991.5, 'P2P3', 'resolved') $$,
  '23514', null, 'custodio: 2^53 - 1 + 0,5 en VULN se rechaza');
select lives_ok(
  $$ update public.measurements set value = 0 where id = 'eeeeeeee-0000-4000-8000-000000000911' $$,
  'custodio: UPDATE a 0 en VULN se acepta (borde inferior)');
reset role;
select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000912'), 99.9::numeric,
  'el promedio conserva su valor tras los UPDATE rechazados');

-- Un promedio (no VULN) no está limitado a enteros seguros: el tope 2^53 es solo de VULN.
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000911', 'cccccccc-0000-4000-8000-000000000912', '2031-03-07', 9007199254740992.25) $$,
  'backend: un promedio finito mayor que 2^53 no lo bloquea el CHECK (solo VULN exige entero seguro)');
select is((select count(*)::int from public.measurements
            where indicator_id = 'cccccccc-0000-4000-8000-000000000911' and measured_on = '2031-03-06'), 0,
  'ninguna medición VULN rechazada quedó guardada');

select * from finish();
rollback;

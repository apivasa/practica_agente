-- M-08 (pruebas del desarrollador): H-M06-01 (categoría P0P1/P2P3 y valor entero >= 0 en
-- indicadores de meta acumulada con categorías) y A4 (meta acumulada + "menos es mejor").
begin;
select plan(25);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000801', 'fx-m08-custodio@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000802', 'fx-m08-custodio2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000803', 'fx-m08-comite@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000804', 'fx-m08-lider@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('bbbbbbbb-0000-4000-8000-000000000801', 'FX M08 Unidad', 'aaaaaaaa-0000-4000-8000-000000000804');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('cccccccc-0000-4000-8000-000000000801', 'FX_M08_VULN', 'FX M08 VULN', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('cccccccc-0000-4000-8000-000000000802', 'FX_M08_CUM', 'FX M08 meta sin categorías', 'cumulative_target', 'higher_is_better', 96, 90, '{}'),
  ('cccccccc-0000-4000-8000-000000000803', 'FX_M08_AVG', 'FX M08 promedio', 'window_average', 'higher_is_better', 99.9, 99.5, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000000801', 'custodian', null, 'cccccccc-0000-4000-8000-000000000801'),
  ('aaaaaaaa-0000-4000-8000-000000000801', 'custodian', null, 'cccccccc-0000-4000-8000-000000000802'),
  ('aaaaaaaa-0000-4000-8000-000000000802', 'custodian', null, 'cccccccc-0000-4000-8000-000000000803'),
  ('aaaaaaaa-0000-4000-8000-000000000803', 'committee', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000804', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000000801', null);
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, category, kind, created_by) values
  ('eeeeeeee-0000-4000-8000-000000000801', 'bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801',
   '2027-01-31', 10, 'P0P1', 'resolved', 'aaaaaaaa-0000-4000-8000-000000000801');

select has_trigger('public', 'measurements', 'measurements_category_guard', 'measurements tiene el trigger de categoría');

-- A4: meta acumulada solo con "más es mejor" (también para el backend, que salta RLS)
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M08_BAD', 'x', 'cumulative_target', 'lower_is_better', 4, 8) $$,
  '23514', null, 'cumulative_target + lower_is_better: se rechaza al crear');
select throws_ok(
  $$ update public.indicators set direction = 'lower_is_better', green_threshold = 4, yellow_threshold = 8
     where id = 'cccccccc-0000-4000-8000-000000000802' $$,
  '23514', null, 'cumulative_target + lower_is_better: se rechaza al editar');
select lives_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M08_OK', 'x', 'window_average', 'lower_is_better', 4, 8) $$,
  'window_average + lower_is_better: se acepta');

-- El backend (clave secreta, salta RLS) tampoco carga filas malformadas
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-01', 0.5, 'P0P1', 'resolved') $$,
  '23514', null, 'backend: valor decimal en VULN se rechaza');

-- Custodio de VULN por la API
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000801","role":"authenticated"}';

select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-01', 5, 'P0P1', 'resolved') $$,
  'custodio: resuelta P0P1 entera se acepta');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-01', 3, 'P0P1', 'detected') $$,
  'custodio: detectada P0P1 entera se acepta');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-01', 0, 'P2P3') $$,
  'custodio: P2P3 con valor 0 y sin kind se acepta');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-02', 0.5, 'P0P1', 'resolved') $$,
  '23514', null, 'custodio: valor 0,5 se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-02', 1.5, 'P0P1', 'detected') $$,
  '23514', null, 'custodio: detectada con valor 1,5 se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-02', 5, 'resolved') $$,
  '23514', null, 'custodio: categoría nula se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-02', 5, 'p0p1', 'resolved') $$,
  '23514', null, 'custodio: categoría en minúsculas se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-02', 5, 'X', 'detected') $$,
  '23514', null, 'custodio: categoría desconocida se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-02', 'P0P1', 'resolved') $$,
  '23514', null, 'custodio: valor nulo se rechaza');
select throws_ok(
  $$ update public.measurements set value = 2.5 where id = 'eeeeeeee-0000-4000-8000-000000000801' $$,
  '23514', null, 'custodio: editar a valor decimal se rechaza');
select throws_ok(
  $$ update public.measurements set category = 'P4' where id = 'eeeeeeee-0000-4000-8000-000000000801' $$,
  '23514', null, 'custodio: editar a categoría desconocida se rechaza');
select is(
  (select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000801'), 10::numeric,
  'custodio: la medición original queda intacta');
select is(
  (select count(*)::int from public.measurements where indicator_id = 'cccccccc-0000-4000-8000-000000000801' and measured_on = '2027-02-02'), 0,
  'custodio: ninguna fila rechazada quedó guardada');

-- Meta acumulada sin categorías: la regla no aplica
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000802', '2027-02-01', 0.5) $$,
  'custodio: meta acumulada sin categorías admite decimal sin categoría');

-- Roles sin permiso: siguen sin escribir y reciben la negación de RLS (42501), no la del
-- trigger, aunque la fila sea malformada.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000802","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-03', 5, 'P0P1', 'resolved') $$,
  '42501', null, 'custodio de otro KPI: no carga en VULN');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-03', 0.5, null, 'resolved') $$,
  '42501', null, 'custodio de otro KPI: fila malformada recibe 42501 (RLS antes que el trigger)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000803","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-03', 5, 'P0P1', 'resolved') $$,
  '42501', null, 'comité: no carga mediciones');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000804","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000801', 'cccccccc-0000-4000-8000-000000000801', '2027-02-03', 5, 'P0P1', 'resolved') $$,
  '42501', null, 'líder: no carga mediciones');

reset role;
select ok(not has_function_privilege('authenticated', 'private.check_measurement_category()', 'EXECUTE'),
  'authenticated: no ejecuta la función del trigger');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.check_measurement_category'::regproc),
  'check_measurement_category fija search_path vacío');

select * from finish();
rollback;

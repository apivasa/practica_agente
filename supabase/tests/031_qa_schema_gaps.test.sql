-- QA F-03/F-06: huecos de estructura frente a docs/diseno.md (Modelo de datos,
-- Modelo genérico de indicador, Excepciones) y semilla ficticia.
begin;
select plan(31);

-- Exactamente las 9 tablas del diseño + audit_log (ninguna tabla extra sin pruebas de RLS)
select tables_are('public',
  array['units', 'user_roles', 'indicators', 'commitments', 'measurements', 'targets', 'evaluations', 'exceptions', 'alerts', 'audit_log'],
  'public tiene exactamente las tablas del diseño + audit_log');

-- Claves foráneas que faltaban en 001_schema
select fk_ok('public', 'commitments', 'unit_id', 'public', 'units', 'id', 'commitments.unit_id -> units');
select fk_ok('public', 'measurements', 'indicator_id', 'public', 'indicators', 'id', 'measurements.indicator_id -> indicators');
select fk_ok('public', 'targets', 'indicator_id', 'public', 'indicators', 'id', 'targets.indicator_id -> indicators');
select fk_ok('public', 'evaluations', 'indicator_id', 'public', 'indicators', 'id', 'evaluations.indicator_id -> indicators');
select fk_ok('public', 'exceptions', 'unit_id', 'public', 'units', 'id', 'exceptions.unit_id -> units');
select fk_ok('public', 'alerts', 'unit_id', 'public', 'units', 'id', 'alerts.unit_id -> units');
select fk_ok('public', 'indicators', 'custodian_user_id', 'auth', 'users', 'id', 'indicators.custodian_user_id -> auth.users');

-- Indicador: los 7 atributos del modelo genérico
select has_column('public', 'indicators', 'measurement_type', 'indicador: tipo de medición');
select has_column('public', 'indicators', 'direction', 'indicador: sentido');
select has_column('public', 'indicators', 'window_days', 'indicador: ventana');
select has_column('public', 'indicators', 'thresholds_by_category', 'indicador: umbrales por categoría');
select has_column('public', 'indicators', 'frequency', 'indicador: frecuencia');
select has_column('public', 'indicators', 'min_sample', 'indicador: mínimo de muestra');
select has_column('public', 'indicators', 'source', 'indicador: fuente de datos');

-- Semilla: ningún usuario con correo fuera del dominio reservado (vale con o sin seed cargado)
select is_empty($$ select email from auth.users where email is not null and email not like '%@example.test' $$,
  'semilla: todos los correos son ficticios (@example.test)');

-- Fixture para checks
insert into auth.users (id, email, aud, role)
values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'fx-qa@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'FX Unidad QA');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold)
values ('cccccccc-0000-4000-8000-0000000000e1', 'FX_QA', 'FX QA', 'window_average', 'lower_is_better', 4, 8);

-- Umbrales y sentido inverso
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_QA_BAD', 'x', 'window_average', 'lower_is_better', 8, 4) $$,
  '23514', null, 'menos es mejor con verde > amarillo se rechaza');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category)
     values ('FX_QA_CAT', 'x', 'coverage', 'higher_is_better', 90, 75, '[]') $$,
  '23514', null, 'umbrales por categoría deben ser un objeto');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, window_days)
     values ('FX_QA_WIN', 'x', 'window_average', 'higher_is_better', 90, 75, 0) $$,
  '23514', null, 'ventana de 0 días se rechaza');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, min_sample)
     values ('FX_QA_MIN', 'x', 'window_average', 'higher_is_better', 90, 75, -1) $$,
  '23514', null, 'mínimo de muestra negativo se rechaza');

-- Usuarios y roles: "ligado a su unidad o KPI"
select throws_ok($$ insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'custodian') $$,
  '23514', null, 'custodio sin KPI se rechaza');
select throws_ok(
  $$ insert into public.user_roles (user_id, role, unit_id) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'committee', 'bbbbbbbb-0000-4000-8000-0000000000e1') $$,
  '23514', null, 'comité ligado a una unidad se rechaza');

-- Metas: parcial MENSUAL
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'cccccccc-0000-4000-8000-0000000000e1', '2027-Q1', 10) $$,
  '23514', null, 'meta con periodo trimestral se rechaza (es mensual)');

-- Evaluaciones: una por unidad, indicador y mes (también el color global con indicador nulo)
insert into public.evaluations (unit_id, indicator_id, month, color)
values ('bbbbbbbb-0000-4000-8000-0000000000e1', null, '2027-01', 'red');
select throws_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color) values ('bbbbbbbb-0000-4000-8000-0000000000e1', null, '2027-01', 'green') $$,
  '23505', null, 'evaluación global duplicada para el mismo mes se rechaza');
select throws_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color) values ('bbbbbbbb-0000-4000-8000-0000000000e1', null, '2027-1', 'green') $$,
  '23514', null, 'mes de evaluación con formato inválido se rechaza');
select throws_ok(
  $$ insert into public.evaluations (unit_id, month, color, sample_size) values ('bbbbbbbb-0000-4000-8000-0000000000e1', '2027-02', 'green', -1) $$,
  '23514', null, 'tamaño de muestra negativo se rechaza');

-- Compromisos: uno por unidad, indicador y periodo
insert into public.commitments (unit_id, indicator_id, period) values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'cccccccc-0000-4000-8000-0000000000e1', '2027-Q1');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period) values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'cccccccc-0000-4000-8000-0000000000e1', '2027-Q1') $$,
  '23505', null, 'compromiso duplicado en el mismo periodo se rechaza');

-- Excepciones: "con motivo registrado, fecha de vencimiento"
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on) values ('bbbbbbbb-0000-4000-8000-0000000000e1', '   ', '2027-03-31') $$,
  '23514', null, 'excepción sin motivo se rechaza');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason) values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'urgente') $$,
  '23502', null, 'excepción sin vencimiento se rechaza');

-- Alertas: "a quién"
select throws_ok(
  $$ insert into public.alerts (unit_id, kind) values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'color_change') $$,
  '23502', null, 'alerta sin destinatario se rechaza');

-- Borde: medición en cero es válida
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value) values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'cccccccc-0000-4000-8000-0000000000e1', '2027-01-01', 0) $$,
  'medición con valor 0 es válida');

select * from finish();
rollback;

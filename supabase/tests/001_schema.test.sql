-- F-03/F-04: estructura del modelo (tablas, enums, FKs, checks) y RLS en
-- todas las tablas de public.
begin;
select plan(36);

-- Tablas
select has_table('public', 'units', 'existe units');
select has_table('public', 'user_roles', 'existe user_roles');
select has_table('public', 'indicators', 'existe indicators');
select has_table('public', 'commitments', 'existe commitments');
select has_table('public', 'measurements', 'existe measurements');
select has_table('public', 'targets', 'existe targets');
select has_table('public', 'evaluations', 'existe evaluations');
select has_table('public', 'exceptions', 'existe exceptions');
select has_table('public', 'alerts', 'existe alerts');
select has_table('public', 'audit_log', 'existe audit_log');

-- Enums
select enum_has_labels('public', 'app_role', array['kpi_manager', 'custodian', 'committee', 'unit_leader'], 'enum app_role');
select enum_has_labels('public', 'measurement_type', array['cumulative_target', 'window_average', 'coverage'], 'enum measurement_type');
select enum_has_labels('public', 'direction', array['higher_is_better', 'lower_is_better'], 'enum direction');
select enum_has_labels('public', 'frequency', array['monthly', 'weekly', 'quarterly'], 'enum frequency');
select enum_has_labels('public', 'data_source', array['manual', 'automatic'], 'enum data_source');
select enum_has_labels('public', 'color', array['green', 'yellow', 'red', 'not_evaluated'], 'enum color');
select enum_has_labels('public', 'escalation_level', array['normal', 'restricted', 'frozen', 'exception'], 'enum escalation_level');
select enum_has_labels('public', 'exception_scope', array['change_start', 'all'], 'enum exception_scope');

-- Claves foráneas
select fk_ok('public', 'units', 'leader_user_id', 'auth', 'users', 'id', 'units.leader_user_id -> auth.users');
select fk_ok('public', 'user_roles', 'user_id', 'auth', 'users', 'id', 'user_roles.user_id -> auth.users');
select fk_ok('public', 'user_roles', 'unit_id', 'public', 'units', 'id', 'user_roles.unit_id -> units');
select fk_ok('public', 'user_roles', 'indicator_id', 'public', 'indicators', 'id', 'user_roles.indicator_id -> indicators');
select fk_ok('public', 'commitments', 'indicator_id', 'public', 'indicators', 'id', 'commitments.indicator_id -> indicators');
select fk_ok('public', 'measurements', 'unit_id', 'public', 'units', 'id', 'measurements.unit_id -> units');
select fk_ok('public', 'targets', 'unit_id', 'public', 'units', 'id', 'targets.unit_id -> units');
select fk_ok('public', 'evaluations', 'unit_id', 'public', 'units', 'id', 'evaluations.unit_id -> units');
select fk_ok('public', 'exceptions', 'approved_by', 'auth', 'users', 'id', 'exceptions.approved_by -> auth.users');
select fk_ok('public', 'alerts', 'recipient_user_id', 'auth', 'users', 'id', 'alerts.recipient_user_id -> auth.users');

-- RLS: ninguna tabla de public sin RLS ni sin políticas
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'todas las tablas de public tienen RLS activado'
);
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'todas las tablas de public tienen al menos una política'
);
select ok(
  (select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.prosecdef
     and p.proname in ('has_role', 'has_any_role', 'is_leader_of', 'is_custodian_of')),
  'funciones auxiliares en private con security definer'
);
select ok(
  not has_function_privilege('anon', 'private.has_role(public.app_role)', 'execute'),
  'anon no puede ejecutar private.has_role'
);

-- Restricciones de coherencia
insert into auth.users (id, email, aud, role)
values ('aaaaaaaa-0000-4000-8000-0000000000f1', 'fx-checks@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values ('bbbbbbbb-0000-4000-8000-0000000000f1', 'FX Unidad checks');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold)
values ('cccccccc-0000-4000-8000-0000000000f1', 'FX_CHECK', 'FX check', 'window_average', 'lower_is_better', 4, 8);

select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_BAD', 'FX malo', 'window_average', 'higher_is_better', 90, 95) $$,
  '23514', null, 'umbrales incoherentes con direction se rechazan'
);
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-0000000000f1', 'cccccccc-0000-4000-8000-0000000000f1', '2027-01-01', -1) $$,
  '23514', null, 'medición negativa se rechaza'
);
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period)
     values ('bbbbbbbb-0000-4000-8000-0000000000f1', 'cccccccc-0000-4000-8000-0000000000f1', '2027-13') $$,
  '23514', null, 'periodo con formato inválido se rechaza'
);
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('aaaaaaaa-0000-4000-8000-0000000000f1', 'unit_leader') $$,
  '23514', null, 'líder sin unidad se rechaza'
);

select * from finish();
rollback;

-- Privilegios explícitos de service_role (backend con clave secreta).
-- En producción no hay grants automáticos a service_role: la migración
-- 20261130120000_service_role_grants los concede. audit_log sigue append-only.
begin;
select plan(61);

select ok(has_schema_privilege('service_role', 'public', 'USAGE'), 'service_role: usage en schema public');

-- Tablas de negocio: select, insert, update, delete; nunca truncate.
select ok(has_table_privilege('service_role', 'public.' || t, p), format('service_role: %s en %s', p, t))
from unnest(array['units','user_roles','indicators','commitments','measurements',
                  'targets','evaluations','exceptions','alerts']) as t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p;

select ok(not has_table_privilege('service_role', 'public.' || t, 'TRUNCATE'), format('service_role: sin TRUNCATE en %s', t))
from unnest(array['units','user_roles','indicators','commitments','measurements',
                  'targets','evaluations','exceptions','alerts']) as t;

-- audit_log: solo select e insert.
select ok(has_table_privilege('service_role', 'public.audit_log', 'SELECT'), 'service_role: SELECT en audit_log');
select ok(has_table_privilege('service_role', 'public.audit_log', 'INSERT'), 'service_role: INSERT en audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'UPDATE'), 'service_role: sin UPDATE en audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'DELETE'), 'service_role: sin DELETE en audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE'), 'service_role: sin TRUNCATE en audit_log');

-- Secuencia del bigserial de audit_log.
select ok(has_sequence_privilege('service_role', 'public.audit_log_id_seq', 'USAGE'), 'service_role: USAGE en audit_log_id_seq');
select ok(has_sequence_privilege('service_role', 'public.audit_log_id_seq', 'SELECT'), 'service_role: SELECT en audit_log_id_seq');

-- Columnas C-05 que escribe el correo de alertas.
select ok(has_column_privilege('service_role', 'public.alerts', 'emailed_at', 'UPDATE'), 'service_role: UPDATE en alerts.emailed_at');
select ok(has_column_privilege('service_role', 'public.alerts', 'email_attempts', 'UPDATE'), 'service_role: UPDATE en alerts.email_attempts');

-- Funcional: lo que hace evaluate.js como service_role.
set local role service_role;
select lives_ok($$ select count(*) from public.commitments $$, 'service_role: lee commitments (fallo de producción)');
select lives_ok($$ select count(*) from public.measurements join public.indicators on indicators.id = measurements.indicator_id $$,
  'service_role: lee measurements e indicators');
select lives_ok($$ insert into public.audit_log (actor, action, entity) values ('system:test', 'probe', 'grants') $$,
  'service_role: inserta en audit_log (usa la secuencia)');
select throws_ok($$ update public.audit_log set actor = 'x' $$, '42501', null, 'service_role: no actualiza audit_log');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'service_role: no borra audit_log');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'service_role: no trunca audit_log');
reset role;

select * from finish();
rollback;

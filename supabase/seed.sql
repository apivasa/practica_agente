-- F-06: datos semilla para el entorno LOCAL (supabase db start / db reset).
-- Solo datos ficticios: sin nombres, correos ni datos reales de personas.
-- Todos los correos usan el dominio reservado example.test.
-- Contraseña de prueba de todos los usuarios (solo local): Local-Only-Pass-2026
-- No usar este archivo contra producción.

-- ---------------------------------------------------------------------------
-- Usuarios ficticios (UUID fijos)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('Local-Only-Pass-2026', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  now(),
  now(),
  '', '', '', ''
from (values
  ('11111111-1111-4111-8111-000000000001'::uuid, 'gestora@example.test',   'Gestora de KPIs (ficticia)'),
  ('11111111-1111-4111-8111-000000000002'::uuid, 'custodio1@example.test', 'Custodio vulnerabilidades (ficticio)'),
  ('11111111-1111-4111-8111-000000000003'::uuid, 'custodio2@example.test', 'Custodio operación (ficticio)'),
  ('11111111-1111-4111-8111-000000000004'::uuid, 'comite@example.test',    'Comité de delivery (ficticio)'),
  ('11111111-1111-4111-8111-000000000005'::uuid, 'lider1@example.test',    'Líder Unidad Alfa (ficticio)'),
  ('11111111-1111-4111-8111-000000000006'::uuid, 'lider2@example.test',    'Líder Unidad Beta (ficticio)'),
  ('11111111-1111-4111-8111-000000000007'::uuid, 'lider3@example.test',    'Líder Unidad Gamma (ficticio)'),
  -- M-02..M-04 (e2e): custodio propio para no alterar los alcances que
  -- verifican otras pruebas, un usuario con dos roles y uno sin rol. Ninguno
  -- es líder ni comité: no reciben alertas de C-04.
  ('11111111-1111-4111-8111-000000000008'::uuid, 'custodio3@example.test', 'Custodio cambios (ficticio)'),
  ('11111111-1111-4111-8111-000000000009'::uuid, 'multirol@example.test',  'Gestora y custodio (ficticio)'),
  ('11111111-1111-4111-8111-000000000010'::uuid, 'sinrol@example.test',    'Usuario sin rol (ficticio)')
) as u (id, email, display_name);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%@example.test';

-- ---------------------------------------------------------------------------
-- Unidades ficticias
-- ---------------------------------------------------------------------------
insert into public.units (id, name, leader_user_id) values
  ('22222222-2222-4222-8222-000000000001', 'Unidad Alfa',  '11111111-1111-4111-8111-000000000005'),
  ('22222222-2222-4222-8222-000000000002', 'Unidad Beta',  '11111111-1111-4111-8111-000000000006'),
  ('22222222-2222-4222-8222-000000000003', 'Unidad Gamma', '11111111-1111-4111-8111-000000000007');

-- ---------------------------------------------------------------------------
-- Indicadores de ejemplo
-- ---------------------------------------------------------------------------
insert into public.indicators (
  id, code, name, description, measurement_type, direction, window_days,
  green_threshold, yellow_threshold, thresholds_by_category, frequency,
  min_sample, source, custodian_user_id, active
) values
  ('33333333-3333-4333-8333-000000000001', 'VULN', 'Vulnerabilidades',
   'Cumplimiento del paquete trimestral de vulnerabilidades por criticidad.',
   'cumulative_target', 'higher_is_better', 90, 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}',
   'monthly', 0, 'manual', '11111111-1111-4111-8111-000000000002', true),
  ('33333333-3333-4333-8333-000000000002', 'AVAIL', 'Disponibilidad',
   'Disponibilidad promedio de los servicios en la ventana (%).',
   'window_average', 'higher_is_better', 30, 99.9, 99.5, '{}',
   'monthly', 0, 'manual', '11111111-1111-4111-8111-000000000003', true),
  ('33333333-3333-4333-8333-000000000003', 'MTTR', 'MTTR',
   'Tiempo medio de recuperación de incidentes (horas).',
   'window_average', 'lower_is_better', 30, 4, 8, '{}',
   'monthly', 3, 'manual', '11111111-1111-4111-8111-000000000003', true),
  ('33333333-3333-4333-8333-000000000004', 'OBS', 'Observabilidad',
   'Porcentaje de aplicaciones con observabilidad mínima.',
   'coverage', 'higher_is_better', 30, 90, 75, '{}',
   'monthly', 0, 'manual', '11111111-1111-4111-8111-000000000003', true),
  ('33333333-3333-4333-8333-000000000005', 'CHG', 'Cambios fallidos',
   'Porcentaje de cambios que terminan en incidente (ficticio, para e2e).',
   'window_average', 'lower_is_better', 30, 5, 10, '{}',
   'monthly', 0, 'manual', '11111111-1111-4111-8111-000000000008', false),
  ('33333333-3333-4333-8333-000000000006', 'LAT', 'Latencia',
   'Latencia p95 de los servicios en ms (ficticio, para e2e).',
   'window_average', 'lower_is_better', 30, 300, 500, '{}',
   'monthly', 0, 'manual', '11111111-1111-4111-8111-000000000009', false);
-- CHG y LAT están inactivos: no entran en la evaluación programada (C-03) ni
-- cambian sus conteos; solo dan a custodio3 y multirol un rol de custodio.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('11111111-1111-4111-8111-000000000001', 'kpi_manager', null, null),
  ('11111111-1111-4111-8111-000000000002', 'custodian',   null, '33333333-3333-4333-8333-000000000001'),
  ('11111111-1111-4111-8111-000000000003', 'custodian',   null, '33333333-3333-4333-8333-000000000002'),
  ('11111111-1111-4111-8111-000000000003', 'custodian',   null, '33333333-3333-4333-8333-000000000003'),
  ('11111111-1111-4111-8111-000000000003', 'custodian',   null, '33333333-3333-4333-8333-000000000004'),
  ('11111111-1111-4111-8111-000000000004', 'committee',   null, null),
  ('11111111-1111-4111-8111-000000000005', 'unit_leader', '22222222-2222-4222-8222-000000000001', null),
  ('11111111-1111-4111-8111-000000000006', 'unit_leader', '22222222-2222-4222-8222-000000000002', null),
  ('11111111-1111-4111-8111-000000000007', 'unit_leader', '22222222-2222-4222-8222-000000000003', null),
  ('11111111-1111-4111-8111-000000000008', 'custodian',   null, '33333333-3333-4333-8333-000000000005'),
  ('11111111-1111-4111-8111-000000000009', 'kpi_manager', null, null),
  ('11111111-1111-4111-8111-000000000009', 'custodian',   null, '33333333-3333-4333-8333-000000000006');
-- sinrol@example.test no tiene filas en user_roles.

-- ---------------------------------------------------------------------------
-- Compromisos: paquete trimestral de vulnerabilidades 2027-Q1
-- ---------------------------------------------------------------------------
insert into public.commitments (unit_id, indicator_id, period, package_total, package_by_category, notes, created_by) values
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', '2027-Q1', 2000, '{"P0P1": 1500, "P2P3": 500}', 'Paquete inicial ficticio', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000001', '2027-Q1', 1500, '{"P0P1": 1000, "P2P3": 500}', 'Paquete inicial ficticio', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000001', '2027-Q1', 900,  '{"P0P1": 600, "P2P3": 300}',  'Paquete inicial ficticio', '11111111-1111-4111-8111-000000000002');

-- C-03: umbral negociado de disponibilidad para Unidad Gamma en enero (compromiso mensual).
insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, notes, created_by) values
  ('22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000002', '2027-01', 99.5, 99.0, 'Umbral negociado ficticio', '11111111-1111-4111-8111-000000000003');

-- ---------------------------------------------------------------------------
-- Metas parciales mensuales (aprox. un tercio del paquete, acumuladas)
-- M-06: VULN tiene categorías y ya no usa targets para su color; las filas quedan para las
-- pruebas de RLS y para indicadores de meta acumulada sin categorías.
-- ---------------------------------------------------------------------------
insert into public.targets (unit_id, indicator_id, month, target_value)
select c.unit_id, c.indicator_id, m.month, round(c.package_total * m.share)
from public.commitments c
cross join (values ('2027-01', 1.0 / 3), ('2027-02', 2.0 / 3), ('2027-03', 1.0)) as m (month, share)
where c.period = '2027-Q1';

-- ---------------------------------------------------------------------------
-- Mediciones de ejemplo
-- ---------------------------------------------------------------------------
-- Vulnerabilidades: resueltas (kind = 'resolved', el motor las suma) y P0/P1 nuevas
-- detectadas por escaneo (kind = 'detected').
-- M-06: el color mensual se calcula por criticidad (P0/P1 >= 96 %, P2/P3 >= 85 % de la meta
-- acumulada del mes sobre el paquete efectivo), sin usar targets. Con estos datos:
--   Alfa   enero  P0/P1 500/500 = 100 %, P2/P3 250/167 → verde
--          febrero P0/P1 1050/1134 = 92,6 % (amarillo), P2/P3 350/334 → amarillo
--   Beta   enero  P0/P1 300/334 = 89,8 % → rojo
--   Gamma  enero  P0/P1 280/200, P2/P3 80/100 = 80 % (amarillo) → amarillo
--          febrero P0/P1 280/400 = 70 % → rojo
insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, source, created_by) values
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', '2027-01-31', 500, 'P0P1', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', '2027-01-31', 250, 'P2P3', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000001', '2027-01-31', 300, 'P0P1', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000001', '2027-01-31', 280, 'P0P1', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000001', '2027-01-31', 80, 'P2P3', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', '2027-02-09', 550, 'P0P1', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', '2027-02-09', 100, 'P2P3', 'resolved', 'manual', '11111111-1111-4111-8111-000000000002'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', '2027-02-10', 200, 'P0P1', 'detected', 'manual', '11111111-1111-4111-8111-000000000002');

-- Disponibilidad diaria (%)
insert into public.measurements (unit_id, indicator_id, measured_on, value, source, created_by) values
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000002', '2027-01-15', 99.95, 'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000002', '2027-01-15', 99.60, 'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000002', '2027-01-15', 99.60, 'manual', '11111111-1111-4111-8111-000000000003');

-- MTTR por incidente (horas)
insert into public.measurements (unit_id, indicator_id, measured_on, value, source, created_by) values
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000003', '2027-01-05', 2.5, 'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000003', '2027-01-12', 3.0, 'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000003', '2027-01-20', 5.0, 'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000003', '2027-01-08', 9.0, 'manual', '11111111-1111-4111-8111-000000000003');

-- Observabilidad: una fila por aplicación ficticia
insert into public.measurements (unit_id, indicator_id, measured_on, app_id, compliant, source, created_by) values
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000004', '2027-01-31', 'app-alfa-01', true,  'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000004', '2027-01-31', 'app-alfa-02', true,  'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000004', '2027-01-31', 'app-beta-01', false, 'manual', '11111111-1111-4111-8111-000000000003'),
  ('22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000004', '2027-01-31', 'app-gamma-01', true, 'manual', '11111111-1111-4111-8111-000000000003');

-- ---------------------------------------------------------------------------
-- Excepciones ficticias del comité (C-03/C-04: candados y alertas de vencimiento)
-- ---------------------------------------------------------------------------
insert into public.exceptions (id, unit_id, scope, reason, expires_on, approved_by) values
  ('44444444-4444-4444-8444-000000000001', '22222222-2222-4222-8222-000000000002', 'change_start',
   'Arranque urgente ficticio autorizado por el comité', '2027-02-10', '11111111-1111-4111-8111-000000000004'),
  ('44444444-4444-4444-8444-000000000002', '22222222-2222-4222-8222-000000000003', 'all',
   'Contingencia ficticia: candados suspendidos', '2027-02-05', '11111111-1111-4111-8111-000000000004');

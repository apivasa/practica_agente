-- C-02 (desarrollador): reglas de excepciones del comité.
-- change_ref obligatorio en change_start, tope de vigencia (90 días),
-- solo quien aprobó edita su excepción (H-S03-04 / H-F03-05), revocación,
-- y el líder ni crea ni edita excepciones.
begin;
select plan(36);

insert into auth.users (id, email, aud, role) values
  ('c0200000-0000-4000-8000-000000000001', 'c02-comite1@example.test',  'authenticated', 'authenticated'),
  ('c0200000-0000-4000-8000-000000000002', 'c02-comite2@example.test',  'authenticated', 'authenticated'),
  ('c0200000-0000-4000-8000-000000000003', 'c02-lider@example.test',    'authenticated', 'authenticated'),
  ('c0200000-0000-4000-8000-000000000004', 'c02-gestora@example.test',  'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('c0210000-0000-4000-8000-000000000001', 'C02 Unidad A', 'c0200000-0000-4000-8000-000000000003'),
  ('c0210000-0000-4000-8000-000000000002', 'C02 Unidad B', null);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('c0200000-0000-4000-8000-000000000001', 'committee',   null, null),
  ('c0200000-0000-4000-8000-000000000002', 'committee',   null, null),
  ('c0200000-0000-4000-8000-000000000003', 'unit_leader', 'c0210000-0000-4000-8000-000000000001', null),
  ('c0200000-0000-4000-8000-000000000004', 'kpi_manager', null, null);

-- Fila anterior a C-02: change_start sin change_ref y vigencia mayor al tope.
insert into public.exceptions (id, unit_id, scope, reason, expires_on, approved_by) values
  ('c0270000-0000-4000-8000-0000000000f1', 'c0210000-0000-4000-8000-000000000002', 'change_start', 'Previa a C-02',
   current_date + 150, 'c0200000-0000-4000-8000-000000000001');

-- Esquema
select has_column('public', 'exceptions', 'change_ref', 'exceptions.change_ref existe');
select has_column('public', 'exceptions', 'revoked_at', 'exceptions.revoked_at existe');
select has_column('public', 'exceptions', 'revoked_by', 'exceptions.revoked_by existe');
select has_trigger('public', 'exceptions', 'exceptions_enforce_rules', 'trigger de reglas de excepciones');
select is(private.exception_max_days(), 90, 'tope de vigencia por defecto: 90 días');

-- ---------------------------------------------------------------------------
-- Comité 1 aprueba
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0200000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ insert into public.exceptions (id, unit_id, scope, reason, change_ref, expires_on)
     values ('c0270000-0000-4000-8000-000000000001', 'c0210000-0000-4000-8000-000000000001', 'change_start',
             'Arranque urgente en rojo', 'CHG-1001', (now() at time zone 'America/Guayaquil')::date + 30) $$,
  'comité: aprueba change_start con change_ref');
select is((select approved_by from public.exceptions where id = 'c0270000-0000-4000-8000-000000000001'),
  'c0200000-0000-4000-8000-000000000001'::uuid, 'comité: approved_by = quien aprueba');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on)
     values ('c0210000-0000-4000-8000-000000000001', 'change_start', 'sin change', current_date + 10) $$,
  '23514', null, 'comité: change_start sin change_ref se rechaza');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, change_ref, expires_on)
     values ('c0210000-0000-4000-8000-000000000001', 'change_start', 'change vacío', '   ', current_date + 10) $$,
  '23514', null, 'comité: change_ref en blanco se rechaza');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, change_ref, expires_on)
     values ('c0210000-0000-4000-8000-000000000001', 'all', '   ', null, current_date + 10) $$,
  '23514', null, 'comité: motivo vacío se rechaza');
select lives_ok(
  $$ insert into public.exceptions (id, unit_id, scope, reason, expires_on)
     values ('c0270000-0000-4000-8000-000000000002', 'c0210000-0000-4000-8000-000000000002', 'all',
             'Suspensión total aprobada', (now() at time zone 'America/Guayaquil')::date + 90) $$,
  'comité: scope all sin change_ref, vence justo en el tope');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on)
     values ('c0210000-0000-4000-8000-000000000002', 'all', 'demasiado larga', (now() at time zone 'America/Guayaquil')::date + 91) $$,
  '23514', null, 'comité: vigencia mayor al tope se rechaza');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on, created_at)
     values ('c0210000-0000-4000-8000-000000000002', 'all', 'created_at falso', '2030-01-01', '2029-12-01') $$,
  '23514', null, 'comité: no estira el tope adelantando created_at');
select lives_ok(
  $$ insert into public.exceptions (id, unit_id, scope, reason, expires_on, created_at, revoked_at, revoked_by)
     values ('c0270000-0000-4000-8000-000000000003', 'c0210000-0000-4000-8000-000000000002', 'all', 'campos de servidor',
             current_date + 5, '2020-01-01', '2020-01-01', 'c0200000-0000-4000-8000-000000000002') $$,
  'comité: inserta enviando campos de servidor');
select ok(
  (select created_at > now() - interval '1 minute' and revoked_at is null and revoked_by is null
     from public.exceptions where id = 'c0270000-0000-4000-8000-000000000003'),
  'comité: created_at, revoked_at y revoked_by los fija el servidor al crear');

-- Edita la suya dentro del tope
select lives_ok(
  $$ update public.exceptions set expires_on = (now() at time zone 'America/Guayaquil')::date + 60, reason = 'Arranque urgente (ajustado)'
     where id = 'c0270000-0000-4000-8000-000000000001' $$,
  'comité: quien aprobó ajusta su excepción dentro del tope');
select throws_ok(
  $$ update public.exceptions set expires_on = (now() at time zone 'America/Guayaquil')::date + 120
     where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '23514', null, 'comité: quien aprobó no la extiende más allá del tope');
select throws_ok(
  $$ update public.exceptions set expires_on = current_date - 3 where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '23514', null, 'comité: no mueve el vencimiento al pasado (se revoca)');
select throws_ok(
  $$ update public.exceptions set change_ref = null where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '23514', null, 'comité: no quita el change_ref de una change_start');

select lives_ok(
  $$ update public.exceptions set expires_on = current_date + 120 where id = 'c0270000-0000-4000-8000-0000000000f1' $$,
  'comité: una fila previa a C-02 se puede acortar aunque no tenga change_ref');

-- ---------------------------------------------------------------------------
-- Comité 2 contra la excepción de comité 1 (H-S03-04)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c0200000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.exceptions where id::text like 'c027%'), 4, 'comité 2: ve todas las excepciones');
select throws_ok(
  $$ update public.exceptions set expires_on = current_date + 80 where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité 2: no extiende la excepción de otro');
select throws_ok(
  $$ update public.exceptions set approved_by = 'c0200000-0000-4000-8000-000000000002', expires_on = current_date + 80
     where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité 2: no toma la firma de otro');
select throws_ok(
  $$ update public.exceptions set revoked_at = now() where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité 2: no revoca la excepción de otro');

-- ---------------------------------------------------------------------------
-- Líder y gestora
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c0200000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, change_ref, expires_on)
     values ('c0210000-0000-4000-8000-000000000001', 'change_start', 'me lo apruebo', 'CHG-9', current_date + 10) $$,
  '42501', null, 'líder: no crea excepciones');
select is((select count(*)::int from public.exceptions where id::text like 'c027%'), 1, 'líder: solo ve las de su unidad');
with u as (update public.exceptions set expires_on = current_date + 80 where id = 'c0270000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'líder: no edita la excepción de su unidad') from u;
with u as (update public.exceptions set revoked_at = null where id = 'c0270000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'líder: no toca la revocación') from u;

set local request.jwt.claims = '{"sub":"c0200000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on)
     values ('c0210000-0000-4000-8000-000000000001', 'all', 'x', current_date + 10) $$,
  '42501', null, 'gestora: no aprueba excepciones');

-- ---------------------------------------------------------------------------
-- Revocación por quien aprobó
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c0200000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.exceptions set revoked_by = 'c0200000-0000-4000-8000-000000000002' where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: revoked_by no se escribe directamente');
select lives_ok(
  $$ update public.exceptions set revoked_at = '2000-01-01' where id = 'c0270000-0000-4000-8000-000000000001' $$,
  'comité: quien aprobó revoca su excepción');
select ok(
  (select revoked_at > now() - interval '1 minute' and revoked_by = 'c0200000-0000-4000-8000-000000000001'
     from public.exceptions where id = 'c0270000-0000-4000-8000-000000000001'),
  'comité: la hora y el autor de la revocación los fija el servidor');
select throws_ok(
  $$ update public.exceptions set revoked_at = null where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: una revocada no se reactiva');
select throws_ok(
  $$ update public.exceptions set reason = 'otra cosa' where id = 'c0270000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: una revocada ya no se edita');

reset role;
select is(
  (select count(*)::int from public.audit_log
    where entity = 'exceptions' and entity_id = 'c0270000-0000-4000-8000-000000000001' and action = 'update'),
  2, 'auditoría: el ajuste y la revocación quedan registrados');

-- Backend (service_role / migraciones) no pasa por el trigger de usuario final.
select lives_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on)
     values ('c0210000-0000-4000-8000-000000000002', 'change_start', 'histórica', '2027-12-31') $$,
  'backend: puede registrar datos históricos sin las reglas de usuario final');

select * from finish();
rollback;

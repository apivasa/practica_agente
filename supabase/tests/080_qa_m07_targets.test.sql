-- QA M-07: pantalla #/gestora/metas. Criterio: "otros roles no escriben".
-- Reproduce el flujo de saveTarget (src/data/target-admin.js): buscar la meta de
-- (unidad, indicador, mes); si no existe, insert ... returning; si existe, update por id
-- ... returning. Un caso por rol que debe escribir (gestora) y por cada rol que no
-- (custodio dueño del KPI, comité, líder de la unidad, anónimo). La escritura de la
-- gestora queda auditada (CLAUDE.md, regla 4).
begin;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'm07-gestora@example.test',  'authenticated', 'authenticated'),
  ('a7a7a7a7-0000-4000-8000-000000000002', 'm07-custodio@example.test', 'authenticated', 'authenticated'),
  ('a7a7a7a7-0000-4000-8000-000000000003', 'm07-comite@example.test',   'authenticated', 'authenticated'),
  ('a7a7a7a7-0000-4000-8000-000000000004', 'm07-lider@example.test',    'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('b7b7b7b7-0000-4000-8000-000000000001', 'M07 Unidad 1', 'a7a7a7a7-0000-4000-8000-000000000004');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, custodian_user_id) values
  ('c7c7c7c7-0000-4000-8000-000000000001', 'M07_PATCH', 'M07 Parches', 'cumulative_target', 'higher_is_better', 90, 80, 'a7a7a7a7-0000-4000-8000-000000000002');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('a7a7a7a7-0000-4000-8000-000000000002', 'custodian',   null, 'c7c7c7c7-0000-4000-8000-000000000001'),
  ('a7a7a7a7-0000-4000-8000-000000000003', 'committee',   null, null),
  ('a7a7a7a7-0000-4000-8000-000000000004', 'unit_leader', 'b7b7b7b7-0000-4000-8000-000000000001', null);

set local role authenticated;

-- Gestora: alta, edición y duplicado.
set local request.jwt.claims = '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}';
select is_empty(
  $$ select id from public.targets where unit_id = 'b7b7b7b7-0000-4000-8000-000000000001'
     and indicator_id = 'c7c7c7c7-0000-4000-8000-000000000001' and month = '2026-10' $$,
  'gestora: sin meta previa del mes');
select results_eq(
  $$ insert into public.targets (id, unit_id, indicator_id, month, target_value)
     values ('f7f7f7f7-0000-4000-8000-000000000001', 'b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-10', 10)
     returning target_value $$,
  $$ values (10::numeric) $$,
  'gestora: crea la meta (insert ... returning)');
select results_eq(
  $$ update public.targets set target_value = 20 where id = 'f7f7f7f7-0000-4000-8000-000000000001' returning target_value $$,
  $$ values (20::numeric) $$,
  'gestora: edita la meta (update por id ... returning)');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-10', 5) $$,
  '23505', null, 'gestora: una sola meta por unidad, indicador y mes');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-11', -1) $$,
  '23514', null, 'gestora: meta negativa rechazada');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-13', 1) $$,
  '23514', null, 'gestora: mes fuera de AAAA-MM rechazado');

-- Custodio dueño del KPI: lee la meta, no la crea ni la edita.
set local request.jwt.claims = '{"sub":"a7a7a7a7-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.targets where id = 'f7f7f7f7-0000-4000-8000-000000000001'), 1, 'custodio: lee la meta de su KPI');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-11', 1) $$,
  '42501', null, 'custodio: no crea metas, ni de su propio KPI');
update public.targets set target_value = 1 where id = 'f7f7f7f7-0000-4000-8000-000000000001';

-- Comité: lee, no escribe.
set local request.jwt.claims = '{"sub":"a7a7a7a7-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.targets where id = 'f7f7f7f7-0000-4000-8000-000000000001'), 1, 'comité: lee la meta');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-11', 1) $$,
  '42501', null, 'comité: no crea metas');
update public.targets set target_value = 2 where id = 'f7f7f7f7-0000-4000-8000-000000000001';

-- Líder de la unidad: ve su meta, no la escribe.
set local request.jwt.claims = '{"sub":"a7a7a7a7-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.targets where id = 'f7f7f7f7-0000-4000-8000-000000000001'), 1, 'líder: ve la meta de su unidad');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-11', 1) $$,
  '42501', null, 'líder: no crea la meta de su unidad');
update public.targets set target_value = 3 where id = 'f7f7f7f7-0000-4000-8000-000000000001';

-- Anónimo: nada.
reset role;
set local role anon;
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('b7b7b7b7-0000-4000-8000-000000000001', 'c7c7c7c7-0000-4000-8000-000000000001', '2026-11', 1) $$,
  '42501', null, 'anon: no crea metas');
select throws_ok(
  $$ update public.targets set target_value = 4 where id = 'f7f7f7f7-0000-4000-8000-000000000001' $$,
  '42501', null, 'anon: no edita metas');

-- Verificación como dueño: solo la escritura de la gestora quedó y está auditada.
reset role;
select is((select target_value from public.targets where id = 'f7f7f7f7-0000-4000-8000-000000000001'), 20::numeric,
  'custodio, comité y líder no modificaron la meta');
select is((select count(*)::int from public.targets where indicator_id = 'c7c7c7c7-0000-4000-8000-000000000001'), 1,
  'nadie más que la gestora creó metas');
select is(
  (select count(*)::int from public.audit_log
    where entity = 'targets' and entity_id = 'f7f7f7f7-0000-4000-8000-000000000001'
      and actor = 'a7a7a7a7-0000-4000-8000-000000000001' and action in ('insert', 'update')),
  2, 'auditoría: alta y edición de la meta por la gestora');

select * from finish();
rollback;

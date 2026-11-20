-- C-03/C-04: verificación de la integración (scripts/ci/integration.sh) sobre la semilla.
-- Cada bloque falla con un mensaje claro si la condición no se cumple.
\set ON_ERROR_STOP on

create function pg_temp.expect(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FALLA: %', msg;
  end if;
  raise notice 'ok: %', msg;
end;
$$;

-- Unidades de la semilla
\set alfa  '''22222222-2222-4222-8222-000000000001'''
\set beta  '''22222222-2222-4222-8222-000000000002'''
\set gamma '''22222222-2222-4222-8222-000000000003'''

-- Evaluaciones: 4 indicadores + 1 global por unidad y mes
select pg_temp.expect((select count(*) from public.evaluations where month = '2027-01') = 15, 'enero: 15 evaluaciones');
select pg_temp.expect((select count(*) from public.evaluations where month = '2027-02') = 15, 'febrero: 15 evaluaciones');
select pg_temp.expect(
  (select count(*) from (select unit_id, indicator_id, month from public.evaluations
                          group by 1, 2, 3 having count(*) > 1) d) = 0,
  'sin evaluaciones duplicadas por unidad, indicador y mes');

-- Casos verde / amarillo / rojo y candados (enero)
select pg_temp.expect(
  (select color = 'green' and escalation_level = 'normal' and restrictions = '{}'
     from public.evaluations where unit_id = :alfa and indicator_id is null and month = '2027-01'),
  'Alfa enero: verde, normal');
select pg_temp.expect(
  (select color = 'red' and escalation_level = 'restricted'
          and restrictions = array['no_backlog_additions', 'prioritize_run']
     from public.evaluations where unit_id = :beta and indicator_id is null and month = '2027-01'),
  'Beta enero: rojo, restringida (excepción change_start permite iniciar change)');
select pg_temp.expect(
  (select color = 'yellow' and escalation_level = 'exception' and restrictions = '{}'
     from public.evaluations where unit_id = :gamma and indicator_id is null and month = '2027-01'),
  'Gamma enero: amarillo, en excepción (scope all vigente)');
select pg_temp.expect(
  (select e.color = 'green' and e.reason like '%compromiso%'
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where e.unit_id = :gamma and i.code = 'AVAIL' and e.month = '2027-01'),
  'Gamma enero AVAIL: verde con el umbral del compromiso');
select pg_temp.expect(
  (select e.color = 'not_evaluated'
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where e.unit_id = :beta and i.code = 'MTTR' and e.month = '2027-01'),
  'Beta enero MTTR: sin evaluar (muestra insuficiente)');

-- M-06: VULN por criticidad (P0/P1 96/90, P2/P3 85/75), sin targets
select pg_temp.expect(
  (select count(*) from public.targets t join public.indicators i on i.id = t.indicator_id where i.code = 'VULN') = 0,
  'VULN sin metas en targets durante la integración');
select pg_temp.expect(
  (select bool_and(e.reason like '%P0/P1%' and e.reason like '%P2/P3%')
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where i.code = 'VULN' and e.month in ('2027-01', '2027-02')),
  'VULN: el motivo detalla P0/P1 y P2/P3 en cada unidad y mes');
select pg_temp.expect(
  (select e.color = 'green' and e.value = 100
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where e.unit_id = :alfa and i.code = 'VULN' and e.month = '2027-01'),
  'Alfa enero VULN: verde (P0/P1 500/500, P2/P3 250/167)');
select pg_temp.expect(
  (select e.color = 'yellow' and round(e.value, 1) = 92.6
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where e.unit_id = :alfa and i.code = 'VULN' and e.month = '2027-02'),
  'Alfa febrero VULN: amarillo por P0/P1 1050/1134 (paquete efectivo 1700)');
select pg_temp.expect(
  (select e.color = 'yellow' and e.value = 80
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where e.unit_id = :gamma and i.code = 'VULN' and e.month = '2027-01'),
  'Gamma enero VULN: amarillo por P2/P3 80/100 aunque P0/P1 supera su meta');
select pg_temp.expect(
  (select e.color = 'red'
     from public.evaluations e join public.indicators i on i.id = e.indicator_id
    where e.unit_id = :beta and i.code = 'VULN' and e.month = '2027-01'),
  'Beta enero VULN: rojo (P0/P1 300/334)');

-- Escalada en el mes 2 (febrero)
select pg_temp.expect(
  (select color = 'red' and escalation_level = 'frozen'
          and restrictions = array['freeze_all_change', 'all_capacity_to_run']
     from public.evaluations where unit_id = :beta and indicator_id is null and month = '2027-02'),
  'Beta febrero: rojo por segundo mes, congelada');
select pg_temp.expect(
  (select color = 'red' and escalation_level = 'frozen'
     from public.evaluations where unit_id = :gamma and indicator_id is null and month = '2027-02'),
  'Gamma febrero: rojo tras amarillo, congelada (excepción vencida)');
select pg_temp.expect(
  (select color = 'yellow' and escalation_level = 'restricted'
     from public.evaluations where unit_id = :alfa and indicator_id is null and month = '2027-02'),
  'Alfa febrero: amarillo, restringida');

-- Alertas: exactamente una por disparador y destinatario
select pg_temp.expect((select count(*) from public.alerts) = 20, 'total de alertas = 20');
select pg_temp.expect((select count(*) from public.alerts where kind = 'color_change') = 10, 'color_change = 10');
select pg_temp.expect((select count(*) from public.alerts where kind = 'pace_behind') = 4, 'pace_behind = 4 (Beta y Gamma)');
select pg_temp.expect((select count(*) from public.alerts where kind = 'critical_intake') = 2, 'critical_intake = 2 (Alfa)');
select pg_temp.expect((select count(*) from public.alerts where kind = 'exception_expired') = 4, 'exception_expired = 4');
select pg_temp.expect(
  (select count(*) = count(distinct dedupe_key) and count(*) filter (where dedupe_key is null) = 0 from public.alerts),
  'todas las alertas con dedupe_key única');
select pg_temp.expect(
  (select bool_and((a.payload ->> 'new_total')::int = 2200 and (a.payload ->> 'delta')::int = 200)
     from public.alerts a where a.kind = 'critical_intake'),
  'ingreso de P0/P1: la meta de Alfa pasa de 2000 a 2200');

-- Destinatarios: líder de la unidad (user_roles) + comité; nadie más
select pg_temp.expect(
  (select count(*) from public.alerts a
    where not exists (
      select 1 from public.user_roles r
       where r.user_id = a.recipient_user_id
         and (r.role = 'committee' or (r.role = 'unit_leader' and r.unit_id = a.unit_id)))) = 0,
  'cada alerta va al líder de su unidad o al comité');
select pg_temp.expect(
  (select count(*) from (select unit_id, kind, payload ->> 'month', payload ->> 'as_of', payload ->> 'exception_id',
                                payload ->> 'state', recipient_user_id
                           from public.alerts group by 1, 2, 3, 4, 5, 6, 7 having count(*) > 1) d) = 0,
  'agrupación sin duplicados por destinatario');

-- Auditoría de acciones automáticas
select pg_temp.expect(
  (select count(*) from public.audit_log where actor = 'system:evaluate' and action = 'alert_sent') = 20,
  'auditoría: una fila alert_sent por alerta');
select pg_temp.expect(
  (select count(*) from public.audit_log where actor = 'system:evaluate' and action = 'escalation_applied') = 6,
  'auditoría: candado aplicado por unidad y mes');
select pg_temp.expect(
  (select count(*) from public.audit_log where actor = 'system:evaluate' and action = 'exception_expired') = 1,
  'auditoría: excepción vencida (Gamma) registrada una vez');
select pg_temp.expect(
  (select count(*) from public.audit_log where actor = 'system:evaluate' and action = 'pace_snapshot') = 3,
  'auditoría: snapshot del ritmo por unidad, una vez por día');
select pg_temp.expect(
  (select count(*) = 2 and bool_and(entity_id in ('2027-01', '2027-02'))
     from public.audit_log where actor = 'system:evaluate' and action = 'evaluation_reprocess'),
  'auditoría: cada re-cierre con --reprocess queda como evaluation_reprocess');

-- H-C03-04: created_at de measurements lo fija la BD, no quien inserta
insert into public.measurements (unit_id, indicator_id, measured_on, value, created_at)
values (:alfa, '33333333-3333-4333-8333-000000000002', '2027-01-20', 99.9, '2000-01-01');
select pg_temp.expect(
  (select created_at > now() - interval '1 hour' from public.measurements
    where unit_id = :alfa and measured_on = '2027-01-20' and value = 99.9),
  'measurements.created_at forzado a now() al insertar');

-- M-03 (H-1): commitments exige verde y amarillo negociados juntos.
begin;
select plan(5);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000601', 'fx-m03-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000000601', 'FX M03 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000000601', 'FX_M03', 'FX M03', 'window_average', 'higher_is_better', 99.9, 99.5);

select has_check('public', 'commitments', 'commitments tiene checks');

select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000000601', 'cccccccc-0000-4000-8000-000000000601', '2027-Q1', 99.5, 99) $$,
  'override completo: se acepta');
select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period)
     values ('bbbbbbbb-0000-4000-8000-000000000601', 'cccccccc-0000-4000-8000-000000000601', '2027-Q2') $$,
  'sin override: se acepta');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override)
     values ('bbbbbbbb-0000-4000-8000-000000000601', 'cccccccc-0000-4000-8000-000000000601', '2027-Q3', 99.6) $$,
  '23514', null, 'solo verde: se rechaza');
select throws_ok(
  $$ update public.commitments set yellow_override = null
     where unit_id = 'bbbbbbbb-0000-4000-8000-000000000601' and period = '2027-Q1' $$,
  '23514', null, 'dejar el override a medias por update: se rechaza');

select * from finish();
rollback;

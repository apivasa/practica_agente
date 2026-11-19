-- Seguridad (C-03+C-04), categorías 1, 5 y 8: la columna dedupe_key y los
-- tipos cerrados de alerta no abren privilegios a usuarios. Si un usuario
-- pudiera escribir dedupe_key, podría "reservar" la clave de una alerta futura
-- y silenciarla.
begin;
select plan(9);

select ok(has_column('public', 'alerts', 'dedupe_key'), 'alerts.dedupe_key existe');
select ok(not has_column_privilege('authenticated', 'public.alerts', 'dedupe_key', 'UPDATE'),
  'authenticated: no actualiza alerts.dedupe_key');
select ok(not has_column_privilege('authenticated', 'public.alerts', 'dedupe_key', 'INSERT'),
  'authenticated: no inserta alerts.dedupe_key');
select ok(not has_table_privilege('authenticated', 'public.alerts', 'INSERT'),
  'authenticated: sin INSERT en alerts');
select ok(not has_any_column_privilege('anon', 'public.alerts', 'SELECT')
          and not has_any_column_privilege('anon', 'public.alerts', 'UPDATE'),
  'anon: sin acceso a alerts');
select ok(has_column_privilege('authenticated', 'public.alerts', 'read_at', 'UPDATE'),
  'authenticated: sigue pudiendo marcar read_at');
select ok((select relrowsecurity from pg_class where oid = 'public.alerts'::regclass),
  'alerts mantiene RLS');

-- La clave es única: el backend no duplica y nadie la comparte.
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.alerts'::regclass and conname = 'alerts_dedupe_key_unique' and contype = 'u'),
  'alerts_dedupe_key_unique existe');

-- Tipos cerrados: un kind inventado se rechaza incluso para el backend.
insert into public.units (id, name) values ('5ec10000-0000-4000-8000-0000000000c1', 'SEC3 Unidad');
insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-0000000000c1', 'sec3-lider@example.test', 'authenticated', 'authenticated');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind)
     values ('5ec10000-0000-4000-8000-0000000000c1', '5ec00000-0000-4000-8000-0000000000c1', 'forged') $$,
  '23514', null, 'alerts.kind fuera de la lista se rechaza');

select * from finish();
rollback;

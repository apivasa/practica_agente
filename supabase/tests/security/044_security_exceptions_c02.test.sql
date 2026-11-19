-- Seguridad (C-02), categoría 1: reglas de excepciones que no cubre
-- 070_exceptions_c02 (desarrollador): privilegios por columna, endurecimiento
-- de la función del trigger, adopción de filas sin firmante, reactivar una
-- vencida más allá del tope y la omisión documentada del backend.
begin;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-0000000002c1', 'sec-c02-comite@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000002c2', 'sec-c02-dual@example.test',   'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-0000000002c1', 'SEC C02 Unidad', '5ec00000-0000-4000-8000-0000000002c2');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-0000000002c1', 'committee',   null, null),
  ('5ec00000-0000-4000-8000-0000000002c2', 'unit_leader', '5ec10000-0000-4000-8000-0000000002c1', null);

-- Fixtures del backend: sin firmante, propia creada hace 80 días (ya vencida),
-- y propia de la unidad del líder.
insert into public.exceptions (id, unit_id, scope, reason, expires_on, approved_by, created_at) values
  ('5ec70000-0000-4000-8000-0000000002a1', '5ec10000-0000-4000-8000-0000000002c1', 'all', 'sec huérfana',
   current_date + 10, null, now()),
  ('5ec70000-0000-4000-8000-0000000002a2', '5ec10000-0000-4000-8000-0000000002c1', 'all', 'sec vencida',
   current_date - 5, '5ec00000-0000-4000-8000-0000000002c1', now() - interval '80 days'),
  ('5ec70000-0000-4000-8000-0000000002a3', '5ec10000-0000-4000-8000-0000000002c1', 'all', 'sec del líder',
   current_date + 10, '5ec00000-0000-4000-8000-0000000002c1', now());

-- Privilegios por columna
select ok(not has_column_privilege('authenticated', 'public.exceptions', 'revoked_by', 'UPDATE'),
  'authenticated: no actualiza revoked_by');
select ok(not has_column_privilege('authenticated', 'public.exceptions', 'created_at', 'UPDATE'),
  'authenticated: no actualiza created_at');
select ok(not has_column_privilege('authenticated', 'public.exceptions', 'unit_id', 'UPDATE'),
  'authenticated: no actualiza unit_id');
select ok(not has_column_privilege('authenticated', 'public.exceptions', 'id', 'UPDATE'),
  'authenticated: no actualiza id');
select ok(not has_table_privilege('authenticated', 'public.exceptions', 'DELETE'),
  'authenticated: sin DELETE (revocar, no borrar)');
select ok(not has_any_column_privilege('anon', 'public.exceptions', 'UPDATE')
          and not has_any_column_privilege('anon', 'public.exceptions', 'SELECT'),
  'anon: sin acceso a exceptions');

-- Endurecimiento de la función del trigger
select ok((select not p.prosecdef from pg_proc p where p.oid = 'private.enforce_exception_rules'::regproc),
  'enforce_exception_rules no es security definer (current_user es el del llamante)');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.enforce_exception_rules'::regproc),
  'enforce_exception_rules fija search_path vacío');
select ok(not has_function_privilege('authenticated', 'private.enforce_exception_rules()', 'EXECUTE'),
  'authenticated: no ejecuta la función del trigger');

set local role authenticated;
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000002c1","role":"authenticated"}';

select throws_ok(
  $$ update public.exceptions set approved_by = '5ec00000-0000-4000-8000-0000000002c1'
     where id = '5ec70000-0000-4000-8000-0000000002a1' $$,
  '42501', null, 'comité: no adopta una excepción sin firmante');
select throws_ok(
  $$ update public.exceptions set revoked_at = now() where id = '5ec70000-0000-4000-8000-0000000002a1' $$,
  '42501', null, 'comité: no revoca una excepción sin firmante');

-- Reactivar una vencida propia: el tope sigue contando desde created_at.
select throws_ok(
  $$ update public.exceptions set expires_on = current_date + 30 where id = '5ec70000-0000-4000-8000-0000000002a2' $$,
  '23514', null, 'comité: no reactiva una vencida más allá de created_at + 90');
select lives_ok(
  $$ update public.exceptions set expires_on = current_date + 5 where id = '5ec70000-0000-4000-8000-0000000002a2' $$,
  'comité: reactivar dentro del tope se permite (queda auditado)');

-- Un UPDATE masivo con una fila ajena no deja cambios parciales.
select throws_ok(
  $$ update public.exceptions set reason = 'sec masivo' where reason like 'sec %' $$,
  '42501', null, 'comité: UPDATE masivo con una fila ajena falla entero');
select is((select count(*)::int from public.exceptions where reason = 'sec masivo'), 0,
  'comité: sin cambios parciales tras el UPDATE masivo');

-- El líder (aunque la excepción sea de su unidad) no la revoca.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000002c2","role":"authenticated"}';
update public.exceptions set revoked_at = now() where id = '5ec70000-0000-4000-8000-0000000002a3';
reset role;
select is((select revoked_at from public.exceptions where id = '5ec70000-0000-4000-8000-0000000002a3'), null,
  'líder: no revoca la excepción de su unidad');

-- Omisión documentada: el backend (clave secreta) no pasa por el trigger.
-- Si esto cambia, revisar evaluate.js y el informe C-02 (H-C02-02).
set local role service_role;
select lives_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on, approved_by, created_at)
     values ('5ec10000-0000-4000-8000-0000000002c1', 'all', 'sec backend', current_date + 400, null, now()) $$,
  'service_role: sin tope ni firmante (confianza en la clave secreta; riesgo residual aceptado)');
reset role;

select * from finish();
rollback;

-- Seguridad (F-03+F-04+F-06), categoría 1: privilegios por catálogo.
-- Regresión: cualquier tabla, vista o función nueva que se cree sin RLS, con
-- privilegios peligrosos o con security definer sin search_path hace fallar CI.
begin;
select plan(16);

-- Toda tabla de public tiene RLS activado.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'toda tabla de public tiene RLS activado');

-- Vistas en public: solo con security_invoker (si no, saltan RLS).
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
       and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'ninguna vista de public sin security_invoker');

-- anon no tiene ningún privilegio sobre tablas de public.
select is_empty(
  $$ select c.relname || ':' || p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('anon', c.oid, p.priv) $$,
  'anon: ningún privilegio de tabla en public');

-- authenticated nunca tiene TRUNCATE (ignora RLS), REFERENCES ni TRIGGER.
select is_empty(
  $$ select c.relname || ':' || p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and has_table_privilege('authenticated', c.oid, p.priv) $$,
  'authenticated: sin TRUNCATE, REFERENCES ni TRIGGER en public');

-- Tablas que solo escribe el backend: authenticated no tiene INSERT/DELETE.
select is_empty(
  $$ select t || ':' || p.priv from unnest(array['public.evaluations','public.alerts','public.audit_log']) as t
     cross join unnest(array['INSERT','DELETE']) as p(priv)
     where has_table_privilege('authenticated', t, p.priv) $$,
  'authenticated: sin INSERT ni DELETE en evaluations, alerts y audit_log');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE'), 'authenticated: sin UPDATE en audit_log');
select ok(not has_table_privilege('authenticated', 'public.evaluations', 'UPDATE'), 'authenticated: sin UPDATE en evaluations');
select ok(
  not has_any_column_privilege('authenticated', 'public.alerts', 'UPDATE')
  or (has_column_privilege('authenticated', 'public.alerts', 'read_at', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.alerts', 'recipient_user_id', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.alerts', 'payload', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.alerts', 'kind', 'UPDATE')),
  'authenticated: en alerts solo puede actualizar read_at');

-- Secuencias de public: anon y authenticated no las usan.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
       and (has_sequence_privilege('anon', c.oid, 'USAGE,UPDATE')
            or has_sequence_privilege('authenticated', c.oid, 'USAGE,UPDATE')) $$,
  'anon/authenticated: sin USAGE ni UPDATE en secuencias de public');

-- Esquema private: no accesible para anon.
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon: sin USAGE en el esquema private');
select ok(not has_schema_privilege('authenticated', 'private', 'CREATE'), 'authenticated: sin CREATE en private');
select ok(not has_schema_privilege('authenticated', 'public', 'CREATE'), 'authenticated: sin CREATE en public');

-- security definer: siempre con search_path fijado y vacío.
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='], false) $$,
  'security definer en public/private: search_path vacío');

-- Funciones de private: nadie las ejecuta como anon o PUBLIC.
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE')) $$,
  'private: ninguna función ejecutable por anon ni PUBLIC');

-- Funciones de trigger privilegiadas: authenticated no las invoca directamente.
select ok(not has_function_privilege('authenticated', 'private.audit_row_change()', 'EXECUTE'),
  'authenticated: no ejecuta private.audit_row_change()');

-- security definer expuestas por RPC (public) ejecutables por anon: prohibido.
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'public: ninguna función security definer ejecutable por anon');

select * from finish();
rollback;

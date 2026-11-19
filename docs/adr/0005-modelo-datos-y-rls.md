# ADR 0005 — Modelo de datos, RLS y privilegios

Estado: Aceptado (arquitecto-SRE, 2026-11-19)
Ítems: F-03, F-04, F-06 (`supabase/migrations/2026111912*.sql`, `supabase/seed.sql`)

## Contexto
`docs/diseno.md` fija 9 tablas (Unidades, Usuarios y roles, Indicadores, Compromisos, Mediciones, Metas, Evaluaciones, Excepciones, Alertas) y 4 roles. CLAUDE.md exige RLS en toda tabla y auditoría de toda acción automática con efecto. El desarrollador tomó cuatro decisiones que el diseño no detalla. Este ADR las registra.

## Decisión
1. **Los permisos se derivan solo de `public.user_roles`.** Las funciones `private.has_role`, `is_leader_of` e `is_custodian_of` (`security definer`, `search_path = ''`, esquema `private` no expuesto por PostgREST) leen únicamente `user_roles`. Las columnas `units.leader_user_id` e `indicators.custodian_user_id` son **informativas**, para mostrar datos y elegir destinatarios. No dan permisos. Consecuencia: M-02 (asignar custodio) y la gestión de líderes deben escribir las dos cosas en la misma operación, la columna informativa y la fila de `user_roles`. Hay que añadir una prueba de coherencia (ver "Pendientes").
2. **Lecturas añadidas, más allá del texto literal de F-04:**
   - Los custodios leen todas las unidades y las metas, porque cargan mediciones de cualquier unidad para su KPI.
   - Cualquier usuario con rol lee la definición de todos los indicadores. Es configuración, no datos de una unidad.
   - Cada usuario lee sus propias filas de `user_roles`. Gestora y comité leen todas.
   - Gestora y comité leen `audit_log` y todas las alertas.
   - El líder sigue viendo solo los datos de su unidad: mediciones, compromisos, metas, evaluaciones, excepciones y sus alertas.
3. **La gestora no escribe mediciones ni compromisos.** Según el diseño, los carga y negocia el custodio. La gestora "vigila que el dato esté listo" (V-03), y para eso le basta leer. Si hace falta que la gestora corrija datos, se decide aparte asignándole el rol `custodian` del KPI.
4. **Privilegios mínimos explícitos bajo RLS.** Supabase concede `ALL` (con `TRUNCATE`, que ignora RLS) a `anon` y `authenticated` en cada tabla nueva de `public`. Cada migración revoca todo y concede solo lo necesario: `anon` nada; `authenticated` según la tabla; `UPDATE (read_at)` por columna en `alerts`; sin `DELETE` en commitments, measurements y exceptions. `service_role` (clave `sb_secret_...` de las Actions) conserva sus privilegios por defecto y se salta RLS: es el único que escribe `evaluations`, `alerts` y `audit_log` (C-03, C-04).
5. **Otras decisiones de estructura aceptadas:**
   - `evaluations.indicator_id IS NULL` representa el color global de la unidad.
   - `unique nulls not distinct (unit_id, indicator_id, month)` permite el upsert idempotente de C-03 (PostgreSQL 15 o superior).
   - Los enums SQL tienen los mismos valores que `engine/`.
   - La auditoría por trigger (`private.audit_row_change`, `security definer`) cubre exceptions, user_roles, indicators y commitments.

## Guardas contra olvidar el revoke en tablas futuras
- **Obligatoria (prueba, la hace el tester):** una prueba pgTAP `supabase/tests/030_privileges.test.sql` que recorre el catálogo, para que cualquier tabla nueva quede cubierta sin editar la prueba:
  - `anon` no tiene ningún privilegio en ninguna tabla, secuencia ni función de `public`. Consulta: `information_schema.role_table_grants` / `has_table_privilege('anon', c.oid, ...)` sobre `pg_class` con `relnamespace = 'public'::regnamespace` y `relkind in ('r','p','v','m')` → 0 filas.
  - `authenticated` nunca tiene `TRUNCATE`, `REFERENCES` ni `TRIGGER` en `public`.
  - Los privilegios de `authenticated` coinciden exactamente con una lista permitida (tabla, privilegio) escrita en la prueba. Una tabla nueva sin entrada en la lista hace fallar CI.
  - Toda tabla de `public` tiene `relrowsecurity = true`.
  - Ninguna función `security definer` de `public` o `private` puede ejecutarla `public` ni `anon`.
- **Recomendada (migración, la hace el desarrollador en un ítem futuro):** `alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;` (lo mismo para `sequences`, y `functions` revocando `execute` a `public, anon`). Así una tabla nueva nace sin acceso y el error se ve como "permiso denegado", no como una fuga. Las migraciones siguen concediendo de forma explícita. No sustituye a la prueba: los privilegios por defecto dependen del rol que crea la tabla.

## Pendientes que el modelo debe absorber (cambios aditivos, no desvían el diseño)
- **M-03:** `commitments` solo sobrescribe los umbrales generales (`green_override`, `yellow_override`). Para negociar umbrales por categoría, añadir `thresholds_by_category_override jsonb` con el mismo formato que `indicators.thresholds_by_category`. También falta un check de coherencia de los overrides con `direction`, que hoy solo se valida en el motor.
- **M-05:** `commitments.package_total` (un solo número) **no alcanza**. `engine/vulnerabilities.js` (rama de M-05) necesita `initialPackage { p0p1, p2p3 }`, las P0/P1 nuevas con su fecha de detección y lo resuelto por criticidad. Propuesta:
  - `commitments.package_by_category jsonb` (ej. `{"P0P1": 1500, "P2P3": 500}`), con `package_total` derivado o eliminado antes de producción.
  - `measurements.kind text check (kind in ('resolved','detected'))`, o un enum, para distinguir lo resuelto de lo detectado. Así se calculan el ritmo y el arrastre sin una tabla nueva.
  - Fijar en M-04 si `value` es incremental (el motor suma) o acumulado. La semilla dice "acumuladas" pero el motor suma.
- **C-02:** por ADR 0003 (decisión 2), `change_start` es un inicio puntual. Añadir `exceptions.change_ref text` (qué change se autoriza), obligatorio cuando `scope = 'change_start'`, y opcionalmente `revoked_at`. El vencimiento lo detecta la Action y lo audita en `audit_log`.
- **C-03/C-04:**
  - Hay que probar con pgTAP que `service_role` puede insertar y hacer upsert en evaluations, alerts y audit_log (incluida la secuencia).
  - Para "exactamente una alerta por destinatario", añadir `alerts.dedupe_key text unique` y un check o enum en `alerts.kind` (`color_change`, `pace_behind`, `critical_intake`, `exception_expired`).
  - Si se quiere coherencia con el motor, `evaluations.restrictions` podría llevar un check contra los valores de `RESTRICTIONS`.
- **Auditoría:** hoy no se auditan measurements, targets ni units. Las acciones automáticas (C-03) escriben en `audit_log` de forma explícita. Conviene auditar `update` de measurements cuando exista M-04, porque cambiar un dato ya evaluado altera colores.

## Consecuencias
- Las 9 tablas del diseño existen, más `audit_log`, que exige CLAUDE.md. No hay tablas fuera del diseño.
- Toda migración futura que cree una tabla debe repetir el bloque revoke/grant. La prueba de privilegios lo hace cumplir.

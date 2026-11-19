# F-03+F-04+F-06 — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: 10 tablas en `public` expuestas por PostgREST/pg_graphql (`units`, `user_roles`, `indicators`, `commitments`, `measurements`, `targets`, `evaluations`, `exceptions`, `alerts`, `audit_log`); esquema `private` con 4 funciones `security definer` usadas por las políticas y 2 funciones de trigger; triggers de auditoría; semilla con 7 usuarios ficticios y contraseña local conocida.

## Método
Revisión del SQL de las tres migraciones, `seed.sql` y `config.toml`, más ejecución real: en la sesión había un binario de PostgreSQL 16 (sin Docker ni Supabase CLI). Levanté un clúster temporal en `/tmp` con un entorno Supabase simulado (roles `anon`, `authenticated`, `service_role` con BYPASSRLS, `authenticator`; `auth.users`, `auth.identities`, `auth.uid()` idéntico al de Supabase; los privilegios por defecto de Supabase en `public`) y un pgTAP mínimo. Las tres migraciones y la semilla aplican sin errores. Las pruebas 011, 013, 014, 020, 030 y las nuevas 040–042 pasan en ese entorno. Las 001, 010, 012 y 031 usan funciones de pgTAP que no simulé (`has_table`, `isnt_empty`, `tables_are`), así que no las ejecuté. El resultado definitivo es el job `db (pgTAP)` de `ci.yml`.

## Pruebas de seguridad añadidas
- `supabase/tests/security/040_security_escalation.test.sql`: 35 casos (categoría 1).
  - Claims manipulados con rol de BD `authenticated`: `"role":"service_role"`, `app_metadata.role` y `user_role` inventados, JWT sin `sub`.
  - Usuario sin rol de negocio (el registro abierto sigue activo).
  - Líder: intenta cambiarse de unidad o de rol en su propia fila, apropiarse de la unidad B vía `units.leader_user_id`, extender o crear una excepción, pintarse de verde. También IDOR con `or=`, `in=` y joins.
  - Custodio de X contra el KPI Y: update de mediciones y compromisos, mover un compromiso a Y, reasignarse, relajar los umbrales de su propio KPI.
  - Comité: atribuir `approved_by` a otro, editar la excepción de otro miembro conservando su firma.
  - Gestora: aprobar o extender excepciones, insertar alertas, reescribir evaluaciones.
- `supabase/tests/security/041_security_privileges.test.sql`: 16 casos de regresión por catálogo (categoría 1).
  - Toda tabla de `public` tiene RLS.
  - Las vistas solo pueden existir con `security_invoker`.
  - `anon` no tiene ningún privilegio de tabla.
  - `authenticated` no tiene TRUNCATE, REFERENCES ni TRIGGER, ni INSERT/UPDATE/DELETE en `evaluations`, `alerts` y `audit_log`. En `alerts` solo puede actualizar `read_at`.
  - Secuencias cerradas; `private` sin USAGE para `anon`; sin CREATE en `public` ni en `private`.
  - Toda función `security definer` tiene `search_path=''`. Ninguna función de `private` es ejecutable por `anon` o PUBLIC. Ninguna `security definer` en `public` es ejecutable por `anon`.
  - Comprobé que estas pruebas detectan una tabla o función nueva creada con los privilegios por defecto de Supabase (ver H-F03-04).
- `supabase/tests/security/042_security_audit_truncate.test.sql`: 20 casos (categorías 1 y 8).
  - TRUNCATE como `anon`, gestora y custodio.
  - Secuencia de `audit_log`; invocación directa de `audit_row_change()`; entrada de auditoría fabricada a nombre del comité.
  - Update y delete de la auditoría.
  - El actor sale del `sub` del JWT y no de `created_by`; sin JWT queda como `system:<sesión>`.
  - La auditoría sobrevive al borrado del usuario en `auth.users`.
- `tests/security/db-static-f03.test.js`: 21 casos (node:test, corren en `npm run test:unit`; categorías 1, 6 y 8).
  - Ningún workflow usa `--include-seed`, `db reset --linked/--db-url` ni `psql … seed.sql`.
  - La semilla solo tiene correos `@example.test` y no contiene JWT, claves `sb_*`, teléfonos ni números de 10 dígitos.
  - Cada `create table` de las migraciones tiene `enable row level security`.
  - Las `security definer` tienen `search_path=''`.
  - No hay grants a `anon` ni TRUNCATE/REFERENCES/TRIGGER/ALL a `authenticated`.

**Descubrimiento de `supabase/tests/security/`:** `supabase test db` invoca `pg_prove` con `-r` (recursivo) sobre `supabase/tests`, así que la subcarpeta se incluye. No pude confirmarlo en esta sesión (no hay CLI). **Acción para el orquestador:** comprobar en el log del primer run del job `db (pgTAP)` que aparecen `security/040…042`. Si no aparecen, eso es un hallazgo crítico (pruebas de seguridad que no corren) y hay que mover los archivos a `supabase/tests/04x_security_*.test.sql` o invocar `supabase test db supabase/tests/security` en `seguridad.yml` (S-01).

## Resultados del pipeline
- gitleaks · semgrep · npm audit · ZAP: no aplican todavía; `seguridad.yml` llega con S-01 (en curso) y ZAP con S-04.
- pentest RLS/API: pgTAP local simulado. Resultado: 71 de 71 casos nuevos en verde, y 011/013/014/020/030 en verde. Pendiente de confirmar en el run de `ci.yml` de la rama `item/F-03-F-04-F-06`.

## Hallazgos (ninguno alto ni crítico)
Todos están registrados en `docs/seguridad/hallazgos.md`. No añadí pruebas que fallen por estos hallazgos (no son bloqueantes) ni pruebas marcadas como omitidas. Cada uno incluye cómo reproducirlo.

| ID | Sev. | Cat. | Ubicación | Resumen | Corrección sugerida |
|---|---|---|---|---|---|
| H-F03-01 | Media | 1/8 | `20261119120100_rls_policies.sql` `measurements_update`, `commitments_update` y `grant update on public.measurements` | El custodio de un KPI puede, en una sola UPDATE de una medición: cambiar el valor, **falsificar `created_by`** (poner a otro custodio), poner `source='automatic'`, cambiar `unit_id` y `measured_on`. En el INSERT también puede declarar `source='automatic'`. Lo reproduje con el custodio2 de la semilla: `update measurements set value=100, created_by='…0002', source='automatic', unit_id='<Beta>' where indicator_id='<AVAIL>' and unit_id='<Gamma>'` (1 fila). En `commitments` pasa lo mismo con `created_by`. | `with check (… and created_by = (select auth.uid()))` en ambos UPDATE, o un trigger BEFORE UPDATE que fije `created_by` y `source`. Grants de columna (`update (value, app_id, compliant, category, measured_on)`). `source='automatic'` solo para el backend. |
| H-F03-02 | Media | 8 | `20261119120200_audit_triggers.sql` | **`measurements` no tiene trigger de auditoría**, aunque es la entrada principal del color y, con él, de los candados. Tampoco `targets`, `units` ni `alerts`. Junto con H-F03-01, un custodio puede reescribir el histórico sin dejar rastro (comprobado: 0 filas de `audit_log` con `entity='measurements'` tras el update). | Añadir `audit_measurements`, `audit_targets` y `audit_units`. Evaluaciones y alertas: auditoría explícita desde el backend (C-02/C-03). |
| H-F03-03 | Baja | 8 | `audit_log` y grants por defecto de Supabase | `service_role` (clave secreta de Actions) tiene ALL sobre `audit_log` y la salta RLS: puede actualizarla, borrarla o truncarla (lo reproduje con un borrado de 19 filas). No es un rol de usuario, pero un workflow comprometido borraría la evidencia. | `revoke update, delete, truncate on public.audit_log from service_role`, más un trigger BEFORE UPDATE/DELETE que lance excepción (append-only real). Prueba pgTAP como `service_role`. |
| H-F03-04 | Baja | 1 | Privilegios por defecto de Supabase en `public` y `private` | Las migraciones revocan privilegio por privilegio, pero no cambian los `default privileges`. Una tabla futura nace con ALL para `anon` (incluido TRUNCATE, que ignora RLS) y una función futura en `public` o `private` nace con EXECUTE para anon/PUBLIC (comprobado). Mitigado: 041 lo detecta en CI. | `alter default privileges for role postgres in schema public revoke all on tables, sequences, functions from anon, authenticated;` y `… in schema private revoke execute on functions from public;`. |
| H-F03-05 | Baja | 1 | `exceptions_update` | Cualquier miembro del comité puede reescribir por completo la excepción que aprobó otro miembro: tomar la firma (`approved_by = auth.uid()`), extender `expires_on` hasta 2099 y **moverla a otra unidad** (`unit_id`). Queda auditado. No hay tope de vigencia ni `expires_on >= created_at`. | `unit_id` inmutable (grant de columna sin `unit_id` o trigger). CHECK `expires_on >= created_at::date` y tope de duración si negocio lo define (relacionado con H-C01-03). |
| H-F03-06 | Baja | 2 | `supabase/config.toml` (defaults: `enable_signup = true`) | El registro abierto está activo por defecto. Un usuario autoregistrado no ve nada (probado en 014 y 040), pero ocupa cuentas y amplía la superficie. En producción el ajuste vive en el panel de Auth. | `[auth] enable_signup = false` (la gestora da de alta a los usuarios) y verificarlo en S-05. |
| H-F03-07 | Info | 8 | `seed.sql` | Contraseña común `Local-Only-Pass-2026` para 7 cuentas, incluida la gestora. `supabase db push` **no** aplica `seed.sql` salvo con `--include-seed`; `db reset --linked` sí lo aplica. Ningún workflow lo hace hoy y `db-static-f03.test.js` lo impide en el futuro. Si llegara a producción, sería crítico (cuentas privilegiadas con contraseña pública). | Mantener la guarda. En V-05, `deploy.yml` debe usar `db push` sin `--include-seed`. |
| H-F03-08 | Info | 1 | `units_select`, `indicators_select` | El custodio ve todas las unidades (con `leader_user_id`). Todo usuario con rol ve la configuración de todos los indicadores, también el líder ("ve solo sus indicadores"). Hoy no hay asignación indicador↔unidad, así que es coherente con el diseño actual. | Revisar si se añade asignación por unidad. |

## Verificado sin hallazgos
- **Escalada de privilegios.** Solo la gestora escribe `user_roles` y nadie más puede cambiarse rol ni unidad. Tampoco a través de `units.leader_user_id`, que la autorización no usa: la autorización sale de `user_roles` y no del JWT. Los claims `role`/`app_metadata` inventados no dan nada.
- **WITH CHECK en todos los UPDATE.** Lo tienen `units`, `user_roles`, `indicators`, `targets`, `commitments`, `measurements`, `exceptions` y `alerts`. Un custodio no mueve una medición ni un compromiso a otro KPI.
- **IDOR entre unidades y KPIs.** El líder no ve ni escribe datos de otra unidad, tampoco con `or=`, `in=` ni joins. El custodio de X no lee ni escribe Y.
- **Tablas del backend.** `evaluations`, `alerts` y `audit_log` sin INSERT/DELETE para usuarios. `alerts` solo admite update de `read_at` y solo para el destinatario.
- **Funciones.** Las 4 funciones `security definer` de `private` y el trigger de auditoría tienen `search_path=''`. EXECUTE revocado a PUBLIC/anon; `audit_row_change()` no es invocable por `authenticated`. `private` no está en los esquemas expuestos de la API (`config.toml` usa los defaults `public`, `graphql_public`) y `anon` no tiene USAGE sobre él. Las funciones de ayuda solo informan sobre el propio usuario.
- **Privilegios.** TRUNCATE, REFERENCES y TRIGGER revocados a `anon` y `authenticated`; secuencia de `audit_log` revocada; sin vistas.
- **Auditoría.** Inmutable para todos los roles de usuario. El actor sale de `auth.uid()` (JWT firmado por PostgREST) y no se puede falsificar desde la API. Sobrevive al borrado del usuario: `actor` es texto y no tiene FK.
- **FKs a `auth.users`.** `user_roles` en cascade (correcto). `created_by`/`approved_by`/`leader_user_id`/`custodian_user_id` con set null (se conserva la fila de negocio; la identidad queda en la auditoría). `alerts.recipient_user_id` en cascade (aceptable: la auditoría del envío debe estar en `audit_log`, ver H-F03-02).
- **Semilla.** Datos ficticios: dominio `example.test`, nombres de rol "(ficticio)", UUID sintéticos, sin teléfonos ni identificaciones.

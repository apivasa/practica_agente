# S-05c — Informe QA
Veredicto: VERDE

Revisión independiente (tester) de la rama `item/S-05c` (commit e92e5d7, constructor: seguridad). Ítem: corregir H-QA-S05b-01 y H-QA-S05b-02 (`docs/reportes/S-05b-qa.md`).

## Criterio de aceptación (por punto)

| Punto | Estado | Evidencia |
|---|---|---|
| Sondas de escritura anónima con columnas reales por tabla | Cumplido | Cotejado a mano con `supabase/migrations`. `units.name` (`data_model.sql:22`). `exceptions.unit_id/scope/reason/expires_on` (`:167-174`). `audit_log.actor/action/entity` (`:198-205`). `user_roles.user_id/role` (`:65-70`). Ninguna migración posterior borra ni renombra esas columnas. Cada sonda trae todas las columnas NOT NULL sin default. |
| Enums válidos | Cumplido | `'all'` ∈ `exception_scope` (`data_model.sql:15`). `'kpi_manager'` ∈ `app_role` (`:8`). Además, `kpi_manager` con `unit_id`/`indicator_id` nulos cumple el CHECK `user_roles_scope`. |
| Criterio estricto: solo 401/403 + `42501` (`privilegeDenialProblem`) | Cumplido | Ya no se acepta un `400` genérico. Se rechazan `PGRST*`, `22xxx`, `23xxx`, un 401 sin cuerpo PostgREST y cualquier estado 2xx. |
| El criterio no es tan estricto que falle con la respuesta real de PostgREST | Cumplido, con un riesgo menor (H-QA-S05c-01) | Un INSERT sin privilegio da `42501` en PostgREST 12/13. PostgREST lo traduce a 401 sin JWT y a 403 con JWT. El gateway de Supabase puede añadir un JWT `anon` a la clave publicable, así que se admiten los dos estados. El cuerpo real es `{code:"42501",details:null,hint:null,message:"permission denied for table …"}` y pasa (prueba QA añadida). |
| Prueba estática en CI (`anon-write-probes-s05c.test.js`) | Cumplido | 16 casos, todos verdes. Entra en el glob `tests/security/*.test.js` de `seguridad.yml:152`. |
| Enumeración en el login (suite `roles`) | Cumplido | Compara una cuenta existente con clave errónea contra un correo inexistente: estado, `code`, `error_code`, `error`, mensaje y claves del cuerpo. Hace 2 intentos fallidos en total, sin fuerza bruta. La gestora suma 2 logins y no supera el tope de la cabecera. |
| Nada se debilitó | Cumplido | El caso anónimo de login (`[400, 429]`, línea 192) no cambia. No hay `skip`, `only` ni `todo` nuevos. El tope de 900 peticiones y la lista blanca de hosts siguen igual. |
| Sin escrituras destructivas | Cumplido | `exceptions` y `user_roles` apuntan a UUID que no están en `seed.sql`: si `anon` tuviera INSERT, la FK lo impediría. `units` y `audit_log` llevan la marca `s05-fase-b`. No hay UPDATE ni DELETE. Las sondas no fijan `id`, `created_at`, `approved_by` ni otras columnas de autoría. |

## Pruebas añadidas
- `tests/security/qa-s05c-anon-probes.test.js`, con 4 casos:
  - el cuerpo real de PostgREST con 42501 pasa con 401 y con 403 en las 4 tablas;
  - un 42501 por falta de USAGE en el esquema también cuenta como denegación;
  - se rechazan PGRST205, `Invalid API key`, un 403 sin cuerpo, 23505, un 42501 con estado 500 y un 201;
  - las sondas no llevan columnas de autoría ni generadas.

## Resultado local
`node --test 'tests/security/*.test.js'`: 619 pruebas, 617 pasan, 0 fallan y 2 se omiten. Las 2 omitidas son preexistentes: `front-s04` sin `dist/`. No lancé workflows, como pidió el orquestador. La fase B real queda pendiente de que el orquestador la lance.

## Cobertura engine/
No aplica: el ítem no toca `engine/`.

## Hallazgos
- **H-QA-S05c-01 · Info · riesgo de un ROJO falso en la fase B.** Si PostgREST no tuviera la tabla en su caché del esquema, respondería `404 PGRST205` y la sonda fallaría aunque `anon` no tenga privilegio. Hoy no se espera: la caché del esquema incluye todas las tablas de `public`, sin filtrar por privilegios. Tampoco es un debilitamiento, porque el fallo iría hacia lo estricto. Si ocurre, revisa el cuerpo impreso por `fmt(r)` antes de declarar un hallazgo.
- **H-QA-S05c-02 · Info · `42501` no distingue entre falta de privilegio y RLS.** Un `42501` puede venir de la falta de privilegio o de RLS («new row violates row-level security policy»). En los dos casos la escritura queda denegada y no se crea ninguna fila. Por eso el criterio es correcto, pero con él solo no se demuestra que el GRANT esté revocado. Eso ya lo cubren pgTAP y `hardening.sql:163-167`. Si se quiere precisión, se puede comprobar también `message` ~ `/permission denied/`. No bloquea.
- **H-QA-S05c-03 · Info · el login de la suite `roles` exige 400 exacto.** Si hay límite de tasa (429), el caso falla. El propio mensaje lo explica, así que hay que repetirlo más tarde y no tratarlo como un hallazgo de enumeración.

No hay hallazgos bajos, altos ni críticos.

## Intento 2 (commit 3d993e6)
Veredicto: VERDE

Revisión del cambio de seguridad tras el ROJO de arquitectura (A-1): ahora cada sonda lleva una violación garantizada, y además se exige `message` ~ `/permission denied/`, como pedía H-QA-S05c-02.

| Punto | Estado | Evidencia |
|---|---|---|
| `units.name = '   '` viola el CHECK | Cumplido | `check (length(trim(name)) > 0)` en `data_model.sql:22`. Ninguna migración lo borra y `units` no tiene trigger BEFORE INSERT (`audit_units` es AFTER, `hardening.sql:80-81`). |
| `exceptions`: FK y `reason` en blanco | Cumplido | `reason` tiene `check (length(trim(reason)) > 0)` en `:171`. C-02 solo añade `reason_max_len`. La FK `exceptions_unit_id_fkey` se borra en `hardening.sql:118-121` y se recrea sobre `units(id)`. El trigger BEFORE INSERT `exceptions_enforce_rules` (`business_date.sql:5-76`) devuelve `new` sin cambios fuera de `authenticated`, y nunca reescribe `reason` ni `unit_id`. |
| `audit_log.actor = null` viola NOT NULL | Cumplido | `actor text not null` sin default (`:200`). No hay ningún trigger BEFORE INSERT en `audit_log`: solo `append_only` y `no_truncate`, que son UPDATE, DELETE y TRUNCATE. Un `null` explícito anula cualquier default. |
| `user_roles`: FK y `user_roles_scope` | Cumplido | La FK `auth.users(id)` está en `:67`. `unit_leader` sin `unit_id` viola el CHECK (`:72-78`). El UUID no está en `seed.sql`. |
| Orden privilegio, luego restricciones | Cumplido | PostgreSQL comprueba los permisos de la relación al iniciar el ejecutor, antes de procesar filas. Después, por cada fila, vienen BEFORE triggers, WITH CHECK de RLS, `ExecConstraints` y FK, en ese orden. Sin GRANT, la respuesta es `42501 permission denied for table …`. Con GRANT, sin política anon, saldría primero el 42501 de RLS («new row violates…»), y la nueva regex también lo rechaza. En ningún caso queda fila. |
| Mis pruebas siguen coherentes | Cumplido | No exigían el payload viejo. Los cuerpos reales con «permission denied for table/schema» siguen pasando. |

Pruebas añadidas en `tests/security/qa-s05c-anon-probes.test.js`, que pasa de 4 a 6 casos:
- se rechazan los códigos que daría cada violación garantizada (23514, 23503 y 23502) con 400, 403 y 409;
- se rechaza un 42501 de RLS, con el texto real de PostgreSQL, en las 4 tablas, con 401 y con 403, y también un 42501 sin mensaje.

Resultado local: `node --test 'tests/security/*.test.js'` dio 630 pruebas: 628 pasan, 0 fallan y 2 se omiten. Las 2 omitidas son preexistentes: `front-s04` sin `dist/`.

H-QA-S05c-02 queda resuelto. H-QA-S05c-01 y H-QA-S05c-03 no cambian (Info). No hay hallazgos nuevos.

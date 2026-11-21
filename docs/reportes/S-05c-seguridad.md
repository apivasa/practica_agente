# S-05c — Informe de seguridad
Veredicto: VERDE
Requiere cambiar alcance: no
Superficie nueva: ninguna. El constructor es seguridad y el ítem solo endurece pruebas de la fase B (H-QA-S05b-01 y H-QA-S05b-02 de `docs/reportes/S-05b-qa.md`). No cambia código de la app, workflows ni hosts: la fase B sigue limitada por `guardedFetch` a `apivasa.github.io/practica_agente/` y `<ref>.supabase.co`, con el mismo tope de peticiones y el mismo ritmo.

## Pruebas de seguridad añadidas o endurecidas
- `tests/security/prod/anon-write-probes.js` (nuevo, módulo compartido, no es prueba). Tiene los cuerpos de las sondas de escritura anónima, con columnas reales por tabla:
  - `units {name}`
  - `exceptions {unit_id, scope:'all', reason, expires_on}`
  - `audit_log {actor, action, entity}`
  - `user_roles {user_id, role:'kpi_manager'}`

  Las FK de `exceptions` y `user_roles` apuntan a ids inexistentes. El módulo también tiene `privilegeDenialProblem`, que solo acepta como denegación 401/403 con `code = 42501`. Rechaza cualquier `PGRST*`, los `22xxx`/`23xxx` y los 401/403 sin 42501.
- `tests/security/prod/fase-b.test.js`:
  - Cat. 1: 4 casos endurecidos («escritura anónima denegada por privilegio (42501)»). Antes aceptaban `400` genérico.
  - Cat. 2: 1 caso nuevo en la suite `roles`. Compara el login de la gestora de prueba con clave errónea frente a un correo inexistente: estado, `code`, `error_code`, `error`, mensaje y claves del cuerpo, y exige 400 en ambos. Son 2 intentos fallidos en total, sin fuerza bruta. El caso del modo `anonimo` no cambia.
- `tests/security/anon-write-probes-s05c.test.js` (nuevo, corre en `seguridad.yml` › security-tests con el glob `tests/security/*.test.js`, sin red ni BD): 16 casos de las cat. 1 y 2.
  - Parser de esquema de `supabase/migrations` (`create table` + `alter table add/drop/rename column`) con un control propio. Comprueba que `name` no existe en `exceptions`, `audit_log` ni `user_roles`.
  - Cobertura de las 4 tablas.
  - Por tabla: solo columnas existentes (para que no haya PGRST204) y todas las columnas NOT NULL sin default.
  - Los enums `exception_scope` y `app_role` son válidos (para que no haya 22P02).
  - No destructiva: los ids de las FK no están en `seed.sql` y las filas llevan la marca `s05-fase-b`.
  - Tabla de verdad de `privilegeDenialProblem`: antes pasaban `400 PGRST204`, `400 22P02`, `400` sin cuerpo, `401` sin 42501 y `23xxx`, y ahora fallan.
  - `fase-b.test.js` importa las sondas y no contiene `{name:'s05-fase-b'}` ni `[400, 401, 403]`.
  - La suite `roles` tiene la comparación de enumeración y no hay `skip`/`only`/`todo` fijos.

Ninguna prueba se debilitó ni se desactivó. La suite `roles` sigue saltándose solo por `S05_MODE`.

## Resultados del pipeline
- Local (`node --test`, sin red):
  - `tests/security/anon-write-probes-s05c.test.js`: 16/16 pasan.
  - `tests/security/*.test.js`: 615 casos, 613 pasan, 0 fallan, 2 omitidos. Los 2 omitidos ya existían y no son de este ítem: dependen de `dist/` y corren en security-tests.
  - `tests/security/prod/fase-b.test.js` sin variables: la suite se omite (como en CI fuera de `workflow_dispatch`).
- gitleaks, semgrep, npm audit, ZAP y pentest RLS/API: corren en `seguridad.yml` al abrir el PR. El orquestador debe enlazar el run.
- La fase B contra producción **no se lanzó** (lo indicó el orquestador). La primera ejecución posterior confirma en producción las sondas endurecidas: se espera `401 42501` en las 4 tablas. Si da `PGRST204` o `401` sin 42501, la prueba falla y el hallazgo es real.

## Hallazgos
Ninguno nuevo. Se cierran como corregidos en `docs/seguridad/hallazgos.md`:
- **H-QA-S05b-01** (Baja · 1 · RLS). Queda pendiente confirmarlo en la próxima fase B.
- **H-QA-S05b-02** (Info · 2 · Auth). Se ejecuta cuando exista `S05_TEST_USERS`.

`docs/seguridad/pentest-preproduccion.md` matiza el resultado de S-05b: el rechazo por privilegio solo quedó demostrado en producción para `units`. Para las otras 3 tablas lo cubren pgTAP, la fase A y `pentest-api`.

## Verificado sin hallazgos
- Cat. 1: las sondas anónimas están bien formadas contra el esquema.
- Cat. 2: la prueba de enumeración está diseñada.
- Cat. 8: las sondas son no destructivas y usan datos ficticios.
- No aplican al ítem: las cat. 3 a 7.

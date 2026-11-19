# C-02 — Informe de seguridad
Veredicto: ROJO
Requiere cambiar alcance: no
Superficie nueva: columnas `exceptions.change_ref`, `revoked_at`, `revoked_by`; grant de UPDATE por columna (`scope, reason, change_ref, expires_on, approved_by, revoked_at`); trigger `private.enforce_exception_rules` (invoker, `search_path = ''`); función `private.exception_max_days()`; pantalla `#/comite/excepciones` (lista + formulario + Revocar); capa `src/data/exceptions.js`; `engine/exceptions.js` y `revokedOn`/`changeRef` en `engine/escalation.js`.

## Pruebas de seguridad añadidas
| Archivo | Casos | Categorías |
|---|---|---|
| `tests/security/exceptions-c02.test.js` | 8 (3 XSS, 2 botón/capa de datos, 3 automatización) | 1, 3, 5 |
| `tests/security/api/exceptions-c02.test.js` (PostgREST real, job `pentest-api`) | 10 (≈45 peticiones: ajena, sin firmante, PATCH masivo, 4 actores sin rol, campos de servidor al crear, tope ×5 variantes, revocación forjada/reactivación/edición, entradas inválidas ×4, XSS almacenado, lectura del líder) | 1, 3 |
| `supabase/tests/security/044_security_exceptions_c02.test.sql` | 17 (privilegios por columna, endurecimiento de la función, adopción de huérfanas, reactivar vencida más allá del tope, UPDATE masivo sin cambios parciales, líder no revoca, omisión del backend fijada) | 1 |

La matriz `api/rls-matrix.test.js` no necesita cambios: el PATCH del comité sobre el fixture conserva `approved_by = comité` y sigue pasando; las columnas nuevas las cubre `api/exceptions-c02.test.js`.

## Resultados del pipeline
- Local: `node --test 'tests/security/*.test.js'` → 442 casos, 436 pasan, 2 omitidos (suites API sin Supabase local, por diseño), **4 fallan, todos por H-C02-01** (3 casos + la suite que los agrupa).
- Seguridad sobre 7524a29 (antes de estas pruebas): success — https://github.com/apivasa/practica_agente/actions/runs/44628177313 (gitleaks, semgrep, npm audit, ZAP baseline, pentest RLS/API).
- CI sobre 7524a29: success — https://github.com/apivasa/practica_agente/actions/runs/44628177242
- Las pruebas nuevas (API y pgTAP 044) corren en el siguiente push (no hice commit, como se pidió).

## Hallazgos
- **H-C02-01 · Alta · 1/5 · `scripts/lib/db.js:88-92`, `scripts/lib/build.js:179`.** La evaluación programada (C-03) es la que escribe los candados en `evaluations` y lee las excepciones con `select('id, unit_id, scope, expires_on')`, y `evaluateUnitMonth` no pasa `revokedOn` ni `changeRef` al motor. Resultado: **revocar no tiene efecto**, la excepción revocada sigue suspendiendo `freeze_all_change` y `all_capacity_to_run` hasta que vence (hasta 90 días), y una `change_start` se aplica sin el change concreto.
  Cómo reproducirlo: `evaluateUnitMonth({ evalMonth:'2026-11', asOf:'2026-12-01', indicatorColors:['red'], storedColors:{'2026-10':'red'}, exceptions:[{ id:'e', scope:'all', expires_on:'2026-12-31', revoked_at:'2026-11-20T15:00:00Z' }] })` devuelve `level:'exception'`, `restrictions:[]` cuando debería ser `frozen`.
  Corrección: añadir `revoked_at, change_ref` al select. En `build.js`, mapear `revokedOn: revoked_at ? guayaquilDate(revoked_at) : null` y `changeRef: change_ref` (la conversión puede salir de `src/lib/exceptions-logic.js#toEngineException` hacia `engine/` para no duplicarla). Actualizar `tests/scripts/fake-db.js` y revisar la parte diaria (`run.js:281`). Se corrige sin cambiar el alcance.
- **H-C02-03 · Baja · 5/8 · `scripts/lib/alerts.js:141-150`.** `exceptionAlerts` no excluye las revocadas. Al llegar `expires_on` avisa "venció; vuelven a regir los candados" de una excepción ya revocada, y la revocación misma no genera alerta. Corrección: filtrar `revoked_at` y, si se quiere, añadir una alerta `exception_revoked`.
- **H-C02-02 · Info (aceptado) · 1 · trigger.** `service_role` y las migraciones no pasan por el trigger, así que pueden crear excepciones sin firmante, sin tope y sin `change_ref`. Lo acepto: la clave secreta vive solo en secretos de Actions, ningún script escribe en `exceptions`, `unit_id` sigue inmutable para todos y todo queda en `audit_exceptions`. El pgTAP 044 fija este comportamiento. Si algún script empieza a escribir excepciones, hay que aplicar las reglas también a `service_role`.
- **H-C02-04 · Info · 1 · política `exceptions_insert`.** Compara contra `current_date` en UTC y el trigger contra la fecha de Guayaquil. Entre las 19:00 y las 24:00 de Guayaquil se rechaza una excepción que vence "hoy". Falla cerrada.

## Verificado sin hallazgos
- **H-S03-04 y H-F03-05 corregidos.** Otro miembro del comité no edita, no revoca ni toma la firma (42501). Tampoco se puede adoptar una fila sin firmante. `approved_by`, `created_at`, `revoked_by` y `unit_id` son inmutables por privilegio de columna y por el trigger.
- **El tope no se evade:** ni con POST lejano, ni con POST que manda `created_at` futuro (el servidor lo reescribe), ni con PATCH que alarga, ni con PATCH de `created_at` (no está concedido), ni reactivando una vencida (el tope cuenta desde `created_at`).
- **Revocación:** la hora y el autor los fija el servidor (un `revoked_at` en el pasado se reemplaza por `now()`), `revoked_by` no se puede escribir, una revocada no se reactiva ni se edita y no hay DELETE.
- **Trigger:** es invoker, así que `current_user` es el del llamante y un JWT `authenticated` no lo salta. Fija `search_path = ''` y `authenticated` no puede ejecutarlo. Un UPDATE masivo con una fila ajena falla entero, sin cambios parciales.
- **Líder, gestora, custodio y anónimo:** ni crean, ni editan, ni revocan. El líder solo lee las excepciones de su unidad (incluidas las columnas nuevas).
- **Categoría 3:** `reason` tiene un CHECK de 2000 caracteres y `change_ref` uno de 200. Si falta el change o viene en blanco, la BD responde 400. El motivo y el change con HTML se guardan tal cual y la vista los pinta por `textContent` (`el({text})`), sin sinks HTML. La CSP de S-04 sigue vigente. El botón Revocar solo aparece a quien aprobó, en excepciones vigentes y nunca con `null === null`. La capa de datos no envía campos que fija el servidor.
- Categorías 2, 4, 6 y 7: sin cambios en el ítem. El run de Seguridad está en verde.

## Re-verificación del orquestador (intento 2)
Los 4 hallazgos corregidos (revocadas en Actions vía exceptionFromRow, alertas sin revocadas, fecha de Guayaquil en trigger y política, exceptionStatus único). Pruebas de revisores sin cambios pasan. CI 44631994858 y Seguridad 44631987418 en verde. **Veredicto final: VERDE.**

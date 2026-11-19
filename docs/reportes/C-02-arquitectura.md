# C-02 — Informe de arquitectura y salud
Veredicto: ROJO
Alineado al diseño: no (la Action no ve la revocación; se corrige dentro del ítem)
Requiere decisión del usuario: no
ADR creados o actualizados: docs/adr/0012-excepciones.md (Aceptado)
Salud: CI y Seguridad en verde en `item/C-02` (7524a29). En `main` los últimos CI y Seguridad terminaron en verde. `salud.yml` todavía no existe, así que el monitoreo programado sigue pendiente; no lo agrego en este ítem.

## Lo que está alineado
- **ADR 0003.** `change_start` en `frozen` devuelve `authorizedStarts: [{ id, change_ref }]` y no toca el nivel, las restricciones ni `appliedExceptions`. En `restricted` el comportamiento de C-01 no cambia. Cumple.
- **ADR 0009.** La ruta `/comite/excepciones` está en `ROUTES` y la vista `committee-exceptions` en `VIEWS`. La vista vive en `src/views/committee/exceptions.js`. El único acceso a Supabase está en `src/data/exceptions.js` (vía `client.js`). La lógica pura está en `src/lib/exceptions-logic.js`. Cumple.
- **Tope de 90 días.** Está en `private.exception_max_days()`: inmutable, con `search_path` vacío y sin permisos para anon. El motor lo replica en `EXCEPTION_MAX_DAYS`, y pgTAP y `node:test` fijan el 90 en ambos lados. Cumple.
- **Solo quien aprobó edita.** El trigger exige `old.approved_by = auth.uid()` y deja inmutables `approved_by`, `created_at` y `revoked_by`. `unit_id` no está en los permisos de UPDATE. Nadie revoca la excepción de otro, y una excepción revocada ya no se edita. `revoked_at` y `revoked_by` los fija el servidor. Sin DELETE. Queda registrado en el ADR 0012 como decisión revisable.
- **Modelo de datos.** Siguen las 9 tablas. Se agregan 3 columnas justificadas a `exceptions` (`change_ref`, `revoked_at`, `revoked_by`). La migración es aditiva.
- **Validación.** `engine/exceptions.js` es puro y lo usan el front y las pruebas. La BD es la autoridad.

## Hallazgos
1. **(Bloqueante) Las Actions no filtran las revocadas.** `scripts/lib/db.js:92` solo trae `id, unit_id, scope, expires_on`, y `scripts/lib/build.js:179` arma `{ id, scope, expiresOn }` sin `revokedOn`. El motor sabe ignorar una revocada, pero nunca recibe el dato. Resultado: una excepción `all` o `change_start` revocada sigue suspendiendo candados en `evaluacion-mensual` y `ritmo-diario` hasta su vencimiento.
   Corrección (la hace el desarrollador, en `scripts/`):
   - En `db.js`, el select debe incluir `change_ref, revoked_at`.
   - En `build.js`, mapear `revokedOn: e.revoked_at ? businessDate(new Date(e.revoked_at)) : null` (America/Guayaquil, con `engine/dates.js`) y `changeRef: e.change_ref ?? null`.
   - Agregar una prueba en `tests/scripts/` con una revocada, que no debe suspender el candado.
2. **(Bloqueante, misma causa) Alerta falsa al vencer una revocada.** `exceptionAlerts` (`scripts/lib/alerts.js:141`) no mira `revoked_at`. Sobre una excepción ya revocada avisaría "vence hoy" o "venció; vuelven a regir los candados", y dejaría en auditoría un `exception_expired` que no corresponde. Hay que excluir `revoked_at` no nulo, o usar `exceptionStatus` de `engine/exceptions.js`, y cubrirlo con una prueba.
3. **(Menor) Regla repetida dentro del motor.** `exceptionStatus` en `engine/exceptions.js` y el bucle de `evaluateEscalation` repiten la regla `revokedOn <= asOf` y la de vencimiento. Conviene que `evaluateEscalation` use `exceptionStatus`, así la regla queda en un solo lugar. No bloquea.
4. **(Menor) Fechas del trigger.** En INSERT, el trigger compara `expires_on < current_date` (UTC del servidor), pero `today` se calcula en Guayaquil. La política de inserción también usa `current_date`. Entre las 19:00 y las 24:00 de Guayaquil hay un día de diferencia. No bloquea porque es más estricto y no más laxo, pero conviene unificar en la fecha de Guayaquil cuando se toque.

## Re-verificación del orquestador (intento 2)
Los 4 hallazgos corregidos (revocadas en Actions vía exceptionFromRow, alertas sin revocadas, fecha de Guayaquil en trigger y política, exceptionStatus único). Pruebas de revisores sin cambios pasan. CI 44631994858 y Seguridad 44631987418 en verde. **Veredicto final: VERDE.**

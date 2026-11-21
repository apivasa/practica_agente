# F-13 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md` (punto 8: el rojo esperado H-F11-06 ya no abre issue; `deploy-main` da aviso mientras un run más nuevo está pendiente ≤ 90 min), `docs/adr/0017-correo-de-alertas.md` (adenda F-13: una sola ruta atómica para `expired`, orden de despliegue, H-F12-02 aceptado sin cambio). Runbook `docs/operacion.md` actualizado (tabla de checks, aviso de `deploy-main` y qué hacer si persiste, exit 2 por método faltante).
Salud: CI de la rama en ROJO en `cf2ac79`. Lo causan solo pruebas viejas de `tests/` con BD simuladas sin `markAlertsEmailExpired` (C-05/C-06/H-ARQ-C06-04, `runEmailStep`), que tester y seguridad están actualizando. `integración` y `db (pgTAP)` están en verde. `main` (10:10 UTC): CI en verde en `24070e2`; `deploy.yml` de `6525323` (#56) en `success` a las 09:55 UTC, así que la RPC `mark_alerts_email_expired` ya está en producción; `salud.yml` programado de 07:40 UTC en `success`. `correo-alertas.yml` sigue con 0 runs y el primer cron posible es 11:53 UTC (H-ARQ-C06-02). F-13 no cambia `salud.yml`.

Revisado: rama `item/F-13` en `cf2ac798a2c939335ae0d159a90a8221c5e9b62e`.

## Evaluación

**Stack, engine y modelo.** Sin servicios, tablas, columnas ni migraciones nuevas. No hay cambios en `engine/`. Los cambios están en `scripts/` (capa de jobs) y no duplican lógica de cálculo.

**Correo, fallo cerrado (H-F12-01, H-QA-F12-03).** Coherente con el ADR 0017 y CLAUDE.md §4. Ya no queda ninguna ruta que pueda dejar una alerta `expired` sin su fila en `audit_log`.
- `sendAlertEmails` solo marca vencidas con la RPC. Sin ella anota un error y sigue con los envíos; esto solo pasa con BD simuladas.
- `runEmailStep` exige el método antes de tocar nada y sale con 2, igual que con H-C06-01.
- Separar `REQUIRED_F12_DB_METHODS` de `REQUIRED_C06_DB_METHODS` mantiene el significado de la lista de C-06 (comprobación de destinatario). `REQUIRED_EMAIL_DB_METHODS` deja una sola lista para la capa real.
- Quitar la condición `canSkip` del bloque de vencidas es correcto: ese bloque ya no usa `markAlertsEmailSkipped`.

**Orden de despliegue.** La exigencia es de presencia del método en la capa JS. `createDb` lo implementa desde F-12, así que en producción el exit 2 no puede aparecer por esta causa. La RPC está en producción desde el run de Despliegue de `6525323` (`success`). F-13 no trae migración, así que no hay ventana entre merge y `migrate`. Si un proyecto no tuviera la RPC, el comportamiento sería el de la adenda F-12 (exit 1, visible), no un exit 2. Hoy, sin `RESEND_API_KEY` (P-09), el script termina antes de crear la BD. No hay riesgo de orden.

**Aviso de `deploy-main` (H-ARQ-F12-02).** Resuelve lo que propuse en F-12 sin debilitar `--strict` (ADR 0015 punto 8).
- `newerPendingRun` exige un run pendiente con `created_at` posterior al fallido, filtrado por los mismos eventos (`push`, `workflow_dispatch`), y que lleve ≤ `maxPendingMin` minutos.
- La cobertura solo se aplica si no hay otros problemas (`problems.length === 0`). Un run atascado sigue fallando aunque exista otro pendiente.
- `check.js` trata cualquier `warn` como warning sin issue. No hizo falta tocar `salud.yml`.

**¿Es correcta la ventana `maxPendingMin` (90 min)?** Sí.
- Es el mismo umbral que «atascado». Un run pendiente cuenta como cobertura hasta los 90 min y como atasco después, así que no queda ningún tramo ciego.
- Está por encima de la suma de timeouts de los jobs (~75 min, V-05c). Un run de la punta que agota todos sus timeouts termina antes de perder la cobertura.
- Usar una ventana distinta crearía un tramo ciego (si fuera más larga) o falsos issues (si fuera más corta).
- Con `salud.yml` cada 6 h, el peor caso de retraso de una alerta real es de una corrida. Pasa solo cuando un fallo real coincide con un run nuevo en curso que también falla. La corrida siguiente lo alerta, y el paso 3 del ciclo del orquestador mira los runs de `main` en cada despertar.

**H-F12-02 sin hacer (`p_before` dentro de la RPC).** Acepto el argumento del desarrollador.
- El cambio alteraría la firma de una función ya desplegada, lo que exige una migración nueva y rompe pgTAP 124/125.
- Además partiría la regla en dos relojes. Hoy el job usa un solo `now()` para pendientes y vencidas. Con el cambio, la BD decidiría las vencidas y el job las pendientes, y con desfase una alerta podría quedar en las dos listas o en ninguna.
- La RPC repite las condiciones de vencida con el `p_before` recibido, y su único llamante posible es `service_role`, que ya tiene escritura directa sobre `alerts`. No hay escalada de privilegio.
- Queda razonado en la adenda F-13 del ADR 0017.

## Hallazgos
- **H-ARQ-F13-01 (Alta, bloquea el merge por CI; dueños: tester y seguridad).** CI `build` en rojo en `cf2ac79`. Fallan pruebas que usan BD simuladas sin `markAlertsEmailExpired` o que fijaban la ruta no atómica anterior:
  - `runEmailStep` (394)
  - C-06 QA-C05-1 (399)
  - C-06 H-ARQ-C05-02 (401)
  - H-C06-01 (436)
  - H-ARQ-C06-04 «sin la RPC se mantiene la ruta anterior» (456)
  - C-05 QA reintentos (501)

  Corrección: añadir `markAlertsEmailExpired` a los dobles de BD. La 456 debe pasar a afirmar lo contrario: sin la RPC no se marca nada y `runEmailStep` sale con 2. No es un defecto del código; el desarrollador no puede tocarlas. Seguridad también está en rojo en `cf2ac79` por la misma causa: confirmarlo con su informe.
- **H-ARQ-F13-02 (Baja, aceptado).** Un fallo real de `deploy.yml` con un run más nuevo en curso queda como aviso hasta que ese run decide, como mucho 90 min. Si el run nuevo también falla, la alerta llega en la corrida siguiente de `salud.yml` (≤ 6 h). Es el precio de no abrir issues falsos por H-F11-06. El runbook pide revisar el log del run viejo cuando no dice «Rojo esperado (H-F11-06)».
- **H-ARQ-F13-03 (Informativo, cerrado en docs).** El runbook no explicaba el aviso nuevo de `deploy-main`. Ahora `docs/operacion.md` dice:
  - Cómo se ve el aviso: `... hay uno más nuevo en <status> que lo cubre (rojo esperado H-F11-06)`.
  - Qué hacer: no relanzar el run viejo, esperar al de la punta y revisar la causa si el log no dice H-F11-06.
  - Qué hacer si persiste: no puede durar más de 90 min por run sin pasar a fallo. Si se repite en corridas seguidas, son merges encadenados y hay que revisar la lista de runs de `deploy.yml`.

  También añadí la tabla de checks y el exit 2 por `La capa de BD no implementa ...` (defecto de código: se corrige con un PR y no se relanza). Retiré el texto de F-12 que decía «cerrar el issue transitorio a mano».
- **H-ARQ-F13-04 (Informativo, H-F12-02).** `p_before` sigue calculándose en el job. Riesgo bajo, razonado en la adenda F-13 del ADR 0017. No se propone ítem.
- **H-ARQ-C06-02 (seguimiento, no de F-12/F-13).** `correo-alertas.yml` tiene 0 runs a las 10:10 UTC del 2026-11-21. El cron de 11:53 UTC **aún no corrió** (no ha llegado la hora). Sigue dentro de la gracia, que vence el 2026-11-22 a las 09:04 UTC. Si a esa hora sigue sin runs, el siguiente ciclo lo lanza a mano (`.../workflows/correo-alertas.yml/dispatches -f ref=main`) y comprueba el check `correo-alertas` de `salud.yml`.

Ninguna conclusión exige cambiar una decisión confirmada del diseño.

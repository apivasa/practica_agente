# F-12 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0015-despliegue-manual-primero.md` (punto 8: `workflow_dispatch` entra en la regla de punta; rojo esperado de `--strict`, H-F11-06), `docs/adr/0017-correo-de-alertas.md` (adenda F-12: RPC de backend en `public`, patrón para futuras RPC solo `service_role`, orden de despliegue). Runbook `docs/operacion.md` actualizado.
Salud: CI de la rama en ROJO en `c8229db` (ver H-ARQ-F12-01; lo causan pruebas de revisores que fijaban el comportamiento anterior, no un defecto de arquitectura). `main`: CI y Seguridad en verde; último `deploy.yml` (push, 08:13 UTC) `success`; `salud.yml` programado 07:40 UTC `success`. `correo-alertas.yml` activo desde 2026-11-21 03:04 UTC y aún sin runs (H-ARQ-C06-02, gracia hasta 2026-11-22 09:04 UTC; primer cron posible 11:53 UTC de hoy). F-12 no cambia `salud.yml`.

Revisado: rama `item/F-12` en `c8229db1999a7f6559aa549c02919bf8649c7361`.

## Evaluación

**Stack y engine puro.** Sin servicios nuevos. La RPC no trae lógica de negocio a SQL: ventana e intentos siguen en `scripts/lib/email.js` y llegan como parámetros. La función solo da atomicidad a una marca de estado que ya estaba decidida. No hay cambios en `engine/`. No hay tablas ni columnas nuevas: el modelo de 9 tablas más `audit_log` no cambia.

**Auditoría (CLAUDE.md §4).** Antes, si fallaba la segunda petición, la alerta quedaba marcada `expired` sin su fila en `audit_log` (H-ARQ-C06-04). Ahora la CTE `UPDATE ... RETURNING` + `INSERT` hace las dos cosas en una sola sentencia. El actor `system:alert-email` y el detalle son los mismos que en la ruta anterior. Cerrado.

**Privilegios.** `SECURITY INVOKER`, `search_path = ''`, `EXECUTE` revocado a `public`, `anon` y `authenticated` y concedido explícito a `service_role`, con su pgTAP. Va en `public` porque `supabase-js` solo invoca RPC de esquemas expuestos; el aislamiento lo da el privilegio. Es la primera RPC solo de backend: el patrón queda fijado en la adenda del ADR 0017.

**Orden de despliegue.** `deploy.yml` (push a `main`) aplica la migración en `migrate` y el cron de `correo-alertas` usa el script de `main`. Si el cron corre entre el merge y el fin de `migrate`, `createDb.markAlertsEmailExpired` recibe «función no encontrada». La ventana es de unos 20–40 min, más si `migrate` espera aprobación. Qué pasa entonces:
- El error queda en `summary.errors` y no se marca nada, así que la consistencia entre marca y auditoría se mantiene.
- Los correos pendientes se envían igual.
- El run sale con 1 y `salud.yml` lo ve.
- La corrida siguiente lo resuelve sola.

Es cerrado para la auditoría, no tiene un fallback silencioso en producción y es visible. Se acepta. Hoy, sin `RESEND_API_KEY` (P-09), el script termina antes de tocar la BD y la ventana no existe. No añadir la RPC a `REQUIRED_C06_DB_METHODS` es correcto: esa lista protege la comprobación de destinatario (H-C06-01), y la ausencia de la RPC no la afecta.

**H-F11-02 (`workflow_dispatch`).** Es coherente con el objetivo del ADR 0015 punto 8: un Re-run de un disparo viejo reutilizaba `confirm` y `github.sha` y podía republicar un commit superado. Un disparo nuevo sigue funcionando, porque `github.sha` es la punta al lanzarlo. El texto del ADR que decía «en `workflow_dispatch` no aplica» queda actualizado.

**H-F11-06 (documentar en vez de evitar).** Es aceptable. Convertirlo en aviso exigiría que `--strict` deje pasar un job ya superado o añadir `if:` por paso, y las dos cosas debilitan la garantía «nunca publicar ni migrar un commit superado». El rojo es raro (hace falta un merge mientras otro run migra), no tiene efecto en producción y el `::error::` lo identifica. Queda documentado en el ADR 0015 y en el runbook. Su impacto en salud está en H-ARQ-F12-02.

**H-F11-05.** Sanear el status a `[a-z_]` antes de `::error::` es correcto y no cambia veredictos.

## Hallazgos
- **H-ARQ-F12-01 (Alta, bloquea el merge por CI; dueños: tester y seguridad).** CI en rojo en `c8229db` por pruebas que fijaban el comportamiento anterior. El desarrollador no puede tocarlas.
  - `tests/scripts` (`build`):
    - «check-main-tip: workflow_dispatch se exime sin llamar a gh; otros eventos fallan» (not ok 413).
    - «check-main-tip: escribe deploy=true en la punta, con solo docs detrás y con workflow_dispatch» (not ok 422).
  - `tests/security` (172): «sec check-main-tip: workflow_dispatch se exime sin consultar la API».
  - `pentest-api`:
    - Prueba de catálogo «funciones expuestas por RPC (public) coinciden con la lista permitida»: falla con `mark_alerts_email_expired`.
    - «la API (OpenAPI) solo publica las tablas de la matriz»: también la lista.

  Corrección: las pruebas deben reflejar la regla nueva (dispatch evaluado contra la punta). La función se añade a la lista permitida como solo `service_role`, y la prueba comprueba que `anon` y `authenticated` reciben 401/403/404 al invocarla. Seguridad debe confirmar con qué rol se lee el OpenAPI en esa prueba: si es la clave publicable y la función aparece, verificar que no es invocable (PostgREST puede listar sin conceder).
- **H-ARQ-F12-02 (Baja, se propone como ítem; código de `scripts/health/lib.js`).** Con el rojo esperado de H-F11-06, `assessDeploy` toma el último run completado por `created_at`. Mientras el run de la punta sigue en curso (hasta 75 min), una corrida de `salud.yml` (cada 6 h) puede abrir un issue `deploy-main` transitorio. Propuesta: no contar un `failure` si existe un run más nuevo de `deploy.yml` pendiente dentro de `maxPendingMin`. Por ahora el runbook explica cómo cerrarlo.
- **H-ARQ-F12-03 (Informativo).** Ventanal entre merge y migración para la RPC: es fail-closed y se recupera solo. Documentado en la adenda F-12 del ADR 0017 y en `docs/operacion.md` (el error `mark_alerts_email_expired` / `PGRST202`, y `permission denied` sin conceder a mano a otros roles).
- **H-ARQ-C06-02 (seguimiento, no de F-12).** `correo-alertas.yml` tiene 0 runs. Sigue dentro de la gracia (vence 2026-11-22 09:04 UTC). Si a esa hora sigue sin runs, el siguiente ciclo debe lanzarlo a mano (`.../workflows/correo-alertas.yml/dispatches -f ref=main`) y comprobar el check `correo-alertas` de `salud.yml`.

Ninguna conclusión exige cambiar una decisión confirmada del diseño.

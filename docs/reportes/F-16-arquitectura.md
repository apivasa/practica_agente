# F-16 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: ninguno (es un ajuste interno del check `deploy-main`; no hay decisión nueva)
Salud: CI y Seguridad en `success` sobre 80c8d16 (`item/F-16`). `salud.yml` en `main`: último run programado 07:40 UTC del 2026-11-21 en `success`. Los crons de GitHub llegan con retraso o se pierden (ver «Correo de alertas»). `docs/operacion.md` actualizada.

Hallazgos:

- Revisé el diff de `scripts/health/lib.js` (`parseApiTime`, `API_TIME_RE`, `compareIdDesc`, `sinceOf`, `validTimes`) y las pruebas nuevas en `tests/scripts/f16-fixes.test.js`.
- **Alineación.** El cambio sigue dentro de `scripts/health/`, la lógica de salud, que no es de negocio y por eso no va en `engine/`. No agrega dependencias, tablas, workflows ni permisos. Es configuración del check, no código específico de un KPI.
- **H-F15-01, cumplido.** `API_TIME_RE` exige `AAAA-MM-DDThh:mm:ss[.fracción]` con `Z` o `±hh:mm`. Lo probé con los formatos reales de la API:
  - `2026-11-21T07:40:28Z` (runs) se acepta.
  - `2026-11-20T22:04:34.000-05:00` (`created_at` de `actions/workflows`) se acepta.
  - Sin zona, con espacio o con `+0000` da `NaN`.
  - `newerPendingRun` usa la misma función, así que también queda cubierto.
- **H-F15-02, cumplido.** Con el mismo `created_at` decide el `id` mayor. Si alguno no tiene `id` entero, se conserva el orden de entrada, como antes. No cambia el orden entre fechas distintas.
- **H-F15-03, cumplido.** Si `run_started_at` es ilegible o futuro y `created_at` es válido, el pendiente se mide con `created_at`, lo que puede marcarlo como atascado. Si `created_at` es inválido, el pendiente se sigue descartando, como pide qa-v04b. Un pendiente así nunca cubre un fallo, porque `newerPendingRun` rechaza su `run_started_at`. Es más estricto que antes y no oculta nada.
- **Sin regresión.** No cambian `isolatedFailure`, el aviso por cancelado, el aviso por fallo cubierto ni `WORKFLOW_RULES`. Si GitHub cambiara el formato de las fechas, los completados darían `fail` en `deploy-main`. Es fallo cerrado, igual que en F-15, y no queda silencio. El runbook ya explica cómo reconocerlo.
- **H-ARQ-F16-01 (info, no bloquea).** Dos comentarios quedaron imprecisos tras F-16:
  - El JSDoc de `assessDeploy` (líneas 259-261) sigue diciendo «los pendientes con fecha inválida se descartan».
  - El comentario de las líneas 276-278 sigue nombrando `run_started_at`.
  - La nota F-16 de las líneas 279-281 lo matiza. Conviene corregirlos si alguien vuelve a tocar la función.
- **H-ARQ-F16-02 (info, no bloquea).** `API_TIME_RE` valida la forma de la fecha, no el calendario. Por ejemplo, V8 acepta `2026-02-30T00:00:00Z` y lo lleva al 2 de marzo. GitHub no emite fechas así, y una fecha así no puede quedar más de 5 min en el futuro ni tapar un fallo más reciente. No se abre ítem.
- **H-ARQ-F16-03 (info, fuera del alcance).** `assessWorkflow` sigue leyendo `workflow.created_at` con `Date.parse(...) || 0` (línea 136), no con `parseApiTime`. Si la fecha falla, el resultado es 0, se pierde la gracia de «workflow reciente» y el check falla, que es el lado seguro. No se abre ítem.
- **Runbook.** Actualicé `docs/operacion.md`:
  - Fila `deploy-main` de la tabla de checks: formato exigido, `run_started_at` inválido medido con `created_at` y desempate por `id`.
  - Alerta «fecha inválida»: el formato exacto y qué hacer si todas las corridas fallan a la vez por un cambio de formato de GitHub.
  - Observación de crons del 2026-11-21.

## Correo de alertas (`correo-alertas.yml`): 0 runs

Diagnóstico: **el workflow está bien. La causa probable es el planificador de GitHub**, que retrasa o descarta los crons en este repositorio.

- **El archivo está bien.** El YAML es válido y está en `main`, la rama por defecto. La API lo da `active`, registrado el 2026-11-20T22:04:34-05:00, es decir, el 21 a las 03:04 UTC. Tiene `schedule` (`53 11 * * *`, `53 14 * * *`) y `workflow_dispatch`, con sintaxis correcta.
- **Nada impide que se cree el run.** No hay `if` a nivel de workflow ni de job. Los `if` son de pasos, y aunque fallaran el run igual existiría, en verde y con los pasos omitidos. El environment `produccion` no tiene revisor. Si lo tuviera, el run existiría en `waiting`, no con 0 runs. Con `total_count = 0`, GitHub nunca encoló el evento.
- **Los demás workflows programados muestran lo mismo:**
  - `ritmo-diario`, slot de las 11:23 UTC: el 20 corrió a las 19:10 UTC (unas 8 h tarde). El 21, a las 12:40 UTC, aún no tenía run.
  - `salud`: los slots 12:41, 18:41 y 06:41 corrieron 1 a 5,5 h tarde, y otros se perdieron.
  - Un cron nuevo además suele tardar en dispararse por primera vez.
- **Monitoreo.** El check `correo-alertas` de `salud.yml` da `ok` («workflow reciente») hasta las 09:04 UTC del 22. A partir de ahí falla y abre el issue `salud` si sigue sin runs completados. La alerta llega sola, sin cambiar código.
- **Recomendación para el orquestador.** Este informe no lanza el workflow. Si a las 14:53 UTC sigue sin correr, conviene lanzarlo a mano una vez (`gh api -X POST repos/apivasa/practica_agente/actions/workflows/correo-alertas.yml/dispatches -f ref=main`). Es idempotente y sin `RESEND_API_KEY` solo deja un `::notice::`. Así queda la base de duración del job. Si los crons siguen perdiéndose durante una semana, abrir un ítem para que `salud.yml` relance el workflow por `workflow_dispatch` cuando se pase del umbral. Hoy no se propone, porque hay que medir primero (figura en «Pendiente de completar» de `docs/operacion.md`).

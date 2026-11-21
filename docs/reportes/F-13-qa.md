# F-13 — Informe QA

Veredicto: VERDE

Rama `item/F-13`. Revisé el código del desarrollador en `cf2ac79`. Las pruebas QA se publicaron en `be1f6d3`, encima de los commits de arquitectura (`1c76c23`) y seguridad (`f159e82`).

## Criterio de aceptación

| # | Punto | Estado | Evidencia |
|---|---|---|---|
| 1 | Si la BD no tiene `markAlertsEmailExpired`, `runEmailStep` falla cerrado: código 2, sin leer la BD y sin llamar a Resend. La ruta no atómica (`markAlertsEmailSkipped` + `insertAudit`) para `expired` ya no existe | Cumplido | `tests/scripts/qa-f13.test.js` usa una BD envuelta que registra cada llamada. Sin la RPC: código 2, `summary` nulo, cero métodos llamados, cero llamadas a Resend y un solo `::error::`, que nombra solo `markAlertsEmailExpired`. Si la propiedad existe pero no es una función, también da 2. Con la RPC presente, el vencimiento pasa solo por ella: se marca y audita una sola vez, nunca se llama a `markAlertsEmailSkipped` y la app nunca audita `reason: expired` por su cuenta. Si la RPC falla: código 1, nada marcado ni auditado por otra vía y la clave no aparece en el log. `tests/scripts/f12-fixes.test.js` invierte la prueba «sin la RPC se mantiene la ruta anterior»: ahora no se marca nada, se registra un error y `runEmailStep` devuelve 2 sin tocar nada |
| 2 | `deploy-main`: un `failure` de `deploy.yml` en main seguido de un run más nuevo pendiente dentro de `maxPendingMin` da `warn` y no abre issue. Fuera de la ventana, si el nuevo falla o si es más viejo, sí falla | Cumplido | En `tests/scripts/qa-v04b.test.js`, describe «QA F-13» y dos casos de `check.js`. `queued`, `in_progress` y `waiting` dentro de la ventana dan `warn` con los dos enlaces. Exactamente 90 min da `warn`; 90 min + 1 s da `fail`. Un nuevo que termina en `failure` da `fail`. Un pendiente más viejo, o con el mismo `created_at`, da `fail`. Un pendiente de `pull_request` no cubre. En `main()`, el caso cubierto da código 0 con `failures=` vacío, que es lo que hace que `salud.yml` no abra issue, más `::warning::` y `warn` en el resumen. Fuera de la ventana: código 1 con `failures=deploy-main` |
| 3 | H-F12-02 no se hizo | Aceptado | Seguridad lo clasificó Info en F-12. Solo `service_role` puede ejecutar la RPC, y ese rol ya tiene UPDATE directo sobre `alerts`, así que calcular `p_before` dentro de la función no le quita ninguna capacidad. Cambiarlo cambiaría la firma de una RPC que ya está en producción. Arquitectura llega a la misma conclusión (H-ARQ-F13-04) |
| 4 | CI, Seguridad y CodeQL en verde sin desactivar pruebas | Cumplido (`e2e` seguía en curso al cerrar) | Check-runs de `be1f6d3`: `build (lint, unit, build)`, `db (pgTAP)`, integración, gitleaks, semgrep, CodeQL (JS/TS y actions), npm audit, pentest API, `tests/security` y DAST en `success`. S-05 A/B `skipped`, como en las ramas anteriores. `e2e (Playwright)` seguía `in_progress`. No se borró ni se saltó ninguna prueba |

## Pruebas añadidas o actualizadas

- `tests/scripts/expired-rpc-fake.js` (nuevo, helper): simula `mark_alerts_email_expired` igual que la migración de F-12. Solo marca alertas abiertas, con `attempts < max` y `sent_at < before`. Inserta en `audit_log` una fila `alert_email_skipped` por alerta marcada, sin `await` entre la marca y la auditoría. Valida los mismos parámetros que la RPC.
- `tests/scripts/qa-f13.test.js` (nuevo, 5 casos, criterio 1).
- `tests/scripts/qa-v04b.test.js`: el caso «pendiente + failure» pasa de `fail` a `warn` (criterio 2) y se le añade el subcaso del pendiente más viejo. Se suman 5 casos de `assessDeploy` y 2 de `check.js`.
- `tests/scripts/f12-fixes.test.js`: el caso de la ruta anterior se invierte al fail-closed y se añade un caso de `runEmailStep` con código 2.
- `tests/scripts/qa-f11.test.js`: se añade `markAlertsEmailExpired` a la BD simulada y al caso de la clase, y se suma «solo falta `markAlertsEmailExpired`» al bucle del fail-closed.
- `tests/scripts/qa-c05.test.js`, `email-c05.test.js` y `f11-fixes.test.js`: se añade `markAlertsEmailExpired` (sin vencidas) a la BD simulada.
- `tests/scripts/qa-c06.test.js` y `email-c06.test.js`: la BD simulada usa la RPC simulada, que marca y audita como la real. Las expectativas de los casos de vencimiento no cambiaron.

Suite unitaria local: 3102 casos, 2 skipped y 1 todo (previos). Antes del rebase fallaban 2 casos de `tests/security/automation-c06.test.js`; son de seguridad y quedaron en verde con su commit `f159e82`.

## Resultado CI

Punta `be1f6d3`: todos los jobs en `success`, salvo `e2e (Playwright)`, que seguía en curso al cerrar el informe. Los S-05 están `skipped`, como en las ramas anteriores.

## Cobertura engine/

99.9 % de líneas: 17 archivos al 100 % y `commitment.js` al 99.35 %. F-13 no toca `engine/`. Fuera del motor, `scripts/lib/email.js` está en 99.51 % y `scripts/health/lib.js` en 99.25 %.

## Hallazgos

- **H-QA-F13-01 (Informativo).** En el typedef `EmailDb`, `markAlertsEmailExpired` sigue escrito como opcional (`[markAlertsEmailExpired]`). Es correcto para `sendAlertEmails` con BD simuladas, y el comentario aclara que `runEmailStep` lo exige. No requiere acción.
- **H-QA-F13-02 (Bajo, aceptado; es el mismo que H-ARQ-F13-02).** Un `failure` real de `deploy.yml` queda como aviso mientras haya un run más nuevo pendiente, como mucho 90 min. Si ese run también falla, la alerta llega en la siguiente corrida de `salud.yml`. Para reproducirlo: en `assessDeploy`, un run `failure` de hace 2 h más un run `queued` de hace 5 min da `warn`. Es lo que pide el criterio.

# C-02 — Informe QA
Veredicto: ROJO

Rama `item/C-02`, commit revisado `7524a29`.

## Criterio de aceptación (por punto)
| Punto | Estado | Evidencia |
|---|---|---|
| e2e: el comité aprueba | Cumplido | `e2e/c02-exceptions.spec.js` (aprueba, ve "Vigente", revoca); pgTAP 070 (inserta, firma `approved_by`, tope 90 días) |
| vencida → el candado vuelve | Cumplido en el motor, **no cumplido de punta a punta para revocadas** | Motor: `tests/engine/qa-c02.test.js` (vence hoy = vigente; al día siguiente vuelve `frozen`). El cálculo programado (`scripts/`) no lee `revoked_at`: una excepción revocada sigue suspendiendo el candado (H-C02-QA-01) |
| RLS: el líder no puede crear excepciones | Cumplido | pgTAP 070 (`42501` para el líder y la gestora; el líder no edita ni revoca); e2e por API (401/403) |

## Pruebas añadidas
- `tests/engine/qa-c02.test.js`: 15 casos (tope exacto de 90 días y 91 rechazado, tope que cruza el 29 de febrero, motivo obligatorio, fechas inválidas, vence hoy, vencida al día siguiente en frozen y en restricted, revocada antes de vencer, revocada y vencida a la vez, revocada change_start sin inicio autorizado, revocada junto a una vigente, change_start en frozen → `authorizedStarts` sin levantar el candado, change_start vencido, verde sin inicios). Todos pasan.
- `tests/scripts/qa-c02.test.js`: 2 casos sobre `evaluateUnitMonth` (el cálculo de las Actions). **Los 2 fallan**: son el hallazgo H-C02-QA-01.

`npm run -s test:unit`: 1062 pruebas, 1057 pasan, 2 fallan (las de `tests/scripts/qa-c02.test.js`), más el TODO previo H-C04-QA-01.

## Resultado CI
- CI [44628177242](https://github.com/apivasa/practica_agente/actions/runs/44628177242): success (build, pgTAP, integración, e2e) sobre `7524a29`.
- Seguridad [44628177313](https://github.com/apivasa/practica_agente/actions/runs/44628177313): success (todos los jobs).
- Las pruebas QA nuevas no están en el CI (esta revisión no hizo commit); en CI fallarán los 2 casos de `tests/scripts/qa-c02.test.js`.

## Cobertura engine/
100 % de líneas en todos los archivos menos `commitment.js` (99,26 %); `escalation.js` y `exceptions.js` tienen el 100 % de líneas. Supera la meta del 95 %.

## Hallazgos
1. **H-C02-QA-01 (alta): el cálculo programado no respeta la revocación ni `change_ref`.** `scripts/lib/db.js` solo selecciona `id, unit_id, scope, expires_on` de `exceptions`, y `scripts/lib/build.js` (`evaluateUnitMonth`) solo pasa al motor `{ id, scope, expiresOn }`. Por eso, en la evaluación que se guarda, una excepción revocada sigue suspendiendo el candado hasta su `expires_on`, y `authorizedStarts` sale con `change_ref: null`. El front sí muestra "Revocada", así que la pantalla y la evaluación guardada no coinciden. Esto contradice que las excepciones "suspenden el candado mientras estén vigentes". Para reproducirlo, corre `node --test tests/scripts/qa-c02.test.js`: se espera `frozen` y se obtiene `exception`. Corrección sugerida: seleccionar `change_ref, revoked_at` y pasar `revokedOn` (fecha en America/Guayaquil) y `changeRef` al motor.
2. **H-C02-QA-02 (media): alertas de vencimiento para excepciones revocadas.** `scripts/lib/alerts.js` (`exceptionAlerts`) no filtra `revoked_at`. Avisará "vence hoy" o "venció; vuelven a regir los candados" para una excepción que se revocó días antes. Se reproduce leyendo el código: el filtro solo mira `expires_on`. Falta una prueba que lo cubra después de la corrección.
3. **H-C02-QA-03 (baja): fecha del servidor en el INSERT.** El trigger `private.enforce_exception_rules` compara `new.expires_on < current_date` (que usa la zona de la sesión, UTC en Supabase) y no la variable `today` (America/Guayaquil) que calcula en la misma función. Entre las 19:00 y las 24:00 de Guayaquil, si el comité elige como vencimiento el día de hoy, RLS rechaza la fila, y el motor del front sí la acepta. Para reproducirlo, inserta como comité con `expires_on` igual a la fecha de Guayaquil cuando ya es el día siguiente en UTC. Pasa lo mismo en la política `exceptions_insert` si también usa `current_date`.
4. **Observación (sin severidad):** el e2e no cubre "vencida → el candado vuelve" en pantalla. Está cubierto en el motor y en las alertas, pero no de punta a punta.

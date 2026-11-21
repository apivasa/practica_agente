# F-18 — Informe QA
Veredicto: VERDE

Rama `item/F-18`, commit revisado 7ae3760 (`scripts/health/lib.js`). El tester no escribió este código.

## Criterio de aceptación (docs/plan-maestro.md, fila F-18)
1. **QA-F17-01**: cumplido. Mismo `created_at` y mismo id entero con conclusiones distintas: el no-success va primero (`successLast`) y el resultado es `fail` en todas las permutaciones. Lo probé con `failure`, `timed_out`, `startup_failure` y `action_required`, también con un id menor en success añadido, y en `assessDeploy` y en `assessWorkflow`. La prueba `todo` de `tests/scripts/qa-f17.test.js` ya está activada y pasa.
2. **H-F17-02 / H-ARQ-F17-01**: cumplido.
   - `assessWorkflow` valida con `parseApiTime` cada `created_at` de los completados relevantes. Si una fecha es inválida, futura o tiene un formato que la API no usa, el resultado es `fail` en las 4 reglas probadas.
   - El borde `FUTURE_SKEW_MIN` se acepta, y 1 s más ya da `fail`.
   - `ci-main` con `[success id 1, failure id 2]` empatados da `fail` en ambos órdenes.
   - `seguridad-semanal` no se salta `maxAgeHours` con un success de fecha futura, ni solo ni junto a otro run viejo.
   - `evaluacion-mensual` no acepta un success de fecha futura como cierre del mes.
3. **Sin falsos `fail` con datos normales**: cumplido.
   - Un historial realista da `ok` en las 5 reglas. Ese historial usa fechas ISO `...Z` de la API, ids enteros de 11 dígitos, offsets `-05:00` y fracciones de segundo.
   - Un fallo antiguo seguido de un success reciente da `ok`.
   - Un run con fecha inválida que la regla no tiene en cuenta (otro evento, cancelado o pendiente) no provoca `fail`.

## Pruebas añadidas
- `tests/scripts/qa-f18.test.js`: 15 casos, todos pasan.
- Regresión: health, health-deploy, qa-f1x, f1x-fixes y qa-v04*. Son 478 casos con `node --test`: 478 pasan, 0 fallan, 0 `todo`.

## Resultado CI
Pendiente del push de este informe. Los runs de la rama se ven con `gh api 'repos/apivasa/practica_agente/actions/runs?branch=item/F-18'`.

## Cobertura
- `engine/`: este ítem no lo toca, así que no aplica.
- `scripts/health/lib.js`: 98,3 % de líneas con `--experimental-test-coverage`. Quedan sin cubrir las líneas 82-84 (reintentos HTTP) y 477-482 (`runAll`), que son anteriores a este ítem.

## Hallazgos
- **QA-F18-01 (Informativa, anterior al ítem, fuera del criterio)**: en `checkWorkflows`, los jobs para `requiredStep` se piden del primer success en el orden de la API (`runs.find`), no del `candidate` ordenado de `assessWorkflow`. Con datos normales es el mismo run. Solo cambia con un empate o un orden anómalo, y en ese caso el candidato no-success ya hace `fail`. No bloquea.

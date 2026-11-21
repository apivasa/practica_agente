# F-15 — Informe QA
Veredicto: VERDE

Rama `item/F-15` (SHA revisado `cedc123`). Alcance: `scripts/health/lib.js` `assessDeploy` (H-F14-01).

## Criterio de aceptación (plan-maestro, fila 28g)
| Punto | Estado | Evidencia |
|---|---|---|
| Ordenar los runs con `parseApiTime` (no `Date.parse`) | cumplido | QA «orden por fecha validada con offsets de zona distintos»; dev «el orden usa fechas validadas aunque la entrada venga desordenada» |
| Calcular `stuck` con `parseApiTime` | cumplido | QA «stuck en el umbral: 90 min exactos no; 91 min sí», «run_started_at vacío o null usa created_at» |
| Un `success` con fecha futura no tapa fallos | cumplido | QA «borde exacto +FUTURE_SKEW_MIN / +1 s» (el failure real sigue en el mensaje), «success futuro + failure + pendiente reciente → fail, sin warn de cobertura» |
| Runs con timestamp inválido o futuro tratados como `fail` | cumplido para completados; pendientes descartados (ver evaluación) | QA «solo completados inválidos → fail», «cuenta todos los inválidos», «timed_out inválido falla / neutral se ignora», «completado inválido + cancelado → fail, no warn» |

## Evaluación de la decisión del desarrollador (pendientes inválidos se descartan, no dan fail)
Aceptada. Un pendiente con fecha inválida o futura:
- no puede tapar un fallo: no cubre (`newerPendingRun` lo rechaza) — QA «pendiente con fecha futura no cubre un failure»;
- no puede dar `ok` por sí mismo ni convertir un cancelado en `ok` — QA «pendiente inválido + último cancelado sigue warn»;
- solo deja de detectarse como atascado. El riesgo residual (un run realmente atascado cuyas fechas la API devuelve corruptas) es muy bajo y se resolvería en la siguiente corrida cuando termine. Darle `fail` contradiría `qa-v04b` «sin fechas válidas: no se considera atascado ni lanza», que es una regla vigente de QA.
El propósito del hallazgo (que un success no tape fallos) se cumple sin necesitar fail en pendientes.

## Pruebas añadidas
- `tests/scripts/qa-f15.test.js`: 15 casos (9 completados futuros/inválidos, bordes de margen de reloj, eventos ignorados, entradas null, offsets de zona; 6 de pendientes/stuck, umbral 90/91 min, regresión de cobertura F-13).

## Resultado local
- `node --test tests/scripts/*.test.js`: 684 pruebas, 683 pass, 0 fail (incluye `qa-v04b`, `qa-f13`, `qa-f14`, `f15-fixes`).
- `tests/engine` + `tests/scripts` con cobertura: 1539 pruebas, 0 fail.
- CI de la rama: se valida tras el push (el orquestador lo revisa antes del merge).

## Cobertura
- `engine/`: no tocado por F-15; todos sus archivos ≥ 97 % de líneas (meta ≥ 95 % cumplida).
- `scripts/health/lib.js`: 99,35 % líneas (líneas sin cubrir 82-84, ajenas a `assessDeploy`).

## Hallazgos
- **QA-F15-01 (info)**: un pendiente con `created_at` válido pero `run_started_at` inválido o futuro se descarta entero, en vez de medir el atasco con `created_at`. Reproducir: `assessDeploy(DEPLOY_RULE, { workflow: {state:'active'}, runs: [{status:'in_progress', event:'push', created_at: <hace 200 min>, run_started_at: <+10 h>}, {status:'completed', conclusion:'success', event:'push', created_at: <hace 300 min>}], now })` → `ok`. El test del desarrollador lo fija como comportamiento esperado; aceptable por el mismo razonamiento (lado seguro respecto a falsas alarmas, no tapa fallos). No bloquea.
- **QA-F15-02 (info)**: sin cambio respecto a antes, dos completados con el mismo `created_at` válido quedan en el orden de entrada de la API (sort estable). Fuera del alcance de F-15.

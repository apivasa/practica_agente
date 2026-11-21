# F-20 — Informe QA

Veredicto: **VERDE**

Rama revisada: `item/F-20` (SHA del desarrollador `9ea6aa1`). Objeto: `requiredStepProblem` en `scripts/health/lib.js`.

## Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| (1) Cada job trae `run_id` entero seguro igual a `candidate.id`; si no, fail | Cumplido | `run_id` como texto `"123"`, ausente, `null`, decimal, `NaN`, `Infinity`, booleano, objeto o de otro run: fail con el mensaje de run_id. Un job de otro run mezclado con jobs correctos también da fail. Un `null`, `undefined`, texto, número o array dentro de la lista: fail, sin lanzar. Un `candidate.id` que no es entero seguro (`"123"`, 12.5, 2^53, `null`, ausente): fail con "id verificable". En `checkWorkflows`, si la API simulada devuelve jobs de otro run: fail. |
| (2) Al menos una aparición del paso con `conclusion === 'success'` | Cumplido | Una sola aparición en `failure`, `cancelled`, `neutral`, `action_required`, `timed_out`, `null`, sin la clave, `''` o `'SUCCESS'`: fail. Si el nombre del paso difiere en mayúsculas o en un espacio final: "no aparece". |
| (3) En una matriz, todas las apariciones en success; si no, fail | Cumplido | success más `skipped`, `cancelled`, `null` o `failure`: fail con el conteo (`1 de 3`). Si fallan varias, el mensaje lista todas sus conclusiones. Un paso repetido dentro del mismo job cuenta como aparición. Todas `skipped`: el mensaje sigue siendo "omitido". `skipped` más `failure`: fail sin decir "omitido". |
| El caso normal sigue en `ok` | Cumplido | Da ok con un job, con 3 jobs en success y con un job de la matriz sin el paso más otro con el paso en success. Sin producción da `skip` aunque los jobs no traigan run_id. |

## Pruebas añadidas o ajustadas

- `tests/scripts/qa-f20.test.js` (nuevo): 104 casos (34 por cada una de las 3 reglas con `requiredStep` y 2 de integración con `checkWorkflows`).
- Fixtures ajustadas a la forma real de `GET /actions/runs/{id}/jobs` (cada job con `id`, `run_id`, `status`, `conclusion` y `steps`). Las 12 pruebas que estaban en rojo **siguen probando el mismo motivo**: no se cambió ninguna aserción.
  - `tests/scripts/f19-fixes.test.js`: `jobsWith` usa por defecto el `run_id` del candidato (1); el job literal de "paso ausente" tiene `run_id: 1`.
  - `tests/scripts/health.test.js`: `evalJobs` y `mailJobs` aceptan `runId` (por defecto 1). "runs cancelados no cuentan" usa `run_id` 2, porque el candidato es el run 2. En `listJobs` se devuelve el `run_id` que se pidió.
  - `tests/scripts/qa-c06.test.js`: la prueba de "Enviar correos omitido" usa `run_id: 7`, el del candidato, y ahora también comprueba `/omitido/`. Antes solo miraba `status`, así que era más débil.

## Resultado local

`node --test tests/scripts/*.test.js`: 996 pass, 0 fail, 1 todo. El todo es H-C04-QA-01, que ya existía y no tiene relación con este ítem. Lint y e2e no se pueden correr en la sesión porque no hay `npm install`: se validan en el CI de la rama.

## Cobertura

- `engine/`: no aplica, F-20 no lo toca.
- `scripts/health/lib.js`: 99,50 % de líneas y 95,78 % de ramas con toda la suite. `requiredStepProblem` (l. 228-248) tiene todas sus líneas cubiertas.

## Hallazgos

Ninguno bloqueante.

- **QA-F20-01 (info, solo en las pruebas).** Mientras escribía las pruebas encontré un falso positivo en mi propia fixture: pasar `undefined` a un parámetro que tiene valor por defecto lo convierte en `'success'`. Lo corregí borrando la clave. No hay defecto en la app: un paso sin `conclusion` da fail.
- **QA-F20-02 (info).** Si `candidate.id` no es entero seguro, `checkWorkflows` no pide jobs y el detalle dice "sin jobs del último run" en lugar de "id verificable". Las dos salidas son fail, así que es correcto. Solo cambia el texto del diagnóstico. Para reproducir: llamar a `checkWorkflows` con `listRuns` devolviendo `id: '123'`.

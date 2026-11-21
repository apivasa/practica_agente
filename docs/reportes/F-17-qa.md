# F-17 — Informe QA

Veredicto: VERDE

Revisión independiente de la rama `item/F-17` (commit 14a944f). El tester no escribió el código.

## Criterio de aceptación (por punto)

1. **H-F16-01 / QA-F16-02, empate de `created_at` con algún `id` que no es entero seguro: nunca `ok`, sin importar el orden de entrada, y comparador transitivo.** Cumplido.
   - Probé ids decimales, `2^53` y mayores, `NaN`, `±Infinity`, `undefined`, `null`, `''`, texto, BigInt, objeto, array y booleano. Cada uno se cruzó con 8 ids enteros seguros, en los dos sentidos (failure sin id contra success con id, y al revés). Todos los casos dan `fail` en ambos órdenes.
   - `timed_out`, `startup_failure` y `action_required` también se ordenan antes que un success empatado. Un cancelado sin id empatado con un success da `warn`, no `ok`.
   - Prueba de propiedad: 3000 páginas aleatorias (PRNG con semilla fija) y 6 permutaciones de cada una. El estado no cambia con el orden de entrada. Un empate ambiguo que tiene algún no-success entre los posibles más recientes nunca da `ok`. Esto confirma de forma empírica que el orden es total y consistente: la clave es lexicográfica por rango, luego id o conclusión, luego `String(id)`.
   - No hay regresión de F-16: con ids enteros seguros únicos, el id mayor sigue decidiendo. Cuando todos los runs empatados son success, el resultado sigue siendo `ok`, y es correcto porque no hay ambigüedad de color.
2. **H-ARQ-F16-03, `assessWorkflow` lee `workflow.created_at` con `parseApiTime` (fail-closed).** Cumplido.
   - El borde exacto de `FUTURE_SKEW_MIN` se acepta; un segundo después da `fail`.
   - Dan `fail` los formatos que `Date.parse` acepta pero la API no devuelve: solo fecha, separador con espacio, sin segundos, RFC 2822, espacio o salto de línea alrededor, `Date`, número, objeto y array.
   - Los offsets `±hh:mm` válidos se siguen aceptando.
   - Regla mensual: un `created_at` futuro dentro del mes no evita el `fail`, y uno válido del mes da `ok`.
   - `ci-main` sin `created_at` y sin runs se queda en `skip`.
3. **H-ARQ-F16-01, JSDoc y comentarios de `assessDeploy` corregidos.** Cumplido. Lo revisé leyendo el código: los comentarios describen `sinceOf`, la conservación del pendiente cuando `run_started_at` no se puede leer, y `compareSameTime`, y coinciden con lo que hace el código.

## Pruebas añadidas

- `tests/scripts/qa-f17.test.js`: 15 casos, 14 en verde y 1 marcado `todo`. El `todo` documenta el hallazgo QA-F17-01: se ejecuta y queda reportado, pero no rompe CI.
- Revisé `tests/scripts/f17-fixes.test.js` (7 casos, del desarrollador). Es correcto y traza al criterio. Mis casos añaden lo que faltaba: los tipos de id raros, otras conclusiones no-success, el cancelado, la propiedad aleatoria y los bordes de fecha de `assessWorkflow`.

## Resultado local

- `node --test` de `qa-f17` y `f17-fixes`: 21 casos en verde, más el `todo`.
- Regresión de salud (health, health-deploy, lib, f11–f17-fixes, qa-f10–f16, qa-v04, qa-v04b y run): 479 de 479 en verde.
- No consulté CI de la rama en esta revisión: el push de este informe dispara el run.

## Cobertura engine/

No aplica: F-17 no toca `engine/` (solo `scripts/health/lib.js`).

## Hallazgos

- **QA-F17-01 (Baja, fuera del criterio literal).** Dos runs con el mismo `created_at`, el mismo id entero seguro y conclusiones distintas: `compareSameTime` devuelve 0 y el resultado depende del orden de entrada.
  - Reproducción: `assessDeploy(DEPLOY_RULE, { workflow, now, runs: [run(42,'success'), run(42,'startup_failure')] })` da `ok`; con el orden invertido da `fail`.
  - En la API los ids son únicos, pero una página podría traer dos veces el mismo run, por ejemplo si se re-ejecuta entre lecturas de páginas. Para mantener el criterio fail-closed bastaría desempatar por conclusión, poniendo primero el no-success, cuando los ids son iguales.
  - Queda como `todo` en `qa-f17.test.js`.

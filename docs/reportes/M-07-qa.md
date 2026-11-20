# M-07 — Informe QA
Veredicto: VERDE

Rama revisada: `item/M-07`. Código en `741c8e9`; pruebas QA en `ecb4f8a`, más la restauración `04c90a4` (ver nota del proceso).
Referencias: criterio de M-07 en `docs/plan-maestro.md`; en `docs/diseno.md`, "Caso: vulnerabilidades" ("Meta parcial mensual (aprox. un tercio por mes)") y "Modelo de datos" ("Metas | Meta parcial mensual (ej. un tercio del paquete)").

## Criterio de aceptación
- **e2e gestora: cumplido.** `e2e/m07-targets.spec.js` corre en CI y pasa: crea el indicador, carga el compromiso y la medición, ve "Sin evaluar", usa "Proponer un tercio" (10 de 30), guarda (Verde), edita a 20 (Rojo) y rechaza una meta negativa.
- **Otros roles no escriben: cumplido.**
  - Front: custodio, comité y líder que piden `#/gestora/metas` vuelven a su inicio (e2e y `tests/front/m07-targets-form.test.js`).
  - BD: el pgTAP nuevo `080_qa_m07_targets.test.sql` reproduce el flujo de `saveTarget`. La gestora inserta y edita; el custodio dueño del KPI, el comité, el líder de la unidad y anon reciben 42501 al insertar. Sus `update` no cambian nada. La alta y la edición de la gestora quedan en `audit_log`.
- **Un indicador pasa de "Sin evaluar" a color al cargar la meta: cumplido** (e2e y unitarias).

## "Proponer un tercio" frente a docs/diseno.md
Conforme. La meta es acumulada del trimestre: mes 1 = ceil(P/3), mes 2 = ceil(2P/3), mes 3 = P, con P = `package_total` del compromiso trimestral (`YYYY-Qn`).
- Es la misma serie que `packageStatus.monthlyTargets` (una sola regla en `engine/`, CLAUDE.md 6).
- Para todo P entero de 0 a 600 la serie es monótona, nunca supera P y cada mes se aparta menos de 1 del tercio exacto ("aprox. un tercio").
- El ingreso de P0/P1 a mitad de trimestre que sube la meta solo aplica a VULN, que tiene categorías y queda fuera de esta pantalla (`usesMonthlyTargets`). No hay desviación del diseño.

## Cambio en `tests/front/routes-registry.test.js`
La línea 27 fijaba las rutas de la gestora sin `'/gestora/metas'`. Ese fallo de CI es la consecuencia esperada del ítem, porque el plan pide la ruta nueva. Se actualizó la lista y se añadió `roleForView('kpi-targets') === 'kpi_manager'`. No hubo defecto de código.

## Pruebas añadidas
- `tests/engine/qa-m07.test.js`: 12 casos. 11 pasan y 1 es `todo` (H-M07-QA-01).
  - Propuesta: 100 → 34/67/100; los cuatro trimestres; barrido de 0 a 600; solo vale el compromiso del mismo trimestre, unidad e indicador; paquete 0.
  - Color: transición de "Sin evaluar" a color; umbrales exactos 90/80/79; meta acumulada del mes 2; exclusión de otro trimestre, de fechas posteriores al cierre, de otra unidad, de otro indicador y de filas no resueltas; mínimo de muestra no alcanzado.
  - Paridad entre la vista previa de la pantalla y `evaluateIndicatorMonth` de `scripts/`.
- `tests/front/routes-registry.test.js`: 1 caso ajustado.
- `supabase/tests/080_qa_m07_targets.test.sql`: 17 aserciones pgTAP.

## Resultado CI
- CI run 44686846449/44686846462 sobre `04c90a4`: **success**. build: 1511 pass, 0 fail, 2 todo. pgTAP: `080_qa_m07_targets` ok, Result: PASS. e2e: 82 passed, incluidos los 4 de `m07-targets.spec.js`.
- Seguridad sobre `04c90a4`: success.

## Cobertura engine/
99,9 % de líneas. Todos los archivos están al 100 % salvo `commitment.js` (99,26 %); `rows.js` y `vulnerabilities.js` al 100 %.

## Hallazgos
- **H-M07-QA-01 (baja, no bloquea).** `cumulativeThirds(0.5)` da `[1, 1, 0.5]`: con un paquete decimal, el mes 1 propone más que el paquete entero.
  - Alcance: el formulario de compromisos solo admite enteros, así que solo se llega por la API (la BD exige `package_total >= 0`, no que sea entero).
  - Cómo reproducir: `proposeThirdTarget` con `package_total: 0.5`.
  - Arreglo sugerido: `Math.min(ceilTol(...), total)` en `cumulativeThirds`, o un CHECK de entero en `package_total` para meta acumulada.
  - Queda como `todo` en `tests/engine/qa-m07.test.js`.
- **Observación (no es de M-07).** Con meta cargada y ninguna medición resuelta en el trimestre, el color queda "Sin evaluar" ("Sin datos en la ventana de cálculo"), no rojo. Es la regla de ventana vacía del motor desde M-01, y el tablero de completitud lo muestra como dato pendiente. Lo dejo anotado por si el comité espera rojo cuando una unidad no resuelve nada.
- **Nota para integrar.** M-07 y M-08 tocan los dos `engine/rows.js` (M-07 mueve `evaluateIndicatorMonth` ahí; M-08 cambia `buildPackageInput`). El que se fusione segundo debe rebasar y volver a pasar CI.

## Nota del proceso
Mi primer commit QA (`ecb4f8a`) deshizo sin querer parte de `cd06df0` (seguridad). Otro worktree tenía la misma rama abierta y mi índice estaba desactualizado. En `04c90a4` restauré esos archivos tal como los dejó seguridad. `git diff cfe774f 04c90a4` contiene solo los 3 archivos QA.

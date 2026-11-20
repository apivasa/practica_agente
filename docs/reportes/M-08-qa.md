# M-08 — Informe QA
Veredicto: VERDE

Rama revisada: `item/M-08`. Código en `0058e63`, arquitectura en `1a98ef2` y seguridad en `118c119`. Las pruebas QA van en `30abec5`, más la restauración `e3d37ff` (ver nota del proceso).
Referencias: criterio de M-08 en `docs/plan-maestro.md` y la propuesta de M-08 en `docs/reportes/M-06-arquitectura.md` (H-M06-01, H-M06-QA-02, A4 y A7, con su criterio).

## Criterio de aceptación
- **pgTAP: cumplido.** `supabase/tests/080_measurements_category_guard.test.sql` (del desarrollador, 25 aserciones) verifica:
  - El custodio de VULN no inserta ni edita por REST:
    - valor 0,5 o 1,5;
    - categoría nula, en minúsculas o desconocida;
    - valor nulo.
  - El backend tampoco inserta esas filas.
  - Los roles sin permiso (custodio de otro KPI, comité y líder) siguen recibiendo 42501, también con filas malformadas: RLS se evalúa antes que el trigger.
  - La combinación `cumulative_target` + `lower_is_better` se rechaza (23514) al crear y al editar.
- **node:test, A4: cumplido.** `validateIndicator` rechaza `cumulative_target` + `lower_is_better` aunque los umbrales sean coherentes con ese sentido (prueba QA). El formulario muestra el error (prueba del desarrollador).
- **node:test, A7: cumplido.** `runDaily` con una fila malformada termina sin errores y el motivo cuenta el descarte. `buildPackageInput` es el único punto de descarte, y la evaluación mensual, `packagePace` (front) y el diario dan el mismo conteo (prueba QA con 3 filas malas: 3 en los cuatro caminos).
- **Verificar antes de producción que no haya filas que violen la regla: cumplido como procedimiento.** Las dos consultas de solo lectura están al final de la migración y en el runbook. Ejecutarlas sigue siendo parte de la compuerta del primer despliegue, que decide el usuario.

## ¿Es correcto reescribir el caso de `tests/scripts/run.test.js`?
**Sí.** El caso decía "datos inválidos de una unidad se reportan como error" y usaba una resuelta P0P1 con valor 1,5. Ahora ese dato es una fila malformada, y A7 pide explícitamente que el diario la descarte, no que falle: «runDaily con una fila malformada termina sin errores y el motivo cuenta el descarte». Mantener la aserción vieja contradiría el criterio.

Lo que el caso viejo protegía de forma indirecta era que un error real de una unidad siga a la vista y no detenga a las demás. Al reescribirlo, esa protección quedó sin prueba en `runDaily`. La repuse en `tests/scripts/qa-m08.test.js` con un paquete negativo (`P0P1: -5`): se informa exactamente un error, `Unidad Beta/VULN: ...`, y Alfa y Gamma se procesan.

## Pruebas añadidas
`tests/scripts/qa-m08.test.js`: 7 casos, todos pasan.
- Con 6 formas de fila mala, la foto del paquete es idéntica a la que se obtiene sin la fila: no suma ni sube la meta (H-M06-01), y `details.discarded` queda en 1.
- Una P0/P1 detectada malformada no dispara `critical_intake` (H-M06-QA-02).
- Una fila mala fuera del trimestre o posterior a `asOf` no se cuenta.
- El diario es idempotente: correrlo dos veces el mismo día no duplica la foto.
- Un error real sigue informándose (caso de la sección anterior).
- Los cuatro caminos dan el mismo conteo de descartes.
- A4 en el motor.

## Resultado CI
- CI run 44686868638 sobre `e3d37ff`: **success**. build: 1497 pass, 0 fail, 1 todo previo. pgTAP: `080_measurements_category_guard` ok, Result: PASS. Integración y e2e: ok.
- Seguridad run 44686868622: el primer intento falló en pentest-api por `failed to bind host port 0.0.0.0:54322/tcp: address already in use`. Es el intermitente conocido que resuelve F-07, no un defecto de M-08. Relancé solo el job fallido y pasó: **success**.

## Cobertura engine/
99,9 % de líneas. `rows.js` y `vulnerabilities.js` al 100 %, `indicator.js` al 100 %.

## Hallazgos
- **Observación 1 (baja, no bloquea).** El trigger acepta valores enteros que el motor descarta por no ser enteros seguros (por ejemplo, `1e20`). Una fila así entra en la BD y luego se cuenta como descartada. No hay riesgo de un verde falso, porque se descarta.
  - Arreglo sugerido: tope `value <= 9007199254740991` en el trigger.
- **Observación 2 (baja, no bloquea).** El trigger solo valida al escribir la medición. Si la gestora agrega `thresholds_by_category` a un indicador que ya tiene mediciones sin categoría, esas filas no se revalidan. El motor las descarta y avisa en el motivo.
- **Nota para integrar.** M-07 y M-08 cambian los dos `engine/rows.js`, y los dos agregan un pgTAP con prefijo `080_`, con nombres distintos y sin choque. El que se fusione segundo debe rebasar y volver a pasar CI.

## Nota del proceso
Mi primer commit QA (`30abec5`) deshizo sin querer `118c119` (seguridad: pentest del trigger y `matrix.js`). Otro worktree tenía la misma rama abierta y mi índice estaba desactualizado. En `e3d37ff` restauré esos archivos tal como los dejó seguridad. `git diff 118c119 e3d37ff` contiene solo `tests/scripts/qa-m08.test.js`.

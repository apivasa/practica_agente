# M-14 — Informe QA

Veredicto: **VERDE**

Ítem: M-14 (H-ARQ-M13-01). Migración `supabase/migrations/20261128120000_safe_cap_js_rounding_m14.sql`: cambia el límite de los 9 CHECK `_safe` a `abs(v) < 9007199254740991.5`. Así la BD rechaza los valores que JSON.parse redondea a 2^53.

## Criterio de aceptación

| Punto | Estado | Evidencia |
|---|---|---|
| pgTAP: .4 pasa y .5 se rechaza en cada columna y en cada clave JSONB | cumplido | 114 (desarrollador). 115 (QA) añade el borde exacto (±1e-10 alrededor de 2^53 - 0,5), la notación exponencial en columnas y en JSONB, la vía authenticated y RLS por rol |
| Mismo nombre de CHECK y mismo ALTER (atómico) | cumplido | 115: hay un CHECK por nombre y ningún CHECK de `public` conserva `9007199254740992`. Si el DROP + ADD falla porque queda una fila en 2^53 - 0,5, el CHECK anterior sigue intacto |
| Verificación previa | cumplido | 115: las cuatro consultas comentadas de la migración devuelven 0 filas sobre la semilla. Encuentran la fila en 2^53 - 0,5 y no la de 2^53 - 0,6 |
| La migración aplica sobre la semilla | cumplido | 115: comprueba que la semilla está cargada y vuelve a ejecutar los ALTER de la migración sobre ella sin errores |
| De extremo a extremo: un valor .4 leído por el motor no hace fallar normalizeIndicator ni la evaluación | cumplido | `tests/scripts/qa-m14.test.js`: filas como las devuelve PostgREST con ±(2^53 - 0,6) en umbrales, categorías, override, meta y medición. `runMonthly` termina sin errores |

## Pruebas añadidas o modificadas

- `supabase/tests/115_qa_m14.test.sql` (nuevo, 30 casos): catálogo, la semilla con la migración vuelta a aplicar, la verificación previa (0 filas y detección), el borde exacto con ±1e-10, la notación exponencial (columnas, `thresholds_by_category`, `package_by_category`, `targets`), el trigger de M-09 (2^53 - 0,6 en una categoría se rechaza por no ser entero; 2^53 - 1 entra), RLS (líder, comité y anónimo no escriben aunque el valor esté dentro del límite; la gestora sí) y la atomicidad del DROP + ADD.
- `tests/scripts/qa-m14.test.js` (nuevo, 7 casos):
  - Una réplica decimal exacta, con BigInt, del CHECK nuevo, comparada con `isSafeMagnitude(JSON.parse(texto))` en una malla de 104 literales alrededor de 2^53 (los dos signos).
  - La misma malla a través de `Number` (front).
  - Una regresión que muestra el hueco del CHECK anterior.
  - `runMonthly` de extremo a extremo con .4 (sin errores) y con .5 (falla; por eso la BD debe rechazarlo).
  - `normalizeIndicator` y `evaluateColor` directos.
- `supabase/tests/111_qa_m11.test.sql` (plan de 41 a 44):
  - #11 pasa a ±.4, y se añaden dos `throws_ok` con .5 (verde y amarillo).
  - #32 usa `package_total` .4, y se añade un `throws_ok` con .5.
  - #39 deja de fallar en cascada.
  - Se actualiza el comentario de trazas.
- `supabase/tests/113_qa_m12.test.sql` (plan de 51 a 54):
  - #12 usa .4, y se añade un INSERT con .5 que se rechaza.
  - #13 usa ±.4, y se añade un `throws_ok` con -.5.
  - #23 usa .4, y se añade un `throws_ok` con .5.
  - Se actualizan los comentarios de las líneas 7 y 111.

## Resultado CI

Rama `item/M-14`, commit `5351818`:
- CI `success`: https://github.com/apivasa/practica_agente/actions/runs/44733694040. Los trabajos db (pgTAP), build (lint, unit, build), integración y e2e están en verde. Los archivos 111, 112, 113, 114 y 115 dan `ok`.
- Seguridad `success`: https://github.com/apivasa/practica_agente/actions/runs/44733693965

Localmente: `tests/scripts/qa-m14.test.js` pasa 7 de 7. La suite unitaria completa pasa 1700 de 1704. El único fallo real era `tests/security/engine-m13.test.js` («sin drop posterior»), que corrige seguridad en paralelo y que ya está en verde en el CI de 5351818. Los demás son TODO ya conocidos.

## Cobertura engine/

99,96 % de líneas (97,87 % de ramas). M-14 no toca `engine/`.

## Hallazgos

- **H-QA-M14-01 (informativo, resuelto en el ciclo):** la primera versión de 115 usaba `thresholds_by_category = null` en una fixture, y la columna es NOT NULL. El fallo era de la prueba, no de la app, y ya está corregido en 4a26d54. El archivo 051 de seguridad tuvo el mismo fallo y lo corrigió su autor.
- **H-QA-M14-02 (baja, informativo, sin bloqueo):** `SAFE_ABS_LIMIT_TEXT` del motor sigue diciendo «menor que 2^53 (9007199254740992)». Es coherente con lo que ve el usuario: en el front, cualquier texto de 2^53 - 0,5 o más se convierte en 2^53 y se rechaza con ese mensaje. Pero el límite literal de la BD ahora es 9007199254740991.5. Si se documenta el límite en la interfaz, conviene aclarar que 2^53 es el límite tras el redondeo.
- Sin hallazgos que bloqueen.

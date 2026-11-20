# M-06 — Informe de arquitectura y salud
Veredicto: VERDE (intento 2, revisado en `0204327`)
Alineado al diseño: sí. Se confirmaron los puntos 1 a 7 del ADR 0016. A1 (front y Actions con compromisos distintos) está corregido.
Requiere decisión del usuario: no. Las interpretaciones por defecto van a **Q-07**, que no bloquea. Ningún punto cambia una decisión confirmada, así que no aplica la regla de parada 2.
ADR creados o actualizados: `docs/adr/0016-color-mensual-por-criticidad.md` (Aceptado, revisable con Q-07). En el intento 2 se le agregó el punto 6, sobre el descarte por fila. `docs/operacion.md` tiene una entrada nueva en el runbook: el diario falla por una medición de VULN malformada.
Salud: en `0204327`, `node --test 'tests/**/*.test.js'` corre 1287 pruebas: pasan 1284, fallan 0, se omiten 2 y queda 1 en todo. En GitHub, CI y Seguridad pasan en `a39af51`. En `0204327` los dos runs siguen en curso. Ese commit solo toca el informe QA. `main` está en verde. No hay runs de `evaluacion-mensual`, `ritmo-diario` ni `salud` porque no hay producción y `EVALUATION_ENABLED` sigue apagado.

Nota: el commit `453bed1` (informe de seguridad) borró por error este informe y el ADR 0016, que venían de `228e63a`. Se restauraron en este commit.

## Intento 1 (`228e63a`): ROJO
Se confirmaron los seis puntos del desarrollador (ver la tabla). Bloqueó A1: el ritmo del líder tomaba el compromiso mensual (`pickCommitment`) y `ritmo-diario` el trimestral. Además, 10 pruebas del tester seguían fijando el comportamiento anterior (A2).

| # | Punto | Resultado | Tipo |
|---|---|---|---|
| 1 | Resuelto del trimestre ×100 / meta acumulada (1/3, 2/3 y 3/3 del efectivo, redondeo hacia arriba en los meses 1 y 2); meta 0 → 100 %; recorte de P0/P1 a efectivo + mes 3 y de P2/P3 a efectivo | Confirmado (diseño y ADR 0006, puntos 2 y 4) | Diseño |
| 2 | Umbrales por categoría; peor color; `value` de la categoría con peor color | Confirmado (mismo criterio que el color de la unidad) | Por defecto (Q-07 a, b) |
| 3 | Paquete del compromiso `YYYY-Qn`; los overrides no aplican a las categorías | Confirmado (no existe un override por categoría) | Por defecto (Q-07 c) |
| 4 | Una categoría no evaluable impide el verde y conserva el amarillo o rojo conocido | Confirmado | Por defecto (Q-07 d) |
| 5 | Una meta acumulada sin categorías sigue con `targets` | Confirmado | Diseño |
| 6 | Una sola implementación en `engine/` | Confirmado tras A1 | CLAUDE.md §6 |

## Intento 2 (`3541637`, `a39af51`, `0204327`): VERDE
- **A1, corregido.** `leaderIndicatorRows` calcula `quarterCommitment` una vez y lo usa para `categoryGoal` y `packagePace`. `runDaily` usa `quarterCommitment` en lugar del `find` repetido. Así, la mensual, el diario y el front leen el mismo paquete. Lo cubre `tests/engine/m06-fixes.test.js`: ritmo y meta iguales con o sin compromiso mensual, y la Action diaria usa el mismo compromiso.
- **A2, resuelto por el tester.** Las pruebas anteriores se adaptaron al color por criticidad y la suite queda sin fallos.
- **H-M06-01 (descarte por fila), conforme.** `splitMalformed` (función privada de `engine/rows.js`) descarta las resueltas con categoría inválida o valor no entero ≥ 0, y las detectadas P0/P1 con valor no entero ≥ 0, y las cuenta en el motivo. Así, una carga errónea por API no deja el mes "sin evaluar", lo que reiniciaría la racha (ADR 0003). Es puro y está en `engine/`. Quedó en el punto 6 del ADR 0016.
- **H-M06-02 (`num` estricto y clave de paquete no numérica), conforme.** El cambio de `num` alcanza a todo lo que lo usa (`indicatorConfig`, `buildPackageInput`, `build.js`). Ahora rechaza arreglos, booleanos y texto en blanco, que antes se convertían a 0. Es más estricto y no cambia ningún valor válido. La suite completa pasa.
- **H-M06-03 (guarda de `DB_URL` local en `integration.sh`), conforme.** Refuerza que la integración destructiva corra solo contra la BD local.

## Hallazgos abiertos (no bloquean)
- **A7, coherencia del descarte.** El descarte por fila solo se aplica en `evaluateCategoryMonth`. `ritmo-diario` y `packagePace` siguen llamando a `buildPackageInput` sin descarte. Con una fila malformada, `packageStatus` lanza y el diario termina con exit 1 para esa unidad: no hay alertas de ritmo ni de ingreso de P0/P1, y salud abre un issue. El front muestra "No se pudo calcular el ritmo". Falla de forma visible y no afecta al candado, así que se acepta por ahora; el runbook ya lo cubre. La corrección es mover `splitMalformed` a `buildPackageInput` y devolver `discarded`, de modo que las tres rutas compartan el filtro. Va en M-08.
- **H-M06-QA-02, riesgo aceptado.** Una P0/P1 detectada malformada se descarta y no sube la meta. Lo cierra la validación en BD de M-08.
- **A3.** `VULN_CATEGORIES` (`P0P1`, `P2P3`) es coherente con `package_by_category`. Generalizar las categorías solo hace falta si aparece otro KPI de meta acumulada con categorías.
- **A4.** La combinación `cumulative_target` + `lower_is_better` sigue aceptada y se pasa a M-08.

## Propuesta de ítem para el plan (orquestador)
**M-08** (P1, talla S, depende de M-06). Validación de mediciones e indicadores de meta acumulada en la BD y en el motor.
- Descripción:
  - Migración no destructiva: un trigger `before insert or update` en `measurements`. Para un indicador `cumulative_target` con `thresholds_by_category` no vacío, exige `category in ('P0P1','P2P3')` cuando `kind` es `resolved` o `detected`, y `value = trunc(value) and value >= 0`. El mensaje de error va en español. Es preferible un trigger a un CHECK, porque depende de la fila de `indicators`.
  - En `engine/indicator.js` (`validateIndicator`) y en un CHECK de `indicators`: rechazar `measurement_type = 'cumulative_target'` con `direction = 'lower_is_better'` (A4). El formulario muestra el error del motor.
  - Mover el descarte por fila (`splitMalformed`) a `buildPackageInput` y devolver `discarded`, para que `ritmo-diario`, `packagePace` y la evaluación mensual compartan el filtro (A7).
- Criterio de aceptación:
  - pgTAP: el custodio de VULN no puede insertar por REST `value` 0,5 ni `category` nula, en minúsculas o desconocida; los roles sin permiso siguen sin poder escribir.
  - pgTAP y `node:test`: un indicador `cumulative_target` + `lower_is_better` se rechaza en la BD y en el motor.
  - `node:test`: `runDaily` con una fila malformada termina sin errores y el motivo cuenta el descarte.
  - Antes de aplicar en producción, verificar que no haya filas existentes que violen la regla. Es una migración no destructiva, pero el primer despliegue sigue siendo compuerta del usuario.

**Para el orquestador:** registrar **Q-07** (no bloqueante, sin notificación push) en `docs/pendientes-usuario.md`, con este texto: "Color mensual por criticidad (ADR 0016). Por defecto: (a) el indicador toma el peor color de P0/P1 y P2/P3; (b) el valor mostrado es el de la peor categoría; (c) los umbrales negociados por unidad (overrides) no se aplican a las categorías, que usan 96/90 y 85/75 del indicador; (d) si falta el paquete de una categoría, el indicador no puede salir verde. Responde "ok" o indica cuál cambiar."

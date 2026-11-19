# M-01 — Informe QA

Veredicto: **ROJO**

## Criterio de aceptación (por punto)

| Punto | Estado | Evidencia |
|---|---|---|
| ≥ 95 % de cobertura de líneas en `engine/` | Cumplido | 100 % líneas, ramas y funciones (también solo con las pruebas del desarrollador) |
| Tres tipos: meta acumulada, promedio en ventana, cobertura | Cumplido | `qa-m01` bloque "Diseño 1" |
| Sentido (más/menos es mejor) | Cumplido | bloque "Diseño 2", incluye sentido inverso |
| Ventana | Cumplido | límites inclusivos, cruce de año, bisiesto, datos futuros excluidos |
| Umbrales verde/amarillo/rojo, opcional por categoría | Cumplido | P0/P1 96 % y P2/P3 85 % con empate exacto, categoría sin umbral propio usa los generales |
| Mínimo de muestra → "sin evaluar" | Cumplido | MTTR con 2 de 3 incidentes → `not_evaluated`; con 3 → se evalúa; cobertura cuenta apps distintas |
| Ventana vacía | Cumplido | sin datos o solo datos fuera de ventana → `not_evaluated` en los tres tipos |
| **Empates en umbral** | **No cumplido** | empate *literal* sí da el color mejor; empate *calculado* (valor medido matemáticamente igual al umbral) no, por error de coma flotante (H-1) |
| Indicador nuevo no previsto solo por datos | Cumplido | "tasa de changes fallidos" (semanal, 14 días, automático) y "apps con SBOM" por categoría |

## Pruebas añadidas
- `tests/engine/qa-m01.test.js`: 42 casos (39 pasan, 3 fallan; los 3 fallos son H-1).
- Total de la suite `tests/engine/*.test.js`: 81 casos, 78 pasan, 3 fallan.

## Resultado
- Local: `node --test --experimental-test-coverage --test-coverage-exclude='tests/**' 'tests/engine/*.test.js'` → 3 fallos.
- CI: la rama `item/M-01` no tiene runs todavía (sin push al momento de la revisión).

## Cobertura engine/
100 % líneas (`color.js`, `index.js`, `indicator.js`, `measure.js`).

## Hallazgos

### H-1 (media, bloqueante): empates calculados caen al color peor por coma flotante
El diseño y el README dicen "empate exacto en un umbral = color mejor", y el criterio pide cubrir empates. `measure` devuelve valores con error binario, y `evaluateColor` compara con `>=` / `<=` estrictos, así que un valor que es exactamente el umbral sale con un color peor:

| Caso | Valor esperado | Valor del motor | Color esperado | Color obtenido |
|---|---|---|---|---|
| Cobertura 57 de 100 apps, verde 57 | 57 | 56.99999999999999 | green | yellow |
| Disponibilidad (99,9 + 99,8 + 100)/3, verde 99,9 | 99,9 | 99.89999999999999 | green | yellow |
| MTTR (2,2 + 2,3 + 2,4)/3 h, verde 2,3 (menos es mejor) | 2,3 | 2.3000000000000003 | green | yellow |

Cómo reproducirlo: `node --test tests/engine/qa-m01.test.js` (bloque "Diseño 4", los tres casos "empate calculado").
Arreglo sugerido (lo decide el desarrollador): redondear el valor medido (p. ej. a 6–9 decimales) o comparar con tolerancia (`value >= t.green - EPS`) en `evaluateColor`. En la cobertura también sirve calcular `ok * 100 / n` en lugar de `(ok / n) * 100`.
Con disponibilidad, que se mide con umbrales como 99,9, esto cambia colores y por tanto candados, así que no es solo cosmético.

### H-2 (baja, no bloqueante): `cumulative_target` sin `target` da 100 % (verde)
Si falta el paquete o compromiso (`target` ausente o `null`), el motor responde 100 y el indicador sale verde. Está documentado en el README y es razonable con `target: 0` (no hay nada que resolver). Pero cuando *falta* el dato, se esconde un compromiso que nunca se cargó. Sugerencia: con `target` ausente, devolver `not_evaluated` o lanzar un error, y dejar el 100 % solo para `target === 0`. Conviene resolverlo antes de M-05.

### H-3 (baja, informativa): meta acumulada sin mediciones → "sin evaluar", no rojo
Si una unidad tiene paquete (`target > 0`) y no hay ninguna medición en la ventana, el resultado es `not_evaluated` en vez de 0 % (rojo). Es coherente con "ventana vacía → sin evaluar" y con el tablero de completitud de la gestora (el dato falta). Se deja anotado para que M-05 y C-01 no traten "sin evaluar" como verde.

## Re-verificación del orquestador (intento 2)
Fecha: 2026-11-19. El desarrollador corrigió H-1 (tolerancia en empates, coverage como ok*100/n), H-2 (meta ausente → not_evaluated), H-M01-01 (sampleSize inválido → not_evaluated) y documentó el comando de pruebas.
Resultado: `node --test --experimental-test-coverage --test-coverage-exclude='tests/**' 'tests/**/*.test.js'` → 115/115 pruebas, incluida `qa-m01.test.js` sin modificar; cobertura engine/ 100 % líneas, ramas y funciones.
Desviaciones aceptadas: valores no finitos se neutralizan en `measure` (devuelve null + REASON_OUT_OF_RANGE) en vez de en `evaluateColor`, y la categoría `__proto__` se descarta en `normalizeIndicator` con objetos sin prototipo, porque así lo exigen las pruebas de seguridad.
**Veredicto final: VERDE.**

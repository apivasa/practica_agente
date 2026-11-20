# M-09 — Informe QA

Veredicto: VERDE

## Criterio de aceptación
"pgTAP `has_column_privilege` y de valores no finitos; prueba unitaria de `cumulativeThirds(0.5)`"

| Punto | Estado | Evidencia |
|---|---|---|
| UPDATE de `targets` solo en `target_value` (H-M07-01) | Cumplido | 090 (dev): `has_column_privilege` por columna, sin UPDATE de tabla, 42501 al mover unidad, mes o indicador. 091 (QA): INSERT conservado, update con `returning` de todas las columnas (patrón de `saveTarget`), CHECK >= 0 sigue dando 23514, custodio, comité y líder sin filas (RLS) |
| `cumulativeThirds` nunca supera el total (H-M07-QA-01) | Cumplido | `cumulativeThirds(0.5)` = `[0.5, 0.5, 0.5]`; paquetes < 1, 2,5 y 1000,5; enteros sin cambios; "Proponer un tercio" con paquete 0,5 no pasa el paquete. Se quitó el `todo` de `tests/engine/qa-m07.test.js` y ahora pasa |
| Mediciones rechazan NaN/Infinity (CHECK `measurements_value_finite`) | Cumplido | 090: INSERT NaN, Infinity, -Infinity. 091: también por UPDATE (promedio y VULN) y -Infinity en VULN; la fila conserva su valor |
| VULN rechaza > 2^53 - 1 (H-M08-01) | Cumplido | 090: 2^53 y 1e30 rechazados, 2^53 - 1 aceptado. 091: UPDATE a 2^53 rechazado, 2^53 - 1 + 0,5 rechazado, UPDATE a 0 aceptado |
| La pantalla de metas (M-07) y su e2e siguen funcionando | Cumplido | `e2e/m07-targets.spec.js` en verde en CI: la gestora propone, crea y edita la meta; los demás roles son redirigidos |

## Pruebas añadidas
- `tests/engine/qa-m09.test.js`: 7 casos.
- `supabase/tests/091_qa_m09.test.sql`: 18 aserciones pgTAP (metas por rol y mediciones no finitas o no seguras por UPDATE).
- `tests/engine/qa-m07.test.js`: se quitó la marca `todo` del caso de paquete decimal (H-M07-QA-01). El caso ahora pasa.

## Resultado CI (commit 197ae03)
- CI: success — https://github.com/apivasa/practica_agente/actions/runs/44698602998 (pgTAP: 26 archivos, 585 pruebas, PASS; integración; build/unit; e2e: 82 passed)
- Seguridad: success — https://github.com/apivasa/practica_agente/actions/runs/44698602948
- Local: `node --test` dio 1569 pruebas, 0 fallos y 1 `todo`. El `todo` es H-C04-QA-01, ajeno a M-09.

## Cobertura engine/
Líneas: 99,9 % (todos los archivos al 100 % salvo `commitment.js`, con 99,26 %). Ramas de `vulnerabilities.js`: 97,75 %.

## Hallazgos
Ninguno bloqueante.
- Informativo: en indicadores que no son VULN, un valor finito mayor que 2^53 se acepta (`091`, último `lives_ok`). Así lo pide el alcance de M-09, porque el tope de entero seguro es solo de VULN. El motor trata esos valores como números de JavaScript con la precisión que tengan.

# M-10 — Informe QA

Veredicto: VERDE

## Criterio de aceptación
"pgTAP con 'NaN' e 'Infinity' por columna; verificación previa a producción"

| Punto | Estado | Evidencia |
|---|---|---|
| pgTAP con 'NaN' e 'Infinity' en `indicators.green_threshold` / `yellow_threshold` | Cumplido | 100 (desarrollador) + 101 (QA): INSERT y UPDATE, NaN, Infinity, -Infinity, grafías `nan`, `inf`, `+inf`, `infinity` |
| `commitments.green_override` / `yellow_override` / `package_total` | Cumplido | INSERT y UPDATE por cada columna, con el custodio (rol que escribe la tabla, bajo RLS) |
| `targets.target_value` | Cumplido | INSERT y UPDATE con la gestora (UPDATE por columna de M-09 sigue funcionando) |
| Verificación previa a producción | Cumplido | Las 6 restricciones están validadas (`convalidated`, no `NOT VALID`); las consultas de verificación del final de la migración devuelven 0 filas sobre la BD con semilla. La ejecución contra producción sigue siendo compuerta del usuario |
| Los valores finitos siguen aceptados (no se recorta el dominio) | Cumplido | 1e300, -1e300, 0, overrides negativos y NULL donde se permite |

## Pruebas añadidas
- `supabase/tests/101_qa_m10.test.sql`: 32 casos.
  - Catálogo y verificación previa: 4 (restricciones validadas; 3 consultas de verificación vacías).
  - indicators, gestora: 8 (NaN en los dos umbrales, que la regla de coherencia deja pasar porque `'NaN' >= 'NaN'` es verdadero; `inf`/`+inf`; UPDATE a infinity, -Infinity, Infinity y `nan` en los dos sentidos; extremos finitos y cero aceptados).
  - commitments, custodio: 9 (pareja NaN, paquete `inf`, UPDATE de cada columna a valores no finitos, incluido `package_total = 'NaN'`, que el CHECK original `>= 0` dejaba pasar; negativos finitos, 0 y NULL aceptados).
  - targets, gestora: 5 (`+inf`, Infinity, `nan`; 1e300 y 0 aceptados).
  - RLS por rol que no escribe: 3 (el líder no escribe commitments ni targets, el custodio no escribe indicators).
  - Estado final: 3 (solo quedan los valores finitos escritos por los roles autorizados).

## Resultado CI
Rama `item/M-10`, commit `b56f1f5`:
- CI run 44702907632: success. db (pgTAP) PASS con 29 archivos y 660 pruebas (100, 101 y security/048 ok); build, lint y unit ok; integración ok; e2e Playwright 91 passed. Siguen verdes M-02 indicadores (crear, desactivar y reactivar), M-03 compromisos (umbral negociado y paquete por categoría) y M-07 metas (crear y editar).
- Seguridad run 44702907751: success.
- Primera versión del 101 (`d8569ac`): falló por un error de la propia prueba (comparar `results_eq` sobre `name::text` da "could not determine which collation"). Se corrigió en `b56f1f5`. No fue un fallo de la app.

## Cobertura engine/
M-10 no toca `engine/`. Líneas: 100 % en todos los archivos salvo `commitment.js`, con 99,26 %. Total del repo: 98,64 % de líneas. Meta de 95 % cumplida.

## Hallazgos
- Ninguno bloqueante.
- Info: `evaluations.value` queda fuera a propósito, porque solo lo escribe el backend con el motor, como dice el comentario de la migración. No es una columna que configuren usuarios, así que no entra en el criterio.
- Info: `thresholds_by_category` (jsonb) no necesita esta restricción, porque JSON no admite NaN ni Infinity.

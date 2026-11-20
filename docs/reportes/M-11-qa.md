# M-11 — Informe QA
Veredicto: VERDE

Criterio de aceptación (plan-maestro M-11: "pgTAP con '1e400' por columna y por clave JSONB"; H-M10-01: tope |v| < 2^53):

| Punto | Estado | Evidencia |
|---|---|---|
| `indicators.green_threshold` rechaza 1e400 / ±2^53 / 1e300 | cumplido | 110 (1-4), 111 (gestora con RLS: UPDATE 1e300) |
| `indicators.yellow_threshold` | cumplido | 110 (3), 111 (UPDATE ±1e400, INSERT 2^53 en notación `9.007199254740992e15`, INSERT -2^53) |
| `commitments.green_override` / `yellow_override` | cumplido | 110 (6-7), 111 (custodio: UPDATE 1e300, 1e400; INSERT -2^53) |
| `commitments.package_total` | cumplido | 110 (8-9), 111 (custodio: UPDATE 1e300, INSERT 1e400) |
| `targets.target_value` | cumplido | 110 (último), 111 (gestora: UPDATE 1e300 y 2^53, INSERT 1e400) |
| `commitments.package_by_category`: cada valor número JSON con \|v\| < 2^53, por clave | cumplido | 110 (P0P1, P2P3, texto, null, arreglo, objeto, booleano), 111 (1e300, -1e400 en P2P3, 1e400 en una tercera clave, 2^53 exponencial, -2^53, número como texto, INSERT por custodio) |
| Borde estricto: ±(2^53 - 1) y ±(2^53 - 0.5) aceptados | cumplido | 110 y 111 en las siete restricciones |
| Sigue rechazando NaN (abs('NaN') < x es falso) | cumplido | 111 (gestora, NaN en ambos umbrales) |
| `package_by_category` no objeto se rechaza con 23514 (no error de jsonpath strict) | cumplido | 111 (`[1e400]` y `1e400` en la raíz): el CHECK de tipo `commitments_package_by_category_check` se evalúa antes (orden por nombre) |
| Restricciones validadas y consultas de verificación previa con 0 filas sobre la semilla | cumplido | 111 (1-4) |
| RLS intacta: roles que no escriben siguen sin escribir | cumplido | 111: custodio no toca indicators ni compromisos de un indicador ajeno; líder y comité no actualizan commitments; comité no inserta targets (42501) |

Pruebas añadidas o cambiadas:
- `supabase/tests/111_qa_m11.test.sql` (nuevo, 41 casos).
- `supabase/tests/101_qa_m10.test.sql` (32 casos, 3 ajustados): los casos 11, 25 y 30 aceptaban 1e300, lo que contradice M-11. Ahora usan ±(2^53 - 1) como finito grande aceptado; los rechazos de 1e300 quedan en 111.

Resultado CI (commit 6f0384d): CI `success` — https://github.com/apivasa/practica_agente/actions/runs/44716172302 . `db (pgTAP)`: Files=31, Tests=727, Result: PASS (100, 101, 110 y 111 en ok). build, integración y e2e en verde. El run previo sobre a12f8b6 fallaba solo por 101 (casos 11, 25, 30), ya corregido.

Cobertura engine/: 99.9 % de líneas (todos los archivos al 100 % salvo `commitment.js` 99.26 %); M-11 no toca `engine/`.

Hallazgos:
- **H-M11-01 (baja, fuera del alcance de M-11):** `indicators.thresholds_by_category` (JSONB que escribe la gestora) no tiene el mismo tope. Sus valores (`{"P0P1": {"green": ..., "yellow": ...}}`) llegan a `engine/rows.js` (umbral de compromiso por categoría) y a `src/lib/indicator-form.js` (`toEngineIndicator`) mediante `Number(...)`; un `1e400` se vuelve `Infinity` en `JSON.parse`, que es el mismo problema que corrigió H-M10-01. Para reproducirlo, como gestora: `update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1e400, "yellow": 1}}' where id = <id>;` y la base lo acepta. Solo puede escribirlo `kpi_manager`. Recomiendo abrir un ítem aparte con un CHECK jsonpath análogo sobre `$.*.green` y `$.*.yellow`. No bloquea M-11.

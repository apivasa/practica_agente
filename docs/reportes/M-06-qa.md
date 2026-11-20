# M-06 — Informe QA
Veredicto: VERDE (pendiente de confirmar con el CI de la rama; ver "Resultado CI")

Revisado: rama `item/M-06` sobre `a833462` (código) + `228e63a` (arquitectura) + `453bed1` (seguridad).
Reglas de referencia: `docs/diseno.md` "Caso: vulnerabilidades" (96 % P0/P1, 85 % P2/P3; meta parcial ≈ 1/3 por mes; P0/P1 nuevas de los meses 1 y 2 entran al paquete, las del mes 3 pasan al siguiente) y el criterio de M-06 en `docs/plan-maestro.md`.

## Criterio de aceptación
| Punto | Estado | Evidencia |
|---|---|---|
| 96/85 → verde | Cumplido | `qa-m06`: 2400/2500 (96,00) y 2125/2500 (85,00) exactos → verde |
| P0/P1 95 % → no verde | Cumplido | 2399/2500 (95,96) → amarillo; P2/P3 alto no compensa |
| Meta 0 | Cumplido | paquete 0/0 → 100 %, verde, sin `-0`; paquete 0 + P0/P1 nuevas de mes 2 → meta 20 |
| Categoría sin paquete → sin evaluar | Cumplido | paquete sin P2P3 o con `P2P3: null` → sin evaluar; un amarillo/rojo conocido se mantiene |
| Integración CI con semilla 2027-Q1 evalúa VULN sin `targets` | Cumplido en pruebas unitarias (fake-db con `targets = []`) y codificado en `scripts/ci/verify-evaluate.sql`; confirmación en CI de la rama |
| Usado por `scripts/lib/build.js` y `src/lib/dashboard.js` | Cumplido | `evaluateIndicatorMonth` igual con y sin target; meta del líder = meta de la evaluación |

## Verificación independiente de la semilla (cálculo propio, antes de tocar pruebas)
- Alfa enero: P0/P1 500/⌈1500/3⌉=500 → 100 %; P2/P3 250/167 → verde, valor 100.
- Alfa febrero: paquete P0/P1 1500+200 (detectadas 2027-02-10, mes 2) = 1700 → ⌈2/3⌉ = 1134; 1050/1134 = 92,59 % → amarillo; P2/P3 350/334 verde.
- Beta enero: 300/334 = 89,8 % → rojo (P2/P3 0/167 también rojo).
- Gamma enero: P0/P1 280/200 verde; P2/P3 80/100 = 80 % → amarillo. Gamma febrero: P0/P1 280/400 = 70 % y P2/P3 80/200 = 40 % → rojo, valor 40.
- Los colores globales y escaladas de C-03 (Beta restringida→congelada, Gamma excepción→congelada, Alfa amarillo/restringida en febrero) se conservan con la semilla nueva.

## Pruebas actualizadas (comportamiento anterior fijado por `targets`)
Cada cambio se verificó contra el cálculo de arriba; ninguno se ajustó solo para pasar.
- `tests/scripts/fake-db.js`: refleja los 3 cambios de `supabase/seed.sql`.
- `tests/scripts/run.test.js`: comentarios de valores por criticidad; prueba de trimestres de 92 días usa compromiso trimestral (P0/P1 100, P2/P3 0) en lugar de `targets`.
- `tests/scripts/lib.test.js`: la prueba de `targets` usa un indicador sin categorías (la ruta antigua sigue vigente para esos); nueva prueba equivalente por criticidad (+1 caso).
- `tests/front/dashboard.test.js`: meta `P0/P1 1134 · P2/P3 334`.
- `tests/front/qa-v01-v03.test.js`: metas `P0/P1 200 · P2/P3 0` (A) y `P0/P1 600 · P2/P3 0` (B), de su propio paquete.
- `e2e/v01-v03.spec.js`: `Meta acumulada de 2027-02: P0/P1 1134 · P2/P3 334`.
- `tests/scripts/qa-c03.test.js`: pasa sin cambios con la semilla sincronizada.

## Pruebas añadidas
- `tests/engine/qa-m06.test.js`: 35 casos — umbrales exactos (7 de la tabla + 2), redondeo de 1/3 y 2/3 (paquete 100 → 34/67/100; 300 → 100/200/300 sin desborde; 500 → 167/334; mes 3 = paquete completo), P0/P1 nuevas en mes 1, mes 2 (no afecta a enero) y mes 3 (no sube la meta), empates de color (amarillo/amarillo, verde/verde, rojo/rojo → valor menor), peor color, meta 0, sin compromiso, paquete nulo, categoría desconocida (`P4`, `p0p1`, `constructor`, `__proto__`) sin lanzar, categoría de medición inválida, ventana del trimestre, Q2 reinicia, exportes de `engine/index.js`, coherencia líder/evaluación, `runMonthly` con `targets = []` y compromiso mensual de VULN que no reemplaza al paquete.
- Local: `node --test 'tests/**/*.test.js'` → 1268 pass, 0 fail, 1 todo (H-C04-QA-01, previo).

## Resultado CI
Ver runs de `item/M-06` tras el push de este commit (se reporta al orquestador).

## Cobertura engine/
Líneas 99,95 % (todo `engine/`); `engine/rows.js` 100 %, `engine/vulnerabilities.js` 100 % (ramas 97,4 % y 97,7 %).

## Hallazgos
- **H-M06-QA-01 (baja, documentación):** el comentario de `supabase/seed.sql` dice "Gamma febrero P0/P1 280/400 = 70 % → rojo", pero el valor guardado es 40 (P2/P3 80/200 = 40 %, la categoría más baja entre dos rojos). El color es correcto. Reproducir: `runMonthly` con la semilla a 2027-03-01 y leer `value` de VULN Gamma 2027-02.
- **Observación (sin severidad):** con dos categorías del mismo color, `value` es el % más bajo aunque sus umbrales difieran (p. ej. P2/P3 80 % amarillo frente a P0/P1 92 % amarillo). Es coherente con "peor color", pero el número que ve el comité mezcla escalas; el motivo detalla ambas.

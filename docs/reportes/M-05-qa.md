# M-05 — Informe QA
Veredicto: ROJO

Fuentes leídas antes del código: fila M-05 de `docs/plan-maestro.md`; "Caso: vulnerabilidades" y "Alertas" de `docs/diseno.md`; Q-06 (decisiones por defecto) de `docs/pendientes-usuario.md`.

## Criterio de aceptación (por punto)
"Pruebas con el ejemplo del diseño (2.000 → 2.200) reproducen ritmo, meta y arrastre."

| Punto | Estado | Evidencia (`tests/engine/qa-m05.test.js`) |
|---|---|---|
| Paquete 2.000 → 2.200 por P0/P1 de meses 1–2 | Cumplido | 120 en enero + 80 en febrero → 2.200; borde 28-feb suma, 1-mar no |
| P0/P1 del mes 3 al paquete siguiente | Cumplido | no cambian meta ni ritmo; `carryToNextQuarter` = 30 |
| Cumplimiento 96 % P0/P1 y 85 % P2/P3 en el límite | Cumplido | 672/700 y 1.275/1.500 cumplen; 671 y 1.274 no; criticidades independientes; tope 100 % |
| Ritmo = pendiente / semanas restantes, recalculado al entrar críticas | Cumplido | 2.000/(89/7) al inicio; 2.000→2.200 con la misma fecha sube el ritmo; 0 semanas sin división por 0 |
| Meta parcial ≈ 1/3 por mes | Cumplido | 667/1.334/2.000 y 734/1.467/2.200; tramos a menos de 1 de un tercio; trimestre que cruza año |
| Arrastre de lo no resuelto | **No cumplido (borde)** | caso general OK (2.200 − 1.900 + 50 de marzo = 350); falla H-01 |
| Alerta de atraso (Q-06: prorrateo por días) | Cumplido | día 10 de enero → 216 esperado (216 al día, 215 atraso 1); 14-feb → 1.001; tras ingreso queda atrasado |
| Alerta de recálculo por ingreso de P0/P1 | Cumplido | delta 200, ritmo nuevo mayor; en mes 3 `targetChanged=false`, `carryDelta` y mensaje de paquete siguiente |

## Pruebas añadidas
- `tests/engine/qa-m05.test.js`: 43 casos en 10 grupos (superficie, ingreso meses 1–2, mes 3, cumplimiento, ritmo, meta parcial, arrastre, alerta de atraso, alerta de recálculo, errores de entrada).

## Resultado
- Local `npm run -s test:unit`: 618 pruebas, 617 pasan, **1 falla** (H-01). Sin commit (lo hace el orquestador); CI de la rama no revisado por este agente.

## Cobertura engine/
- `vulnerabilities.js`: 100 % líneas / 100 % ramas / 100 % funciones. `engine/` total: 100 %.

## Hallazgos
- **H-01 · Media · Se arrastran como pendientes P0/P1 del mes 3 que ya se resolvieron.**
  Diseño: "Lo no resuelto al cierre se suma al paquete siguiente"; Q-06: "las P0/P1 del mes 3 resueltas cuentan para el cumplimiento del trimestre actual".
  Reproducir: paquete `{p0p1: 500, p2p3: 1500}`, `newCritical: [{detectedOn: '2026-03-05', count: 10}]`, resueltas 510 P0P1 y 1.500 P2P3 al 2026-03-30, `asOf: '2026-03-31'`. Esperado `pendingCarry = 0`; obtenido `10`.
  Causa: `pendingCarry = max(efectivo − resuelto, 0) + m3` (vía `carryOver` de C-01) descarta el excedente resuelto en vez de restarlo de las P0/P1 del mes 3. Las 10 cuentan como resueltas (cumplimiento 100 %) y, a la vez, se arrastran como pendientes: doble conteo. Corrección sugerida: `max(efectivo + m3 − resuelto, 0)` por criticidad (el excedente sobre el efectivo solo puede venir de las del mes 3). Afecta también a `carryOver` en `engine/escalation.js` si se usa con las mismas entradas.
- Observación (sin severidad): `resolved` no distingue si una P0/P1 resuelta era del paquete o del mes 3; con resueltas ≤ efectivo, Q-06 permite que las del mes 3 tapen pendientes del paquete en el cumplimiento. Es coherente con la decisión por defecto; queda a la respuesta del usuario sobre Q-06.

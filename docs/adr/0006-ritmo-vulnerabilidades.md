# ADR 0006 — Ritmo esperado y cumplimiento del caso vulnerabilidades

Estado: Aceptado (decisión del orquestador, 2026-11-19; revisable con la respuesta a Q-06)
Ítem: M-05 (`engine/vulnerabilities.js`)

## Contexto
`docs/diseno.md`, sección "Caso: vulnerabilidades", fija el paquete trimestral, la entrada de P0/P1 en los meses 1 y 2, el paso al paquete siguiente de las detectadas en el mes 3, los umbrales de cumplimiento (96 % P0/P1, 85 % P2/P3), el ritmo esperado (pendiente / semanas restantes) y la meta parcial mensual (aprox. un tercio). No dice cómo medir el atraso dentro de un mes, contra qué se calcula el ritmo ni cómo cuentan las P0/P1 del mes 3 que se resuelven en el mismo trimestre. La pregunta Q-06 está abierta en `docs/pendientes-usuario.md`; mientras no haya respuesta, rigen estos valores por defecto. Ninguno cambia una regla confirmada.

## Decisión
1. **Prorrateo diario de la meta del mes en curso.** `paceStatus` (por defecto `monthToDate: true`) espera, al día *d* de un mes de *N* días, la meta acumulada del mes anterior más *d/N* de la meta del mes en curso, redondeando hacia arriba. El día `asOf` cuenta como transcurrido. Con `monthToDate: false` se exige la meta acumulada completa del mes (lo usaría la evaluación mensual si el comité lo prefiere).
2. **Meta mensual acumulada ≈ 1/3, 2/3 y 3/3 del total efectivo**, con redondeo hacia arriba en los meses 1 y 2; el mes 3 es exactamente el total efectivo.
3. **Ritmo contra el 100 % del pendiente.** `expectedWeeklyPace = pendiente total / semanas restantes`, no contra el pendiente necesario para llegar a 96 % / 85 %. Con 0 semanas restantes, el ritmo es el pendiente completo.
4. **Las P0/P1 del mes 3 resueltas cuentan para el cumplimiento del trimestre actual.** Las resoluciones `P0P1` se suman sin distinguir el mes de detección; el porcentaje se limita a 100 % (`min(resuelto, total)`). Las detectadas en el mes 3 no suben el total efectivo: van a `carryToNextQuarter`.
5. **Fechas fuera del trimestre o posteriores a `asOf` se rechazan** (`RangeError`). El motor no filtra en silencio: C-03 (Actions `evaluacion-mensual` y `ritmo-diario`) y la vista V-01 deben filtrar las filas por trimestre y por `asOf` antes de llamar.
6. **Reutilización:** el arrastre usa `carryOver` de `engine/escalation.js` (aplicado por criticidad) y la tolerancia de coma flotante usa `tolerance` de `engine/color.js`. No hay copias de esas reglas.
7. **Umbrales configurables.** `DEFAULT_COMPLIANCE_THRESHOLDS = { p0p1: 96, p2p3: 85 }` solo es el valor por defecto; quien llama pasa los umbrales del indicador configurado (`thresholds`).

## Consecuencias
- Funciones puras y deterministas (`packageStatus`, `paceStatus`, `recalculateOnNewCritical`); `asOf` en America/Guayaquil lo calcula quien llama, como en ADR 0003.
- Si Q-06 se responde distinto, el cambio queda acotado a `paceStatus` (punto 1), a `expectedWeeklyPace` (punto 3) o a la suma de resueltas (punto 4), con sus pruebas.
- C-03 debe persistir el `PackageStatus` del día anterior (o recalcularlo) para que `recalculateOnNewCritical` detecte el ingreso de P0/P1 y C-04 genere una sola alerta.

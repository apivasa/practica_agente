# M-05 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no (Q-06 sigue abierta y no bloquea: rigen los valores por defecto del ADR 0006)
ADR creados o actualizados: `docs/adr/0006-ritmo-vulnerabilidades.md` (nuevo, Aceptado, revisable con Q-06)
Salud: suite local `node --test 'tests/**/*.test.js'` con 488 pruebas, 488 pasan y 0 fallan. CI de la rama pendiente hasta el push del orquestador. `evaluacion-mensual` y `ritmo-diario` aún no existen (C-03), y `salud.yml` tampoco (V-04): no hay workflows programados que vigilar. `docs/operacion.md` se escribe en V-04.

Hallazgos:
1. **Pureza:** `engine/vulnerabilities.js` no lee el reloj, la red ni `process`. `asOf` viene de quien llama (mismo contrato que en ADR 0003). Correcto.
2. **Sin duplicados:** importa `carryOver` (`escalation.js`), `tolerance` (`color.js`) y `parseDay` (`measure.js`). `carryOver` se aplica por criticidad (P2/P3 con `[0,0,0]`) para no mezclar excedentes. Correcto. Observación menor, sin bloqueo: `monthDiff`/`addMonths` son parecidos a `nextMonth` (privado en `escalation.js`). Si un tercer módulo los necesita, hay que extraerlos a un helper común de fechas.
3. **Umbrales 96/85 configurables:** `DEFAULT_COMPLIANCE_THRESHOLDS` es solo el valor por defecto; `thresholds` se valida entre 0 y 100. C-03 y V-01 deben pasar los umbrales del indicador guardado en la BD y no depender del valor por defecto.
4. **API apta para C-03:** `packageStatus` → `paceStatus` (alerta de atraso) y `recalculateOnNewCritical(prev, new)` (alerta de ingreso de P0/P1). Requisitos para C-03, registrados en el ADR 0006: filtrar las filas por trimestre y por `asOf` antes de llamar (el motor rechaza esas fechas), y conservar o recalcular el estado previo para que la alerta sea idempotente.
5. **API apta para V-01:** `monthlyTargets`, `pending`, `expectedWeeklyPace`, `compliance` y `paceStatus().reason` (en español) cubren "meta mensual, avance vs. ritmo". Correcto.
6. **Modelo genérico:** el caso vulnerabilidades es una especialización del tipo `cumulative_target` que el diseño describe de forma explícita. No hay identificadores de KPI quemados en el código. Correcto.
7. **Decisiones registradas (ADR 0006):** prorrateo diario de la meta del mes; ritmo contra el 100 % del pendiente; las P0/P1 del mes 3 que se resuelven cuentan para el cumplimiento del trimestre actual; las fechas fuera del trimestre se rechazan y C-03 filtra antes.

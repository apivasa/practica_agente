# M-01 — Informe de arquitectura y salud
Veredicto: VERDE
Alineado al diseño: sí
Requiere decisión del usuario: no
ADR creados o actualizados: `docs/adr/0002-pruebas-node-test.md` (nuevo, Aceptado); `docs/adr/0001-stack.md` (Vitest reemplazado por `node:test`, con nota que remite al 0002)
Salud: aún no hay workflows en `.github/workflows/` (CI, `salud.yml`, `evaluacion-mensual`, `ritmo-diario` llegan con F-02/C-03); no hay producción (P-02/P-03 pendientes). Verificación local con Node 22: 39/39 pruebas en verde, cobertura de `engine/` 100 % líneas, ramas y funciones con el comando canónico del ADR 0002.

## Verificación contra diseño y ADR 0001
- **Pureza:** `engine/` no importa nada externo (solo módulos relativos), no usa `fetch`, `process`, `Date.now`, `new Date()` sin argumentos ni aleatoriedad. Toda la "fecha de hoy" entra por `asOf`. Correcto.
- **Modelo genérico (7 atributos):** tipo (`measurementType`: `cumulative_target`, `window_average`, `coverage`), sentido (`direction`), ventana (`windowDays`), umbrales (`thresholds` + `thresholdsByCategory` opcional; rojo implícito por debajo/encima de amarillo), frecuencia (`frequency`), mínimo de muestra (`minSample`), fuente (`source`). Completo. El custodio es dato de la tabla Indicadores, no del motor: correcto que no esté.
- **Nada quemado de un KPI:** no hay referencias a MTTR, vulnerabilidades, disponibilidad ni P0/P1 en el código; solo en el ejemplo del README.
- **Uso dual (Vite y Node 20+ en Actions):** ESM puro con `engine/package.json` `{"type":"module"}` e `index.js` como punto de entrada; sin APIs de Node ni del navegador. Compatible con ambos.
- **Idioma:** identificadores en inglés; mensajes de error y `reason` en español.

## Evaluación de las 5 decisiones del desarrollador
1. **Filtro por categoría en `measure`:** coherente con "umbrales opcionalmente por categoría" y necesario para M-05 (96 % P0/P1, 85 % P2/P3). No contradice.
2. **`cumulative_target` con target 0 → 100, sin datos → null, sin tope al 100 %:** sin datos → `not_evaluated` es lo que pide el criterio. Meta 0 cumplida = 100 % es razonable. No topar permite ver sobrecumplimiento y no altera el color (el umbral se compara con `>=`). No contradice. M-05 decidirá si el arrastre usa el valor sin tope.
3. **Cobertura con duplicados (última medición por `appId` en la ventana; empate por orden del arreglo):** coherente con "% de aplicaciones que cumplen". No contradice. Ver hallazgo 3.
4. **Mediciones malformadas ignoradas:** correcto para el motor; el rechazo con mensaje fila a fila pertenece a la capa de captura/CSV (M-04). No contradice, siempre que M-04 valide antes de guardar.
5. **`frequency` y `source` solo validados:** correcto; la frecuencia la usa la programación de Actions (C-03) y la fuente la captura (M-04/Q-02). No contradice.

## Hallazgos (ninguno bloquea)
1. **Node 22 para pruebas.** `--test-coverage-exclude` y los globs en `node --test` requieren Node 22; F-02 debe fijar `node-version: 22` en CI (registrado en ADR 0002). El motor sigue funcionando en Node 20+.
2. **Comando de pruebas del README de `engine/` difiere del canónico** (no excluye `tests/**` de la cobertura). Alinear con el ADR 0002 (desarrollador o documentador).
3. **Desempate de cobertura por orden del arreglo:** depende de que el llamador entregue las mediciones ordenadas (p. ej. `ORDER BY date, created_at`). Las Actions de C-03 y el front deben ordenar igual para no dar resultados distintos; dejarlo explícito en C-03.
4. **Fechas en UTC sin hora:** el llamador debe convertir "hoy" a fecha local de America/Guayaquil antes de pasar `asOf` (relevante para `ritmo-diario` y la evaluación del día 1 a las 06:00). Registrar en C-03.
5. **Umbrales negociados (Compromisos, M-03):** el motor recibe una configuración ya resuelta; la fusión "compromiso sobrescribe general" debe vivir también en `engine/` (función pura) cuando se haga M-03, para no duplicarla entre front y Actions.

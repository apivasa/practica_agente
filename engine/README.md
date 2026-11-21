# engine/ — Motor de color

Funciones puras en JavaScript ESM, sin dependencias ni acceso a red. Las usan el front y las GitHub Actions; la lógica no se duplica en otro lugar.

## API

- `validateIndicator(cfg)` → `{ ok, errors[] }` (mensajes en español). Rechaza `cumulative_target` con `lower_is_better` (M-08; la BD lo impide con el CHECK `indicators_cumulative_direction`).
- `normalizeIndicator(cfg)` → copia con valores por defecto (`windowDays: 30`, `frequency: 'monthly'`, `minSample: 0`, `source: 'manual'`, `thresholdsByCategory` vacío). Lanza `Error` si la configuración no es válida. `thresholdsByCategory` se devuelve como objeto sin prototipo; la clave `__proto__` se descarta y nunca se usa como categoría.
- `measure(cfg, measurements, { asOf, target?, category? })` → `{ value, sampleSize, reason? }`. Ventana inclusiva `[asOf - windowDays + 1, asOf]`, fechas `YYYY-MM-DD` en UTC. Ventana vacía → `{ value: null, sampleSize: 0 }`. Con `category`, solo cuentan las mediciones de esa categoría.
  - `window_average`: promedio de `value`.
  - `coverage`: % de `appId` distintos cuya última medición en la ventana tiene `compliant === true` (se calcula como `cumplen × 100 / total`).
  - `cumulative_target`: suma de `value` (resueltos) × 100 / `target`. Con `target === 0` → 100 (no hay nada que resolver). Con `target` ausente o `null` → `value: null` y `reason` = `REASON_MISSING_TARGET` (sin evaluar: falta el compromiso).
  - **Valores negativos o no finitos se ignoran** en `window_average` y `cumulative_target`: no tienen sentido en estos KPI (disponibilidad, tiempos, resueltos).
  - Si el resultado se desborda (no es finito) → `value: null` y `reason` = `REASON_OUT_OF_RANGE`.
- `evaluateColor(cfg, measured, { category? })` → `{ color, reason }`, con `color` en `green | yellow | red | not_evaluated`.
  - Empate en un umbral = color mejor. El empate se compara con tolerancia `tolerance(u) = 1e-9 × max(1, |u|)`, para que valores calculados como `99.89999999999999` empaten con `99.9`.
  - `value === null` → `not_evaluated` (con la `reason` de `measure` si la trae).
  - `sampleSize` no entero o negativo → `not_evaluated`; ausente se toma como 0. `sampleSize < minSample` → `not_evaluated`.
  - `value` que no es número finito (y no es `null`) → lanza `Error`: es un error del llamador; `measure` nunca devuelve valores no finitos.

### Compromisos (M-03) — `commitment.js`

- `isValidPeriod(p)`: `YYYY-Qn` o `YYYY-MM` (mismo patrón que `commitments.period`).
- `validateCommitment(indicator, { period, greenOverride?, yellowOverride?, packageByCategory? })` → `{ ok, errors[] }`. El umbral negociado va en pareja (verde y amarillo) y debe ser coherente con `direction`. `packageByCategory` solo en `cumulative_target`, enteros >= 0.
- `effectiveThresholds(indicator, commitment)` → `{ green, yellow, overridden, reason? }`. Aplica el umbral negociado del compromiso sobre el general. Acepta el indicador del motor (`thresholds`) o la fila de la BD (`green_threshold`, `yellow_threshold`) y el compromiso en camelCase o snake_case (`green_override`). Un override incompleto o incoherente no se aplica y `reason` lo explica. Para evaluar con él: `evaluateColor({ ...cfg, thresholds: { green, yellow } }, measured)`.
- Es la **única** regla de umbral negociado: `indicatorConfig` (`rows.js`) la usa, y con ella las Actions (C-03) y el front (V-01). La BD impide overrides a medias (`commitments_override_pair`).
- `packageTotal(packageByCategory)`: suma (para `commitments.package_total`).

### Filas de la BD → contratos del motor (V-01) — `rows.js`

Lo comparten `scripts/lib/build.js` (Actions, que lo reexporta) y `src/lib/dashboard.js` (front). El front nunca importa de `scripts/` (lo verifica `tests/front/boundaries.test.js`).

- `num(v)` → número finito o `null` (PostgREST puede devolver `numeric` como texto).
- `pickCommitment(commitments, unitId, indicatorId, month)` → compromiso del mes (`YYYY-MM`) o, si no hay, el del trimestre (`YYYY-Qn`); `null` si ninguno.
- `indicatorConfig(row, commitment?)` → `{ cfg, thresholdSource: 'commitment' | 'indicator', note? }`: configuración del motor desde una fila de `indicators`, con los umbrales efectivos de `effectiveThresholds`.
- `isResolved(row)` → `true` si `kind` es `resolved` o nulo (filas anteriores a M-05).
- `buildPackageInput({ indicator, commitment, measurements, asOf })` → `{ ok: true, input }` para `packageStatus`, o `{ ok: false, reason }` si el compromiso no trae `package_by_category`. Filtra las mediciones fuera del trimestre de `asOf` o posteriores a `asOf`. Descarta las filas malformadas (resueltas con categoría distinta de `P0P1`/`P2P3` o valor no entero ≥ 0; detectadas P0/P1 con valor no entero ≥ 0) y las cuenta en `discarded`: la evaluación mensual, el ritmo diario y el ritmo del front comparten el filtro (M-08). `discardedNote(n)` da el texto del motivo.

### Calendario (V-01) — `calendar.js`

Puro, sin zona horaria (fechas de calendario). `scripts/lib/dates.js` lo reexporta.

- `addMonths('YYYY-MM', n)` → mes desplazado `n` meses (n negativo hacia atrás).
- `monthEnd('YYYY-MM')` → último día `'YYYY-MM-DD'`.
- `quarterBounds('YYYY-MM')` → `{ quarter, start, end, months }` del trimestre calendario del mes.
- Meses inválidos lanzan `TypeError`.

### Candado vigente hoy (V-08) — `lock.js`

- `buildHistory(evalMonth, storedColors, currentColor)` y `assertHistoryFresh(history, asOf)`: historial del trimestre y frescura del cierre (movidas desde `scripts/lib/build.js`, que las reexporta). `YELLOW_MONTH2_ESCALATES_LIKE_RED` (Q-03) también vive aquí.
- `lockToday({ unitId, evaluations, exceptions, today })` → candado de la unidad hoy con `evaluateEscalation`: historial desde las evaluaciones globales guardadas (cierre del mes de `today` o del anterior) y las excepciones tal como están hoy. Devuelve `{ ok: true, closureMonth, level, restrictions, authorizedStarts, … }` o `{ ok: false, status: 'no_closure' | 'invalid', reason }`. Lo usan los tableros del líder y del comité; el candado guardado sigue siendo el oficial del cierre.

### Fecha de negocio — `dates.js`

- `businessDate(now)` → `'YYYY-MM-DD'` en America/Guayaquil. La usan `src/lib/dates.js` y `scripts/lib/dates.js`.

### Captura de mediciones (M-04) — `measurements-input.js`

- `validateMeasurementInput(indicator, fields, { units, today? })` → `{ ok, row }` o `{ ok: false, errors: [{ field, message }] }`. `fields` son textos: `fecha`, `unidad` (nombre o id), `valor`, `app_id`, `cumple`, `categoria`, `tipo`. `row` = `{ date, unitId, value, appId, compliant, category, kind }`.
- `parseMeasurementsCsv(text, indicator, { units, today? })` → `{ rows, errors: [{ row, message }] }`. `row` es el número de fila del archivo (1 = cabecera); `null` para errores del archivo. Si hay algún error, `rows` viene vacío: se guarda todo o nada.
  - Cabeceras: `window_average` → `fecha,unidad,valor`; `coverage` → `fecha,unidad,app_id,cumple`; `cumulative_target` → `fecha,unidad,valor[,categoria][,tipo]`. Separador `,` o `;`, BOM opcional, comillas RFC 4180.
  - Valida fechas reales (`AAAA-MM-DD`, desde 2000, no futuras si se da `today`), unidad existente, `valor >= 0` (entero en `cumulative_target`), `cumple` sí/no, categoría entre las de `thresholdsByCategory` si las hay, `tipo` resuelta/detectada (por defecto resuelta).
  - Inyección de fórmulas: celdas que empiezan con `=`, `+`, `-`, `@`, tabulador o retorno de carro se **rechazan**.
  - Límites: 1 MB (`CSV_MAX_BYTES`) y 5.000 filas de datos (`CSV_MAX_ROWS`).
  - En `cumulative_target`, `valor` es **incremental** (lo resuelto o detectado en esa fecha); `measure` suma la ventana.

## Ejemplo

```js
import { measure, evaluateColor } from './engine/index.js';

const mttr = {
  measurementType: 'window_average',
  direction: 'lower_is_better',
  windowDays: 30,
  thresholds: { green: 4, yellow: 8 }, // horas
  minSample: 3,
};

const m = measure(mttr, [
  { date: '2026-11-02', value: 3 },
  { date: '2026-11-10', value: 5 },
  { date: '2026-11-18', value: 4 },
], { asOf: '2026-11-30' });
// m = { value: 4, sampleSize: 3 }

evaluateColor(mttr, m); // { color: 'green', reason: 'Valor 4 <= verde 4' }
```

## Pruebas

```sh
node --test --experimental-test-coverage --test-coverage-exclude='tests/**' 'tests/**/*.test.js'
```

### Correo de una alerta (C-05) — `alert-email.js`

- `formatAlertEmail(alert, { appUrl? })` → `{ subject, text, html }` con solo los datos de esa fila de `alerts` (tipo, mensaje, unidad, fecha). Todo texto de la BD pasa por `plainText` (una línea, sin caracteres de control ni marcas bidi, recortado) y en el HTML por `escapeHtml`. `appUrl` solo se enlaza si es https sin credenciales (`safeHttpsUrl`). Lo usa `scripts/lib/email.js` (Resend, desde Actions).
- `ALERT_KIND_LABELS` / `alertKindLabel(kind)`: etiquetas de los tipos de alerta; el front las reexporta desde `src/lib/dashboard.js` (una sola fuente).

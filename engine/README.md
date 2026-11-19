# engine/ — Motor de color

Funciones puras en JavaScript ESM, sin dependencias ni acceso a red. Las usan el front y las GitHub Actions; la lógica no se duplica en otro lugar.

## API

- `validateIndicator(cfg)` → `{ ok, errors[] }` (mensajes en español).
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
- `packageTotal(packageByCategory)`: suma (para `commitments.package_total`).

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

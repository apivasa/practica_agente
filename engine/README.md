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

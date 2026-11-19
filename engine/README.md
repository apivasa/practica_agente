# engine/ — Motor de color

Funciones puras en JavaScript ESM, sin dependencias ni acceso a red. Las usan el front y las GitHub Actions; la lógica no se duplica en otro lugar.

## API

- `validateIndicator(cfg)` → `{ ok, errors[] }` (mensajes en español).
- `normalizeIndicator(cfg)` → copia con valores por defecto (`windowDays: 30`, `frequency: 'monthly'`, `minSample: 0`, `source: 'manual'`, `thresholdsByCategory: {}`). Lanza `Error` si la configuración no es válida.
- `measure(cfg, measurements, { asOf, target?, category? })` → `{ value, sampleSize }`. Ventana inclusiva `[asOf - windowDays + 1, asOf]`, fechas `YYYY-MM-DD` en UTC. Ventana vacía → `{ value: null, sampleSize: 0 }`.
  - `window_average`: promedio de `value`.
  - `coverage`: % de `appId` distintos cuya última medición en la ventana tiene `compliant === true`.
  - `cumulative_target`: suma de `value` (resueltos) / `target` × 100; con `target` 0 o ausente → 100.
- `evaluateColor(cfg, measured, { category? })` → `{ color, reason }`, con `color` en `green | yellow | red | not_evaluated`. Empate exacto en un umbral = color mejor. `value === null` o `sampleSize < minSample` → `not_evaluated`.

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
node --test --experimental-test-coverage "tests/engine/*.test.js"
```

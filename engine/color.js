// Evaluación del color de un indicador (función pura).
import { normalizeIndicator } from './indicator.js';

/** @typedef {'green'|'yellow'|'red'|'not_evaluated'} Color */

/**
 * Tolerancia para comparar con un umbral: absorbe errores de coma flotante de valores
 * calculados (p. ej. 99.89999999999999 frente a 99.9) sin afectar diferencias reales.
 * @param {number} threshold
 */
export const tolerance = (threshold) => 1e-9 * Math.max(1, Math.abs(threshold));

/** value >= threshold, con empate (dentro de la tolerancia) a favor. */
const atLeast = (value, threshold) => value >= threshold - tolerance(threshold);
/** value <= threshold, con empate (dentro de la tolerancia) a favor. */
const atMost = (value, threshold) => value <= threshold + tolerance(threshold);

/**
 * Evalúa el color según sentido y umbrales. Empate en un umbral (exacto o dentro de la
 * tolerancia de coma flotante) = color mejor.
 * - `value === null` → 'not_evaluated' (usa `measured.reason` si viene de `measure`).
 * - `sampleSize` no entero o negativo → 'not_evaluated'. Ausente se toma como 0.
 * - `sampleSize < minSample` → 'not_evaluated'.
 * - `value` que no es número finito (no null) → lanza Error: es un error del llamador,
 *   `measure` nunca devuelve valores no finitos.
 * Si `category` tiene umbrales propios en `thresholdsByCategory`, se usan esos.
 *
 * @param {import('./indicator.js').IndicatorConfig} cfg
 * @param {import('./measure.js').Measured} measured
 * @param {{ category?: string }} [options]
 * @returns {{ color: Color, reason: string }}
 */
export function evaluateColor(cfg, measured, { category } = {}) {
  const ind = normalizeIndicator(cfg);
  const value = measured?.value ?? null;
  const sampleSize = measured?.sampleSize ?? 0;

  if (value === null) {
    const reason = typeof measured?.reason === 'string' ? measured.reason : 'Sin datos en la ventana de cálculo';
    return { color: 'not_evaluated', reason };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('measured.value: debe ser un número finito o null');
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    return { color: 'not_evaluated', reason: 'Tamaño de muestra inválido: debe ser un entero mayor o igual que 0' };
  }
  if (sampleSize < ind.minSample) {
    return {
      color: 'not_evaluated',
      reason: `Muestra insuficiente: ${sampleSize} de ${ind.minSample} requeridas`,
    };
  }

  const hasCategory =
    category !== undefined && Object.prototype.hasOwnProperty.call(ind.thresholdsByCategory, category);
  const t = hasCategory ? ind.thresholdsByCategory[category] : ind.thresholds;
  const scope = hasCategory ? ` (umbrales de categoría ${category})` : '';

  if (ind.direction === 'higher_is_better') {
    if (atLeast(value, t.green)) return { color: 'green', reason: `Valor ${value} >= verde ${t.green}${scope}` };
    if (atLeast(value, t.yellow)) return { color: 'yellow', reason: `Valor ${value} >= amarillo ${t.yellow}${scope}` };
    return { color: 'red', reason: `Valor ${value} < amarillo ${t.yellow}${scope}` };
  }
  if (atMost(value, t.green)) return { color: 'green', reason: `Valor ${value} <= verde ${t.green}${scope}` };
  if (atMost(value, t.yellow)) return { color: 'yellow', reason: `Valor ${value} <= amarillo ${t.yellow}${scope}` };
  return { color: 'red', reason: `Valor ${value} > amarillo ${t.yellow}${scope}` };
}

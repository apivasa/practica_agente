// Evaluación del color de un indicador (función pura).
import { normalizeIndicator } from './indicator.js';

/** @typedef {'green'|'yellow'|'red'|'not_evaluated'} Color */

/**
 * Evalúa el color según sentido y umbrales. Empate exacto en un umbral = color mejor.
 * `value === null` o `sampleSize < minSample` → 'not_evaluated'.
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
    return { color: 'not_evaluated', reason: 'Sin datos en la ventana de cálculo' };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('measured.value: debe ser un número finito o null');
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
    if (value >= t.green) return { color: 'green', reason: `Valor ${value} >= verde ${t.green}${scope}` };
    if (value >= t.yellow) return { color: 'yellow', reason: `Valor ${value} >= amarillo ${t.yellow}${scope}` };
    return { color: 'red', reason: `Valor ${value} < amarillo ${t.yellow}${scope}` };
  }
  if (value <= t.green) return { color: 'green', reason: `Valor ${value} <= verde ${t.green}${scope}` };
  if (value <= t.yellow) return { color: 'yellow', reason: `Valor ${value} <= amarillo ${t.yellow}${scope}` };
  return { color: 'red', reason: `Valor ${value} > amarillo ${t.yellow}${scope}` };
}

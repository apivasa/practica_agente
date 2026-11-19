// Punto de entrada del motor: reexporta las funciones puras.
export {
  validateIndicator,
  normalizeIndicator,
  MEASUREMENT_TYPES,
  DIRECTIONS,
  FREQUENCIES,
  SOURCES,
  DEFAULTS,
} from './indicator.js';
export { measure, parseDay } from './measure.js';
export { evaluateColor } from './color.js';

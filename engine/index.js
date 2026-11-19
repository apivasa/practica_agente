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
export { measure, parseDay, REASON_MISSING_TARGET, REASON_OUT_OF_RANGE } from './measure.js';
export { evaluateColor, tolerance } from './color.js';
export * from './escalation.js';
export {
  packageStatus,
  paceStatus,
  recalculateOnNewCritical,
  DEFAULT_COMPLIANCE_THRESHOLDS,
} from './vulnerabilities.js';

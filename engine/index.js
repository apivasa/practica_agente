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
export {
  PERIOD_RE,
  isValidPeriod,
  validateCommitment,
  effectiveThresholds,
  packageTotal,
} from './commitment.js';
export {
  parseMeasurementsCsv,
  validateMeasurementInput,
  tokenizeCsv,
  isFormulaLike,
  CSV_COLUMNS,
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
} from './measurements-input.js';
export { businessDate, BUSINESS_TZ } from './dates.js';
export {
  EXCEPTION_MAX_DAYS,
  EXCEPTION_SCOPES,
  CHANGE_REF_MAX_LEN,
  REASON_MAX_LEN,
  addDays,
  maxExpiry,
  exceptionStatus,
  validateExceptionDraft,
} from './exceptions.js';

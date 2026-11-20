// Compromisos por unidad, indicador y periodo (M-03): validación y umbrales
// efectivos (override negociado sobre el umbral general). Funciones puras.
import { DIRECTIONS } from './indicator.js';
import { isSafeMagnitude, SAFE_ABS_LIMIT_TEXT } from './numeric.js';

/** Periodo trimestral (YYYY-Qn) o mensual (YYYY-MM). Mismo patrón que la BD. */
export const PERIOD_RE = /^[0-9]{4}-(Q[1-4]|0[1-9]|1[0-2])$/;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => v !== undefined && v !== null;
// PostgREST puede devolver `numeric` como texto: se acepta "99.5" pero no "" ni "abc".
const toNum = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

/** true si el periodo tiene formato YYYY-Qn o YYYY-MM válido. */
export function isValidPeriod(period) {
  return typeof period === 'string' && PERIOD_RE.test(period);
}

/** Lee un campo en camelCase o, si no está, en snake_case (filas de la BD). */
function pick(obj, camel, snake) {
  if (!isPlainObject(obj)) return undefined;
  return obj[camel] !== undefined ? obj[camel] : obj[snake];
}

/** Umbrales generales del indicador ({ thresholds } del motor o fila de la BD). */
function generalThresholds(indicator) {
  if (isPlainObject(indicator?.thresholds)) {
    return { green: toNum(indicator.thresholds.green), yellow: toNum(indicator.thresholds.yellow) };
  }
  return { green: toNum(indicator?.green_threshold), yellow: toNum(indicator?.yellow_threshold) };
}

function coherent(direction, green, yellow) {
  if (direction === 'higher_is_better') return green >= yellow;
  if (direction === 'lower_is_better') return green <= yellow;
  return false;
}

/**
 * Valida un compromiso contra su indicador. Mensajes en español.
 * - period: obligatorio, YYYY-Qn o YYYY-MM.
 * - greenOverride / yellowOverride: opcionales, pero van juntos; números finitos
 *   coherentes con el sentido del indicador.
 * - packageByCategory: opcional, solo para cumulative_target; enteros >= 0.
 *
 * @param {object} indicator configuración del motor ({ measurementType, direction, ... })
 * @param {object} commitment { period, greenOverride?, yellowOverride?, packageByCategory? }
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCommitment(indicator, commitment) {
  const errors = [];
  if (!isPlainObject(commitment)) return { ok: false, errors: ['El compromiso debe ser un objeto'] };
  const direction = indicator?.direction;
  if (!DIRECTIONS.includes(direction)) errors.push('El indicador no tiene un sentido válido');

  const period = pick(commitment, 'period', 'period');
  if (!isValidPeriod(period)) {
    errors.push('Periodo: usa el formato AAAA-Qn (trimestre, ej. 2027-Q1) o AAAA-MM (mes, ej. 2027-03)');
  }

  const green = pick(commitment, 'greenOverride', 'green_override');
  const yellow = pick(commitment, 'yellowOverride', 'yellow_override');
  if (present(green) !== present(yellow)) {
    errors.push('Umbral negociado: indica verde y amarillo, o deja los dos vacíos');
  } else if (present(green)) {
    if (!isFiniteNumber(green)) errors.push('Umbral verde negociado: debe ser un número');
    if (!isFiniteNumber(yellow)) errors.push('Umbral amarillo negociado: debe ser un número');
    // M-13: mismo tope que la BD (|v| < 2^53).
    if (isFiniteNumber(green) && !isSafeMagnitude(green)) {
      errors.push(`Umbral verde negociado: fuera de rango, debe ser ${SAFE_ABS_LIMIT_TEXT}`);
    }
    if (isFiniteNumber(yellow) && !isSafeMagnitude(yellow)) {
      errors.push(`Umbral amarillo negociado: fuera de rango, debe ser ${SAFE_ABS_LIMIT_TEXT}`);
    }
    if (isSafeMagnitude(green) && isSafeMagnitude(yellow) && DIRECTIONS.includes(direction)
      && !coherent(direction, green, yellow)) {
      errors.push(direction === 'higher_is_better'
        ? 'Umbral negociado: con "más es mejor" el verde debe ser mayor o igual que el amarillo'
        : 'Umbral negociado: con "menos es mejor" el verde debe ser menor o igual que el amarillo');
    }
  }

  const pkg = pick(commitment, 'packageByCategory', 'package_by_category');
  if (present(pkg)) {
    if (indicator?.measurementType !== 'cumulative_target') {
      errors.push('Paquete por categoría: solo aplica a indicadores de meta acumulada');
    } else if (!isPlainObject(pkg)) {
      errors.push('Paquete por categoría: debe ser un objeto { categoría: cantidad }');
    } else {
      let allValid = true;
      for (const [cat, n] of Object.entries(pkg)) {
        if (cat === '__proto__' || !cat.trim()) {
          errors.push('Paquete por categoría: nombre de categoría inválido');
          allValid = false;
        } else if (!(Number.isInteger(n) && n >= 0)) {
          errors.push(`Paquete de ${cat}: debe ser un entero mayor o igual que 0`);
          allValid = false;
        } else if (!isSafeMagnitude(n)) {
          errors.push(`Paquete de ${cat}: fuera de rango, debe ser ${SAFE_ABS_LIMIT_TEXT}`);
          allValid = false;
        }
      }
      // M-13: package_total (la suma) también tiene el tope de la BD.
      if (allValid && !isSafeMagnitude(packageTotal(pkg) ?? 0)) {
        errors.push(`Paquete total: fuera de rango, la suma debe ser ${SAFE_ABS_LIMIT_TEXT}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Umbrales que aplican a una unidad en un periodo: los negociados en el
 * compromiso si existen (verde y amarillo juntos, coherentes con el sentido),
 * si no, los generales del indicador.
 *
 * Acepta el indicador como configuración del motor ({ direction, thresholds })
 * o como fila de la BD ({ direction, green_threshold, yellow_threshold }), y el
 * compromiso en camelCase ({ greenOverride, yellowOverride }) o snake_case.
 *
 * Un override incompleto o incoherente no se aplica: se devuelven los
 * generales con `reason` explicando por qué (para auditar en C-03).
 *
 * @returns {{ green: number, yellow: number, overridden: boolean, reason?: string }}
 */
export function effectiveThresholds(indicator, commitment) {
  const green = pick(commitment, 'greenOverride', 'green_override');
  const yellow = pick(commitment, 'yellowOverride', 'yellow_override');
  const g = toNum(green);
  const y = toNum(yellow);
  // Un override completo y coherente reemplaza a los dos umbrales: no hace falta el general.
  if (isFiniteNumber(g) && isFiniteNumber(y) && coherent(indicator?.direction, g, y)) {
    return { green: g, yellow: y, overridden: true };
  }
  const base = generalThresholds(indicator);
  if (!isFiniteNumber(base.green) || !isFiniteNumber(base.yellow)) {
    throw new Error('Indicador sin umbrales generales válidos');
  }
  if (!present(green) && !present(yellow)) return { ...base, overridden: false };
  if (!isFiniteNumber(g) || !isFiniteNumber(y)) {
    return { ...base, overridden: false, reason: 'Umbral negociado incompleto: se usan los generales' };
  }
  return { ...base, overridden: false, reason: 'Umbral negociado incoherente con el sentido: se usan los generales' };
}

/** Suma del paquete por categoría (para commitments.package_total). null si no hay paquete. */
export function packageTotal(packageByCategory) {
  if (!isPlainObject(packageByCategory)) return null;
  const values = Object.values(packageByCategory);
  if (values.length === 0) return null;
  return values.reduce((s, n) => s + n, 0);
}

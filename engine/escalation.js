// Motor de escalada (candados) — funciones puras, sin dependencias.
// Reglas: docs/diseno.md, secciones "Reglas de escalada", "Excepciones" y
// "Caso: vulnerabilidades". Detalle de la tabla de verdad en engine/ESCALATION.md.
import { exceptionStatus } from './exceptions.js';

/** @typedef {'green' | 'yellow' | 'red' | 'not_evaluated'} Color */
/** @typedef {'normal' | 'restricted' | 'frozen' | 'exception'} Level */
/**
 * @typedef {'no_new_change' | 'no_backlog_additions' | 'prioritize_run'
 *   | 'freeze_all_change' | 'all_capacity_to_run'} Restriction
 */
/** @typedef {{ month: string, color: Color }} MonthColor */
/**
 * @typedef {Object} Exception
 * @property {string} id
 * @property {'change_start' | 'all'} scope
 * @property {string} expiresOn 'YYYY-MM-DD' (vigente hasta ese día inclusive).
 * @property {string | null} [changeRef] Change concreto autorizado (C-02, scope change_start).
 * @property {string | null} [revokedOn] Fecha 'YYYY-MM-DD' (America/Guayaquil) de la revocación;
 *   desde ese día la excepción no aplica.
 */
/** @typedef {{ id: string, change_ref: string | null }} AuthorizedStart */
/**
 * @typedef {Object} EscalationOptions
 * @property {boolean} [yellowMonth2EscalatesLikeRed=false] Q-03: amarillo en mes 2+ congela como rojo.
 * @property {Exception[]} [activeExceptions=[]] Excepciones aprobadas por el comité.
 * @property {string} asOf Fecha de evaluación 'YYYY-MM-DD'.
 */
/**
 * @typedef {Object} EscalationResult
 * @property {Level} level
 * @property {Restriction[]} restrictions Restricciones efectivas tras aplicar excepciones.
 * @property {string} reason Explicación en español.
 * @property {number} monthsInBreach Meses consecutivos fuera de verde al final del historial.
 * @property {Restriction[]} suppressedRestrictions Restricciones suspendidas por excepciones vigentes.
 * @property {string[]} appliedExceptions Ids de excepciones vigentes que se aplicaron.
 * @property {string[]} expiredExceptions Ids de excepciones vencidas (ignoradas).
 * @property {string[]} revokedExceptions Ids de excepciones revocadas (ignoradas).
 * @property {AuthorizedStart[]} authorizedStarts Inicios puntuales autorizados por excepciones
 *   change_start vigentes con la unidad congelada (ADR 0003): no levantan el congelamiento.
 */

export const COLORS = Object.freeze(['green', 'yellow', 'red', 'not_evaluated']);

/** @type {Readonly<Record<'restricted' | 'frozen', readonly Restriction[]>>} */
export const RESTRICTIONS = Object.freeze({
  restricted: Object.freeze(['no_new_change', 'no_backlog_additions', 'prioritize_run']),
  frozen: Object.freeze(['freeze_all_change', 'all_capacity_to_run']),
});

const SEVERITY = { green: 0, yellow: 1, red: 2 };
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Fecha real del calendario 'YYYY-MM-DD' (rechaza 2026-02-31, 2025-02-29, etc.).
 * @param {unknown} s
 * @returns {s is string}
 */
function isRealDate(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number(m[3]) <= daysInMonth;
}

/**
 * Mes siguiente a 'YYYY-MM' dentro del mismo año. Solo se usa tras comprobar
 * que ambos meses son del mismo trimestre, así que nunca recibe diciembre.
 * @param {string} month
 * @returns {string}
 */
function nextMonth(month) {
  return `${month.slice(0, 4)}-${String(Number(month.slice(5, 7)) + 1).padStart(2, '0')}`;
}

/** @param {unknown} c */
function assertColor(c) {
  if (!COLORS.includes(/** @type {string} */ (c))) {
    throw new TypeError(`Color inválido: ${String(c)}`);
  }
}

/**
 * Color global de la unidad en un mes: el peor de sus indicadores.
 * 'not_evaluated' se ignora; si no hay ninguno evaluado → 'not_evaluated'.
 * @param {Color[]} indicatorColors
 * @returns {Color}
 */
export function unitColor(indicatorColors) {
  if (!Array.isArray(indicatorColors)) throw new TypeError('indicatorColors debe ser un arreglo');
  /** @type {Color} */
  let worst = 'not_evaluated';
  for (const c of indicatorColors) {
    assertColor(c);
    if (c === 'not_evaluated') continue;
    if (worst === 'not_evaluated' || SEVERITY[c] > SEVERITY[worst]) worst = c;
  }
  return worst;
}

/**
 * Trimestre calendario de un mes.
 * @param {string} month 'YYYY-MM'
 * @returns {string} 'YYYY-Qn'
 */
export function quarterOf(month) {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  if (!m) throw new TypeError(`Mes inválido (se espera YYYY-MM): ${String(month)}`);
  return `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
}

/**
 * Valida el historial del trimestre: máximo 3 meses, mismo trimestre, meses
 * consecutivos ascendentes sin huecos, y ningún mes posterior al mes de asOf.
 * @param {MonthColor[]} history
 * @param {string} asOf 'YYYY-MM-DD' ya validado
 */
function validateHistory(history, asOf) {
  if (!Array.isArray(history)) throw new TypeError('history debe ser un arreglo');
  if (history.length > 3) throw new RangeError('history admite como máximo 3 meses (un trimestre)');
  let prev = '';
  let quarter = '';
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') throw new TypeError('Entrada de history inválida');
    const q = quarterOf(entry.month);
    assertColor(entry.color);
    if (quarter && q !== quarter) throw new RangeError('history debe pertenecer a un solo trimestre');
    if (prev && entry.month <= prev) throw new RangeError('history debe estar en orden ascendente sin repetidos');
    if (prev && entry.month !== nextMonth(prev)) {
      throw new RangeError(`history tiene un hueco: falta el mes ${nextMonth(prev)} antes de ${entry.month}`);
    }
    quarter = q;
    prev = entry.month;
  }
  if (prev && prev > asOf.slice(0, 7)) {
    throw new RangeError(`history incluye el mes ${prev}, posterior a la fecha de evaluación ${asOf}`);
  }
}

/**
 * Evalúa el candado de la unidad según el historial del trimestre actual.
 * @param {MonthColor[]} history Meses del trimestre en orden ascendente (máx. 3).
 * @param {EscalationOptions} options
 * @returns {EscalationResult}
 */
export function evaluateEscalation(history, options) {
  const opts = options ?? /** @type {EscalationOptions} */ ({});
  const asOf = opts.asOf;
  if (!isRealDate(asOf)) {
    throw new TypeError('options.asOf es obligatorio y debe ser una fecha real YYYY-MM-DD');
  }
  validateHistory(history, asOf);
  const yellowLikeRed = opts.yellowMonth2EscalatesLikeRed === true;
  const exceptions = opts.activeExceptions ?? [];
  if (!Array.isArray(exceptions)) throw new TypeError('options.activeExceptions debe ser un arreglo');

  /** @type {Exception[]} */
  const valid = [];
  /** @type {string[]} */
  const expiredExceptions = [];
  /** @type {string[]} */
  const revokedExceptions = [];
  for (const ex of exceptions) {
    if (!ex || typeof ex !== 'object') throw new TypeError('Excepción inválida');
    if (typeof ex.id !== 'string' || ex.id.trim() === '') {
      throw new TypeError('Excepción inválida: id debe ser un texto no vacío');
    }
    if (!isRealDate(ex.expiresOn)) {
      throw new TypeError('Excepción inválida: expiresOn debe ser una fecha real YYYY-MM-DD');
    }
    if (ex.scope !== 'change_start' && ex.scope !== 'all') {
      throw new TypeError(`Excepción inválida: scope desconocido ${String(ex.scope)}`);
    }
    const revokedOn = ex.revokedOn ?? null;
    if (revokedOn !== null && !isRealDate(revokedOn)) {
      throw new TypeError('Excepción inválida: revokedOn debe ser null o una fecha real YYYY-MM-DD');
    }
    const changeRef = ex.changeRef ?? null;
    if (changeRef !== null && (typeof changeRef !== 'string' || changeRef.trim() === '')) {
      throw new TypeError('Excepción inválida: changeRef debe ser null o un texto no vacío');
    }
    // Regla única de vigencia/revocación: engine/exceptions.js#exceptionStatus.
    const status = exceptionStatus({ expiresOn: ex.expiresOn, revokedOn }, asOf);
    if (status === 'revoked') revokedExceptions.push(ex.id);
    else if (status === 'active') valid.push(ex);
    else expiredExceptions.push(ex.id);
  }

  // Racha de meses consecutivos fuera de verde al final del historial.
  // 'green' y 'not_evaluated' cortan la racha (reinician el conteo).
  let monthsInBreach = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const c = history[i].color;
    if (c === 'yellow' || c === 'red') monthsInBreach++;
    else break;
  }

  const base = {
    monthsInBreach,
    suppressedRestrictions: /** @type {Restriction[]} */ ([]),
    appliedExceptions: /** @type {string[]} */ ([]),
    expiredExceptions,
    revokedExceptions,
    authorizedStarts: /** @type {AuthorizedStart[]} */ ([]),
  };

  if (monthsInBreach === 0) {
    const last = history.at(-1);
    const reason = !last
      ? 'Sin meses evaluados en el trimestre: operación normal'
      : last.color === 'green'
        ? 'Mes en verde: operación normal'
        : 'Mes sin evaluar: operación normal';
    return { level: 'normal', restrictions: [], reason, ...base };
  }

  const lastColor = history[history.length - 1].color;
  /** @type {'restricted' | 'frozen'} */
  let level;
  let reason;
  if (monthsInBreach === 1) {
    level = 'restricted';
    reason = `Primer mes en ${lastColor === 'red' ? 'rojo' : 'amarillo'}: no se inicia change nuevo ni se agrega al backlog; se continúa lo planeado y se prioriza el RUN`;
  } else {
    const ordinal = monthsInBreach === 2 ? 'Segundo' : 'Tercer';
    if (lastColor === 'red') {
      level = 'frozen';
      reason = `${ordinal} mes consecutivo fuera de verde, en rojo: se frena todo el change y toda la capacidad va al RUN`;
    } else if (yellowLikeRed) {
      level = 'frozen';
      reason = `${ordinal} mes consecutivo fuera de verde, en amarillo (configurado para escalar como rojo): se frena todo el change y toda la capacidad va al RUN`;
    } else {
      level = 'restricted';
      reason = `${ordinal} mes consecutivo fuera de verde, en amarillo: se mantiene la restricción del mes 1 (no se inicia change nuevo)`;
    }
  }

  /** @type {Restriction[]} */
  const restrictions = [...RESTRICTIONS[level]];

  const all = valid.filter((ex) => ex.scope === 'all');
  if (all.length > 0) {
    return {
      level: 'exception',
      restrictions: [],
      reason: `${reason}. Excepción vigente del comité: restricciones suspendidas`,
      ...base,
      suppressedRestrictions: restrictions,
      appliedExceptions: all.map((ex) => ex.id),
    };
  }

  const changeStart = valid.filter((ex) => ex.scope === 'change_start');
  if (changeStart.length > 0 && restrictions.includes('no_new_change')) {
    return {
      level,
      restrictions: restrictions.filter((r) => r !== 'no_new_change'),
      reason: `${reason}. Excepción vigente del comité: se permite iniciar change`,
      ...base,
      suppressedRestrictions: ['no_new_change'],
      appliedExceptions: changeStart.map((ex) => ex.id),
    };
  }

  // ADR 0003: en frozen, change_start es un inicio puntual autorizado; el
  // congelamiento sigue (restricciones y appliedExceptions no cambian).
  if (changeStart.length > 0 && level === 'frozen') {
    /** @type {AuthorizedStart[]} */
    const authorizedStarts = [];
    const seen = new Set();
    for (const ex of changeStart) {
      if (seen.has(ex.id)) continue;
      seen.add(ex.id);
      authorizedStarts.push({ id: ex.id, change_ref: ex.changeRef ?? null });
    }
    return {
      level,
      restrictions,
      reason: `${reason}. Inicio puntual autorizado por el comité: ${authorizedStarts
        .map((a) => a.change_ref ?? a.id)
        .join(', ')}`,
      ...base,
      authorizedStarts,
    };
  }

  return { level, restrictions, reason, ...base };
}

/**
 * Arrastre de cierre de trimestre (caso vulnerabilidades).
 * P0/P1 nuevas de los meses 1 y 2 se suman al paquete; las del mes 3 pasan al siguiente.
 * @param {{ packageTotal: number, resolved: number, newCriticalByMonth: [number, number, number] }} input
 * @returns {{ effectiveTotal: number, pendingCarry: number }}
 */
export function carryOver(input) {
  const { packageTotal, resolved, newCriticalByMonth } = input ?? /** @type {any} */ ({});
  /** @param {unknown} n @param {string} name */
  const check = (n, name) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new TypeError(`${name} debe ser un número finito >= 0`);
    }
  };
  check(packageTotal, 'packageTotal');
  check(resolved, 'resolved');
  if (!Array.isArray(newCriticalByMonth) || newCriticalByMonth.length !== 3) {
    throw new TypeError('newCriticalByMonth debe tener 3 valores [m1, m2, m3]');
  }
  newCriticalByMonth.forEach((n, i) => check(n, `newCriticalByMonth[${i}]`));
  const [m1, m2, m3] = newCriticalByMonth;
  const effectiveTotal = packageTotal + m1 + m2;
  const pendingCarry = Math.max(effectiveTotal - resolved, 0) + m3;
  return { effectiveTotal, pendingCarry };
}

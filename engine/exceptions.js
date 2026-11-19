// Excepciones del comité (C-02) — funciones puras, sin dependencias.
// Las mismas reglas que aplica la BD (migración 20261122120000_exceptions_c02.sql)
// para que el front valide antes de enviar y las Actions clasifiquen sin duplicar.

/** Tope de vigencia en días desde la creación. Igual a private.exception_max_days(). */
export const EXCEPTION_MAX_DAYS = 90;
export const CHANGE_REF_MAX_LEN = 200;
export const REASON_MAX_LEN = 2000;
export const EXCEPTION_SCOPES = Object.freeze(['change_start', 'all']);

import { businessDate } from './dates.js';

const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** @param {unknown} s @returns {s is string} */
export function isDate(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!m) return false;
  const days = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return Number(m[3]) <= days;
}

/**
 * Suma días a una fecha 'YYYY-MM-DD' (calendario, sin zona horaria).
 * @param {string} date
 * @param {number} days entero
 */
export function addDays(date, days) {
  if (!isDate(date)) throw new TypeError(`Fecha inválida: ${String(date)}`);
  if (!Number.isInteger(days)) throw new TypeError('days debe ser entero');
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Último vencimiento permitido para una excepción creada el día `createdOn`.
 * @param {string} createdOn 'YYYY-MM-DD' en America/Guayaquil
 */
export function maxExpiry(createdOn, maxDays = EXCEPTION_MAX_DAYS) {
  return addDays(createdOn, maxDays);
}

/**
 * Estado de una excepción en una fecha.
 * @param {{ expiresOn: string, revokedOn?: string | null }} ex
 * @param {string} asOf 'YYYY-MM-DD'
 * @returns {'active' | 'expired' | 'revoked'}
 */
export function exceptionStatus(ex, asOf) {
  if (!isDate(asOf)) throw new TypeError('asOf debe ser una fecha real YYYY-MM-DD');
  if (!ex || !isDate(ex.expiresOn)) throw new TypeError('expiresOn debe ser una fecha real YYYY-MM-DD');
  const revokedOn = ex.revokedOn ?? null;
  if (revokedOn !== null && !isDate(revokedOn)) throw new TypeError('revokedOn inválido');
  if (revokedOn !== null && revokedOn <= asOf) return 'revoked';
  return ex.expiresOn >= asOf ? 'active' : 'expired';
}

/**
 * Fila de public.exceptions (snake_case, revoked_at timestamptz) -> excepción del motor.
 * La fecha de revocación se toma en America/Guayaquil. Lo usan el front y las Actions.
 * @param {{ id: string, scope: string, expires_on: string, change_ref?: string | null, revoked_at?: string | null }} row
 */
export function exceptionFromRow(row) {
  if (!row || typeof row !== 'object') throw new TypeError('Fila de excepción inválida');
  let revokedOn = null;
  if (row.revoked_at !== null && row.revoked_at !== undefined) {
    const d = new Date(row.revoked_at);
    if (Number.isNaN(d.getTime())) throw new TypeError(`revoked_at inválido: ${String(row.revoked_at)}`);
    revokedOn = businessDate(d);
  }
  return {
    id: row.id,
    scope: row.scope,
    expiresOn: row.expires_on,
    changeRef: row.change_ref ?? null,
    revokedOn,
  };
}

/**
 * Valida el formulario de aprobación. Devuelve los errores por campo (en español).
 * @param {{ unitId?: unknown, scope?: unknown, reason?: unknown, changeRef?: unknown, expiresOn?: unknown }} draft
 * @param {string} today 'YYYY-MM-DD' en America/Guayaquil
 * @returns {{ ok: boolean, errors: Record<string, string>, value: null | {
 *   unitId: string, scope: 'change_start' | 'all', reason: string, changeRef: string | null, expiresOn: string } }}
 */
export function validateExceptionDraft(draft, today, maxDays = EXCEPTION_MAX_DAYS) {
  if (!isDate(today)) throw new TypeError('today debe ser una fecha real YYYY-MM-DD');
  const d = draft ?? {};
  /** @type {Record<string, string>} */
  const errors = {};
  const unitId = typeof d.unitId === 'string' ? d.unitId.trim() : '';
  if (!unitId) errors.unitId = 'Elige la unidad.';
  const scope = d.scope;
  if (!EXCEPTION_SCOPES.includes(/** @type {string} */ (scope))) errors.scope = 'Elige el alcance.';
  const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
  if (!reason) errors.reason = 'El motivo es obligatorio.';
  else if (reason.length > REASON_MAX_LEN) errors.reason = `El motivo admite hasta ${REASON_MAX_LEN} caracteres.`;
  const rawRef = typeof d.changeRef === 'string' ? d.changeRef.trim() : '';
  const changeRef = scope === 'change_start' ? rawRef : '';
  if (scope === 'change_start' && !changeRef) errors.changeRef = 'Indica el change que se autoriza.';
  else if (changeRef.length > CHANGE_REF_MAX_LEN) {
    errors.changeRef = `El change admite hasta ${CHANGE_REF_MAX_LEN} caracteres.`;
  }
  const expiresOn = d.expiresOn;
  const limit = maxExpiry(today, maxDays);
  if (!isDate(expiresOn)) errors.expiresOn = 'Indica una fecha de vencimiento válida.';
  else if (expiresOn < today) errors.expiresOn = 'El vencimiento no puede estar en el pasado.';
  else if (expiresOn > limit) errors.expiresOn = `La vigencia máxima es de ${maxDays} días (hasta ${limit}).`;

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok
      ? {
          unitId,
          scope: /** @type {'change_start' | 'all'} */ (scope),
          reason,
          changeRef: changeRef || null,
          expiresOn: /** @type {string} */ (expiresOn),
        }
      : null,
  };
}

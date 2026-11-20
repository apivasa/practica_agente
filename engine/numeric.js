// Tope numérico compartido (M-13): mismo criterio que la BD (M-09/M-11/M-12),
// que rechaza con 23514 todo valor con |v| >= 2^53 (Number.MAX_SAFE_INTEGER + 1).
// Funciones puras: las usan el motor, el front y las Actions.

/** Límite exclusivo del valor absoluto: 2^53 = 9007199254740992. */
export const SAFE_ABS_LIMIT = Number.MAX_SAFE_INTEGER + 1;

/** Texto del tope para los mensajes de la interfaz. */
export const SAFE_ABS_LIMIT_TEXT = 'menor que 2^53 (9007199254740992) en valor absoluto';

/** true si `v` es un número finito con |v| < 2^53. */
export function isSafeMagnitude(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < SAFE_ABS_LIMIT;
}

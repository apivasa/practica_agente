// Lógica pura de la pantalla de excepciones del comité (sin DOM ni red).
// Las reglas (estado, validación, tope) vienen de engine/; aquí solo se
// adapta la fila de la BD a lo que muestra la vista.
import { exceptionStatus } from '../../engine/exceptions.js';
import { businessDate } from '../../engine/dates.js';

export const SCOPE_LABELS = Object.freeze({
  change_start: 'Inicio puntual de change',
  all: 'Suspende todas las restricciones',
});

export const STATUS_LABELS = Object.freeze({
  active: 'Vigente',
  expired: 'Vencida',
  revoked: 'Revocada',
});

const STATUS_ORDER = { active: 0, expired: 1, revoked: 2 };

export const MSG_FORBIDDEN = 'No tienes permiso para esta acción.';
export const MSG_RULES =
  'La excepción no cumple las reglas: motivo obligatorio, change autorizado para inicio puntual y vigencia máxima de 90 días.';
export const MSG_GENERIC = 'No se pudo completar la operación. Inténtalo de nuevo.';

/** Fecha 'YYYY-MM-DD' de un instante (Date o ISO) en America/Guayaquil (engine/dates.js). */
export function guayaquilDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError('Fecha inválida');
  return businessDate(d);
}

/**
 * Convierte una fila de public.exceptions al formato del motor.
 * @param {{ id: string, scope: string, expires_on: string, change_ref?: string | null, revoked_at?: string | null }} row
 */
export function toEngineException(row) {
  return {
    id: row.id,
    scope: row.scope,
    expiresOn: row.expires_on,
    changeRef: row.change_ref ?? null,
    revokedOn: row.revoked_at ? guayaquilDate(row.revoked_at) : null,
  };
}

/**
 * Filas de la BD -> elementos para la vista, ordenados (vigentes primero,
 * luego por vencimiento más próximo).
 * @param {Array<object>} rows
 * @param {{ today: string, userId: string | null, units: Array<{ id: string, name: string }> }} ctx
 */
export function toListItems(rows, { today, userId, units }) {
  const names = new Map((units ?? []).map((u) => [u.id, u.name]));
  const items = (rows ?? []).map((row) => {
    const status = exceptionStatus(toEngineException(row), today);
    const mine = Boolean(userId) && row.approved_by === userId;
    return {
      id: row.id,
      unitName: names.get(row.unit_id) ?? 'Unidad sin nombre',
      scope: row.scope,
      scopeLabel: SCOPE_LABELS[row.scope] ?? String(row.scope),
      reason: row.reason ?? '',
      changeRef: row.change_ref ?? null,
      expiresOn: row.expires_on,
      status,
      statusLabel: STATUS_LABELS[status],
      approvedByMe: mine,
      revokedOn: row.revoked_at ? guayaquilDate(row.revoked_at) : null,
      canRevoke: mine && status === 'active',
    };
  });
  return items.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.status === 'active' ? a.expiresOn.localeCompare(b.expiresOn) : b.expiresOn.localeCompare(a.expiresOn)) ||
      a.id.localeCompare(b.id),
  );
}

/** Error de PostgREST -> mensaje en español apto para mostrar (nunca el crudo). */
export function mapExceptionError(error) {
  const code = error?.code ?? '';
  if (code === '42501' || error?.status === 401 || error?.status === 403) return MSG_FORBIDDEN;
  if (code === '23514' || code === '23502') return MSG_RULES;
  return MSG_GENERIC;
}

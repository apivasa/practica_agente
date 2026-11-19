// Fechas de negocio del front: reutiliza la del motor (una sola regla).
import { businessDate, BUSINESS_TZ } from '../../engine/index.js';

export { BUSINESS_TZ };

/** Fecha 'YYYY-MM-DD' de hoy en la zona de negocio. */
export function todayInBusinessTz(now = new Date()) {
  return businessDate(now);
}

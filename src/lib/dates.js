// Fechas de negocio en America/Guayaquil (sin DOM ni red).
export const BUSINESS_TZ = 'America/Guayaquil';

/** Fecha 'YYYY-MM-DD' de hoy en la zona de negocio. */
export function todayInBusinessTz(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

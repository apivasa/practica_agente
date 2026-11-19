// Fecha de negocio (America/Guayaquil). Pura: recibe el instante como argumento.
export const BUSINESS_TZ = 'America/Guayaquil';

/** Fecha 'YYYY-MM-DD' del instante `now` en America/Guayaquil (sin librerías). */
export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// C-05: contenido del correo de una alerta (funciones puras, sin red ni DOM).
// El correo repite la alerta de la bandeja del destinatario: solo usa los datos de esa
// fila de `alerts` (tipo, mensaje, unidad, fecha). Todo texto que viene de la BD (nombres
// de unidades o indicadores dentro del mensaje) se trata como texto plano y se escapa en
// la versión HTML.

/** Etiquetas de los tipos de alerta (una sola fuente: el front las reexporta). */
export const ALERT_KIND_LABELS = Object.freeze({
  color_change: 'Cambio de color',
  pace_behind: 'Atraso frente al ritmo',
  critical_intake: 'Ingreso de P0/P1',
  exception_expired: 'Vencimiento de excepción',
});

export const EMAIL_SUBJECT_MAX = 160;
export const EMAIL_MESSAGE_MAX = 2000;
const UNIT_MAX = 120;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Etiqueta en español del tipo de alerta; un tipo desconocido se devuelve como texto. */
export const alertKindLabel = (k) =>
  typeof k === 'string' && own(ALERT_KIND_LABELS, k) ? ALERT_KIND_LABELS[k] : String(k ?? '—');

/** Escapa texto para insertarlo en HTML (contenido y atributos entre comillas). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Caracteres de control (incluye CR/LF), separadores de línea Unicode y marcas bidi.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Texto plano de una sola línea: sin caracteres de control, espacios colapsados y recortado.
 * @param {unknown} value
 * @param {number} max
 */
export function plainText(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const s = String(value).replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** URL https sin credenciales, o null. */
export function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return u.href;
}

/** 'YYYY-MM-DD HH:MM' (UTC) desde un timestamp ISO, o ''. */
function shortDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? `${v.slice(0, 16).replace('T', ' ')} UTC` : '';
}

/**
 * Correo de una alerta para su destinatario.
 * @param {{ kind?: string, payload?: any, sent_at?: string }} alert fila de `alerts`
 * @param {{ appUrl?: string|null }} [options]
 * @returns {{ subject: string, text: string, html: string }}
 */
export function formatAlertEmail(alert, { appUrl = null } = {}) {
  const payload = alert?.payload && typeof alert.payload === 'object' && !Array.isArray(alert.payload) ? alert.payload : {};
  const kind = plainText(alertKindLabel(alert?.kind), 80) || 'Alerta';
  const unit = plainText(payload.unit_name, UNIT_MAX);
  const message = plainText(payload.message, EMAIL_MESSAGE_MAX) || kind;
  const high = payload.severity === 'high';
  const date = shortDate(alert?.sent_at);
  const url = safeHttpsUrl(appUrl);

  const subject = plainText(`${high ? '[Urgente] ' : ''}${kind}${unit ? ` - ${unit}` : ''}`, EMAIL_SUBJECT_MAX);
  const fields = [['Tipo', kind]];
  if (unit) fields.push(['Unidad', unit]);
  if (date) fields.push(['Fecha', date]);
  const footer = 'Este correo repite una alerta de tu bandeja en la app de control de capacidad RUN.';

  const text = [
    message,
    '',
    ...fields.map(([k, v]) => `${k}: ${v}`),
    ...(url ? ['', `Ver en la app: ${url}`] : []),
    '',
    footer,
  ].join('\n');

  const html = [
    '<!doctype html><html lang="es"><body>',
    `<p>${high ? '<strong>Urgente.</strong> ' : ''}${escapeHtml(message)}</p>`,
    '<ul>',
    ...fields.map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`),
    '</ul>',
    url ? `<p><a href="${escapeHtml(url)}">Ver en la app</a></p>` : '',
    `<p>${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('');

  return { subject, text, html };
}

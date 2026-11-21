// C-05: envío por correo (Resend) de las alertas de la tabla `alerts`.
// Cada alerta es de un solo destinatario: se envía un correo a ese destinatario con solo
// los datos de esa alerta (engine/alert-email.js). Idempotente: una alerta con emailed_at
// no se vuelve a enviar, y la petición a Resend lleva Idempotency-Key = id de la alerta.
// Los errores de Resend no detienen el resto: quedan en audit_log y en el log del job.
import { formatAlertEmail, safeHttpsUrl, plainText } from '../../engine/index.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const DEFAULT_FROM = 'onboarding@resend.dev';
export const EMAIL_ACTOR = 'system:alert-email';
export const MAX_ATTEMPTS = 3;
export const DEFAULT_LOOKBACK_DAYS = 7;
const REQUEST_TIMEOUT_MS = 15000;
const PAUSE_MS = 600; // Resend limita las peticiones por segundo.
const ERROR_MAX = 300;

const EMAIL_RE = /^[^\s<>@"',;()[\]\\]+@[^\s<>@"',;()[\]\\]+\.[^\s<>@"',;()[\]\\]+$/;
const NAME_RE = /^[^<>"\\\u0000-\u001f\u007f]{1,80}$/; // eslint-disable-line no-control-regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** true si es una dirección de correo simple (sin nombre ni separadores). */
export const isEmailAddress = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

/** Remitente válido: `correo` o `Nombre <correo>`. */
export function isValidFrom(v) {
  if (typeof v !== 'string' || /[\u0000-\u001f\u007f]/.test(v)) return false; // eslint-disable-line no-control-regex
  const m = v.match(/^(.*?) *<([^<>]+)>$/);
  if (!m) return isEmailAddress(v);
  return NAME_RE.test(m[1].trim()) && isEmailAddress(m[2]);
}

/**
 * Configuración del envío desde el entorno. Sin RESEND_API_KEY devuelve enabled = false
 * (el paso no falla). Nunca devuelve la clave en mensajes.
 * @param {Record<string, string | undefined>} env
 */
export function readEmailConfig(env) {
  const apiKey = (env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) return { enabled: false, reason: 'Falta el secreto RESEND_API_KEY' };
  if (!/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey)) throw new Error('RESEND_API_KEY no tiene el formato de una clave de Resend (re_...)');
  const from = (env.ALERT_EMAIL_FROM ?? '').trim() || DEFAULT_FROM;
  if (!isValidFrom(from)) throw new Error('ALERT_EMAIL_FROM no es un remitente válido (correo o "Nombre <correo>")');
  const rawUrl = (env.APP_URL ?? '').trim();
  const appUrl = rawUrl ? safeHttpsUrl(rawUrl) : null;
  if (rawUrl && !appUrl) throw new Error('APP_URL debe ser una URL https');
  const rawDays = (env.ALERT_EMAIL_LOOKBACK_DAYS ?? '').trim();
  const lookbackDays = rawDays ? Number(rawDays) : DEFAULT_LOOKBACK_DAYS;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 31) {
    throw new Error('ALERT_EMAIL_LOOKBACK_DAYS debe ser un entero entre 1 y 31');
  }
  return { enabled: true, apiKey, from, appUrl, lookbackDays };
}

/**
 * Texto de error apto para log y auditoría: una línea, recortado, sin la clave ni correos.
 * @param {unknown} value
 * @param {string} apiKey
 */
export function sanitizeError(value, apiKey = '') {
  let s = value instanceof Error ? value.message : String(value ?? '');
  if (apiKey) s = s.split(apiKey).join('[clave]');
  s = s.replace(/re_[A-Za-z0-9_-]{8,}/g, '[clave]').replace(/[^\s<>@"',;()]+@[^\s<>@"',;()]+/g, '[correo]');
  return plainText(s, ERROR_MAX) || 'error desconocido';
}

/** Mensaje de error de una respuesta no 2xx de Resend. */
async function responseError(res) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = typeof j?.message === 'string' ? j.message : typeof j?.name === 'string' ? j.name : '';
    } catch {
      detail = body;
    }
  } catch {
    detail = '';
  }
  return `HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
}

/**
 * @typedef {Object} EmailDb
 * @property {(q: { since: string, maxAttempts: number }) => Promise<any[]>} pendingEmailAlerts
 * @property {(userId: string) => Promise<string|null>} userEmail
 * @property {(id: string, v: { emailedAt: string, attempts: number }) => Promise<boolean>} markAlertEmailed
 * @property {(id: string, v: { attempts: number }) => Promise<void>} recordAlertEmailFailure
 * @property {(rows: any[]) => Promise<void>} insertAudit
 */

/**
 * Envía los correos pendientes. Errores de Resend (o de destinatario sin correo) se
 * registran y no detienen el resto; errores de la BD van a `errors`.
 * @param {EmailDb} db
 * @param {{ config: { apiKey: string, from: string, appUrl: string|null, lookbackDays: number },
 *   fetchImpl: typeof fetch, now?: () => Date, sleep?: (ms: number) => Promise<void>,
 *   log?: (msg: string) => void, maxAttempts?: number }} options
 */
export async function sendAlertEmails(db, { config, fetchImpl, now = () => new Date(), sleep, log = () => {}, maxAttempts = MAX_ATTEMPTS }) {
  const pause = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const since = new Date(now().getTime() - config.lookbackDays * 86400000).toISOString();
  const pending = await db.pendingEmailAlerts({ since, maxAttempts });
  const emails = new Map();
  const summary = { pending: pending.length, sent: 0, failed: 0, skipped: 0, failures: [], errors: [] };
  let first = true;

  for (const alert of pending) {
    const attempts = (Number(alert.email_attempts) || 0) + 1;
    const base = { kind: alert.kind, unit_id: alert.unit_id, recipient_user_id: alert.recipient_user_id, attempt: attempts };
    const fail = async (reason, extra = {}) => {
      const error = sanitizeError(reason, config.apiKey);
      summary.failed += 1;
      summary.failures.push({ alert_id: alert.id, error });
      log(`alerta ${alert.id}: no se envió (${error})`);
      await db.recordAlertEmailFailure(alert.id, { attempts });
      await db.insertAudit([
        { actor: EMAIL_ACTOR, action: 'alert_email_failed', entity: 'alerts', entity_id: alert.id, details: { ...base, ...extra, error } },
      ]);
    };
    try {
      if (typeof alert.recipient_user_id !== 'string' || !UUID_RE.test(alert.recipient_user_id)) {
        await fail('destinatario inválido');
        continue;
      }
      let to = emails.get(alert.recipient_user_id);
      if (to === undefined) {
        try {
          to = (await db.userEmail(alert.recipient_user_id)) ?? null;
        } catch (err) {
          await fail(`no se pudo leer el correo del destinatario: ${sanitizeError(err, config.apiKey)}`);
          continue;
        }
        emails.set(alert.recipient_user_id, to);
      }
      if (!isEmailAddress(to)) {
        await fail('el destinatario no tiene un correo válido');
        continue;
      }
      const mail = formatAlertEmail(alert, { appUrl: config.appUrl });
      if (!first) await pause(PAUSE_MS);
      first = false;
      let res;
      try {
        res = await fetchImpl(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `alert-email-${alert.id}`,
          },
          body: JSON.stringify({ from: config.from, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        await fail(`Resend no respondió: ${sanitizeError(err, config.apiKey)}`);
        continue;
      }
      if (!res.ok) {
        await fail(`Resend rechazó el envío: ${await responseError(res)}`, { status: res.status });
        continue;
      }
      let providerId = null;
      try {
        const j = await res.json();
        providerId = typeof j?.id === 'string' ? plainText(j.id, 100) : null;
      } catch {
        providerId = null;
      }
      const marked = await db.markAlertEmailed(alert.id, { emailedAt: now().toISOString(), attempts });
      if (!marked) {
        // Otra corrida la marcó antes: Resend descarta el duplicado por Idempotency-Key.
        summary.skipped += 1;
        continue;
      }
      summary.sent += 1;
      log(`alerta ${alert.id}: correo enviado`);
      await db.insertAudit([
        { actor: EMAIL_ACTOR, action: 'alert_emailed', entity: 'alerts', entity_id: alert.id, details: { ...base, provider: 'resend', provider_id: providerId } },
      ]);
    } catch (err) {
      summary.errors.push(`alerta ${alert.id}: ${sanitizeError(err, config.apiKey)}`);
    }
  }
  return summary;
}

/**
 * Punto de entrada del paso de Actions (scripts/send-alert-emails.js).
 * Sin RESEND_API_KEY: anota ::notice:: y termina con 0. Fallos de Resend: ::warning:: y 0.
 * Configuración inválida: 2. Errores de la BD: 1.
 * @param {{ env: Record<string, string|undefined>, fetchImpl: typeof fetch,
 *   makeDb: (supabase: { url: string, secretKey: string }) => Promise<EmailDb>,
 *   readSupabaseConfig: (env: any) => { url: string, secretKey: string },
 *   log?: (msg: string) => void, now?: () => Date, sleep?: (ms: number) => Promise<void> }} deps
 */
export async function runEmailStep({ env, fetchImpl, makeDb, readSupabaseConfig, log = console.log, now, sleep }) {
  let config;
  let supabase;
  try {
    config = readEmailConfig(env);
    if (!config.enabled) {
      log(`::notice::${config.reason}: no se envían correos de alertas (la bandeja de la app sigue funcionando).`);
      return { code: 0, summary: null };
    }
    supabase = readSupabaseConfig(env);
  } catch (err) {
    log(`::error::Error de configuración del correo: ${sanitizeError(err, (env.RESEND_API_KEY ?? '').trim())}`);
    return { code: 2, summary: null };
  }
  const db = await makeDb(supabase);
  const summary = await sendAlertEmails(db, { config, fetchImpl, now, sleep, log: (m) => log(`  ${m}`) });
  for (const f of summary.failures) log(`::warning::Correo de la alerta ${f.alert_id} no enviado: ${f.error}`);
  for (const e of summary.errors) log(`::error::${e}`);
  log(JSON.stringify({ pending: summary.pending, sent: summary.sent, failed: summary.failed, skipped: summary.skipped, errors: summary.errors.length }));
  return { code: summary.errors.length > 0 ? 1 : 0, summary };
}

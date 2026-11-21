// C-05: envío por correo (Resend) de las alertas de la tabla `alerts`.
// Cada alerta es de un solo destinatario: se envía un correo a ese destinatario con solo
// los datos de esa alerta (engine/alert-email.js). Idempotente: una alerta con emailed_at
// no se vuelve a enviar, y la petición a Resend lleva Idempotency-Key = id de la alerta.
// Los errores de Resend no detienen el resto: quedan en audit_log y en el log del job.
// C-06: antes de enviar se comprueba que el destinatario sigue con rol vigente para la
// unidad de la alerta y que su cuenta no está bloqueada; si no, la alerta se marca como
// omitida (email_skipped_at) y se audita `alert_email_skipped`. Las alertas que salen de
// la ventana sin haberse enviado también se marcan y auditan (motivo `expired`).
import { formatAlertEmail, safeHttpsUrl, plainText } from '../../engine/index.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const DEFAULT_FROM = 'onboarding@resend.dev';
export const EMAIL_ACTOR = 'system:alert-email';
export const MAX_ATTEMPTS = 3;
export const DEFAULT_LOOKBACK_DAYS = 7;
/** C-06 (H-ARQ-C05-04): mismo valor por defecto que salud.yml (DEFAULT_PAGES_URL). */
export const DEFAULT_APP_URL = 'https://apivasa.github.io/practica_agente/';
/** Motivos de omisión (mismos valores que el check de alerts.email_skip_reason). */
export const SKIP_REASONS = Object.freeze({
  expired: 'expired',
  missing: 'recipient_missing',
  banned: 'recipient_banned',
  noRole: 'recipient_no_role',
});
/** Tope de alertas vencidas que se marcan por corrida (el resto, en la siguiente). */
export const EXPIRED_BATCH = 500;
/** Estados HTTP de Resend que indican un problema de configuración (clave o remitente). */
const AUTH_STATUSES = new Set([401, 403]);
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
  const rawUrl = (env.APP_URL ?? '').trim() || DEFAULT_APP_URL;
  const appUrl = safeHttpsUrl(rawUrl);
  if (!appUrl) throw new Error('APP_URL debe ser una URL https');
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
  // C-06 (H-C05-02): también la clave secreta de Supabase y cualquier JWT (eyJ...).
  s = s
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[clave]')
    .replace(/eyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*){0,2}/g, '[token]');
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
 * C-06 (H-C05-01): motivo para no enviar el correo de una alerta, o null si el destinatario
 * sigue siendo válido. Mismo criterio que eligió a los destinatarios (recipientsFor en
 * scripts/lib/alerts.js): líder de la unidad de la alerta o miembro del comité.
 * @param {{ unit_id?: string|null }} alert
 * @param {{ email?: string|null, bannedUntil?: string|null, deletedAt?: string|null,
 *   roles?: { role: string, unit_id: string|null }[] } | null} access
 * @param {Date} now
 * @returns {string|null}
 */
export function recipientSkipReason(alert, access, now) {
  if (!access || typeof access !== 'object' || access.deletedAt) return SKIP_REASONS.missing;
  if (access.bannedUntil) {
    const until = Date.parse(access.bannedUntil);
    // Una fecha ilegible se trata como bloqueo (ante la duda, no se envía).
    if (!Number.isFinite(until) || until > now.getTime()) return SKIP_REASONS.banned;
  }
  const roles = Array.isArray(access.roles) ? access.roles : [];
  const unitId = alert?.unit_id ?? null;
  const valid = roles.some(
    (r) => r?.role === 'committee' || (r?.role === 'unit_leader' && unitId !== null && r.unit_id === unitId),
  );
  return valid ? null : SKIP_REASONS.noRole;
}

/**
 * @typedef {Object} EmailDb
 * @property {(q: { since: string, maxAttempts: number }) => Promise<any[]>} pendingEmailAlerts
 * @property {(userId: string) => Promise<string|null>} userEmail
 * @property {(id: string, v: { emailedAt: string, attempts: number }) => Promise<boolean>} markAlertEmailed
 * @property {(id: string, v: { attempts: number }) => Promise<void>} recordAlertEmailFailure
 * @property {(rows: any[]) => Promise<void>} insertAudit
 * @property {(userId: string) => Promise<{ email: string|null, bannedUntil: string|null,
 *   deletedAt: string|null, roles: { role: string, unit_id: string|null }[] } | null>} [recipientAccess]
 *   C-06: correo, bloqueo y roles del destinatario (null si el usuario ya no existe).
 * @property {(q: { before: string, maxAttempts: number, limit: number }) => Promise<any[]>} [expiredEmailAlerts]
 *   C-06: alertas sin correo ni omisión cuyo sent_at quedó fuera de la ventana.
 * @property {(ids: string[], v: { skippedAt: string, reason: string }) => Promise<string[]>} [markAlertsEmailSkipped]
 *   C-06: marca condicional (sin emailed_at ni email_skipped_at); devuelve los ids marcados.
 * @property {(ids: string[], v: { before: string, maxAttempts: number, skippedAt: string,
 *   lookbackDays: number }) => Promise<string[]>} [markAlertsEmailExpired]
 *   F-12: marca `expired` y audita en una sola transacción (RPC); devuelve los ids marcados.
 *   F-13: es la única ruta para `expired`; sin ella sendAlertEmails no marca vencidas
 *   (registra un error) y runEmailStep falla cerrado.
 *
 * Los métodos opcionales lo son solo para sendAlertEmails con BD simuladas; la capa real
 * (scripts/lib/db.js) los implementa siempre y runEmailStep los exige todos
 * (REQUIRED_EMAIL_DB_METHODS).
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
  const access = new Map();
  const summary = { pending: pending.length, sent: 0, failed: 0, skipped: 0, notEligible: 0, expired: 0, failures: [], errors: [] };
  let first = true;
  const canSkip = typeof db.markAlertsEmailSkipped === 'function';
  const useAccess = typeof db.recipientAccess === 'function' && canSkip;

  // QA-C05-1: las alertas que salen de la ventana sin correo quedan marcadas y auditadas.
  // F-13 (H-F12-01): solo por la RPC atómica (marca y auditoría en una transacción). Sin
  // ella no se marca nada: no existe ruta no atómica (markAlertsEmailSkipped + insertAudit).
  if (typeof db.expiredEmailAlerts === 'function') {
    try {
      if (typeof db.markAlertsEmailExpired !== 'function') {
        throw new Error('la BD no implementa markAlertsEmailExpired: no se marcan alertas vencidas sin la RPC atómica');
      }
      const old = (await db.expiredEmailAlerts({ before: since, maxAttempts, limit: EXPIRED_BATCH })) ?? [];
      const ids = old.map((a) => a?.id).filter((id) => typeof id === 'string');
      if (ids.length > 0) {
        // F-12 (H-ARQ-C06-04): si la RPC falla, no queda ninguna alerta marcada sin su
        // fila en audit_log.
        const marked = (await db.markAlertsEmailExpired(ids, {
          before: since,
          maxAttempts,
          skippedAt: now().toISOString(),
          lookbackDays: config.lookbackDays,
        })) ?? [];
        summary.expired = marked.length;
        if (marked.length > 0) log(`${marked.length} alerta(s) fuera de la ventana de ${config.lookbackDays} días: omitidas y auditadas`);
      }
    } catch (err) {
      summary.errors.push(`alertas fuera de la ventana: ${sanitizeError(err, config.apiKey)}`);
    }
  }

  for (const alert of pending) {
    const attempts = (Number(alert.email_attempts) || 0) + 1;
    const base = { kind: alert.kind, unit_id: alert.unit_id, recipient_user_id: alert.recipient_user_id, attempt: attempts };
    const fail = async (reason, extra = {}) => {
      const error = sanitizeError(reason, config.apiKey);
      summary.failed += 1;
      summary.failures.push({ alert_id: alert.id, error, status: Number.isInteger(extra.status) ? extra.status : null });
      log(`alerta ${alert.id}: no se envió (${error})`);
      await db.recordAlertEmailFailure(alert.id, { attempts });
      await db.insertAudit([
        { actor: EMAIL_ACTOR, action: 'alert_email_failed', entity: 'alerts', entity_id: alert.id, details: { ...base, ...extra, error } },
      ]);
    };
    // C-06: destinatario sin rol vigente, bloqueado o inexistente: no se envía ni se reintenta.
    const skip = async (reason) => {
      const marked = (await db.markAlertsEmailSkipped([alert.id], { skippedAt: now().toISOString(), reason })) ?? [];
      if (!marked.includes(alert.id)) {
        summary.skipped += 1; // otra corrida la resolvió antes
        return;
      }
      summary.notEligible += 1;
      log(`alerta ${alert.id}: correo omitido (${reason})`);
      await db.insertAudit([
        {
          actor: EMAIL_ACTOR,
          action: 'alert_email_skipped',
          entity: 'alerts',
          entity_id: alert.id,
          details: { kind: alert.kind, unit_id: alert.unit_id, recipient_user_id: alert.recipient_user_id, reason },
        },
      ]);
    };
    try {
      if (typeof alert.recipient_user_id !== 'string' || !UUID_RE.test(alert.recipient_user_id)) {
        await fail('destinatario inválido');
        continue;
      }
      let to;
      if (useAccess) {
        let info = access.get(alert.recipient_user_id);
        if (info === undefined) {
          try {
            info = (await db.recipientAccess(alert.recipient_user_id)) ?? null;
          } catch (err) {
            await fail(`no se pudo leer el destinatario: ${sanitizeError(err, config.apiKey)}`);
            continue;
          }
          access.set(alert.recipient_user_id, info);
        }
        const reason = recipientSkipReason(alert, info, now());
        if (reason) {
          await skip(reason);
          continue;
        }
        to = info.email ?? null;
      } else {
        to = emails.get(alert.recipient_user_id);
      }
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
 * Sin RESEND_API_KEY: anota ::notice:: y termina con 0. Fallos de Resend: ::warning:: y 0,
 * salvo que ningún correo salga y todos los fallos sean 401/403 (clave revocada o remitente
 * no verificado, H-ARQ-C05-02): entonces 1, para que salud.yml lo vea.
 * Configuración inválida: 2. BD sin recipientAccess, expiredEmailAlerts,
 * markAlertsEmailSkipped (F-11, H-C06-01) o markAlertsEmailExpired (F-13, H-F12-01): 2 sin
 * enviar nada. Errores de la BD: 1.
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
  // F-11 (H-C06-01): fail-closed. Sin los métodos de C-06 no se puede comprobar rol ni
  // bloqueo del destinatario: no se envía nada.
  const missing = missingEmailDbMethods(db);
  if (missing.length > 0) {
    log(`::error::La capa de BD no implementa ${missing.join(', ')}: no se envían correos sin comprobar rol y bloqueo del destinatario.`);
    return { code: 2, summary: null };
  }
  // F-13 (H-F12-01): sin la RPC atómica no se marcan vencidas: tampoco se envía nada.
  const missingF12 = REQUIRED_F12_DB_METHODS.filter((m) => typeof (/** @type {any} */ (db))[m] !== 'function');
  if (missingF12.length > 0) {
    log(`::error::La capa de BD no implementa ${missingF12.join(', ')}: no se marcan alertas vencidas sin la RPC atómica ni se envían correos.`);
    return { code: 2, summary: null };
  }
  const summary = await sendAlertEmails(db, { config, fetchImpl, now, sleep, log: (m) => log(`  ${m}`) });
  for (const f of summary.failures) log(`::warning::Correo de la alerta ${f.alert_id} no enviado: ${f.error}`);
  for (const e of summary.errors) log(`::error::${e}`);
  const authFailure = allAuthFailures(summary);
  if (authFailure) {
    log('::error::Resend rechazó todos los envíos con 401/403: revisar RESEND_API_KEY y que ALERT_EMAIL_FROM use un dominio verificado (docs/operacion.md).');
  }
  log(
    JSON.stringify({
      pending: summary.pending,
      sent: summary.sent,
      failed: summary.failed,
      skipped: summary.skipped,
      not_eligible: summary.notEligible,
      expired: summary.expired,
      errors: summary.errors.length,
    }),
  );
  return { code: summary.errors.length > 0 || authFailure ? 1 : 0, summary };
}

/** Métodos de C-06 que runEmailStep exige a la BD (H-C06-01). */
export const REQUIRED_C06_DB_METHODS = Object.freeze(['recipientAccess', 'expiredEmailAlerts', 'markAlertsEmailSkipped']);
/** F-13 (H-F12-01): método de F-12 que runEmailStep también exige (RPC atómica de `expired`). */
export const REQUIRED_F12_DB_METHODS = Object.freeze(['markAlertsEmailExpired']);
/** Todo lo que runEmailStep exige a la BD. */
export const REQUIRED_EMAIL_DB_METHODS = Object.freeze([...REQUIRED_C06_DB_METHODS, ...REQUIRED_F12_DB_METHODS]);

/**
 * Nombres de los métodos de C-06 que la BD no implementa (vacío si están todos).
 * @param {unknown} db
 * @returns {string[]}
 */
export function missingEmailDbMethods(db) {
  return REQUIRED_C06_DB_METHODS.filter((m) => !db || typeof (/** @type {any} */ (db))[m] !== 'function');
}

/**
 * true si hubo fallos, ningún envío y todos los fallos fueron 401 o 403 de Resend
 * (un problema de configuración, no uno puntual).
 * @param {{ sent: number, failed: number, failures: { status?: number|null }[] }} summary
 */
export function allAuthFailures(summary) {
  return (
    summary.sent === 0 &&
    summary.failed > 0 &&
    summary.failures.length === summary.failed &&
    summary.failures.every((f) => AUTH_STATUSES.has(f.status))
  );
}

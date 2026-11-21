// C-06: endurecimiento del correo de alertas (hallazgos de C-05).
//   H-C05-01      destinatario sin rol vigente, bloqueado o inexistente: no se envía; alert_email_skipped
//   H-C05-02      sanitizeError redacta sb_secret_... y JWT
//   H-ARQ-C05-02  exit 1 si todos los envíos fallan por 401/403
//   H-ARQ-C05-04  APP_URL con valor por defecto
//   QA-C05-1      alertas que salen de la ventana sin enviarse: marcadas y auditadas
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendAlertEmails,
  runEmailStep,
  readEmailConfig,
  sanitizeError,
  recipientSkipReason,
  allAuthFailures,
  DEFAULT_APP_URL,
  EMAIL_ACTOR,
  SKIP_REASONS,
  MAX_ATTEMPTS,
} from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';
import { withExpiredRpc } from './expired-rpc-fake.js';

const KEY = 're_C06TESTKEY_do_not_leak_1234';
const NOW = new Date('2027-03-10T12:00:00Z');
const DAY = 86400000;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const U1 = '11111111-0000-4000-8000-0000000000c1';
const U2 = '11111111-0000-4000-8000-0000000000c2';
const L1 = '22222222-0000-4000-8000-0000000000c1';
const L2 = '22222222-0000-4000-8000-0000000000c2';
const CM = '22222222-0000-4000-8000-0000000000c3';
const CONFIG = { apiKey: KEY, from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };

const USERS = {
  [L1]: { email: 'lider1@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: U1 }] },
  [L2]: { email: 'lider2@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: U2 }] },
  [CM]: { email: 'comite@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'committee', unit_id: null }] },
};

const row = (id, unit, recipient, extra = {}) => ({
  id,
  unit_id: unit,
  recipient_user_id: recipient,
  kind: 'color_change',
  payload: { unit_name: 'Unidad', message: 'Unidad: el color pasó a rojo.' },
  sent_at: ago(3600_000),
  emailed_at: null,
  email_attempts: 0,
  email_skipped_at: null,
  email_skip_reason: null,
  ...extra,
});

/**
 * BD en memoria con el contrato EmailDb completo (C-05 + C-06 + F-12). F-13 (H-F12-01): la
 * ruta `expired` solo existe por la RPC atómica; la simulada marca y audita como la real.
 */
function fakeDb(alerts, { users = USERS, accessError = null } = {}) {
  const t = { alerts: structuredClone(alerts), audit_log: [] };
  const lookups = [];
  const open = (a) => a.emailed_at === null && a.email_skipped_at === null;
  return withExpiredRpc({
    t,
    lookups,
    async pendingEmailAlerts({ since, maxAttempts }) {
      return structuredClone(t.alerts.filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at >= since));
    },
    async expiredEmailAlerts({ before, maxAttempts, limit }) {
      return structuredClone(t.alerts.filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at < before).slice(0, limit));
    },
    async userEmail() {
      throw new Error('con recipientAccess no se usa userEmail');
    },
    async recipientAccess(id) {
      lookups.push(id);
      if (accessError) throw accessError;
      return structuredClone(users[id] ?? null);
    },
    async markAlertsEmailSkipped(ids, { skippedAt, reason }) {
      const out = [];
      for (const a of t.alerts) {
        if (ids.includes(a.id) && open(a)) {
          a.email_skipped_at = skippedAt;
          a.email_skip_reason = reason;
          out.push(a.id);
        }
      }
      return out;
    },
    async markAlertEmailed(id, { emailedAt, attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (!a || !open(a)) return false;
      a.emailed_at = emailedAt;
      a.email_attempts = attempts;
      return true;
    },
    async recordAlertEmailFailure(id, { attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (a && open(a)) a.email_attempts = attempts;
    },
    async insertAudit(rows) {
      t.audit_log.push(...structuredClone(rows));
    },
  });
}

function fakeResend(respond = () => ({ status: 200, body: { id: 'msg' } })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    const r = respond(call, calls.length);
    const text = JSON.stringify(r.body ?? {});
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text, json: async () => JSON.parse(text) };
  };
  return { calls, fetchImpl };
}

const opts = (fetchImpl, extra = {}) => ({ config: CONFIG, fetchImpl, now: () => NOW, sleep: async () => {}, ...extra });
const skippedAudits = (db) => db.t.audit_log.filter((r) => r.action === 'alert_email_skipped');

describe('C-06 recipientSkipReason (pura)', () => {
  const ok = (roles, extra = {}) => ({ email: 'x@example.test', bannedUntil: null, deletedAt: null, roles, ...extra });
  test('comité y líder de la misma unidad: válidos', () => {
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok([{ role: 'committee', unit_id: null }]), NOW), null);
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok([{ role: 'unit_leader', unit_id: U1 }]), NOW), null);
  });
  test('perdió el rol o cambió de unidad: recipient_no_role', () => {
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok([]), NOW), SKIP_REASONS.noRole);
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok([{ role: 'unit_leader', unit_id: U2 }]), NOW), SKIP_REASONS.noRole);
    // Otros roles no eran destinatarios (recipientsFor): gestora y custodio no cuentan.
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok([{ role: 'kpi_manager', unit_id: null }, { role: 'custodian', unit_id: null }]), NOW), SKIP_REASONS.noRole);
    assert.equal(recipientSkipReason({ unit_id: null }, ok([{ role: 'unit_leader', unit_id: U1 }]), NOW), SKIP_REASONS.noRole);
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok(undefined), NOW), SKIP_REASONS.noRole);
  });
  test('usuario inexistente o borrado: recipient_missing', () => {
    assert.equal(recipientSkipReason({ unit_id: U1 }, null, NOW), SKIP_REASONS.missing);
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok([{ role: 'committee' }], { deletedAt: '2027-03-01T00:00:00Z' }), NOW), SKIP_REASONS.missing);
  });
  test('bloqueado en Auth: recipient_banned; un bloqueo vencido no impide el envío', () => {
    const roles = [{ role: 'committee', unit_id: null }];
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok(roles, { bannedUntil: '2127-01-01T00:00:00Z' }), NOW), SKIP_REASONS.banned);
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok(roles, { bannedUntil: 'no-es-fecha' }), NOW), SKIP_REASONS.banned);
    assert.equal(recipientSkipReason({ unit_id: U1 }, ok(roles, { bannedUntil: '2027-03-01T00:00:00Z' }), NOW), null);
  });
});

describe('C-06 H-C05-01 destinatario no vigente', () => {
  test('perdió el rol de la unidad: no se envía, se marca y se audita alert_email_skipped', async () => {
    const users = { ...USERS, [L1]: { ...USERS[L1], roles: [{ role: 'unit_leader', unit_id: U2 }] } };
    const db = fakeDb([row('a-l1', U1, L1), row('a-cm', U1, CM)], { users });
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.sent, 1);
    assert.equal(s.notEligible, 1);
    assert.equal(s.failed, 0);
    assert.deepEqual(calls.map((c) => c.body.to[0]), ['comite@example.test']);
    const a = db.t.alerts.find((x) => x.id === 'a-l1');
    assert.equal(a.emailed_at, null);
    assert.equal(a.email_skipped_at, NOW.toISOString());
    assert.equal(a.email_skip_reason, 'recipient_no_role');
    assert.equal(a.email_attempts, 0, 'omitir no gasta intentos');
    const audits = skippedAudits(db);
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0], {
      actor: EMAIL_ACTOR,
      action: 'alert_email_skipped',
      entity: 'alerts',
      entity_id: 'a-l1',
      details: { kind: 'color_change', unit_id: U1, recipient_user_id: L1, reason: 'recipient_no_role' },
    });
    assert.doesNotMatch(JSON.stringify(db.t.audit_log), /@example\.test/);
  });

  test('no se reintenta: la corrida siguiente no la vuelve a mirar ni a auditar', async () => {
    const users = { ...USERS, [L1]: { ...USERS[L1], roles: [] } };
    const db = fakeDb([row('a-l1', U1, L1)], { users });
    const { calls, fetchImpl } = fakeResend();
    await sendAlertEmails(db, opts(fetchImpl));
    const second = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(second.pending, 0);
    assert.equal(calls.length, 0);
    assert.equal(skippedAudits(db).length, 1);
    assert.equal(db.lookups.length, 1);
  });

  test('cuenta bloqueada (banned_until futuro): recipient_banned, sin llamada a Resend', async () => {
    const users = { ...USERS, [CM]: { ...USERS[CM], bannedUntil: '2127-01-01T00:00:00Z' } };
    const db = fakeDb([row('a-cm', U1, CM)], { users });
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(calls.length, 0);
    assert.equal(s.notEligible, 1);
    assert.equal(skippedAudits(db)[0].details.reason, 'recipient_banned');
  });

  test('usuario inexistente: recipient_missing', async () => {
    const db = fakeDb([row('a-x', U1, '22222222-0000-4000-8000-0000000000ff')]);
    const { calls, fetchImpl } = fakeResend();
    await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(calls.length, 0);
    assert.equal(skippedAudits(db)[0].details.reason, 'recipient_missing');
  });

  test('una consulta por destinatario aunque tenga varias alertas', async () => {
    const db = fakeDb([row('a-1', U1, CM), row('a-2', U2, CM), row('a-3', U1, L1)]);
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.sent, 3);
    assert.deepEqual(db.lookups.sort(), [CM, L1].sort());
    assert.equal(calls.length, 3);
  });

  test('error al leer el destinatario: fallo con intento y auditoría, sin envío', async () => {
    const db = fakeDb([row('a-l1', U1, L1)], { accessError: new Error('auth caído con sb_secret_abcDEF123 y lider1@example.test') });
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(calls.length, 0);
    assert.equal(s.failed, 1);
    assert.equal(db.t.alerts[0].email_attempts, 1);
    const dump = JSON.stringify(db.t.audit_log);
    assert.match(dump, /alert_email_failed/);
    assert.doesNotMatch(dump, /sb_secret_abc|lider1@example\.test/);
  });

  test('otra corrida la marcó antes: cuenta como skipped, sin auditoría duplicada', async () => {
    const users = { ...USERS, [L1]: { ...USERS[L1], roles: [] } };
    const db = fakeDb([row('a-l1', U1, L1)], { users });
    db.markAlertsEmailSkipped = async () => [];
    const { fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.skipped, 1);
    assert.equal(s.notEligible, 0);
    assert.equal(skippedAudits(db).length, 0);
  });
});

describe('C-06 QA-C05-1 alertas fuera de la ventana', () => {
  test('se marcan expired y se auditan una sola vez; las de dentro se envían', async () => {
    const db = fakeDb([
      row('vieja', U1, L1, { sent_at: ago(7 * DAY + 1), email_attempts: 1 }),
      row('borde', U1, L1, { sent_at: ago(7 * DAY) }),
      row('agotada', U1, L1, { sent_at: ago(9 * DAY), email_attempts: MAX_ATTEMPTS }),
      row('enviada', U1, L1, { sent_at: ago(9 * DAY), emailed_at: ago(8 * DAY), email_attempts: 1 }),
    ]);
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.expired, 1);
    assert.equal(s.sent, 1);
    assert.deepEqual(calls.map((c) => c.init.headers['Idempotency-Key']), ['alert-email-borde']);
    const vieja = db.t.alerts.find((a) => a.id === 'vieja');
    assert.equal(vieja.email_skip_reason, 'expired');
    assert.equal(vieja.email_skipped_at, NOW.toISOString());
    assert.equal(vieja.emailed_at, null);
    assert.equal(db.t.alerts.find((a) => a.id === 'agotada').email_skipped_at, null, 'las que agotaron intentos ya tienen su alert_email_failed');
    const audits = skippedAudits(db);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entity_id, 'vieja');
    assert.equal(audits[0].actor, EMAIL_ACTOR);
    assert.deepEqual(audits[0].details, {
      kind: 'color_change',
      unit_id: U1,
      recipient_user_id: L1,
      reason: 'expired',
      sent_at: ago(7 * DAY + 1),
      attempts: 1,
      lookback_days: 7,
    });
    const again = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(again.expired, 0);
    assert.equal(skippedAudits(db).length, 1);
  });

  test('una alerta que sale de la ventana entre dos corridas queda registrada en la segunda', async () => {
    const users = { ...USERS };
    const db = fakeDb([row('a', U1, L1, { sent_at: ago(6 * DAY) })], { users });
    const { fetchImpl } = fakeResend(() => ({ status: 500, body: { message: 'caído' } }));
    await sendAlertEmails(db, opts(fetchImpl));
    const later = new Date(NOW.getTime() + 2 * DAY);
    const s = await sendAlertEmails(db, opts(fetchImpl, { now: () => later }));
    assert.equal(s.expired, 1);
    assert.equal(s.pending, 0);
    assert.equal(skippedAudits(db)[0].details.attempts, 1);
  });

  test('un error de la BD en la pasada de vencidas va a errors y no impide los envíos', async () => {
    const db = fakeDb([row('a', U1, CM)]);
    db.expiredEmailAlerts = async () => {
      throw new Error('select caído');
    };
    const { fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.sent, 1);
    assert.equal(s.errors.length, 1);
    assert.match(s.errors[0], /fuera de la ventana/);
  });

  test('el lote de vencidas tiene tope (EXPIRED_BATCH)', async () => {
    const db = fakeDb([]);
    let limit;
    db.expiredEmailAlerts = async (q) => ((limit = q.limit), []);
    await sendAlertEmails(db, opts(fakeResend().fetchImpl));
    assert.equal(limit, 500);
  });
});

describe('C-06 H-C05-02 sanitizeError', () => {
  test('redacta sb_secret_...', () => {
    const s = sanitizeError(new Error('Invalid key sb_secret_AbC123-xyz_9 rejected'));
    assert.equal(s, 'Invalid key [clave] rejected');
  });
  test('redacta JWT completos y fragmentos eyJ...', () => {
    // JWT ficticio armado en ejecución (sin literal en el repo, para gitleaks).
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: 'ficticio' }), 'firma_ficticia-x'].join('.');
    assert.match(jwt, /^eyJ/);
    assert.equal(sanitizeError(`Bearer ${jwt} expirado`), 'Bearer [token] expirado');
    assert.equal(sanitizeError('token eyJhbGciOiJIUzI1NiJ9 suelto'), 'token [token] suelto');
    assert.doesNotMatch(sanitizeError({ toString: () => `x ${jwt}` }), /eyJ/);
  });
  test('sigue redactando re_..., correos y la clave exacta', () => {
    assert.equal(sanitizeError(`k ${KEY} a@b.test re_otraClave123456`, KEY), 'k [clave] [correo] [clave]');
  });
  test('no toca texto normal', () => {
    assert.equal(sanitizeError('HTTP 422: invalid "to" field'), 'HTTP 422: invalid "to" field');
  });
});

describe('C-06 H-ARQ-C05-02 código de salida ante 401/403', () => {
  const env = { RESEND_API_KEY: KEY, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' };
  const readSupabaseConfig = () => ({ url: 'https://x.supabase.co', secretKey: 'sb_secret_x' });
  const step = async (alerts, respond) => {
    const lines = [];
    const db = fakeDb(alerts);
    const r = await runEmailStep({ env, fetchImpl: fakeResend(respond).fetchImpl, makeDb: async () => db, readSupabaseConfig, log: (m) => lines.push(m), now: () => NOW, sleep: async () => {} });
    return { ...r, lines };
  };
  const two = () => [row('a-1', U1, L1), row('a-2', U2, L2)];

  for (const status of [401, 403]) {
    test(`todos los envíos fallan con ${status}: código 1 y ::error::`, async () => {
      const r = await step(two(), () => ({ status, body: { message: 'no autorizado' } }));
      assert.equal(r.code, 1);
      assert.ok(r.lines.some((l) => l.startsWith('::error::') && /401\/403/.test(l)));
      assert.doesNotMatch(r.lines.join('\n'), new RegExp(KEY));
    });
  }
  test('mezcla de 401 y 403: código 1', async () => {
    const r = await step(two(), (_c, n) => ({ status: n === 1 ? 401 : 403, body: {} }));
    assert.equal(r.code, 1);
  });
  test('algún envío sale (remitente de pruebas entrega al dueño): código 0', async () => {
    const r = await step(two(), (_c, n) => (n === 1 ? { status: 200, body: { id: 'ok' } } : { status: 403, body: {} }));
    assert.equal(r.code, 0);
  });
  test('fallos 401 junto con otro tipo (429): código 0, es puntual', async () => {
    const r = await step(two(), (_c, n) => ({ status: n === 1 ? 401 : 429, body: {} }));
    assert.equal(r.code, 0);
  });
  test('sin pendientes: código 0', async () => {
    const r = await step([], () => ({ status: 401, body: {} }));
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.lines.at(-1)), { pending: 0, sent: 0, failed: 0, skipped: 0, not_eligible: 0, expired: 0, errors: 0 });
  });
  test('allAuthFailures (pura)', () => {
    assert.equal(allAuthFailures({ sent: 0, failed: 2, failures: [{ status: 401 }, { status: 403 }] }), true);
    assert.equal(allAuthFailures({ sent: 0, failed: 1, failures: [{ status: null }] }), false, 'fallo sin HTTP (destinatario sin correo)');
    assert.equal(allAuthFailures({ sent: 1, failed: 1, failures: [{ status: 401 }] }), false);
    assert.equal(allAuthFailures({ sent: 0, failed: 0, failures: [] }), false);
  });
  test('los fallos registran el estado HTTP', async () => {
    const db = fakeDb([row('a-1', U1, L1)]);
    const s = await sendAlertEmails(db, opts(fakeResend(() => ({ status: 403, body: {} })).fetchImpl));
    assert.equal(s.failures[0].status, 403);
  });
});

describe('C-06 H-ARQ-C05-04 APP_URL por defecto', () => {
  test('sin APP_URL (o vacía) se usa la URL de Pages del proyecto', () => {
    assert.equal(DEFAULT_APP_URL, 'https://apivasa.github.io/practica_agente/');
    assert.equal(readEmailConfig({ RESEND_API_KEY: KEY }).appUrl, DEFAULT_APP_URL);
    assert.equal(readEmailConfig({ RESEND_API_KEY: KEY, APP_URL: '  ' }).appUrl, DEFAULT_APP_URL);
  });
  test('APP_URL explícita la sustituye y una no https sigue rechazándose', () => {
    assert.equal(readEmailConfig({ RESEND_API_KEY: KEY, APP_URL: 'https://otra.example.test/app/' }).appUrl, 'https://otra.example.test/app/');
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: KEY, APP_URL: 'http://otra.example.test/' }), /https/);
  });
  test('el correo lleva el enlace por defecto', async () => {
    const db = fakeDb([row('a-1', U1, CM)]);
    const { calls, fetchImpl } = fakeResend();
    await sendAlertEmails(db, opts(fetchImpl, { config: { ...CONFIG, appUrl: readEmailConfig({ RESEND_API_KEY: KEY }).appUrl } }));
    assert.match(calls[0].body.text, /Ver en la app: https:\/\/apivasa\.github\.io\/practica_agente\//);
    assert.match(calls[0].body.html, /href="https:\/\/apivasa\.github\.io\/practica_agente\/"/);
  });
});

describe('C-06 createDb (consultas nuevas)', () => {
  function recorder(result, { user = { email: 'u@x.test', banned_until: null }, adminError = null } = {}) {
    const calls = [];
    const chain = (table) => {
      const c = { table, ops: [] };
      calls.push(c);
      const p = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') return (res, rej) => Promise.resolve(result(c)).then(res, rej);
            return (...args) => {
              c.ops.push([prop, ...args]);
              return p;
            };
          },
        },
      );
      return p;
    };
    const sb = {
      from: chain,
      auth: { admin: { getUserById: async (id) => (calls.push({ admin: id }), adminError ? { data: null, error: adminError } : { data: { user }, error: null }) } },
    };
    return { sb, calls };
  }
  const has = (ops, ...want) => ops.some((op) => JSON.stringify(op) === JSON.stringify(want));

  test('pendientes excluyen las omitidas; marcar enviado exige que no esté omitida', async () => {
    const { sb, calls } = recorder(() => ({ data: [], error: null }));
    const db = createDb(sb);
    await db.pendingEmailAlerts({ since: 's', maxAttempts: 3 });
    await db.markAlertEmailed('a', { emailedAt: 't', attempts: 1 });
    assert.ok(has(calls[0].ops, 'is', 'email_skipped_at', null));
    assert.ok(has(calls[1].ops, 'is', 'email_skipped_at', null));
    assert.ok(has(calls[1].ops, 'is', 'emailed_at', null));
  });

  test('recipientAccess: correo, bloqueo y roles del usuario', async () => {
    const { sb, calls } = recorder(() => ({ data: [{ role: 'unit_leader', unit_id: 'u1' }], error: null }), {
      user: { email: 'u@x.test', banned_until: '2127-01-01T00:00:00Z' },
    });
    const r = await createDb(sb).recipientAccess('id-1');
    assert.deepEqual(r, { email: 'u@x.test', bannedUntil: '2127-01-01T00:00:00Z', deletedAt: null, roles: [{ role: 'unit_leader', unit_id: 'u1' }] });
    assert.deepEqual(calls[0], { admin: 'id-1' });
    assert.equal(calls[1].table, 'user_roles');
    assert.ok(has(calls[1].ops, 'eq', 'user_id', 'id-1'));
  });

  test('recipientAccess: 404 de Auth = usuario inexistente (null); otro error se propaga', async () => {
    assert.equal(await createDb(recorder(() => ({ data: [], error: null }), { adminError: { status: 404, message: 'User not found' } }).sb).recipientAccess('x'), null);
    await assert.rejects(
      createDb(recorder(() => ({ data: [], error: null }), { adminError: { status: 500, message: 'boom' } }).sb).recipientAccess('x'),
      /boom/,
    );
    await assert.rejects(createDb(recorder(() => ({ data: null, error: { message: 'roles caído' } })).sb).recipientAccess('x'), /roles caído/);
  });

  test('expiredEmailAlerts: sin correo ni omisión, bajo el tope, antes de la ventana y con límite', async () => {
    const { sb, calls } = recorder(() => ({ data: [{ id: 'v' }], error: null }));
    assert.deepEqual(await createDb(sb).expiredEmailAlerts({ before: 'b', maxAttempts: 3, limit: 500 }), [{ id: 'v' }]);
    const ops = calls[0].ops;
    assert.equal(calls[0].table, 'alerts');
    assert.ok(has(ops, 'is', 'emailed_at', null));
    assert.ok(has(ops, 'is', 'email_skipped_at', null));
    assert.ok(has(ops, 'lt', 'email_attempts', 3));
    assert.ok(has(ops, 'lt', 'sent_at', 'b'));
    assert.ok(has(ops, 'limit', 500));
  });

  test('markAlertsEmailSkipped: condicional y devuelve los ids marcados', async () => {
    const { sb, calls } = recorder(() => ({ data: [{ id: 'a' }], error: null }));
    assert.deepEqual(await createDb(sb).markAlertsEmailSkipped(['a', 'b'], { skippedAt: 't', reason: 'expired' }), ['a']);
    const ops = calls[0].ops;
    assert.deepEqual(ops[0], ['update', { email_skipped_at: 't', email_skip_reason: 'expired' }]);
    assert.ok(has(ops, 'in', 'id', ['a', 'b']));
    assert.ok(has(ops, 'is', 'emailed_at', null));
    assert.ok(has(ops, 'is', 'email_skipped_at', null));
  });
});

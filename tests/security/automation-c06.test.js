// C-06 — Seguridad del endurecimiento del correo de alertas (categorías 1, 2, 5, 6 y 8).
// Unitarias sobre scripts/lib/email.js y scripts/lib/db.js con Resend y supabase-js
// simulados (sin red). Comprueba que:
//   - la ruta real (createDb) expone los métodos de C-06, de modo que la comprobación de rol
//     vigente y bloqueo no queda abierta en producción (fail-closed en la ruta real);
//   - un destinatario sin rol vigente para la unidad de la alerta (IDOR a nivel de datos),
//     bloqueado o inexistente no recibe correo y queda auditado sin datos personales;
//   - si no se puede leer el destinatario, no se envía (fail-closed) y se reintenta;
//   - sanitizeError redacta sb_secret_..., JWT (incluidas claves legadas) y claves Resend
//     en audit_log, en el resumen y en el log del job;
//   - las marcas de omisión son condicionales (no pisan una alerta ya enviada).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sendAlertEmails, runEmailStep, sanitizeError, recipientSkipReason, SKIP_REASONS, REQUIRED_EMAIL_DB_METHODS, REQUIRED_F12_DB_METHODS } from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Construidas por partes para no ser falsos positivos de gitleaks.
const RESEND_KEY = 're' + '_SECURITYTEST_c06_do_not_leak_0123456789';
const SB_KEY = 'sb_' + 'secret_SECURITYTEST_c06_do_not_leak_0123456789abcdef';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const LEGACY_JWT = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ role: 'service_role', ref: 'ficticio' }), 'firma-ficticia_SECURITYTEST'].join('.');
const NOW = new Date('2027-04-01T12:00:00Z');
const CONFIG = { apiKey: RESEND_KEY, from: 'alertas@example.test', appUrl: 'https://app.example.test/', lookbackDays: 7 };

const UA = '33333333-0000-4000-8000-0000000000a1';
const UB = '33333333-0000-4000-8000-0000000000b2';
const LA = '44444444-0000-4000-8000-0000000000a1';
const LB = '44444444-0000-4000-8000-0000000000b2';
const CM = '44444444-0000-4000-8000-0000000000c3';
const GS = '44444444-0000-4000-8000-0000000000d4';
const CU = '44444444-0000-4000-8000-0000000000e5';
const BN = '44444444-0000-4000-8000-0000000000f6';

const USERS = {
  [LA]: { email: 'lider-a@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: UA }] },
  [LB]: { email: 'lider-b@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: UB }] },
  [CM]: { email: 'comite@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'committee', unit_id: null }] },
  [GS]: { email: 'gestora@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'kpi_manager', unit_id: null }] },
  [CU]: { email: 'custodio@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'custodian', unit_id: UA }] },
  [BN]: { email: 'bloqueado@example.test', bannedUntil: '2099-01-01T00:00:00Z', deletedAt: null, roles: [{ role: 'unit_leader', unit_id: UA }] },
};
const ALL_EMAILS = Object.values(USERS).map((u) => u.email);

const row = (id, unit, recipient, extra = {}) => ({
  id, unit_id: unit, recipient_user_id: recipient, kind: 'color_change',
  payload: { unit_name: 'Unidad', message: 'Unidad: el color pasó a rojo.' },
  sent_at: '2027-04-01T11:00:00Z', emailed_at: null, email_attempts: 0, email_skipped_at: null, email_skip_reason: null,
  ...extra,
});

function fakeDb(alerts, { users = USERS, access, rpc = true } = {}) {
  const t = { alerts: structuredClone(alerts), audit: [], rpcCalls: 0 };
  const open = (a) => a.emailed_at === null && a.email_skipped_at === null;
  return {
    t,
    pendingEmailAlerts: async ({ since, maxAttempts }) =>
      structuredClone(t.alerts.filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at >= since)),
    expiredEmailAlerts: async ({ before, maxAttempts, limit }) =>
      structuredClone(t.alerts.filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at < before).slice(0, limit)),
    userEmail: async () => { throw new Error('con recipientAccess no debe usarse userEmail'); },
    recipientAccess: access ?? (async (id) => structuredClone(users[id] ?? null)),
    async markAlertsEmailSkipped(ids, { skippedAt, reason }) {
      const out = [];
      for (const a of t.alerts) if (ids.includes(a.id) && open(a)) { Object.assign(a, { email_skipped_at: skippedAt, email_skip_reason: reason }); out.push(a.id); }
      return out;
    },
    async markAlertEmailed(id, { emailedAt, attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (!a || !open(a)) return false;
      Object.assign(a, { emailed_at: emailedAt, email_attempts: attempts });
      return true;
    },
    async recordAlertEmailFailure(id, { attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (a && open(a)) a.email_attempts = attempts;
    },
    insertAudit: async (rows) => { t.audit.push(...structuredClone(rows)); },
    // F-13: emula la RPC atómica mark_alerts_email_expired (marca y audita en una transacción,
    // con las mismas condiciones que el SQL de F-12). Con rpc:false la BD no la implementa.
    ...(rpc ? {
      async markAlertsEmailExpired(ids, { before, maxAttempts, skippedAt, lookbackDays }) {
        t.rpcCalls += 1;
        const out = [];
        for (const a of t.alerts) {
          if (!ids.includes(a.id) || !open(a) || a.email_attempts >= maxAttempts || !(a.sent_at < before)) continue;
          Object.assign(a, { email_skipped_at: skippedAt, email_skip_reason: 'expired' });
          t.audit.push({
            actor: 'system:alert-email', action: 'alert_email_skipped', entity: 'alerts', entity_id: a.id,
            details: { kind: a.kind, unit_id: a.unit_id, recipient_user_id: a.recipient_user_id, reason: 'expired', sent_at: a.sent_at, attempts: a.email_attempts, lookback_days: lookbackDays },
          });
          out.push(a.id);
        }
        return out;
      },
    } : {}),
  };
}

function fakeResend() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => '{"id":"msg"}', json: async () => ({ id: 'msg' }) };
  };
  return { calls, fetchImpl };
}

const opts = (fetchImpl, extra = {}) => ({ config: CONFIG, fetchImpl, now: () => NOW, sleep: async () => {}, log: () => {}, ...extra });
const assertNoSecrets = (text, label) => {
  for (const s of [RESEND_KEY, SB_KEY, LEGACY_JWT, 'sb_secret_', 'eyJ']) assert.ok(!text.includes(s), `${label}: contiene ${s.slice(0, 12)}…`);
};

/** supabase-js simulado: registra la cadena de cada consulta y responde lo configurado. */
function fakeSb({ user = null, userError = null, roles = [], rolesError = null, updateRows = [] } = {}) {
  const queries = [];
  const from = (table) => {
    const q = { table, calls: [] };
    queries.push(q);
    const result = () => {
      if (table === 'user_roles') return { data: roles, error: rolesError };
      if (table === 'alerts') return { data: updateRows, error: null };
      return { data: [], error: null };
    };
    const b = {};
    for (const m of ['select', 'update', 'insert', 'in', 'is', 'eq', 'lt', 'gte', 'order', 'limit', 'range']) {
      b[m] = (...args) => { q.calls.push([m, ...args]); return b; };
    }
    b.then = (res, rej) => Promise.resolve(result()).then(res, rej);
    return b;
  };
  const admin = { getUserById: async (id) => { queries.push({ table: 'auth.admin', id }); return { data: { user }, error: userError }; } };
  return { queries, from, auth: { admin } };
}

describe('C-06 seguridad · cat. 1/8 ruta real fail-closed (createDb)', () => {
  test('createDb implementa recipientAccess, expiredEmailAlerts, markAlertsEmailSkipped y markAlertsEmailExpired', () => {
    const db = createDb(fakeSb());
    for (const m of ['recipientAccess', 'expiredEmailAlerts', 'markAlertsEmailSkipped', 'markAlertsEmailExpired', 'pendingEmailAlerts', 'markAlertEmailed']) {
      assert.equal(typeof db[m], 'function', `falta ${m}: la comprobación de rol quedaría abierta`);
    }
  });

  test('scripts/send-alert-emails.js construye la BD con createDb (no con una BD parcial)', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'send-alert-emails.js'), 'utf8');
    assert.match(src, /return createDb\(sb\)/);
    assert.doesNotMatch(src, /recipientAccess\s*:\s*(undefined|null)/);
  });

  test('con la BD real, un líder sin rol vigente no recibe correo (no se cae a userEmail)', async () => {
    const sb = fakeSb({ user: { id: LA, email: 'lider-a@example.test', banned_until: null }, roles: [] });
    const real = createDb(sb);
    // Solo se simulan las lecturas/escrituras de alerts; recipientAccess es el de la capa real.
    const mem = fakeDb([row('a1', UA, LA)]);
    const db = { ...mem, recipientAccess: real.recipientAccess, userEmail: async () => 'lider-a@example.test' };
    const r = fakeResend();
    const s = await sendAlertEmails(db, opts(r.fetchImpl));
    assert.equal(r.calls.length, 0);
    assert.equal(s.notEligible, 1);
    assert.equal(mem.t.alerts[0].email_skip_reason, SKIP_REASONS.noRole);
  });

  test('recipientAccess consulta solo los roles del destinatario (eq user_id) y mapea bloqueo y borrado', async () => {
    const sb = fakeSb({
      user: { id: LA, email: 'x@example.test', banned_until: '2099-01-01T00:00:00Z', deleted_at: '2027-01-01T00:00:00Z' },
      roles: [{ role: 'unit_leader', unit_id: UA }],
    });
    const a = await createDb(sb).recipientAccess(LA);
    assert.deepEqual(a, { email: 'x@example.test', bannedUntil: '2099-01-01T00:00:00Z', deletedAt: '2027-01-01T00:00:00Z', roles: [{ role: 'unit_leader', unit_id: UA }] });
    const q = sb.queries.find((x) => x.table === 'user_roles');
    assert.deepEqual(q.calls.find((c) => c[0] === 'eq'), ['eq', 'user_id', LA]);
  });

  test('recipientAccess: 404 es "no existe"; cualquier otro error se propaga (no se trata como válido)', async () => {
    assert.equal(await createDb(fakeSb({ userError: { status: 404, message: 'User not found' } })).recipientAccess(LA), null);
    await assert.rejects(createDb(fakeSb({ userError: { status: 500, message: 'boom' } })).recipientAccess(LA));
    await assert.rejects(createDb(fakeSb({ user: { id: LA, email: 'x@example.test' }, rolesError: { message: 'permission denied' } })).recipientAccess(LA));
  });

  test('marcas condicionales: omisión y envío exigen emailed_at y email_skipped_at nulos', async () => {
    const sb = fakeSb({ updateRows: [{ id: 'a1' }] });
    const db = createDb(sb);
    await db.markAlertsEmailSkipped(['a1'], { skippedAt: NOW.toISOString(), reason: 'expired' });
    await db.markAlertEmailed('a1', { emailedAt: NOW.toISOString(), attempts: 1 });
    await db.pendingEmailAlerts({ since: NOW.toISOString(), maxAttempts: 3 });
    const alertQs = sb.queries.filter((x) => x.table === 'alerts');
    assert.equal(alertQs.length, 3);
    for (const q of alertQs) {
      const isNull = q.calls.filter((c) => c[0] === 'is' && c[2] === null).map((c) => c[1]);
      assert.ok(isNull.includes('email_skipped_at'), 'sin filtro email_skipped_at is null');
      if (q.calls.some((c) => c[0] === 'update')) assert.ok(isNull.includes('emailed_at'), 'update sin emailed_at is null');
    }
    const skipUpd = alertQs[0].calls.find((c) => c[0] === 'update')[1];
    assert.deepEqual(Object.keys(skipUpd).sort(), ['email_skip_reason', 'email_skipped_at'], 'la omisión solo escribe sus dos columnas');
  });
});

describe('C-06 seguridad · cat. 1 IDOR y roles: solo líder de la unidad o comité', () => {
  const cases = [
    ['líder de otra unidad (alerta de A dirigida al líder de B)', row('i1', UA, LB), SKIP_REASONS.noRole],
    ['gestora no es destinataria de correos', row('i2', UA, GS), SKIP_REASONS.noRole],
    ['custodio de la unidad no es destinatario', row('i3', UA, CU), SKIP_REASONS.noRole],
    ['usuario bloqueado', row('i4', UA, BN), SKIP_REASONS.banned],
    ['usuario inexistente', row('i5', UA, '44444444-0000-4000-8000-000000000999'), SKIP_REASONS.missing],
    ['alerta sin unidad dirigida a un líder', row('i6', null, LA), SKIP_REASONS.noRole],
  ];
  for (const [name, alert, reason] of cases) {
    test(`${name}: no se envía y se audita ${reason}`, async () => {
      const db = fakeDb([alert]);
      const r = fakeResend();
      await sendAlertEmails(db, opts(r.fetchImpl));
      assert.equal(r.calls.length, 0, 'Resend no debe recibir la petición');
      assert.equal(db.t.alerts[0].email_skip_reason, reason);
      const audit = db.t.audit.filter((x) => x.action === 'alert_email_skipped');
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actor, 'system:alert-email');
      assertNoSecrets(JSON.stringify(db.t.audit), 'audit');
      for (const e of ALL_EMAILS) assert.ok(!JSON.stringify(db.t.audit).includes(e), 'la auditoría no guarda correos');
    });
  }

  test('líder de la unidad y comité válidos sí reciben, cada uno solo su correo', async () => {
    const db = fakeDb([row('v1', UA, LA), row('v2', UA, CM)]);
    const r = fakeResend();
    await sendAlertEmails(db, opts(r.fetchImpl));
    assert.deepEqual(r.calls.map((c) => c.body.to).sort(), [['comite@example.test'], ['lider-a@example.test']]);
  });

  test('roles con forma inesperada o rol inventado no habilitan el envío', () => {
    const base = { email: 'x@example.test', bannedUntil: null, deletedAt: null };
    for (const roles of [null, 'committee', [{ role: 'Committee' }], [{ role: 'unit_leader', unit_id: null }], [{ role: 'admin' }], [null]]) {
      assert.equal(recipientSkipReason({ unit_id: UA }, { ...base, roles }, NOW), SKIP_REASONS.noRole, JSON.stringify(roles));
    }
    assert.equal(recipientSkipReason({ unit_id: UA }, 'committee', NOW), SKIP_REASONS.missing);
    assert.equal(recipientSkipReason({ unit_id: UA }, { ...base, bannedUntil: 'no-es-fecha', roles: [{ role: 'committee' }] }, NOW), SKIP_REASONS.banned);
  });

  test('fail-closed: si no se puede leer el destinatario, no se envía, no se omite y se reintenta', async () => {
    const db = fakeDb([row('f1', UA, LA)], { access: async () => { throw new Error(`fallo con ${SB_KEY} y Bearer ${LEGACY_JWT}`); } });
    const r = fakeResend();
    const s = await sendAlertEmails(db, opts(r.fetchImpl));
    assert.equal(r.calls.length, 0);
    assert.equal(s.failed, 1);
    assert.equal(db.t.alerts[0].email_skipped_at, null, 'un error transitorio no silencia la alerta para siempre');
    assert.equal(db.t.alerts[0].email_attempts, 1);
    assertNoSecrets(JSON.stringify(db.t.audit), 'audit');
    assertNoSecrets(JSON.stringify(s), 'summary');
  });

  test('una alerta ya enviada no se puede marcar como omitida (ni al revés)', async () => {
    const db = fakeDb([row('e1', UA, LB, { emailed_at: '2027-04-01T11:30:00Z' })]);
    assert.deepEqual(await db.markAlertsEmailSkipped(['e1'], { skippedAt: NOW.toISOString(), reason: 'expired' }), []);
  });
});

describe('C-06 seguridad · cat. 2/6 sanitizeError redacta secretos de Supabase y JWT', () => {
  const inputs = [
    `401 apikey=${SB_KEY}`,
    `GET https://x.supabase.co/rest/v1/alerts?apikey=${SB_KEY}&select=*`,
    JSON.stringify({ headers: { apikey: SB_KEY, Authorization: `Bearer ${LEGACY_JWT}` } }),
    `Authorization: Bearer ${LEGACY_JWT}`,
    `${'x'.repeat(280)} ${SB_KEY}`,
    `${'y'.repeat(295)} ${LEGACY_JWT}`,
    `doble ${SB_KEY} ${SB_KEY} ${LEGACY_JWT}${LEGACY_JWT}`,
    `${RESEND_KEY} lider-a@example.test ${SB_KEY}`,
  ];
  for (const [i, input] of inputs.entries()) {
    test(`caso ${i + 1}: sin sb_secret_, JWT, re_ ni correos`, () => {
      const out = sanitizeError(new Error(input), RESEND_KEY);
      assertNoSecrets(out, `caso ${i + 1}`);
      assert.ok(!out.includes('lider-a@example.test'));
      assert.ok(out.length <= 300);
    });
  }

  test('runEmailStep: un error de la BD con la clave secreta no llega al log del job', async () => {
    const lines = [];
    const db = fakeDb([row('r1', UA, LA)]);
    db.expiredEmailAlerts = async () => { throw new Error(`permission denied apikey=${SB_KEY} jwt=${LEGACY_JWT}`); };
    db.recipientAccess = async () => { throw new Error(`Invalid API key ${SB_KEY}`); };
    const { code } = await runEmailStep({
      env: { RESEND_API_KEY: RESEND_KEY, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: SB_KEY },
      fetchImpl: fakeResend().fetchImpl,
      makeDb: async () => db,
      readSupabaseConfig: (env) => ({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY }),
      log: (m) => lines.push(m),
      now: () => NOW,
      sleep: async () => {},
    });
    assert.equal(code, 1, 'un error de BD termina en 1');
    assertNoSecrets(lines.join('\n'), 'log');
    assertNoSecrets(JSON.stringify(db.t.audit), 'audit');
  });
});

describe('C-06 seguridad · cat. 8 auditoría de vencidas sin datos personales', () => {
  test('alertas vencidas: omitidas, auditadas por el actor del sistema, sin correos', async () => {
    const db = fakeDb([row('x1', UA, LA, { sent_at: '2027-03-01T00:00:00Z' }), row('x2', UA, LA)]);
    const r = fakeResend();
    const s = await sendAlertEmails(db, opts(r.fetchImpl));
    assert.equal(s.expired, 1);
    assert.equal(db.t.alerts[0].email_skip_reason, SKIP_REASONS.expired);
    const a = db.t.audit.find((x) => x.entity_id === 'x1');
    assert.equal(a.action, 'alert_email_skipped');
    assert.equal(a.actor, 'system:alert-email');
    assert.ok(!JSON.stringify(db.t.audit).includes('@'), 'la auditoría no guarda correos');
    assert.equal(r.calls.length, 1, 'solo la alerta vigente se envía');
  });
});

// F-13 (H-F12-01): la ruta `expired` solo existe por la RPC atómica; sin ella, fail-closed.
const stepArgs = (db, lines, fetchImpl) => ({
  env: { RESEND_API_KEY: RESEND_KEY, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: SB_KEY },
  fetchImpl,
  makeDb: async () => db,
  readSupabaseConfig: (env) => ({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY }),
  log: (m) => lines.push(m),
  now: () => NOW,
  sleep: async () => {},
});

describe('F-13 seguridad · cat. 1/8 vencidas solo por la RPC atómica (fail-closed)', () => {
  test('runEmailStep exige markAlertsEmailExpired (REQUIRED_EMAIL_DB_METHODS, congelado)', () => {
    assert.ok(REQUIRED_EMAIL_DB_METHODS.includes('markAlertsEmailExpired'));
    assert.ok(REQUIRED_F12_DB_METHODS.includes('markAlertsEmailExpired'));
    for (const m of ['recipientAccess', 'expiredEmailAlerts', 'markAlertsEmailSkipped']) assert.ok(REQUIRED_EMAIL_DB_METHODS.includes(m), m);
    assert.ok(Object.isFrozen(REQUIRED_EMAIL_DB_METHODS) && Object.isFrozen(REQUIRED_F12_DB_METHODS));
  });

  test('runEmailStep sin la RPC: código 2, no envía, no marca, no audita y no filtra secretos', async () => {
    const lines = [];
    const db = fakeDb([row('v1', UA, LA, { sent_at: '2027-03-01T00:00:00Z' }), row('v2', UA, LA)], { rpc: false });
    let skippedCalls = 0;
    const orig = db.markAlertsEmailSkipped;
    db.markAlertsEmailSkipped = async (...a) => { skippedCalls += 1; return orig(...a); };
    let audits = 0;
    db.insertAudit = async () => { audits += 1; };
    const r = fakeResend();
    const { code, summary } = await runEmailStep(stepArgs(db, lines, r.fetchImpl));
    assert.equal(code, 2, 'sin la RPC atómica debe fallar cerrado con 2');
    assert.equal(summary, null);
    assert.equal(r.calls.length, 0, 'no se envía ningún correo');
    assert.equal(skippedCalls, 0, 'no se usa la ruta no atómica (markAlertsEmailSkipped) para vencidas');
    assert.equal(audits, 0);
    assert.ok(db.t.alerts.every((a) => a.email_skipped_at === null && a.emailed_at === null), 'ninguna alerta cambia');
    assert.ok(lines.some((l) => l.startsWith('::error::') && l.includes('markAlertsEmailExpired')));
    assertNoSecrets(lines.join('\n'), 'log');
  });

  for (const bogus of [null, undefined, 1, 'markAlertsEmailExpired', {}, true]) {
    test(`runEmailStep con markAlertsEmailExpired = ${JSON.stringify(bogus) ?? 'undefined'} (no función) → 2`, async () => {
      const db = fakeDb([row('v1', UA, LA, { sent_at: '2027-03-01T00:00:00Z' })]);
      db.markAlertsEmailExpired = bogus;
      const r = fakeResend();
      const { code } = await runEmailStep(stepArgs(db, [], r.fetchImpl));
      assert.equal(code, 2);
      assert.equal(r.calls.length, 0);
    });
  }

  test('sendAlertEmails sin la RPC: no marca vencidas por la ruta vieja, registra error y no audita', async () => {
    const db = fakeDb([row('x1', UA, LA, { sent_at: '2027-03-01T00:00:00Z' })], { rpc: false });
    let skippedCalls = 0;
    db.markAlertsEmailSkipped = async () => { skippedCalls += 1; return ['x1']; };
    const s = await sendAlertEmails(db, opts(fakeResend().fetchImpl));
    assert.equal(s.expired, 0);
    assert.equal(skippedCalls, 0);
    assert.equal(db.t.audit.length, 0);
    assert.equal(db.t.alerts[0].email_skipped_at, null);
    assert.ok(s.errors.some((e) => e.includes('markAlertsEmailExpired')));
  });

  test('si la RPC falla (con la clave en el mensaje), nada queda marcado ni auditado y el error va saneado', async () => {
    const db = fakeDb([row('x1', UA, LA, { sent_at: '2027-03-01T00:00:00Z' })]);
    let skippedCalls = 0;
    db.markAlertsEmailSkipped = async () => { skippedCalls += 1; return []; };
    db.markAlertsEmailExpired = async () => { throw new Error(`rpc failed apikey=${SB_KEY} ${LEGACY_JWT}`); };
    const s = await sendAlertEmails(db, opts(fakeResend().fetchImpl));
    assert.equal(s.expired, 0);
    assert.equal(skippedCalls, 0, 'no hay fallback no atómico');
    assert.equal(db.t.audit.length, 0);
    assert.equal(db.t.alerts[0].email_skipped_at, null);
    assert.equal(s.errors.length, 1);
    assertNoSecrets(JSON.stringify(s), 'summary');
  });

  test('la ruta vencidas pasa a la RPC solo ids string de alertas vencidas, el corte y la ventana', async () => {
    const db = fakeDb([row('x1', UA, LA, { sent_at: '2027-03-01T00:00:00Z' }), row('x2', UA, LA)]);
    const calls = [];
    const orig = db.markAlertsEmailExpired;
    db.markAlertsEmailExpired = async (ids, v) => { calls.push({ ids, v }); return orig(ids, v); };
    const s = await sendAlertEmails(db, opts(fakeResend().fetchImpl));
    assert.equal(s.expired, 1);
    assert.deepEqual(calls[0].ids, ['x1']);
    assert.equal(calls[0].v.before, new Date(NOW.getTime() - CONFIG.lookbackDays * 86400000).toISOString());
    assert.equal(calls[0].v.lookbackDays, CONFIG.lookbackDays);
  });
});

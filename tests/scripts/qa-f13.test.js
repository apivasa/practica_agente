// F-13 — QA independiente (tester). Cada caso traza al criterio de aceptación:
//   [1] "runEmailStep falla cerrado (código 2, sin leer BD ni Resend) si la BD no tiene
//       markAlertsEmailExpired, y ya no existe la ruta no atómica (markAlertsEmailSkipped +
//       insertAudit) para expired".
// (El criterio 2, deploy-main, está en tests/scripts/qa-v04b.test.js, describe «QA F-13».)
// La BD es simulada en memoria; la RPC marca y audita como la migración de F-12
// (tests/scripts/expired-rpc-fake.js). Resend se simula con un fetch inyectado.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runEmailStep, EMAIL_ACTOR } from '../../scripts/lib/email.js';
import { withExpiredRpc } from './expired-rpc-fake.js';

const KEY = ['re', 'QAf13', 'fictitious', 'key', '0001'].join('_');
const NOW = new Date('2027-06-10T12:00:00Z');
const DAY = 86_400_000;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const UNIT = '13131313-0000-4000-8000-0000000000a1';
const LEADER = '13131313-0000-4000-8000-0000000000b1';
const env = { RESEND_API_KEY: KEY, ALERT_EMAIL_FROM: 'onboarding@resend.dev', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'x' };
const readSupabaseConfig = () => ({ url: 'https://x.supabase.co', secretKey: 'x' });

const alert = (id, sentAgoMs, extra = {}) => ({
  id,
  unit_id: UNIT,
  recipient_user_id: LEADER,
  kind: 'color_change',
  payload: { unit_name: 'Unidad QA', message: 'Unidad QA: el color pasó a rojo.' },
  sent_at: ago(sentAgoMs),
  emailed_at: null,
  email_attempts: 0,
  email_skipped_at: null,
  email_skip_reason: null,
  ...extra,
});

/** BD con el contrato completo; `calls` registra cada método llamado (no solo los leídos). */
function fullDb(alerts) {
  const t = { alerts: structuredClone(alerts), audit_log: [] };
  const calls = [];
  const open = (a) => a.emailed_at === null && a.email_skipped_at === null;
  const db = {
    t,
    calls,
    async pendingEmailAlerts({ since, maxAttempts }) {
      return structuredClone(t.alerts.filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at >= since));
    },
    async expiredEmailAlerts({ before, maxAttempts, limit }) {
      return structuredClone(t.alerts.filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at < before).slice(0, limit));
    },
    async userEmail() {
      return 'lider@qa13.example.test';
    },
    async recipientAccess() {
      return { email: 'lider@qa13.example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: UNIT }] };
    },
    async markAlertsEmailSkipped(ids, { skippedAt, reason }) {
      const out = [];
      for (const a of t.alerts) if (ids.includes(a.id) && open(a)) { a.email_skipped_at = skippedAt; a.email_skip_reason = reason; out.push(a.id); }
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
  };
  withExpiredRpc(db);
  for (const k of Object.keys(db)) {
    if (typeof db[k] !== 'function') continue;
    const f = db[k];
    db[k] = async (...args) => { calls.push({ m: k, args }); return f(...args); };
  }
  return db;
}

function resend() {
  const sent = [];
  return { sent, fetchImpl: async (_u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `m-${sent.length}` }), { status: 200 }); } };
}

const step = (db, fetchImpl, lines = []) =>
  runEmailStep({ env, fetchImpl, makeDb: async () => db, readSupabaseConfig, log: (l) => lines.push(l), now: () => NOW, sleep: async () => {} });

describe('[1] F-13 runEmailStep: fail-closed sin markAlertsEmailExpired', () => {
  test('falta solo la RPC: código 2, ::error:: que la nombra, ningún método de la BD llamado y Resend sin tocar', async () => {
    const db = fullDb([alert('dentro', 3600_000), alert('vieja', 8 * DAY)]);
    delete db.markAlertsEmailExpired;
    const lines = [];
    const r = await step(db, async () => assert.fail('no debe llamar a Resend'), lines);
    assert.equal(r.code, 2);
    assert.equal(r.summary, null);
    assert.deepEqual(db.calls, []);
    const err = lines.filter((l) => l.startsWith('::error::'));
    assert.equal(err.length, 1, lines.join('\n'));
    assert.match(err[0], /markAlertsEmailExpired/);
    assert.doesNotMatch(err[0], /recipientAccess|expiredEmailAlerts|markAlertsEmailSkipped/, 'solo nombra lo que falta');
    assert.ok(!lines.join('\n').includes(KEY));
    assert.deepEqual(db.t.audit_log, []);
    assert.ok(db.t.alerts.every((a) => a.email_skipped_at === null && a.emailed_at === null));
  });

  test('la RPC definida como propiedad no función (p. ej. el nombre de la RPC en texto): también 2', async () => {
    const db = fullDb([alert('dentro', 3600_000)]);
    db.markAlertsEmailExpired = 'mark_alerts_email_expired';
    const r = await step(db, async () => assert.fail('no debe llamar a Resend'));
    assert.equal(r.code, 2);
    assert.deepEqual(db.calls, []);
  });

  test('faltan C-06 y la RPC: código 2 sin tocar nada (el fail-closed de F-11 se mantiene)', async () => {
    const db = fullDb([alert('dentro', 3600_000)]);
    delete db.markAlertsEmailExpired;
    delete db.recipientAccess;
    const r = await step(db, async () => assert.fail('no debe llamar a Resend'));
    assert.equal(r.code, 2);
    assert.deepEqual(db.calls, []);
  });
});

describe('[1] F-13 ruta expired: solo la RPC atómica', () => {
  test('con la RPC: vencida marcada y auditada una vez por la RPC, la de dentro se envía; sin markAlertsEmailSkipped ni insertAudit de expired', async () => {
    const db = fullDb([alert('dentro', 3600_000), alert('vieja', 7 * DAY + 1, { email_attempts: 2 })]);
    const { sent, fetchImpl } = resend();
    const lines = [];
    const r = await step(db, fetchImpl, lines);
    assert.equal(r.code, 0, lines.join('\n'));
    assert.equal(r.summary.expired, 1);
    assert.equal(sent.length, 1);
    const vieja = db.t.alerts.find((a) => a.id === 'vieja');
    assert.equal(vieja.email_skip_reason, 'expired');
    assert.equal(vieja.emailed_at, null);
    const used = db.calls.map((c) => c.m);
    assert.equal(used.filter((m) => m === 'markAlertsEmailExpired').length, 1);
    assert.ok(!used.includes('markAlertsEmailSkipped'), `no usa la marca suelta: ${used.join(',')}`);
    const expiredAuditsByApp = db.calls
      .filter((c) => c.m === 'insertAudit')
      .flatMap((c) => c.args[0])
      .filter((row) => row?.details?.reason === 'expired');
    assert.deepEqual(expiredAuditsByApp, [], 'la app no audita expired por su cuenta');
    const audits = db.t.audit_log.filter((a) => a.action === 'alert_email_skipped' && a.entity_id === 'vieja');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor, EMAIL_ACTOR);
    assert.equal(audits[0].details.attempts, 2);
    assert.ok(!lines.join('\n').includes(KEY));
    // Segunda corrida: nada nuevo que vencer ni auditar.
    const again = await step(db, fetchImpl);
    assert.equal(again.summary.expired, 0);
    assert.equal(db.t.audit_log.filter((a) => a.entity_id === 'vieja').length, 1);
  });

  test('la RPC falla: código 1, ninguna vencida marcada ni auditada por otra vía; el error no filtra la clave', async () => {
    const db = fullDb([alert('dentro', 3600_000), alert('vieja', 8 * DAY)]);
    db.markAlertsEmailExpired = async () => { throw new Error(`HTTP 500 con ${KEY}`); };
    const { sent, fetchImpl } = resend();
    const lines = [];
    const r = await step(db, fetchImpl, lines);
    assert.equal(r.code, 1);
    assert.equal(r.summary.expired, 0);
    assert.equal(sent.length, 1, 'el fallo de vencidas no impide los envíos de la ventana');
    assert.equal(db.t.alerts.find((a) => a.id === 'vieja').email_skipped_at, null);
    assert.ok(!db.calls.some((c) => c.m === 'markAlertsEmailSkipped'));
    assert.equal(db.t.audit_log.filter((a) => a.entity_id === 'vieja').length, 0);
    assert.ok(lines.some((l) => l.startsWith('::error::') && /fuera de la ventana/.test(l)));
    assert.ok(!lines.join('\n').includes(KEY));
  });
});

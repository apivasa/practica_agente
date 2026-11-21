// F-13 — pruebas del desarrollador:
// - H-QA-F12-03 / H-F12-01: runEmailStep falla cerrado (código 2) sin markAlertsEmailExpired
//   y sendAlertEmails ya no tiene ruta no atómica (markAlertsEmailSkipped + insertAudit)
//   para las alertas vencidas.
// - H-ARQ-F12-02: assessDeploy no cuenta un failure de deploy.yml si hay un run más nuevo
//   pendiente dentro de maxPendingMin (rojo esperado H-F11-06); sí alerta fuera de la
//   ventana o si el más nuevo también falla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runEmailStep,
  sendAlertEmails,
  REQUIRED_C06_DB_METHODS,
  REQUIRED_F12_DB_METHODS,
  REQUIRED_EMAIL_DB_METHODS,
} from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';
import { DEPLOY_RULE, assessDeploy, newerPendingRun } from '../../scripts/health/lib.js';

// ------------------------------------------------------------ correo

// Claves ficticias armadas en ejecución (no son credenciales; evita falsos positivos de gitleaks).
const RESEND_KEY = ['re', 'F13TESTKEY', 'ficticia'].join('_');
const SB_KEY = ['sb', 'secret', 'f13ficticia'].join('_');
const env = { RESEND_API_KEY: RESEND_KEY, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: SB_KEY };
const readSupabaseConfig = (e) => ({ url: e.SUPABASE_URL, secretKey: e.SUPABASE_SECRET_KEY });
const NOW = new Date('2027-03-20T12:00:00Z');
const A1 = '33333333-0000-4000-8000-0000000000a1';
const L1 = '22222222-0000-4000-8000-0000000000b1';
const CONFIG = { apiKey: RESEND_KEY, from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };

function fullDb() {
  const calls = { touched: [], skipped: 0, audit: 0, rpc: 0 };
  const t = (name, value) => async () => {
    calls.touched.push(name);
    return value;
  };
  return {
    calls,
    pendingEmailAlerts: t('pendingEmailAlerts', []),
    userEmail: t('userEmail', null),
    markAlertEmailed: t('markAlertEmailed', true),
    recordAlertEmailFailure: t('recordAlertEmailFailure', undefined),
    insertAudit: async () => {
      calls.audit += 1;
    },
    recipientAccess: t('recipientAccess', null),
    expiredEmailAlerts: async () => {
      calls.touched.push('expiredEmailAlerts');
      return [{ id: A1, unit_id: null, recipient_user_id: L1, kind: 'color_change', sent_at: '2027-03-01T00:00:00Z', email_attempts: 0 }];
    },
    markAlertsEmailSkipped: async () => {
      calls.skipped += 1;
      return [A1];
    },
    markAlertsEmailExpired: async (ids) => {
      calls.rpc += 1;
      return ids;
    },
  };
}

test('H-F12-01: la lista exigida es C-06 más markAlertsEmailExpired; C-06 no cambia', () => {
  assert.deepEqual([...REQUIRED_C06_DB_METHODS], ['recipientAccess', 'expiredEmailAlerts', 'markAlertsEmailSkipped']);
  assert.deepEqual([...REQUIRED_F12_DB_METHODS], ['markAlertsEmailExpired']);
  assert.deepEqual([...REQUIRED_EMAIL_DB_METHODS], [...REQUIRED_C06_DB_METHODS, 'markAlertsEmailExpired']);
  assert.ok(Object.isFrozen(REQUIRED_F12_DB_METHODS) && Object.isFrozen(REQUIRED_EMAIL_DB_METHODS));
});

for (const bad of [undefined, null, 'rpc', { call: true }]) {
  test(`H-F12-01: markAlertsEmailExpired = ${JSON.stringify(bad) ?? 'ausente'} → código 2, ::error:: y nada tocado`, async () => {
    const db = fullDb();
    if (bad === undefined) delete db.markAlertsEmailExpired;
    else db.markAlertsEmailExpired = bad;
    const lines = [];
    const r = await runEmailStep({
      env,
      makeDb: async () => db,
      readSupabaseConfig,
      log: (l) => lines.push(l),
      fetchImpl: async () => assert.fail('no debe llamar a Resend'),
    });
    assert.equal(r.code, 2);
    assert.equal(r.summary, null);
    assert.deepEqual(db.calls.touched, []);
    assert.equal(db.calls.skipped, 0);
    assert.equal(db.calls.audit, 0);
    const out = lines.join('\n');
    assert.ok(lines.some((l) => l.startsWith('::error::') && l.includes('markAlertsEmailExpired')), out);
    assert.doesNotMatch(out, new RegExp(RESEND_KEY));
    assert.doesNotMatch(out, /sb_secret_/);
  });
}

test('H-F12-01: con todos los métodos, runEmailStep usa la RPC y termina en 0', async () => {
  const db = fullDb();
  const r = await runEmailStep({
    env,
    makeDb: async () => db,
    readSupabaseConfig,
    log: () => {},
    now: () => NOW,
    sleep: async () => {},
    fetchImpl: async () => assert.fail('sin pendientes no envía'),
  });
  assert.equal(r.code, 0);
  assert.equal(r.summary.expired, 1);
  assert.equal(db.calls.rpc, 1);
  assert.equal(db.calls.skipped, 0);
  assert.equal(db.calls.audit, 0);
});

test('H-F12-01: sendAlertEmails sin la RPC no marca ni audita vencidas por la ruta vieja: deja un error', async () => {
  const db = fullDb();
  delete db.markAlertsEmailExpired;
  const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
  assert.equal(s.expired, 0);
  assert.equal(db.calls.skipped, 0);
  assert.equal(db.calls.audit, 0);
  assert.ok(!db.calls.touched.includes('expiredEmailAlerts'), 'ni siquiera lee las vencidas');
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /alertas fuera de la ventana: .*markAlertsEmailExpired/);
});

test('H-F12-01: el código de email.js ya no marca expired con markAlertsEmailSkipped', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../scripts/lib/email.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /reason:\s*SKIP_REASONS\.expired/);
});

test('H-F12-01: la capa real (createDb) implementa todo lo exigido', () => {
  const db = createDb({ from() {}, rpc() {}, auth: { admin: {} } });
  for (const m of REQUIRED_EMAIL_DB_METHODS) assert.equal(typeof db[m], 'function', m);
});

// ------------------------------------------------------------ salud: deploy-main

const MIN = 60_000;
const WF = { state: 'active', created_at: '2026-01-01T00:00:00Z' };
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
function run(id, { ageMs, status = 'completed', conclusion = 'success', event = 'push', started } = {}) {
  const created = ago(ageMs);
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: created,
    run_started_at: started ?? created,
    updated_at: created,
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

test('H-ARQ-F12-02: failure con un run más nuevo en curso dentro de la ventana → warn, no fail', () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    const res = assess([run(1, { ageMs: 30 * MIN, conclusion: 'failure' }), run(2, { ageMs: 20 * MIN, status })]);
    assert.equal(res.status, 'warn', status);
    assert.match(res.detail, /H-F11-06/);
    assert.match(res.detail, /runs\/1/);
    assert.match(res.detail, /runs\/2/);
  }
});

test('H-ARQ-F12-02: justo en maxPendingMin todavía cubre; un minuto más, falla', () => {
  const failed = run(1, { ageMs: 120 * MIN, conclusion: 'failure' });
  assert.equal(assess([failed, run(2, { ageMs: 90 * MIN, status: 'in_progress' })]).status, 'warn');
  const res = assess([failed, run(2, { ageMs: 91 * MIN, status: 'in_progress' })]);
  assert.equal(res.status, 'fail');
  assert.match(res.detail, /terminó en failure/);
  assert.match(res.detail, /91 min/);
});

test('H-ARQ-F12-02: la ventana se mide desde run_started_at si existe', () => {
  const failed = run(1, { ageMs: 200 * MIN, conclusion: 'failure' });
  // creado hace 150 min (en cola), arrancó hace 10: está dentro de la ventana.
  const newer = run(2, { ageMs: 150 * MIN, status: 'in_progress', started: ago(10 * MIN) });
  assert.equal(assess([failed, newer]).status, 'warn');
});

test('H-ARQ-F12-02: si el más nuevo también falla, alerta', () => {
  const res = assess([run(1, { ageMs: 60 * MIN, conclusion: 'failure' }), run(2, { ageMs: 30 * MIN, conclusion: 'failure' })]);
  assert.equal(res.status, 'fail');
  assert.match(res.detail, /runs\/2/);
});

test('H-ARQ-F12-02: un pendiente más viejo que el fallo no lo cubre', () => {
  const res = assess([run(1, { ageMs: 30 * MIN, status: 'queued' }), run(2, { ageMs: 10 * MIN, conclusion: 'failure' })]);
  assert.equal(res.status, 'fail');
});

test('H-ARQ-F12-02: un pendiente de otro evento (schedule) no cuenta', () => {
  const res = assess([run(1, { ageMs: 30 * MIN, conclusion: 'failure' }), run(2, { ageMs: 10 * MIN, status: 'queued', event: 'schedule' })]);
  assert.equal(res.status, 'fail');
});

test('H-ARQ-F12-02: timed_out y startup_failure siguen la misma regla', () => {
  for (const conclusion of ['timed_out', 'startup_failure']) {
    assert.equal(assess([run(1, { ageMs: 30 * MIN, conclusion }), run(2, { ageMs: 5 * MIN, status: 'queued' })]).status, 'warn', conclusion);
    assert.equal(assess([run(1, { ageMs: 30 * MIN, conclusion })]).status, 'fail', conclusion);
  }
});

test('H-ARQ-F12-02: con otro run atascado no se suaviza el fallo', () => {
  const res = assess([
    run(1, { ageMs: 300 * MIN, status: 'in_progress' }),
    run(2, { ageMs: 30 * MIN, conclusion: 'failure' }),
    run(3, { ageMs: 5 * MIN, status: 'queued' }),
  ]);
  assert.equal(res.status, 'fail');
  assert.match(res.detail, /300 min/);
  assert.match(res.detail, /terminó en failure/);
});

test('H-ARQ-F12-02: failure sin runs más nuevos sigue fallando; success con pendiente sigue ok', () => {
  assert.equal(assess([run(1, { ageMs: 30 * MIN, conclusion: 'failure' })]).status, 'fail');
  assert.equal(assess([run(1, { ageMs: 30 * MIN }), run(2, { ageMs: 5 * MIN, status: 'queued' })]).status, 'ok');
});

test('newerPendingRun: fechas ilegibles o entradas raras no cubren', () => {
  const nowMs = NOW.getTime();
  assert.equal(newerPendingRun([run(2, { ageMs: MIN, status: 'queued' })], { created_at: 'no-fecha' }, nowMs, 90), null);
  assert.equal(newerPendingRun([null, { status: 'queued', created_at: 'x' }], run(1, { ageMs: 10 * MIN }), nowMs, 90), null);
  assert.equal(newerPendingRun(undefined, run(1, { ageMs: 10 * MIN }), nowMs, 90), null);
  const p = run(2, { ageMs: MIN, status: 'queued' });
  assert.equal(newerPendingRun([p], run(1, { ageMs: 10 * MIN }), nowMs, 90), p);
});

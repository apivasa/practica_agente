// C-05 — QA independiente del envío de alertas por correo (Resend simulado).
// Cada prueba traza a una frase del criterio de aceptación (plan maestro, C-05) o del
// diseño ("correo vía Resend a cada destinatario, las mismas alertas de su bandeja"):
//   [A1] una alerta → un correo por destinatario
//   [A2] correr dos veces no reenvía
//   [A3] sin secreto el workflow no falla y lo anota
//   [A4] el correo no expone datos de otras unidades
//   [A5] cada envío en auditoría
// Las alertas se generan con la evaluación real (scripts/lib/run.js) sobre la BD en
// memoria del escenario semilla; el envío usa sendAlertEmails/runEmailStep con un fetch
// inyectado (nunca se llama a Resend).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';
import { runMonthly, runDaily } from '../../scripts/lib/run.js';
import {
  sendAlertEmails,
  runEmailStep,
  readEmailConfig,
  RESEND_ENDPOINT,
  EMAIL_ACTOR,
  MAX_ATTEMPTS,
} from '../../scripts/lib/email.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KEY = 're_QAc05_secret_key_value_987654';
const CONFIG = { apiKey: KEY, from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };
const UNIT_NAMES = ['Unidad Alfa', 'Unidad Beta', 'Unidad Gamma'];
const noSleep = async () => {};

// Los usuarios reales son UUID de auth.users: el escenario se re-identifica con UUID.
const UID = {
  [IDS.committee]: 'c5c5c5c5-0000-4000-8000-000000000001',
  [IDS.leaders.alfa]: 'c5c5c5c5-0000-4000-8000-000000000002',
  [IDS.leaders.beta]: 'c5c5c5c5-0000-4000-8000-000000000003',
  [IDS.leaders.gamma]: 'c5c5c5c5-0000-4000-8000-000000000004',
  'p-gestora': 'c5c5c5c5-0000-4000-8000-000000000005',
};
const USERS = {
  committee: UID[IDS.committee],
  gestora: UID['p-gestora'],
  leaders: { alfa: UID[IDS.leaders.alfa], beta: UID[IDS.leaders.beta], gamma: UID[IDS.leaders.gamma] },
};
// Correos ficticios por usuario del escenario.
const EMAIL_OF = {
  [USERS.committee]: 'comite@qa.example.test',
  [USERS.leaders.alfa]: 'lider-alfa@qa.example.test',
  [USERS.leaders.beta]: 'lider-beta@qa.example.test',
  [USERS.leaders.gamma]: 'lider-gamma@qa.example.test',
  [USERS.gestora]: 'gestora@qa.example.test',
};
function uuidScenario() {
  const s = seedScenario();
  s.user_roles = s.user_roles.map((r) => ({ ...r, user_id: UID[r.user_id] ?? r.user_id }));
  return s;
}

/** Agrega el contrato EmailDb a la BD en memoria (mismas tablas que la evaluación). */
function withEmail(db, { emails = EMAIL_OF, failMark = false } = {}) {
  const t = db.tables;
  const ensure = (a) => {
    if (a.emailed_at === undefined) a.emailed_at = null;
    if (a.email_attempts === undefined) a.email_attempts = 0;
    return a;
  };
  db.userEmail = async (id) => emails[id] ?? null;
  db.pendingEmailAlerts = async ({ since, maxAttempts }) =>
    structuredClone(
      t.alerts.map(ensure).filter((a) => a.emailed_at === null && a.email_attempts < maxAttempts && a.sent_at >= since),
    ).sort((a, b) => (a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : a.id < b.id ? -1 : 1));
  db.markAlertEmailed = async (id, { emailedAt, attempts }) => {
    if (failMark) throw new Error('fallo de BD al marcar');
    const a = ensure(t.alerts.find((x) => x.id === id));
    if (a.emailed_at !== null) return false;
    a.emailed_at = emailedAt;
    a.email_attempts = attempts;
    return true;
  };
  db.recordAlertEmailFailure = async (id, { attempts }) => {
    const a = ensure(t.alerts.find((x) => x.id === id));
    if (a.emailed_at === null) a.email_attempts = attempts;
  };
  return db;
}

/**
 * F-11 (H-C06-01): runEmailStep exige a la BD los tres métodos de C-06. Se añaden a la BD
 * simulada: el destinatario es unit_leader vigente de la(s) unidad(es) de sus alertas, no
 * hay alertas vencidas y marcar como omitida no hace nada.
 */
function withC06(db, emails = EMAIL_OF) {
  db.recipientAccess = async (id) => ({
    email: emails[id] ?? null,
    bannedUntil: null,
    deletedAt: null,
    roles: db.tables.alerts.filter((a) => a.recipient_user_id === id).map((a) => ({ role: 'unit_leader', unit_id: a.unit_id })),
  });
  db.expiredEmailAlerts = async () => [];
  db.markAlertsEmailSkipped = async () => [];
  return db;
}

/** Resend simulado. `respond(call, n)` devuelve { status, body } o un Error. */
function resend(respond = (_c, n) => ({ status: 200, body: { id: `msg-${n}` } })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    const r = respond(call, calls.length);
    if (r instanceof Error) throw r;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
  return { calls, fetchImpl };
}

/** Escenario semilla con las alertas del cierre de enero (2027-02-01). */
async function scenarioWithAlerts() {
  const db = withEmail(createFakeDb(uuidScenario()));
  await runMonthly(db, { asOf: '2027-02-01' });
  assert.ok(db.tables.alerts.length > 0, 'precondición: la evaluación genera alertas');
  // La BD en memoria fecha sent_at en 2030-01-01; "ahora" es poco después.
  const now = () => new Date(Date.UTC(2030, 0, 1, 1));
  return { db, now };
}

const emailAudits = (db) => db.tables.audit_log.filter((a) => a.actor === EMAIL_ACTOR);
const mailText = (c) => `${c.body.subject}\n${c.body.text}\n${c.body.html}`;

describe('C-05 QA [A1] una alerta → un correo por destinatario', () => {
  test('cada fila de alerts produce exactamente un correo, a un único destinatario: el suyo', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const alerts = db.tables.alerts;
    assert.equal(s.sent, alerts.length);
    assert.equal(s.failed, 0);
    assert.equal(r.calls.length, alerts.length);
    for (const c of r.calls) {
      assert.equal(c.url, RESEND_ENDPOINT);
      assert.equal(c.init.method, 'POST');
      assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
      assert.deepEqual(Object.keys(c.body).includes('cc') || Object.keys(c.body).includes('bcc'), false);
      assert.equal(c.body.to.length, 1, 'un solo destinatario por correo (sin cc/bcc)');
    }
    // Cada alerta va al correo de su recipient_user_id.
    const byKey = new Map(r.calls.map((c) => [c.init.headers['Idempotency-Key'], c.body.to[0]]));
    for (const a of alerts) {
      assert.equal(byKey.get(`alert-email-${a.id}`), EMAIL_OF[a.recipient_user_id], `alerta ${a.id}`);
    }
  });

  test('un disparador de una unidad llega al líder de esa unidad y al comité (uno cada uno)', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const byTrigger = new Map();
    for (const a of db.tables.alerts) {
      const trigger = a.dedupe_key.slice(0, a.dedupe_key.lastIndexOf(':'));
      if (!byTrigger.has(trigger)) byTrigger.set(trigger, []);
      byTrigger.get(trigger).push(a);
    }
    assert.ok(byTrigger.size > 0);
    const leaderOf = { 'u-alfa': USERS.leaders.alfa, 'u-beta': USERS.leaders.beta, 'u-gamma': USERS.leaders.gamma };
    for (const [trigger, rows] of byTrigger) {
      const unit = rows[0].unit_id;
      const expected = [EMAIL_OF[USERS.committee], EMAIL_OF[leaderOf[unit]]].sort();
      const got = r.calls
        .filter((c) => rows.some((a) => c.init.headers['Idempotency-Key'] === `alert-email-${a.id}`))
        .map((c) => c.body.to[0])
        .sort();
      assert.deepEqual(got, expected, `disparador ${trigger}`);
    }
    // La gestora no es destinataria de alertas (diseño: líder de unidad y comité).
    assert.ok(!r.calls.some((c) => c.body.to[0] === EMAIL_OF[USERS.gestora]));
  });

  test('alertas del cierre mensual y del ritmo diario: todas salen, una vez cada una', async () => {
    const { db, now } = await scenarioWithAlerts();
    await runDaily(db, { asOf: '2027-02-10' });
    const r = resend();
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: () => new Date(Date.UTC(2030, 0, 1, 2)), sleep: noSleep });
    assert.equal(s.sent, db.tables.alerts.length);
    const keys = r.calls.map((c) => c.init.headers['Idempotency-Key']);
    assert.equal(new Set(keys).size, keys.length, 'sin correos duplicados en la misma corrida');
    void now;
  });
});

describe('C-05 QA [A2] correr dos veces no reenvía', () => {
  test('segunda corrida: cero llamadas a Resend y cero auditorías nuevas', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    const first = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const audits = emailAudits(db).length;
    const second = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    assert.equal(second.pending, 0);
    assert.equal(second.sent, 0);
    assert.equal(r.calls.length, first.sent);
    assert.equal(emailAudits(db).length, audits);
  });

  test('reprocesar la evaluación (mismas alertas por dedupe_key) tampoco reenvía', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    const first = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    await runMonthly(db, { asOf: '2027-02-01', reprocess: true });
    const again = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    assert.equal(again.sent, 0);
    assert.equal(r.calls.length, first.sent);
  });

  test('Idempotency-Key estable por alerta: si se reintenta tras un fallo al marcar, Resend recibe la misma clave', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    db.markAlertEmailed = async () => {
      throw new Error('fallo de BD al marcar');
    };
    const s1 = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    assert.equal(s1.sent, 0);
    assert.ok(s1.errors.length > 0, 'el fallo de BD queda en errors (código 1 en el paso)');
    const firstKeys = r.calls.map((c) => c.init.headers['Idempotency-Key']);
    withEmail(db); // la BD vuelve
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const secondKeys = r.calls.slice(firstKeys.length).map((c) => c.init.headers['Idempotency-Key']);
    assert.deepEqual(secondKeys.sort(), firstKeys.sort());
  });

  test('una alerta nueva tras la primera corrida: solo se envía esa', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    const first = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const extra = await db.insertAlerts([
      { unit_id: 'u-beta', recipient_user_id: USERS.leaders.beta, kind: 'pace_behind', dedupe_key: 'qa:nueva', payload: { unit_name: 'Unidad Beta', message: 'Unidad Beta: VULN va atrasado.' } },
    ]);
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: () => new Date(Date.UTC(2030, 0, 1, 3)), sleep: noSleep });
    assert.equal(s.sent, 1);
    assert.equal(r.calls.length, first.sent + 1);
    assert.equal(r.calls.at(-1).init.headers['Idempotency-Key'], `alert-email-${extra[0].id}`);
  });
});

describe('C-05 QA reintentos y errores de Resend', () => {
  const one = (extra = {}) => {
    const db = withEmail(createFakeDb({ alerts: [] }));
    db.tables.alerts.push({
      id: 'a-1',
      unit_id: 'u-alfa',
      recipient_user_id: '33333333-0000-4000-8000-000000000001',
      kind: 'color_change',
      payload: { unit_name: 'Unidad Alfa', message: 'Unidad Alfa: rojo.' },
      sent_at: '2027-02-01T11:07:00.000Z',
      read_at: null,
      emailed_at: null,
      email_attempts: 0,
      ...extra,
    });
    return db;
  };
  const EM = { '33333333-0000-4000-8000-000000000001': 'x@qa.example.test', '33333333-0000-4000-8000-000000000002': 'y@qa.example.test' };
  const NOW = () => new Date('2027-02-01T12:00:00Z');

  test('5xx persistente: se intenta hasta 3 veces (una por corrida) y luego se deja de intentar', async () => {
    const db = withEmail(one(), { emails: EM });
    const r = resend(() => ({ status: 500, body: { message: 'internal' } }));
    for (let i = 0; i < 5; i++) await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    assert.equal(MAX_ATTEMPTS, 3);
    assert.equal(r.calls.length, 3);
    assert.equal(db.tables.alerts[0].email_attempts, 3);
    assert.equal(db.tables.alerts[0].emailed_at, null);
    const fails = emailAudits(db).filter((a) => a.action === 'alert_email_failed');
    assert.deepEqual(fails.map((a) => a.details.attempt), [1, 2, 3]);
    assert.ok(fails.every((a) => a.entity === 'alerts' && a.entity_id === 'a-1'));
  });

  test('falla una vez y luego Resend acepta: queda enviado con 2 intentos y auditado', async () => {
    const db = withEmail(one(), { emails: EM });
    const r = resend((_c, n) => (n === 1 ? { status: 429, body: { message: 'rate limit' } } : { status: 200, body: { id: 'ok' } }));
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    assert.equal(r.calls.length, 2);
    assert.equal(db.tables.alerts[0].email_attempts, 2);
    assert.ok(db.tables.alerts[0].emailed_at);
    assert.deepEqual(emailAudits(db).map((a) => a.action), ['alert_email_failed', 'alert_emailed']);
    assert.equal(emailAudits(db)[1].details.attempt, 2);
  });

  test('con 2 intentos previos todavía se intenta el tercero; con 3 no', async () => {
    const r = resend();
    const db2 = withEmail(one({ email_attempts: 2 }), { emails: EM });
    assert.equal((await sendAlertEmails(db2, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep })).sent, 1);
    const db3 = withEmail(one({ email_attempts: 3 }), { emails: EM });
    assert.equal((await sendAlertEmails(db3, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep })).pending, 0);
    assert.equal(r.calls.length, 1);
  });

  test('error de Resend en una alerta no detiene las demás; el paso termina en 0 con ::warning::', async () => {
    const db = withC06(withEmail(one(), { emails: EM }), EM);
    db.tables.alerts.push({ ...db.tables.alerts[0], id: 'a-2', recipient_user_id: '33333333-0000-4000-8000-000000000002' });
    const r = resend((c) => (c.body.to[0] === 'x@qa.example.test' ? { status: 422, body: { message: 'invalid' } } : { status: 200, body: { id: 'ok' } }));
    const lines = [];
    const { code, summary } = await runEmailStep({
      env: { RESEND_API_KEY: KEY },
      fetchImpl: r.fetchImpl,
      makeDb: async () => db,
      readSupabaseConfig: () => ({ url: 'http://127.0.0.1', secretKey: 'x' }),
      log: (m) => lines.push(m),
      now: NOW,
      sleep: noSleep,
    });
    assert.equal(code, 0);
    assert.equal(summary.sent, 1);
    assert.equal(summary.failed, 1);
    assert.ok(lines.some((l) => l.startsWith('::warning::') && l.includes('a-1')));
  });

  test('Resend devuelve la clave o el correo en el error: no llegan al log ni a la auditoría', async () => {
    const db = withC06(withEmail(one(), { emails: EM }), EM);
    const r = resend(() => ({ status: 401, body: { message: `API key ${KEY} invalid for x@qa.example.test` } }));
    const lines = [];
    await runEmailStep({
      env: { RESEND_API_KEY: KEY },
      fetchImpl: r.fetchImpl,
      makeDb: async () => db,
      readSupabaseConfig: () => ({ url: 'http://127.0.0.1', secretKey: 'x' }),
      log: (m) => lines.push(m),
      now: NOW,
      sleep: noSleep,
    });
    const dump = JSON.stringify(db.tables.audit_log) + lines.join('\n');
    assert.ok(!dump.includes(KEY), 'la clave no aparece');
    assert.ok(!dump.includes('x@qa.example.test'), 'el correo no aparece');
    assert.ok(emailAudits(db).some((a) => a.action === 'alert_email_failed'));
  });

  test('red caída (fetch lanza): se registra como fallo con intento y auditoría', async () => {
    const db = withEmail(one(), { emails: EM });
    const r = resend(() => new TypeError('fetch failed'));
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    assert.equal(s.failed, 1);
    assert.equal(s.errors.length, 0);
    assert.equal(db.tables.alerts[0].email_attempts, 1);
    assert.equal(emailAudits(db)[0].action, 'alert_email_failed');
  });

  test('destinatario sin correo: no se llama a Resend, se audita el fallo y el resto sale', async () => {
    const db = withEmail(one(), { emails: { '33333333-0000-4000-8000-000000000002': 'y@qa.example.test' } });
    db.tables.alerts.push({ ...db.tables.alerts[0], id: 'a-2', recipient_user_id: '33333333-0000-4000-8000-000000000002' });
    const r = resend();
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].body.to[0], 'y@qa.example.test');
    assert.equal(s.failed, 1);
    const f = emailAudits(db).find((a) => a.action === 'alert_email_failed');
    assert.equal(f.entity_id, 'a-1');
  });

  test('destinatario con un "correo" que trae varios (coma) no se envía', async () => {
    const db = withEmail(one(), { emails: { '33333333-0000-4000-8000-000000000001': 'a@qa.example.test,b@qa.example.test' } });
    const r = resend();
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    assert.equal(r.calls.length, 0);
    assert.equal(s.failed, 1);
  });
});

describe('C-05 QA ventana de 7 días', () => {
  const NOW = new Date('2027-02-10T12:00:00.000Z');
  const at = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const DAY = 86400000;
  test('justo 7 días atrás entra; 7 días y 1 ms atrás no; la de hoy sí', async () => {
    const db = withEmail(createFakeDb({ alerts: [] }), { emails: { '33333333-0000-4000-8000-000000000001': 'x@qa.example.test' } });
    const base = { unit_id: 'u-alfa', recipient_user_id: '33333333-0000-4000-8000-000000000001', kind: 'color_change', payload: {}, read_at: null, emailed_at: null, email_attempts: 0 };
    db.tables.alerts.push(
      { ...base, id: 'borde', sent_at: at(7 * DAY) },
      { ...base, id: 'vieja', sent_at: at(7 * DAY + 1) },
      { ...base, id: 'hoy', sent_at: at(0) },
    );
    const r = resend();
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: () => NOW, sleep: noSleep });
    assert.equal(s.sent, 2);
    const ids = r.calls.map((c) => c.init.headers['Idempotency-Key']).sort();
    assert.deepEqual(ids, ['alert-email-borde', 'alert-email-hoy']);
    assert.equal(db.tables.alerts.find((a) => a.id === 'vieja').emailed_at, null);
  });

  test('la ventana por defecto es 7 días y se puede ajustar entre 1 y 31', () => {
    assert.equal(readEmailConfig({ RESEND_API_KEY: KEY }).lookbackDays, 7);
    assert.equal(readEmailConfig({ RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '1' }).lookbackDays, 1);
    assert.equal(readEmailConfig({ RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '31' }).lookbackDays, 31);
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '0' }));
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '32' }));
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '7.5' }));
  });
});

describe('C-05 QA [A3] sin secreto el workflow no falla y lo anota', () => {
  for (const [label, env] of [
    ['sin variable', {}],
    ['vacía', { RESEND_API_KEY: '' }],
    ['solo espacios', { RESEND_API_KEY: '   ' }],
  ]) {
    test(`RESEND_API_KEY ${label}: código 0, ::notice:: y no toca BD ni Resend`, async () => {
      const lines = [];
      let dbTouched = false;
      let fetched = false;
      const { code } = await runEmailStep({
        env: { ...env, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' },
        fetchImpl: async () => {
          fetched = true;
          throw new Error('no debe llamarse');
        },
        makeDb: async () => {
          dbTouched = true;
          throw new Error('no debe llamarse');
        },
        readSupabaseConfig: () => ({ url: 'https://x.supabase.co', secretKey: 'sb_secret_x' }),
        log: (m) => lines.push(m),
      });
      assert.equal(code, 0);
      assert.equal(dbTouched, false);
      assert.equal(fetched, false);
      assert.ok(lines.some((l) => l.startsWith('::notice::') && l.includes('RESEND_API_KEY')));
      assert.ok(!lines.some((l) => l.startsWith('::error::')));
    });
  }

  const WF = readFileSync(join(ROOT, '.github', 'workflows', 'correo-alertas.yml'), 'utf8');
  const code = WF.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  test('workflow: el paso de envío corre aunque falte RESEND_API_KEY (no se condiciona al secreto)', () => {
    const step = code.slice(code.indexOf('- name: Enviar correos'));
    assert.match(step, /RESEND_API_KEY:\s*\$\{\{\s*secrets\.RESEND_API_KEY\s*\}\}/);
    assert.match(step, /run:\s*node scripts\/send-alert-emails\.js\s*$/m);
    const ifLine = step.match(/^\s*if:.*$/m)?.[0] ?? '';
    assert.ok(!/RESEND/.test(ifLine), 'el if del paso no depende de RESEND_API_KEY');
  });

  test('workflow: no oculta fallos (sin continue-on-error ni || true) y permisos mínimos', () => {
    assert.ok(!/continue-on-error:\s*true/.test(code));
    assert.ok(!/\|\|\s*true/.test(code));
    assert.match(code, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
    assert.ok(!/contents:\s*write/.test(code));
  });

  test('workflow: programado y manual, sin cancelar una corrida en curso (evita envíos a medias)', () => {
    assert.match(code, /schedule:/);
    assert.match(code, /workflow_dispatch:/);
    assert.match(code, /cancel-in-progress:\s*false/);
  });

  test('workflow: no imprime secretos con echo', () => {
    assert.ok(!/echo[^\n]*\$\{\{\s*secrets\./.test(code));
    assert.ok(!/echo[^\n]*\$(RESEND_API_KEY|SUPABASE_SECRET_KEY)/.test(code));
  });
});

describe('C-05 QA [A4] el correo no expone datos de otras unidades', () => {
  test('cada correo menciona solo la unidad de su alerta', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const unitName = { 'u-alfa': 'Unidad Alfa', 'u-beta': 'Unidad Beta', 'u-gamma': 'Unidad Gamma' };
    const byKey = new Map(db.tables.alerts.map((a) => [`alert-email-${a.id}`, a]));
    for (const c of r.calls) {
      const a = byKey.get(c.init.headers['Idempotency-Key']);
      const body = mailText(c);
      assert.ok(body.includes(unitName[a.unit_id]), 'menciona su unidad');
      for (const other of UNIT_NAMES.filter((n) => n !== unitName[a.unit_id])) {
        assert.ok(!body.includes(other), `el correo de ${unitName[a.unit_id]} no menciona ${other}`);
      }
      for (const otherId of Object.keys(unitName).filter((u) => u !== a.unit_id)) {
        assert.ok(!body.includes(otherId), 'ni ids de otras unidades');
      }
    }
  });

  test('un líder solo recibe correos de alertas de su unidad', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const leaders = { [EMAIL_OF[USERS.leaders.alfa]]: 'Unidad Alfa', [EMAIL_OF[USERS.leaders.beta]]: 'Unidad Beta', [EMAIL_OF[USERS.leaders.gamma]]: 'Unidad Gamma' };
    for (const c of r.calls) {
      const own = leaders[c.body.to[0]];
      if (!own) continue;
      for (const other of UNIT_NAMES.filter((n) => n !== own)) assert.ok(!mailText(c).includes(other));
    }
  });

  test('el correo no incluye datos del payload que no muestra la bandeja ni correos de otras personas', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    for (const c of r.calls) {
      const body = mailText(c);
      for (const [uid, mail] of Object.entries(EMAIL_OF)) {
        if (mail !== c.body.to[0]) assert.ok(!body.includes(mail), 'sin correos de otras personas');
        assert.ok(!body.includes(uid), 'sin ids de usuarios');
      }
      assert.ok(!body.includes('dedupe'), 'sin claves internas');
    }
  });

  test('la auditoría no guarda el correo del destinatario', async () => {
    const { db, now } = await scenarioWithAlerts();
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: resend().fetchImpl, now, sleep: noSleep });
    const dump = JSON.stringify(emailAudits(db));
    for (const mail of Object.values(EMAIL_OF)) assert.ok(!dump.includes(mail));
  });
});

describe('C-05 QA escape de nombres (HTML y cabeceras)', () => {
  const NOW = () => new Date('2027-02-01T12:00:00Z');
  const evilUnit = '<img src=x onerror=alert(1)> & "Cía" \'Q\'';
  test('nombre de unidad y mensaje con HTML llegan escapados; sin saltos de línea en el asunto', async () => {
    const db = withEmail(createFakeDb({ alerts: [] }), { emails: { '33333333-0000-4000-8000-000000000001': 'x@qa.example.test' } });
    db.tables.alerts.push({
      id: 'a-x',
      unit_id: 'u-x',
      recipient_user_id: '33333333-0000-4000-8000-000000000001',
      kind: 'color_change',
      payload: { unit_name: `${evilUnit}\r\nBcc: espia@qa.example.test`, message: `${evilUnit}: <script>alert(2)</script>`, severity: 'high' },
      sent_at: '2027-02-01T11:07:00.000Z',
      read_at: null,
      emailed_at: null,
      email_attempts: 0,
    });
    const r = resend();
    await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now: NOW, sleep: noSleep });
    const { html, subject, to } = r.calls[0].body;
    assert.deepEqual(to, ['x@qa.example.test']);
    assert.ok(!/<\s*\/?\s*(?:img|script)\b/i.test(html), 'sin etiquetas inyectadas');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Cía&quot; &#39;Q&#39;'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!/[\r\n]/.test(subject), 'asunto en una línea');
    assert.ok(subject.startsWith('[Urgente] '));
  });
});

describe('C-05 QA [A5] cada envío en auditoría', () => {
  test('una fila alert_emailed por correo enviado, con la alerta, la unidad y el destinatario (id)', async () => {
    const { db, now } = await scenarioWithAlerts();
    const r = resend();
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    const sent = emailAudits(db).filter((a) => a.action === 'alert_emailed');
    assert.equal(sent.length, s.sent);
    assert.equal(sent.length, r.calls.length);
    const ids = new Set(sent.map((a) => a.entity_id));
    assert.equal(ids.size, sent.length, 'una por alerta');
    for (const a of db.tables.alerts) {
      const row = sent.find((x) => x.entity_id === a.id);
      assert.ok(row, `alerta ${a.id} auditada`);
      assert.equal(row.entity, 'alerts');
      assert.equal(row.details.unit_id, a.unit_id);
      assert.equal(row.details.recipient_user_id, a.recipient_user_id);
      assert.equal(row.details.provider, 'resend');
      assert.ok(row.details.provider_id, 'guarda el id de Resend');
    }
  });

  test('un envío marcado por otra corrida concurrente no se audita dos veces', async () => {
    const { db, now } = await scenarioWithAlerts();
    const orig = db.markAlertEmailed;
    let n = 0;
    db.markAlertEmailed = async (id, v) => {
      n += 1;
      if (n === 1) {
        await orig(id, v); // la otra corrida gana
        return false;
      }
      return orig(id, v);
    };
    const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: resend().fetchImpl, now, sleep: noSleep });
    assert.equal(s.skipped, 1);
    assert.equal(emailAudits(db).filter((a) => a.action === 'alert_emailed').length, db.tables.alerts.length - 1);
  });
});

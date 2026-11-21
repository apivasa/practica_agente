// C-06 — QA independiente del endurecimiento del correo de alertas.
// Cada prueba traza a una frase del criterio (plan maestro, fila C-06) o del hallazgo que
// corrige (docs/reportes/C-05-*.md):
//   [S] H-C05-01: "no enviar si el destinatario perdió rol/unidad o está bloqueado
//       (auditar `alert_email_skipped`)"; diseño: el correo lleva "las mismas alertas de
//       su bandeja" a cada destinatario (líder de la unidad o comité).
//   [R] H-C05-02: "redactar `sb_secret_` y JWT en `sanitizeError`".
//   [X] H-ARQ-C05-02: "salir con 1 si todo falla por 401/403" (y solo entonces).
//   [U] H-ARQ-C05-04: "`APP_URL` con valor por defecto" (el mismo que salud.yml).
//   [V] QA-C05-1: "auditar alertas que salen de la ventana sin enviarse" (una vez).
//   [H] H-ARQ-C05-01: "fila `correo-alertas.yml` en `WORKFLOW_RULES`".
// Las alertas salen de la evaluación real (scripts/lib/run.js) sobre la BD en memoria del
// escenario semilla; Resend se simula con un fetch inyectado (nunca se llama a la red).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';
import { withExpiredRpc } from './expired-rpc-fake.js';
import { runMonthly } from '../../scripts/lib/run.js';
import { sendAlertEmails, runEmailStep, readEmailConfig, sanitizeError, EMAIL_ACTOR, MAX_ATTEMPTS } from '../../scripts/lib/email.js';
import { WORKFLOW_RULES, assessWorkflow, DEFAULT_PAGES_URL } from '../../scripts/health/lib.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const KEY = 're_QAc06_resend_key_value_123456';
const CONFIG = { apiKey: KEY, from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };
const noSleep = async () => {};
const NOW = new Date(Date.UTC(2030, 0, 1, 1)); // la BD en memoria fecha sent_at en 2030-01-01
const now = () => NOW;

const UID = {
  [IDS.committee]: 'c6c6c6c6-0000-4000-8000-000000000001',
  [IDS.leaders.alfa]: 'c6c6c6c6-0000-4000-8000-000000000002',
  [IDS.leaders.beta]: 'c6c6c6c6-0000-4000-8000-000000000003',
  [IDS.leaders.gamma]: 'c6c6c6c6-0000-4000-8000-000000000004',
  'p-gestora': 'c6c6c6c6-0000-4000-8000-000000000005',
};
const COMMITTEE = UID[IDS.committee];
const LEADER = { alfa: UID[IDS.leaders.alfa], beta: UID[IDS.leaders.beta], gamma: UID[IDS.leaders.gamma] };
const GESTORA = UID['p-gestora'];
const CUSTODIAN = 'c6c6c6c6-0000-4000-8000-000000000006';
const EMAIL_OF = {
  [COMMITTEE]: 'comite@qa6.example.test',
  [LEADER.alfa]: 'lider-alfa@qa6.example.test',
  [LEADER.beta]: 'lider-beta@qa6.example.test',
  [LEADER.gamma]: 'lider-gamma@qa6.example.test',
  [GESTORA]: 'gestora@qa6.example.test',
  [CUSTODIAN]: 'custodio@qa6.example.test',
};

/**
 * Contrato EmailDb completo (C-05 + C-06) sobre las tablas en memoria. El acceso del
 * destinatario se lee "en vivo" de user_roles y de un Auth simulado, para poder cambiar
 * el rol o bloquear la cuenta después de generada la alerta.
 */
function withEmail(db) {
  const t = db.tables;
  const auth = Object.fromEntries(Object.entries(EMAIL_OF).map(([id, email]) => [id, { email, banned_until: null, deleted_at: null }]));
  const ensure = (a) => {
    a.emailed_at ??= null;
    a.email_attempts ??= 0;
    a.email_skipped_at ??= null;
    a.email_skip_reason ??= null;
    return a;
  };
  const open = (a) => a.emailed_at === null && a.email_skipped_at === null;
  const bySent = (a, b) => (a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : a.id < b.id ? -1 : 1);
  const stats = { recipientAccess: 0 };
  db.auth = auth;
  db.stats = stats;
  db.userEmail = async (id) => auth[id]?.email ?? null;
  db.recipientAccess = async (id) => {
    stats.recipientAccess += 1;
    const u = auth[id];
    if (!u) return null;
    return {
      email: u.email,
      bannedUntil: u.banned_until,
      deletedAt: u.deleted_at,
      roles: t.user_roles.filter((r) => r.user_id === id).map((r) => ({ role: r.role, unit_id: r.unit_id ?? null })),
    };
  };
  db.pendingEmailAlerts = async ({ since, maxAttempts }) =>
    structuredClone(t.alerts.map(ensure).filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at >= since)).sort(bySent);
  db.expiredEmailAlerts = async ({ before, maxAttempts, limit }) =>
    structuredClone(t.alerts.map(ensure).filter((a) => open(a) && a.email_attempts < maxAttempts && a.sent_at < before))
      .sort(bySent)
      .slice(0, limit);
  db.markAlertsEmailSkipped = async (ids, { skippedAt, reason }) => {
    const out = [];
    for (const a of t.alerts.map(ensure)) {
      if (ids.includes(a.id) && open(a)) {
        a.email_skipped_at = skippedAt;
        a.email_skip_reason = reason;
        out.push(a.id);
      }
    }
    return out;
  };
  db.markAlertEmailed = async (id, { emailedAt, attempts }) => {
    const a = ensure(t.alerts.find((x) => x.id === id));
    if (!open(a)) return false;
    a.emailed_at = emailedAt;
    a.email_attempts = attempts;
    return true;
  };
  db.recordAlertEmailFailure = async (id, { attempts }) => {
    const a = ensure(t.alerts.find((x) => x.id === id));
    if (a.emailed_at === null) a.email_attempts = attempts;
  };
  // F-13 (H-F12-01): runEmailStep exige la RPC atómica de `expired`; la simulada marca y
  // audita como la real (tests/scripts/expired-rpc-fake.js).
  return withExpiredRpc(db);
}

function resend(respond = (_c, n) => ({ status: 200, body: { id: `msg-${n}` } })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    const r = respond(call, calls.length);
    if (r instanceof Error) throw r;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(text), text: async () => text };
  };
  const toOf = (alertId) => calls.find((c) => c.init.headers['Idempotency-Key'] === `alert-email-${alertId}`)?.body.to[0];
  return { calls, fetchImpl, toOf };
}

async function scenario() {
  const s = seedScenario();
  s.user_roles = s.user_roles.map((r) => ({ ...r, user_id: UID[r.user_id] ?? r.user_id }));
  const db = withEmail(createFakeDb(s));
  await runMonthly(db, { asOf: '2027-02-01' });
  assert.ok(db.tables.alerts.length > 0, 'precondición: la evaluación genera alertas');
  return db;
}
const send = (db, r, extra = {}) => sendAlertEmails(db, { config: CONFIG, fetchImpl: r.fetchImpl, now, sleep: noSleep, ...extra });
const audits = (db, action) => db.tables.audit_log.filter((a) => a.actor === EMAIL_ACTOR && (!action || a.action === action));
const alertsOf = (db, userId) => db.tables.alerts.filter((a) => a.recipient_user_id === userId);
const removeRoles = (db, userId) => {
  db.tables.user_roles = db.tables.user_roles.filter((r) => r.user_id !== userId);
};

/** Ejecuta runEmailStep con BD y Resend simulados; devuelve código y líneas de log. */
async function step(db, r, env = {}) {
  const lines = [];
  const out = await runEmailStep({
    env: { RESEND_API_KEY: KEY, ...env },
    fetchImpl: r.fetchImpl,
    makeDb: async () => db,
    readSupabaseConfig: () => ({ url: 'https://qa6.supabase.co', secretKey: 'sb_secret_qa6_ficticia' }),
    log: (m) => lines.push(m),
    now,
    sleep: noSleep,
  });
  return { ...out, lines };
}

describe('[S] H-C05-01: solo se envía a destinatarios con rol vigente y cuenta activa', () => {
  test('reproducción del hallazgo: el líder de Beta pierde su rol tras la alerta → no sale correo y se audita alert_email_skipped', async () => {
    const db = await scenario();
    const mine = alertsOf(db, LEADER.beta);
    assert.ok(mine.length > 0, 'precondición: hay alertas para el líder de Beta');
    removeRoles(db, LEADER.beta);
    const r = resend();
    const s = await send(db, r);
    for (const a of mine) assert.equal(r.toOf(a.id), undefined, `no debe enviarse la alerta ${a.id}`);
    assert.ok(!r.calls.some((c) => c.body.to[0] === EMAIL_OF[LEADER.beta]));
    const rows = audits(db, 'alert_email_skipped').filter((x) => mine.some((a) => a.id === x.entity_id));
    assert.equal(rows.length, mine.length, 'una auditoría por alerta omitida');
    for (const x of rows) {
      assert.equal(x.entity, 'alerts');
      assert.equal(x.details.reason, 'recipient_no_role');
      assert.equal(x.details.recipient_user_id, LEADER.beta);
    }
    assert.equal(s.notEligible, mine.length);
    // El resto de destinatarios sigue recibiendo lo suyo.
    assert.equal(s.sent, db.tables.alerts.length - mine.length);
    assert.equal(s.failed, 0, 'omitir no es fallar');
  });

  test('omitida no se reintenta: ni consume intentos, ni deja alert_email_failed, ni se repite en la siguiente corrida', async () => {
    const db = await scenario();
    removeRoles(db, LEADER.beta);
    await send(db, resend());
    const mine = alertsOf(db, LEADER.beta);
    for (const a of mine) {
      assert.equal(a.email_attempts, 0);
      assert.equal(a.emailed_at, null);
      assert.equal(a.email_skip_reason, 'recipient_no_role');
    }
    assert.equal(audits(db, 'alert_email_failed').length, 0);
    const before = audits(db).length;
    // Aunque recupere el rol, una alerta omitida no se envía después (no se reintenta).
    db.tables.user_roles.push({ user_id: LEADER.beta, role: 'unit_leader', unit_id: 'u-beta' });
    const r2 = resend();
    const s2 = await send(db, r2);
    assert.equal(r2.calls.length, 0);
    assert.equal(s2.pending, 0);
    assert.equal(audits(db).length, before, 'sin auditorías nuevas');
  });

  test('perdió la unidad: líder trasladado a otra unidad no recibe las alertas de la anterior', async () => {
    const db = await scenario();
    const mine = alertsOf(db, LEADER.beta);
    db.tables.user_roles = db.tables.user_roles.map((x) => (x.user_id === LEADER.beta ? { ...x, unit_id: 'u-alfa' } : x));
    const r = resend();
    await send(db, r);
    for (const a of mine) {
      assert.equal(r.toOf(a.id), undefined);
      assert.equal(a.email_skip_reason, 'recipient_no_role');
    }
  });

  test('líder de varias unidades: conserva el correo de la unidad que mantiene', async () => {
    const db = await scenario();
    const mine = alertsOf(db, LEADER.beta);
    db.tables.user_roles.push({ user_id: LEADER.beta, role: 'unit_leader', unit_id: 'u-alfa' });
    const r = resend();
    await send(db, r);
    for (const a of mine) assert.equal(r.toOf(a.id), EMAIL_OF[LEADER.beta]);
  });

  test('el comité recibe las alertas de cualquier unidad; si deja el comité, ya no', async () => {
    const db = await scenario();
    const units = new Set(alertsOf(db, COMMITTEE).map((a) => a.unit_id));
    assert.ok(units.size > 1, 'precondición: el comité tiene alertas de varias unidades');
    const r = resend();
    await send(db, r);
    for (const a of alertsOf(db, COMMITTEE)) assert.equal(r.toOf(a.id), EMAIL_OF[COMMITTEE]);

    const db2 = await scenario();
    removeRoles(db2, COMMITTEE);
    const r2 = resend();
    await send(db2, r2);
    assert.ok(!r2.calls.some((c) => c.body.to[0] === EMAIL_OF[COMMITTEE]));
    for (const a of alertsOf(db2, COMMITTEE)) assert.equal(a.email_skip_reason, 'recipient_no_role');
  });

  test('roles que no son destinatarios (gestora, custodio) no habilitan el correo de una alerta', async () => {
    for (const role of ['kpi_manager', 'custodian']) {
      const db = await scenario();
      const mine = alertsOf(db, LEADER.beta);
      removeRoles(db, LEADER.beta);
      db.tables.user_roles.push({ user_id: LEADER.beta, role, unit_id: role === 'custodian' ? 'u-beta' : null });
      const r = resend();
      await send(db, r);
      for (const a of mine) {
        assert.equal(r.toOf(a.id), undefined, `${role} no recibe`);
        assert.equal(a.email_skip_reason, 'recipient_no_role');
      }
    }
  });

  test('cuenta bloqueada (banned_until futuro, incluso por 1 s): recipient_banned, sin llamada a Resend', async () => {
    const db = await scenario();
    db.auth[LEADER.gamma].banned_until = new Date(NOW.getTime() + 1000).toISOString();
    const r = resend();
    await send(db, r);
    const mine = alertsOf(db, LEADER.gamma);
    assert.ok(mine.length > 0);
    for (const a of mine) {
      assert.equal(r.toOf(a.id), undefined);
      assert.equal(a.email_skip_reason, 'recipient_banned');
    }
    const rows = audits(db, 'alert_email_skipped').filter((x) => x.details.reason === 'recipient_banned');
    assert.equal(rows.length, mine.length);
  });

  test('bloqueo vencido (banned_until pasado o igual a ahora): el correo sale', async () => {
    for (const until of [new Date(NOW.getTime() - 1000), NOW]) {
      const db = await scenario();
      db.auth[LEADER.gamma].banned_until = until.toISOString();
      const r = resend();
      await send(db, r);
      for (const a of alertsOf(db, LEADER.gamma)) assert.equal(r.toOf(a.id), EMAIL_OF[LEADER.gamma], `banned_until=${until.toISOString()}`);
    }
  });

  test('usuario borrado o inexistente en Auth: recipient_missing, sin correo', async () => {
    const db = await scenario();
    db.auth[LEADER.gamma].deleted_at = new Date(NOW.getTime() - 3600000).toISOString();
    delete db.auth[LEADER.beta];
    const r = resend();
    await send(db, r);
    for (const id of [LEADER.gamma, LEADER.beta]) {
      for (const a of alertsOf(db, id)) {
        assert.equal(r.toOf(a.id), undefined);
        assert.equal(a.email_skip_reason, 'recipient_missing');
      }
    }
  });

  test('la auditoría de la omisión no contiene correos ni la clave', async () => {
    const db = await scenario();
    removeRoles(db, LEADER.beta);
    db.auth[LEADER.gamma].banned_until = '2099-01-01T00:00:00Z';
    await send(db, resend());
    const rows = audits(db, 'alert_email_skipped');
    assert.ok(rows.length > 0);
    const text = JSON.stringify(rows);
    assert.doesNotMatch(text, /@/);
    assert.ok(!text.includes(KEY));
  });
});

describe('[R] H-C05-02: sanitizeError redacta sb_secret_ y JWT', () => {
  const SB = 'sb_secret_AbC123-xyz_987654321';
  // JWT ficticio armado en ejecución (un literal con forma de JWT dispara gitleaks).
  const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  const JWT = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ role: 'qa_ficticio' }), b64('firma-ficticia-qa')].join('.');
  test('la clave secreta de Supabase no queda en el texto (ni fragmentos)', () => {
    const out = sanitizeError(new Error(`Invalid API key: ${SB} rechazada`), KEY);
    assert.ok(!out.includes('sb_secret_'));
    assert.ok(!out.includes('AbC123'));
    assert.match(out, /rechazada/, 'el resto del mensaje se conserva');
  });

  test('un JWT completo (también tras "Bearer") no queda en el texto, ni su firma ni su payload', () => {
    const out = sanitizeError(`Authorization: Bearer ${JWT} expirado`, KEY);
    for (const part of JWT.split('.')) assert.ok(!out.includes(part), `queda ${part.slice(0, 10)}...`);
    assert.match(out, /expirado/);
  });

  test('varias credenciales en el mismo mensaje se redactan todas', () => {
    const out = sanitizeError(`a=${SB} b=${JWT} c=${KEY} d=re_OtraClaveResend_abcdef`, KEY);
    assert.doesNotMatch(out, /sb_secret_|eyJ|re_[A-Za-z0-9]{8}/);
  });

  test('extremo a extremo: un error de Resend y otro de red con credenciales no llegan ni al log ni a audit_log', async () => {
    const db = await scenario();
    const r = resend((_c, n) => (n % 2 ? { status: 500, body: { message: `upstream ${SB}` } } : new Error(`socket ${JWT}`)));
    const { lines } = await step(db, r);
    const everything = `${lines.join('\n')}\n${JSON.stringify(db.tables.audit_log)}`;
    assert.ok(audits(db, 'alert_email_failed').length >= 2, 'precondición: hubo fallos auditados');
    assert.ok(!everything.includes(SB));
    for (const part of JWT.split('.')) assert.ok(!everything.includes(part));
    assert.ok(!everything.includes(KEY));
  });
});

describe('[X] H-ARQ-C05-02: código 1 solo si todo falla por 401/403', () => {
  const byStatus = (statuses) => resend((_c, n) => {
    const s = statuses[(n - 1) % statuses.length];
    return s instanceof Error ? s : { status: s, body: { message: `HTTP ${s}` } };
  });
  for (const statuses of [[401], [403], [401, 403]]) {
    test(`todos los envíos con ${statuses.join('/')}: código 1 y ::error:: que orienta a la clave/remitente`, async () => {
      const db = await scenario();
      const { code, lines, summary } = await step(db, byStatus(statuses));
      assert.equal(summary.sent, 0);
      assert.ok(summary.failed > 1);
      assert.equal(code, 1);
      assert.ok(lines.some((l) => l.startsWith('::error::') && /RESEND_API_KEY|ALERT_EMAIL_FROM/.test(l)));
    });
  }

  test('algún correo sale aunque el resto dé 403 (remitente de pruebas): código 0', async () => {
    const db = await scenario();
    const r = resend((_c, n) => (n === 1 ? { status: 200, body: { id: 'ok' } } : { status: 403, body: {} }));
    const { code, summary } = await step(db, r);
    assert.equal(summary.sent, 1);
    assert.equal(code, 0);
  });

  test('401 mezclado con un fallo de otro tipo (500, red): código 0 (no es solo configuración)', async () => {
    for (const other of [500, 429, new Error('ECONNRESET')]) {
      const db = await scenario();
      const { code, summary } = await step(db, byStatus([401, other]));
      assert.equal(summary.sent, 0);
      assert.equal(code, 0, `401 + ${other instanceof Error ? 'red' : other}`);
    }
  });

  test('401 junto con un destinatario sin correo válido (fallo sin HTTP): código 0', async () => {
    const db = await scenario();
    db.auth[LEADER.beta].email = 'no-es-correo';
    const { code, summary } = await step(db, byStatus([401]));
    assert.ok(summary.failures.some((f) => f.status === null));
    assert.equal(code, 0);
  });

  test('sin fallos: solo omisiones (destinatarios sin rol) o nada pendiente → código 0 sin ::error::', async () => {
    const db = await scenario();
    db.tables.user_roles = [];
    const r = resend();
    const a = await step(db, r);
    assert.equal(r.calls.length, 0);
    assert.ok(a.summary.notEligible > 0);
    assert.equal(a.code, 0);
    assert.ok(!a.lines.some((l) => l.startsWith('::error::')));
    const b = await step(db, r);
    assert.equal(b.summary.pending, 0);
    assert.equal(b.code, 0);
  });

  test('401 de una corrida no impide los reintentos: el contador sube y a los 3 intentos se deja', async () => {
    const db = await scenario();
    for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await step(db, byStatus([401]))).code, 1);
    const last = await step(db, byStatus([401]));
    assert.equal(last.summary.pending, 0);
    assert.equal(last.code, 0, 'sin pendientes ya no hay nada que fallar');
  });
});

describe('[U] H-ARQ-C05-04: APP_URL con valor por defecto', () => {
  test('sin APP_URL (o vacía, o solo espacios) se usa la misma URL que salud.yml', () => {
    for (const env of [{}, { APP_URL: '' }, { APP_URL: '   ' }]) {
      assert.equal(readEmailConfig({ RESEND_API_KEY: KEY, ...env }).appUrl, DEFAULT_PAGES_URL);
    }
  });

  test('correo-alertas.yml sigue pasando vars.PAGES_URL (vacía si no existe → valor por defecto)', () => {
    assert.match(read('.github/workflows/correo-alertas.yml'), /APP_URL:\s*\$\{\{\s*vars\.PAGES_URL\s*\}\}/);
  });

  test('el correo enviado sin APP_URL lleva el enlace «Ver en la app» a la URL por defecto', async () => {
    const db = await scenario();
    const r = resend();
    const { code } = await step(db, r, {});
    assert.equal(code, 0);
    assert.ok(r.calls.length > 0);
    for (const c of r.calls) {
      // Se compara la URL parseada, no por subcadena (F-08).
      const href = c.body.html.match(/<a href="([^"]+)">Ver en la app<\/a>/)?.[1];
      const inText = c.body.text.match(/Ver en la app: (\S+)/)?.[1];
      assert.ok(href && inText, 'el correo lleva el enlace en html y texto');
      assert.equal(new URL(href).href, new URL(DEFAULT_PAGES_URL).href, 'html con el enlace por defecto');
      assert.equal(new URL(inText).href, new URL(DEFAULT_PAGES_URL).href, 'texto con el enlace por defecto');
    }
  });

  test('APP_URL no https se sigue rechazando (código 2, sin envíos)', async () => {
    const db = await scenario();
    const r = resend();
    const { code } = await step(db, r, { APP_URL: 'http://ejemplo.test/' });
    assert.equal(code, 2);
    assert.equal(r.calls.length, 0);
  });
});

describe('[V] QA-C05-1: alertas que salen de la ventana sin enviarse se auditan una vez', () => {
  const DAY = 86400000;
  const age = (db, a, ms) => {
    a.sent_at = new Date(NOW.getTime() - ms).toISOString();
  };

  test('vencida: no se envía, queda expired y una sola auditoría; corridas siguientes no la repiten', async () => {
    const db = await scenario();
    const [old] = db.tables.alerts;
    age(db, old, 8 * DAY);
    const r = resend();
    const s = await send(db, r);
    assert.equal(r.toOf(old.id), undefined);
    assert.equal(old.email_skip_reason, 'expired');
    assert.equal(s.expired, 1);
    const rows = audits(db, 'alert_email_skipped').filter((x) => x.entity_id === old.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].details.reason, 'expired');
    assert.doesNotMatch(JSON.stringify(rows), /@/);
    for (let i = 0; i < 2; i++) {
      const again = await send(db, resend());
      assert.equal(again.expired, 0);
    }
    assert.equal(audits(db, 'alert_email_skipped').filter((x) => x.entity_id === old.id).length, 1);
  });

  test('borde: sent_at justo en el inicio de la ventana se envía; 1 ms antes, vence', async () => {
    const db = await scenario();
    const [edge, before] = db.tables.alerts;
    age(db, edge, 7 * DAY);
    age(db, before, 7 * DAY + 1);
    const r = resend();
    await send(db, r);
    assert.equal(r.toOf(edge.id), EMAIL_OF[edge.recipient_user_id]);
    assert.equal(edge.email_skipped_at, null);
    assert.equal(before.email_skip_reason, 'expired');
  });

  test('no vencen ni se auditan como vencidas: las ya enviadas, las ya omitidas ni las que agotaron sus 3 intentos (ya auditadas como fallo)', async () => {
    const db = await scenario();
    const [sent, skipped, exhausted] = db.tables.alerts;
    for (const a of [sent, skipped, exhausted]) age(db, a, 10 * DAY);
    sent.emailed_at = new Date(NOW.getTime() - 9 * DAY).toISOString();
    skipped.email_skipped_at = new Date(NOW.getTime() - 9 * DAY).toISOString();
    skipped.email_skip_reason = 'recipient_no_role';
    exhausted.email_attempts = MAX_ATTEMPTS;
    const s = await send(db, resend());
    assert.equal(s.expired, 0);
    assert.equal(skipped.email_skip_reason, 'recipient_no_role', 'no se reescribe el motivo');
    assert.equal(exhausted.email_skipped_at, null);
    assert.equal(audits(db, 'alert_email_skipped').length, 0);
  });

  test('con intentos fallidos previos (1 o 2) también se audita al vencer', async () => {
    const db = await scenario();
    const [a] = db.tables.alerts;
    a.email_attempts = 2;
    age(db, a, 8 * DAY);
    await send(db, resend());
    const rows = audits(db, 'alert_email_skipped').filter((x) => x.entity_id === a.id);
    assert.equal(rows.length, 1);
    assert.equal(a.email_skip_reason, 'expired');
  });

  test('la ventana configurada (ALERT_EMAIL_LOOKBACK_DAYS) define el vencimiento', async () => {
    const db = await scenario();
    const [a] = db.tables.alerts;
    age(db, a, 2 * DAY);
    const r = resend();
    await sendAlertEmails(db, { config: { ...CONFIG, lookbackDays: 1 }, fetchImpl: r.fetchImpl, now, sleep: noSleep });
    assert.equal(a.email_skip_reason, 'expired');
    assert.equal(r.toOf(a.id), undefined);
  });
});

describe('[H] H-ARQ-C05-01: salud.yml vigila correo-alertas.yml', () => {
  const rule = WORKFLOW_RULES.find((r) => r.file === 'correo-alertas.yml');
  const workflow = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
  const at = new Date('2027-03-10T15:00:00Z');
  const run = (hoursAgo, conclusion = 'success') => ({
    id: 7,
    status: 'completed',
    conclusion,
    event: 'schedule',
    created_at: new Date(at.getTime() - hoursAgo * 3600000).toISOString(),
    run_started_at: new Date(at.getTime() - hoursAgo * 3600000).toISOString(),
    updated_at: new Date(at.getTime() - hoursAgo * 3600000 + 60000).toISOString(),
  });

  test('existe la fila, exige producción y su paso obligatorio existe en el workflow', () => {
    assert.ok(rule, 'falta la fila correo-alertas.yml');
    assert.equal(rule.check, 'correo-alertas');
    assert.equal(rule.requiresProduction, true);
    const yml = read('.github/workflows/correo-alertas.yml');
    assert.ok(yml.includes(`- name: ${rule.requiredStep}`), `el paso "${rule.requiredStep}" no está en el workflow`);
  });

  test('deshabilitado (cron apagado por inactividad): falla aunque no haya producción', () => {
    const r = assessWorkflow(rule, { workflow: { ...workflow, state: 'disabled_inactivity' }, runs: [], now: at, productionEnabled: false });
    assert.equal(r.status, 'fail');
  });

  test('con producción: run fallido o demasiado antiguo falla; uno reciente y correcto pasa', () => {
    assert.equal(assessWorkflow(rule, { workflow, runs: [run(2, 'failure')], now: at, productionEnabled: true }).status, 'fail');
    assert.equal(assessWorkflow(rule, { workflow, runs: [run(rule.maxAgeHours + 1)], now: at, productionEnabled: true }).status, 'fail');
    // F-19 (QA): jobs reales del run, con el paso «Enviar correos» en success.
    const jobs = [{ id: 700, run_id: 7, status: 'completed', conclusion: 'success', steps: [{ name: rule.requiredStep, conclusion: 'success' }] }];
    assert.equal(assessWorkflow(rule, { workflow, runs: [run(2)], jobs, now: at, productionEnabled: true }).status, 'ok');
  });

  test('con producción, el paso «Enviar correos» omitido (falta un secreto) falla', () => {
    const jobs = [{ steps: [{ name: rule.requiredStep, conclusion: 'skipped' }] }];
    assert.equal(assessWorkflow(rule, { workflow, runs: [run(2)], jobs, now: at, productionEnabled: true }).status, 'fail');
  });
});

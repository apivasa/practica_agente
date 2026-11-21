// C-05: envío de alertas por correo con Resend simulado (fetch inyectado) y BD en memoria.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendAlertEmails,
  runEmailStep,
  readEmailConfig,
  sanitizeError,
  isValidFrom,
  RESEND_ENDPOINT,
  DEFAULT_FROM,
  EMAIL_ACTOR,
  MAX_ATTEMPTS,
} from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';

const KEY = 're_TESTKEY_do_not_leak_123456';
const NOW = new Date('2027-02-01T12:00:00Z');
const U1 = '11111111-0000-4000-8000-000000000001';
const U2 = '11111111-0000-4000-8000-000000000002';
const L1 = '22222222-0000-4000-8000-000000000001';
const L2 = '22222222-0000-4000-8000-000000000002';
const CM = '22222222-0000-4000-8000-000000000003';
const EMAILS = { [L1]: 'lider1@example.test', [L2]: 'lider2@example.test', [CM]: 'comite@example.test' };
const CONFIG = { apiKey: KEY, from: DEFAULT_FROM, appUrl: null, lookbackDays: 7 };

const row = (id, unit, recipient, unitName, extra = {}) => ({
  id,
  unit_id: unit,
  recipient_user_id: recipient,
  kind: 'color_change',
  payload: { unit_name: unitName, message: `${unitName}: el color pasó de verde a rojo en 2027-01.`, severity: 'high' },
  sent_at: '2027-02-01T11:07:00Z',
  emailed_at: null,
  email_attempts: 0,
  ...extra,
});

/** BD en memoria con el contrato EmailDb. */
function fakeDb(alerts, { emails = EMAILS, userEmailError = null } = {}) {
  const t = { alerts: structuredClone(alerts), audit_log: [] };
  const lookups = [];
  return {
    t,
    lookups,
    async pendingEmailAlerts({ since, maxAttempts }) {
      return structuredClone(
        t.alerts.filter((a) => a.emailed_at === null && a.email_attempts < maxAttempts && a.sent_at >= since),
      );
    },
    async userEmail(id) {
      lookups.push(id);
      if (userEmailError) throw userEmailError;
      return emails[id] ?? null;
    },
    async markAlertEmailed(id, { emailedAt, attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (!a || a.emailed_at !== null) return false;
      a.emailed_at = emailedAt;
      a.email_attempts = attempts;
      return true;
    },
    async recordAlertEmailFailure(id, { attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (a && a.emailed_at === null) a.email_attempts = attempts;
    },
    async insertAudit(rows) {
      t.audit_log.push(...structuredClone(rows));
    },
  };
}

/** Resend simulado: guarda cada petición y responde según `respond`. */
function fakeResend(respond = () => ({ status: 200, body: { id: `re-${Math.random().toString(36).slice(2)}` } })) {
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
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return { calls, fetchImpl };
}

const opts = (fetchImpl, extra = {}) => ({ config: CONFIG, fetchImpl, now: () => NOW, sleep: async () => {}, ...extra });

describe('sendAlertEmails', () => {
  test('una alerta → un correo por destinatario, cada uno con solo su alerta', async () => {
    const db = fakeDb([
      row('a-l1', U1, L1, 'Unidad Uno'),
      row('a-cm1', U1, CM, 'Unidad Uno'),
      row('a-l2', U2, L2, 'Unidad Dos'),
    ]);
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.deepEqual({ pending: s.pending, sent: s.sent, failed: s.failed, errors: s.errors }, { pending: 3, sent: 3, failed: 0, errors: [] });
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.url, RESEND_ENDPOINT);
      assert.equal(c.init.method, 'POST');
      assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
      assert.equal(c.body.from, DEFAULT_FROM);
      assert.equal(c.body.to.length, 1);
    }
    const byTo = Object.fromEntries(calls.map((c) => [c.body.to[0], c]));
    assert.match(byTo['lider1@example.test'].body.text, /Unidad Uno/);
    assert.doesNotMatch(byTo['lider1@example.test'].body.text + byTo['lider1@example.test'].body.html, /Unidad Dos/);
    assert.match(byTo['lider2@example.test'].body.text, /Unidad Dos/);
    assert.doesNotMatch(byTo['lider2@example.test'].body.text + byTo['lider2@example.test'].body.html, /Unidad Uno/);
    assert.equal(byTo['lider1@example.test'].init.headers['Idempotency-Key'], 'alert-email-a-l1');
    assert.ok(db.t.alerts.every((a) => a.emailed_at === NOW.toISOString() && a.email_attempts === 1));
  });

  test('cada envío queda en audit_log (sin el correo del destinatario)', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno'), row('a-l2', U2, L2, 'Unidad Dos')]);
    const { fetchImpl } = fakeResend(() => ({ status: 200, body: { id: 'prov-1' } }));
    await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(db.t.audit_log.length, 2);
    for (const a of db.t.audit_log) {
      assert.equal(a.actor, EMAIL_ACTOR);
      assert.equal(a.action, 'alert_emailed');
      assert.equal(a.entity, 'alerts');
      assert.equal(a.details.provider_id, 'prov-1');
    }
    assert.deepEqual(db.t.audit_log.map((a) => a.entity_id).sort(), ['a-l1', 'a-l2']);
    assert.doesNotMatch(JSON.stringify(db.t.audit_log), /@example\.test|re_TESTKEY/);
  });

  test('correr dos veces no reenvía ni vuelve a auditar', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno'), row('a-l2', U2, L2, 'Unidad Dos')]);
    const { calls, fetchImpl } = fakeResend();
    await sendAlertEmails(db, opts(fetchImpl));
    const second = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(calls.length, 2);
    assert.equal(second.pending, 0);
    assert.equal(second.sent, 0);
    assert.equal(db.t.audit_log.length, 2);
  });

  test('si otra corrida ya la marcó, no se audita como enviada otra vez', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno')]);
    db.markAlertEmailed = async () => false;
    const { fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.sent, 0);
    assert.equal(s.skipped, 1);
    assert.equal(db.t.audit_log.length, 0);
  });

  test('error de Resend: se registra, no detiene el resto y se reintenta hasta MAX_ATTEMPTS', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno'), row('a-l2', U2, L2, 'Unidad Dos')]);
    const { calls, fetchImpl } = fakeResend((c) =>
      c.body.to[0] === 'lider1@example.test'
        ? { status: 403, body: { name: 'validation_error', message: `You can only send testing emails to your own email address (lider1@example.test). key ${KEY}` } }
        : { status: 200, body: { id: 'ok' } },
    );
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.sent, 1);
    assert.equal(s.failed, 1);
    assert.deepEqual(s.errors, []);
    const failed = db.t.audit_log.find((a) => a.action === 'alert_email_failed');
    assert.equal(failed.entity_id, 'a-l1');
    assert.equal(failed.actor, EMAIL_ACTOR);
    assert.equal(failed.details.status, 403);
    assert.match(failed.details.error, /HTTP 403/);
    assert.doesNotMatch(JSON.stringify(db.t.audit_log), /lider1@example\.test|re_TESTKEY/);
    const a1 = db.t.alerts.find((a) => a.id === 'a-l1');
    assert.equal(a1.emailed_at, null);
    assert.equal(a1.email_attempts, 1);
    // Reintentos en corridas siguientes, hasta el tope.
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(a1.email_attempts, MAX_ATTEMPTS);
    assert.equal(calls.filter((c) => c.body.to[0] === 'lider1@example.test').length, MAX_ATTEMPTS);
  });

  test('fallo de red o respuesta no JSON no rompe', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno'), row('a-l2', U2, L2, 'Unidad Dos')]);
    const { fetchImpl } = fakeResend((_c, n) => (n === 1 ? new TypeError('fetch failed') : { status: 500, body: '<html>oops</html>' }));
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.failed, 2);
    assert.deepEqual(s.errors, []);
    assert.match(s.failures[0].error, /Resend no respondió: fetch failed/);
    assert.match(s.failures[1].error, /HTTP 500: <html>oops<\/html>/);
  });

  test('destinatario sin correo o con error de Auth: se registra y no se llama a Resend', async () => {
    const db = fakeDb([row('a-x', U1, '22222222-0000-4000-8000-000000000009', 'Unidad Uno')]);
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(calls.length, 0);
    assert.equal(s.failed, 1);
    assert.match(db.t.audit_log[0].details.error, /no tiene un correo válido/);

    const db2 = fakeDb([row('a-l1', U1, L1, 'Unidad Uno')], { userEmailError: new Error('User not found') });
    const s2 = await sendAlertEmails(db2, opts(fetchImpl));
    assert.equal(s2.failed, 1);
    assert.match(db2.t.audit_log[0].details.error, /User not found/);
  });

  test('correo con separadores (varios destinatarios) se rechaza', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno')], { emails: { [L1]: 'a@x.test, b@y.test' } });
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(calls.length, 0);
    assert.equal(s.failed, 1);
  });

  test('el correo del destinatario se consulta una vez por corrida', async () => {
    const db = fakeDb([row('a1', U1, CM, 'Unidad Uno'), row('a2', U2, CM, 'Unidad Dos')]);
    const { fetchImpl } = fakeResend();
    await sendAlertEmails(db, opts(fetchImpl));
    assert.deepEqual(db.lookups, [CM]);
  });

  test('alertas fuera de la ventana no se envían (no se vacía el histórico)', async () => {
    const db = fakeDb([row('old', U1, L1, 'Unidad Uno', { sent_at: '2027-01-01T00:00:00Z' })]);
    const { calls, fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.pending, 0);
    assert.equal(calls.length, 0);
  });

  test('nombres con HTML llegan escapados en el correo', async () => {
    const evil = '<script>alert(1)</script>';
    const db = fakeDb([row('a-l1', U1, L1, evil)]);
    const { calls, fetchImpl } = fakeResend();
    await sendAlertEmails(db, opts(fetchImpl));
    assert.ok(!calls[0].body.html.includes(evil), 'la carga no aparece literal');
    assert.doesNotMatch(calls[0].body.html, /<\s*\/?\s*script\b/i);
    assert.match(calls[0].body.html, /&lt;script&gt;/);
    assert.doesNotMatch(calls[0].body.subject, /[\r\n]/);
  });

  test('etiquetas script en mayúsculas o mixtas también llegan escapadas', async () => {
    for (const evil of ['<SCRIPT>alert(1)</SCRIPT>', '<ScRiPt >alert(1)</sCrIpT >']) {
      const db = fakeDb([row('a-l1', U1, L1, evil)]);
      const { calls, fetchImpl } = fakeResend();
      await sendAlertEmails(db, opts(fetchImpl));
      const { html } = calls[0].body;
      assert.ok(!html.includes(evil), `la carga ${evil} no aparece literal`);
      assert.doesNotMatch(html, /<\s*\/?\s*script\b/i);
      assert.match(html, /&lt;script\s*&gt;/i);
    }
  });

  test('error de la BD al marcar queda en errors (sin la clave)', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno')]);
    db.markAlertEmailed = async () => {
      throw new Error(`db down ${KEY}`);
    };
    const { fetchImpl } = fakeResend();
    const s = await sendAlertEmails(db, opts(fetchImpl));
    assert.equal(s.errors.length, 1);
    assert.doesNotMatch(s.errors[0], /re_TESTKEY/);
  });
});

describe('runEmailStep', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x', RESEND_API_KEY: KEY };
  const readSupabaseConfig = (e) => ({ url: e.SUPABASE_URL, secretKey: e.SUPABASE_SECRET_KEY });

  test('sin RESEND_API_KEY: ::notice::, código 0 y no toca la BD ni Resend', async () => {
    const lines = [];
    let dbTouched = false;
    const { calls, fetchImpl } = fakeResend();
    const r = await runEmailStep({
      env: { ...env, RESEND_API_KEY: '' },
      fetchImpl,
      makeDb: async () => {
        dbTouched = true;
        return fakeDb([]);
      },
      readSupabaseConfig,
      log: (m) => lines.push(m),
    });
    assert.equal(r.code, 0);
    assert.equal(dbTouched, false);
    assert.equal(calls.length, 0);
    assert.ok(lines.some((l) => l.startsWith('::notice::') && /RESEND_API_KEY/.test(l)));
  });

  test('fallos de Resend: ::warning:: y código 0; resumen en JSON', async () => {
    const lines = [];
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno')]);
    const { fetchImpl } = fakeResend(() => ({ status: 429, body: { message: 'Too many requests' } }));
    const r = await runEmailStep({ env, fetchImpl, makeDb: async () => db, readSupabaseConfig, log: (m) => lines.push(m), now: () => NOW, sleep: async () => {} });
    assert.equal(r.code, 0);
    assert.ok(lines.some((l) => l.startsWith('::warning::') && /a-l1/.test(l) && /429/.test(l)));
    assert.deepEqual(JSON.parse(lines.at(-1)), { pending: 1, sent: 0, failed: 1, skipped: 0, not_eligible: 0, expired: 0, errors: 0 });
    assert.doesNotMatch(lines.join('\n'), /re_TESTKEY|lider1@example\.test/);
  });

  test('configuración inválida: código 2 sin imprimir la clave', async () => {
    const lines = [];
    const r = await runEmailStep({
      env: { ...env, ALERT_EMAIL_FROM: 'x\r\nBcc: y@z.test' },
      fetchImpl: async () => assert.fail('no debe llamar a Resend'),
      makeDb: async () => assert.fail('no debe abrir la BD'),
      readSupabaseConfig,
      log: (m) => lines.push(m),
    });
    assert.equal(r.code, 2);
    assert.doesNotMatch(lines.join('\n'), /re_TESTKEY/);
  });

  test('errores de la BD: código 1', async () => {
    const db = fakeDb([row('a-l1', U1, L1, 'Unidad Uno')]);
    db.insertAudit = async () => {
      throw new Error('audit down');
    };
    const { fetchImpl } = fakeResend();
    const r = await runEmailStep({ env, fetchImpl, makeDb: async () => db, readSupabaseConfig, log: () => {}, now: () => NOW, sleep: async () => {} });
    assert.equal(r.code, 1);
  });
});

describe('readEmailConfig', () => {
  test('sin clave: deshabilitado', () => {
    assert.deepEqual(readEmailConfig({}), { enabled: false, reason: 'Falta el secreto RESEND_API_KEY' });
    assert.equal(readEmailConfig({ RESEND_API_KEY: '   ' }).enabled, false);
  });
  test('valores por defecto', () => {
    assert.deepEqual(readEmailConfig({ RESEND_API_KEY: KEY }), { enabled: true, apiKey: KEY, from: DEFAULT_FROM, appUrl: 'https://apivasa.github.io/practica_agente/', lookbackDays: 7 });
  });
  test('remitente, URL y ventana', () => {
    const c = readEmailConfig({ RESEND_API_KEY: KEY, ALERT_EMAIL_FROM: 'Alertas RUN <alertas@example.test>', APP_URL: 'https://x.test/app/', ALERT_EMAIL_LOOKBACK_DAYS: '3' });
    assert.equal(c.from, 'Alertas RUN <alertas@example.test>');
    assert.equal(c.appUrl, 'https://x.test/app/');
    assert.equal(c.lookbackDays, 3);
  });
  test('valores inválidos lanzan sin la clave en el mensaje', () => {
    const bad = [
      { RESEND_API_KEY: 'sb_secret_abc' },
      { RESEND_API_KEY: KEY, ALERT_EMAIL_FROM: 'no-es-correo' },
      { RESEND_API_KEY: KEY, APP_URL: 'http://x.test' },
      { RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '0' },
      { RESEND_API_KEY: KEY, ALERT_EMAIL_LOOKBACK_DAYS: '1.5' },
    ];
    for (const env of bad) {
      assert.throws(() => readEmailConfig(env), (e) => !e.message.includes(KEY));
    }
  });
  test('isValidFrom', () => {
    assert.ok(isValidFrom('a@b.test'));
    assert.ok(isValidFrom('Nombre <a@b.test>'));
    assert.ok(!isValidFrom('a@b.test, c@d.test'));
    assert.ok(!isValidFrom('"x" <a@b.test>'));
    assert.ok(!isValidFrom('x\n<a@b.test>'));
  });
  test('sanitizeError quita clave, correos y saltos de línea', () => {
    const s = sanitizeError(new Error(`fallo ${KEY} para a@b.test\nlinea2`), KEY);
    assert.equal(s, 'fallo [clave] para [correo] linea2');
  });
});

describe('createDb (consultas de correo)', () => {
  function recorder(result) {
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
      auth: { admin: { getUserById: async (id) => (calls.push({ admin: id }), { data: { user: { email: 'u@x.test' } }, error: null }) } },
    };
    return { sb, calls };
  }

  test('pendientes: sin emailed_at, bajo el tope y dentro de la ventana', async () => {
    const { sb, calls } = recorder(() => ({ data: [{ id: 'a' }], error: null }));
    const rows = await createDb(sb).pendingEmailAlerts({ since: '2027-01-25T00:00:00Z', maxAttempts: 3 });
    assert.deepEqual(rows, [{ id: 'a' }]);
    const ops = calls[0].ops;
    assert.equal(calls[0].table, 'alerts');
    assert.deepEqual(ops.find(([m]) => m === 'is'), ['is', 'emailed_at', null]);
    assert.deepEqual(ops.find(([m]) => m === 'lt'), ['lt', 'email_attempts', 3]);
    assert.deepEqual(ops.find(([m]) => m === 'gte'), ['gte', 'sent_at', '2027-01-25T00:00:00Z']);
  });

  test('marcar enviado es condicional (emailed_at is null)', async () => {
    const { sb, calls } = recorder(() => ({ data: [], error: null }));
    const marked = await createDb(sb).markAlertEmailed('a', { emailedAt: 't', attempts: 1 });
    assert.equal(marked, false);
    const ops = calls[0].ops;
    assert.deepEqual(ops[0], ['update', { emailed_at: 't', email_attempts: 1 }]);
    assert.ok(ops.some(([m, col, v]) => m === 'is' && col === 'emailed_at' && v === null));
  });

  test('correo del destinatario con la API admin', async () => {
    const { sb } = recorder(() => ({ data: [], error: null }));
    assert.equal(await createDb(sb).userEmail('u1'), 'u@x.test');
  });

  test('errores de la BD se propagan', async () => {
    const { sb } = recorder(() => ({ data: null, error: { message: 'boom' } }));
    await assert.rejects(createDb(sb).recordAlertEmailFailure('a', { attempts: 2 }), /boom/);
  });
});

// C-05 — Seguridad del correo de alertas por Resend (categorías 2, 3, 5, 6 y 8).
// Estáticas sobre .github/workflows/correo-alertas.yml y el front, y unitarias sobre
// engine/alert-email.js y scripts/lib/email.js con Resend simulado (nunca hay red:
// fetch inyectado y, en el proceso hijo, Supabase en 127.0.0.1:9).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { formatAlertEmail, escapeHtml, plainText, safeHttpsUrl } from '../../engine/index.js';
import {
  sendAlertEmails, runEmailStep, readEmailConfig, sanitizeError, isEmailAddress, isValidFrom,
  RESEND_ENDPOINT, EMAIL_ACTOR,
} from '../../scripts/lib/email.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WF = 'correo-alertas.yml';
const wfText = readFileSync(join(ROOT, '.github', 'workflows', WF), 'utf8');
// Construidas por partes para no ser falsos positivos de gitleaks.
const RESEND_KEY = 're' + '_SECURITYTEST_resend_do_not_leak_0123456789';
const SB_KEY = 'sb_' + 'secret_SECURITYTEST_do_not_leak_0123456789abcdef';
const NOW = new Date('2027-02-01T12:00:00Z');
const CONFIG = { apiKey: RESEND_KEY, from: 'alertas@example.test', appUrl: 'https://app.example.test/', lookbackDays: 7 };

const UA = '22222222-2222-4222-8222-0000000000a1';
const UB = '22222222-2222-4222-8222-0000000000b2';
const LA = '11111111-1111-4111-8111-0000000000a1';
const LB = '11111111-1111-4111-8111-0000000000b2';
const EMAILS = { [LA]: 'lider-a@example.test', [LB]: 'lider-b@example.test' };

const alertRow = (id, unit, recipient, unitName, extra = {}) => ({
  id, unit_id: unit, recipient_user_id: recipient, kind: 'color_change',
  payload: { unit_name: unitName, message: `${unitName}: el color pasó de verde a rojo.`, severity: 'high' },
  sent_at: '2027-02-01T11:07:00Z', emailed_at: null, email_attempts: 0, ...extra,
});

function fakeDb(alerts, { emails = EMAILS, userEmail } = {}) {
  const t = { alerts: structuredClone(alerts), audit: [] };
  return {
    t,
    pendingEmailAlerts: async ({ since, maxAttempts }) =>
      structuredClone(t.alerts.filter((a) => a.emailed_at === null && a.email_attempts < maxAttempts && a.sent_at >= since)),
    userEmail: userEmail ?? (async (id) => emails[id] ?? null),
    async markAlertEmailed(id, { emailedAt, attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (!a || a.emailed_at !== null) return false;
      Object.assign(a, { emailed_at: emailedAt, email_attempts: attempts });
      return true;
    },
    async recordAlertEmailFailure(id, { attempts }) {
      const a = t.alerts.find((x) => x.id === id);
      if (a && a.emailed_at === null) a.email_attempts = attempts;
    },
    insertAudit: async (rows) => { t.audit.push(...structuredClone(rows)); },
  };
}

function fakeResend(respond = () => ({ status: 200, body: { id: 'msg_1' } })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = respond(calls.length);
    if (r instanceof Error) throw r;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return { ok: r.status < 300, status: r.status, text: async () => text, json: async () => JSON.parse(text) };
  };
  return { calls, fetchImpl };
}

const run = (db, fetchImpl, logs = []) =>
  sendAlertEmails(db, { config: CONFIG, fetchImpl, now: () => NOW, sleep: async () => {}, log: (m) => logs.push(m) });

// ---------------------------------------------------------------------------
// Categoría 5: workflow correo-alertas.yml
// ---------------------------------------------------------------------------
describe(`${WF}`, () => {
  const [header, jobs] = wfText.split(/^jobs:/m);
  const lines = wfText.split('\n');
  const steps = jobs.split(/^\s{6}- /m).slice(1);

  test('solo schedule y workflow_dispatch, sin inputs', () => {
    assert.match(header, /^\s{2}schedule:/m);
    assert.match(header, /^\s{2}workflow_dispatch:\s*$/m);
    assert.doesNotMatch(header, /^\s{2}(push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch|issue_comment):/m);
    assert.doesNotMatch(wfText, /inputs\.|github\.event\.|GITHUB_EVENT_PATH/, 'el envío no debe depender de datos del evento');
  });

  test('permissions: contents: read y sin permisos por job; environment produccion', () => {
    assert.match(header, /^permissions:\n {2}contents: read\n(?! {2}\S)/m);
    assert.doesNotMatch(jobs, /^\s+permissions:/m);
    assert.match(jobs, /^\s{4}environment: produccion\s*$/m);
    assert.match(header, /cancel-in-progress:\s*false/);
    assert.match(jobs, /timeout-minutes:\s*\d+/);
  });

  test('solo los tres secretos esperados, siempre mapeados a env', () => {
    const used = new Set([...wfText.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), ['RESEND_API_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_URL']);
    for (const l of lines.filter((x) => /secrets\./.test(x))) {
      assert.match(l, /^\s+[A-Z_]+:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}\s*$/, `secreto fuera de env: ${l.trim()}`);
    }
    assert.doesNotMatch(wfText, /sb_secret_|re_[A-Za-z0-9]{8,}|service_role|eyJ[A-Za-z0-9_-]{10,}/, 'clave literal o legada');
  });

  test('RESEND_API_KEY solo en el paso que envía; npm ci sin secretos ni scripts', () => {
    const withResend = steps.filter((s) => /secrets\.RESEND_API_KEY/.test(s));
    assert.equal(withResend.length, 1);
    assert.match(withResend[0], /run: node scripts\/send-alert-emails\.js\s*$/m);
    const install = steps.find((s) => /npm ci/.test(s));
    assert.ok(install);
    assert.match(install, /npm ci --ignore-scripts --omit=dev/);
    assert.doesNotMatch(install, /secrets\.|env:/, 'npm ci no debe ver secretos');
  });

  test('check primero y todo paso posterior protegido por la guarda', () => {
    assert.ok(steps[0].includes('id: check'));
    assert.match(steps[0], /"\$EVALUATION_ENABLED" != "true"/);
    assert.doesNotMatch(steps[0], /RESEND_API_KEY/);
    for (const s of steps.slice(1)) {
      assert.match(s, /if:\s*steps\.check\.outputs\.ready == 'true'/, `paso sin guarda: ${s.split('\n')[0]}`);
    }
  });

  test('nunca imprime secretos ni activa xtrace; checkout sin credenciales', () => {
    for (const l of lines.filter((x) => /echo|printf/.test(x))) {
      assert.doesNotMatch(l, /\$\{?(SUPABASE_SECRET_KEY|SUPABASE_URL|RESEND_API_KEY)\b/, `imprime un secreto: ${l.trim()}`);
    }
    assert.doesNotMatch(wfText, /set -x|set -o xtrace|ACTIONS_STEP_DEBUG/);
    assert.match(wfText, /persist-credentials:\s*false/);
  });
});

// ---------------------------------------------------------------------------
// Categoría 2/6: la API admin de Auth y la clave de Resend nunca llegan al front
// ---------------------------------------------------------------------------
describe('API admin y Resend solo en backend', () => {
  const TEXT = /\.(js|mjs|cjs|html|json|map|txt)$/;
  const walk = (dir) => (!existsSync(dir) ? [] : readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : TEXT.test(p) ? [p] : [];
  }));
  const FORBIDDEN = [
    ['auth.admin', /auth\s*\.\s*admin\b/],
    ['getUserById', /getUserById/],
    ['listUsers', /listUsers/],
    ['endpoint admin de GoTrue', /\/auth\/v1\/admin/],
    ['Resend', /api\.resend\.com|RESEND_API_KEY/],
    ['clave de Resend', new RegExp('\\bre' + '_[A-Za-z0-9]{16,}')],
  ];
  const hits = (files) => files.flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    return FORBIDDEN.filter(([, re]) => re.test(text)).map(([l]) => `${relative(ROOT, f)}: ${l}`);
  });

  test('src/, engine/ e index.html no usan la API admin ni Resend', () => {
    const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'engine')), join(ROOT, 'index.html')].filter(existsSync);
    assert.ok(files.length > 0);
    assert.deepEqual(hits(files), []);
  });

  test('dist/ (si existe) no contiene la API admin ni la clave de Resend', () => {
    const dist = join(ROOT, 'dist');
    if (process.env.SECURITY_REQUIRE_DIST === '1') assert.ok(existsSync(dist));
    assert.deepEqual(hits(walk(dist)), []);
  });

  test('getUserById solo en scripts/lib/db.js y en la integración local con guarda de host', () => {
    const files = walk(join(ROOT, 'scripts')).filter((f) => /getUserById|auth\.admin/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(files.map((f) => relative(ROOT, f)).sort(), ['scripts/ci/email-integration.js', 'scripts/lib/db.js']);
    const integ = readFileSync(join(ROOT, 'scripts', 'ci', 'email-integration.js'), 'utf8');
    assert.match(integ, /host !== '127\.0\.0\.1' && host !== 'localhost'/);
    assert.ok(integ.indexOf("host !== '127.0.0.1'") < integ.indexOf('createClient(url'), 'guarda local antes de crear el cliente');
    assert.doesNotMatch(integ, /api\.resend\.com|fetch\(/, 'la integración nunca llama a Resend');
  });
});

// ---------------------------------------------------------------------------
// Categoría 3: inyección HTML y de cabeceras en el correo
// ---------------------------------------------------------------------------
describe('formatAlertEmail resiste inyección', () => {
  const XSS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><a href="javascript:alert(1)">x</a>',
    "' onmouseover='alert(1)",
    '<svg/onload=alert(1)>',
    '<style>@import url(https://evil.invalid/x.css)</style>',
    '<!--',
    '&lt;script&gt;',
  ];
  for (const p of XSS) {
    test(`HTML escapado: ${JSON.stringify(p).slice(0, 40)}`, () => {
      const { html } = formatAlertEmail({ kind: p, payload: { unit_name: p, message: p }, sent_at: '2027-02-01T11:07:00Z' });
      const body = html.replace(/^<!doctype html><html lang="es"><body>/, '').replace(/<\/body><\/html>$/, '');
      // Solo quedan las etiquetas propias de la plantilla.
      const tags = [...body.matchAll(/<\/?([a-zA-Z!][^\s>/]*)/g)].map((m) => m[1].toLowerCase());
      for (const t of tags) assert.ok(['p', 'ul', 'li', 'strong', 'a'].includes(t), `etiqueta inyectada: ${t}`);
      assert.doesNotMatch(body, /<a(?![^>]*href="https:)/);
      // Ningún atributo de evento dentro de una etiqueta real.
      for (const m of body.matchAll(/<[a-zA-Z][^>]*>/g)) assert.doesNotMatch(m[0], /\son\w+\s*=/i, m[0]);
      assert.doesNotMatch(body, /javascript:"|<script|<img|<svg|<style/i);
    });
  }

  test('asunto sin CR/LF, separadores Unicode ni bidi (sin inyección de cabeceras)', () => {
    const evil = 'Alfa\r\nBcc: victima@example.test\r\n\r\n<b>x</b>\u2028X-Hdr: 1\u202eabc\u0000\u0085';
    const { subject, text } = formatAlertEmail({ kind: 'color_change', payload: { unit_name: evil, message: evil, severity: 'high' } });
    assert.doesNotMatch(subject, /[\r\n\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    assert.ok(subject.length <= 160);
    assert.ok(subject.startsWith('[Urgente] '));
    // El texto plano tampoco permite partir líneas desde el mensaje.
    assert.equal(text.split('\n')[0].includes('\n'), false);
    assert.doesNotMatch(text.split('\n')[0], /\r/);
  });

  test('enlace solo https sin credenciales y escapado en el atributo', () => {
    for (const bad of ['javascript:alert(1)', 'http://app.example.test', 'data:text/html,<script>', 'https://u:p@evil.invalid/', '//evil.invalid', ' ', '']) {
      assert.equal(safeHttpsUrl(bad), null, bad);
      assert.doesNotMatch(formatAlertEmail({ kind: 'color_change', payload: {} }, { appUrl: bad }).html, /<a /);
    }
    const { html } = formatAlertEmail({ kind: 'color_change', payload: {} }, { appUrl: 'https://app.example.test/?a="><script>' });
    assert.doesNotMatch(html, /"><script>/);
  });

  test('payload con campos ajenos (otras unidades, correos, ids) no se filtra al correo', () => {
    const mail = formatAlertEmail({
      kind: 'color_change',
      payload: { unit_name: 'Alfa', message: 'Alfa: rojo', other_units: ['Beta secreto'], email: 'x@example.test', recipient_user_id: LB },
    });
    for (const part of [mail.subject, mail.text, mail.html]) {
      assert.doesNotMatch(part, /Beta secreto|x@example\.test|0000000000b2/);
    }
  });

  test('utilidades: escapeHtml y plainText con tipos no string', () => {
    assert.equal(escapeHtml('<&"\'>'), '&lt;&amp;&quot;&#39;&gt;');
    assert.equal(plainText({ toString: () => '<x>' }, 10), '');
    assert.equal(plainText(['a\nb'], 10), '');
  });
});

describe('remitente y destinatario sin inyección de cabeceras', () => {
  test('isEmailAddress rechaza separadores, saltos y nombres', () => {
    for (const bad of ['a@b.test\r\nBcc: c@d.test', 'a@b.test,c@d.test', 'a@b.test;c@d.test', 'A <a@b.test>', 'a@b', '', null, 'a@b.test\u2028', `${'a'.repeat(250)}@b.test`]) {
      assert.equal(isEmailAddress(bad), false, JSON.stringify(bad));
    }
    assert.equal(isEmailAddress('lider-a@example.test'), true);
  });
  test('isValidFrom rechaza CR/LF y varios remitentes', () => {
    for (const bad of ['Alertas <a@b.test>\r\nBcc: x@y.test', 'a@b.test, c@d.test', 'A"B <a@b.test>', 'A <a@b.test> <c@d.test>', '<a@b.test>x']) {
      assert.equal(isValidFrom(bad), false, JSON.stringify(bad));
    }
  });
  test('readEmailConfig no acepta APP_URL no https ni remitente con salto', () => {
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: RESEND_KEY, APP_URL: 'javascript:alert(1)' }), (e) => !e.message.includes(RESEND_KEY));
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: RESEND_KEY, ALERT_EMAIL_FROM: 'a@b.test\nBcc: c@d.test' }), (e) => !e.message.includes(RESEND_KEY));
    assert.throws(() => readEmailConfig({ RESEND_API_KEY: `${RESEND_KEY}\nX: y` }), (e) => !e.message.includes('SECURITYTEST'));
  });
});

// ---------------------------------------------------------------------------
// Categoría 1/8: aislamiento por destinatario y unidad
// ---------------------------------------------------------------------------
describe('cada destinatario recibe solo su alerta', () => {
  test('dos unidades: cada correo va a su líder con solo los datos de su unidad', async () => {
    const db = fakeDb([
      alertRow('a1', UA, LA, 'Unidad Alfa'),
      alertRow('b1', UB, LB, 'Unidad Beta'),
    ]);
    const { calls, fetchImpl } = fakeResend();
    const s = await run(db, fetchImpl);
    assert.equal(s.sent, 2);
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.equal(c.url, RESEND_ENDPOINT);
      assert.equal(c.body.to.length, 1, 'un solo destinatario por correo');
      assert.equal(c.body.cc, undefined);
      assert.equal(c.body.bcc, undefined);
      assert.equal(c.body.reply_to, undefined);
      const all = `${c.body.subject}\n${c.body.text}\n${c.body.html}`;
      if (c.body.to[0] === EMAILS[LA]) {
        assert.match(all, /Unidad Alfa/);
        assert.doesNotMatch(all, /Unidad Beta|lider-b@/);
      } else {
        assert.equal(c.body.to[0], EMAILS[LB]);
        assert.match(all, /Unidad Beta/);
        assert.doesNotMatch(all, /Unidad Alfa|lider-a@/);
      }
      // La Idempotency-Key es la de la alerta enviada, no de otra.
      assert.match(c.init.headers['Idempotency-Key'], /^alert-email-(a1|b1)$/);
    }
  });

  test('el destinatario sale del recipient_user_id de la alerta, nunca del payload', async () => {
    const db = fakeDb([alertRow('a1', UA, LA, 'Alfa', {
      payload: { unit_name: 'Alfa', message: 'Alfa: rojo', to: 'atacante@evil.invalid', email: 'atacante@evil.invalid', recipient: LB },
    })]);
    const { calls, fetchImpl } = fakeResend();
    await run(db, fetchImpl);
    assert.deepEqual(calls[0].body.to, [EMAILS[LA]]);
    assert.doesNotMatch(calls[0].init.body, /evil\.invalid/);
  });

  test('recipient_user_id no UUID (inyección de filtro) no consulta Auth ni envía', async () => {
    const asked = [];
    const db = fakeDb([alertRow('x1', UA, `${LA}&or=(id.not.is.null)`, 'Alfa'), alertRow('x2', UA, '../admin/users', 'Alfa')], {
      userEmail: async (id) => { asked.push(id); return 'x@example.test'; },
    });
    const { calls, fetchImpl } = fakeResend();
    const s = await run(db, fetchImpl);
    assert.equal(calls.length, 0);
    assert.equal(asked.length, 0);
    assert.equal(s.failed, 2);
  });

  test('un correo de Auth manipulado con varios destinatarios no se envía', async () => {
    const db = fakeDb([alertRow('a1', UA, LA, 'Alfa')], { emails: { [LA]: 'a@example.test\r\nBcc: todos@example.test' } });
    const { calls, fetchImpl } = fakeResend();
    const s = await run(db, fetchImpl);
    assert.equal(calls.length, 0);
    assert.equal(s.failed, 1);
  });
});

// ---------------------------------------------------------------------------
// Categoría 2/8: ninguna clave ni correo en logs ni en audit_log
// ---------------------------------------------------------------------------
describe('sin fugas de claves ni correos', () => {
  const noLeak = (blob) => {
    assert.ok(!blob.includes(RESEND_KEY) && !blob.includes('SECURITYTEST'), `clave filtrada:\n${blob}`);
    assert.doesNotMatch(blob, /lider-[ab]@example\.test/, `correo filtrado:\n${blob}`);
  };

  test('Resend devuelve un error que repite la clave y el correo: se redacta en log y auditoría', async () => {
    const db = fakeDb([alertRow('a1', UA, LA, 'Alfa'), alertRow('b1', UB, LB, 'Beta')]);
    const logs = [];
    const { fetchImpl } = fakeResend((n) => (n === 1
      ? { status: 422, body: { name: 'validation_error', message: `Invalid to: lider-a@example.test with key ${RESEND_KEY}\r\n<script>` } }
      : { status: 500, body: `upstream said ${RESEND_KEY} / lider-b@example.test` }));
    const s = await run(db, fetchImpl, logs);
    assert.equal(s.failed, 2);
    noLeak(JSON.stringify({ logs, audit: db.t.audit, s }));
    for (const r of db.t.audit) {
      assert.equal(r.actor, EMAIL_ACTOR);
      assert.doesNotMatch(r.details.error, /[\r\n]/);
    }
  });

  test('error de red con la clave en el mensaje y error de Auth con el correo', async () => {
    const db = fakeDb([alertRow('a1', UA, LA, 'Alfa'), alertRow('b1', UB, LB, 'Beta')], {
      userEmail: async (id) => {
        if (id === LB) throw new Error('user lider-b@example.test not found');
        return EMAILS[LA];
      },
    });
    const logs = [];
    const { fetchImpl } = fakeResend(() => new Error(`connect failed Authorization: Bearer ${RESEND_KEY}`));
    await run(db, fetchImpl, logs);
    noLeak(JSON.stringify({ logs, audit: db.t.audit }));
  });

  test('envío correcto: la auditoría guarda ids, nunca el correo; provider_id de una línea y acotado', async () => {
    const db = fakeDb([alertRow('a1', UA, LA, 'Alfa')]);
    const logs = [];
    const { fetchImpl } = fakeResend(() => ({ status: 200, body: { id: `msg\r\nX-Injected: 1${'z'.repeat(500)}` } }));
    await run(db, fetchImpl, logs);
    assert.equal(db.t.audit.length, 1);
    assert.equal(db.t.audit[0].action, 'alert_emailed');
    assert.doesNotMatch(db.t.audit[0].details.provider_id, /[\r\n]/);
    assert.ok(db.t.audit[0].details.provider_id.length <= 100);
    noLeak(JSON.stringify({ logs, audit: db.t.audit }));
  });

  test('sanitizeError redacta clave, correos y saltos', () => {
    const out = sanitizeError(new Error(`k=${RESEND_KEY}\nmail=a.b+c@example.test`), RESEND_KEY);
    assert.ok(!out.includes('SECURITYTEST') && !out.includes('@'));
    assert.doesNotMatch(out, /\n/);
    assert.ok(out.length <= 300);
  });

  test('runEmailStep con configuración inválida no imprime ninguna clave', async () => {
    const logs = [];
    const r = await runEmailStep({
      env: { RESEND_API_KEY: RESEND_KEY, ALERT_EMAIL_FROM: 'malo', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: SB_KEY },
      fetchImpl: () => { throw new Error('no debe llamar a Resend'); },
      makeDb: () => { throw new Error('no debe abrir la BD'); },
      readSupabaseConfig: () => ({ url: 'https://x.supabase.co', secretKey: SB_KEY }),
      log: (m) => logs.push(m),
    });
    assert.equal(r.code, 2);
    assert.ok(!logs.join('\n').includes('SECURITYTEST'));
  });

  test('scripts/send-alert-emails.js con backend inalcanzable: falla sin imprimir claves ni llamar a Resend', () => {
    // Puerto 9 local: conexión rechazada al instante; nunca sale de la máquina.
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'send-alert-emails.js')], {
      env: { PATH: process.env.PATH, RESEND_API_KEY: RESEND_KEY, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: SB_KEY },
      encoding: 'utf8',
      timeout: 30_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, `debía fallar al conectar:\n${out}`);
    assert.ok(!out.includes('SECURITYTEST'), `la salida contiene una clave:\n${out}`);
  });

  test('sin RESEND_API_KEY no hay envío y sale 0', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'send-alert-emails.js')], {
      env: { PATH: process.env.PATH, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: SB_KEY },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /::notice::/);
    assert.ok(!`${r.stdout}${r.stderr}`.includes('SECURITYTEST'));
  });
});

// F-12 — pruebas del desarrollador:
// - H-F11-02: check-main-tip.sh aplica la regla de la punta también a workflow_dispatch
//   (con y sin --strict).
// - H-F11-05: el status de compare se sanea a [a-z_] antes de imprimirlo.
// - H-F11-06: con --strict en el intento 1, el rojo se explica como esperado.
// - H-ARQ-C06-04: la ruta `expired` del correo marca y audita con una sola RPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sendAlertEmails, runEmailStep, EMAIL_ACTOR, MAX_ATTEMPTS } from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const MIGRATION = readFileSync(join(ROOT, 'supabase', 'migrations', '20261202120000_alert_email_expired_rpc_f12.sql'), 'utf8');

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const BASE = { GITHUB_REPOSITORY: 'owner/repo', HEAD_SHA: SHA, GH_TOKEN: 'ghs_FAKEtokenF12zz9', TIP_RETRY_INTERVAL_SECONDS: '0', TIP_RETRIES: '1' };
const COMMITS = '^repos/owner/repo/commits/main$';
const COMPARE = `^repos/owner/repo/compare/${SHA}\\.\\.\\.${NEWER}$`;
const tipBody = (sha) => JSON.stringify({ sha });
const cmpBody = (status, files) => JSON.stringify({ status, files: files.map((filename) => ({ filename })) });

/** check-main-tip.sh con un gh falso: `routes` = [[regex, cuerpo], ...]. */
function tip(routes, env = {}, argv = []) {
  const dir = mkdtempSync(join(tmpdir(), 'f12-gh-'));
  try {
    const outFile = join(dir, 'github_output');
    writeFileSync(outFile, '');
    const cases = routes
      .map(([re, body], i) => {
        writeFileSync(join(dir, `r${i}`), body);
        return `if printf '%s' "$2" | grep -Eq '${re}'; then cat "${dir}/r${i}"; exit 0; fi`;
      })
      .join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/args"\n${cases}\necho "ruta no simulada" >&2; exit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [TIP, ...argv], {
      env: { PATH: `${dir}:${process.env.PATH}`, ...BASE, GITHUB_OUTPUT: outFile, ...env },
      encoding: 'utf8',
    });
    let args = '';
    try {
      args = readFileSync(join(dir, 'args'), 'utf8');
    } catch {
      /* gh no se llamó */
    }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, args, output: readFileSync(outFile, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SUPERSEDED = [
  [COMMITS, tipBody(NEWER)],
  [COMPARE, cmpBody('ahead', ['src/main.js'])],
];

// ------------------------------------------------------------ H-F11-02

test('H-F11-02: workflow_dispatch en la punta de main consulta la API y despliega (deploy=true)', () => {
  const r = tip([[COMMITS, tipBody(SHA)]], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.args, /^api repos\/owner\/repo\/commits\/main$/m);
  assert.equal(r.output, 'deploy=true\n');
});

test('H-F11-02: re-run de un workflow_dispatch superado por código → 1 sin deploy', () => {
  for (const attempt of ['2', '3', '']) {
    const r = tip(SUPERSEDED, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: attempt });
    assert.equal(r.code, 1, `${attempt}: ${r.out}`);
    assert.match(r.out, /::error::Hay un commit más nuevo en main/);
    assert.equal(r.output, '');
  }
});

test('H-F11-02: workflow_dispatch superado con --strict → 1 en cualquier intento, sin GITHUB_OUTPUT', () => {
  for (const attempt of ['1', '2', '']) {
    const r = tip(SUPERSEDED, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: attempt }, ['--strict']);
    assert.equal(r.code, 1, `${attempt}: ${r.out}`);
    assert.equal(r.output, '');
  }
});

test('H-F11-02: workflow_dispatch con --strict en la punta o con solo docs detrás → 0', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '2' };
  assert.equal(tip([[COMMITS, tipBody(SHA)]], env, ['--strict']).code, 0);
  assert.equal(tip([[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['docs/estado.md'])]], env, ['--strict']).code, 0);
});

test('H-F11-02: workflow_dispatch con la API caída → 1 (falla cerrado, ya no se exime)', () => {
  const r = tip([], { GITHUB_EVENT_NAME: 'workflow_dispatch' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::No se pudo comprobar la punta de main/);
});

test('H-F11-02: el script ya no tiene la exención de workflow_dispatch', () => {
  const code = readFileSync(TIP, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(code, /^\s*push \| workflow_dispatch\) ;;$/m);
  assert.doesNotMatch(code, /Disparo manual/);
});

// ------------------------------------------------------------ H-F11-05

for (const status of ['ahead\n::error::x', 'behind\r\n::warning::y', 'Diverged', '%0A::error::z', 'x y']) {
  test(`H-F11-05: status ${JSON.stringify(status)} se imprime solo con [a-z_] y en una línea`, () => {
    const r = tip([[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody(status, ['docs/estado.md'])]], { GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 1, r.out);
    const lines = r.out.split(/\r\n|\r|\n/).filter(Boolean);
    assert.equal(lines.length, 1, r.out);
    const m = lines[0].match(/cambios desplegables \(([^)]*)\)/);
    assert.ok(m, lines[0]);
    assert.match(m[1], /^[a-z_]+$/);
  });
}

test('H-F11-05: status vacío, numérico o ausente → "desconocido"', () => {
  for (const body of [cmpBody('', ['docs/a.md']), JSON.stringify({ status: 7, files: [] }), JSON.stringify({ files: [] })]) {
    const r = tip([[COMMITS, tipBody(NEWER)], [COMPARE, body]], { GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /cambios desplegables \(desconocido\)/);
  }
});

// ------------------------------------------------------------ H-F11-06

test('H-F11-06: --strict superado en el intento 1 explica que el rojo es esperado y no se relanza', () => {
  const r = tip(SUPERSEDED, { GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1' }, ['--strict']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::Hay un commit más nuevo en main \(b{40}\).*Rojo esperado \(H-F11-06\).*no relances este run/);
  assert.equal(r.out.trim().split('\n').length, 1);
});

test('H-F11-06: en un relanzamiento (intento 2) el mensaje no dice que el rojo sea esperado', () => {
  const r = tip(SUPERSEDED, { GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '2' }, ['--strict']);
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /Rojo esperado/);
  assert.match(r.out, /no relances despliegues de commits viejos/);
});

// ------------------------------------------------------------ H-ARQ-C06-04

const NOW = new Date('2027-03-10T12:00:00Z');
const A1 = '33333333-0000-4000-8000-0000000000f1';
const A2 = '33333333-0000-4000-8000-0000000000f2';
// Clave ficticia armada en ejecución (no es una credencial de Resend; evita falsos positivos de gitleaks).
const CONFIG = { apiKey: ['re', 'F12TESTKEY', 'ficticia'].join('_'), from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };

/** BD simulada mínima: sin pendientes, con vencidas y la RPC de F-12. */
function dbWithRpc({ rpc, skipped } = {}) {
  const calls = { rpc: [], skipped: 0, audit: 0 };
  return {
    calls,
    pendingEmailAlerts: async () => [],
    userEmail: async () => null,
    markAlertEmailed: async () => true,
    recordAlertEmailFailure: async () => {},
    insertAudit: async () => {
      calls.audit += 1;
    },
    recipientAccess: async () => null,
    expiredEmailAlerts: async () => [
      { id: A1, unit_id: null, recipient_user_id: A2, kind: 'color_change', sent_at: '2027-03-01T00:00:00Z', email_attempts: 0 },
      { id: A2, unit_id: null, recipient_user_id: A1, kind: 'color_change', sent_at: '2027-03-01T00:00:00Z', email_attempts: 1 },
    ],
    markAlertsEmailSkipped: async () => {
      calls.skipped += 1;
      return skipped ?? [];
    },
    markAlertsEmailExpired: async (ids, opts) => {
      calls.rpc.push({ ids, opts });
      return rpc ? rpc(ids, opts) : ids;
    },
  };
}

test('H-ARQ-C06-04: con la RPC, la ruta expired hace una sola llamada atómica y no usa markAlertsEmailSkipped ni insertAudit', async () => {
  const db = dbWithRpc();
  const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
  assert.deepEqual(s.errors, []);
  assert.equal(s.expired, 2);
  assert.equal(db.calls.rpc.length, 1);
  assert.equal(db.calls.skipped, 0);
  assert.equal(db.calls.audit, 0);
  const { ids, opts } = db.calls.rpc[0];
  assert.deepEqual(ids, [A1, A2]);
  assert.equal(opts.before, new Date(NOW.getTime() - 7 * 86400000).toISOString());
  assert.equal(opts.maxAttempts, MAX_ATTEMPTS);
  assert.equal(opts.skippedAt, NOW.toISOString());
  assert.equal(opts.lookbackDays, 7);
});

test('H-ARQ-C06-04: summary.expired cuenta solo lo que la RPC marcó', async () => {
  const db = dbWithRpc({ rpc: () => [A2] });
  const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
  assert.equal(s.expired, 1);
});

test('H-ARQ-C06-04: si la RPC falla, el error queda en errors (exit 1) y no se audita aparte', async () => {
  const db = dbWithRpc({
    rpc: () => {
      throw new Error('mark_alerts_email_expired: permission denied');
    },
  });
  const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
  assert.equal(s.expired, 0);
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /alertas fuera de la ventana: .*permission denied/);
  assert.equal(db.calls.audit, 0);
  assert.equal(db.calls.skipped, 0);
});

test('H-ARQ-C06-04: sin vencidas no se llama a la RPC', async () => {
  const db = dbWithRpc();
  db.expiredEmailAlerts = async () => [];
  const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
  assert.equal(s.expired, 0);
  assert.equal(db.calls.rpc.length, 0);
});

// F-13 (H-F12-01, criterio 1): ya no existe la ruta no atómica. Sin la RPC, sendAlertEmails
// no marca ni audita vencidas por otra vía (registra un error) y runEmailStep falla cerrado.
test('H-ARQ-C06-04/F-13: sin la RPC no hay ruta anterior: ni markAlertsEmailSkipped ni insertAudit para expired', async () => {
  const db = dbWithRpc({ skipped: [A1] });
  delete db.markAlertsEmailExpired;
  const s = await sendAlertEmails(db, { config: CONFIG, fetchImpl: async () => assert.fail('no envía'), now: () => NOW });
  assert.equal(s.expired, 0);
  assert.equal(db.calls.skipped, 0);
  assert.equal(db.calls.audit, 0);
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0], /alertas fuera de la ventana: .*markAlertsEmailExpired/);
});

test('F-13: sin la RPC, runEmailStep termina con código 2 sin leer la BD ni llamar a Resend', async () => {
  const db = dbWithRpc({ skipped: [A1] });
  delete db.markAlertsEmailExpired;
  const touched = [];
  for (const k of Object.keys(db)) {
    if (typeof db[k] === 'function') {
      const f = db[k];
      db[k] = async (...a) => { touched.push(k); return f(...a); };
    }
  }
  const lines = [];
  const r = await runEmailStep({
    env: { RESEND_API_KEY: CONFIG.apiKey, ALERT_EMAIL_FROM: CONFIG.from },
    fetchImpl: async () => assert.fail('no llama a Resend'),
    makeDb: async () => db,
    readSupabaseConfig: () => ({}),
    log: (l) => lines.push(l),
    now: () => NOW,
  });
  assert.equal(r.code, 2);
  assert.equal(r.summary, null);
  assert.deepEqual(touched, []);
  assert.ok(lines.some((l) => l.startsWith('::error::') && l.includes('markAlertsEmailExpired')), lines.join('\n'));
});

test('H-ARQ-C06-04: createDb.markAlertsEmailExpired llama a la RPC con los parámetros p_* y devuelve los ids', async () => {
  const seen = [];
  const sb = {
    rpc: async (name, params) => {
      seen.push({ name, params });
      return { data: [{ alert_id: A1 }, { alert_id: null }, {}], error: null };
    },
  };
  const db = createDb(/** @type {any} */ (sb));
  const out = await db.markAlertsEmailExpired([A1, A2], { before: 'b', maxAttempts: 3, skippedAt: 's', lookbackDays: 7 });
  assert.deepEqual(out, [A1]);
  assert.deepEqual(seen, [
    {
      name: 'mark_alerts_email_expired',
      params: { p_ids: [A1, A2], p_before: 'b', p_max_attempts: 3, p_skipped_at: 's', p_lookback_days: 7 },
    },
  ]);
});

test('H-ARQ-C06-04: createDb.markAlertsEmailExpired propaga el error de la RPC', async () => {
  const sb = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
  const db = createDb(/** @type {any} */ (sb));
  await assert.rejects(db.markAlertsEmailExpired([A1], { before: 'b', maxAttempts: 3, skippedAt: 's', lookbackDays: 7 }), /mark_alerts_email_expired: boom/);
});

test('H-ARQ-C06-04: la migración es aditiva, sin security definer y con EXECUTE solo para service_role', () => {
  const code = MIGRATION.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.doesNotMatch(code, /\bdrop\s+(table|column|function|schema)\b|\btruncate\b|\bdelete\s+from\b/i);
  assert.doesNotMatch(code, /security\s+definer/i);
  assert.match(code, /set search_path = ''/);
  assert.match(code, /revoke all on function public\.mark_alerts_email_expired\([^)]*\)\s+from public, anon, authenticated;/);
  assert.match(code, /grant execute on function public\.mark_alerts_email_expired\([^)]*\)\s+to service_role;/);
  const grants = [...code.matchAll(/grant\s+[^;]*\bto\s+([a-z_, ]+);/gi)].map((m) => m[1].trim());
  assert.deepEqual(grants, ['service_role']);
  // Mismo actor que el resto del correo (scripts/lib/email.js).
  assert.ok(code.includes(`'${EMAIL_ACTOR}'`));
});

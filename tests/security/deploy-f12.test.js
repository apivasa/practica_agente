// F-12 — Seguridad de check-main-tip.sh tras F-12 (categoría 5) y del uso de
// la RPC mark_alerts_email_expired desde scripts/ (categorías 1, 3 y 8).
// - H-F11-02: workflow_dispatch ya no se exime de la regla de punta de main.
// - H-F11-05: el status de compare se sanea antes de llegar a ::error::.
// - Fail-closed con la API caída, en dispatch y con --strict.
// - Migración de la RPC: solo service_role, SECURITY INVOKER, sin SQL dinámico.
// Pruebas activas con un `gh` falso en PATH. Sin red; nunca toca producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sendAlertEmails } from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

const SHA = 'e'.repeat(40);
const NEWER = 'f'.repeat(40);
const TOKEN = 'ghs_SECf12tokenFAKE99';
const COMMITS = 'repos/owner/repo/commits/main';
const COMPARE = `repos/owner/repo/compare/${SHA}...${NEWER}`;
const BASE = {
  GITHUB_REPOSITORY: 'owner/repo',
  HEAD_SHA: SHA,
  GH_TOKEN: TOKEN,
  TIP_RETRIES: '2',
  TIP_RETRY_INTERVAL_SECONDS: '0',
};

/** check-main-tip.sh con gh falso. Devuelve código, salida, llamadas a gh y $GITHUB_OUTPUT. */
function tip(routes, env = {}, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sec-f12-'));
  try {
    const cases = Object.entries(routes).map(([path, resp], i) => {
      const isErr = typeof resp === 'object' && resp !== null;
      writeFileSync(join(dir, `p${i}`), path);
      writeFileSync(join(dir, `r${i}`), isErr ? resp.err : resp);
      return `if [ "$2" = "$(cat "${dir}/p${i}")" ]; then cat "${dir}/r${i}"${isErr ? ' >&2; exit 1' : '; exit 0'}; fi`;
    }).join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/args"\n${cases}\necho "ruta no simulada" >&2\nexit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const output = join(dir, 'out');
    writeFileSync(output, '');
    const r = spawnSync('bash', [TIP, ...args], {
      env: { PATH: `${dir}:${process.env.PATH}`, ...BASE, GITHUB_OUTPUT: output, ...env },
      encoding: 'utf8',
      timeout: 20000,
    });
    let calls = '';
    try { calls = readFileSync(join(dir, 'args'), 'utf8'); } catch { /* gh no se llamó */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls, output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tipBody = (sha) => JSON.stringify({ sha });
const cmp = (status, files) => JSON.stringify({ status, files: files.map((f) => ({ filename: f, status: 'modified' })) });
const newer = (body) => ({ [COMMITS]: tipBody(NEWER), [COMPARE]: body });
const DISPATCH = { GITHUB_EVENT_NAME: 'workflow_dispatch' };

// ------------------------------------------------------ 5 · H-F11-02 dispatch

for (const strict of [[], ['--strict']]) {
  const label = strict.length ? 'con --strict' : 'sin --strict';
  for (const attempt of ['1', '2', '7']) {
    test(`sec F-12 dispatch ${label} intento ${attempt}: API caída → 1, consulta la punta y no escribe deploy=true`, () => {
      const r = tip({ [COMMITS]: { err: `HTTP 503 ${TOKEN}` } }, { ...DISPATCH, GITHUB_RUN_ATTEMPT: attempt }, strict);
      assert.equal(r.code, 1, r.out);
      assert.match(r.calls, /commits\/main/);
      assert.doesNotMatch(r.output, /deploy=true/);
      assert.ok(!r.out.includes(TOKEN), 'el token no se imprime');
    });

    test(`sec F-12 dispatch ${label} intento ${attempt}: superado por código → nunca deploy=true`, () => {
      const r = tip(newer(cmp('ahead', ['src/main.js', 'docs/a.md'])), { ...DISPATCH, GITHUB_RUN_ATTEMPT: attempt }, strict);
      assert.doesNotMatch(r.output, /deploy=true/, r.out);
      if (strict.length || attempt !== '1') assert.equal(r.code, 1, r.out);
      else {
        // Primer intento sin --strict: verde sin publicar (deploy=false).
        assert.equal(r.code, 0, r.out);
        assert.match(r.output, /^deploy=false$/m);
      }
    });

    test(`sec F-12 dispatch ${label} intento ${attempt}: compare caído → 1 (no presume solo docs)`, () => {
      const r = tip(newer({ err: 'HTTP 500' }), { ...DISPATCH, GITHUB_RUN_ATTEMPT: attempt }, strict);
      assert.equal(r.code, 1, r.out);
      assert.doesNotMatch(r.output, /deploy=true/);
    });
  }

  test(`sec F-12 dispatch ${label}: punta = commit → 0`, () => {
    const r = tip({ [COMMITS]: tipBody(SHA) }, { ...DISPATCH, GITHUB_RUN_ATTEMPT: '3' }, strict);
    assert.equal(r.code, 0, r.out);
    if (!strict.length) assert.match(r.output, /^deploy=true$/m);
    else assert.equal(r.output, '', '--strict nunca escribe en GITHUB_OUTPUT');
  });

  test(`sec F-12 dispatch ${label}: solo docs detrás → 0`, () => {
    const r = tip(newer(cmp('ahead', ['docs/estado.md', 'README.md'])), { ...DISPATCH, GITHUB_RUN_ATTEMPT: '2' }, strict);
    assert.equal(r.code, 0, r.out);
  });
}

test('sec F-12: el evento sigue siendo una lista cerrada (variantes de workflow_dispatch fallan sin API)', () => {
  for (const ev of ['workflow_dispatch ', 'WORKFLOW_DISPATCH', 'workflow_dispatch\npush', 'workflow_call', 'dispatch']) {
    const r = tip({ [COMMITS]: tipBody(SHA) }, { GITHUB_EVENT_NAME: ev });
    assert.equal(r.code, 1, `${JSON.stringify(ev)}: ${r.out}`);
    assert.equal(r.calls, '');
  }
});

test('sec F-12: el script ya no tiene salida temprana para workflow_dispatch', () => {
  const src = readFileSync(TIP, 'utf8');
  assert.match(src, /^\s*push \| workflow_dispatch\) ;;$/m);
  assert.doesNotMatch(src, /workflow_dispatch\)\s*\n[^;]*set_deploy true/);
});

test('sec F-12: deploy.yml ejecuta check-main-tip en verify y con --strict en migrate y deploy-pages, sin if: por evento', () => {
  const steps = [...WF.matchAll(/- name: Commit vigente en main\n([\s\S]*?)run: bash scripts\/ci\/check-main-tip\.sh([^\n]*)/g)];
  assert.ok(steps.length >= 3, `pasos encontrados: ${steps.length}`);
  for (const [, block] of steps) {
    assert.doesNotMatch(block, /^\s*if:/m);
    assert.doesNotMatch(block, /continue-on-error|GITHUB_EVENT_NAME|TIP_RETR/);
  }
  assert.ok(steps.filter((s) => s[2].trim() === '--strict').length >= 2, 'migrate y deploy-pages usan --strict');
});

// ------------------------------------------- 5 · H-F11-05 status hostil

for (const status of [
  '::error::PWN', 'behind\n::set-output name=deploy::true', 'x\r::add-mask::y', 'diverged%0A::warning::z',
  '$(id)', '`id`', 'AHEAD', 'ahead\n', ' ahead', 'a'.repeat(5000), 'ÁHEAD', '{"x":1}', '',
]) {
  test(`sec F-12 compare con status ${JSON.stringify(status.slice(0, 30))} → 1 o deploy=false, sin líneas :: inyectadas`, () => {
    for (const ev of ['push', 'workflow_dispatch']) {
      for (const strict of [[], ['--strict']]) {
        const r = tip(newer(JSON.stringify({ status, files: [{ filename: 'docs/a.md' }] })), { GITHUB_EVENT_NAME: ev, GITHUB_RUN_ATTEMPT: '2' }, strict);
        assert.equal(r.code, 1, r.out);
        assert.doesNotMatch(r.output, /deploy=true/);
        for (const line of r.out.split('\n')) {
          if (!line.startsWith('::')) continue;
          assert.match(line, /^::error::Hay un commit más nuevo en main \(f{40}\) con cambios desplegables \([a-z_]+\)/, `línea :: inesperada: ${JSON.stringify(line)}`);
        }
        assert.doesNotMatch(r.out, /PWN|set-output|add-mask|\$\(id\)|`id`|\r/);
      }
    }
  });
}

for (const status of [42, null, true, ['ahead'], { s: 'ahead' }]) {
  test(`sec F-12 compare con status no texto ${JSON.stringify(status)} → 1`, () => {
    const r = tip(newer(JSON.stringify({ status, files: [{ filename: 'docs/a.md' }] })), { GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(r.code, 1, r.out);
  });
}

// ------------------------------------------- 1/3/8 · RPC desde scripts/

const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const MIG = readdirSync(MIG_DIR).filter((f) => /mark|expired_rpc/.test(f)).map((f) => readFileSync(join(MIG_DIR, f), 'utf8')).join('\n');

test('sec F-12 migración: RPC sin definer, con search_path vacío y sin SQL dinámico', () => {
  assert.match(MIG, /create or replace function public\.mark_alerts_email_expired\(/);
  assert.doesNotMatch(MIG, /security\s+definer/i);
  assert.match(MIG, /set search_path = ''/);
  const body = MIG.split('as $$')[1].split('$$;')[0];
  assert.doesNotMatch(body, /\bexecute\b|\bformat\s*\(|\|\|/i, 'sin SQL dinámico ni concatenación');
});

test('sec F-12 migración: EXECUTE revocado de public, anon y authenticated; concedido solo a service_role', () => {
  assert.match(MIG, /revoke all on function public\.mark_alerts_email_expired\([^)]*\)\s*from public, anon, authenticated;/);
  const grants = [...MIG.matchAll(/grant execute on function public\.mark_alerts_email_expired\([^)]*\)\s*to ([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(grants, ['service_role']);
  assert.doesNotMatch(MIG, /grant\s+(all|execute)[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
});

test('sec F-12 scripts: solo scripts/lib/db.js invoca la RPC y el front no la conoce', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const hits = (dir) => walk(join(ROOT, dir)).filter((f) => /\.(js|mjs|ts|vue|html)$/.test(f) && readFileSync(f, 'utf8').includes('mark_alerts_email_expired'));
  assert.deepEqual(hits('src'), [], 'el front no llama a la RPC');
  assert.deepEqual(hits('scripts').map((f) => f.slice(ROOT.length)), ['scripts/lib/db.js']);
});

const NOW = new Date('2027-04-10T12:00:00Z');
const CONFIG = { apiKey: ['re', 'SECF12', 'ficticia'].join('_'), from: 'onboarding@resend.dev', appUrl: null, lookbackDays: 7 };
const OLD = [
  { id: '44444444-0000-4000-8000-0000000000a1', unit_id: 'u1', recipient_user_id: 'r1', kind: 'color_change', sent_at: '2027-03-01T00:00:00Z', email_attempts: 0 },
];

function rpcDb({ rpc }) {
  const calls = { rpc: [], skipped: 0, audit: 0, sent: 0 };
  return {
    calls,
    db: {
      pendingEmailAlerts: async () => [],
      userEmail: async () => null,
      markAlertEmailed: async () => true,
      recordAlertEmailFailure: async () => undefined,
      insertAudit: async () => { calls.audit += 1; },
      recipientAccess: async () => null,
      expiredEmailAlerts: async () => OLD,
      markAlertsEmailSkipped: async () => { calls.skipped += 1; return OLD.map((a) => a.id); },
      markAlertsEmailExpired: async (ids, v) => { calls.rpc.push([ids, v]); return rpc(ids, v); },
    },
  };
}

test('sec F-12 correo: con la RPC, la ruta expired no marca ni audita por separado (sin auditoría parcial)', async () => {
  const { db, calls } = rpcDb({ rpc: async (ids) => ids });
  const summary = await sendAlertEmails(db, { config: CONFIG, now: () => NOW, fetchImpl: async () => { calls.sent += 1; return new Response('{}'); }, log: () => {}, sleep: async () => {} });
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.skipped, 0, 'no usa el UPDATE no atómico');
  assert.equal(calls.audit, 0, 'la auditoría la escribe la RPC en la misma transacción');
  assert.equal(calls.sent, 0, 'expired nunca envía correo');
  assert.equal(summary.expired, 1);
  const [, v] = calls.rpc[0];
  assert.equal(v.lookbackDays, 7);
  assert.ok(Number.isInteger(v.maxAttempts) && v.maxAttempts >= 1);
});

test('sec F-12 correo: RPC caída → error registrado sin la clave, sin fallback no atómico ni envío', async () => {
  const { db, calls } = rpcDb({ rpc: async () => { throw new Error(`HTTP 500 key=${CONFIG.apiKey}`); } });
  const summary = await sendAlertEmails(db, { config: CONFIG, now: () => NOW, fetchImpl: async () => { calls.sent += 1; return new Response('{}'); }, log: () => {}, sleep: async () => {} });
  assert.equal(calls.skipped, 0);
  assert.equal(calls.audit, 0);
  assert.equal(calls.sent, 0);
  assert.ok(summary.errors.length >= 1);
  assert.ok(!JSON.stringify(summary).includes(CONFIG.apiKey), 'la clave no se filtra al resumen');
});

test('sec F-12 db.js: markAlertsEmailExpired pasa parámetros tipados, solo devuelve ids de texto y propaga el error', async () => {
  const seen = [];
  const sb = { rpc: async (fn, args) => { seen.push([fn, args]); return { data: [{ alert_id: 'a1' }, null, { alert_id: 7 }, { x: 1 }], error: null }; } };
  const db = createDb(sb);
  const out = await db.markAlertsEmailExpired(["x'); drop table alerts; --"], { before: 'b', maxAttempts: 3, skippedAt: 's', lookbackDays: 7 });
  assert.deepEqual(out, ['a1']);
  assert.equal(seen[0][0], 'mark_alerts_email_expired');
  assert.deepEqual(Object.keys(seen[0][1]).sort(), ['p_before', 'p_ids', 'p_lookback_days', 'p_max_attempts', 'p_skipped_at']);
  // El texto hostil viaja como valor JSON del arreglo (PostgREST lo tipa a uuid[]), no como SQL.
  assert.deepEqual(seen[0][1].p_ids, ["x'); drop table alerts; --"]);
  const bad = createDb({ rpc: async () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) });
  await assert.rejects(bad.markAlertsEmailExpired(['a'], { before: 'b', maxAttempts: 3, skippedAt: 's', lookbackDays: 7 }));
});

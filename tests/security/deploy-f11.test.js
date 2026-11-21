// F-11 — Seguridad de la compuerta "commit vigente en main" de deploy.yml
// (scripts/ci/check-main-tip.sh), del saneado de errores de gh (\r) y del
// fail-closed del correo (H-C06-01). Categorías 5 (Actions) y 1/8.
// Pruebas activas con entradas hostiles: ejecuta el script con bash y un `gh`
// falso en PATH que enruta por ruta de la API. Sin red; nunca toca producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runEmailStep, REQUIRED_C06_DB_METHODS } from '../../scripts/lib/email.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

const SHA = 'c'.repeat(40);
const NEWER = 'd'.repeat(40);
const TOKEN = 'ghs_SECf11tokenFAKE77';
const BASE = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'owner/repo',
  HEAD_SHA: SHA,
  GH_TOKEN: TOKEN,
  TIP_RETRIES: '2',
  TIP_RETRY_INTERVAL_SECONDS: '0',
};
const COMMITS = 'repos/owner/repo/commits/main';
const COMPARE = `repos/owner/repo/compare/${SHA}...${NEWER}`;

/**
 * check-main-tip.sh con un gh falso. `routes`: { ruta exacta: cuerpo | { err } }.
 * Una ruta no simulada hace fallar a gh (así se ve si el script pide algo inesperado).
 */
function tip(routes, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sec-f11-'));
  try {
    const cases = Object.entries(routes).map(([path, resp], i) => {
      const isErr = typeof resp === 'object' && resp !== null;
      writeFileSync(join(dir, `p${i}`), path);
      writeFileSync(join(dir, `r${i}`), isErr ? resp.err : resp);
      return `if [ "$2" = "$(cat "${dir}/p${i}")" ]; then cat "${dir}/r${i}"${isErr ? ' >&2; exit 1' : '; exit 0'}; fi`;
    }).join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/args"\n${cases}\necho "ruta no simulada" >&2\nexit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [TIP], {
      env: { PATH: `${dir}:${process.env.PATH}`, ...BASE, ...env },
      encoding: 'utf8',
      timeout: 20000,
    });
    let args = '';
    try { args = readFileSync(join(dir, 'args'), 'utf8'); } catch { /* gh no se llamó */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, args };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tipBody = (sha) => JSON.stringify({ sha });
const cmp = (status, files, extra = {}) => JSON.stringify({ status, total_commits: 1, files: files.map((f) => (typeof f === 'string' ? { filename: f, status: 'modified' } : f)), ...extra });
const newerWith = (body) => ({ [COMMITS]: tipBody(NEWER), [COMPARE]: body });

// ------------------------------------------------- 5 · eventos y entradas hostiles

for (const ev of ['', 'pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'repository_dispatch', 'push ', 'PUSH', 'push\nworkflow_dispatch']) {
  test(`sec check-main-tip: evento ${JSON.stringify(ev)} → falla sin consultar la API`, () => {
    const r = tip({ [COMMITS]: tipBody(SHA) }, { GITHUB_EVENT_NAME: ev });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '');
  });
}

const BAD_SHAS = ['', 'c'.repeat(39), 'c'.repeat(41), 'C'.repeat(40), `${'c'.repeat(40)}\n`, `${'c'.repeat(40)}...main`, '$(id)'.padEnd(40, 'c'), '../../../x'.padEnd(40, 'c')];
for (const sha of BAD_SHAS) {
  test(`sec check-main-tip: HEAD_SHA hostil ${JSON.stringify(sha.slice(0, 16))} → falla sin consultar la API`, () => {
    const r = tip({ [COMMITS]: tipBody(sha) }, { HEAD_SHA: sha });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '');
  });
}

for (const repo of ['', 'ownerrepo', 'owner/repo/compare', 'owner/repo?x=1', 'owner/re po', 'owner/repo\nx', '$(id)/repo', '../x/repo']) {
  test(`sec check-main-tip: GITHUB_REPOSITORY hostil ${JSON.stringify(repo)} → falla sin consultar la API`, () => {
    const r = tip({}, { GITHUB_REPOSITORY: repo });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '');
  });
}

for (const [k, v] of [['TIP_RETRIES', '0'], ['TIP_RETRIES', '-1'], ['TIP_RETRIES', '$(id)'], ['TIP_RETRY_INTERVAL_SECONDS', '1e3'], ['TIP_RETRY_INTERVAL_SECONDS', ' 1'], ['GH_TOKEN', '']]) {
  test(`sec check-main-tip: ${k}=${JSON.stringify(v)} → falla sin consultar la API`, () => {
    const r = tip({ [COMMITS]: tipBody(SHA) }, { [k]: v });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '');
  });
}

// F-12 (H-F11-02): el disparo manual ya no se exime; sigue la regla de punta
// de main igual que push (casos detallados en deploy-f12.test.js).
test('sec check-main-tip: workflow_dispatch aplica la regla de punta (F-12, H-F11-02)', () => {
  const ev = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '2' };
  // Sin API simulada: falla cerrado (antes salía 0 sin consultar nada).
  const down = tip({}, ev);
  assert.equal(down.code, 1, down.out);
  assert.match(down.args, /commits\/main/, 'debe consultar la punta de main');
  // Punta = commit: 0.
  assert.equal(tip({ [COMMITS]: tipBody(SHA) }, ev).code, 0);
  // Re-run de un disparo viejo superado por código: 1.
  const old = tip(newerWith(cmp('ahead', ['src/main.js'])), ev);
  assert.equal(old.code, 1, old.out);
});

// ------------------------------------------------- 5 · camino feliz y consultas

test('sec check-main-tip: punta = commit → 0 con una sola consulta a commits/main', () => {
  const r = tip({ [COMMITS]: tipBody(SHA) });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.args.trim(), `api ${COMMITS}`);
});

test('sec check-main-tip: solo docs detrás → 0 y la comparación es commit...punta (en ese orden)', () => {
  const r = tip(newerWith(cmp('ahead', ['docs/estado.md', 'docs/reportes/F-11-qa.md', 'README.md'])));
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.args.trim().split('\n'), [`api ${COMMITS}`, `api ${COMPARE}`]);
});

// ------------------------------------------- 5 · fail-closed: punta ilegible

for (const [label, body] of [
  ['sha en mayúsculas', tipBody(NEWER.toUpperCase())],
  ['sha corto', tipBody('d'.repeat(39))],
  ['sha nulo', JSON.stringify({ sha: null })],
  ['sha numérico', JSON.stringify({ sha: 1 })],
  ['sha con salto de línea', tipBody(`${NEWER}\n${SHA}`)],
  ['sin sha', '{}'],
  ['array', `[${tipBody(SHA)}]`],
  ['no JSON', '<html>502</html>'],
  ['vacío', ''],
]) {
  test(`sec check-main-tip: commits/main con ${label} → 1 (falla cerrado)`, () => {
    const r = tip({ [COMMITS]: body, [COMPARE]: cmp('ahead', ['docs/a.md']) });
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.args, /compare/);
  });
}

test('sec check-main-tip: gh falla siempre → 1 tras TIP_RETRIES intentos, sin imprimir el token', () => {
  const r = tip({ [COMMITS]: { err: `HTTP 502 token=${TOKEN}` } });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.args.trim().split('\n').length, 2);
  assert.ok(!r.out.includes(TOKEN), r.out);
  assert.match(r.out, /No se despliega/);
});

test('sec check-main-tip: error de gh con \\r y comandos de workflow no inyecta líneas ::', () => {
  const r = tip({ [COMMITS]: { err: 'HTTP 500\r::error::PWN\r::add-mask::x\n::set-output name=a::b' } });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.out, /\r/);
  for (const line of r.out.split('\n')) {
    assert.ok(!/^::(?!warning::Intento|error::No se pudo comprobar)/.test(line), `línea inyectada: ${line}`);
  }
  assert.doesNotMatch(r.out, /set-output/, 'solo la primera línea del error');
});

test('sec check-main-tip: compare falla siempre → 1 (no presume "solo docs")', () => {
  const r = tip(newerWith({ err: 'HTTP 404: Not Found' }));
  assert.equal(r.code, 1, r.out);
});

// ----------------------------------- 5 · excepción "solo docs": no se abre a código

for (const st of ['behind', 'diverged', 'identical', '', null, 'AHEAD', 'ahead ']) {
  test(`sec check-main-tip: compare con status ${JSON.stringify(st)} → 1`, () => {
    const r = tip(newerWith(cmp(st, ['docs/estado.md'])));
    assert.equal(r.code, 1, r.out);
  });
}

const DEPLOYABLE = [
  'src/main.js', 'index.html', 'package.json', 'package-lock.json', 'vite.config.js',
  'supabase/migrations/20270101000000_x.sql', 'supabase/config.toml', 'scripts/ci/check-main-tip.sh',
  '.github/workflows/deploy.yml', 'engine/color.js', 'public/robots.txt',
  // Parecidos a docs que no lo son:
  'docs', 'docsx/a.js', 'docs.js', 'src/docs/app.js', 'Docs/a.js', './docs/../src/main.js'.replace('./', 'x/'),
  'a.md.js', 'README.MD', 'README.markdown', 'src/x.mdx', 'src/x.md ', 'notas.md\n',
];
for (const f of DEPLOYABLE) {
  test(`sec check-main-tip: un archivo ${JSON.stringify(f)} entre docs → 1 (no se despliega el commit viejo)`, () => {
    const r = tip(newerWith(cmp('ahead', ['docs/estado.md', f, 'CHANGELOG.md'])));
    assert.equal(r.code, 1, r.out);
  });
}

for (const [label, files] of [
  ['filename nulo', [{ filename: null }]],
  ['filename numérico', [{ filename: 7 }]],
  ['entrada sin filename', [{ status: 'modified' }]],
  ['entrada no objeto', ['docs/a.md', 3]],
]) {
  test(`sec check-main-tip: files con ${label} → 1`, () => {
    const body = JSON.stringify({ status: 'ahead', files });
    const r = tip(newerWith(body));
    assert.equal(r.code, 1, r.out);
  });
}

test('sec check-main-tip: 300 o más archivos (lista truncada por la API) → 1 aunque todos sean docs', () => {
  const many = Array.from({ length: 300 }, (_, i) => `docs/n${i}.md`);
  assert.equal(tip(newerWith(cmp('ahead', many))).code, 1);
  assert.equal(tip(newerWith(cmp('ahead', many.slice(0, 299)))).code, 0);
});

test('sec check-main-tip: la excepción usa exactamente los paths-ignore de deploy.yml', () => {
  const push = WF.split(/^ {2}push:\s*$/m)[1].split(/^\S/m)[0];
  const ignored = [...push.matchAll(/^\s+- '([^']+)'\s*$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(ignored, ['**/*.md', 'docs/**'], 'si cambian los paths-ignore, revisa el filtro de check-main-tip.sh');
  const src = readFileSync(TIP, 'utf8');
  assert.match(src, /startswith\("docs\/"\)/);
  assert.match(src, /endswith\("\.md"\)/);
});

test('sec check-main-tip: deploy.yml lo ejecuta en verify, sin if:, continue-on-error ni anulación de reintentos', () => {
  const verify = WF.split(/^ {2}verify:\s*$/m)[1].split(/^ {2}[\w-]+:\s*$/m)[0];
  const i = verify.indexOf('run: bash scripts/ci/check-main-tip.sh');
  assert.ok(i > 0);
  const step = verify.slice(verify.lastIndexOf('- name:', i), i);
  assert.doesNotMatch(step, /^\s*if:/m);
  assert.doesNotMatch(step, /continue-on-error|TIP_RETR|GITHUB_EVENT_NAME|GITHUB_REPOSITORY/);
  assert.match(step, /HEAD_SHA: \$\{\{ github\.sha \}\}/);
  // El resto de jobs dependen de verify (no hay forma de saltarlo en un run nuevo).
  for (const j of ['build-pages']) {
    const block = WF.split(new RegExp(`^ {2}${j}:\\s*$`, 'm'))[1].split(/^ {2}[\w-]+:\s*$/m)[0];
    assert.match(block, /needs: verify/);
  }
});

// ------------------------------------------------ 1/8 · correo fail-closed (H-C06-01)

const FAKE_KEY = ['re', 'SECF11', 'ficticia'].join('_');
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x', RESEND_API_KEY: FAKE_KEY };
const readSupabaseConfig = (e) => ({ url: e.SUPABASE_URL, secretKey: e.SUPABASE_SECRET_KEY });
const ALERT = { id: 'a1', unit_id: 'u1', recipient_user_id: '22222222-0000-4000-8000-000000000001', kind: 'color_change', payload: {}, sent_at: '2027-02-01T11:00:00Z', emailed_at: null, email_attempts: 0 };

/** BD de C-05 (sin métodos de C-06) que registra cualquier acceso. */
function legacyDb(extra = {}) {
  const touched = [];
  const handler = { get: (t, k) => { if (typeof k === 'string' && k !== 'then') touched.push(k); return t[k]; } };
  const base = {
    pendingEmailAlerts: async () => [ALERT],
    userEmail: async () => 'lider@example.test',
    markAlertEmailed: async () => true,
    recordAlertEmailFailure: async () => undefined,
    insertAudit: async () => undefined,
    ...extra,
  };
  return { db: new Proxy(base, handler), touched };
}

const VARIANTS = [
  ['BD de C-05 sin ningún método de C-06', {}],
  ['recipientAccess como valor no función', { recipientAccess: { email: 'x' }, expiredEmailAlerts: async () => [], markAlertsEmailSkipped: async () => [] }],
  ['markAlertsEmailSkipped heredado de prototipo no función', { recipientAccess: async () => null, expiredEmailAlerts: async () => [], markAlertsEmailSkipped: 'skip' }],
];
for (const [label, extra] of VARIANTS) {
  test(`sec email H-C06-01: ${label} → código 2, cero llamadas a Resend y sin leer alertas`, async () => {
    const { db, touched } = legacyDb(extra);
    let calls = 0;
    const lines = [];
    const r = await runEmailStep({
      env: ENV, makeDb: async () => db, readSupabaseConfig, log: (l) => lines.push(l), sleep: async () => {},
      fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
    });
    assert.equal(r.code, 2);
    assert.equal(calls, 0);
    for (const k of ['pendingEmailAlerts', 'userEmail', 'markAlertEmailed', 'insertAudit']) assert.ok(!touched.includes(k), `leyó ${k}`);
    assert.ok(lines.some((l) => l.startsWith('::error::')));
    assert.ok(!lines.join('\n').includes(FAKE_KEY));
  });
}

test('sec email H-C06-01: makeDb que devuelve null o un no-objeto → código 2 sin enviar', async () => {
  for (const bad of [null, undefined, 42, 'db']) {
    let calls = 0;
    const r = await runEmailStep({
      env: ENV, makeDb: async () => bad, readSupabaseConfig, log: () => {}, sleep: async () => {},
      fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
    });
    assert.equal(r.code, 2, String(bad));
    assert.equal(calls, 0);
  }
});

test('sec email H-C06-01: la lista de métodos exigidos está congelada y contiene los tres de C-06', () => {
  assert.ok(Object.isFrozen(REQUIRED_C06_DB_METHODS));
  assert.deepEqual([...REQUIRED_C06_DB_METHODS].sort(), ['expiredEmailAlerts', 'markAlertsEmailSkipped', 'recipientAccess']);
  const src = readFileSync(join(ROOT, 'scripts', 'send-alert-emails.js'), 'utf8');
  assert.match(src, /runEmailStep\(/, 'la ruta de producción pasa por runEmailStep');
  assert.doesNotMatch(src, /sendAlertEmails\(/, 'la ruta de producción no llama a sendAlertEmails directamente');
});

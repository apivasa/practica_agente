// V-05c — Seguridad de la compuerta "CI del mismo commit en verde" de
// deploy.yml (scripts/ci/wait-ci.sh) y de la traza apagada en db-url.sh.
// Categoría 5 (Actions). Pruebas activas con entradas hostiles: ejecuta los
// scripts con bash y un `gh` falso en PATH. Sin red; nunca toca producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WAIT = join(ROOT, 'scripts', 'ci', 'wait-ci.sh');
const DBURL = join(ROOT, 'scripts', 'ci', 'db-url.sh');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const strip = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CODE = strip(WF);

const SHA = 'b'.repeat(40);
const TOKEN = 'ghs_SECtokenFAKEvalue42';
const BASE = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'owner/repo',
  HEAD_SHA: SHA,
  GH_TOKEN: TOKEN,
  CI_WAIT_TIMEOUT_SECONDS: '0',
  CI_WAIT_INTERVAL_SECONDS: '0',
};
const CI = '.github/workflows/ci.yml';
// F-11 (H-QA-V05c-03): los fixtures traen head_sha y event como la API real, para que
// endurecer el filtro jq de wait-ci.sh (sin `// $sha` ni `// "push"`) no los rompa.
const run = (id, status, conclusion, path = CI) => ({ id, status, conclusion, path, head_sha: SHA, event: 'push' });
const body = (...runs) => JSON.stringify({ total_count: runs.length, workflow_runs: runs });

/** wait-ci.sh con un gh falso que siempre responde `resp` (null = gh falla). */
function waitCi(resp, env = {}, ghExtra = '') {
  const dir = mkdtempSync(join(tmpdir(), 'sec-v05c-'));
  try {
    writeFileSync(join(dir, 'resp'), resp ?? '');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash
printf '%s\\n' "$*" >> "${dir}/args"
${ghExtra}
${resp === null ? 'exit 1' : `cat "${dir}/resp"`}
`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [WAIT], {
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

function job(name) {
  const rest = WF.split(/^jobs:\s*$/m)[1];
  const m = rest.split(/^ {2}(?=[\w-]+:\s*$)/m).find((b) => b.startsWith(`${name}:`));
  assert.ok(m, `no existe el job ${name}`);
  return m;
}

function step(jobText, stepName) {
  const parts = jobText.split(/^ {6}- /m);
  const s = parts.find((p) => p.startsWith(`name: ${stepName}`));
  assert.ok(s, `no existe el paso ${stepName}`);
  return s;
}

// ----------------------------------------------------- 5 · entrada hostil (SHA)

const BAD_SHAS = [
  ['vacío', ''],
  ['39 hex', 'a'.repeat(39)],
  ['41 hex', 'a'.repeat(41)],
  ['mayúsculas', 'A'.repeat(40)],
  ['inyección de query', `${'a'.repeat(40)}&branch=evil`],
  ['sustitución de comando', '$(touch /tmp/pwn)aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ['salto de línea', `${'a'.repeat(40)}\n`],
  ['ref en vez de SHA', 'refs/heads/main'],
];
for (const [label, sha] of BAD_SHAS) {
  test(`sec wait-ci: HEAD_SHA hostil (${label}) → falla sin consultar la API`, () => {
    const r = waitCi(body(run(1, 'completed', 'success')), { HEAD_SHA: sha });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '', 'no debe llamar a gh');
  });
}

// --------------------------------------------- 5 · entrada hostil (repositorio)

const BAD_REPOS = [
  ['vacío', ''],
  ['sin barra', 'ownerrepo'],
  ['query', 'owner/repo?per_page=1'],
  ['fragmento', 'owner/repo#x'],
  ['ruta extra', 'owner/repo/actions'],
  ['espacio', 'owner/re po'],
  ['salto de línea', 'owner/repo\nx'],
  ['sustitución', '$(id)/repo'],
];
for (const [label, repo] of BAD_REPOS) {
  test(`sec wait-ci: GITHUB_REPOSITORY hostil (${label}) → falla sin consultar la API`, () => {
    const r = waitCi(body(run(1, 'completed', 'success')), { GITHUB_REPOSITORY: repo });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '');
  });
}

for (const [label, v] of [['negativo', '-1'], ['notación', '1e3'], ['sustitución', '$(id)'], ['espacio', ' 5']]) {
  test(`sec wait-ci: tope/intervalo hostil (${label}) → falla sin consultar la API`, () => {
    const a = waitCi(body(run(1, 'completed', 'success')), { CI_WAIT_TIMEOUT_SECONDS: v });
    const b = waitCi(body(run(1, 'completed', 'success')), { CI_WAIT_INTERVAL_SECONDS: v });
    assert.equal(a.code, 1, a.out);
    assert.equal(b.code, 1, b.out);
    assert.equal(a.args + b.args, '');
  });
}

test('sec wait-ci: la consulta fija head_sha, event=push y branch=main con el SHA validado', () => {
  const r = waitCi(body(run(5, 'completed', 'success')));
  assert.equal(r.code, 0, r.out);
  assert.equal(r.args.trim(), `api repos/owner/repo/actions/runs?head_sha=${SHA}&event=push&branch=main&per_page=100`);
});

// --------------------------------- 5 · un workflow impostor no abre la compuerta

const IMPOSTORS = [
  '.github/workflows/ci.yaml',
  '.github/workflows/ci.yml.bak',
  '.github/workflows/ci.yml-evil',
  '.github/workflows/xci.yml',
  '.github/workflows/CI.yml',
  'evil/.github/workflows/ci.yml',
  '.github/workflows/seguridad.yml',
  '.github/workflows/deploy.yml',
];
for (const p of IMPOSTORS) {
  test(`sec wait-ci: un run en success de ${p} no cuenta como CI`, () => {
    const r = waitCi(body(run(99, 'completed', 'success', p)));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /No apareció ningún run de CI/);
  });
}

test('sec wait-ci: impostor en success con id mayor no tapa un CI real en failure', () => {
  const r = waitCi(body(run(10, 'completed', 'failure'), run(50, 'completed', 'success', '.github/workflows/ci.yml.bak')));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /conclusion 'failure'/);
});

test('sec wait-ci: un run viejo en success no tapa el más reciente en failure (rerun)', () => {
  const r = waitCi(body(run(10, 'completed', 'success'), run(11, 'completed', 'failure')));
  assert.equal(r.code, 1, r.out);
});

// ------------------------------------- 5 · solo success abre; todo lo demás cierra

for (const c of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale', 'startup_failure', null, '', 'SUCCESS']) {
  test(`sec wait-ci: completed con conclusion ${JSON.stringify(c)} → no despliega`, () => {
    const r = waitCi(body(run(7, 'completed', c)));
    assert.equal(r.code, 1, r.out);
  });
}

for (const s of ['queued', 'in_progress', 'waiting', 'pending', 'requested', 'COMPLETED', 'completed success']) {
  test(`sec wait-ci: status ${JSON.stringify(s)} con conclusion success no abre la compuerta`, () => {
    const r = waitCi(body(run(7, s, 'success')));
    assert.equal(r.code, 1, r.out);
  });
}

for (const [label, resp] of [['gh falla', null], ['HTML', '<html>rate limit</html>'], ['JSON vacío', '{}'], ['lista vacía', body()], ['vacío', '']]) {
  test(`sec wait-ci: respuesta de la API ${label} → falla cerrada al agotar el tope`, () => {
    const r = waitCi(resp);
    assert.equal(r.code, 1, r.out);
  });
}

// --------------------------------------------------- 5 · el token nunca se traza

test('sec wait-ci: si gh vuelca el token por stderr o stdout, no llega al log', () => {
  const resp = JSON.stringify({ token: TOKEN, workflow_runs: [run(3, 'completed', 'failure')] });
  const r = waitCi(resp, {}, `echo "Authorization: token $GH_TOKEN" >&2`);
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes(TOKEN), 'el token aparece en la salida');
});

test('sec wait-ci: el script no usa xtrace, eval ni escribe en GITHUB_ENV/GITHUB_OUTPUT', () => {
  const src = strip(readFileSync(WAIT, 'utf8'));
  assert.doesNotMatch(src, /set\s+-[a-z]*x|xtrace|\beval\b|GITHUB_ENV|GITHUB_OUTPUT|GITHUB_PATH/);
  assert.doesNotMatch(src, /echo[^\n]*\$\{?GH_TOKEN/);
});

// ------------------------------------------------ 5 · estructura en deploy.yml

test('sec deploy.yml: la compuerta de CI no se puede saltar (sin if, continue-on-error ni ${{ }} en run)', () => {
  const s = step(job('verify'), 'CI del mismo commit en verde');
  assert.doesNotMatch(s, /^\s*if:/m);
  assert.doesNotMatch(s, /continue-on-error/);
  assert.match(s, /run: bash scripts\/ci\/wait-ci\.sh\s*$/m);
  assert.match(s, /HEAD_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(s, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(s, /CI_WAIT_TIMEOUT_SECONDS|CI_WAIT_INTERVAL_SECONDS|GITHUB_EVENT_NAME|inputs\./);
});

test('sec deploy.yml: nadie redefine GITHUB_EVENT_NAME, GITHUB_REPOSITORY ni escribe GITHUB_ENV en verify', () => {
  assert.doesNotMatch(CODE, /^\s+GITHUB_(EVENT_NAME|REPOSITORY|SHA|REF)\s*:/m);
  assert.doesNotMatch(strip(job('verify')), /GITHUB_ENV|GITHUB_PATH|GITHUB_OUTPUT/);
});

test('sec deploy.yml: actions: read solo en verify; ningún job pide actions/contents write ni write-all', () => {
  assert.doesNotMatch(CODE, /actions:\s*write|contents:\s*write|write-all|read-all/);
  const withActions = ['verify', 'build-pages', 'migrate-plan', 'migrate', 'deploy-pages', 'smoke']
    .filter((j) => /actions:\s*read/.test(job(j)));
  assert.deepEqual(withActions, ['verify']);
  assert.match(CODE.split(/^jobs:/m)[0], /permissions:\s*\n\s+contents: read\s*\n/);
});

test('sec deploy.yml: todo lo irreversible depende de verify (build → plan → migrate → pages)', () => {
  assert.match(job('build-pages'), /^ {4}needs: verify\s*$/m);
  assert.match(job('migrate-plan'), /^ {4}needs: build-pages\s*$/m);
  assert.match(job('migrate'), /^ {4}needs: migrate-plan\s*$/m);
  assert.match(job('deploy-pages'), /^ {4}needs: \[build-pages, migrate\]\s*$/m);
  assert.doesNotMatch(CODE, /always\(\)|cancelled\(\)|failure\(\)|continue-on-error/);
});

test('sec deploy.yml: solo push y workflow_dispatch disparan; ci.yml corre en todo push a main', () => {
  const on = CODE.split(/^on:/m)[1].split(/^permissions:/m)[0];
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(triggers.sort(), ['push', 'workflow_dispatch']);
  const ci = strip(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const ciPush = ci.split(/^ {2}push:/m)[1].split(/^ {2}\S/m)[0];
  assert.match(ciPush, /main/);
  assert.doesNotMatch(ciPush, /paths|branches-ignore/, 'si ci.yml filtra rutas, deploy esperaría un CI que nunca llega');
});

// --------------------------- 5 · db-url.sh: xtrace apagado y sin restaurar (V-05c)

const REF = 'abcdefghijklmnopqrst';
const HOST = 'aws-0-us-east-1.pooler.supabase.com';
const PASS = 'SEC-xtrace-p@ss/zz7';
const ENV = { PATH: process.env.PATH, SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST };

test('sec db-url: con xtrace, el comando que usa $SUPABASE_DB_URL después tampoco se traza (no restaurar es lo seguro)', () => {
  const r = spawnSync('bash', ['-c', `set -euxo pipefail; . "${DBURL}"; supabase_db_url; true db push --db-url "$SUPABASE_DB_URL" --yes`], { env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes('postgresql://'), 'la URL aparece en la traza del comando posterior');
  assert.ok(!r.stderr.includes(encodeURIComponent(PASS)));
  assert.ok(!r.stderr.includes(PASS));
});

test('sec db-url: xtrace heredado por SHELLOPTS tampoco filtra la contraseña', () => {
  const r = spawnSync('bash', ['-c', `. "${DBURL}"; supabase_db_url; true "$SUPABASE_DB_URL"`], { env: { ...ENV, SHELLOPTS: 'xtrace' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes(encodeURIComponent(PASS)));
  assert.ok(!r.stderr.includes('postgresql://'));
});

test('sec db-url: con BASH_XTRACEFD a stdout, nada de la contraseña sale por ningún canal', () => {
  const r = spawnSync('bash', ['-c', `exec 9>&1; BASH_XTRACEFD=9; set -x; . "${DBURL}"; supabase_db_url; true "$SUPABASE_DB_URL"`], { env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const all = `${r.stdout}${r.stderr}`.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');
  assert.ok(!all.includes(encodeURIComponent(PASS)), all);
  assert.ok(!all.includes(PASS));
});

test('sec deploy.yml: ningún paso de migraciones reactiva xtrace después de supabase_db_url', () => {
  for (const j of ['migrate-plan', 'migrate']) {
    const t = strip(job(j));
    assert.doesNotMatch(t, /set\s+-[a-z]*x|set -o xtrace|bash -x|SHELLOPTS|BASH_XTRACEFD/);
  }
});

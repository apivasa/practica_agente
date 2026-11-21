// V-05c (desarrollador): deploy.yml espera al CI del mismo commit en push a
// main (scripts/ci/wait-ci.sh) y db-url.sh nunca traza la contraseña aunque
// el paso tenga xtrace. Ejecuta los scripts con bash y un `gh` falso en PATH.
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
const CODE = WF.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const SHA = 'a'.repeat(40);
const TOKEN = 'ghs_FAKEtokenVALUEzz9';
const BASE = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'owner/repo',
  HEAD_SHA: SHA,
  GH_TOKEN: TOKEN,
  CI_WAIT_TIMEOUT_SECONDS: '0',
  CI_WAIT_INTERVAL_SECONDS: '0',
};

const run = (id, status, conclusion, path = '.github/workflows/ci.yml') => ({ id, status, conclusion, path });
const body = (...runs) => JSON.stringify({ total_count: runs.length, workflow_runs: runs });

/**
 * Ejecuta wait-ci.sh con un gh falso que devuelve `responses[i]` en la
 * llamada i (la última se repite). `null` = gh falla.
 */
function waitCi(responses, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v05c-gh-'));
  try {
    responses.forEach((r, i) => writeFileSync(join(dir, `r${i}`), r ?? ''));
    const fail = responses.map((r, i) => (r === null ? `[ "$n" = ${i} ] && exit 1;` : '')).join(' ');
    const last = responses.length - 1;
    writeFileSync(join(dir, 'gh'), `#!/bin/bash
c="${dir}/count"; n=$(cat "$c" 2>/dev/null || echo 0); echo $((n+1)) > "$c"
printf '%s\\n' "$*" >> "${dir}/args"
[ "$n" -gt ${last} ] && n=${last}
${fail}
cat "${dir}/r$n"
`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [WAIT], { env: { PATH: `${dir}:${process.env.PATH}`, ...BASE, ...env }, encoding: 'utf8' });
    let args = '';
    try { args = readFileSync(join(dir, 'args'), 'utf8'); } catch { /* gh no se llamó */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, args, calls: args.split('\n').filter(Boolean).length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('wait-ci: CI del commit en success → pasa y consulta head_sha, event=push y branch=main', () => {
  const r = waitCi([body(run(10, 'completed', 'success'))]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.args, new RegExp(`^api repos/owner/repo/actions/runs\\?head_sha=${SHA}&event=push&branch=main`, 'm'));
  assert.match(r.out, /CI del commit en verde \(run 10\)/);
});

for (const c of ['failure', 'cancelled', 'timed_out', 'action_required', 'skipped', 'neutral', 'startup_failure', null]) {
  test(`wait-ci: CI completed con conclusion ${c} → falla con mensaje claro`, () => {
    const r = waitCi([body(run(11, 'completed', c))]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /::error::El CI del commit .* terminó con conclusion/);
    assert.match(r.out, /actions\/runs\/11/);
  });
}

test('wait-ci: espera mientras CI está queued/in_progress y pasa cuando termina en success', () => {
  const r = waitCi([body(run(12, 'queued', null)), body(run(12, 'in_progress', null)), body(run(12, 'completed', 'success'))],
    { CI_WAIT_TIMEOUT_SECONDS: '60' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls, 3);
});

test('wait-ci: espera a que aparezca el run y a que termine; un fallo final bloquea', () => {
  const r = waitCi([body(), body(run(13, 'in_progress', null)), body(run(13, 'completed', 'failure'))], { CI_WAIT_TIMEOUT_SECONDS: '60' });
  assert.notEqual(r.code, 0);
  assert.equal(r.calls, 3);
});

test('wait-ci: el run de CI nunca aparece → falla al agotar el tope', () => {
  const r = waitCi([body()]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /::error::No apareció ningún run de CI/);
});

test('wait-ci: CI sin terminar al agotar el tope → falla nombrando el run', () => {
  const r = waitCi([body(run(14, 'in_progress', null))]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /::error::El CI del commit .* \(run 14\) no terminó/);
});

test('wait-ci: ignora otros workflows del mismo commit (solo cuenta ci.yml)', () => {
  const others = [run(20, 'completed', 'success', '.github/workflows/seguridad.yml'), run(21, 'completed', 'success', '.github/workflows/ci-falso.yml')];
  assert.notEqual(waitCi([body(...others)]).code, 0);
  assert.notEqual(waitCi([body(...others, run(5, 'completed', 'failure'))]).code, 0);
  assert.equal(waitCi([body(...others, run(5, 'completed', 'success', '.github/workflows/ci.yml@refs/heads/main'))]).code, 0);
});

test('wait-ci: con varios runs de CI del commit decide el más reciente (id mayor)', () => {
  assert.equal(waitCi([body(run(30, 'completed', 'failure'), run(31, 'completed', 'success'))]).code, 0);
  assert.notEqual(waitCi([body(run(41, 'completed', 'failure'), run(40, 'completed', 'success'))]).code, 0);
});

test('wait-ci: error transitorio de la API o respuesta no JSON → reintenta', () => {
  const r = waitCi([null, 'no es json', body(run(50, 'completed', 'success'))], { CI_WAIT_TIMEOUT_SECONDS: '60' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls, 3);
  assert.match(r.out, /::warning::/);
});

test('wait-ci: la API falla siempre → falla al agotar el tope', () => {
  assert.notEqual(waitCi([null]).code, 0);
});

test('wait-ci: con disparo manual no consulta la API ni espera', () => {
  for (const ev of ['workflow_dispatch']) {
    const r = waitCi([body()], { GITHUB_EVENT_NAME: ev });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.calls, 0);
  }
});

for (const [label, env] of [
  ['SHA corto', { HEAD_SHA: 'abc123' }],
  ['SHA con inyección', { HEAD_SHA: `${SHA}&branch=x` }],
  ['repositorio inválido', { GITHUB_REPOSITORY: 'owner/repo/../x' }],
  ['sin token', { GH_TOKEN: '' }],
  ['tope no numérico', { CI_WAIT_TIMEOUT_SECONDS: '1; id' }],
]) {
  test(`wait-ci: ${label} → falla sin consultar la API`, () => {
    const r = waitCi([body(run(1, 'completed', 'success'))], env);
    assert.notEqual(r.code, 0);
    assert.equal(r.calls, 0);
  });
}

test('wait-ci: nunca imprime el token', () => {
  for (const resp of [[body(run(1, 'completed', 'success'))], [body(run(1, 'completed', 'failure'))], [null]]) {
    assert.ok(!waitCi(resp).out.includes(TOKEN));
  }
});

// ------------------------------------------------------------- deploy.yml

function verifyJob() {
  return CODE.slice(CODE.indexOf('\n  verify:'), CODE.indexOf('\n  build-pages:'));
}

test('deploy.yml: verify tiene actions: read (y ningún permiso de escritura) para consultar el CI', () => {
  const v = verifyJob();
  assert.match(v, /^ {4}permissions:\n {6}contents: read\n {6}actions: read\n/m);
  assert.doesNotMatch(v, /:\s*write\b/);
});

test('deploy.yml: verify ejecuta wait-ci.sh con el token del job y github.sha, después de los chequeos de configuración', () => {
  const v = verifyJob();
  const lines = v.split('\n');
  const step = lines.findIndex((l) => l.includes('- name: CI del mismo commit en verde'));
  const auth = lines.findIndex((l) => l.includes('- name: Registro cerrado en Auth'));
  assert.ok(step > auth && auth > 0, 'la espera al CI va después del registro cerrado (tras el checkout)');
  const s = lines.slice(step, step + 6).join('\n');
  assert.match(s, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(s, /HEAD_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(s, /run:\s*bash scripts\/ci\/wait-ci\.sh\s*$/m);
  assert.doesNotMatch(v, /^\s+if:/m);
});

test('deploy.yml: el timeout de verify cubre el tope de espera del CI (20 min)', () => {
  const m = verifyJob().match(/^ {4}timeout-minutes:\s*(\d+)/m);
  assert.ok(m && Number(m[1]) > 20, 'timeout-minutes de verify debe superar 20');
  assert.match(readFileSync(WAIT, 'utf8'), /CI_WAIT_TIMEOUT_SECONDS:-1200/);
});

// ------------------------------------------------------- db-url.sh sin traza

const REF = 'abcdefghijklmnopqrst';
const HOST = 'aws-0-us-east-1.pooler.supabase.com';
const PASS = 'FAKE-xtrace-p@ss/zz9';

test('db-url: con set -x activo en el paso, ni la contraseña ni la URL aparecen en la traza', () => {
  const r = spawnSync('bash', ['-c', `set -euxo pipefail; . "${DBURL}"; supabase_db_url; test -n "$SUPABASE_DB_URL"`], {
    env: { PATH: process.env.PATH, SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const all = `${r.stdout}${r.stderr}`;
  assert.ok(!all.includes(PASS), 'la contraseña en claro aparece en la salida');
  const enc = encodeURIComponent(PASS);
  assert.ok(!r.stderr.includes(enc), 'la contraseña codificada aparece en la traza');
  assert.ok(!r.stderr.includes('postgresql://'), 'la URL aparece en la traza');
  assert.doesNotMatch(r.stderr, /set \+x/, 'el propio set +x no debe trazarse');
});

test('db-url: con set -x, también los errores de validación salen sin traza', () => {
  const r = spawnSync('bash', ['-c', `set -x; . "${DBURL}"; supabase_db_url`], {
    env: { PATH: process.env.PATH, SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: 'evil.example.com' },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.ok(!`${r.stdout}${r.stderr}`.includes(PASS));
});

test('db-url.sh: la primera instrucción de supabase_db_url apaga xtrace sin trazarse', () => {
  const src = readFileSync(DBURL, 'utf8');
  const fn = src.slice(src.indexOf('supabase_db_url() {'));
  const first = fn.split('\n').slice(1).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  assert.equal(first, '{ set +x; } 2>/dev/null');
});

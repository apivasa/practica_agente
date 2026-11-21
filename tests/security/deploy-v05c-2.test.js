// V-05c (intento 2 de V-05b) — Seguridad de los cambios en la compuerta de CI:
// error de gh saneado en el log de wait-ci.sh (token, comandos de workflow,
// recorte), eventos admitidos, filtro jq por head_sha/event, concurrencia de
// ci.yml por SHA en main y umbral 90 min de deploy-main.
// Categoría 5 (Actions). Ejecuta wait-ci.sh con bash y un `gh` falso en PATH.
// Sin red; nunca toca producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEPLOY_RULE, assessDeploy } from '../../scripts/health/lib.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WAIT = join(ROOT, 'scripts', 'ci', 'wait-ci.sh');
const strip = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const SHA = 'c'.repeat(40);
const TOKEN = 'ghs_SEC2tokenFAKEvalue77';
const BASE = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'owner/repo',
  HEAD_SHA: SHA,
  GH_TOKEN: TOKEN,
  CI_WAIT_TIMEOUT_SECONDS: '0',
  CI_WAIT_INTERVAL_SECONDS: '0',
};
const CI = '.github/workflows/ci.yml';
const body = (...runs) => JSON.stringify({ total_count: runs.length, workflow_runs: runs });
const run = (id, status, conclusion, extra = {}) => ({ id, status, conclusion, path: CI, head_sha: SHA, event: 'push', head_branch: 'main', ...extra });

/**
 * wait-ci.sh con un gh falso. `stderr` se escribe tal cual (bytes) en el
 * stderr de gh; si `fail`, gh sale con 1; si no, imprime `resp`.
 */
function waitCi({ resp = '', stderr = '', fail = false, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sec-v05c2-'));
  try {
    writeFileSync(join(dir, 'resp'), resp);
    writeFileSync(join(dir, 'err'), stderr);
    writeFileSync(join(dir, 'gh'), `#!/bin/bash
printf '%s\\n' "$*" >> "${dir}/args"
cat "${dir}/err" >&2
${fail ? 'exit 1' : `cat "${dir}/resp"`}
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

// El runner de Actions parte la salida en líneas con \n, \r\n y también \r
// suelto, y reconoce un comando si la línea (sin espacios al inicio) empieza
// por "::". Solo se admiten los prefijos propios del script.
const OWN = /^::(warning|error)::(No se pudo consultar la API de Actions|La API de GitHub falló|Respuesta inesperada)/;
function assertNoInjectedCommands(out) {
  for (const raw of out.split(/\r\n|\r|\n/)) {
    const l = raw.trimStart();
    if (l.startsWith('::')) assert.match(l, OWN, `comando de workflow inyectado: ${JSON.stringify(raw)}`);
  }
}

// ------------------------------------------- 5 · el error de gh no filtra el token

const TOKENS = [
  ['ghs normal', TOKEN],
  ['con & (patsub_replacement)', 'ghs_A&B&tok9'],
  ['con comodines de glob', 'ghs_*?[ab]tok'],
  ['con barra invertida', 'ghs_\\x\\tok'],
  ['con barra', 'ghs_a/b/tok'],
];
for (const [label, tok] of TOKENS) {
  test(`sec wait-ci: gh falla con el token (${label}) en stderr → no llega al log`, () => {
    const r = waitCi({ fail: true, stderr: `HTTP 401: Bad credentials (token ${tok}) ${tok}\n`, env: { GH_TOKEN: tok } });
    assert.equal(r.code, 1, r.out);
    assert.ok(!r.out.includes(tok), r.out);
    assert.match(r.out, /\*\*\*/);
    assert.match(r.out, /La API de GitHub falló 1 veces/);
  });
}

test('sec wait-ci: el token en una segunda línea del error no se muestra (solo la primera)', () => {
  const r = waitCi({ fail: true, stderr: `HTTP 403\nAuthorization: token ${TOKEN}\n` });
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes(TOKEN));
  assert.ok(!r.out.includes('Authorization'));
});

test('sec wait-ci: el token cerca del límite de 200 caracteres se enmascara antes de recortar', () => {
  const r = waitCi({ fail: true, stderr: `${'e'.repeat(190)}${TOKEN}tail` });
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes(TOKEN));
  // Ningún prefijo del token de más de 8 caracteres sobrevive al recorte.
  assert.ok(!r.out.includes(TOKEN.slice(0, 9)), r.out);
});

test('sec wait-ci: el error mostrado se recorta a 200 caracteres', () => {
  const r = waitCi({ fail: true, stderr: `${'Z'.repeat(5000)}\n` });
  const shown = r.out.match(/Z+/g) ?? [];
  assert.ok(shown.length > 0, r.out);
  for (const s of shown) assert.ok(s.length <= 200, `se muestran ${s.length} caracteres`);
});

test('sec wait-ci: gh falla sin mensaje → texto por defecto, sin línea vacía ni comando', () => {
  const r = waitCi({ fail: true, stderr: '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /sin mensaje/);
  assertNoInjectedCommands(r.out);
});

// --------------------------- 5 · el error de gh no inyecta comandos de workflow

const PAYLOADS = [
  ['::error:: al inicio', '::error::PWN\n'],
  ['::add-mask::', 'x ::add-mask::PWN\n'],
  ['::stop-commands::', '::stop-commands::tok123\n'],
  ['tres dos puntos', ':::warning::PWN\n'],
  ['cuatro dos puntos', '::::error::PWN\n'],
  ['\\r suelto y comando', 'HTTP 502\r::error::PWN\r::set-output name=a::b\n'],
  ['\\r con espacios', 'HTTP 502\r   ::error::PWN\n'],
  ['\\r\\n', 'HTTP 502\r\n::error::PWN\n'],
  ['segunda línea', 'HTTP 502\n::error::PWN\n'],
  ['::group:: y ::endgroup::', '::group::x::endgroup::\n'],
  ['::debug:: con %0A', '%0A::debug::PWN%0D::error::PWN\n'],
];
for (const [label, err] of PAYLOADS) {
  test(`sec wait-ci: stderr hostil de gh (${label}) no inyecta comandos de workflow`, () => {
    const r = waitCi({ fail: true, stderr: err });
    assert.equal(r.code, 1, r.out);
    assertNoInjectedCommands(r.out);
  });
}

test('sec wait-ci: un cuerpo no JSON con comandos no se vuelca al log', () => {
  const r = waitCi({ resp: `::error::PWN\n${TOKEN}\n<html>` });
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes('PWN'));
  assert.ok(!r.out.includes(TOKEN));
});

// ------------------------------------------------ 5 · solo push y workflow_dispatch

for (const ev of ['pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'repository_dispatch', 'release', 'merge_group', '', 'PUSH', 'push ', 'workflow_dispatch ', 'Workflow_dispatch']) {
  test(`sec wait-ci: evento ${JSON.stringify(ev)} → falla sin consultar la API`, () => {
    const r = waitCi({ resp: body(run(1, 'completed', 'success')), env: { GITHUB_EVENT_NAME: ev } });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.args, '');
  });
}

test('sec wait-ci: workflow_dispatch exacto es el único exento (0 sin llamar a gh)', () => {
  const r = waitCi({ resp: body(run(1, 'completed', 'failure')), env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.args, '');
});

test('sec wait-ci: un nombre de evento con salto de línea falla cerrado sin consultar la API', () => {
  const r = waitCi({ env: { GITHUB_EVENT_NAME: 'push\n::add-mask::PWN' } });
  assert.equal(r.code, 1);
  // GITHUB_EVENT_NAME lo pone el runner y no lo controla un atacante (deploy-v05c
  // prueba que nadie lo redefine); el eco del valor en ::error:: es solo Info.
  assert.equal(r.args, '');
});

// --------------------------------------- 5 · filtro jq: head_sha y event por run

test('sec wait-ci: un success de otro head_sha no cuenta como CI del commit', () => {
  const r = waitCi({ resp: body(run(9, 'completed', 'success', { head_sha: 'd'.repeat(40) })) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /No apareció ningún run de CI/);
});

for (const ev of ['pull_request', 'workflow_dispatch', 'pull_request_target', 'PUSH']) {
  test(`sec wait-ci: un success con event ${ev} no cuenta como CI del push a main`, () => {
    const r = waitCi({ resp: body(run(9, 'completed', 'success', { event: ev })) });
    assert.equal(r.code, 1, r.out);
  });
}

test('sec wait-ci: un success de otro SHA con id mayor no tapa el CI real en failure', () => {
  const r = waitCi({ resp: body(run(10, 'completed', 'failure'), run(90, 'completed', 'success', { head_sha: 'e'.repeat(40) })) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /conclusion 'failure'/);
});

test('sec wait-ci: un success de pull_request con id mayor no tapa el push en failure', () => {
  const r = waitCi({ resp: body(run(10, 'completed', 'failure'), run(90, 'completed', 'success', { event: 'pull_request' })) });
  assert.equal(r.code, 1, r.out);
});

test('sec wait-ci: head_sha del run en mayúsculas o con espacios no coincide', () => {
  for (const h of [SHA.toUpperCase(), ` ${SHA}`, `${SHA}\n`]) {
    const r = waitCi({ resp: body(run(9, 'completed', 'success', { head_sha: h })) });
    assert.equal(r.code, 1, `${JSON.stringify(h)}: ${r.out}`);
  }
});

// ------------------------------------------- 5 · concurrencia de ci.yml (V-05c)

const CIYML = strip(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));

test('sec ci.yml: grupo por SHA solo en main y sin cancelar en main; en el resto, por ref y cancelando', () => {
  const conc = CIYML.split(/^concurrency:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
  assert.match(conc, /^\s+group: ci-\$\{\{ github\.ref == 'refs\/heads\/main' && github\.sha \|\| github\.ref \}\}\s*$/m);
  assert.match(conc, /^\s+cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}\s*$/m);
  // El grupo de main (40 hex) nunca coincide con el de otra rama (siempre "refs/..."):
  // un push a item/** o un PR no puede cancelar el CI de un commit de main.
  assert.doesNotMatch(conc, /head_ref|github\.event\.|inputs\./, 'el grupo no debe depender de datos que controla quien abre el PR');
});

test('sec ci.yml: sigue sin pull_request_target ni permisos de escritura', () => {
  assert.doesNotMatch(CIYML, /pull_request_target|workflow_run/);
  assert.doesNotMatch(CIYML, /:\s*write\b|write-all/);
  assert.match(CIYML, /^permissions:\s*\n\s+contents: read\s*$/m);
});

// ----------------------------- 5 · umbral deploy-main 90 min (H-ARQ-V05b-09)

const NOW = new Date('2027-03-10T15:00:00Z');
const minAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const hrun = (id, { min, status = 'completed', conclusion = 'success' }) => ({
  id, status, conclusion: status === 'completed' ? conclusion : null, event: 'push',
  created_at: minAgo(min), run_started_at: minAgo(min), html_url: `https://github.com/o/r/actions/runs/${id}`,
});
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs, now: NOW });

test('sec health: maxPendingMin cubre la suma de timeouts de deploy.yml y no pasa de 120 min', () => {
  const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  const sum = [...deploy.matchAll(/^\s+timeout-minutes:\s*(\d+)/gm)].reduce((a, m) => a + Number(m[1]), 0);
  assert.ok(sum > 0);
  assert.ok(DEPLOY_RULE.maxPendingMin >= sum, `umbral ${DEPLOY_RULE.maxPendingMin} < suma de timeouts ${sum}: falsas alarmas`);
  assert.ok(DEPLOY_RULE.maxPendingMin <= 120, 'un despliegue atascado debe detectarse en menos de 2 h');
});

test('sec health: un despliegue atascado 91 min falla aunque el último terminado esté en verde', () => {
  const r = assess([hrun(3, { min: 91, status: 'in_progress' }), hrun(2, { min: 200 })]);
  assert.equal(r.status, 'fail', r.detail);
});

test('sec health: un despliegue atascado 91 min falla aunque haya un cancelado más reciente', () => {
  const r = assess([hrun(4, { min: 91, status: 'queued' }), hrun(3, { min: 50, conclusion: 'cancelled' }), hrun(1, { min: 300 })]);
  assert.equal(r.status, 'fail', r.detail);
});

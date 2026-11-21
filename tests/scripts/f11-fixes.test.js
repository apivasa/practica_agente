// F-11 — pruebas del desarrollador:
// - H-V05c-01: scripts/ci/check-main-tip.sh (paso «Commit vigente en main» de deploy.yml).
// - H-V05c-03a: clean_error de wait-ci.sh quita \r.
// - Mensajes de wait-ci.sh que recomiendan relanzar advierten de no relanzar un commit viejo.
// - H-C06-01: runEmailStep falla cerrado (código 2) si la BD no implementa los métodos de C-06.
// - P3 (H-ARQ): la suma de timeout-minutes de deploy.yml ≤ DEPLOY_RULE.maxPendingMin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runEmailStep, missingEmailDbMethods, REQUIRED_C06_DB_METHODS } from '../../scripts/lib/email.js';
import { createDb } from '../../scripts/lib/db.js';
import { DEPLOY_RULE, assessDeploy } from '../../scripts/health/lib.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const WAIT = join(ROOT, 'scripts', 'ci', 'wait-ci.sh');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const CODE = WF.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const TOKEN = 'ghs_FAKEtokenF11zz9';
const BASE = { GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'owner/repo', HEAD_SHA: SHA, GH_TOKEN: TOKEN, TIP_RETRY_INTERVAL_SECONDS: '0', CI_WAIT_TIMEOUT_SECONDS: '0', CI_WAIT_INTERVAL_SECONDS: '0' };

/**
 * Ejecuta un script con un gh falso que responde según la ruta pedida:
 * `routes` = [[regex, cuerpo | null(falla) | { err: 'stderr' }], ...]. Sin coincidencia: falla.
 */
function runWithGh(script, routes, env = {}, argv = []) {
  const dir = mkdtempSync(join(tmpdir(), 'f11-gh-'));
  try {
    // $GITHUB_OUTPUT en un archivo del directorio temporal, salvo que la prueba lo fije.
    const outFile = join(dir, 'github_output');
    writeFileSync(outFile, '');
    const cases = routes.map(([re, resp], i) => {
      if (resp === null || typeof resp === 'object') {
        writeFileSync(join(dir, `e${i}`), resp?.err ?? 'HTTP 502: Bad Gateway');
        return `if printf '%s' "$2" | grep -Eq '${re}'; then cat "${dir}/e${i}" >&2; exit 1; fi`;
      }
      writeFileSync(join(dir, `r${i}`), resp);
      return `if printf '%s' "$2" | grep -Eq '${re}'; then cat "${dir}/r${i}"; exit 0; fi`;
    }).join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/args"\n${cases}\necho "ruta no simulada: $2" >&2; exit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [script, ...argv], { env: { PATH: `${dir}:${process.env.PATH}`, ...BASE, GITHUB_OUTPUT: outFile, ...env }, encoding: 'utf8' });
    let args = '';
    try { args = readFileSync(join(dir, 'args'), 'utf8'); } catch { /* gh no se llamó */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, args, output: readFileSync(outFile, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tipBody = (sha) => JSON.stringify({ sha, commit: { message: 'x' } });
const cmpBody = (status, files) => JSON.stringify({ status, total_commits: 1, files: files.map((filename) => ({ filename })) });
const COMMITS = '^repos/owner/repo/commits/main$';
const COMPARE = `^repos/owner/repo/compare/${SHA}\\.\\.\\.${NEWER}$`;

// ------------------------------------------------------------ H-V05c-01

test('check-main-tip: el commit es la punta de main → 0 y consulta commits/main', () => {
  const r = runWithGh(TIP, [[COMMITS, tipBody(SHA)]]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.args, /^api repos\/owner\/repo\/commits\/main$/m);
  assert.match(r.out, /es la punta de main/);
});

test('check-main-tip: hay un commit más nuevo con código → falla con mensaje claro y sin recomendar relanzar', () => {
  const r = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['src/main.js', 'docs/estado.md'])]]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::Hay un commit más nuevo en main \(b{40}\).*su despliegue lo cubre/);
  assert.match(r.out, /no relances despliegues de commits viejos/);
});

test('check-main-tip: los commits posteriores solo tocan docs/** o *.md (no redespliegan) → 0', () => {
  const r = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['docs/estado.md', 'README.md', 'engine/README.md'])]]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /solo con cambios de documentación/);
});

for (const [name, body] of [
  ['main reescrita (behind)', cmpBody('behind', ['docs/estado.md'])],
  ['historia divergente', cmpBody('diverged', ['docs/estado.md'])],
  ['300 archivos (lista truncada)', cmpBody('ahead', Array.from({ length: 300 }, (_, i) => `docs/f${i}.md`))],
  ['archivo .md.js no es documentación', cmpBody('ahead', ['docs.md.js'])],
  ['ruta que solo contiene docs/', cmpBody('ahead', ['src/docs/x.js'])],
]) {
  test(`check-main-tip: ${name} → falla cerrado`, () => {
    const r = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, body]]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /::error::(Hay un commit más nuevo|main avanzó a b{40} y no se pudo saber qué cambió)/);
    // En el primer intento: código detrás = carrera prevista (deploy=false, 0); behind,
    // diverged y lista truncada siguen fallando cerrado.
    const first = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, body]], { GITHUB_RUN_ATTEMPT: '1' });
    const race = /^(archivo|ruta)/.test(name);
    assert.equal(first.code, race ? 0 : 1, first.out);
    assert.equal(first.output, race ? 'deploy=false\n' : '');
  });
}

test('check-main-tip: API caída o respuesta inesperada → reintenta y falla cerrado sin imprimir el token', () => {
  const down = runWithGh(TIP, [[COMMITS, { err: `HTTP 502 token ${TOKEN}\r::error::PWN` }]], { TIP_RETRIES: '3' });
  assert.equal(down.code, 1, down.out);
  assert.equal(down.args.split('\n').filter(Boolean).length, 3);
  assert.match(down.out, /::error::No se pudo comprobar la punta de main/);
  assert.doesNotMatch(down.out, new RegExp(TOKEN));
  assert.doesNotMatch(down.out, /\r/);
  for (const l of down.out.split(/\r\n|\r|\n/)) assert.doesNotMatch(l.trimStart(), /^::error::PWN/);
  for (const bad of ['no json', JSON.stringify({ sha: 'zz' }), JSON.stringify({})]) {
    const r = runWithGh(TIP, [[COMMITS, bad]], { TIP_RETRIES: '1' });
    assert.equal(r.code, 1, bad);
    assert.match(r.out, /respuesta no JSON o inesperada/);
  }
  const cmpDown = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, null]], { TIP_RETRIES: '1' });
  assert.equal(cmpDown.code, 1);
});

// F-12 (H-F11-02): workflow_dispatch ya no se exime; sigue la misma regla que push.
test('check-main-tip: workflow_dispatch sigue la regla de push (consulta commits/main); otros eventos fallan', () => {
  const d = runWithGh(TIP, [[COMMITS, tipBody(SHA)]], { GITHUB_EVENT_NAME: 'workflow_dispatch' });
  assert.equal(d.code, 0, d.out);
  assert.match(d.args, /^api repos\/owner\/repo\/commits\/main$/m);
  const old = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['src/main.js'])]], { GITHUB_EVENT_NAME: 'workflow_dispatch' });
  assert.equal(old.code, 1, old.out);
  assert.match(old.out, /::error::Hay un commit más nuevo en main/);
  for (const ev of ['schedule', 'pull_request', '']) {
    const r = runWithGh(TIP, [[COMMITS, tipBody(SHA)]], { GITHUB_EVENT_NAME: ev });
    assert.equal(r.code, 1, ev);
    assert.equal(r.args, '');
  }
});

test('check-main-tip: entrada inválida → falla antes de llamar a gh', () => {
  for (const env of [{ HEAD_SHA: 'abc' }, { HEAD_SHA: `${SHA}\n` }, { GITHUB_REPOSITORY: 'o/r/../x' }, { GH_TOKEN: '' }, { TIP_RETRIES: '0' }, { TIP_RETRY_INTERVAL_SECONDS: 'x' }]) {
    const r = runWithGh(TIP, [[COMMITS, tipBody(SHA)]], env);
    assert.equal(r.code, 1, JSON.stringify(env));
    assert.equal(r.args, '');
  }
});

test('check-main-tip: sin xtrace, eval ni GITHUB_ENV/PATH; a GITHUB_OUTPUT solo escribe deploy=; no imprime el token', () => {
  const src = readFileSync(TIP, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(src, /set\s+-[a-z]*x|xtrace|\beval\b|GITHUB_ENV|GITHUB_PATH/);
  assert.doesNotMatch(src, /echo[^\n]*\$\{?GH_TOKEN/);
  const writes = src.split('\n').filter((l) => />>\s*"?\$\{?GITHUB_OUTPUT/.test(l));
  assert.deepEqual(writes.map((l) => l.trim()), [`printf 'deploy=%s\\n' "$1" >>"$GITHUB_OUTPUT"`]);
});

// ------------------------------------------------ F-11 intento 2 (QA y arquitectura)

const cmpFiles = (status, files) => JSON.stringify({ status, total_commits: 1, files });

test('QA-F11-01 / H-ARQ-F11-03: renombrado de código a docs/ o a .md → no es solo documentación', () => {
  for (const f of [
    { filename: 'docs/x.js', previous_filename: 'src/x.js', status: 'renamed' },
    { filename: 'docs/x.md', previous_filename: 'engine/color.js', status: 'renamed' },
    { filename: 'notas.md', previous_filename: 'supabase/migrations/1_x.sql', status: 'renamed' },
  ]) {
    const r = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpFiles('ahead', [f])]], { GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(r.code, 1, JSON.stringify(f));
    assert.match(r.out, /::error::Hay un commit más nuevo/);
  }
  const ok = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpFiles('ahead', [{ filename: 'docs/b.md', previous_filename: 'docs/a.md', status: 'renamed' }])]]);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.output, 'deploy=true\n');
});

test('QA-F11-02 / H-F11-04: compare ahead sin files o con files que no es arreglo → falla cerrado', () => {
  for (const body of [
    JSON.stringify({ status: 'ahead', total_commits: 1 }),
    JSON.stringify({ status: 'ahead', files: null }),
    JSON.stringify({ status: 'ahead', files: {} }),
    JSON.stringify({ status: 'ahead', files: 'docs/x.md' }),
    JSON.stringify({ status: 'ahead', files: [{ filename: 7 }] }),
  ]) {
    const r = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, body]], { GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 1, body);
    assert.equal(r.output, '', body);
  }
});

const CODE_AHEAD = [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['src/main.js'])]];

test('H-ARQ-F11-01: superado por un merge con código en el primer intento → ::warning::, deploy=false y 0', () => {
  const r = runWithGh(TIP, CODE_AHEAD, { GITHUB_RUN_ATTEMPT: '1' });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.output, 'deploy=false\n');
  assert.match(r.out, /::warning::Hay un commit más nuevo en main \(b{40}\).*su despliegue lo cubre/);
  assert.doesNotMatch(r.out, /::error::/);
});

test('H-ARQ-F11-01: en un relanzamiento (intento > 1) o con intento desconocido → ::error:: y 1, sin deploy=', () => {
  for (const attempt of ['2', '3', '', 'x', '01']) {
    const r = runWithGh(TIP, CODE_AHEAD, { GITHUB_RUN_ATTEMPT: attempt });
    assert.equal(r.code, 1, attempt);
    assert.match(r.out, /::error::Hay un commit más nuevo.*no relances despliegues de commits viejos/);
    assert.equal(r.output, '', attempt);
  }
});

test('H-ARQ-F11-01: sin GITHUB_OUTPUT no se puede saltar la cadena → falla cerrado', () => {
  const r = runWithGh(TIP, CODE_AHEAD, { GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::Falta GITHUB_OUTPUT/);
});

test('H-ARQ-F11-01: behind o diverged en el primer intento siguen fallando cerrado', () => {
  for (const st of ['behind', 'diverged', 'identical']) {
    const r = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody(st, ['src/x.js'])]], { GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(r.code, 1, st);
    assert.equal(r.output, '', st);
  }
});

test('check-main-tip: escribe deploy=true en la punta, con solo docs detrás y con workflow_dispatch', () => {
  assert.equal(runWithGh(TIP, [[COMMITS, tipBody(SHA)]], { GITHUB_RUN_ATTEMPT: '1' }).output, 'deploy=true\n');
  assert.equal(runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['docs/estado.md'])]]).output, 'deploy=true\n');
  // F-12 (H-F11-02): con disparo manual también se consulta la punta.
  assert.equal(runWithGh(TIP, [[COMMITS, tipBody(SHA)]], { GITHUB_EVENT_NAME: 'workflow_dispatch' }).output, 'deploy=true\n');
});

test('H-ARQ-F11-02: --strict falla siempre si está superado (también en el primer intento) y nunca escribe en GITHUB_OUTPUT', () => {
  for (const attempt of ['1', '2']) {
    const r = runWithGh(TIP, CODE_AHEAD, { GITHUB_RUN_ATTEMPT: attempt }, ['--strict']);
    assert.equal(r.code, 1, attempt);
    assert.match(r.out, /::error::Hay un commit más nuevo/);
    assert.equal(r.output, '');
  }
  const tip = runWithGh(TIP, [[COMMITS, tipBody(SHA)]], {}, ['--strict']);
  assert.equal(tip.code, 0);
  assert.equal(tip.output, '');
  const docs = runWithGh(TIP, [[COMMITS, tipBody(NEWER)], [COMPARE, cmpBody('ahead', ['README.md'])]], {}, ['--strict']);
  assert.equal(docs.code, 0);
  for (const argv of [['--otro'], ['--strict', 'x']]) {
    const r = runWithGh(TIP, [[COMMITS, tipBody(SHA)]], {}, argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(r.args, '');
  }
});

/** Bloque de un job de deploy.yml (sin comentarios). */
const jobBlock = (id) => {
  const m = CODE.match(new RegExp(`^ {2}${id}:\\s*$([\\s\\S]*?)(?=^ {2}[A-Za-z0-9_-]+:\\s*$|(?![\\s\\S]))`, 'm'));
  assert.ok(m, `falta el job ${id}`);
  return m[1];
};
const stepsOf = (block) => block.split(/^ {6}- /m).slice(1);

test('H-ARQ-F11-01: verify expone deploy del paso tip y solo build-pages lleva el if; el resto se salta en cadena', () => {
  const verify = jobBlock('verify');
  assert.match(verify, /^ {4}outputs:\s*\n {6}deploy: \$\{\{ steps\.tip\.outputs\.deploy \}\}\s*$/m);
  const tipStep = stepsOf(verify).find((s) => /Commit vigente en main/.test(s));
  assert.match(tipStep, /^ {8}id: tip$/m);
  assert.match(tipStep, /run: bash scripts\/ci\/check-main-tip\.sh\s*$/);
  assert.match(jobBlock('build-pages'), /^ {4}needs: verify\n(?: {4}#.*\n)* {4}if: needs\.verify\.outputs\.deploy == 'true'\s*$/m);
  const ifs = [...CODE.matchAll(/^ {4}if:.*$/gm)].map((m) => m[0].trim());
  assert.deepEqual(ifs, ["if: needs.verify.outputs.deploy == 'true'"]);
  assert.match(jobBlock('migrate-plan'), /^ {4}needs: build-pages$/m);
  assert.match(jobBlock('migrate'), /^ {4}needs: migrate-plan$/m);
  assert.match(jobBlock('deploy-pages'), /^ {4}needs: \[build-pages, migrate\]$/m);
  assert.match(jobBlock('smoke'), /^ {4}needs: deploy-pages$/m);
});

test('H-ARQ-F11-02: migrate y deploy-pages comprueban la punta con --strict antes de cualquier efecto', () => {
  for (const id of ['migrate', 'deploy-pages']) {
    const steps = stepsOf(jobBlock(id));
    assert.match(steps[0], /^uses: actions\/checkout@[0-9a-f]{40}/, `${id}: el primer paso es el checkout`);
    assert.match(steps[0], /persist-credentials: false/);
    assert.match(steps[1], /^name: Commit vigente en main/, `${id}: el segundo paso es la comprobación`);
    assert.match(steps[1], /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(steps[1], /HEAD_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(steps[1], /run: bash scripts\/ci\/check-main-tip\.sh --strict\s*$/);
    assert.doesNotMatch(steps[1], /^\s*if:/m);
    assert.doesNotMatch(steps[1], /continue-on-error|TIP_RETR/);
    assert.match(jobBlock(id), /^ {6}contents: read$/m, `${id}: contents: read`);
  }
});

test('H-ARQ-F11-04: DOC_PATHS_IGNORE del script = paths-ignore de deploy.yml = predicados del filtro', () => {
  const ignore = WF.match(/^ {4}paths-ignore:\s*\n((?: {6}- .*\n)+)/m);
  assert.ok(ignore, 'deploy.yml tiene on.push.paths-ignore');
  const yml = ignore[1].trim().split('\n').map((l) => l.replace(/^\s*-\s*/, '').replace(/^'(.*)'$/, '$1'));
  assert.deepEqual(yml, ['docs/**', '**/*.md']);
  const src = readFileSync(TIP, 'utf8');
  const decl = src.match(/^DOC_PATHS_IGNORE=\((.*)\)$/m);
  assert.ok(decl, 'el script declara DOC_PATHS_IGNORE');
  assert.deepEqual([...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), yml);
  const pred = { 'docs/**': 'startswith("docs/")', '**/*.md': 'endswith(".md")' };
  const def = src.match(/def doc: (.*);/);
  assert.ok(def, 'el filtro define doc');
  for (const p of yml) assert.ok(def[1].includes(pred[p]), `falta el predicado de ${p}`);
  assert.equal([...def[1].matchAll(/startswith|endswith/g)].length, yml.length, 'el filtro tiene predicados que no están en paths-ignore');
});

test('H-ARQ-F11-01: salud (deploy-main) da ok a un run success aunque sus jobs se hayan saltado', () => {
  const now = new Date('2027-03-10T15:00:00Z');
  const r = assessDeploy(DEPLOY_RULE, {
    workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' },
    // El run superado termina success (jobs saltados); la API no expone el detalle de jobs aquí.
    runs: [{ id: 2, status: 'completed', conclusion: 'success', event: 'push', created_at: '2027-03-10T14:50:00Z', run_started_at: '2027-03-10T14:50:00Z' }],
    now,
  });
  assert.equal(r.status, 'ok', r.detail);
});

test('deploy.yml: verify ejecuta «Commit vigente en main» después de la espera al CI, sin if ni continue-on-error', () => {
  const verify = CODE.split(/^ {2}build-pages:/m)[0];
  const iCi = verify.indexOf('run: bash scripts/ci/wait-ci.sh');
  const iTip = verify.indexOf('run: bash scripts/ci/check-main-tip.sh');
  assert.ok(iCi > 0 && iTip > iCi, 'el paso de la punta va después de wait-ci.sh dentro de verify');
  const step = verify.slice(verify.indexOf('- name: Commit vigente en main'));
  assert.match(step, /HEAD_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(step, /^\s*if:/m);
  assert.doesNotMatch(step, /continue-on-error|TIP_RETR/);
});

// ------------------------------------------------------------ wait-ci.sh

const run = (id, status, conclusion) => ({ id, status, conclusion, path: '.github/workflows/ci.yml', head_sha: SHA, event: 'push' });
const runs = (...r) => JSON.stringify({ total_count: r.length, workflow_runs: r });
const RUNS = '^repos/owner/repo/actions/runs';

test('H-V05c-03a: clean_error de wait-ci.sh quita \\r del error de gh', () => {
  const r = runWithGh(WAIT, [[RUNS, { err: 'HTTP 502\r::error::PWN\rfin' }]]);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.out, /\r/);
  assert.match(r.out, /HTTP 502: :error: :PWNfin/);
});

test('wait-ci.sh: los mensajes que recomiendan relanzar advierten de no relanzar un commit viejo', () => {
  for (const resp of [runs(run(5, 'completed', 'failure')), runs(run(5, 'in_progress', null)), runs(), null]) {
    const r = runWithGh(WAIT, [[RUNS, resp]]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Relanza solo si este commit sigue siendo la punta de main.*no relances este.*su despliegue lo cubre/, r.out);
  }
});

test('H-QA-V05c-03: el filtro jq de wait-ci.sh exige head_sha y event exactos (sin valores por defecto)', () => {
  const src = readFileSync(WAIT, 'utf8');
  assert.match(src, /select\(\.head_sha == \$sha and \.event == "push"\)/);
  assert.doesNotMatch(src, /\/\/ \$sha|\/\/ "push"/);
  // Un run sin head_sha o sin event no cuenta como el CI del commit.
  for (const extra of [{ head_sha: undefined }, { event: undefined }, { head_sha: NEWER }, { event: 'pull_request' }]) {
    const r = runWithGh(WAIT, [[RUNS, runs({ ...run(9, 'completed', 'success'), ...extra })]]);
    assert.equal(r.code, 1, JSON.stringify(extra));
    assert.match(r.out, /No apareció ningún run de CI/);
  }
});

// ------------------------------------------------------------ H-C06-01

// Clave ficticia armada en ejecución (un literal con forma de clave dispara gitleaks).
const FAKE_RESEND_KEY = ['re', 'TESTKEY', 'f11', 'ficticia'].join('_');
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x', RESEND_API_KEY: FAKE_RESEND_KEY };
const readSupabaseConfig = (e) => ({ url: e.SUPABASE_URL, secretKey: e.SUPABASE_SECRET_KEY });
const alert = { id: 'a1', unit_id: 'u1', recipient_user_id: '22222222-0000-4000-8000-000000000001', kind: 'color_change', payload: {}, sent_at: '2027-02-01T11:00:00Z', emailed_at: null, email_attempts: 0 };

function c05OnlyDb() {
  const touched = [];
  const t = (name, value) => async () => { touched.push(name); return value; };
  return {
    touched,
    pendingEmailAlerts: t('pendingEmailAlerts', [alert]),
    userEmail: t('userEmail', 'lider@example.test'),
    markAlertEmailed: t('markAlertEmailed', true),
    recordAlertEmailFailure: t('recordAlertEmailFailure', undefined),
    insertAudit: t('insertAudit', undefined),
    recipientAccess: async () => ({ email: 'lider@example.test', bannedUntil: null, deletedAt: null, roles: [{ role: 'unit_leader', unit_id: 'u1' }] }),
    expiredEmailAlerts: async () => [],
    markAlertsEmailSkipped: async () => [],
  };
}

for (const m of REQUIRED_C06_DB_METHODS) {
  test(`H-C06-01: BD sin ${m} → código 2, ::error:: y ningún envío ni lectura`, async () => {
    const db = c05OnlyDb();
    delete db[m];
    const lines = [];
    const r = await runEmailStep({
      env, makeDb: async () => db, readSupabaseConfig, log: (l) => lines.push(l),
      fetchImpl: async () => assert.fail('no debe llamar a Resend'),
    });
    assert.equal(r.code, 2);
    assert.equal(r.summary, null);
    assert.deepEqual(db.touched, []);
    assert.ok(lines.some((l) => l.startsWith('::error::') && l.includes(m)), lines.join('\n'));
    assert.doesNotMatch(lines.join('\n'), /re_TESTKEY/);
  });
}

test('H-C06-01: un método que no es función cuenta como ausente; BD nula también', () => {
  assert.deepEqual(missingEmailDbMethods({ recipientAccess: 'x', expiredEmailAlerts: async () => [], markAlertsEmailSkipped: null }), ['recipientAccess', 'markAlertsEmailSkipped']);
  assert.deepEqual(missingEmailDbMethods(null), [...REQUIRED_C06_DB_METHODS]);
});

test('H-C06-01: con los tres métodos, runEmailStep envía (0) y la capa real los implementa', async () => {
  const db = c05OnlyDb();
  let sent = 0;
  const r = await runEmailStep({
    env, makeDb: async () => db, readSupabaseConfig, log: () => {}, sleep: async () => {}, now: () => new Date('2027-02-01T12:00:00Z'),
    fetchImpl: async () => { sent += 1; return new Response(JSON.stringify({ id: 'x' }), { status: 200 }); },
  });
  assert.equal(r.code, 0);
  assert.equal(sent, 1);
  assert.deepEqual(missingEmailDbMethods(createDb({ from() {}, auth: { admin: {} } })), []);
});

// ------------------------------------------------------------ P3 (H-ARQ)

test('P3: la suma de timeout-minutes de los jobs de deploy.yml es ≤ DEPLOY_RULE.maxPendingMin', () => {
  const jobs = CODE.split(/^jobs:\s*$/m)[1];
  assert.ok(jobs, 'deploy.yml tiene jobs:');
  const blocks = jobs.split(/^ {2}(?=[A-Za-z0-9_-]+:\s*$)/m).filter((b) => /^[A-Za-z0-9_-]+:/.test(b));
  assert.ok(blocks.length >= 6, `jobs encontrados: ${blocks.length}`);
  let sum = 0;
  for (const b of blocks) {
    const m = b.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m);
    assert.ok(m, `el job ${b.split(':')[0]} no fija timeout-minutes`);
    sum += Number(m[1]);
  }
  assert.ok(sum <= DEPLOY_RULE.maxPendingMin, `suma de timeouts ${sum} > maxPendingMin ${DEPLOY_RULE.maxPendingMin}`);
});

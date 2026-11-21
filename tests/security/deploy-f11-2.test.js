// F-11 (intento 2) — Seguridad de la salida deploy=true|false de verify y del
// modo --strict de scripts/ci/check-main-tip.sh en migrate y deploy-pages.
// Categoría 5 (Actions). Pregunta: ¿puede alguien forzar deploy=true, saltarse
// migraciones dejando el front desfasado del esquema o relanzar un run viejo
// para republicar un commit anterior? Pruebas activas con un `gh` falso en
// PATH y un GITHUB_OUTPUT temporal. Sin red; nunca toca producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIP = join(ROOT, 'scripts', 'ci', 'check-main-tip.sh');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const WAIT = readFileSync(join(ROOT, 'scripts', 'ci', 'wait-ci.sh'), 'utf8');

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const TOKEN = ['ghs', 'SECf11dos', 'ficticio'].join('_');
const BASE = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'owner/repo',
  HEAD_SHA: SHA,
  GH_TOKEN: TOKEN,
  TIP_RETRIES: '1',
  TIP_RETRY_INTERVAL_SECONDS: '0',
};
const COMMITS = 'repos/owner/repo/commits/main';
const COMPARE = `repos/owner/repo/compare/${SHA}...${NEWER}`;

/**
 * Ejecuta check-main-tip.sh con argumentos `args`, un gh falso enrutado por
 * ruta exacta y, salvo `noOutput`, un GITHUB_OUTPUT temporal.
 * Devuelve { code, out, output (contenido de GITHUB_OUTPUT o null), calls }.
 */
function run(routes, { env = {}, args = [], noOutput = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sec-f11b-'));
  try {
    const cases = Object.entries(routes).map(([path, body], i) => {
      writeFileSync(join(dir, `p${i}`), path);
      writeFileSync(join(dir, `r${i}`), body);
      return `if [ "$2" = "$(cat "${dir}/p${i}")" ]; then cat "${dir}/r${i}"; exit 0; fi`;
    }).join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/calls"\n${cases}\necho "ruta no simulada" >&2\nexit 1\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const outFile = join(dir, 'github_output');
    const e = { PATH: `${dir}:${process.env.PATH}`, ...BASE, ...env };
    if (!noOutput) e.GITHUB_OUTPUT = outFile;
    const r = spawnSync('bash', [TIP, ...args], { env: e, encoding: 'utf8', timeout: 20000 });
    const output = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;
    const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '';
    return { code: r.status, out: `${r.stdout}${r.stderr}`, output, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tipIs = (sha) => JSON.stringify({ sha });
const cmp = (status, files) => JSON.stringify({ status, files: files.map((f) => (typeof f === 'string' ? { filename: f, status: 'modified' } : f)) });
const superseded = (body = cmp('ahead', ['src/app.js'])) => ({ [COMMITS]: tipIs(NEWER), [COMPARE]: body });

/** Bloque de un job de deploy.yml (desde `  <id>:` hasta el siguiente job). */
function job(id) {
  const parts = WF.split(new RegExp(`^ {2}${id}:\\s*$`, 'm'));
  assert.equal(parts.length, 2, `job ${id} no encontrado (o duplicado)`);
  return parts[1].split(/^ {2}[\w-]+:\s*$/m)[0];
}

// ------------------------------------------- 5 · salida deploy (modo verify)

test('sec F-11b: punta = commit → deploy=true exactamente una vez', () => {
  const r = run({ [COMMITS]: tipIs(SHA) }, { env: { GITHUB_RUN_ATTEMPT: '1' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.output, 'deploy=true\n');
});

test('sec F-11b: superado por código en el intento 1 → deploy=false (nunca true) y 0', () => {
  const r = run(superseded(), { env: { GITHUB_RUN_ATTEMPT: '1' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.output, 'deploy=false\n');
  assert.doesNotMatch(r.output, /deploy=true/);
});

for (const attempt of ['2', '3', '', '01', ' 1', '1 ', '1\n', '1\ndeploy=true', '-1', '0', 'uno']) {
  test(`sec F-11b: superado con GITHUB_RUN_ATTEMPT=${JSON.stringify(attempt)} → 1 y sin escribir deploy`, () => {
    const r = run(superseded(), { env: { GITHUB_RUN_ATTEMPT: attempt } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.output === null || r.output === '', `GITHUB_OUTPUT: ${JSON.stringify(r.output)}`);
  });
}

test('sec F-11b: superado sin GITHUB_RUN_ATTEMPT → 1 (intento desconocido falla cerrado)', () => {
  const r = run(superseded());
  assert.equal(r.code, 1, r.out);
  assert.ok(r.output === null || r.output === '');
});

for (const status of ['behind', 'diverged', 'identical', '', 'AHEAD']) {
  test(`sec F-11b: compare status ${JSON.stringify(status)} en el intento 1 → 1, no deploy=false silencioso`, () => {
    const r = run(superseded(cmp(status, ['src/app.js'])), { env: { GITHUB_RUN_ATTEMPT: '1' } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.output === null || r.output === '');
  });
}

for (const [label, body] of [
  ['sin files', JSON.stringify({ status: 'ahead' })],
  ['files null', JSON.stringify({ status: 'ahead', files: null })],
  ['files objeto', JSON.stringify({ status: 'ahead', files: { filename: 'docs/a.md' } })],
  ['files string', JSON.stringify({ status: 'ahead', files: 'docs/a.md' })],
  ['300 archivos de docs', cmp('ahead', Array.from({ length: 300 }, (_, i) => `docs/n${i}.md`))],
  ['archivo sin nombre', JSON.stringify({ status: 'ahead', files: [{ status: 'added' }] })],
]) {
  test(`sec F-11b: compare ${label} en el intento 1 → 1 (unknown: ni deploy=true ni deploy=false)`, () => {
    const r = run(superseded(body), { env: { GITHUB_RUN_ATTEMPT: '1' } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.output === null || r.output === '');
  });
}

test('sec F-11b: superado en el intento 1 sin GITHUB_OUTPUT → 1 (no puede marcar deploy=false)', () => {
  const r = run(superseded(), { env: { GITHUB_RUN_ATTEMPT: '1' }, noOutput: true });
  assert.equal(r.code, 1, r.out);
});

test('sec F-11b: el valor de deploy es un literal del script (ningún dato de la API llega a GITHUB_OUTPUT)', () => {
  const src = readFileSync(TIP, 'utf8');
  const writes = [...src.matchAll(/>>\s*"\$GITHUB_OUTPUT"/g)];
  assert.equal(writes.length, 1, 'una sola escritura en GITHUB_OUTPUT (set_deploy)');
  const calls = [...src.matchAll(/set_deploy\s+(\S+)/g)].map((m) => m[1]).filter((v) => v !== '()');
  assert.ok(calls.length >= 3);
  for (const v of calls) assert.match(v, /^(true|false)$/, `set_deploy ${v}`);
});

// ------------------------------------------------ 5 · renombres (H-F11-03)

for (const [from, to] of [
  ['src/app.js', 'docs/app.js'],
  ['supabase/migrations/20270101000000_x.sql', 'docs/x.md'],
  ['index.html', 'README.md'],
  ['package.json', 'docs/package.json'],
]) {
  test(`sec F-11b: renombre ${from} → ${to} no cuenta como solo docs`, () => {
    const r = run(superseded(cmp('ahead', [{ filename: to, previous_filename: from, status: 'renamed' }])), { env: { GITHUB_RUN_ATTEMPT: '2' } });
    assert.equal(r.code, 1, r.out);
  });
}

for (const prev of [5, true, ['docs/a.md'], { f: 'docs/a.md' }]) {
  test(`sec F-11b: previous_filename no string (${JSON.stringify(prev)}) → no es solo docs`, () => {
    const r = run(superseded(cmp('ahead', [{ filename: 'docs/a.md', previous_filename: prev, status: 'renamed' }])), { env: { GITHUB_RUN_ATTEMPT: '2' } });
    assert.equal(r.code, 1, r.out);
  });
}

test('sec F-11b: renombre docs → docs sigue siendo solo docs (sin falso positivo)', () => {
  const r = run(superseded(cmp('ahead', [{ filename: 'docs/b.md', previous_filename: 'README.md', status: 'renamed' }])), { env: { GITHUB_RUN_ATTEMPT: '2' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.output, 'deploy=true\n');
});

// ------------------------------------------------------ 5 · modo --strict

test('sec F-11b --strict: punta = commit → 0 sin tocar GITHUB_OUTPUT', () => {
  const r = run({ [COMMITS]: tipIs(SHA) }, { args: ['--strict'], env: { GITHUB_RUN_ATTEMPT: '1' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.output, null);
});

for (const attempt of ['1', '2', '']) {
  test(`sec F-11b --strict: superado por código (intento ${JSON.stringify(attempt)}) → 1 siempre, sin GITHUB_OUTPUT`, () => {
    const r = run(superseded(), { args: ['--strict'], env: { GITHUB_RUN_ATTEMPT: attempt } });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.output, null);
  });
}

test('sec F-11b --strict: solo docs detrás → 0 sin GITHUB_OUTPUT', () => {
  const r = run(superseded(cmp('ahead', ['docs/estado.md'])), { args: ['--strict'], env: { GITHUB_RUN_ATTEMPT: '2' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.output, null);
});

for (const args of [['--STRICT'], ['-s'], ['--strict=0'], ['--strict', 'x'], ['--strict', '--strict'], [''], ['--no-strict'], ['strict']]) {
  test(`sec F-11b: argumentos ${JSON.stringify(args)} → 1 sin consultar la API`, () => {
    const r = run({ [COMMITS]: tipIs(SHA) }, { args, env: { GITHUB_RUN_ATTEMPT: '1' } });
    if (args.length === 1 && args[0] === '') {
      // Un argumento vacío equivale a no pasar ninguno: modo verify normal.
      assert.equal(r.code, 0, r.out);
      return;
    }
    assert.equal(r.code, 1, r.out);
    assert.equal(r.calls, '');
    assert.ok(r.output === null || r.output === '');
  });
}

// ---------------------------------------------- 5 · estructura de deploy.yml

test('sec F-11b deploy.yml: verify.outputs.deploy sale solo del paso tip, que es el que ejecuta el script sin --strict', () => {
  const v = job('verify');
  assert.match(v, /^ {4}outputs:\n {6}deploy: \$\{\{ steps\.tip\.outputs\.deploy \}\}\n/m);
  const ids = [...v.matchAll(/^\s+id:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['tip'], 'un solo id en verify');
  const i = v.indexOf('id: tip');
  const step = v.slice(i, v.indexOf('\n      - ', i) === -1 ? undefined : v.indexOf('\n      - ', i));
  assert.match(step, /run: bash scripts\/ci\/check-main-tip\.sh\s*$/m);
  assert.doesNotMatch(step, /--strict|continue-on-error|GITHUB_OUTPUT|GITHUB_RUN_ATTEMPT/);
});

test('sec F-11b deploy.yml: build-pages solo corre con deploy == \'true\' (comparación exacta, sin always/!cancelled)', () => {
  const b = job('build-pages');
  const ifs = [...b.matchAll(/^\s+if:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(ifs, ["needs.verify.outputs.deploy == 'true'"]);
  assert.match(b, /^ {4}needs: verify\s*$/m);
});

test('sec F-11b deploy.yml: ningún job posterior lleva if: (always(), failure() o success() reabrirían la cadena saltada)', () => {
  for (const id of ['migrate-plan', 'migrate', 'deploy-pages', 'smoke']) {
    assert.doesNotMatch(job(id), /^\s+if:/m, `${id} tiene un if:`);
    assert.doesNotMatch(job(id), /continue-on-error/, `${id} tiene continue-on-error`);
  }
  assert.doesNotMatch(WF, /always\(\)|!cancelled\(\)|failure\(\)/);
});

test('sec F-11b deploy.yml: cadena de needs sin atajos (Pages exige migrate; migrate exige plan; plan exige build)', () => {
  assert.match(job('migrate-plan'), /^ {4}needs: build-pages\s*$/m);
  assert.match(job('migrate'), /^ {4}needs: migrate-plan\s*$/m);
  assert.match(job('deploy-pages'), /^ {4}needs: \[build-pages, migrate\]\s*$/m);
  assert.match(job('smoke'), /^ {4}needs: deploy-pages\s*$/m);
});

for (const [id, effect] of [['migrate', 'supabase db push'], ['deploy-pages', 'actions/deploy-pages@']]) {
  test(`sec F-11b deploy.yml: ${id} comprueba la punta con --strict antes de ${effect}`, () => {
    const j = job(id);
    const check = j.indexOf('run: bash scripts/ci/check-main-tip.sh --strict');
    assert.ok(check > 0, `${id} sin check-main-tip.sh --strict`);
    const eff = j.indexOf(effect);
    assert.ok(eff > check, `${effect} va antes que la comprobación`);
    const step = j.slice(j.lastIndexOf('- name:', check), check);
    assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(step, /HEAD_SHA: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(step, /^\s*if:|continue-on-error|TIP_RETR|GITHUB_EVENT_NAME|GITHUB_RUN_ATTEMPT|GITHUB_REPOSITORY/m);
    // El checkout que trae el script va antes y sin credenciales persistidas.
    const co = j.indexOf('actions/checkout@');
    assert.ok(co >= 0 && co < check);
    assert.match(j.slice(co, check), /persist-credentials: false/);
    assert.match(j.slice(co, co + 80), /actions\/checkout@[0-9a-f]{40} /);
  });
}

test('sec F-11b deploy.yml: deploy-pages tiene exactamente contents: read, pages: write e id-token: write', () => {
  const j = job('deploy-pages');
  const perms = j.split(/^ {4}permissions:\s*$/m)[1].split(/^ {4}\S/m)[0];
  const lines = perms.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('#')).sort();
  assert.deepEqual(lines, ['contents: read', 'id-token: write', 'pages: write']);
  assert.doesNotMatch(j, /secrets\./, 'deploy-pages no lee secretos');
});

test('sec F-11b deploy.yml: migrate y deploy-pages no amplían permisos (sin write salvo pages/id-token)', () => {
  const m = job('migrate').split(/^ {4}permissions:\s*$/m)[1].split(/^ {4}\S/m)[0];
  assert.deepEqual(m.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')), ['contents: read']);
});

// ---------------------------------------------- 5 · wait-ci.sh filtro estricto

test('sec F-11b wait-ci.sh: el filtro exige head_sha y event exactos (sin valores por defecto //)', () => {
  const f = WAIT.split("filter='")[1].split("'\n")[0];
  assert.match(f, /select\(\.head_sha == \$sha and \.event == "push"\)/);
  assert.doesNotMatch(f, /\.head_sha\s*\/\/|\.event\s*\/\/|\/\/ \$sha|\/\/ "push"/);
});

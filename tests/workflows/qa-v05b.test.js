// V-05b — QA del despliegue continuo (ADR 0015 punto 5), `db push --db-url`
// sin token de cuenta (H-V05-01) y política de contraseñas (H-S03-02).
// Criterio: un merge a main despliega sin input manual; el dispatch manual con
// confirm=desplegar sigue funcionando; pruebas de workflow actualizadas.
// Sin dependencias: análisis por indentación y ejecución con bash de los pasos
// de migrate-plan y migrate con la CLI de Supabase sustituida por un stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, matchesGlob } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEXT = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const LINES = TEXT.split('\n');
const isComment = (l) => /^\s*#/.test(l);
const indentOf = (l) => l.match(/^ */)[0].length;

/** Líneas hijas (sin comentarios) de la primera clave que cumple `re`. */
function childrenOf(re, from = 0, to = LINES.length) {
  const s = LINES.findIndex((l, i) => i >= from && i < to && re.test(l));
  if (s < 0) return null;
  const base = indentOf(LINES[s]);
  const out = [];
  for (let i = s + 1; i < to; i++) {
    const l = LINES[i];
    if (l.trim() !== '' && !isComment(l) && indentOf(l) <= base) break;
    if (!isComment(l) && l.trim() !== '') out.push(l);
  }
  return { start: s, lines: out };
}

/** Script `run: |` del paso con ese name dentro del job. */
function runScript(jobId, stepName) {
  const j = LINES.findIndex((l) => l === `  ${jobId}:`);
  assert.ok(j >= 0, `falta el job ${jobId}`);
  let end = LINES.findIndex((l, i) => i > j && /^ {2}[\w-]+:\s*$/.test(l));
  if (end < 0) end = LINES.length;
  const s = LINES.findIndex((l, i) => i > j && i < end && l.includes(`- name: ${stepName}`));
  assert.ok(s >= 0, `falta el paso "${stepName}" en ${jobId}`);
  const r = LINES.findIndex((l, i) => i > s && /^\s+run:\s*\|\s*$/.test(l));
  const base = indentOf(LINES[r]);
  const body = [];
  for (let i = r + 1; i < end; i++) {
    const l = LINES[i];
    if (l.trim() !== '' && indentOf(l) <= base) break;
    body.push(l.slice(base + 2));
  }
  return body.join('\n');
}

// ------------------------------------------------------------ paths-ignore

const onBlock = childrenOf(/^on:\s*$/);
const push = childrenOf(/^ {2}push:\s*$/, onBlock.start);
const pi = childrenOf(/^ {4}paths-ignore:\s*$/, push.start, push.start + 1 + push.lines.length + 20);
const IGNORE = (pi ? pi.lines : []).map((l) => l.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''));
// GitHub: un push dispara el workflow si al menos un archivo cambiado no
// coincide con ningún patrón de paths-ignore.
const ignored = (file) => IGNORE.some((p) => matchesGlob(file, p));

test('push: paths-ignore existe y no usa negaciones ni también paths:', () => {
  assert.ok(IGNORE.length > 0, 'falta paths-ignore');
  for (const p of IGNORE) assert.ok(!p.startsWith('!'), `negación en paths-ignore: ${p}`);
  assert.ok(!push.lines.some((l) => /^ {4}paths:/.test(l)), 'paths: y paths-ignore juntos no se admiten');
});

// "Un merge a main despliega": cualquier cambio de app, BD, build o workflow dispara.
for (const file of [
  'src/main.js',
  'src/security/csp.js',
  'engine/colors.js',
  'supabase/migrations/20261201000000_x.sql',
  'supabase/config.toml',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'scripts/ci/db-url.sh',
  '.github/workflows/deploy.yml',
  'public/favicon.svg',
  'tests/engine/colors.test.js',
]) {
  test(`push: un cambio en ${file} dispara el despliegue (no lo cubre paths-ignore)`, () => {
    assert.equal(ignored(file), false, `${file} quedaría sin desplegar`);
  });
}

// El candado y el latido del orquestador (docs/estado.md) no deben desplegar.
for (const file of ['docs/estado.md', 'docs/plan-maestro.md', 'docs/reportes/V-05b-qa.md', 'README.md', 'CLAUDE.md']) {
  test(`push: un cambio solo en ${file} no despliega`, () => {
    assert.equal(ignored(file), true);
  });
}

test('push: un merge mixto (docs + src) sí despliega', () => {
  const files = ['docs/estado.md', 'README.md', 'src/main.js'];
  assert.ok(files.some((f) => !ignored(f)));
});

// -------------------------------------------- pasos de BD con la CLI simulada

const REF = 'abcdefghijklmnopqrst';
const POOLER = 'aws-0-us-east-2.pooler.supabase.com';
const PASS = 'FAKE p@ss/w:rd%#?&+=-zz9';
const ENC = encodeURIComponent(PASS);
const DB_STEPS = [
  ['migrate-plan', 'Migraciones pendientes (dry-run)'],
  ['migrate', 'Migraciones pendientes (dry-run)'],
  ['migrate', 'Aplicar migraciones'],
  ['migrate', 'Migraciones aplicadas'],
];

// El stub registra sus argumentos en un archivo y no imprime nada: así la
// salida del paso es solo lo que imprime el workflow.
function runDbStep(jobId, step, env) {
  const dir = mkdtempSync(join(tmpdir(), 'v05b-cli-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const log = join(dir, 'cli.log');
    writeFileSync(join(bin, 'supabase'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CLI_LOG"\n', { mode: 0o755 });
    const r = spawnSync('bash', ['-c', runScript(jobId, step)], {
      env: { PATH: `${bin}:${process.env.PATH}`, CLI_LOG: log, ...env },
      cwd: ROOT,
      encoding: 'utf8',
    });
    let args = null;
    try { args = readFileSync(log, 'utf8').trimEnd().split('\n'); } catch { /* CLI no llamada */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, args };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ENV = { SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: POOLER };

for (const [jobId, step] of DB_STEPS) {
  test(`${jobId} › ${step} (bash): la CLI recibe la URL del pooler de sesión del proyecto por --db-url`, () => {
    const r = runDbStep(jobId, step, ENV);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.args, 'la CLI no se llamó');
    const i = r.args.indexOf('--db-url');
    assert.ok(i >= 0, r.args.join(' '));
    const u = new URL(r.args[i + 1]);
    assert.equal(u.protocol, 'postgresql:');
    assert.equal(u.hostname, POOLER);
    assert.equal(u.port, '5432', 'modo sesión del pooler (no 6543 transacción)');
    assert.equal(u.username, `postgres.${REF}`);
    assert.equal(decodeURIComponent(u.password), PASS);
    assert.equal(u.pathname, '/postgres');
    assert.ok(!r.args.some((a) => /^--(local|linked|include-seed|include-all|debug)$/.test(a)), r.args.join(' '));
  });

  test(`${jobId} › ${step} (bash): la contraseña y la URL solo salen en líneas ::add-mask::`, () => {
    const r = runDbStep(jobId, step, ENV);
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes(PASS), 'contraseña en claro en la salida');
    const masks = r.out.split('\n').filter((l) => l.startsWith('::add-mask::'));
    assert.ok(masks.some((l) => l === `::add-mask::${ENC}` || l.includes(ENC)), 'no se enmascara la contraseña codificada');
    assert.ok(masks.some((l) => l.startsWith('::add-mask::postgresql://')), 'no se enmascara la URL');
    // La máscara de la URL va antes que cualquier otra línea con la contraseña codificada.
    for (const l of r.out.split('\n')) {
      if (l.includes(ENC)) assert.ok(l.startsWith('::add-mask::'), `filtra la contraseña codificada: ${l}`);
    }
  });

  test(`${jobId} › ${step} (bash): host del pooler ajeno → falla y la CLI nunca se llama`, () => {
    for (const host of ['evil.example.com', `${POOLER}.evil.io`, `${POOLER}:6543`, `db.${REF}.supabase.co`]) {
      const r = runDbStep(jobId, step, { ...ENV, SUPABASE_DB_POOLER_HOST: host });
      assert.notEqual(r.code, 0, host);
      assert.equal(r.args, null, `la contraseña se habría enviado a ${host}`);
      assert.ok(!r.out.includes(PASS) && !r.out.includes(ENC), host);
    }
  });

  test(`${jobId} › ${step} (bash): falta contraseña, ref o host → falla sin llamar a la CLI`, () => {
    for (const k of Object.keys(ENV)) {
      const r = runDbStep(jobId, step, { ...ENV, [k]: '' });
      assert.notEqual(r.code, 0, k);
      assert.equal(r.args, null, k);
    }
  });
}

test('migrate-plan y migrate (bash): el dry-run lleva --dry-run sin --yes; solo "Aplicar migraciones" lleva --yes', () => {
  for (const [jobId, step] of DB_STEPS) {
    const { args } = runDbStep(jobId, step, ENV);
    const real = jobId === 'migrate' && step === 'Aplicar migraciones';
    if (step === 'Migraciones aplicadas') {
      assert.deepEqual(args.slice(0, 2), ['migration', 'list']);
      assert.ok(!args.includes('--yes'));
      continue;
    }
    assert.deepEqual(args.slice(0, 2), ['db', 'push']);
    assert.equal(args.includes('--yes'), real, `${jobId} › ${step}: --yes`);
    assert.equal(args.includes('--dry-run'), !real, `${jobId} › ${step}: --dry-run`);
  }
});

test('migrate (bash): si la CLI falla en el push real, el paso falla (set -e)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v05b-fail-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'supabase'), '#!/usr/bin/env bash\nexit 7\n', { mode: 0o755 });
    const r = spawnSync('bash', ['-c', runScript('migrate', 'Aplicar migraciones')], {
      env: { PATH: `${bin}:${process.env.PATH}`, ...ENV },
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- política de contraseñas

const TOML = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
/** Pares clave = valor de la tabla [auth] (no subtablas), sin comentarios. */
function authTable() {
  const out = {};
  let inAuth = false;
  for (const raw of TOML.split('\n')) {
    const l = raw.replace(/\s+#.*$/, '').trim();
    if (l === '' || l.startsWith('#')) continue;
    if (/^\[.*\]$/.test(l)) { inAuth = l === '[auth]'; continue; }
    const m = inAuth && l.match(/^([\w.]+)\s*=\s*(.+)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

test('config.toml (H-S03-02): [auth] minimum_password_length ≥ 12', () => {
  const a = authTable();
  assert.ok('minimum_password_length' in a, 'falta minimum_password_length en [auth]');
  assert.ok(Number(a.minimum_password_length) >= 12, a.minimum_password_length);
});

test('config.toml (H-S03-02): [auth] password_requirements exige minúsculas, mayúsculas y dígitos', () => {
  const a = authTable();
  assert.ok(['lower_upper_letters_digits', 'lower_upper_letters_digits_symbols'].includes(a.password_requirements), a.password_requirements);
});

test('config.toml: la política nueva no reabre el registro (enable_signup sigue en false)', () => {
  assert.equal(authTable().enable_signup, 'false');
});

// Contraseñas que las pruebas mandan a Auth local (login, signup, admin): si no
// cumplen la política nueva, las e2e y el pentest de CI fallarían por política
// y no por el control que prueban.
const policyOk = (p) => p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
test('las contraseñas de prueba usadas contra Auth local cumplen la política (12 + complejidad)', () => {
  const lib = readFileSync(join(ROOT, 'tests', 'security', 'api', '_lib.js'), 'utf8').match(/PASSWORD = '([^']+)'/)[1];
  const seed = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8').match(/crypt\('([^']+)'/)[1];
  for (const p of [lib, seed, 'Otra-Pass-Local-2026', 'Pentest-Signup-2026!', 'x-Pentest-2026']) assert.ok(policyOk(p), p);
});

// ------------------------------------------------------- documentación

// H-QA-V05b-02 (cerrado en la re-revisión): la guía ya describe la fase 2.
test('docs/despliegue.md documenta el despliegue en push a main y la variable SUPABASE_DB_POOLER_HOST', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'despliegue.md'), 'utf8');
  assert.match(doc, /SUPABASE_DB_POOLER_HOST/);
  assert.match(doc, /push/);
});

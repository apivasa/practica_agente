// V-05 — QA del workflow de despliegue (.github/workflows/deploy.yml).
// El criterio final (primera publicación accesible en Pages y migraciones
// aplicadas) depende del primer despliegue, que es compuerta del usuario.
// Aquí se verifica estáticamente la estructura y, ejecutando con bash los
// scripts de los pasos, el comportamiento de las compuertas de verify y del
// chequeo de dist/. Sin dependencias de YAML: análisis por indentación.
// V-05b: actualizado a la fase 2 (push a main + dispatch con confirm) y a
// `db push --db-url` sin SUPABASE_ACCESS_TOKEN. Casos nuevos en qa-v05b.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEXT = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const DOC = readFileSync(join(ROOT, 'docs', 'despliegue.md'), 'utf8');
const LINES = TEXT.split('\n');
const isComment = (l) => /^\s*#/.test(l);
const indentOf = (l) => l.match(/^ */)[0].length;

/** Bloque de nivel superior (`on:`, `jobs:`...) sin comentarios. */
function topBlock(key) {
  const start = LINES.findIndex((l) => l.startsWith(`${key}:`));
  if (start < 0) return null;
  const out = [LINES[start]];
  for (let i = start + 1; i < LINES.length; i++) {
    const l = LINES[i];
    if (/^\S/.test(l) && !isComment(l)) break;
    if (!isComment(l)) out.push(l);
  }
  return out.join('\n');
}

/** Jobs en orden: { id, text } (texto sin líneas de comentario). */
function jobs() {
  const start = LINES.findIndex((l) => /^jobs:\s*$/.test(l));
  const res = [];
  let cur = null;
  for (let i = start + 1; i < LINES.length; i++) {
    const l = LINES[i];
    if (/^\S/.test(l) && !isComment(l)) break;
    const m = l.match(/^ {2}([\w-]+):\s*$/);
    if (m) {
      cur = { id: m[1], lines: [] };
      res.push(cur);
      continue;
    }
    if (cur && !isComment(l)) cur.lines.push(l);
  }
  return res.map((j) => ({ id: j.id, text: j.lines.join('\n') }));
}

const JOBS = jobs();
const job = (id) => {
  const j = JOBS.find((x) => x.id === id);
  assert.ok(j, `falta el job ${id}`);
  return j.text;
};

/** Script `run: |` del paso con ese name dentro del job. */
function runScript(jobId, stepName) {
  const lines = job(jobId).split('\n');
  const s = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  assert.ok(s >= 0, `falta el paso "${stepName}" en ${jobId}`);
  const r = lines.findIndex((l, i) => i > s && /^\s+run:\s*\|\s*$/.test(l));
  assert.ok(r > s, `el paso "${stepName}" no tiene run: |`);
  const base = indentOf(lines[r]);
  const body = [];
  for (let i = r + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== '' && indentOf(l) <= base) break;
    body.push(l.slice(base + 2));
  }
  return body.join('\n');
}

function bash(script, env, cwd) {
  const r = spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH, ...env },
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---------------------------------------------------------------- disparador

// V-05b (ADR 0015 punto 5): fase 2, despliegue continuo en push a main; el
// disparo manual sigue disponible.
test('deploy.yml: se dispara solo con workflow_dispatch y push a main (sin PR, schedule ni workflow_run)', () => {
  const on = topBlock('on');
  assert.ok(on, 'falta on:');
  const triggers = on.split('\n').slice(1).filter((l) => /^ {2}[\w-]+:/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
  assert.deepEqual(triggers.sort(), ['push', 'workflow_dispatch']);
  assert.doesNotMatch(on, /\b(pull_request|schedule|workflow_run|pull_request_target|release|repository_dispatch)\b/);
});

test('deploy.yml: el push se limita a la rama main (sin comodines, tags ni branches-ignore)', () => {
  const lines = topBlock('on').split('\n');
  const p = lines.findIndex((l) => /^ {2}push:\s*$/.test(l));
  assert.ok(p >= 0, 'falta on.push');
  const children = [];
  for (let i = p + 1; i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 2); i++) children.push(lines[i]);
  const keys = children.filter((l) => /^ {4}[\w-]+:/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
  assert.deepEqual(keys.sort(), ['branches', 'paths-ignore']);
  const branches = children.find((l) => /^ {4}branches:/.test(l));
  assert.match(branches, /^ {4}branches:\s*\[\s*main\s*\]\s*$/);
});

test('deploy.yml: input confirm obligatorio y sin valor por defecto que habilite', () => {
  const on = topBlock('on');
  // Sin regex multilínea (CodeQL js/redos): se recorren las líneas hijas de confirm:.
  const lines = on.split('\n');
  const c = lines.findIndex((l) => /^\s+confirm:\s*$/.test(l));
  assert.ok(c >= 0, 'falta el input confirm');
  const base = indentOf(lines[c]);
  const children = [];
  for (let i = c + 1; i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > base); i++) {
    children.push(lines[i].trim());
  }
  assert.ok(children.includes('required: true'), 'confirm debe ser required: true');
  assert.doesNotMatch(on, /default:\s*['"]?desplegar/);
});

test('deploy.yml: concurrencia sin cancelar un despliegue en curso', () => {
  const c = topBlock('concurrency');
  assert.ok(c, 'falta concurrency:');
  assert.match(c, /cancel-in-progress:\s*false/);
});

// Con push en cada merge, dos merges seguidos no deben correr db push a la vez:
// el grupo es único (no depende de ref, sha ni run) y no hay concurrency por job.
test('deploy.yml: grupo de concurrencia único para todo despliegue (push y manual en la misma cola)', () => {
  const c = topBlock('concurrency');
  const group = c.split('\n').find((l) => /^\s+group:/.test(l));
  assert.ok(group, 'falta concurrency.group');
  assert.doesNotMatch(group, /\$\{\{/, `el grupo no debe variar por evento/ref: ${group.trim()}`);
  for (const { id, text } of JOBS) assert.doesNotMatch(text, /^ {4}concurrency:/m, `${id} define su propia concurrencia`);
});

// ---------------------------------------------------------------- cadena de jobs

const needsOf = (id) => {
  const m = job(id).match(/^ {4}needs:\s*(.+?)\s*$/m);
  if (!m) return [];
  return m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean).sort();
};

// ADR 0015 (intento 2): lo barato y reversible (build, verificación de dist/)
// falla antes que lo irreversible (db push).
test('deploy.yml: jobs y cadena verify → build-pages → migrate-plan → migrate → deploy-pages → smoke', () => {
  assert.deepEqual(JOBS.map((j) => j.id), ['verify', 'build-pages', 'migrate-plan', 'migrate', 'deploy-pages', 'smoke']);
  assert.deepEqual(needsOf('verify'), []);
  const expected = {
    'build-pages': ['verify'],
    'migrate-plan': ['build-pages'],
    migrate: ['migrate-plan'],
    'deploy-pages': ['build-pages', 'migrate'],
    smoke: ['deploy-pages'],
  };
  for (const [id, deps] of Object.entries(expected)) assert.deepEqual(needsOf(id), deps, `needs de ${id}`);
});

test('deploy.yml: migrate depende (transitivamente) del build y de la verificación de dist/', () => {
  const ancestors = (id, acc = new Set()) => {
    for (const d of needsOf(id)) if (!acc.has(d)) { acc.add(d); ancestors(d, acc); }
    return acc;
  };
  const a = ancestors('migrate');
  assert.ok(a.has('verify') && a.has('build-pages') && a.has('migrate-plan'));
  const d = ancestors('deploy-pages');
  assert.ok(d.has('migrate'), 'Pages no se publica sin migraciones aplicadas');
});

test('deploy.yml: ningún job se salta la cadena con if: always() / failure()', () => {
  assert.doesNotMatch(TEXT.split('\n').filter((l) => !isComment(l)).join('\n'), /if:.*(always\(\)|failure\(\)|cancelled\(\))/);
  assert.doesNotMatch(TEXT, /continue-on-error:\s*true/);
});

// ---------------------------------------------------------------- permisos

test('deploy.yml: permisos de workflow solo contents: read', () => {
  const p = topBlock('permissions');
  assert.match(p, /contents:\s*read/);
  assert.doesNotMatch(p, /write/);
});

test('deploy.yml: pages: write e id-token: write solo en deploy-pages', () => {
  for (const { id, text } of JOBS) {
    const hasPages = /pages:\s*write/.test(text);
    const hasId = /id-token:\s*write/.test(text);
    if (id === 'deploy-pages') {
      assert.ok(hasPages && hasId, 'deploy-pages necesita pages: write e id-token: write');
    } else {
      assert.ok(!hasPages && !hasId, `${id} no debe tener pages/id-token write`);
      assert.doesNotMatch(text, /:\s*write\b/, `${id} con algún permiso de escritura`);
    }
  }
});

test('deploy.yml: deploy-pages publica en el environment github-pages', () => {
  assert.match(job('deploy-pages'), /environment:\s*\n\s+name:\s*github-pages/);
  assert.match(job('deploy-pages'), /uses:\s*actions\/deploy-pages@[0-9a-f]{40}/);
});

test('deploy.yml: los jobs con secretos de producción usan el environment produccion', () => {
  for (const { id, text } of JOBS) {
    if (/secrets\./.test(text)) assert.match(text, /environment:\s*produccion/, `${id} lee secretos sin environment produccion`);
  }
});

// ---------------------------------------------------------------- verify

// V-05b: deploy.yml usa 4 secretos. Ni SUPABASE_SECRET_KEY (H-S05-06) ni
// SUPABASE_ACCESS_TOKEN (H-V05-01: las migraciones van por --db-url con la
// contraseña de la BD). El host del pooler es una variable (vars.*), no secreto.
const SECRETS = ['SUPABASE_URL', 'SUPABASE_PROJECT_REF', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_DB_PASSWORD'];
const POOLER_VAR = 'SUPABASE_DB_POOLER_HOST';
const CODE = TEXT.split('\n').filter((l) => !isComment(l)).join('\n');

test('deploy.yml: ningún job lee SUPABASE_SECRET_KEY (H-S05-06)', () => {
  assert.doesNotMatch(CODE, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(CODE, /sb_secret_\*/);
});

test('deploy.yml: ningún job lee SUPABASE_ACCESS_TOKEN ni hace supabase link / login (H-V05-01)', () => {
  assert.doesNotMatch(CODE, /SUPABASE_ACCESS_TOKEN|sbp_/);
  assert.doesNotMatch(CODE, /supabase\s+(link|login|projects)\b/);
});

test('verify: recibe los 4 secretos del despliegue desde secrets.* y el host del pooler desde vars.*', () => {
  const v = job('verify');
  for (const s of SECRETS) assert.match(v, new RegExp(`${s}:\\s*\\$\\{\\{\\s*secrets\\.${s}\\s*\\}\\}`), s);
  assert.match(v, new RegExp(`${POOLER_VAR}:\\s*\\$\\{\\{\\s*vars\\.${POOLER_VAR}\\s*\\}\\}`));
  assert.match(v, /CONFIRM:\s*\$\{\{\s*inputs\.confirm\s*\}\}/);
});

// La exención de confirm se decide por GITHUB_EVENT_NAME, que pone el runner:
// ningún env: del workflow debe poder fijarlo.
test('deploy.yml: ningún env: redefine GITHUB_EVENT_NAME ni GITHUB_REF', () => {
  assert.doesNotMatch(CODE, /^\s+GITHUB_(EVENT_NAME|REF)\s*:/m);
});

test('deploy.yml: ningún paso de la cadena se salta por evento (sin if: en verify, build, plan ni migrate)', () => {
  for (const id of ['verify', 'build-pages', 'migrate-plan', 'migrate']) {
    assert.doesNotMatch(job(id), /^\s+if:/m, `${id} tiene un if:`);
  }
});

test('verify: los scripts no usan expresiones ${{ }} (sin inyección del input)', () => {
  for (const step of ['Confirmación, rama y secretos', 'Origen de producción', 'Registro cerrado en Auth']) {
    assert.doesNotMatch(runScript('verify', step), /\$\{\{/, step);
  }
});

test('verify: ninguna línea echo/printf imprime el valor de un secreto', () => {
  for (const step of ['Confirmación, rama y secretos', 'Origen de producción', 'Registro cerrado en Auth']) {
    const script = runScript('verify', step);
    for (const l of script.split('\n')) {
      if (!/\b(echo)\b/.test(l)) continue;
      for (const s of SECRETS) {
        if (s === 'SUPABASE_URL' || s === 'SUPABASE_PROJECT_REF') continue; // no son secretos de valor sensible
        assert.doesNotMatch(l, new RegExp(`\\$\\{?${s}\\b`), `${step}: imprime ${s}: ${l.trim()}`);
      }
      assert.doesNotMatch(l, /\$\{!name/, `imprime el valor indirecto: ${l.trim()}`);
    }
    assert.doesNotMatch(script, /set -x|set -[a-z]*x/);
  }
});

test('verify: orden secretos → origen de producción → registro cerrado (no se llama a un host ajeno)', () => {
  const v = job('verify').split('\n');
  const i = (name) => v.findIndex((l) => l.includes(`- name: ${name}`));
  const a = i('Confirmación, rama y secretos');
  const b = i('Origen de producción');
  const c = i('Registro cerrado en Auth');
  assert.ok(a >= 0 && b > a && c > b, `orden: ${a}, ${b}, ${c}`);
  const checkout = v.findIndex((l) => /uses:\s*actions\/checkout@/.test(l));
  assert.ok(checkout > a && checkout < b, 'el checkout (para leer csp.js) va antes del chequeo de origen');
});

const REF = 'abcdefghijklmnopqrst';
const POOLER = 'aws-0-us-east-2.pooler.supabase.com';
// Disparo manual por defecto; los casos de push lo cambian explícitamente.
// Sin SUPABASE_ACCESS_TOKEN ni SUPABASE_SECRET_KEY: verify debe pasar sin ellos.
const GOOD = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  CONFIRM: 'desplegar',
  GITHUB_REF: 'refs/heads/main',
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKEpublishableVALUE123',
  SUPABASE_DB_PASSWORD: 'FAKE-db-password-zz9',
  SUPABASE_DB_POOLER_HOST: POOLER,
};
const SENSITIVE = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_DB_PASSWORD'];
const runVerify = (over) => bash(runScript('verify', 'Confirmación, rama y secretos'), { ...GOOD, ...over });
const PUSH = { GITHUB_EVENT_NAME: 'push', CONFIRM: '' };
const assertNoLeak = (out, values = GOOD) => {
  for (const s of SENSITIVE) assert.ok(!out.includes(values[s]), `la salida filtra ${s}`);
};

test('verify (bash): disparo manual en main con confirm=desplegar y configuración completa pasa sin filtrar valores', () => {
  const r = runVerify({});
  assert.equal(r.code, 0, r.out);
  assertNoLeak(r.out);
});

test('verify (bash): push a main pasa sin confirm (despliegue continuo) y sin filtrar valores', () => {
  const r = runVerify(PUSH);
  assert.equal(r.code, 0, r.out);
  assertNoLeak(r.out);
});

test('verify (bash): no exige SUPABASE_SECRET_KEY ni SUPABASE_ACCESS_TOKEN (ausentes, pasa)', () => {
  for (const over of [{}, PUSH]) {
    const r = runVerify(over);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /SUPABASE_SECRET_KEY|SUPABASE_ACCESS_TOKEN/);
  }
});

for (const bad of ['', 'Desplegar', 'desplegar ', 'si', 'desplegarr']) {
  test(`verify (bash): dispatch con confirm=${JSON.stringify(bad)} se rechaza`, () => {
    const r = runVerify({ CONFIRM: bad });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /no confirmado/);
  });
}

// Solo el evento push exime de confirm: cualquier otro nombre (o vacío) lo exige.
for (const ev of ['', 'Push', 'push ', 'pull_request', 'schedule', 'workflow_run', 'repository_dispatch']) {
  test(`verify (bash): evento ${JSON.stringify(ev)} sin confirm se rechaza`, () => {
    const r = runVerify({ GITHUB_EVENT_NAME: ev, CONFIRM: '' });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /no confirmado/);
  });
}

for (const ref of ['refs/heads/item/V-05', 'refs/heads/mainx', 'refs/tags/main', 'refs/pull/1/merge', '']) {
  for (const [label, over] of [['dispatch', {}], ['push', PUSH]]) {
    test(`verify (bash): ${label} desde ${JSON.stringify(ref)} distinta de main se rechaza`, () => {
      const r = runVerify({ ...over, GITHUB_REF: ref });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /Solo se despliega desde main/);
    });
  }
}

for (const s of SECRETS) {
  test(`verify (bash): falta ${s} → falla también en push, lo nombra y no filtra los demás`, () => {
    for (const over of [{}, PUSH]) {
      const r = runVerify({ ...over, [s]: '' });
      assert.notEqual(r.code, 0);
      assert.match(r.out, new RegExp(`Faltan secretos de producción:.*${s}`));
      assertNoLeak(r.out);
    }
  });
}

test('verify (bash): faltan todos → los 4 se listan', () => {
  const r = runVerify(Object.fromEntries(SECRETS.map((s) => [s, ''])));
  assert.notEqual(r.code, 0);
  for (const s of SECRETS) assert.ok(r.out.includes(s), s);
});

test('verify (bash): falta la variable SUPABASE_DB_POOLER_HOST → falla en push y en dispatch sin filtrar', () => {
  for (const over of [{}, PUSH]) {
    const r = runVerify({ ...over, SUPABASE_DB_POOLER_HOST: '' });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /SUPABASE_DB_POOLER_HOST/);
    assertNoLeak(r.out);
  }
});

// La contraseña de la BD solo debe viajar al pooler de Supabase.
const BAD_POOLERS = [
  'evil.example.com',
  'aws-0-us-east-1.pooler.supabase.com.evil.io',
  'x.aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com:6543',
  'aws-0-us-east-1.pooler.supabase.com/x',
  'aws-0-us-east-1.pooler.supabase.com@evil.io',
  'evil.io#aws-0-us-east-1.pooler.supabase.com',
  ' aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com\nevil.io',
  `db.${REF}.supabase.co`,
  'aws-0-us-east-1.pooler.supabase.co',
];
for (const host of BAD_POOLERS) {
  test(`verify (bash): host del pooler ${JSON.stringify(host)} se rechaza sin filtrar la contraseña`, () => {
    const r = runVerify({ ...PUSH, SUPABASE_DB_POOLER_HOST: host });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /SUPABASE_DB_POOLER_HOST/);
    assertNoLeak(r.out);
  });
}

test('verify (bash): hosts de pooler reales de varias regiones se aceptan', () => {
  for (const host of ['aws-0-us-east-1.pooler.supabase.com', 'aws-1-eu-central-2.pooler.supabase.com', 'aws-0-ap-southeast-1.pooler.supabase.com', POOLER]) {
    assert.equal(runVerify({ SUPABASE_DB_POOLER_HOST: host }).code, 0, host);
  }
});

test('verify (bash): clave publicable legada (JWT anon) se rechaza sin imprimirla', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.FAKE.FAKE';
  const r = runVerify({ SUPABASE_PUBLISHABLE_KEY: jwt });
  assert.notEqual(r.code, 0);
  assert.ok(!r.out.includes(jwt));
});

test('verify (bash): una clave secreta cargada como publicable se rechaza sin imprimirla', () => {
  const secret = 'sb_secret_FAKEsecretVALUE4567890';
  const r = runVerify({ SUPABASE_PUBLISHABLE_KEY: secret });
  assert.notEqual(r.code, 0);
  assert.ok(!r.out.includes(secret));
});

test('verify (bash): SUPABASE_URL que no corresponde al project ref se rechaza', () => {
  let r = runVerify({ SUPABASE_URL: 'https://otroproyectoxxxxxxx.supabase.co' });
  assert.notEqual(r.code, 0);
  r = runVerify({ SUPABASE_URL: `http://${REF}.supabase.co` });
  assert.notEqual(r.code, 0);
  r = runVerify({ SUPABASE_URL: `https://${REF}.supabase.co/` });
  assert.equal(r.code, 0, 'la barra final es aceptable');
});

// --- Origen de producción (H-V05-QA-01): se ejecuta en una copia mínima del repo.
const PROD_ORIGIN = readFileSync(join(ROOT, 'src', 'security', 'csp.js'), 'utf8')
  .match(/^export const PRODUCTION_SUPABASE_ORIGIN = '([^']+)';/m)[1];

function runOrigin(url, cspSource) {
  const dir = mkdtempSync(join(tmpdir(), 'v05-origin-'));
  try {
    mkdirSync(join(dir, 'src', 'security'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'security', 'csp.js'),
      cspSource ?? readFileSync(join(ROOT, 'src', 'security', 'csp.js'), 'utf8'),
    );
    return bash(runScript('verify', 'Origen de producción'), { SUPABASE_URL: url }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verify origen (bash): SUPABASE_URL = PRODUCTION_SUPABASE_ORIGIN de csp.js pasa (con o sin barra final)', () => {
  let r = runOrigin(PROD_ORIGIN);
  assert.equal(r.code, 0, r.out);
  r = runOrigin(`${PROD_ORIGIN}/`);
  assert.equal(r.code, 0, r.out);
});

test('verify origen (bash): otro proyecto coherente con su ref se detiene antes de migrar', () => {
  const r = runOrigin(`https://${REF}.supabase.co`);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no es el origen de producción/);
});

test('verify origen (bash): variantes del origen (http, ruta, subdominio) se rechazan', () => {
  const host = new URL(PROD_ORIGIN).host;
  for (const url of [`http://${host}`, `${PROD_ORIGIN}/rest/v1`, `https://x.${host}`, `${PROD_ORIGIN}//`, '']) {
    assert.notEqual(runOrigin(url).code, 0, url);
  }
});

test('verify origen (bash): si csp.js no declara la constante, falla en vez de aceptar', () => {
  const r = runOrigin(PROD_ORIGIN, 'export const OTHER = 1;\n');
  assert.notEqual(r.code, 0);
  assert.match(r.out, /No se encontró PRODUCTION_SUPABASE_ORIGIN/);
});

// --- Registro cerrado en Auth (H-S05-01): curl sustituido por un stub en PATH.
function withStubs(stubs, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'v05-stub-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    }
    return fn({ dir, bin, path: `${bin}:${process.env.PATH}` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const AUTH_CURL = 'printf "%s\\n" "$@" > "$CURL_LOG"; [ "${FAKE_CURL_EXIT:-0}" = 0 ] || exit "$FAKE_CURL_EXIT"; printf "%s" "$FAKE_SETTINGS"';
function runAuth(settings, { exit = 0, url = PROD_ORIGIN } = {}) {
  return withStubs({ curl: AUTH_CURL }, ({ dir, path }) => {
    const log = join(dir, 'curl.log');
    const r = spawnSync('bash', ['-c', runScript('verify', 'Registro cerrado en Auth')], {
      env: {
        PATH: path,
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: GOOD.SUPABASE_PUBLISHABLE_KEY,
        FAKE_SETTINGS: settings,
        FAKE_CURL_EXIT: String(exit),
        CURL_LOG: log,
      },
      cwd: dir,
      encoding: 'utf8',
    });
    let args = [];
    try { args = readFileSync(log, 'utf8').split('\n'); } catch { /* curl no llamado */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, args };
  });
}

// Exactamente un argumento de curl es URL, con origen de producción y ruta exactos.
function assertSettingsUrl(args) {
  const urls = args.filter((a) => /^https?:\/\//.test(a));
  assert.equal(urls.length, 1, args.join(' '));
  const u = new URL(urls[0]);
  assert.equal(u.origin, PROD_ORIGIN);
  assert.equal(u.pathname, '/auth/v1/settings');
  assert.equal(u.search + u.hash, '');
}

test('verify auth (bash): disable_signup = true pasa, consulta /auth/v1/settings con la clave publicable y no la imprime', () => {
  const r = runAuth('{"disable_signup":true,"external":{"email":true}}');
  assert.equal(r.code, 0, r.out);
  assertSettingsUrl(r.args);
  assert.ok(r.args.includes(`apikey: ${GOOD.SUPABASE_PUBLISHABLE_KEY}`));
  assert.ok(r.args.some((a) => /^-[a-zA-Z]*f/.test(a)), 'curl con -f: un 4xx/5xx no pasa como respuesta válida');
  assert.ok(!r.out.includes(GOOD.SUPABASE_PUBLISHABLE_KEY));
});

test('verify auth (bash): con barra final en SUPABASE_URL la ruta no lleva doble barra', () => {
  const r = runAuth('{"disable_signup":true}', { url: `${PROD_ORIGIN}/` });
  assert.equal(r.code, 0, r.out);
  assertSettingsUrl(r.args);
});

for (const [label, body] of [
  ['registro abierto (false)', '{"disable_signup":false}'],
  ['campo ausente', '{"external":{"email":true}}'],
  ['valor no booleano "true"', '{"disable_signup":"yes"}'],
  ['respuesta vacía', ''],
  ['respuesta no JSON', '<html>error</html>'],
]) {
  test(`verify auth (bash): ${label} → falla`, () => {
    const r = runAuth(body);
    assert.notEqual(r.code, 0, r.out);
    assert.ok(!r.out.includes(GOOD.SUPABASE_PUBLISHABLE_KEY));
  });
}

test('verify auth (bash): curl falla (proyecto pausado / 401) → falla con mensaje y sin filtrar la clave', () => {
  const r = runAuth('{"disable_signup":true}', { exit: 22 });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /No se pudo leer \/auth\/v1\/settings/);
  assert.ok(!r.out.includes(GOOD.SUPABASE_PUBLISHABLE_KEY));
});

// ---------------------------------------------------------------- migrate-plan y migrate

for (const id of ['migrate-plan', 'migrate']) {
  test(`${id}: nunca aplica seed.sql ni resetea la base`, () => {
    assert.doesNotMatch(job(id), /--include-seed|seed\.sql|db reset|db seed|--include-all|--debug|config push/);
  });

  test(`${id}: sin link ni token, solo contraseña de BD + ref + host del pooler, sin credenciales persistidas`, () => {
    const m = job(id);
    assert.doesNotMatch(m, /supabase\s+link\b|SUPABASE_ACCESS_TOKEN/);
    assert.doesNotMatch(m, /SUPABASE_SECRET_KEY|SUPABASE_PUBLISHABLE_KEY|secrets\.SUPABASE_URL\b/);
    const secretsRead = [...new Set([...m.matchAll(/secrets\.(\w+)/g)].map((x) => x[1]))].sort();
    assert.deepEqual(secretsRead, ['SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF']);
    assert.match(m, /persist-credentials:\s*false/);
    assert.match(m, /environment:\s*produccion/);
  });
}

test('deploy.yml: ningún job aplica la semilla, resetea, usa psql ni config push', () => {
  assert.doesNotMatch(CODE, /--include-seed|db reset|psql\b|config push/);
});

// Líneas que invocan `supabase db push` (cualquier variante de flags).
const DB_PUSH = /supabase\s+db\s+push\b/;
// V-05b: destino remoto explícito por --db-url (cadena de scripts/ci/db-url.sh).
const DRY_RUN_LINE = /^\s*(run:\s*)?supabase db push --db-url "\$SUPABASE_DB_URL" --dry-run\s*$/;
// Fix run 44837918615: la CLI pide confirmación en CI; el push real lleva --yes.
const REAL_PUSH_LINE = /^\s*(run:\s*)?supabase db push --db-url "\$SUPABASE_DB_URL" --yes\s*$/;
const LIST_LINE = /^\s*(run:\s*)?supabase migration list --db-url "\$SUPABASE_DB_URL"\s*$/;

test('migrate-plan: solo dry-run sin --yes, nunca db push real', () => {
  const pushes = job('migrate-plan').split('\n').filter((l) => DB_PUSH.test(l));
  assert.ok(pushes.length >= 1, 'falta el dry-run');
  for (const l of pushes) {
    assert.match(l, DRY_RUN_LINE, `migrate-plan solo admite el dry-run exacto: ${l.trim()}`);
    assert.doesNotMatch(l, /--yes\b/, `--yes nunca en el dry-run: ${l.trim()}`);
  }
});

test('migrate: dry-run (sin --yes) en un paso previo al push real `--db-url … --yes` y migration list después', () => {
  const lines = job('migrate').split('\n');
  const pushes = lines.map((l, i) => [l, i]).filter(([l]) => DB_PUSH.test(l));
  const dryIdx = pushes.filter(([l]) => DRY_RUN_LINE.test(l)).map(([, i]) => i);
  const realIdx = pushes.filter(([l]) => REAL_PUSH_LINE.test(l)).map(([, i]) => i);
  assert.equal(dryIdx.length, 1, 'migrate: exactamente un dry-run');
  assert.equal(realIdx.length, 1, 'migrate: exactamente un push real `supabase db push --db-url "$SUPABASE_DB_URL" --yes`');
  assert.equal(pushes.length, 2, `migrate: solo dry-run y push real: ${pushes.map(([l]) => l.trim()).join(' | ')}`);
  const [dry] = dryIdx;
  const [push] = realIdx;
  const list = lines.findIndex((l) => LIST_LINE.test(l));
  assert.ok(dry >= 0 && push > dry && list > push, `orden dry-run(${dry}) → push(${push}) → list(${list})`);
  assert.ok(lines.slice(dry, push).some((l) => /^\s+- name:/.test(l)), 'dry-run y push en pasos distintos');
});

test('deploy.yml: --yes aparece solo en el push real, nunca junto a --dry-run', () => {
  const withYes = CODE.split('\n').filter((l) => /--yes\b/.test(l));
  assert.ok(withYes.length >= 1, 'falta --yes en el push real');
  for (const l of withYes) {
    assert.match(l, REAL_PUSH_LINE, `--yes fuera del push real: ${l.trim()}`);
    assert.doesNotMatch(l, /--dry-run/, `--yes junto a --dry-run: ${l.trim()}`);
  }
  for (const l of CODE.split('\n').filter((x) => /--dry-run/.test(x))) {
    assert.doesNotMatch(l, /--yes\b/, `dry-run con --yes: ${l.trim()}`);
  }
  // El push real solo vive en migrate (tras la aprobación del environment).
  const real = JOBS.filter((j) => j.text.split('\n').some((l) => REAL_PUSH_LINE.test(l))).map((j) => j.id);
  assert.deepEqual(real, ['migrate']);
});

// ---------------------------------------------------------------- workflows programados

for (const name of ['ritmo-diario.yml', 'evaluacion-mensual.yml']) {
  test(`${name}: el job que lee SUPABASE_SECRET_KEY usa environment produccion (H-C03-02)`, () => {
    const t = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
    assert.match(t, /SUPABASE_SECRET_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SECRET_KEY/);
    assert.match(t, /^ {4}environment:\s*produccion\s*$/m);
  });
}

// ---------------------------------------------------------------- build-pages

test('build-pages: el build recibe solo URL y clave publicable', () => {
  const b = job('build-pages');
  assert.match(b, /VITE_SUPABASE_URL:\s*\$\{\{\s*secrets\.SUPABASE_URL\s*\}\}/);
  assert.match(b, /VITE_SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_PUBLISHABLE_KEY\s*\}\}/);
  assert.doesNotMatch(b, /SUPABASE_SECRET_KEY|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD/);
  assert.match(b, /npm ci --ignore-scripts/);
});

test('build-pages: verifica dist/ antes de subir el artefacto de Pages', () => {
  const lines = job('build-pages').split('\n');
  const check = lines.findIndex((l) => l.includes('- name: Verificar dist/'));
  const upload = lines.findIndex((l) => /uses:\s*actions\/upload-pages-artifact@/.test(l));
  const build = lines.findIndex((l) => /run:\s*npm run build/.test(l));
  assert.ok(build >= 0 && check > build && upload > check, 'orden build → verificar dist/ → upload');
  assert.match(lines.slice(upload).join('\n'), /path:\s*dist/);
});

const GOOD_CSP = "default-src 'none'; script-src 'self'; connect-src 'self' https://x.supabase.co; upgrade-insecure-requests";
function runDistCheck({ csp = GOOD_CSP, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v05-dist-'));
  try {
    mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });
    const meta = csp === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    writeFileSync(join(dir, 'dist', 'index.html'), `<!doctype html><html><head>${meta}<title>App de control de capacidad RUN</title></head></html>`);
    // supabase-js trae el literal "sb_secret_" para detectar el formato de clave.
    writeFileSync(join(dir, 'dist', 'assets', 'index.js'), 'const p="sb_secret_";const u="https://x.supabase.co";');
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'dist', name), content);
    return bash(runScript('build-pages', 'Verificar dist/'), {}, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Verificar dist/ (bash): un dist correcto pasa (el literal sb_secret_ de supabase-js no es falso positivo)', () => {
  const r = runDistCheck();
  assert.equal(r.code, 0, r.out);
});

test('Verificar dist/ (bash): sin meta CSP falla', () => {
  assert.notEqual(runDistCheck({ csp: null }).code, 0);
});

test('Verificar dist/ (bash): CSP con origen loopback falla', () => {
  assert.notEqual(runDistCheck({ csp: `${GOOD_CSP.replace('upgrade', 'http://127.0.0.1:54321; upgrade')}` }).code, 0);
  assert.notEqual(runDistCheck({ csp: `${GOOD_CSP.replace('upgrade', 'http://localhost:54321; upgrade')}` }).code, 0);
});

test('Verificar dist/ (bash): CSP sin upgrade-insecure-requests falla', () => {
  assert.notEqual(runDistCheck({ csp: "default-src 'none'; script-src 'self'" }).code, 0);
});

test('Verificar dist/ (bash): una clave sb_secret_ real en dist falla', () => {
  const r = runDistCheck({ files: { 'leak.js': 'const k="sb_secret_ABCDEFGHijklmnop1234";' } });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /clave secreta/);
});

test('Verificar dist/ (bash): dist apuntando a Supabase local falla', () => {
  const r = runDistCheck({ files: { 'cfg.js': 'const u="http://127.0.0.1:54321";' } });
  assert.notEqual(r.code, 0);
});

// ---------------------------------------------------------------- smoke

test('smoke: sin permisos y contra la URL publicada por deploy-pages', () => {
  const s = job('smoke');
  assert.match(s, /permissions:\s*\{\s*\}/);
  assert.match(s, /PAGE_URL:\s*\$\{\{\s*needs\.deploy-pages\.outputs\.page_url\s*\}\}/);
  assert.match(job('deploy-pages'), /page_url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/);
  assert.doesNotMatch(s, /secrets\./);
});

test('smoke: exige HTTP 200 y el título real de index.html, con reintentos y fallo final', () => {
  const script = runScript('smoke', 'GET de la URL publicada');
  const title = readFileSync(join(ROOT, 'index.html'), 'utf8').match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(script.includes(`<title>${title}</title>`), 'el smoke busca un título distinto al de index.html');
  assert.match(script, /"\$code" = "200"/);
  assert.match(script, /curl[^\n]*"\$url"/);
  assert.match(script, /exit 1\s*$/);
  assert.match(script, /https:\/\/apivasa\.github\.io\/practica_agente\//);
});

test('smoke: la URL de respaldo coincide con la base de Vite', () => {
  const vite = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');
  const base = vite.match(/base:\s*['"]([^'"]+)['"]/)[1];
  // Se parsea cada URL del script y se compara origen y ruta exactos, no por subcadena.
  const urls = (runScript('smoke', 'GET de la URL publicada').match(/https?:\/\/[^\s"'}]+/g) || [])
    .filter((u) => URL.canParse(u))
    .map((u) => new URL(u));
  assert.ok(
    urls.some((u) => u.origin === 'https://apivasa.github.io' && u.pathname === base),
    `ninguna URL del smoke es https://apivasa.github.io${base}`,
  );
});

// Smoke en bash con curl y sleep sustituidos: la página se escribe en -o y el
// código HTTP sale por -w; el JS principal se pide con -o /dev/null.
const SMOKE_CURL = [
  'printf "%s\\n" "$*" >> "$CURL_LOG"',
  'out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; url="$a"; done',
  'if [ "$out" = "page.html" ]; then printf "%s" "$FAKE_PAGE" > page.html; printf "%s" "$FAKE_CODE"; else printf "%s" "$FAKE_JS_CODE"; fi',
].join('\n');
const PAGE_OK = '<!doctype html><html><head><title>App de control de capacidad RUN</title>'
  + '<script type="module" crossorigin src="/practica_agente/assets/index-AbC123.js"></script></head></html>';

function runSmoke({ page = PAGE_OK, code = '200', jsCode = '200', pageUrl = 'https://apivasa.github.io/practica_agente/' } = {}) {
  return withStubs({ curl: SMOKE_CURL, sleep: 'exit 0' }, ({ dir, path }) => {
    const log = join(dir, 'curl.log');
    const r = spawnSync('bash', ['-c', runScript('smoke', 'GET de la URL publicada')], {
      env: { PATH: path, PAGE_URL: pageUrl, FAKE_PAGE: page, FAKE_CODE: code, FAKE_JS_CODE: jsCode, CURL_LOG: log },
      cwd: dir,
      encoding: 'utf8',
    });
    let calls = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n'); } catch { /* sin llamadas */ }
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls };
  });
}

// La URL pedida es el último argumento de curl: se comparan protocolo, host y ruta exactos.
function assertCallUrl(call, pathname) {
  const u = new URL(call.trim().split(/\s+/).pop());
  assert.equal(u.protocol, 'https:', call);
  assert.equal(u.host, 'apivasa.github.io', call);
  assert.equal(u.pathname, pathname, call);
  assert.equal(u.search + u.hash, '', call);
}

test('smoke (bash): HTML 200 con título y JS principal 200 → pasa al primer intento', () => {
  const r = runSmoke();
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.length, 2, r.calls.join('\n'));
  assertCallUrl(r.calls[0], '/practica_agente/');
  assertCallUrl(r.calls[1], '/practica_agente/assets/index-AbC123.js');
});

test('smoke (bash): JS principal 404 (base rota) → falla tras 6 intentos', () => {
  const r = runSmoke({ jsCode: '404' });
  assert.notEqual(r.code, 0);
  assert.equal(r.calls.length, 12);
  assert.match(r.out, /no respondió 200 con el título de la app y su JS principal/);
});

test('smoke (bash): HTML sin script en /practica_agente/assets/ → falla', () => {
  const r = runSmoke({ page: PAGE_OK.replace('/practica_agente/assets/', '/assets/') });
  assert.notEqual(r.code, 0);
});

test('smoke (bash): HTML 404 o título distinto → falla', () => {
  assert.notEqual(runSmoke({ code: '404' }).code, 0);
  assert.notEqual(runSmoke({ page: PAGE_OK.replace('capacidad RUN', 'Otra app') }).code, 0);
});

test('smoke (bash): sin page_url usa la URL de respaldo de Pages', () => {
  const r = runSmoke({ pageUrl: '' });
  assert.equal(r.code, 0, r.out);
  assertCallUrl(r.calls[0], '/practica_agente/');
});

// ---------------------------------------------------------------- documentación

test('docs/despliegue.md: documenta disparo manual, secretos, verificación y reversión', () => {
  assert.match(DOC, /desplegar/);
  for (const s of SECRETS) assert.ok(DOC.includes(s), `docs/despliegue.md no menciona ${s}`);
  assert.match(DOC, /dry-run/);
  assert.match(DOC, /seed\.sql/);
  assert.match(DOC, /[Rr]evers/);
});

// La CLI 3.x usa el stack local por defecto: cada comando de BD lleva un
// destino remoto explícito, ahora la cadena del pooler por --db-url (H-V05-01).
test('deploy.yml: todo comando de BD de la CLI apunta al proyecto remoto por --db-url "$SUPABASE_DB_URL"', () => {
  const all = CODE.split('\n').filter((l) => /supabase\s+(db|migration)\b/.test(l));
  const cmds = all.filter((l) => /^\s*(run:\s*)?supabase\s+(db\s+push|migration\s+list)\b/.test(l));
  assert.equal(cmds.length, all.length, `comando de BD inesperado: ${all.map((l) => l.trim()).join(' | ')}`);
  assert.ok(cmds.length >= 4, `se esperaban al menos 4 comandos, hay ${cmds.length}`);
  for (const l of cmds) {
    assert.match(l, /\s--db-url "\$SUPABASE_DB_URL"(\s|$)/, `sin --db-url explícito: ${l.trim()}`);
    assert.doesNotMatch(l, /--local|--linked|--password|\s-p\s|--include-seed|--include-all|--debug/, l.trim());
  }
});

test('deploy.yml: la cadena de conexión nunca va escrita en el workflow (sin postgres:// literal)', () => {
  assert.doesNotMatch(CODE, /postgres(ql)?:\/\//);
  assert.doesNotMatch(CODE, /SUPABASE_DB_URL:\s*\$\{\{/, 'SUPABASE_DB_URL no se arma con expresiones de GitHub');
});

test('deploy.yml: cada paso con db push/migration list arma la URL con db-url.sh y recibe contraseña, ref y host por env', () => {
  const steps = CODE.split(/^\s+- (?=name:|uses:)/m).filter((s) => /supabase\s+(db\s+push|migration\s+list)/.test(s));
  assert.ok(steps.length >= 4);
  for (const s of steps) {
    const name = s.split('\n')[0];
    assert.match(s, /SUPABASE_DB_PASSWORD:\s*\$\{\{\s*secrets\.SUPABASE_DB_PASSWORD\s*\}\}/, name);
    assert.match(s, /SUPABASE_PROJECT_REF:\s*\$\{\{\s*secrets\.SUPABASE_PROJECT_REF\s*\}\}/, name);
    assert.match(s, /SUPABASE_DB_POOLER_HOST:\s*\$\{\{\s*vars\.SUPABASE_DB_POOLER_HOST\s*\}\}/, name);
    const body = s.split('\n');
    const strict = body.findIndex((l) => /set -euo pipefail/.test(l));
    const src = body.findIndex((l) => /^\s*\. scripts\/ci\/db-url\.sh\s*$/.test(l));
    const call = body.findIndex((l) => /^\s*supabase_db_url\s*$/.test(l));
    const cli = body.findIndex((l) => /supabase\s+(db\s+push|migration\s+list)/.test(l));
    assert.ok(strict >= 0 && src > strict && call > src && cli > call, `${name}: orden set -euo pipefail → . db-url.sh → supabase_db_url → CLI`);
  }
});

test('deploy.yml: ningún script imprime la contraseña ni la URL de la BD ni activa trazas', () => {
  for (const l of CODE.split('\n')) {
    if (/\b(echo|printf)\b/.test(l)) assert.doesNotMatch(l, /SUPABASE_DB_(PASSWORD|URL)/, l.trim());
    assert.doesNotMatch(l, /set -[a-z]*x|set -o xtrace|bash -x/, l.trim());
  }
});

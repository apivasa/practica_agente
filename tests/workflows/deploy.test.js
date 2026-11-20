// V-05 — QA del workflow de despliegue (.github/workflows/deploy.yml).
// El criterio final (primera publicación accesible en Pages y migraciones
// aplicadas) depende del primer despliegue, que es compuerta del usuario.
// Aquí se verifica estáticamente la estructura y, ejecutando con bash los
// scripts de los pasos, el comportamiento de las compuertas de verify y del
// chequeo de dist/. Sin dependencias de YAML: análisis por indentación.
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

test('deploy.yml: solo se dispara con workflow_dispatch (compuerta del primer despliegue)', () => {
  const on = topBlock('on');
  assert.ok(on, 'falta on:');
  const triggers = on.split('\n').slice(1).filter((l) => /^ {2}[\w-]+:/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
  assert.deepEqual(triggers, ['workflow_dispatch']);
  assert.doesNotMatch(on, /\b(push|pull_request|schedule|workflow_run|pull_request_target)\b/);
});

test('deploy.yml: input confirm obligatorio y sin valor por defecto que habilite', () => {
  const on = topBlock('on');
  assert.match(on, /confirm:\s*\n(\s+.*\n)*?\s+required:\s*true/);
  assert.doesNotMatch(on, /default:\s*['"]?desplegar/);
});

test('deploy.yml: concurrencia sin cancelar un despliegue en curso', () => {
  const c = topBlock('concurrency');
  assert.ok(c, 'falta concurrency:');
  assert.match(c, /cancel-in-progress:\s*false/);
});

// ---------------------------------------------------------------- cadena de jobs

const needsOf = (id) => {
  const m = job(id).match(/^ {4}needs:\s*(.+?)\s*$/m);
  if (!m) return [];
  return m[1].replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean).sort();
};

// ADR 0014 (intento 2): lo barato y reversible (build, verificación de dist/)
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

// docs/despliegue.md lista los 6 secretos de P-02; deploy.yml usa 5:
// SUPABASE_SECRET_KEY no la lee ningún job del despliegue (H-S05-06).
const ALL_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
];
const SECRETS = ALL_SECRETS.filter((s) => s !== 'SUPABASE_SECRET_KEY');
const CODE = TEXT.split('\n').filter((l) => !isComment(l)).join('\n');

test('deploy.yml: ningún job lee SUPABASE_SECRET_KEY (H-S05-06)', () => {
  assert.doesNotMatch(CODE, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(CODE, /sb_secret_\*/);
});

test('verify: recibe los 5 secretos del despliegue como env desde secrets.*', () => {
  const v = job('verify');
  for (const s of SECRETS) assert.match(v, new RegExp(`${s}:\\s*\\$\\{\\{\\s*secrets\\.${s}\\s*\\}\\}`), s);
  assert.match(v, /CONFIRM:\s*\$\{\{\s*inputs\.confirm\s*\}\}/);
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
const GOOD = {
  CONFIRM: 'desplegar',
  GITHUB_REF: 'refs/heads/main',
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKEpublishableVALUE123',
  SUPABASE_ACCESS_TOKEN: 'sbp_FAKEaccessTOKEN0987654321',
  SUPABASE_DB_PASSWORD: 'FAKE-db-password-zz9',
};
const SENSITIVE = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'];
const runVerify = (over) => bash(runScript('verify', 'Confirmación, rama y secretos'), { ...GOOD, ...over });
const assertNoLeak = (out, values = GOOD) => {
  for (const s of SENSITIVE) assert.ok(!out.includes(values[s]), `la salida filtra ${s}`);
};

test('verify (bash): configuración completa en main con confirm=desplegar pasa sin filtrar valores', () => {
  const r = runVerify({});
  assert.equal(r.code, 0, r.out);
  assertNoLeak(r.out);
});

test('verify (bash): no exige SUPABASE_SECRET_KEY (ausente, pasa)', () => {
  const r = runVerify({});
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /SUPABASE_SECRET_KEY/);
});

for (const bad of ['', 'Desplegar', 'desplegar ', 'si', 'desplegarr']) {
  test(`verify (bash): confirm=${JSON.stringify(bad)} se rechaza`, () => {
    const r = runVerify({ CONFIRM: bad });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /no confirmado/);
  });
}

for (const ref of ['refs/heads/item/V-05', 'refs/heads/mainx', 'refs/tags/main', '']) {
  test(`verify (bash): rama ${JSON.stringify(ref)} distinta de main se rechaza`, () => {
    const r = runVerify({ GITHUB_REF: ref });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Solo se despliega desde main/);
  });
}

for (const s of SECRETS) {
  test(`verify (bash): falta ${s} → falla, lo nombra y no filtra los demás`, () => {
    const r = runVerify({ [s]: '' });
    assert.notEqual(r.code, 0);
    assert.match(r.out, new RegExp(`Faltan secretos de producción:.*${s}`));
    assertNoLeak(r.out);
  });
}

test('verify (bash): faltan todos → los 5 se listan', () => {
  const r = runVerify(Object.fromEntries(SECRETS.map((s) => [s, ''])));
  assert.notEqual(r.code, 0);
  for (const s of SECRETS) assert.ok(r.out.includes(s), s);
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

test('verify auth (bash): disable_signup = true pasa, consulta /auth/v1/settings con la clave publicable y no la imprime', () => {
  const r = runAuth('{"disable_signup":true,"external":{"email":true}}');
  assert.equal(r.code, 0, r.out);
  assert.ok(r.args.includes(`${PROD_ORIGIN}/auth/v1/settings`), r.args.join(' '));
  assert.ok(r.args.includes(`apikey: ${GOOD.SUPABASE_PUBLISHABLE_KEY}`));
  assert.ok(r.args.some((a) => /^-[a-zA-Z]*f/.test(a)), 'curl con -f: un 4xx/5xx no pasa como respuesta válida');
  assert.ok(!r.out.includes(GOOD.SUPABASE_PUBLISHABLE_KEY));
});

test('verify auth (bash): con barra final en SUPABASE_URL la ruta no lleva doble barra', () => {
  const r = runAuth('{"disable_signup":true}', { url: `${PROD_ORIGIN}/` });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.args.includes(`${PROD_ORIGIN}/auth/v1/settings`));
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

  test(`${id}: link con project ref, solo token y contraseña de BD, sin credenciales persistidas`, () => {
    const m = job(id);
    assert.match(m, /supabase link --project-ref "\$SUPABASE_PROJECT_REF"/);
    assert.doesNotMatch(m, /SUPABASE_SECRET_KEY|SUPABASE_PUBLISHABLE_KEY/);
    assert.match(m, /persist-credentials:\s*false/);
    assert.match(m, /environment:\s*produccion/);
  });
}

test('deploy.yml: ningún job aplica la semilla, resetea, usa psql ni config push', () => {
  assert.doesNotMatch(CODE, /--include-seed|db reset|psql\b|config push/);
});

test('migrate-plan: solo dry-run, nunca db push real', () => {
  const lines = job('migrate-plan').split('\n');
  assert.ok(lines.some((l) => /supabase db push --dry-run\s*$/.test(l)), 'falta el dry-run');
  assert.ok(!lines.some((l) => /supabase db push\s*$/.test(l)), 'migrate-plan no debe aplicar migraciones');
});

test('migrate: dry-run en un paso previo a db push y migration list después', () => {
  const lines = job('migrate').split('\n');
  const dry = lines.findIndex((l) => /supabase db push --dry-run\s*$/.test(l));
  const push = lines.findIndex((l) => /supabase db push\s*$/.test(l));
  const list = lines.findIndex((l) => /supabase migration list\s*$/.test(l));
  assert.ok(dry >= 0 && push > dry && list > push, `orden dry-run(${dry}) → push(${push}) → list(${list})`);
  assert.ok(lines.slice(dry, push).some((l) => /^\s+- name:/.test(l)), 'dry-run y push en pasos distintos');
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
  assert.ok(runScript('smoke', 'GET de la URL publicada').includes(`apivasa.github.io${base}`));
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

test('smoke (bash): HTML 200 con título y JS principal 200 → pasa al primer intento', () => {
  const r = runSmoke();
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.length, 2, r.calls.join('\n'));
  assert.ok(r.calls[0].includes('https://apivasa.github.io/practica_agente/'));
  assert.ok(r.calls[1].includes('https://apivasa.github.io/practica_agente/assets/index-AbC123.js'), r.calls[1]);
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
  assert.ok(r.calls[0].includes('https://apivasa.github.io/practica_agente/'));
});

// ---------------------------------------------------------------- documentación

test('docs/despliegue.md: documenta disparo manual, secretos, verificación y reversión', () => {
  assert.match(DOC, /desplegar/);
  for (const s of ALL_SECRETS) assert.ok(DOC.includes(s), `docs/despliegue.md no menciona ${s}`);
  assert.match(DOC, /dry-run/);
  assert.match(DOC, /seed\.sql/);
  assert.match(DOC, /[Rr]evers/);
});

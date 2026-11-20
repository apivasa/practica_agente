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

test('deploy.yml: jobs y cadena verify → migrate → build-pages → deploy-pages → smoke', () => {
  assert.deepEqual(JOBS.map((j) => j.id), ['verify', 'migrate', 'build-pages', 'deploy-pages', 'smoke']);
  assert.doesNotMatch(job('verify'), /^\s{4}needs:/m);
  const expected = { migrate: 'verify', 'build-pages': 'migrate', 'deploy-pages': 'build-pages', smoke: 'deploy-pages' };
  for (const [id, dep] of Object.entries(expected)) {
    const m = job(id).match(/^ {4}needs:\s*\[?\s*([\w-]+)\s*\]?\s*$/m);
    assert.ok(m, `${id} sin needs`);
    assert.equal(m[1], dep, `${id} debe depender de ${dep}`);
  }
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

const SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
];

test('verify: recibe los 6 secretos como env desde secrets.*', () => {
  const v = job('verify');
  for (const s of SECRETS) assert.match(v, new RegExp(`${s}:\\s*\\$\\{\\{\\s*secrets\\.${s}\\s*\\}\\}`), s);
  assert.match(v, /CONFIRM:\s*\$\{\{\s*inputs\.confirm\s*\}\}/);
});

test('verify: el script no usa expresiones ${{ }} (sin inyección del input)', () => {
  assert.doesNotMatch(runScript('verify', 'Confirmación, rama y secretos'), /\$\{\{/);
});

test('verify: ninguna línea echo/printf imprime el valor de un secreto', () => {
  const script = runScript('verify', 'Confirmación, rama y secretos');
  for (const l of script.split('\n')) {
    if (!/\b(echo|printf)\b/.test(l)) continue;
    for (const s of SECRETS) {
      assert.doesNotMatch(l, new RegExp(`\\$\\{?${s}\\b`), `imprime ${s}: ${l.trim()}`);
    }
    assert.doesNotMatch(l, /\$\{!name/, `imprime el valor indirecto: ${l.trim()}`);
  }
  assert.doesNotMatch(script, /set -x|set -[a-z]*x/);
});

const REF = 'abcdefghijklmnopqrst';
const GOOD = {
  CONFIRM: 'desplegar',
  GITHUB_REF: 'refs/heads/main',
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKEpublishableVALUE123',
  SUPABASE_SECRET_KEY: 'sb_secret_FAKEsecretVALUE4567890',
  SUPABASE_ACCESS_TOKEN: 'sbp_FAKEaccessTOKEN0987654321',
  SUPABASE_DB_PASSWORD: 'FAKE-db-password-zz9',
};
const runVerify = (over) => bash(runScript('verify', 'Confirmación, rama y secretos'), { ...GOOD, ...over });
const assertNoLeak = (out) => {
  for (const s of ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) {
    assert.ok(!out.includes(GOOD[s]), `la salida filtra ${s}`);
  }
};

test('verify (bash): configuración completa en main con confirm=desplegar pasa sin filtrar valores', () => {
  const r = runVerify({});
  assert.equal(r.code, 0, r.out);
  assertNoLeak(r.out);
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

test('verify (bash): faltan todos → los 6 se listan', () => {
  const r = runVerify(Object.fromEntries(SECRETS.map((s) => [s, ''])));
  assert.notEqual(r.code, 0);
  for (const s of SECRETS) assert.ok(r.out.includes(s), s);
});

test('verify (bash): claves legadas (JWT anon/service_role) se rechazan', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.FAKE.FAKE';
  let r = runVerify({ SUPABASE_PUBLISHABLE_KEY: jwt });
  assert.notEqual(r.code, 0);
  assert.ok(!r.out.includes(jwt));
  r = runVerify({ SUPABASE_SECRET_KEY: jwt });
  assert.notEqual(r.code, 0);
  assert.ok(!r.out.includes(jwt));
});

test('verify (bash): claves intercambiadas (secreta en la publicable) se rechazan', () => {
  const r = runVerify({ SUPABASE_PUBLISHABLE_KEY: GOOD.SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEY: GOOD.SUPABASE_PUBLISHABLE_KEY });
  assert.notEqual(r.code, 0);
  assertNoLeak(r.out);
});

test('verify (bash): SUPABASE_URL que no corresponde al project ref se rechaza', () => {
  let r = runVerify({ SUPABASE_URL: 'https://otroproyectoxxxxxxx.supabase.co' });
  assert.notEqual(r.code, 0);
  r = runVerify({ SUPABASE_URL: `http://${REF}.supabase.co` });
  assert.notEqual(r.code, 0);
  r = runVerify({ SUPABASE_URL: `https://${REF}.supabase.co/` });
  assert.equal(r.code, 0, 'la barra final es aceptable');
});

// ---------------------------------------------------------------- migrate

test('migrate: nunca aplica seed.sql ni resetea la base', () => {
  const m = job('migrate');
  assert.doesNotMatch(m, /--include-seed|seed\.sql|db reset|db seed|--include-all|--debug/);
  assert.doesNotMatch(TEXT.split('\n').filter((l) => !isComment(l)).join('\n'), /--include-seed|db reset|psql\b/);
});

test('migrate: dry-run en un paso anterior a db push', () => {
  const lines = job('migrate').split('\n');
  const dry = lines.findIndex((l) => /supabase db push --dry-run\s*$/.test(l));
  const push = lines.findIndex((l) => /supabase db push\s*$/.test(l) && !/--dry-run/.test(l));
  assert.ok(dry >= 0, 'falta supabase db push --dry-run');
  assert.ok(push >= 0, 'falta supabase db push');
  assert.ok(dry < push, 'el dry-run debe ir antes de db push');
  const stepsBetween = lines.slice(dry, push).filter((l) => /^\s+- name:/.test(l)).length;
  assert.ok(stepsBetween >= 1, 'dry-run y push deben ser pasos distintos');
});

test('migrate: link con project ref y solo token/contraseña de BD (no la clave secreta)', () => {
  const m = job('migrate');
  assert.match(m, /supabase link --project-ref "\$SUPABASE_PROJECT_REF"/);
  assert.doesNotMatch(m, /SUPABASE_SECRET_KEY|SUPABASE_PUBLISHABLE_KEY/);
  assert.match(m, /persist-credentials:\s*false/);
});

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

// ---------------------------------------------------------------- documentación

test('docs/despliegue.md: documenta disparo manual, secretos, verificación y reversión', () => {
  assert.match(DOC, /desplegar/);
  for (const s of SECRETS) assert.ok(DOC.includes(s), `docs/despliegue.md no menciona ${s}`);
  assert.match(DOC, /dry-run/);
  assert.match(DOC, /seed\.sql/);
  assert.match(DOC, /[Rr]evers/);
});

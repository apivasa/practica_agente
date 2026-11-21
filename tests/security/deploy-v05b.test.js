// V-05b — Seguridad del despliegue continuo (push a main) y de la cadena
// --db-url sin token de cuenta (H-V05-01). Categoría 5 (Actions) y 2 (Auth).
// Pruebas activas: ejecuta con bash el script de la URL y los pasos de verify
// con entradas hostiles. Sin dependencias ni red (curl se sustituye por un
// falso en PATH). Nunca toca producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT_PATH = join(ROOT, 'scripts', 'ci', 'db-url.sh');
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CODE = code(WF);
const HEADER = CODE.split(/^jobs:/m)[0];

const REF = 'abcdefghijklmnopqrst';
const HOST = 'aws-0-us-east-1.pooler.supabase.com';
const PASS = 'FAKE-p@ss/w:rd%#?&';

// ------------------------------------------------------------------ utilidades

function jobs() {
  const body = WF.split(/^jobs:\s*$/m)[1];
  const out = {};
  let name = null;
  for (const l of body.split('\n')) {
    const m = l.match(/^ {2}([\w-]+):\s*$/);
    if (m) { name = m[1]; out[name] = ''; continue; }
    if (name) out[name] += `${l}\n`;
  }
  return out;
}
const JOBS = jobs();

function needsOf(job) {
  const m = JOBS[job].match(/^ {4}needs:\s*(.+)$/m);
  if (!m) return [];
  return m[1].replace(/[[\]\s]/g, '').split(',').filter(Boolean);
}

function stepScript(stepName) {
  const lines = WF.split('\n');
  const s = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  assert.ok(s >= 0, `no existe el paso ${stepName}`);
  const r = lines.findIndex((l, i) => i > s && /^\s+run:\s*\|\s*$/.test(l));
  const base = lines[r].match(/^ */)[0].length;
  const body = [];
  for (let i = r + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && lines[i].match(/^ */)[0].length <= base) break;
    body.push(lines[i].slice(base + 2));
  }
  return body.join('\n');
}

function dbUrl(env, prelude = '') {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; ${prelude} . "${SCRIPT_PATH}"; supabase_db_url; printf 'URL=%s\\n' "$SUPABASE_DB_URL"`], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const OK_ENV = { SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST };

// ------------------------------------------------- 5 · disparadores del workflow

test('5 · deploy.yml: push solo a la rama main (sin tags, sin comodines, sin branches-ignore)', () => {
  const push = HEADER.match(/^ {2}push:\n((?: {4,}.*\n?)*)/m);
  assert.ok(push, 'deploy.yml sin on.push');
  const block = push[1];
  assert.match(block, /^ {4}branches:\s*\[\s*main\s*\]\s*$/m);
  const keys = [...block.matchAll(/^ {4}([\w-]+):/gm)].map((k) => k[1]).sort();
  assert.deepEqual(keys, ['branches', 'paths-ignore'], `on.push con claves de más: ${keys}`);
});

test('5 · deploy.yml: ningún disparador que ejecute código o datos de terceros con secretos', () => {
  assert.doesNotMatch(HEADER, /^ {2}(pull_request|pull_request_target|workflow_run|issue_comment|issues|repository_dispatch|discussion|fork|release|create|delete|workflow_call|merge_group|schedule):/m);
});

test('5 · deploy.yml: paths-ignore solo excluye documentación (nunca código, migraciones ni workflows)', () => {
  const m = HEADER.match(/^ {4}paths-ignore:\n((?: {6,}- .*\n?)*)/m);
  if (!m) return;
  const patterns = [...m[1].matchAll(/- '([^']+)'|- "([^"]+)"|- (\S+)/g)].map((x) => x[1] ?? x[2] ?? x[3]);
  assert.deepEqual(patterns.sort(), ['**/*.md', 'docs/**'].sort(), `paths-ignore cambió: ${patterns}`);
  assert.doesNotMatch(HEADER, /^ {4}paths:/m, 'paths: (lista blanca) dejaría cambios sin desplegar');
});

test('5 · el build no consume ningún .md (paths-ignore no deja el front desactualizado)', () => {
  const vite = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(vite + html, /\.md\b/);
});

test('5 · deploy.yml: un despliegue nunca se cancela a medias (concurrency sin cancel-in-progress)', () => {
  assert.match(HEADER, /^concurrency:\n {2}group:\s*\S+\n {2}cancel-in-progress:\s*false\s*$/m);
});

// --------------------------------------------- 5 · verify no se puede saltar

test('5 · deploy.yml: todo job distinto de verify depende (transitivamente) de verify', () => {
  const reach = (j, seen = new Set()) => {
    for (const n of needsOf(j)) { if (!seen.has(n)) { seen.add(n); reach(n, seen); } }
    return seen;
  };
  for (const j of Object.keys(JOBS)) {
    if (j === 'verify') continue;
    assert.ok(reach(j).has('verify'), `el job ${j} no depende de verify`);
  }
  assert.ok(reach('migrate').has('migrate-plan'), 'migrate sin dry-run previo');
  assert.ok(reach('deploy-pages').has('migrate'), 'Pages antes que las migraciones');
});

test('5 · deploy.yml: sin continue-on-error ni if: always()/failure()/!cancelled() que salten un fallo', () => {
  assert.doesNotMatch(CODE, /continue-on-error:\s*true/);
  assert.doesNotMatch(CODE, /^\s+if:.*(always\(\)|failure\(\)|cancelled\(\))/m);
  assert.doesNotMatch(JOBS.verify, /^\s+if:/m, 'verify tiene pasos condicionales');
});

const GOOD = {
  GITHUB_REF: 'refs/heads/main',
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKEpublishableVALUE123',
  SUPABASE_DB_PASSWORD: 'FAKE-db-password-zz9',
  SUPABASE_DB_POOLER_HOST: HOST,
};
const runVerify = (env) => {
  const r = spawnSync('bash', ['-c', stepScript('Confirmación, rama y secretos')], {
    env: { PATH: process.env.PATH, ...GOOD, ...env }, encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

for (const [event, ref] of [
  ['pull_request', 'refs/pull/1/merge'],
  ['pull_request_target', 'refs/heads/main'],
  ['schedule', 'refs/heads/main'],
  ['workflow_run', 'refs/heads/main'],
  ['repository_dispatch', 'refs/heads/main'],
  ['', 'refs/heads/main'],
  ['PUSH', 'refs/heads/main'],
]) {
  test(`5 · verify: evento "${event}" sin confirm no se exime (solo push exacto)`, () => {
    const r = runVerify({ GITHUB_EVENT_NAME: event, GITHUB_REF: ref, CONFIRM: '' });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /Despliegue no confirmado/);
  });
}

for (const ref of ['refs/tags/v1', 'refs/heads/main-evil', 'refs/heads/feature/main', 'refs/pull/3/merge', 'refs/heads/main\n']) {
  test(`5 · verify: push con ref ${JSON.stringify(ref)} se rechaza`, () => {
    const r = runVerify({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: ref });
    assert.notEqual(r.code, 0, r.out);
  });
}

test('5 · verify: workflow_dispatch con confirm casi igual se rechaza', () => {
  for (const c of ['Desplegar', 'desplegar ', ' desplegar', 'desplegar\n', 'desplegar*']) {
    assert.notEqual(runVerify({ GITHUB_EVENT_NAME: 'workflow_dispatch', CONFIRM: c }).code, 0, JSON.stringify(c));
  }
});

test('5 · verify: en push, un ref con caracteres de glob no casa con la URL (case con comillas)', () => {
  const r = runVerify({ GITHUB_EVENT_NAME: 'push', SUPABASE_PROJECT_REF: '*', SUPABASE_URL: 'https://evil.example.com' });
  assert.notEqual(r.code, 0, r.out);
});

test('5 · verify: no imprime valores de secretos ni en éxito ni en error', () => {
  const secrets = [GOOD.SUPABASE_DB_PASSWORD, GOOD.SUPABASE_PUBLISHABLE_KEY, REF];
  for (const env of [
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_EVENT_NAME: 'push', SUPABASE_PUBLISHABLE_KEY: 'legacy-anon-key' },
    { GITHUB_EVENT_NAME: 'push', SUPABASE_URL: 'https://otro.supabase.co' },
    { GITHUB_EVENT_NAME: 'push', SUPABASE_DB_POOLER_HOST: 'evil.example.com' },
  ]) {
    const r = runVerify(env);
    for (const s of secrets) assert.ok(!r.out.includes(s), `verify imprime un secreto con ${JSON.stringify(env)}`);
  }
});

// ------------------------------- 2/5 · registro cerrado (con curl falso en PATH)

function runSignup(body, { curlFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v05b-curl-'));
  const fake = join(dir, 'curl');
  writeFileSync(fake, curlFails ? '#!/bin/sh\nexit 22\n' : `#!/bin/sh\nprintf '%s' '${body}'\n`);
  chmodSync(fake, 0o755);
  const r = spawnSync('bash', ['-c', stepScript('Registro cerrado en Auth')], {
    env: { PATH: `${dir}:${process.env.PATH}`, SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: GOOD.SUPABASE_PUBLISHABLE_KEY },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('2 · registro cerrado: disable_signup=true pasa', () => {
  assert.equal(runSignup('{"disable_signup":true}').code, 0);
});

for (const [label, body] of [
  ['disable_signup=false', '{"disable_signup":false}'],
  ['sin la clave', '{"external":{"email":true}}'],
  ['null', '{"disable_signup":null}'],
  ['respuesta no JSON', '<html>pausado</html>'],
  ['vacía', ''],
]) {
  test(`2 · registro cerrado: ${label} bloquea el despliegue`, () => {
    const r = runSignup(body);
    assert.notEqual(r.code, 0, r.out);
    assert.ok(!r.out.includes(GOOD.SUPABASE_PUBLISHABLE_KEY));
  });
}

test('2 · registro cerrado: si /auth/v1/settings falla, se bloquea', () => {
  assert.notEqual(runSignup('', { curlFails: true }).code, 0);
});

// ------------------------------------------- 5 · db-url.sh con entradas hostiles

for (const host of [
  `${HOST}\nevil.example.com`,
  `evil.example.com\n${HOST}`,
  `${HOST} `,
  `${HOST}:6543`,
  `${HOST}/x`,
  `u@${HOST}`,
  `${HOST}?host=evil.example.com`,
  'aws-0-us-east-1.pooler.supabase.com.',
  'aws-0-us-east-1-pooler.supabase.com',
  'aws-0-us-east-1.poolerXsupabase.com',
  'AWS-0-US-EAST-1.POOLER.SUPABASE.COM',
  '$(touch /tmp/pwned).pooler.supabase.com',
]) {
  test(`5 · db-url: host hostil ${JSON.stringify(host)} se rechaza sin construir la URL`, () => {
    const r = dbUrl({ ...OK_ENV, SUPABASE_DB_POOLER_HOST: host });
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /URL=|add-mask/);
    assert.ok(!r.out.includes(PASS) && !r.err.includes(PASS));
  });
}

for (const ref of [`${REF}\n`, `${REF}@evil.example.com`, `${REF.slice(0, 19)}:`, `${REF}x`, 'ABCDEFGHIJKLMNOPQRST', `${REF.slice(0, 19)}.`]) {
  test(`5 · db-url: ref hostil ${JSON.stringify(ref)} se rechaza`, () => {
    const r = dbUrl({ ...OK_ENV, SUPABASE_PROJECT_REF: ref });
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /URL=/);
  });
}

for (const pass of [
  'p@ss:w/rd?#%',
  'línea1\nlínea2',
  'x\n::add-mask::nada\n::set-output name=a::b',
  '::stop-commands::tok',
  "comilla'doble\"$(id)`id`",
  ' espacio inicial y final ',
]) {
  test(`5 · db-url: contraseña ${JSON.stringify(pass)} se codifica, no inyecta comandos de workflow y no altera host/usuario`, () => {
    const r = dbUrl({ ...OK_ENV, SUPABASE_DB_PASSWORD: pass });
    assert.equal(r.code, 0, r.out + r.err);
    const lines = r.out.split('\n').filter(Boolean);
    const masks = lines.filter((l) => l.startsWith('::add-mask::'));
    assert.equal(masks.length, 2, `líneas de salida inesperadas:\n${r.out}`);
    assert.equal(lines.length, 3, `salida inesperada:\n${r.out}`);
    for (const m of masks) assert.doesNotMatch(m.slice('::add-mask::'.length), /[\s'"`$]/);
    const url = new URL(lines.find((l) => l.startsWith('URL=')).slice(4));
    assert.equal(url.hostname, HOST);
    assert.equal(url.username, `postgres.${REF}`);
    assert.equal(url.port, '5432');
    assert.equal(decodeURIComponent(url.password), pass);
    assert.ok(!r.err.includes(pass));
  });
}

test('5 · db-url: la contraseña enmascarada sale antes que la URL (máscara antes del primer uso)', () => {
  const r = dbUrl(OK_ENV);
  const lines = r.out.split('\n');
  const enc = encodeURIComponent(PASS).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const iPass = lines.indexOf(`::add-mask::${enc}`);
  const iUrl = lines.findIndex((l) => l.startsWith('::add-mask::postgresql://'));
  assert.ok(iPass >= 0, `no enmascara la contraseña codificada:\n${r.out}`);
  assert.ok(iPass < iUrl);
});

test('5 · db-url: sin efectos fuera del paso (no escribe GITHUB_ENV, GITHUB_OUTPUT ni ficheros)', () => {
  const c = code(SCRIPT);
  assert.doesNotMatch(c, /GITHUB_(ENV|OUTPUT|STEP_SUMMARY|PATH)|\btee\b/);
  for (const l of c.split('\n')) {
    const noStrings = l.replace(/"[^"]*"/g, '""');
    assert.doesNotMatch(noStrings, /\d?>{1,2}\s*(?!\/dev\/null|&)\S/, `redirección a fichero: ${l.trim()}`);
  }
});

// --------------------------------------------- 5 · fugas por trazas o depuración

test('5 · deploy.yml y db-url.sh: sin set -x, xtrace, bash -x, --debug ni volcado del entorno', () => {
  for (const [name, text] of [['deploy.yml', CODE], ['db-url.sh', code(SCRIPT)]]) {
    assert.doesNotMatch(text, /set\s+-[a-wyz]*x|set\s+-o\s+xtrace|bash\s+-x|shell:\s*bash\s+-[a-z]*x|--debug|\bprintenv\b|^\s*env\s*$|\bdeclare\s+-p\b|\bset\s*$/m, name);
    for (const l of text.split('\n')) {
      // Permitido: la máscara y la codificación por tubería a jq (no llega al log).
      if (/::add-mask::/.test(l) || /\$\(printf '%s' "\$pass" \| jq -sRr @uri\)/.test(l)) continue;
      assert.doesNotMatch(l, /\b(echo|printf|cat)\b[^\n]*\$\{?(SUPABASE_DB_(URL|PASSWORD)|pass|encoded)\b/, `${name} imprime la cadena o la contraseña: ${l.trim()}`);
    }
  }
  assert.doesNotMatch(CODE, /ACTIONS_(STEP|RUNNER)_DEBUG/);
});

test('5 · deploy.yml: la contraseña de la BD solo llega a pasos run (nunca a una acción de terceros ni a env de job)', () => {
  const steps = CODE.split(/^\s+- (?=name:|uses:|id:)/m);
  for (const s of steps) {
    if (!/secrets\.SUPABASE_DB_PASSWORD/.test(s)) continue;
    assert.doesNotMatch(s, /^\s*uses:|\n\s+uses:/, `una acción recibe SUPABASE_DB_PASSWORD:\n${s}`);
  }
  for (const [name, body] of Object.entries(JOBS)) {
    assert.doesNotMatch(body, /^ {4}env:/m, `job ${name} con env a nivel de job`);
  }
  assert.doesNotMatch(HEADER, /^env:/m, 'env a nivel de workflow');
});

test('5 · deploy.yml: la contraseña de la BD solo en jobs de migraciones y verify, todos en produccion', () => {
  for (const [name, body] of Object.entries(JOBS)) {
    if (!/secrets\.SUPABASE_DB_PASSWORD/.test(body)) continue;
    assert.ok(['verify', 'migrate-plan', 'migrate'].includes(name), `job ${name} lee SUPABASE_DB_PASSWORD`);
    assert.match(body, /^ {4}environment:\s*produccion\s*$/m);
    assert.match(body, /^ {4}permissions:\n {6}contents:\s*read\s*$/m);
  }
});

test('5 · deploy.yml: sin token de cuenta, sin link y sin clave secreta (H-V05-01, H-S05-06)', () => {
  assert.doesNotMatch(CODE, /SUPABASE_ACCESS_TOKEN|sbp_|supabase\s+link|SUPABASE_SECRET_KEY|config\s+push/);
});

test('5 · deploy.yml: db push nunca contra el stack local ni con --linked/--local', () => {
  for (const l of CODE.split('\n').filter((x) => /supabase\s+(db\s+push|migration\s+list)/.test(x))) {
    assert.doesNotMatch(l, /--linked|--local|--include-seed|--include-all/, l.trim());
    assert.match(l, /--db-url "\$SUPABASE_DB_URL"/);
  }
});

// ------------------------------------------------------- 2 · config.toml

test('2 · config.toml: contraseña mínima 12 con minúsculas, mayúsculas y dígitos (H-S03-02)', () => {
  const toml = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
  const auth = code(toml).split(/^\[auth\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const len = auth.match(/^minimum_password_length\s*=\s*(\d+)\s*$/m);
  assert.ok(len && Number(len[1]) >= 12, 'minimum_password_length < 12');
  assert.match(auth, /^password_requirements\s*=\s*"(lower_upper_letters_digits|lower_upper_letters_digits_symbols)"\s*$/m);
});

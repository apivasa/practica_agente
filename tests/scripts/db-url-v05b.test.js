// V-05b (desarrollador): cadena --db-url sin token de cuenta y despliegue
// continuo en push a main. Ejecuta con bash scripts/ci/db-url.sh y el paso de
// verify de deploy.yml; sin dependencias de YAML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'ci', 'db-url.sh');
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const CODE = WF.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const REF = 'abcdefghijklmnopqrst';
const HOST = 'aws-0-us-east-1.pooler.supabase.com';
const PASS = 'FAKE p@ss/word:%#?&-zz9';

function dbUrl(env) {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; . "${SCRIPT}"; supabase_db_url; printf 'URL=%s\\n' "$SUPABASE_DB_URL"`], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('db-url: construye la URL del pooler de sesión con la contraseña codificada', () => {
  const r = dbUrl({ SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST });
  assert.equal(r.code, 0, r.out + r.err);
  const line = r.out.split('\n').find((l) => l.startsWith('URL='));
  const url = new URL(line.slice(4));
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.username, `postgres.${REF}`);
  assert.equal(decodeURIComponent(url.password), PASS);
  assert.equal(url.hostname, HOST);
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/postgres');
});

test('db-url: enmascara la contraseña codificada y la URL antes de usarlas y no imprime la contraseña en claro', () => {
  const r = dbUrl({ SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST });
  const lines = r.out.split('\n').filter((l) => !l.startsWith('URL='));
  assert.equal(lines.filter((l) => l.startsWith('::add-mask::')).length, 2);
  assert.ok(lines.some((l) => l.startsWith('::add-mask::postgresql://')));
  for (const l of lines) {
    if (l.startsWith('::add-mask::') || l === '') continue;
    assert.fail(`salida inesperada: ${l}`);
  }
  assert.ok(!r.out.includes(PASS));
});

for (const missing of ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_POOLER_HOST']) {
  test(`db-url: sin ${missing} falla, lo nombra y no filtra la contraseña`, () => {
    const env = { SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST, [missing]: '' };
    const r = dbUrl(env);
    assert.notEqual(r.code, 0);
    assert.match(r.out, new RegExp(missing));
    assert.ok(!r.out.includes(PASS) && !r.out.includes(encodeURIComponent(PASS)));
  });
}

for (const host of ['evil.example.com', 'aws-0-us-east-1.pooler.supabase.com.evil.io', `db.${REF}.supabase.co`, 'x.aws-0-us-east-1.pooler.supabase.com']) {
  test(`db-url: host ${host} se rechaza (la contraseña no sale a otro host)`, () => {
    const r = dbUrl({ SUPABASE_PROJECT_REF: REF, SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: host });
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /URL=/);
  });
}

test('db-url: project ref con formato inválido se rechaza', () => {
  const r = dbUrl({ SUPABASE_PROJECT_REF: 'abc@evil', SUPABASE_DB_PASSWORD: PASS, SUPABASE_DB_POOLER_HOST: HOST });
  assert.notEqual(r.code, 0);
});

// ------------------------------------------------------------- deploy.yml

test('deploy.yml: se dispara en push a main y por workflow_dispatch', () => {
  const on = WF.slice(WF.indexOf('\non:'), WF.indexOf('\npermissions:'));
  assert.match(on, /^ {2}workflow_dispatch:/m);
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]/m);
  assert.doesNotMatch(on, /^ {2}(pull_request|pull_request_target|workflow_run|schedule):/m);
});

test('deploy.yml: ningún job lee SUPABASE_ACCESS_TOKEN ni usa supabase link (H-V05-01)', () => {
  assert.doesNotMatch(CODE, /SUPABASE_ACCESS_TOKEN|supabase link/);
});

test('deploy.yml: todo db push / migration list va por --db-url tras construir la cadena', () => {
  const cmds = CODE.split('\n').filter((l) => /supabase\s+(db\s+push|migration\s+list)\b/.test(l));
  assert.equal(cmds.length, 4);
  for (const l of cmds) assert.match(l, /--db-url "\$SUPABASE_DB_URL"/);
  const steps = CODE.split(/^\s+- (?=name:|uses:)/m).filter((s) => /supabase\s+(db\s+push|migration\s+list)/.test(s));
  for (const s of steps) {
    assert.match(s, /\. scripts\/ci\/db-url\.sh\n\s+supabase_db_url\n/);
    assert.match(s, /SUPABASE_DB_POOLER_HOST:\s*\$\{\{\s*vars\.SUPABASE_DB_POOLER_HOST\s*\}\}/);
  }
});

function verifyScript() {
  const lines = WF.split('\n');
  const s = lines.findIndex((l) => l.includes('- name: Confirmación, rama y secretos'));
  const r = lines.findIndex((l, i) => i > s && /^\s+run:\s*\|\s*$/.test(l));
  const base = lines[r].match(/^ */)[0].length;
  const body = [];
  for (let i = r + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && lines[i].match(/^ */)[0].length <= base) break;
    body.push(lines[i].slice(base + 2));
  }
  return body.join('\n');
}

const GOOD = {
  GITHUB_REF: 'refs/heads/main',
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKEpublishableVALUE123',
  SUPABASE_DB_PASSWORD: 'FAKE-db-password-zz9',
  SUPABASE_DB_POOLER_HOST: HOST,
};
const verify = (env) => {
  const r = spawnSync('bash', ['-c', verifyScript()], { env: { PATH: process.env.PATH, ...GOOD, ...env }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('verify: push a main pasa sin confirm', () => {
  const r = verify({ GITHUB_EVENT_NAME: 'push', CONFIRM: '' });
  assert.equal(r.code, 0, r.out);
});

test('verify: workflow_dispatch sigue exigiendo confirm=desplegar', () => {
  assert.notEqual(verify({ GITHUB_EVENT_NAME: 'workflow_dispatch', CONFIRM: '' }).code, 0);
  assert.equal(verify({ GITHUB_EVENT_NAME: 'workflow_dispatch', CONFIRM: 'desplegar' }).code, 0);
});

test('verify: push desde otra rama se rechaza aunque no haya confirm', () => {
  const r = verify({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/item/V-05b' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Solo se despliega desde main/);
});

test('verify: en push también exige secretos y host del pooler válido', () => {
  assert.notEqual(verify({ GITHUB_EVENT_NAME: 'push', SUPABASE_DB_PASSWORD: '' }).code, 0);
  assert.notEqual(verify({ GITHUB_EVENT_NAME: 'push', SUPABASE_DB_POOLER_HOST: '' }).code, 0);
  assert.notEqual(verify({ GITHUB_EVENT_NAME: 'push', SUPABASE_DB_POOLER_HOST: 'evil.example.com' }).code, 0);
});

test('verify: el registro cerrado en Auth se comprueba en ambos disparadores (sin if: por evento)', () => {
  const v = WF.slice(WF.indexOf('\n  verify:'), WF.indexOf('\n  build-pages:'));
  assert.match(v, /- name: Registro cerrado en Auth/);
  assert.doesNotMatch(v, /^\s+if:/m);
});

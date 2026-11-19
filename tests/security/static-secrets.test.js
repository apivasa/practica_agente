// S-01 — Ningún secreto en el código del front ni en el build estático
// (categorías 4 y 6). Complementa a gitleaks: este chequeo mira dist/, que no
// está versionado y por eso gitleaks no lo ve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Los patrones se arman por partes para que este archivo no sea, él mismo,
// un falso positivo de gitleaks/semgrep.
const PATTERNS = [
  ['clave secreta de Supabase', new RegExp('sb_' + 'secret_[A-Za-z0-9_-]{10,}')],
  ['JWT (clave legada anon/service_role)', new RegExp('ey' + 'J[A-Za-z0-9_-]{10,}\\.ey' + 'J[A-Za-z0-9_-]{10,}\\.')],
  ['token de GitHub', new RegExp('gh' + '[pousr]_[A-Za-z0-9]{36}')],
  ['token fine-grained de GitHub', new RegExp('github' + '_pat_[A-Za-z0-9_]{22,}')],
  ['clave privada PEM', new RegExp('-----BEGIN [A-Z ]*PRIV' + 'ATE KEY-----')],
  ['clave de acceso AWS', new RegExp('AK' + 'IA[0-9A-Z]{16}')],
  ['nombre de variable secreta en el front', new RegExp('SUPABASE_' + '(SECRET|SERVICE_ROLE)_KEY')],
];

const TEXT_EXT = /\.(js|mjs|cjs|html|css|json|map|txt|svg|webmanifest)$/;

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : TEXT_EXT.test(p) ? [p] : [];
  });
};

const scan = (files) => {
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const [label, re] of PATTERNS) {
      if (re.test(text)) hits.push(`${relative(ROOT, f)}: ${label}`);
    }
  }
  return hits;
};

test('los patrones detectan secretos sembrados (autoverificación)', () => {
  const samples = [
    'sb_' + 'secret_' + 'x'.repeat(24),
    'ey' + 'JhbGciOiJIUzI1NiJ9.ey' + 'Jyb2xlIjoic2VydmljZV9yb2xlIn0.firma',
    'gh' + 'p_' + 'A'.repeat(36),
    '-----BEGIN RSA PRIV' + 'ATE KEY-----',
    'SUPABASE_' + 'SECRET_KEY',
  ];
  for (const s of samples) {
    assert.ok(PATTERNS.some(([, re]) => re.test(s)), `patrón no detecta: ${s.slice(0, 12)}…`);
  }
  // La clave publicable sí puede estar en el front.
  assert.ok(!PATTERNS.some(([, re]) => re.test('sb_publishable_' + 'x'.repeat(24))));
});

test('código fuente del front sin secretos (src/, engine/, index.html, .env.example)', () => {
  const files = [
    ...walk(join(ROOT, 'src')),
    ...walk(join(ROOT, 'engine')),
    join(ROOT, 'index.html'),
    join(ROOT, 'vite.config.js'),
  ].filter((f) => existsSync(f));
  assert.ok(files.length > 0);
  assert.deepEqual(scan(files), []);
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
  for (const line of envExample.split('\n').filter((l) => /^\s*[A-Z_]+=/.test(l))) {
    const [key, value] = line.split('=');
    assert.match(key.trim(), /^VITE_SUPABASE_(URL|PUBLISHABLE_KEY)$/, `.env.example declara ${key}`);
    assert.equal(value.trim(), '', `.env.example no debe traer valores (${key})`);
  }
});

test('build estático dist/ sin secretos', () => {
  const dist = join(ROOT, 'dist');
  if (process.env.SECURITY_REQUIRE_DIST === '1') {
    assert.ok(existsSync(dist), 'seguridad.yml construye dist/ antes de esta prueba');
  }
  // En ci.yml las pruebas unitarias corren antes del build: allí dist/ puede no
  // existir y este caso solo verifica lo que haya. En seguridad.yml es obligatorio.
  const files = walk(dist);
  if (process.env.SECURITY_REQUIRE_DIST === '1') assert.ok(files.length > 0, 'dist/ vacío');
  assert.deepEqual(scan(files), []);
});

// F-08 — Regresión de las alertas CodeQL `js/incomplete-url-substring-sanitization`
// (categoría 6, SAST). Una URL o un host no se valida por subcadena
// (`url.startsWith(SUPA)`, `detail.includes('github.io')`): `https://x.supabase.co.evil`
// o `https://evil/?https://x.supabase.co` pasarían. Se compara el origen parseado
// (`new URL(u).origin === ...`). Esta prueba falla si el patrón vuelve en cualquier
// JS del repo (app, scripts, motor y pruebas), para que no llegue a `main` aunque nadie
// mire el check de CodeQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const DIRS = ['src', 'scripts', 'engine', 'tests', 'e2e'];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(p);
    return /\.(m?js|ts)$/.test(d.name) ? [p] : [];
  });
}

const PATTERNS = [
  // literal con esquema: x.startsWith('https://...'), x.includes("http://...")
  /\.(includes|startsWith|indexOf)\(\s*['"`]https?:\/\//,
  // literal con forma de host: x.includes('github.io'), x.endsWith('.supabase.co')
  /\.(includes|startsWith|endsWith|indexOf)\(\s*['"`][a-z0-9.-]*[a-z0-9-]\.(co|io|com|org|net|app|dev|test)(['"`/:]|$)/i,
  // constante de URL: x.startsWith(SUPA), String(u).includes(PAGES_URL)
  /\.(includes|startsWith|indexOf)\(\s*(SUPA|PAGES|[A-Z_]*_(URL|ORIGIN|HOST))\s*\)/,
];

test('F-08: ningún JS compara URLs u hosts por subcadena', () => {
  const offenders = [];
  for (const file of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
    if (file === SELF) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (PATTERNS.some((re) => re.test(line))) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `comparar por origen parseado (new URL(u).origin):\n${offenders.join('\n')}`);
});

test('F-08: el detector reconoce los patrones de las alertas originales', () => {
  const samples = [
    "assert.ok(!calls.some((c) => c.url.startsWith(SUPA)));",
    "status: String(url).startsWith(SUPA) ? 540 : 200",
    "assert.ok(!r.detail.includes('github.io'));",
    "if (host.endsWith('.supabase.co')) ok();",
    "if (u.indexOf('https://apivasa.github.io') === 0) ok();",
  ];
  for (const s of samples) assert.ok(PATTERNS.some((re) => re.test(s)), `no detecta: ${s}`);
  for (const ok of ["new URL(u).origin === new URL(SUPA).origin", "f.endsWith('.sql')", "spec.startsWith('./')"]) {
    assert.ok(!PATTERNS.some((re) => re.test(ok)), `falso positivo: ${ok}`);
  }
});

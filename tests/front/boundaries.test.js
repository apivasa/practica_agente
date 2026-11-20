// Arquitectura (V-01..V-03): el front no importa de scripts/ (Actions); lo compartido vive en engine/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsFiles(p);
    return /\.(m?js)$/.test(name) ? [p] : [];
  });
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

test('ningún archivo de src/ importa de scripts/', () => {
  const offenders = [];
  for (const file of jsFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (/(^|\/)scripts\//.test(spec)) offenders.push(`${relative(ROOT, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('engine/ no importa de src/ ni de scripts/', () => {
  const offenders = [];
  for (const file of jsFiles(join(ROOT, 'engine'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('./')) offenders.push(`${relative(ROOT, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

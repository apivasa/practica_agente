// V-05c — QA (re-revisión de V-05b). Criterio: en push a main, `verify` de
// deploy.yml espera a que el CI del MISMO SHA termine en success; y el
// criterio de V-05b sigue en pie: "un merge a main despliega".
// Para que las dos frases se cumplan juntas, cada push a main que dispara el
// despliegue tiene que producir un run de CI de ese SHA que llegue a terminar
// (no cancelado por el commit siguiente). Sin dependencias: análisis de texto
// de ci.yml / deploy.yml y ejecución de wait-ci.sh con un `gh` falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CI = strip(read('.github/workflows/ci.yml'));
const DEPLOY = strip(read('.github/workflows/deploy.yml'));
const WAIT = join(ROOT, 'scripts', 'ci', 'wait-ci.sh');

/** Bloque de nivel superior `key:` (hasta la siguiente clave de nivel 0). */
function topBlock(text, key) {
  const lines = text.split('\n');
  const s = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
  if (s < 0) return null;
  const out = [lines[s]];
  for (let i = s + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

/**
 * ¿La concurrencia del workflow cancela un run de CI en main cuando llega
 * otro commit a main? Evalúa las formas usuales: literal true/false y
 * `${{ github.ref != 'refs/heads/main' }}` / `==`. Si el grupo distingue
 * por commit o por run (github.sha, github.run_id) no hay cancelación entre
 * commits distintos.
 */
function cancelsOnMain(text) {
  const conc = topBlock(text, 'concurrency');
  if (!conc) return false;
  const group = (conc.match(/group:\s*(.+)/) || [])[1] || '';
  if (/github\.(sha|run_id)/.test(group)) return false;
  const raw = ((conc.match(/cancel-in-progress:\s*(.+)/) || [])[1] || 'false').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const m = raw.match(/^\$\{\{\s*github\.ref\s*(==|!=)\s*'([^']+)'\s*\}\}$/);
  if (m) {
    const eq = m[2] === 'refs/heads/main';
    return m[1] === '==' ? eq : !eq;
  }
  throw new Error(`cancel-in-progress no evaluable por la prueba: ${raw}`);
}

test('V-05c: ci.yml corre en todo push a main (sin paths/paths-ignore): cada despliegue por push tiene un CI de su SHA que esperar', () => {
  const on = topBlock(CI, 'on');
  assert.ok(on, 'ci.yml sin bloque on');
  const push = on.split('\n').slice(on.split('\n').findIndex((l) => /^\s{2}push:/.test(l)));
  const pushBlock = [];
  for (const l of push.slice(1)) { if (/^\s{0,2}\S/.test(l)) break; pushBlock.push(l); }
  const txt = pushBlock.join('\n');
  assert.match(txt, /branches:\s*\[[^\]]*\bmain\b/, 'CI debe dispararse en push a main');
  assert.doesNotMatch(txt, /paths(-ignore)?:/, 'un filtro de rutas en CI dejaría despliegues esperando 20 min un CI que nunca aparece');
});

test('V-05c + V-05b: el CI de un merge a main no se cancela cuando el orquestador sube enseguida un commit de docs (latido/candado)', () => {
  // Hechos: deploy.yml ignora los push solo de docs (paths-ignore), así que el
  // commit de latido no redespliega; y wait-ci.sh falla si el CI del SHA del
  // merge termina `cancelled`. Si CI cancela en main, el merge NO se despliega
  // y deploy-main de salud.yml queda en rojo. En main ya pasó con #49, #50 y
  // #52 (runs de CI cancelled por el commit de docs siguiente).
  assert.match(DEPLOY, /paths-ignore:\s*\n\s*- 'docs\/\*\*'/, 'premisa: deploy ignora docs');
  assert.equal(cancelsOnMain(CI), false,
    'ci.yml cancela en main el run del commit anterior (cancel-in-progress): con V-05c el merge queda sin desplegar');
});

// --- wait-ci.sh: bordes del filtro por workflow no cubiertos por el desarrollador ---

const SHA = 'b'.repeat(40);
function waitCi(json) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-v05c-'));
  try {
    writeFileSync(join(dir, 'r'), json);
    writeFileSync(join(dir, 'gh'), `#!/bin/bash\ncat "${dir}/r"\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const r = spawnSync('bash', [WAIT], {
      env: {
        PATH: `${dir}:${process.env.PATH}`, GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'o/r',
        HEAD_SHA: SHA, GH_TOKEN: 'x', CI_WAIT_TIMEOUT_SECONDS: '0', CI_WAIT_INTERVAL_SECONDS: '0',
      },
      encoding: 'utf8',
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Fixtures realistas: la API siempre trae head_sha y event (V-05c, H-V05c-02).
const runs = (...w) => JSON.stringify({ workflow_runs: w.map((x) => ({ head_sha: SHA, event: 'push', ...x })) });

test('wait-ci: un workflow con ruta parecida (ci.yml-old, ci.yaml) en success no cuenta como el CI', () => {
  const r = waitCi(runs(
    { id: 9, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml-old' },
    { id: 8, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yaml' },
  ));
  assert.equal(r.code, 1, r.out);
});

test('wait-ci: ruta con sufijo @ref es el CI y su success habilita el despliegue', () => {
  const r = waitCi(runs({ id: 3, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml@refs/heads/main' }));
  assert.equal(r.code, 0, r.out);
});

test('wait-ci: completed sin conclusion (null) no es success → no despliega', () => {
  const r = waitCi(runs({ id: 4, status: 'completed', conclusion: null, path: '.github/workflows/ci.yml' }));
  assert.equal(r.code, 1, r.out);
});

test('wait-ci: CI cancelled del SHA desplegado → no despliega (no hay atajo que ignore la cancelación)', () => {
  const r = waitCi(runs({ id: 5, status: 'completed', conclusion: 'cancelled', path: '.github/workflows/ci.yml' }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cancelled/);
});

// Intento 2: ci.yml con la nueva concurrencia (H-QA-V05c-01). Traza: "un merge a main despliega"
// exige que el CI del SHA del merge termine; en ramas no main se sigue cancelando (sin regresión).
test('V-05c intento 2: ci.yml agrupa por SHA en main y cancela solo fuera de main', () => {
  const conc = topBlock(CI, 'concurrency');
  assert.ok(conc, 'ci.yml sin concurrency');
  assert.match(conc, /group:\s*ci-\$\{\{\s*github\.ref == 'refs\/heads\/main' && github\.sha \|\| github\.ref\s*\}\}/);
  assert.match(conc, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
});

test('wait-ci intento 2: run del mismo SHA pero con event distinto de push no habilita el despliegue', () => {
  const r = waitCi(runs({ id: 6, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', event: 'pull_request' }));
  assert.equal(r.code, 1, r.out);
});

test('wait-ci intento 2: un success de otro SHA no tapa el failure del SHA desplegado', () => {
  const r = waitCi(runs(
    { id: 7, status: 'completed', conclusion: 'failure', path: '.github/workflows/ci.yml' },
    { id: 50, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', head_sha: 'c'.repeat(40) },
  ));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /conclusion 'failure'/);
});

// F-07 — Pruebas del reintento acotado de `supabase start` (scripts/ci/supabase-start.sh).
// Se simula la CLI con un `supabase` falso en PATH que falla las primeras N veces.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'supabase-start.sh');

function run(args, { failures = 0, failCode = 1, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'f07-'));
  const log = join(dir, 'calls.log');
  const counter = join(dir, 'count');
  writeFileSync(counter, '0');
  writeFileSync(
    join(dir, 'supabase'),
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
if [ "$1" = "stop" ]; then exit 0; fi
n=$(cat "${counter}"); n=$((n + 1)); echo "$n" > "${counter}"
if [ "$n" -le ${failures} ]; then echo "failed to bind host port 0.0.0.0:54322/tcp: address already in use" >&2; exit ${failCode}; fi
exit 0
`,
  );
  chmodSync(join(dir, 'supabase'), 0o755);
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_START_WAIT: '0', ...env },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

describe('scripts/ci/supabase-start.sh', () => {
  test('arranca a la primera sin reintentos ni stop', () => {
    const r = run(['supabase', 'start', '-x', 'studio']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, ['start -x studio']);
  });

  test('puerto ocupado una vez: diagnostica, stop --no-backup, reintenta y pasa', () => {
    const r = run(['supabase', 'start', '-x', 'studio'], { failures: 1 });
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, ['start -x studio', 'stop --no-backup', 'start -x studio']);
    assert.match(r.out, /Diagnóstico de puertos/);
    assert.match(r.out, /intento 2 de 3/);
  });

  test('admite supabase db start', () => {
    const r = run(['supabase', 'db', 'start'], { failures: 2 });
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, ['db start', 'stop --no-backup', 'db start', 'stop --no-backup', 'db start']);
  });

  test('fallo persistente: agota 3 intentos y sale con el código del último (≠ 0)', () => {
    const r = run(['supabase', 'start'], { failures: 99, failCode: 7 });
    assert.equal(r.code, 7);
    assert.equal(r.calls.filter((c) => c === 'start').length, 3);
    assert.equal(r.calls.filter((c) => c === 'stop --no-backup').length, 2, 'sin stop tras el último intento');
    assert.match(r.out, /::error::Supabase local no arrancó tras 3 intentos/);
  });

  test('SUPABASE_START_ATTEMPTS=1 no reintenta', () => {
    const r = run(['supabase', 'start'], { failures: 1, env: { SUPABASE_START_ATTEMPTS: '1' } });
    assert.equal(r.code, 1);
    assert.deepEqual(r.calls, ['start']);
  });

  test('rechaza comandos que no sean arrancar Supabase', () => {
    for (const args of [['ls'], ['supabase', 'db', 'reset'], ['supabase', 'stop'], []]) {
      const r = run(args);
      assert.equal(r.code, 2, `aceptó ${args.join(' ')}`);
      assert.deepEqual(r.calls, []);
    }
  });

  test('rechaza intentos o espera fuera de rango', () => {
    assert.equal(run(['supabase', 'start'], { env: { SUPABASE_START_ATTEMPTS: '0' } }).code, 2);
    assert.equal(run(['supabase', 'start'], { env: { SUPABASE_START_ATTEMPTS: '9' } }).code, 2);
    assert.equal(run(['supabase', 'start'], { env: { SUPABASE_START_WAIT: 'x' } }).code, 2);
    assert.equal(run(['supabase', 'start'], { env: { SUPABASE_START_WAIT: '600' } }).code, 2);
  });

  test('ci.yml usa el script en los tres arranques de Supabase local y no deja arranques directos', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const wrapped = ci.match(/run: bash scripts\/ci\/supabase-start\.sh supabase (db )?start/g) || [];
    assert.equal(wrapped.length, 3);
    assert.doesNotMatch(ci, /run:\s*supabase (db )?start/);
    assert.doesNotMatch(ci, /supabase-start\.sh[^\n]*\|\|\s*true/);
  });
});

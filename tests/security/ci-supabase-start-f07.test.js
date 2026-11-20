// F-07 — Seguridad del reintento de `supabase start` (scripts/ci/supabase-start.sh),
// categoría 5 (automatizaciones) y 3 (entradas).
// - No es un ejecutor genérico: solo `supabase start` / `supabase db start`.
// - Los argumentos llegan literales a la CLI (sin eval ni re-tokenizado): un
//   metacarácter de shell no ejecuta nada.
// - Las variables de entorno se validan antes de usarse (sin inyección en sleep/for).
// - sudo solo no interactivo y solo para `ss` (lectura); sin `set -x` que vuelque el
//   entorno en los logs.
// - Todos los arranques de Supabase local de ci.yml y seguridad.yml pasan por el script.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/ci/supabase-start.sh');
const src = readFileSync(SCRIPT, 'utf8');
const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** Ejecuta el script con un `supabase` falso que registra cada argumento en una línea. */
function run(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sec-f07-'));
  const log = join(dir, 'argv.log');
  writeFileSync(join(dir, 'supabase'), `#!/usr/bin/env bash
for a in "$@"; do printf '[%s]\\n' "$a" >> "${log}"; done
printf -- '--\\n' >> "${log}"
exit 0
`);
  chmodSync(join(dir, 'supabase'), 0o755);
  const r = spawnSync('bash', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_START_WAIT: '0', ...env },
  });
  return { dir, code: r.status, out: r.stdout + r.stderr, argv: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

const pwned = (dir) => readdirSync(dir).filter((f) => /pwned/i.test(f));

describe('5 · scripts/ci/supabase-start.sh (F-07)', () => {
  test('estático: sin eval, bash -c, sh -c, source ni set -x; ejecuta "$@" entre comillas', () => {
    assert.doesNotMatch(code, /\beval\b|\b(ba)?sh\s+-c\b|\bsource\b|^\s*\.\s|\bset\s+-[a-z]*x/m);
    assert.match(code, /^\s*"\$@"\s*$/m, 'el comando debe ejecutarse como "$@"');
    assert.doesNotMatch(code, /^\s*\$[@*]\s*$|^\s*\$\{?[@*]\}?\s/m, '"$@"/$* sin comillas re-tokeniza');
    assert.match(code, /\[ "\$\{1:-\}" = "supabase" \] \|\| usage/, 'primer argumento fijado a supabase');
  });

  test('estático: sudo solo no interactivo y solo para ss de lectura', () => {
    const sudo = [...code.matchAll(/\bsudo\b[^\n|)]*/g)].map((m) => m[0].trim());
    assert.ok(sudo.length > 0);
    for (const s of sudo) assert.match(s, /^sudo -n ss -ltnp\b/, `uso de sudo no permitido: ${s}`);
  });

  test('metacaracteres en los argumentos llegan literales y no ejecutan nada', () => {
    const evil = ['studio;touch pwned1', '$(touch pwned2)', '`touch pwned3`', 'a b', "x' ; touch pwned4 #", '&& touch pwned5'];
    const r = run(['supabase', 'start', '-x', ...evil]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(pwned(r.dir), [], 'un argumento ejecutó código');
    const got = r.argv.split('--\n')[0].trim().split('\n');
    assert.deepEqual(got, ['[start]', '[-x]', ...evil.map((e) => `[${e}]`)], 'los argumentos no llegan intactos');
  });

  test('no ejecuta otros comandos ni otros subcomandos de la CLI', () => {
    for (const args of [
      ['bash', '-c', 'touch pwned'], ['/usr/bin/env', 'supabase', 'start'], ['./supabase', 'start'],
      ['supabase', 'db', 'reset'], ['supabase', 'stop'], ['supabase', 'link', '--project-ref', 'x'],
      ['supabase', 'db', 'push'], ['supabase'], [], ['supabase start'],
    ]) {
      const r = run(args);
      assert.equal(r.code, 2, `${JSON.stringify(args)} debería rechazarse: ${r.out}`);
      assert.equal(r.argv, '', `${JSON.stringify(args)} llegó a ejecutar la CLI`);
      assert.deepEqual(pwned(r.dir), []);
    }
  });

  test('variables de entorno hostiles se rechazan antes de usarse', () => {
    for (const env of [
      { SUPABASE_START_ATTEMPTS: '3; touch pwned' }, { SUPABASE_START_ATTEMPTS: '$(touch pwned)' },
      { SUPABASE_START_ATTEMPTS: '0' }, { SUPABASE_START_ATTEMPTS: '1000000' }, { SUPABASE_START_ATTEMPTS: '-1' },
      { SUPABASE_START_WAIT: '1; touch pwned' }, { SUPABASE_START_WAIT: '9999' }, { SUPABASE_START_WAIT: '-5' },
      { SUPABASE_START_WAIT: '1e3' },
    ]) {
      const r = run(['supabase', 'start'], env);
      assert.equal(r.code, 2, `${JSON.stringify(env)}: ${r.out}`);
      assert.equal(r.argv, '', `${JSON.stringify(env)}: llegó a ejecutar la CLI`);
      assert.deepEqual(pwned(r.dir), []);
    }
  });

  test('ci.yml y seguridad.yml arrancan Supabase local solo a través del script', () => {
    for (const wf of ['.github/workflows/ci.yml', '.github/workflows/seguridad.yml']) {
      const lines = readFileSync(join(ROOT, wf), 'utf8').split('\n');
      const starts = lines.filter((l) => /supabase (db )?start\b/.test(l) && !/^\s*#/.test(l));
      assert.ok(starts.length > 0, `${wf}: sin arranques`);
      for (const l of starts) {
        assert.match(l, /run: bash scripts\/ci\/supabase-start\.sh supabase (db )?start( -x [a-z,-]+)?\s*$/, `${wf}: arranque directo o con argumentos no fijos: ${l.trim()}`);
        assert.doesNotMatch(l, /\$\{\{/, `${wf}: expresión interpolada en el arranque`);
      }
    }
  });
});

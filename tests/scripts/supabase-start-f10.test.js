// F-10 — Reserva de los puertos de Supabase local (54320-54329) antes de arrancar y
// diagnóstico `ss -tanp` en cualquier estado (scripts/ci/supabase-start.sh).
// Se simulan `supabase`, `sudo` y `ss` en PATH y el archivo de reservas con
// SUPABASE_RESERVED_PORTS_FILE: la prueba no toca el sysctl real.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'supabase-start.sh');

/**
 * @param {{ reserved?: string|null, sudoOk?: boolean, failures?: number, ssOut?: string }} o
 *   reserved: contenido inicial del archivo de reservas (null = no existe).
 *   sudoOk: si el `sudo` falso acepta `sysctl -w` (y aplica el valor al archivo).
 */
function run({ reserved = '', sudoOk = true, failures = 0, ssOut = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'f10-'));
  const log = join(dir, 'calls.log');
  const sudoLog = join(dir, 'sudo.log');
  const file = join(dir, 'ip_local_reserved_ports');
  const counter = join(dir, 'count');
  writeFileSync(counter, '0');
  if (reserved !== null) writeFileSync(file, `${reserved}\n`);
  writeFileSync(
    join(dir, 'supabase'),
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
if [ "$1" = "stop" ]; then exit 0; fi
n=$(cat "${counter}"); n=$((n + 1)); echo "$n" > "${counter}"
if [ "$n" -le ${failures} ]; then echo "failed to bind host port 0.0.0.0:54322/tcp: address already in use" >&2; exit 1; fi
exit 0
`,
  );
  writeFileSync(
    join(dir, 'sudo'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${sudoLog}"
[ "$1" = "-n" ] || exit 1
if [ "$2" = "sysctl" ]; then
  ${sudoOk ? '' : 'exit 1'}
  v="\${4#net.ipv4.ip_local_reserved_ports=}"; echo "$v" > "${file}"; exit 0
fi
exit 1
`,
  );
  writeFileSync(join(dir, 'ss'), `#!/usr/bin/env bash\ncat <<'EOF'\n${ssOut}\nEOF\n`);
  for (const b of ['supabase', 'sudo', 'ss']) chmodSync(join(dir, b), 0o755);
  const r = spawnSync('bash', [SCRIPT, 'supabase', 'start'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SUPABASE_START_WAIT: '0',
      SUPABASE_RESERVED_PORTS_FILE: file,
    },
  });
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : []);
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    calls: read(log),
    sudo: read(sudoLog),
    reserved: existsSync(file) ? readFileSync(file, 'utf8').trim() : null,
  };
}

const sysctlCalls = (r) => r.sudo.filter((c) => c.startsWith('-n sysctl'));

describe('F-10 · reserva de puertos antes del primer intento', () => {
  test('sin reservas previas: reserva 54320-54329 con sudo -n sysctl -w y arranca', () => {
    const r = run({ reserved: '' });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(sysctlCalls(r), ['-n sysctl -w net.ipv4.ip_local_reserved_ports=54320-54329']);
    assert.equal(r.reserved, '54320-54329');
    assert.match(r.out, /Puertos reservados: ip_local_reserved_ports=54320-54329/);
    assert.doesNotMatch(r.out, /::warning::/);
  });

  test('conserva las reservas existentes y añade el rango', () => {
    const r = run({ reserved: '8080,30000-30010' });
    assert.equal(r.code, 0);
    assert.deepEqual(sysctlCalls(r), ['-n sysctl -w net.ipv4.ip_local_reserved_ports=8080,30000-30010,54320-54329']);
    assert.equal(r.reserved, '8080,30000-30010,54320-54329');
  });

  test('la reserva ocurre antes del primer arranque y una sola vez aunque haya reintentos', () => {
    const r = run({ reserved: '', failures: 2 });
    assert.equal(r.code, 0);
    assert.equal(sysctlCalls(r).length, 1);
    assert.ok(r.out.indexOf('Puertos reservados') < r.out.indexOf('Intento 1 de 3'));
  });

  test('si el rango ya está reservado no vuelve a llamar a sysctl', () => {
    const r = run({ reserved: '8080,54320-54329' });
    assert.equal(r.code, 0);
    assert.deepEqual(sysctlCalls(r), []);
    assert.match(r.out, /ya reservados/);
  });

  test('sin sudo no interactivo: ::warning:: y sigue arrancando', () => {
    const r = run({ reserved: '8080', sudoOk: false });
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, ['start']);
    assert.match(r.out, /::warning::No se pudieron reservar los puertos 54320-54329/);
    assert.equal(r.reserved, '8080', 'no se tocan las reservas');
  });

  test('sin archivo de reservas: ::warning:: y sigue', () => {
    const r = run({ reserved: null });
    assert.equal(r.code, 0);
    assert.deepEqual(sysctlCalls(r), []);
    assert.match(r.out, /::warning::No se pudo leer/);
  });

  test('contenido inesperado en el archivo: no se pasa a sysctl', () => {
    const r = run({ reserved: '8080;touch pwned' });
    assert.equal(r.code, 0);
    assert.deepEqual(sysctlCalls(r), []);
    assert.match(r.out, /::warning::Contenido inesperado/);
  });

  test('fallo persistente con reserva aplicada sigue saliendo ≠ 0', () => {
    const r = run({ reserved: '', failures: 99 });
    assert.equal(r.code, 1);
    assert.equal(r.calls.filter((c) => c === 'start').length, 3);
    assert.match(r.out, /::error::Supabase local no arrancó tras 3 intentos/);
  });
});

describe('F-10 · diagnóstico ss -tanp en cualquier estado', () => {
  test('muestra sockets no LISTEN que usan 54320-54329 y el valor de reservas', () => {
    const ssOut = [
      'ESTAB 0 0 10.1.0.4:54322 140.82.112.3:443 users:(("node",pid=901,fd=21))',
      'TIME-WAIT 0 0 10.1.0.4:54329 20.1.1.1:443',
      'ESTAB 0 0 10.1.0.4:5432 10.1.0.5:40000 users:(("pg",pid=902,fd=3))',
      'ESTAB 0 0 10.1.0.4:543225 10.1.0.5:443 users:(("otro",pid=903,fd=3))',
    ].join('\n');
    const r = run({ reserved: '', failures: 1, ssOut });
    assert.equal(r.code, 0);
    assert.ok(r.sudo.includes('-n ss -tanp'), 'pide ss -tanp');
    assert.match(r.out, /cualquier estado/);
    assert.match(r.out, /pid=901/);
    assert.match(r.out, /TIME-WAIT 0 0 10\.1\.0\.4:54329/);
    assert.doesNotMatch(r.out, /pid=902/);
    assert.doesNotMatch(r.out, /pid=903/);
    assert.match(r.out, /ip_local_reserved_ports=54320-54329/);
  });

  test('sin sockets en el rango lo dice explícitamente', () => {
    const r = run({ reserved: '', failures: 1, ssOut: 'ESTAB 0 0 10.1.0.4:40000 1.1.1.1:443' });
    assert.match(r.out, /ningún socket TCP usa 54320-54329/);
  });
});

// QA F-10: reserva de 54320-54329 antes de `supabase start` (scripts/ci/supabase-start.sh).
// Trazas (plan-maestro F-10 y encargo del orquestador):
//  - "Reservar 54320-54329 con sysctl net.ipv4.ip_local_reserved_ports antes de arrancar".
//  - "preservando reservas existentes": el valor nuevo contiene todo lo anterior.
//  - "aviso y sigue si no hay sudo": nunca falla por la reserva.
//  - "reintento acotado y salida ≠0 tras fallar se mantienen".
// Casos borde pedidos: archivo de reservas vacío / solo espacios, reservas solapadas,
// rango ya incluido en cualquier posición, falsos positivos de "ya reservado".
// Se simulan `supabase`, `sudo` y `ss`; el sysctl real no se toca.
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
 * @param {{ reserved?: string|null, raw?: boolean, sudoOk?: boolean, sysctlCode?: number,
 *   failures?: number, args?: string[], env?: object }} o
 *   raw: escribe `reserved` tal cual (sin salto de línea final).
 *   sysctlCode: código de `sudo -n sysctl` cuando sudo funciona (p. ej. el kernel rechaza).
 */
function run({ reserved = '', raw = false, sudoOk = true, sysctlCode = 0, failures = 0, args = ['supabase', 'start'], env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-f10-'));
  const log = join(dir, 'calls.log');
  const sudoLog = join(dir, 'sudo.log');
  const file = join(dir, 'ip_local_reserved_ports');
  const counter = join(dir, 'count');
  writeFileSync(counter, '0');
  if (reserved !== null) writeFileSync(file, raw ? reserved : `${reserved}\n`);
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
  ${sysctlCode ? `exit ${sysctlCode}` : ''}
  v="\${4#net.ipv4.ip_local_reserved_ports=}"; echo "$v" > "${file}"; exit 0
fi
exit 1
`,
  );
  writeFileSync(join(dir, 'ss'), '#!/usr/bin/env bash\nexit 0\n');
  for (const b of ['supabase', 'sudo', 'ss']) chmodSync(join(dir, b), 0o755);
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SUPABASE_START_WAIT: '0',
      SUPABASE_RESERVED_PORTS_FILE: file,
      ...env,
    },
  });
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : []);
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    calls: read(log),
    sysctl: read(sudoLog).filter((c) => c.startsWith('-n sysctl')),
    reserved: existsSync(file) ? readFileSync(file, 'utf8').trim() : null,
  };
}

const SET = (v) => `-n sysctl -w net.ipv4.ip_local_reserved_ports=${v}`;

describe('QA F-10 · archivo de reservas vacío o casi vacío', () => {
  test('archivo de 0 bytes: reserva solo el rango, sin coma inicial', () => {
    const r = run({ reserved: '', raw: true });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.sysctl, [SET('54320-54329')]);
  });

  test('archivo con solo espacios y saltos de línea: se trata como vacío', () => {
    const r = run({ reserved: '  \n\t\n', raw: true });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.sysctl, [SET('54320-54329')]);
  });
});

describe('QA F-10 · preservar reservas existentes', () => {
  test('varias reservas (puertos y rangos): todas aparecen, en orden, antes del rango nuevo', () => {
    const r = run({ reserved: '22,8000-8010,30000,40000-40100' });
    assert.equal(r.code, 0);
    assert.deepEqual(r.sysctl, [SET('22,8000-8010,30000,40000-40100,54320-54329')]);
  });

  test('reserva solapada (54300-54400): se conserva y se añade el rango sin perder nada', () => {
    const r = run({ reserved: '54300-54400' });
    assert.equal(r.code, 0);
    assert.equal(r.sysctl.length, 1);
    const value = r.sysctl[0].split('=')[1].split(',');
    assert.ok(value.includes('54300-54400'), 'conserva la reserva previa');
    assert.ok(value.includes('54320-54329'), 'el rango queda reservado');
  });

  test('solapamiento parcial (54325-54335): se conserva y se añade el rango completo', () => {
    const r = run({ reserved: '54325-54335' });
    assert.deepEqual(r.sysctl, [SET('54325-54335,54320-54329')]);
  });
});

describe('QA F-10 · rango ya incluido', () => {
  for (const reserved of ['54320-54329', '54320-54329,8080', '22,54320-54329,8080', '22, 54320-54329']) {
    test(`ya reservado en "${reserved}": no llama a sysctl ni avisa`, () => {
      const r = run({ reserved });
      assert.equal(r.code, 0);
      assert.deepEqual(r.sysctl, []);
      assert.match(r.out, /ya reservados/);
      assert.doesNotMatch(r.out, /::warning::/);
    });
  }

  for (const reserved of ['154320-54329', '54320-543299', '4320-54329', '54320-5432']) {
    test(`falso positivo "${reserved}": no se da por reservado y se añade el rango`, () => {
      const r = run({ reserved });
      assert.deepEqual(r.sysctl, [SET(`${reserved},54320-54329`)]);
    });
  }
});

describe('QA F-10 · nunca falla por la reserva', () => {
  test('sudo existe pero sysctl falla (kernel rechaza): ::warning:: y arranca igual', () => {
    const r = run({ reserved: '8080', sysctlCode: 255 });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.calls, ['start']);
    assert.match(r.out, /::warning::No se pudieron reservar/);
    assert.equal(r.reserved, '8080');
  });

  test('sin sudo y fallo persistente: sale ≠ 0 con el código de supabase y 3 intentos (reintento intacto)', () => {
    const r = run({ reserved: '', sudoOk: false, failures: 99 });
    assert.equal(r.code, 1);
    assert.equal(r.calls.filter((c) => c === 'start').length, 3);
    assert.match(r.out, /::error::Supabase local no arrancó tras 3 intentos/);
  });

  test('SUPABASE_START_ATTEMPTS=1: un solo intento y una sola reserva', () => {
    const r = run({ reserved: '', failures: 99, env: { SUPABASE_START_ATTEMPTS: '1' } });
    assert.equal(r.code, 1);
    assert.equal(r.calls.filter((c) => c === 'start').length, 1);
    assert.equal(r.sysctl.length, 1);
  });
});

describe('QA F-10 · la reserva no ocurre con entradas inválidas', () => {
  test('comando no admitido: sale 2 sin tocar las reservas', () => {
    const r = run({ args: ['supabase', 'stop'] });
    assert.equal(r.code, 2);
    assert.deepEqual(r.sysctl, []);
  });

  test('SUPABASE_START_ATTEMPTS inválido: sale 2 sin tocar las reservas', () => {
    const r = run({ env: { SUPABASE_START_ATTEMPTS: '9' } });
    assert.equal(r.code, 2);
    assert.deepEqual(r.sysctl, []);
  });

  test('supabase db start también reserva antes del primer intento', () => {
    const r = run({ args: ['supabase', 'db', 'start'] });
    assert.equal(r.code, 0);
    assert.deepEqual(r.sysctl, [SET('54320-54329')]);
    assert.ok(r.out.indexOf('Puertos reservados') < r.out.indexOf('Intento 1 de 3'));
  });
});

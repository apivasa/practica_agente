// F-10 — Seguridad de la reserva de puertos de Supabase local en CI
// (scripts/ci/supabase-start.sh), categorías 5 (automatizaciones) y 3 (entradas).
// - El único sudo con efecto es `sudo -n sysctl -w net.ipv4.ip_local_reserved_ports=<v>`
//   y <v> solo contiene dígitos, comas y guiones, con una sola clave y un solo argumento.
// - SUPABASE_RESERVED_PORTS_FILE solo cambia la ruta de LECTURA: un contenido hostil
//   (metacaracteres, saltos de línea, otra clave sysctl, opciones) no llega a sysctl ni
//   ejecuta nada; la reserva nunca hace fallar el script ni sustituye la ejecución.
// Se simulan `sudo`, `ss` y `supabase` en PATH: no se toca el sysctl real.
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

const VALUE_RE = /^net\.ipv4\.ip_local_reserved_ports=[0-9,-]+$/;

/**
 * Ejecuta el script con sudo/ss/supabase falsos. El sudo falso registra cada argumento
 * entre corchetes (una llamada por bloque) y nunca ejecuta lo que recibe.
 * @param {{ reserved?: string|Buffer|null, filePath?: string, failures?: number }} o
 */
function run({ reserved = '', filePath, failures = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sec-f10-'));
  const sudoLog = join(dir, 'sudo.log');
  const counter = join(dir, 'count');
  const file = filePath ?? join(dir, 'reserved');
  writeFileSync(counter, '0');
  if (reserved !== null && !filePath) writeFileSync(file, reserved);
  writeFileSync(join(dir, 'sudo'), `#!/usr/bin/env bash
for a in "$@"; do printf '[%s]\\n' "$a" >> "${sudoLog}"; done
printf -- '--\\n' >> "${sudoLog}"
exit 0
`);
  writeFileSync(join(dir, 'ss'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(join(dir, 'supabase'), `#!/usr/bin/env bash
[ "$1" = "stop" ] && exit 0
n=$(cat "${counter}"); n=$((n + 1)); echo "$n" > "${counter}"
[ "$n" -le ${failures} ] && exit 1
exit 0
`);
  for (const b of ['sudo', 'ss', 'supabase']) chmodSync(join(dir, b), 0o755);
  const r = spawnSync('bash', [SCRIPT, 'supabase', 'start'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SUPABASE_START_WAIT: '0',
      SUPABASE_START_ATTEMPTS: String(Math.max(1, failures + 1)),
      SUPABASE_RESERVED_PORTS_FILE: file,
    },
  });
  const calls = existsSync(sudoLog)
    ? readFileSync(sudoLog, 'utf8').split('--\n').filter(Boolean).map((b) => b.trim().split('\n').map((a) => a.slice(1, -1)))
    : [];
  return { dir, code: r.status, out: r.stdout + r.stderr, calls, sysctl: calls.filter((c) => c[1] === 'sysctl') };
}

const pwned = (dir) => readdirSync(dir).filter((f) => /pwned/i.test(f));

describe('5 · reserva de puertos con sudo sysctl (F-10)', () => {
  test('estático: $new solo se forma con $current validado y el rango fijo', () => {
    assert.match(code, /RESERVED_RANGE='54320-54329'/);
    assert.match(code, /\*\[!0-9,-\]\*\)/, 'falta la validación de caracteres del valor leído');
    const assigns = [...code.matchAll(/\bnew="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(assigns.length > 0);
    for (const a of assigns) assert.match(a, /^(\$current,)?\$RESERVED_RANGE$/, `asignación no permitida de new: ${a}`);
    // La validación ocurre antes del sysctl.
    assert.ok(code.indexOf('*[!0-9,-]*)') < code.indexOf('sudo -n sysctl'), 'el sysctl va antes de validar');
    // La ruta configurable solo se lee: nunca se escribe ni se redirige hacia ella.
    assert.doesNotMatch(code, />\s*"?\$\{?RESERVED_FILE/, 'se escribe en SUPABASE_RESERVED_PORTS_FILE');
    assert.doesNotMatch(code, /\btee\b|\bdd\b|\bcp\b|\bmv\b/, 'escritura de archivos inesperada');
  });

  test('valores legítimos: un sysctl con una sola clave, un solo valor y sudo -n', () => {
    for (const [reserved, expected] of [
      ['', '54320-54329'],
      ['\n', '54320-54329'],
      ['8080\n', '8080,54320-54329'],
      ['1000-1010,2000\n', '1000-1010,2000,54320-54329'],
    ]) {
      const r = run({ reserved });
      assert.equal(r.code, 0, r.out);
      assert.equal(r.sysctl.length, 1, `${JSON.stringify(reserved)}: ${JSON.stringify(r.calls)}`);
      assert.deepEqual(r.sysctl[0], ['-n', 'sysctl', '-w', `net.ipv4.ip_local_reserved_ports=${expected}`]);
      assert.match(r.sysctl[0][3], VALUE_RE);
    }
  });

  test('ya reservado: no vuelve a llamar a sysctl', () => {
    const r = run({ reserved: '54320-54329\n' });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.sysctl.length, 0);
  });

  test('contenido hostil en el archivo de reservas no llega a sysctl ni ejecuta nada', () => {
    const hostile = [
      '1;touch pwned1', '$(touch pwned2)', '`touch pwned3`', '1 && touch pwned4',
      '1\nkernel.core_pattern=|/tmp/pwned5', '1,2 kernel.modprobe=/tmp/pwned6',
      'net.ipv4.ip_forward=1', '-p /etc/pwned7', '--system', '1|touch pwned8',
      "1' -w kernel.x=1 '", '1"2', '1\r\n2', '1\t-a', '54320-54329;x', '*', '..', '\\x00',
      Buffer.from([0x31, 0x00, 0x2c, 0x32]), Buffer.from('31c3a92c32', 'hex'),
      'A'.repeat(70000),
    ];
    for (const h of hostile) {
      const r = run({ reserved: h });
      const label = typeof h === 'string' ? JSON.stringify(h.slice(0, 40)) : h.toString('hex');
      assert.equal(r.code, 0, `${label}: la reserva no debe hacer fallar el arranque: ${r.out}`);
      assert.deepEqual(pwned(r.dir), [], `${label}: ejecutó código`);
      for (const c of r.sysctl) {
        assert.equal(c.length, 4, `${label}: argumentos extra a sysctl ${JSON.stringify(c)}`);
        assert.match(c[3], VALUE_RE, `${label}: valor no validado llegó a sysctl ${JSON.stringify(c)}`);
      }
      // Ninguna otra llamada a sudo que no sea ss de lectura.
      for (const c of r.calls.filter((x) => x[1] !== 'sysctl')) {
        assert.ok(/^(ss)$/.test(c[1]) && ['-ltnp', '-tanp'].includes(c[2]) && c.length === 3, `${label}: sudo inesperado ${JSON.stringify(c)}`);
      }
    }
  });

  test('ruta inexistente, directorio o FIFO: avisa, no llama a sysctl y sigue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sec-f10-p-'));
    for (const p of [join(dir, 'no-existe'), dir, '/dev/null']) {
      const r = run({ filePath: p, reserved: null });
      assert.equal(r.code, 0, `${p}: ${r.out}`);
      for (const c of r.sysctl) assert.match(c[3], VALUE_RE, `${p}: ${JSON.stringify(c)}`);
    }
  });

  test('el diagnóstico solo usa sudo -n ss de lectura y no ejecuta el contenido leído', () => {
    const r = run({ reserved: '$(touch pwned9)', failures: 1 });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(pwned(r.dir), []);
    const ss = r.calls.filter((c) => c[1] === 'ss').map((c) => c.join(' '));
    assert.ok(ss.includes('-n ss -ltnp') && ss.includes('-n ss -tanp'), JSON.stringify(r.calls));
    assert.equal(r.sysctl.length, 0, 'contenido hostil no debe reservar');
  });

  test('ningún workflow fija SUPABASE_RESERVED_PORTS_FILE (solo lo usan las pruebas)', () => {
    for (const f of readdirSync(join(ROOT, '.github/workflows'))) {
      const wf = readFileSync(join(ROOT, '.github/workflows', f), 'utf8');
      assert.doesNotMatch(wf, /SUPABASE_RESERVED_PORTS_FILE/, `${f} redefine la ruta de reservas`);
    }
  });
});

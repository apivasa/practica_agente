// QA F-07: reintento acotado de `supabase start` (scripts/ci/supabase-start.sh).
// Trazas:
//  - plan-maestro F-07: "reintento acotado de supabase start con diagnóstico ss -ltnp
//    (puertos 54322/54324 ocupados)"; criterio: "Paso intermitente registrado en
//    operacion.md deja de requerir relanzar a mano".
//  - CLAUDE.md 4: "No desactives pruebas, linters ni pasos de CI para que algo pase": un fallo
//    real (no intermitente) debe seguir fallando con su código y su mensaje a la vista.
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
 * Ejecuta el script con una CLI `supabase` falsa en PATH.
 * @param {string[]} args
 * @param {{ codes?: number[], stopCode?: number, message?: string, env?: object, extraBins?: Record<string, string> }} o
 *   codes: código de salida de cada `start` (el último se repite); stopCode: código de `supabase stop`.
 */
function run(args, { codes = [0], stopCode = 0, message = 'boom', env = {}, extraBins = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-f07-'));
  const log = join(dir, 'calls.log');
  const counter = join(dir, 'count');
  writeFileSync(counter, '0');
  const list = codes.join(' ');
  writeFileSync(
    join(dir, 'supabase'),
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
if [ "$1" = "stop" ]; then echo "stop falló" >&2; exit ${stopCode}; fi
n=$(cat "${counter}"); n=$((n + 1)); echo "$n" > "${counter}"
codes=(${list}); i=$((n - 1)); [ "$i" -lt "\${#codes[@]}" ] || i=$((\${#codes[@]} - 1))
c=\${codes[$i]}
if [ "$c" -ne 0 ]; then echo "${message} (intento $n)" >&2; fi
exit "$c"
`,
  );
  chmodSync(join(dir, 'supabase'), 0o755);
  for (const [name, body] of Object.entries(extraBins)) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_START_WAIT: '0', ...env },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

describe('QA F-07 · un fallo real sigue fallando y queda a la vista', () => {
  test('error no relacionado con puertos (migración rota): sale con su código y el mensaje de cada intento se ve', () => {
    const r = run(['supabase', 'db', 'start'], { codes: [3], message: 'ERROR: syntax error at or near tabel (migración)' });
    assert.equal(r.code, 3);
    assert.equal(r.calls.filter((c) => c === 'db start').length, 3);
    for (const n of [1, 2, 3]) assert.match(r.out, new RegExp(`syntax error at or near tabel \\(migración\\) \\(intento ${n}\\)`));
    assert.match(r.out, /::error::Supabase local no arrancó tras 3 intentos \(último código 3\)/);
  });

  test('se propaga el código del ÚLTIMO intento, no el del primero', () => {
    assert.equal(run(['supabase', 'start'], { codes: [1, 1, 137] }).code, 137);
    assert.equal(run(['supabase', 'start'], { codes: [9, 4] }).code, 4);
  });

  test('si `supabase stop` falla entre intentos, el resultado sigue siendo el del arranque', () => {
    const fails = run(['supabase', 'start'], { codes: [1], stopCode: 5 });
    assert.equal(fails.code, 1, 'no se convierte en éxito ni en el código de stop');
    assert.equal(fails.calls.filter((c) => c === 'start').length, 3, 'sigue reintentando');
    const recovers = run(['supabase', 'start'], { codes: [1, 0], stopCode: 5 });
    assert.equal(recovers.code, 0);
  });

  test('la intermitencia absorbida no se oculta: notice con el intento que pasó y advertencias previas', () => {
    const r = run(['supabase', 'start', '-x', 'studio'], { codes: [1, 1, 0] });
    assert.equal(r.code, 0);
    assert.match(r.out, /::notice::Supabase local arrancó en el intento 3 de 3 \(F-07\)/);
    assert.equal((r.out.match(/::warning::/g) || []).length, 2);
    const first = run(['supabase', 'start']);
    assert.doesNotMatch(first.out, /::notice::|::warning::|::error::/, 'sin ruido si pasa a la primera');
  });

  test('reintento acotado: con 5 intentos (máximo) son 5 arranques y 4 stop, nunca más', () => {
    const r = run(['supabase', 'start'], { codes: [1], env: { SUPABASE_START_ATTEMPTS: '5' } });
    assert.equal(r.code, 1);
    assert.equal(r.calls.filter((c) => c === 'start').length, 5);
    assert.equal(r.calls.filter((c) => c === 'stop --no-backup').length, 4);
  });

  test('los argumentos llegan intactos a la CLI (no se pierden exclusiones -x)', () => {
    const r = run(['supabase', 'start', '-x', 'studio,imgproxy,mailpit', '--ignore-health-check']);
    assert.deepEqual(r.calls, ['start -x studio,imgproxy,mailpit --ignore-health-check']);
  });
});

describe('QA F-07 · diagnóstico de puertos (ss -ltnp)', () => {
  test('muestra quién ocupa 54322/54324 y no confunde otros puertos', () => {
    const ss = `cat <<'EOF'
LISTEN 0 4096 0.0.0.0:54322 0.0.0.0:* users:(("docker-proxy",pid=111,fd=4))
LISTEN 0 4096 0.0.0.0:54324 0.0.0.0:* users:(("docker-proxy",pid=222,fd=4))
LISTEN 0 4096 0.0.0.0:5432 0.0.0.0:* users:(("postgres",pid=333,fd=4))
LISTEN 0 4096 0.0.0.0:543221 0.0.0.0:* users:(("otro",pid=444,fd=4))
EOF`;
    const r = run(['supabase', 'start'], {
      codes: [1, 0],
      extraBins: { ss, sudo: 'exit 1', docker: 'echo "supabase_db_x\tUp\t0.0.0.0:54322->5432/tcp"' },
    });
    assert.equal(r.code, 0);
    assert.match(r.out, /pid=111/);
    assert.match(r.out, /pid=222/);
    assert.doesNotMatch(r.out, /pid=333/);
    assert.doesNotMatch(r.out, /pid=444/);
    assert.match(r.out, /supabase_db_x/);
  });
});

describe('QA F-07 · alcance en los workflows', () => {
  const steps = (yml) => yml.split(/\n\s*- (?=name:|uses:|run:)/);

  test('ci.yml: los pasos que arrancan Supabase no tienen continue-on-error', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const starts = steps(ci).filter((s) => /supabase-start\.sh/.test(s));
    assert.equal(starts.length, 3);
    for (const s of starts) assert.doesNotMatch(s, /continue-on-error/);
  });

  // Antes era `todo` (H-F07-QA-01); lo cerró seguridad en 1e03204.
  test('criterio: seguridad.yml (donde se registró el intermitente, pentest-api) también reintenta', () => {
    const sec = readFileSync(join(ROOT, '.github', 'workflows', 'seguridad.yml'), 'utf8');
    assert.doesNotMatch(sec, /run:[ \t]*supabase (db )?start/);
    assert.ok((sec.match(/run: bash scripts\/ci\/supabase-start\.sh supabase start/g) || []).length >= 3);
  });
});

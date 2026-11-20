// QA S-05 — Pentest previo a producción. Pruebas de comportamiento de los
// jobs `s05-fase-a` y `s05-fase-b` de .github/workflows/seguridad.yml:
// se extraen los scripts `run:` de cada paso y se ejecutan con bash contra
// datos de prueba (docker y ZAP simulados con un stub en PATH), para comprobar
// que los pasos FALLAN cuando deben y no son verdes vacíos.
//
// Trazabilidad (docs/seguridad/pentest-preproduccion.md y S-05-seguridad.md):
//   - "Falla si hay alertas de riesgo alto"                       → bloque A1
//   - "falla si hay algún 401 (ZAP sin sesión), algún 5xx o menos
//      de 1000 peticiones"                                         → bloque A2
//   - ZAP full scan falla si zap-full-scan.py no termina en 0     → bloque A3
//   - "Fase B: a mano (workflow_dispatch), solo desde main"       → bloque B1/B2
//   - "nunca otro host" (fase-b.test.js › guardedFetch)           → bloque B3
//   - "sin clave secreta"                                         → bloque B4
//   - no se rompe ningún job previo de seguridad.yml              → bloque C
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WF = readFileSync(join(ROOT, '.github', 'workflows', 'seguridad.yml'), 'utf8');
const LINES = WF.split('\n');

// ---------------------------------------------------------------------------
// Lector mínimo del YAML del workflow (sin dependencias)
// ---------------------------------------------------------------------------
function jobBlock(id) {
  const start = LINES.findIndex((l) => l === `  ${id}:`);
  assert.ok(start >= 0, `falta el job ${id}`);
  let end = start + 1;
  while (end < LINES.length && !/^ {2}[\w-]+:\s*$/.test(LINES[end]) && !/^\S/.test(LINES[end])) end += 1;
  return LINES.slice(start, end);
}
function jobIds() {
  const i = LINES.findIndex((l) => l === 'jobs:');
  return LINES.slice(i + 1).filter((l) => /^ {2}[\w-]+:\s*$/.test(l)).map((l) => l.trim().slice(0, -1));
}
function jobIf(id) {
  const m = jobBlock(id).find((l) => /^ {4}if:/.test(l));
  return m ? m.replace(/^ {4}if:\s*/, '').trim() : null;
}
// Pasos de un job: [{ name, if, run, lines }]
function steps(id) {
  const block = jobBlock(id);
  const out = [];
  let cur = null;
  for (let i = 0; i < block.length; i += 1) {
    const l = block[i];
    if (/^ {6}- /.test(l)) {
      cur = { name: null, if: null, run: null, lines: [] };
      out.push(cur);
    }
    if (!cur) continue;
    cur.lines.push(l);
    const name = l.match(/^ {6}(?:- | {2})name:\s*(.+)$/);
    if (name) cur.name = name[1].trim();
    const cond = l.match(/^ {8}if:\s*(.+)$/);
    if (cond) cur.if = cond[1].trim();
    if (/^ {8}run:\s*\|\s*$/.test(l)) {
      const body = [];
      let j = i + 1;
      while (j < block.length && (block[j].trim() === '' || /^ {10}/.test(block[j]))) {
        body.push(block[j].slice(10));
        j += 1;
      }
      cur.run = body.join('\n');
    } else {
      const one = l.match(/^ {8}run:\s*(.+)$/);
      if (one) cur.run = one[1];
    }
  }
  return out;
}
function step(id, name) {
  const s = steps(id).find((x) => x.name === name);
  assert.ok(s, `falta el paso "${name}" en ${id}`);
  return s;
}

// ---------------------------------------------------------------------------
// Entorno de ejecución: RUNNER_TEMP temporal y docker simulado
// ---------------------------------------------------------------------------
const DOCKER_STUB = `#!/usr/bin/env bash
case "$1" in
  ps) [ -n "\${STUB_NO_KONG:-}" ] || echo supabase_kong_qa ;;
  logs)
    n=$(cat "$STUB_STATE/count" 2>/dev/null || echo 0)
    echo $((n + 1)) > "$STUB_STATE/count"
    cat "$STUB_STATE/pre.log"
    [ "$n" -eq 0 ] || cat "$STUB_STATE/new.log"
    ;;
  pull|image) exit 0 ;;
  run) exit "\${STUB_ZAP_EXIT:-0}" ;;
  *) exit 0 ;;
esac
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'qa-s05-'));
  const bin = join(dir, 'bin');
  const temp = join(dir, 'runner');
  const state = join(dir, 'state');
  for (const d of [bin, temp, join(temp, 'zap'), state]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  chmodSync(join(bin, 'docker'), 0o755);
  writeFileSync(join(state, 'pre.log'), '');
  writeFileSync(join(state, 'new.log'), '');
  return { dir, bin, temp, state };
}
function runScript(script, sb, env = {}) {
  const r = spawnSync('bash', ['-e', '-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: `${sb.bin}:${process.env.PATH}`,
      HOME: sb.dir,
      RUNNER_TEMP: sb.temp,
      STUB_STATE: sb.state,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_QA_LOCAL_ONLY',
      ZAP_IMAGE: 'zaproxy/zap-stable@sha256:qa', // env del job (docker simulado)
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

// Línea de acceso de Kong con el formato que espera el grep del job.
const kong = (method, path, status) =>
  `172.18.0.1 - - [20/Nov/2026:02:35:00 +0000] "${method} /rest/v1/${path} HTTP/1.1" ${status} 12 "-" "ZAP/2.16"`;
function kongLog(spec) {
  const out = [];
  for (const [method, status, n] of spec) {
    for (let i = 0; i < n; i += 1) out.push(kong(method, `units?id=not.is.null&q=${i}`, status));
  }
  return `${out.join('\n')}\n`;
}
const AUTH_OK = [['GET', 200, 3], ['PATCH', 403, 500], ['POST', 400, 500], ['GET', 406, 100]];

function report(alerts) {
  return JSON.stringify({ site: [{ '@name': 'http://127.0.0.1', alerts }] });
}
const alert = (riskcode, pluginid = '10020') => ({
  riskcode: String(riskcode), riskdesc: ['Info', 'Low', 'Medium', 'High'][riskcode], pluginid, alert: `qa ${pluginid}`,
  count: '1', instances: [{ method: 'GET', uri: 'http://127.0.0.1:4173/practica_agente/', evidence: '' }],
});

let hasJq = true;
before(() => {
  try { execFileSync('jq', ['--version']); } catch { hasJq = false; }
});

// ---------------------------------------------------------------------------
// A1 · "Sin alertas de riesgo alto (front y API)"
// ---------------------------------------------------------------------------
describe('S-05 fase A · paso "Sin alertas de riesgo alto" falla con riesgo alto', () => {
  const s = () => step('s05-fase-a', 'Sin alertas de riesgo alto (front y API)');
  const write = (sb, name, body) => writeFileSync(join(sb.temp, 'zap', `${name}.json`), body);

  test('corre siempre (if: always()), también si el escaneo previo falló', () => {
    assert.equal(s().if, 'always()');
  });

  test('sin altos (solo medio y bajo) → pasa', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const sb = sandbox();
    write(sb, 'front-full', report([alert(2), alert(1, '10021')]));
    write(sb, 'api-scan', report([alert(2, '10099')]));
    const r = runScript(s().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.equal(r.code, 0, r.out);
  });

  test('una alerta alta en el full scan del front → falla', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const sb = sandbox();
    write(sb, 'front-full', report([alert(2), alert(3, '40012')]));
    write(sb, 'api-scan', report([]));
    const r = runScript(s().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /front-full: 1 alertas de riesgo alto/);
  });

  test('una alerta alta en el API scan → falla', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const sb = sandbox();
    write(sb, 'front-full', report([]));
    write(sb, 'api-scan', report([alert(3, '40018')]));
    const r = runScript(s().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /api-scan: 1 alertas de riesgo alto/);
  });

  test('alta en un segundo site del informe → falla (no solo mira el primero)', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const sb = sandbox();
    write(sb, 'front-full', JSON.stringify({ site: [{ alerts: [alert(1)] }, { alerts: [alert(3, '40014')] }] }));
    write(sb, 'api-scan', report([]));
    const r = runScript(s().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.notEqual(r.code, 0, r.out);
  });

  test('una URI fuera de /practica_agente/ en el full scan del front → falla (QA-S05-03)', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const sb = sandbox();
    const out = { ...alert(1, '10021'), instances: [{ method: 'GET', uri: 'http://127.0.0.1:54321/auth/v1/token', evidence: '' }] };
    write(sb, 'front-full', report([alert(2), out]));
    write(sb, 'api-scan', report([]));
    const r = runScript(s().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /salió de su subárbol: http:\/\/127\.0\.0\.1:54321\/auth\/v1\/token/);
  });

  test('si ZAP no generó el informe → falla (no es un verde vacío)', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const sb = sandbox();
    write(sb, 'front-full', report([]));
    const r = runScript(s().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ZAP no generó api-scan\.json/);
  });
});

// ---------------------------------------------------------------------------
// A2 · "ZAP API scan de PostgREST": autenticado, sin 5xx, ≥ 1000 peticiones
// ---------------------------------------------------------------------------
describe('S-05 fase A · ZAP API scan falla si no llega autenticado, ante 5xx o si apenas ataca', () => {
  const s = () => step('s05-fase-a', 'ZAP API scan de PostgREST (activo, local, sesión de gestora)');
  const run = (spec, { pre = '', env = {} } = {}) => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'pre.log'), pre);
    writeFileSync(join(sb.state, 'new.log'), kongLog(spec));
    writeFileSync(join(sb.temp, 'zap-auth.env'), 'ZAP_AUTH_HEADER_VALUE=Bearer qa\n');
    const r = runScript(s().run, sb, env);
    rmSync(sb.dir, { recursive: true, force: true });
    return r;
  };

  test('sesión válida (200 en lecturas base, 403/400 en ataques), sin 5xx → pasa', () => {
    const r = run(AUTH_OK);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Peticiones a PostgREST: 1103 · 2xx: 3 · 401: 0 · 5xx: 0/);
  });

  test('ZAP sin sesión (todo 401) → falla', () => {
    const r = run([['GET', 401, 600], ['POST', 401, 600]]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ZAP no llegó autenticado/);
  });

  test('un solo 401 durante el escaneo (sesión caducada a mitad) → falla', () => {
    const r = run([...AUTH_OK, ['PATCH', 401, 1]]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ZAP no llegó autenticado/);
  });

  test('ninguna respuesta 2xx → falla', () => {
    const r = run([['PATCH', 403, 600], ['POST', 400, 600]]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ZAP no llegó autenticado/);
  });

  test('un 500 de PostgREST ante un payload → falla', () => {
    const r = run([...AUTH_OK, ['GET', 500, 1]]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /1 errores 5xx/);
  });

  test('un 503 → falla (cualquier 5xx)', () => {
    const r = run([...AUTH_OK, ['POST', 503, 2]]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /2 errores 5xx/);
  });

  test('menos de 1000 peticiones (999) → falla', () => {
    const r = run([['GET', 200, 3], ['PATCH', 403, 996]]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ZAP apenas atacó la API \(999 peticiones\)/);
  });

  test('exactamente 1000 peticiones → pasa (umbral inclusivo)', () => {
    const r = run([['GET', 200, 3], ['PATCH', 403, 997]]);
    assert.equal(r.code, 0, r.out);
  });

  test('log del gateway vacío o con otro formato (0 peticiones contadas) → falla', () => {
    const r = run([]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /ZAP apenas atacó la API \(0 peticiones\)/); // QA-S05-04: mensaje propio
  });

  test('solo cuenta las líneas del gateway posteriores al inicio del escaneo', () => {
    // 401 y 500 previos (p. ej. de pasos anteriores) no deben contar.
    const pre = `${kong('GET', 'units', 401)}\n${kong('GET', 'units', 500)}\n`;
    const r = run(AUTH_OK, { pre });
    assert.equal(r.code, 0, r.out);
  });

  test('zap-api-scan.py con código ≠ 0 (p. ej. 1 = FAIL, 3 = error) → falla aunque el log esté bien', () => {
    for (const code of ['1', '3']) {
      const r = run(AUTH_OK, { env: { STUB_ZAP_EXIT: code } });
      assert.notEqual(r.code, 0, `código ${code}: ${r.out}`);
      assert.match(r.out, new RegExp(`terminó con código ${code}`));
    }
  });

  test('sin contenedor Kong de Supabase local → falla', () => {
    const r = run(AUTH_OK, { env: { STUB_NO_KONG: '1' } });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /no se encontró el contenedor Kong/); // QA-S05-04: mensaje propio
  });

  test('borra el archivo con la sesión de la gestora tras el escaneo', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'new.log'), kongLog(AUTH_OK));
    const auth = join(sb.temp, 'zap-auth.env');
    writeFileSync(auth, 'ZAP_AUTH_HEADER_VALUE=Bearer qa\n');
    runScript(s().run, sb);
    let exists = true;
    try { readFileSync(auth); } catch { exists = false; }
    rmSync(sb.dir, { recursive: true, force: true });
    assert.equal(exists, false, 'zap-auth.env sigue en disco');
  });
});

// ---------------------------------------------------------------------------
// A3 · "ZAP full scan del front": el código de salida de ZAP manda
// ---------------------------------------------------------------------------
describe('S-05 fase A · ZAP full scan del front propaga el fallo de ZAP', () => {
  const s = () => step('s05-fase-a', 'ZAP full scan del front (activo, local)');
  for (const [code, ok] of [['0', true], ['1', false], ['2', false], ['3', false]]) {
    test(`zap-full-scan.py termina con ${code} → ${ok ? 'pasa' : 'falla'}`, () => {
      const sb = sandbox();
      const r = runScript(s().run, sb, { STUB_ZAP_EXIT: code });
      rmSync(sb.dir, { recursive: true, force: true });
      assert.equal(r.code === 0, ok, r.out);
    });
  }

  test('el full scan es activo y con AJAX spider contra el build de producción local', () => {
    const run = s().run;
    assert.match(run, /zap-full-scan\.py -t http:\/\/127\.0\.0\.1:4173\/practica_agente\/ -j/);
    assert.match(step('s05-fase-a', 'Build de producción y servidor de vista previa').run, /npm run build[\s\S]*vite preview --host 127\.0\.0\.1 --port 4173/);
  });
});

// ---------------------------------------------------------------------------
// B1 · Cuándo corre cada fase
// ---------------------------------------------------------------------------
describe('S-05 · qué fase corre en cada evento', () => {
  // Traducción directa de la expresión `if:` del job a JS.
  // Intento 2 (H-ARQ): la fase A, pesada, corre en PR, semanal y a mano con
  // fase_b=no, no en cada push. La fase B exige además github.ref == main.
  const evaluate = (expr, ev, faseB, ref) =>
    new Function('github', 'inputs', `return (${expr.replace(/\$\{\{|\}\}/g, '')});`)({ event_name: ev, ref }, { fase_b: faseB });
  const MAIN = 'refs/heads/main';
  const cases = [
    ['push', '', MAIN, false, false],
    ['push', '', 'refs/heads/item/S-05', false, false],
    ['pull_request', '', 'refs/pull/1/merge', true, false],
    ['schedule', '', MAIN, true, false],
    ['workflow_dispatch', 'no', MAIN, true, false],
    ['workflow_dispatch', 'no', 'refs/heads/item/S-05', true, false],
    ['workflow_dispatch', 'anonimo', MAIN, false, true],
    ['workflow_dispatch', 'roles', MAIN, false, true],
    ['workflow_dispatch', 'anonimo', 'refs/heads/item/S-05', false, false],
    ['workflow_dispatch', 'roles', 'refs/heads/main-falsa', false, false],
    ['workflow_dispatch', 'roles', 'refs/tags/v1', false, false],
  ];
  for (const [ev, fb, ref, a, b] of cases) {
    test(`${ev}${fb ? ` (fase_b=${fb})` : ''} en ${ref}: fase A ${a ? 'sí' : 'no'}, fase B ${b ? 'sí' : 'no'}`, () => {
      assert.equal(Boolean(evaluate(jobIf('s05-fase-a'), ev, fb, ref)), a);
      assert.equal(Boolean(evaluate(jobIf('s05-fase-b'), ev, fb, ref)), b);
    });
  }

  test('el input fase_b es una elección cerrada con "no" por defecto', () => {
    const i = LINES.findIndex((l) => /^ {6}fase_b:/.test(l));
    const block = LINES.slice(i, i + 8).join('\n');
    assert.match(block, /default: 'no'/);
    assert.match(block, /type: choice/);
    assert.match(block, /options: \['no', 'anonimo', 'roles'\]/);
  });
});

// ---------------------------------------------------------------------------
// B2 · Fase B solo desde main
// ---------------------------------------------------------------------------
describe('S-05 fase B · solo desde main', () => {
  const guard = () => step('s05-fase-b', 'Solo desde main');

  test('el job usa el environment produccion', () => {
    assert.ok(jobBlock('s05-fase-b').some((l) => /^ {4}environment:\s*produccion\s*$/.test(l)));
  });

  for (const [ref, ok] of [
    ['refs/heads/main', true],
    ['refs/heads/item/S-05', false],
    ['refs/heads/main-falsa', false],
    ['refs/tags/v1', false],
    ['refs/pull/1/merge', false],
  ]) {
    test(`GITHUB_REF=${ref} → ${ok ? 'continúa' : 'falla'}`, () => {
      const sb = sandbox();
      const r = runScript(guard().run, sb, { GITHUB_REF: ref });
      rmSync(sb.dir, { recursive: true, force: true });
      assert.equal(r.code === 0, ok, r.out);
    });
  }

  test('ningún paso que contacta producción corre si falla la comprobación de main', () => {
    // En Actions, `if: always()` ejecuta el paso aunque un paso anterior haya
    // fallado: anularía la guarda "Solo desde main". Los pasos que contactan
    // Pages o Supabase de producción deben correr solo si la guarda pasó
    // (sin `if`, o con `success()` / el resultado de la guarda).
    const all = steps('s05-fase-b');
    const gi = all.findIndex((x) => x.name === 'Solo desde main');
    assert.ok(gi >= 0);
    const touchesProd = (x) => /https:\/\/apivasa\.github\.io|supabase\.co|fase-b\.test\.js|gh api/.test(x.lines.join('\n'));
    const offenders = all.slice(gi + 1)
      .filter(touchesProd)
      .filter((x) => x.if && /always\(\)|failure\(\)/.test(x.if) && !/steps\.[\w-]+\.(outcome|conclusion)/.test(x.if))
      .map((x) => `${x.name} (if: ${x.if})`);
    assert.deepEqual(offenders, [], `pasos que contactan producción aunque la guarda de main falle: ${offenders.join('; ')}`);
  });
});

describe('S-05 fase B · pasos de ZAP contra Pages (intento 2)', () => {
  const zap = () => step('s05-fase-b', 'ZAP full scan de Pages (1 hilo, con retardo, duración acotada)');
  const check = () => step('s05-fase-b', 'Sin alertas de riesgo alto (Pages)');
  const guardId = () => {
    const g = step('s05-fase-b', 'Solo desde main');
    const m = g.lines.join('\n').match(/^ {8}id:\s*([\w-]+)/m);
    assert.ok(m, 'la guarda «Solo desde main» no tiene id');
    return m[1];
  };

  test('ZAP y su verificación dependen del resultado de la guarda de main', () => {
    const id = guardId();
    for (const x of [zap(), check()]) {
      assert.ok(x.if, `${x.name} sin if`);
      assert.ok(x.if.includes(`steps.${id}.outcome == 'success'`), `${x.name}: if = ${x.if}`);
      assert.doesNotMatch(x.if, /always\(\)/);
    }
  });

  const PAGES = 'https://apivasa.github.io/practica_agente/';
  const pagesAlert = (riskcode, uri) => ({ ...alert(riskcode), instances: [{ method: 'GET', uri, evidence: '' }] });
  const runCheck = (alerts) => {
    const sb = sandbox();
    writeFileSync(join(sb.temp, 'zap', 'pages-full.json'), report(alerts));
    const r = runScript(check().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    return r;
  };

  test('Pages: medio y bajo dentro de /practica_agente/ → pasa', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const r = runCheck([pagesAlert(2, PAGES), pagesAlert(1, `${PAGES}assets/index.js`)]);
    assert.equal(r.code, 0, r.out);
  });

  test('Pages: alerta alta → falla', (t) => {
    if (!hasJq) return t.skip('sin jq');
    const r = runCheck([pagesAlert(3, PAGES)]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /1 alertas de riesgo alto en Pages/);
  });

  for (const uri of ['https://apivasa.github.io/otro_repo/', 'https://apivasa.github.io/', 'https://oehtspdtpwdhfhhhkgao.supabase.co/rest/v1/']) {
    test(`Pages: URI fuera de alcance (${uri}) → falla (QA-S05-03)`, (t) => {
      if (!hasJq) return t.skip('sin jq');
      const r = runCheck([pagesAlert(1, PAGES), pagesAlert(1, uri)]);
      assert.notEqual(r.code, 0, r.out);
      assert.match(r.out, /ZAP salió del alcance/);
    });
  }

  test('Pages: sin informe de ZAP → falla', () => {
    const sb = sandbox();
    const r = runScript(check().run, sb);
    rmSync(sb.dir, { recursive: true, force: true });
    assert.notEqual(r.code, 0, r.out);
  });

  test('la exclusión global de ZAP deja fuera todo lo que no sea /practica_agente/', () => {
    const m = zap().run.match(/globalexcludeurl\.url_list\.url\(0\)\.regex=(\S+)/);
    assert.ok(m, 'sin exclusión global');
    const re = new RegExp(m[1]); // ZAP usa regex de Java; esta sintaxis es común
    for (const u of [PAGES, `${PAGES}assets/x.js`]) assert.equal(re.test(u), false, `excluye ${u}`);
    for (const u of ['https://apivasa.github.io/', 'https://apivasa.github.io/otro_repo/', 'https://oehtspdtpwdhfhhhkgao.supabase.co/rest/v1/']) {
      assert.equal(re.test(u), true, `no excluye ${u}`);
    }
  });
});

// ---------------------------------------------------------------------------
// B3 · Solo hosts del proyecto (lista blanca de fase-b.test.js, por comportamiento)
// ---------------------------------------------------------------------------
describe('S-05 fase B · la lista blanca de hosts de fase-b.test.js', () => {
  const src = readFileSync(join(ROOT, 'tests', 'security', 'prod', 'fase-b.test.js'), 'utf8');
  const body = src.match(/function allowed\(url\) \{\n([\s\S]*?)\n\}/);
  const make = (REF) => {
    assert.ok(body, 'no se encontró allowed() en fase-b.test.js');
    const fn = new Function('REF', 'url', body[1]);
    return (url) => fn(REF, url);
  };
  const REF = 'oehtspdtpwdhfhhhkgao';
  const ok = (u, ref = REF) => Boolean(make(ref)(u));

  test('admite Pages del repo y el Supabase del proyecto por https', () => {
    assert.equal(ok('https://apivasa.github.io/practica_agente/'), true);
    assert.equal(ok('https://apivasa.github.io/practica_agente/assets/index.js'), true);
    assert.equal(ok(`https://${REF}.supabase.co/rest/v1/units`), true);
  });

  for (const u of [
    'http://apivasa.github.io/practica_agente/', // sin TLS
    'https://apivasa.github.io/otro_repo/', // otro repo del mismo dueño
    'https://apivasa.github.io/', // raíz del dominio
    'https://apivasa.github.io/practica_agente', // sin barra: fuera del prefijo
    'https://otro.github.io/practica_agente/',
    'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/rest/v1/units', // otro proyecto Supabase
    `https://${REF}.supabase.co.evil.example/`, // sufijo engañoso
    `https://evil.example/${REF}.supabase.co`,
    `http://${REF}.supabase.co/rest/v1/`,
    `https://${REF}.supabase.co:8443/rest/v1/`, // otro puerto
    'https://127.0.0.1/',
  ]) {
    test(`rechaza ${u}`, () => assert.equal(ok(u), false));
  }

  test('sin ref configurado no admite ningún supabase.co', () => {
    assert.equal(ok('https://undefined.supabase.co/', undefined), false);
  });
});

// ---------------------------------------------------------------------------
// B4 · Sin clave secreta ni credenciales de administración en la fase B
// ---------------------------------------------------------------------------
describe('S-05 fase B · sin clave secreta', () => {
  test('el job no lee SUPABASE_SECRET_KEY, SUPABASE_ACCESS_TOKEN ni SUPABASE_DB_PASSWORD', () => {
    const j = jobBlock('s05-fase-b').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const s of ['SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) {
      assert.doesNotMatch(j, new RegExp(s), `s05-fase-b usa ${s}`);
    }
    // El único secreto es el de las cuentas de prueba.
    const used = [...j.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(used)], ['S05_TEST_USERS']);
  });

  test('permisos mínimos del token: solo contents: read', () => {
    const j = jobBlock('s05-fase-b').join('\n');
    assert.match(j, /^ {4}permissions:\n {6}contents: read\n {4}env:/m);
  });

  test('ZAP contra Pages: sin escaneo de la API, 1 hilo, retardo ≥ 300 ms, duración ≤ 15 min', () => {
    const run = step('s05-fase-b', 'ZAP full scan de Pages (1 hilo, con retardo, duración acotada)').run;
    assert.match(run, /zap-full-scan\.py -t https:\/\/apivasa\.github\.io\/practica_agente\//);
    assert.doesNotMatch(run, /zap-api-scan|\s-j\s/);
    assert.match(run, /threadPerHost=1/);
    assert.ok(Number(run.match(/delayInMs=(\d+)/)[1]) >= 300);
    assert.ok(Number(run.match(/maxScanDurationInMins=(\d+)/)[1]) <= 15);
  });
});

// ---------------------------------------------------------------------------
// C · No se rompió ningún job previo de seguridad.yml
// ---------------------------------------------------------------------------
describe('seguridad.yml · jobs previos intactos tras S-05', () => {
  const PREVIOUS = ['gitleaks', 'semgrep', 'npm-audit', 'codeql', 'security-tests', 'pentest-api', 'dast'];
  test('siguen todos los jobs previos y solo se añaden s05-fase-a y s05-fase-b', () => {
    const ids = jobIds();
    for (const id of PREVIOUS) assert.ok(ids.includes(id), `falta el job ${id} (jobs: ${ids.join(', ')})`);
    assert.deepEqual(ids.filter((x) => !PREVIOUS.includes(x)).sort(), ['s05-fase-a', 's05-fase-b']);
  });

  test('ningún job previo depende del input fase_b ni del evento (corren siempre)', () => {
    for (const id of PREVIOUS) {
      const cond = jobIf(id);
      assert.ok(!cond || !/fase_b|workflow_dispatch/.test(cond), `${id} tiene if: ${cond}`);
    }
  });

  test('disparadores previos se mantienen (pull_request, push, schedule, workflow_dispatch)', () => {
    const on = WF.split(/^permissions:/m)[0];
    for (const t of ['pull_request:', 'push:', 'schedule:', 'workflow_dispatch:']) assert.ok(on.includes(t), `falta ${t}`);
  });
});

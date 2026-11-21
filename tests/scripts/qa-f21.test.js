// F-21 — Pruebas de QA (independientes del desarrollador). Cada caso traza al criterio:
//   (1a) sanitizeLogValue reemplaza \r, \n, 0x00-0x1f, 0x7f-0x9f, U+2028/U+2029 (y nada más).
//   (1b) recorta a 300 caracteres con «…».
//   (1c) ningún valor de la API puede iniciar una línea con `::` en el log ni en GITHUB_STEP_SUMMARY
//        (check.js e issue.js).
//   (1d) los resultados ok/fail no cambian (solo se sanea la salida).
//   (2)  checkWorkflows con candidate.id no entero seguro → fail «el último run no tiene id
//        verificable» y sin pedir jobs.
// Sin red: fetch y cliente de GitHub simulados.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOG_VALUE_MAX, WORKFLOW_RULES, assessWorkflow, checkWorkflows, sanitizeLogValue } from '../../scripts/health/lib.js';
import { main as checkMain } from '../../scripts/health/check.js';
import { main as issueMain } from '../../scripts/health/issue.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const STEP_RULES = WORKFLOW_RULES.filter((r) => r.requiredStep);
const ELLIPSIS = '…';
const cpLen = (s) => Array.from(s).length;
// Separadores de línea que reconocen Node, el runner o un visor: \n, \r, VT, FF, NEL, LS, PS.
// Por code point (sin regex de controles, regla no-control-regex); \r\n cuenta como un solo salto.
const BREAK_CPS = new Set([0x0a, 0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029]);
const linesOf = (text) => {
  const out = [''];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (!BREAK_CPS.has(cp)) {
      out[out.length - 1] += chars[i];
      continue;
    }
    if (cp === 0x0d && chars[i + 1] === '\n') i += 1;
    out.push('');
  }
  return out;
};
// Una línea que empiece con `::` y no sea una de las anotaciones fijas del propio script.
const injected = (text) => linesOf(text).some((l) => /^\s*::/.test(l) && !/^::(error|warning)::(FALLA|omitido|aviso) /.test(l));

describe('QA F-21 (1a) sanitizeLogValue: qué se reemplaza', () => {
  test('cada code point de 0x00 a 0x1f pasa a un espacio', () => {
    for (let cp = 0x00; cp <= 0x1f; cp++) {
      assert.equal(sanitizeLogValue(`a${String.fromCodePoint(cp)}b`), 'a b', `0x${cp.toString(16)}`);
    }
  });
  test('cada code point de 0x7f a 0x9f pasa a un espacio', () => {
    for (let cp = 0x7f; cp <= 0x9f; cp++) {
      assert.equal(sanitizeLogValue(`a${String.fromCodePoint(cp)}b`), 'a b', `0x${cp.toString(16)}`);
    }
  });
  test('U+2028 y U+2029 pasan a espacio', () => {
    assert.equal(sanitizeLogValue('a\u2028b\u2029c'), 'a b c');
  });
  test('bordes exteriores NO se tocan: 0x20, 0x7e, 0xa0, U+2027, U+202A', () => {
    for (const ch of [' ', '~', '\u00a0', '‧', '‪']) {
      assert.equal(sanitizeLogValue(`a${ch}b`), `a${ch}b`, JSON.stringify(ch));
    }
  });
  test('\\r\\n es dos caracteres: dos espacios (un reemplazo por carácter)', () => {
    assert.equal(sanitizeLogValue('x\r\ny'), 'x  y');
  });
  test('valor que es solo controles queda en espacios, misma longitud', () => {
    assert.equal(sanitizeLogValue('\n\n\n'), '   ');
  });
  test('objetos y errores se convierten a texto antes de sanear', () => {
    assert.equal(sanitizeLogValue({ toString: () => 'x\n::warning::y' }), 'x ::warning::y');
    assert.equal(sanitizeLogValue(new Error('e\n::add-mask::s')), 'Error: e ::add-mask::s');
  });
});

describe('QA F-21 (1b) sanitizeLogValue: recorte a 300 con «…»', () => {
  test('LOG_VALUE_MAX es 300', () => assert.equal(LOG_VALUE_MAX, 300));
  test('299 y 300 caracteres no se recortan', () => {
    for (const n of [299, 300]) {
      const s = 'a'.repeat(n);
      assert.equal(sanitizeLogValue(s), s);
    }
  });
  test('301 caracteres: 299 originales + «…» = 300', () => {
    const out = sanitizeLogValue('b'.repeat(301));
    assert.equal(cpLen(out), 300);
    assert.equal(out, `${'b'.repeat(299)}${ELLIPSIS}`);
  });
  test('el recorte se aplica después del reemplazo: 300 controles quedan en 300 espacios', () => {
    assert.equal(sanitizeLogValue('\n'.repeat(300)), ' '.repeat(300));
    assert.equal(sanitizeLogValue('\n'.repeat(301)), `${' '.repeat(299)}${ELLIPSIS}`);
  });
  test('un salto justo en la posición del corte no sobrevive', () => {
    const out = sanitizeLogValue(`${'c'.repeat(299)}\n::stop-commands::x`);
    assert.ok(!out.includes('\n'));
    assert.equal(cpLen(out), 300);
    assert.ok(out.endsWith(ELLIPSIS));
  });
  test('max pequeño válido (1 y 2)', () => {
    assert.equal(sanitizeLogValue('abc', 1), ELLIPSIS);
    assert.equal(sanitizeLogValue('abc', 2), `a${ELLIPSIS}`);
  });
  test('max negativo, decimal o texto cae a 300', () => {
    for (const m of [-5, 2.5, '10', Infinity]) {
      assert.equal(cpLen(sanitizeLogValue('z'.repeat(400), m)), 300, String(m));
    }
  });
});

// Run de la API con valores hostiles en todos los campos que pueden llegar al detalle.
const EVIL = 'failure\n::stop-commands::tok\r::add-mask::s\u0085::error::nel\u2028::warning::ls\u2029::debug::ps\u000b::group::vt\u000c::notice::ff';
const evilRun = (extra = {}) => ({
  id: 9, status: 'completed', conclusion: EVIL, event: 'schedule',
  created_at: at(-60), run_started_at: at(-60), updated_at: at(-59),
  html_url: `https://x.example/r\n::set-output name=a::b/${'q'.repeat(500)}`,
  ...extra,
});
const fakeFetch = (runs) => async (url) => {
  const u = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
  if (/\/actions\/workflows\/[^/]+\/runs/.test(u)) return json({ workflow_runs: runs });
  if (/\/actions\/workflows\/[^/]+$/.test(u)) return json(WF);
  if (/\/jobs/.test(u)) return json({ total_count: 0, jobs: [] });
  return json({});
};

async function runCheck({ runs, env = {}, argv = ['--only=workflows'] }) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-f21-'));
  try {
    const summary = join(dir, 'summary.md');
    const output = join(dir, 'out.txt');
    const lines = [];
    const res = await checkMain({
      argv,
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, ...env },
      fetchImpl: fakeFetch(runs), now: NOW, log: (s) => lines.push(s),
    });
    return { ...res, lines, summary: readFileSync(summary, 'utf8'), output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('QA F-21 (1c) check.js: ningún valor de la API abre una línea con "::"', () => {
  for (const [label, env] of [
    ['producción inactiva', { EVALUATION_ENABLED: 'false' }],
    ['producción activa', { EVALUATION_ENABLED: 'true' }],
    ['HEALTH_PLAIN_LOG=1', { EVALUATION_ENABLED: 'false', HEALTH_PLAIN_LOG: '1' }],
  ]) {
    test(`${label}: log, resumen y GITHUB_OUTPUT sin comandos inyectados`, async () => {
      const r = await runCheck({ runs: [evilRun()], env });
      // Hay al menos un detalle hostil que llega a la salida.
      assert.ok(r.results.some((x) => x.detail.includes('::stop-commands::')), 'fixture sin efecto');
      const logText = r.lines.join('\n');
      assert.equal(linesOf(logText).length, r.lines.length, 'alguna línea de log trae un separador');
      assert.ok(!injected(logText), logText);
      assert.ok(!injected(r.summary), r.summary);
      assert.ok(!injected(r.output), r.output);
      // Cada fila del resumen es una sola línea de tabla con 3 celdas.
      const rows = linesOf(r.summary).filter((l) => l.startsWith('| ') && !l.startsWith('| Check') );
      assert.equal(rows.length, r.results.length);
      for (const row of rows) assert.equal(row.split('|').length, 5, row);
    });
  }
  test('cada valor en log y resumen queda acotado a 300 caracteres', async () => {
    const r = await runCheck({ runs: [evilRun()], env: { EVALUATION_ENABLED: 'false' } });
    for (const l of r.lines.slice(0, r.results.length)) {
      const [, value] = l.split(/: (.*)/s);
      assert.ok(cpLen(value ?? '') <= LOG_VALUE_MAX, l);
    }
    for (const row of linesOf(r.summary).filter((l) => l.startsWith('| ') && !l.startsWith('| Check'))) {
      for (const cell of row.split('|').slice(1, -1)) assert.ok(cpLen(cell.trim()) <= LOG_VALUE_MAX, cell);
    }
  });
  test('una barra | de la API no rompe la tabla del resumen', async () => {
    const r = await runCheck({ runs: [evilRun({ conclusion: 'fail|ure\n| x | y |' })], env: { EVALUATION_ENABLED: 'false' } });
    const rows = linesOf(r.summary).filter((l) => l.startsWith('| ') && !l.startsWith('| Check'));
    for (const row of rows) assert.equal(row.split('|').length, 5, row);
  });
  test('--only con NEL, LS y PS se imprime en una sola línea, código 2', async () => {
    const lines = [];
    const { code } = await checkMain({ argv: ['--only=a\u0085::x::\u2028::y::\u2029::z::'], env: {}, fetchImpl: fakeFetch([]), log: (s) => lines.push(s) });
    assert.equal(code, 2);
    assert.equal(lines.length, 1);
    // La única anotación es la propia del script; el valor no abre otra línea.
    assert.equal(linesOf(lines[0]).length, 1, JSON.stringify(lines[0]));
    assert.match(lines[0], /^::error::--only inválido: a ::x::/);
  });
});

describe('QA F-21 (1c) issue.js: número del issue saneado', () => {
  for (const action of ['commented', 'created']) {
    test(`${action}: number hostil de la API → una sola línea, sin "::"`, async () => {
      const number = '5\n::stop-commands::k\u2028::add-mask::m';
      const github = async (url, init) => {
        const u = String(url);
        const json = (body, status = 200) => ({ ok: true, status, json: async () => body, headers: new Headers() });
        if (/\/issues\?state=open/.test(u)) return json(action === 'commented' ? [{ number }] : []);
        if (init?.method === 'POST' && /\/labels$/.test(u)) return json({}, 201);
        if (init?.method === 'POST' && /\/issues$/.test(u)) return json({ number }, 201);
        return json({}, 201);
      };
      const lines = [];
      const out = await issueMain({ env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', FAILURES: 'pages' }, fetchImpl: github, now: NOW, log: (s) => lines.push(s) });
      assert.equal(out.action, action);
      assert.equal(lines.length, 1);
      assert.equal(linesOf(lines[0]).length, 1, JSON.stringify(lines[0]));
      assert.ok(!injected(lines[0]), lines[0]);
      assert.match(lines[0], /^issue #5 /);
    });
  }
});

describe('QA F-21 (1d) los resultados ok/fail no cambian', () => {
  test('main devuelve los resultados sin sanear y el mismo código que sin valores hostiles', async () => {
    const r = await runCheck({ runs: [evilRun()], env: { EVALUATION_ENABLED: 'false' } });
    const ci = r.results.find((x) => x.check === 'seguridad-semanal');
    assert.equal(ci.status, 'fail');
    assert.ok(ci.detail.includes(EVIL), 'el detalle del resultado conserva el valor original');
    assert.equal(r.code, 1);
    assert.match(r.output, /failures=.*seguridad-semanal/);
  });
  test('run en success con valores largos/hostiles en html_url sigue ok', async () => {
    const r = await runCheck({ runs: [evilRun({ conclusion: 'success', event: 'schedule' })], env: { EVALUATION_ENABLED: 'false' } });
    const sec = r.results.find((x) => x.check === 'seguridad-semanal');
    assert.equal(sec.status, 'ok', sec.detail);
    const failures = r.output.trim().replace(/^failures=/, '').split(',').filter(Boolean);
    assert.ok(!failures.includes('seguridad-semanal'));
    assert.ok(r.lines.some((l) => l.startsWith('ok seguridad-semanal: ')));
  });
  test('assessWorkflow da el mismo estado con o sin controles en conclusion', () => {
    const rule = WORKFLOW_RULES.find((x) => x.check === 'seguridad-semanal');
    const clean = assessWorkflow(rule, { workflow: WF, runs: [evilRun({ conclusion: 'failure', html_url: 'u' })], now: NOW, productionEnabled: false });
    const dirty = assessWorkflow(rule, { workflow: WF, runs: [evilRun({ conclusion: 'failure\n::x::', html_url: 'u' })], now: NOW, productionEnabled: false });
    assert.equal(clean.status, 'fail');
    assert.equal(dirty.status, clean.status);
  });
});

describe('QA F-21 (2) checkWorkflows: id no verificable', () => {
  const runWith = (id, extra = {}) => ({ id, status: 'completed', conclusion: 'success', event: 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59), ...extra });
  const client = (runs) => {
    const calls = [];
    return {
      calls,
      getWorkflow: async () => WF,
      listRuns: async () => runs,
      listJobs: async (id) => {
        calls.push(id);
        return [];
      },
    };
  };
  for (const [label, id] of [
    ['2^53', 2 ** 53], ['-2^53', -(2 ** 53)], ['NaN', Number.NaN], ['Infinity', Infinity],
    ['booleano', true], ['objeto', { id: 1 }], ['array', [1]], ['BigInt', 7n], ['texto vacío', ''],
  ]) {
    test(`id ${label} → fail «id verificable», listJobs no se llama`, async () => {
      const gh = client([runWith(id)]);
      const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh, now: NOW, rules: STEP_RULES });
      assert.equal(gh.calls.length, 0);
      for (const r of out) {
        assert.equal(r.status, 'fail', r.detail);
        assert.match(r.detail, /el último run no tiene id verificable/);
        assert.doesNotMatch(r.detail, /sin jobs del último run/);
      }
    });
  }
  test('el más reciente sin id y uno antiguo con id → se juzga el más reciente: fail y sin jobs', async () => {
    const gh = client([runWith(42, { created_at: at(-120) }), runWith('42', { created_at: at(-30) })]);
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh, now: NOW, rules: STEP_RULES });
    assert.equal(gh.calls.length, 0, 'no debe pedir los jobs del run antiguo');
    for (const r of out) assert.match(r.detail, /el último run no tiene id verificable/);
  });
  test('id 0 (entero seguro) no es "id no verificable": pide jobs', async () => {
    const gh = client([runWith(0)]);
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh, now: NOW, rules: STEP_RULES });
    assert.equal(gh.calls.length, STEP_RULES.length);
    for (const r of out) assert.doesNotMatch(r.detail, /id verificable/);
  });
  test('producción inactiva con id inválido: skip, sin jobs y sin mensaje de id', async () => {
    const gh = client([runWith(null)]);
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'false' }, github: gh, now: NOW, rules: STEP_RULES });
    assert.equal(gh.calls.length, 0);
    for (const r of out) assert.equal(r.status, 'skip');
  });
  test('id inválido y conclusion failure: fail por la conclusión, sin pedir jobs', async () => {
    const gh = client([runWith(null, { conclusion: 'failure' })]);
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh, now: NOW, rules: STEP_RULES });
    assert.equal(gh.calls.length, 0);
    for (const r of out) {
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /terminó en failure/);
    }
  });
  test('el mensaje de id no verificable nombra el paso requerido de cada regla', async () => {
    const gh = client([runWith(undefined)]);
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh, now: NOW, rules: STEP_RULES });
    STEP_RULES.forEach((rule, i) => assert.ok(out[i].detail.includes(`"${rule.requiredStep}"`), out[i].detail));
  });
});

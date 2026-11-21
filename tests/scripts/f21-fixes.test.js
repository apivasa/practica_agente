// F-21 — Pruebas del desarrollador para H-F20-01 (valores de la API en una sola línea y acotados
// en log y resumen del job) y H-ARQ-F20-03 / QA-F20-02 (id no verificable antes que "sin jobs"). Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOG_VALUE_MAX, WORKFLOW_RULES, checkWorkflows, sanitizeLogValue } from '../../scripts/health/lib.js';
import { main } from '../../scripts/health/check.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const hasControl = (v) => Array.from(v).some((c) => {
  const cp = c.codePointAt(0);
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
});
const startsCommand = (text) => text.split('\n').some((l) => l.trimStart().startsWith('::') && !/^::(error|warning)::/.test(l));

describe('F-21 sanitizeLogValue (H-F20-01)', () => {
  test('saltos y controles pasan a espacio: una sola línea sin "::" al inicio', () => {
    const out = sanitizeLogValue('failure\n::stop-commands::x');
    assert.equal(out, 'failure ::stop-commands::x');
    assert.ok(!out.includes('\n'));
    for (const sep of ['\r', '\n', '\r\n', '\u0000', '\u001b', '\u001f', '\u007f', '\u0085', '\u2028', '\u2029', '\t', '\v', '\f']) {
      const v = sanitizeLogValue(`a${sep}::add-mask::b`);
      assert.ok(!hasControl(v), JSON.stringify(v));
      assert.ok(v.startsWith('a '), JSON.stringify(v));
    }
  });
  test('texto normal, acentos y emojis sin cambios', () => {
    for (const s of ['último run success — https://github.com/x/y/actions/runs/1', 'ñandú', 'a\u200bb', '😀 ok', '']) {
      assert.equal(sanitizeLogValue(s), s);
    }
  });
  test('valores no string: null/undefined → vacío, números a texto', () => {
    assert.equal(sanitizeLogValue(null), '');
    assert.equal(sanitizeLogValue(undefined), '');
    assert.equal(sanitizeLogValue(42), '42');
  });
  test(`recorta a ${LOG_VALUE_MAX} caracteres con «…»`, () => {
    assert.equal(LOG_VALUE_MAX, 300);
    const exact = 'x'.repeat(300);
    assert.equal(sanitizeLogValue(exact), exact);
    const long = sanitizeLogValue('y'.repeat(1000));
    assert.equal(Array.from(long).length, 300);
    assert.ok(long.endsWith('…'));
    assert.equal(sanitizeLogValue('abcdef', 4), 'abc…');
    // No parte pares sustitutos.
    const emo = sanitizeLogValue('😀'.repeat(400));
    assert.equal(Array.from(emo).length, 300);
    assert.ok(!/[\ud800-\udbff]…$/.test(emo));
  });
  test('max inválido cae al valor por defecto', () => {
    assert.equal(Array.from(sanitizeLogValue('z'.repeat(500), 0)).length, 300);
    assert.equal(Array.from(sanitizeLogValue('z'.repeat(500), Number.NaN)).length, 300);
  });
});

describe('F-21 check.js escribe detalles saneados (H-F20-01)', () => {
  const evil = 'failure\n::stop-commands::x\r\n::add-mask::y\u2028::error::z';
  const fakeFetch = async (url) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
    if (/\/actions\/workflows\/[^/]+\/runs/.test(u)) {
      return json({ workflow_runs: [{ id: 9, status: 'completed', conclusion: evil, event: 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59), html_url: `https://x.example/${'p'.repeat(400)}` }] });
    }
    if (/\/actions\/workflows\/[^/]+$/.test(u)) return json(WF);
    if (/\/jobs/.test(u)) return json({ total_count: 0, jobs: [] });
    return json({ workflow_runs: [] });
  };

  test('log y GITHUB_STEP_SUMMARY: cada valor en una sola línea, sin comandos "::" inyectados, acotado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'f21-'));
    try {
      const summary = join(dir, 'summary.md');
      const output = join(dir, 'out.txt');
      const lines = [];
      const { results } = await main({
        argv: ['--only=workflows'],
        env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', EVALUATION_ENABLED: 'false', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output },
        fetchImpl: fakeFetch, now: NOW, log: (s) => lines.push(s),
      });
      assert.ok(results.length > 0);
      // Los resultados no se tocan: solo la salida se sanea.
      assert.ok(results.some((r) => r.detail.includes('\n::stop-commands::')));
      const logText = lines.join('\n');
      assert.equal(logText.split('\n').length, lines.length, 'ninguna línea de log contiene saltos');
      assert.ok(!startsCommand(logText), logText);
      for (const l of lines) assert.ok(!hasControl(l), JSON.stringify(l));
      const sum = readFileSync(summary, 'utf8');
      assert.ok(!startsCommand(sum), sum);
      assert.ok(!/^::/m.test(sum));
      const rows = sum.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Check'));
      assert.equal(rows.length, results.length);
      for (const l of lines.slice(0, results.length)) assert.ok(l.length < 400, l);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--only con salto de línea se imprime en una sola línea', async () => {
    const lines = [];
    const { code } = await main({ argv: ['--only=x\n::stop-commands::y'], env: {}, fetchImpl: fakeFetch, log: (s) => lines.push(s) });
    assert.equal(code, 2);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('\n'));
  });
});

describe('F-21 checkWorkflows con id no verificable (H-ARQ-F20-03 / QA-F20-02)', () => {
  const rules = WORKFLOW_RULES.filter((r) => r.requiredStep);
  for (const badId of [undefined, null, '7', 7.5, Number.MAX_SAFE_INTEGER + 2, -0.1]) {
    test(`id ${String(badId)} → fail "id verificable", sin pedir jobs`, async () => {
      let jobCalls = 0;
      const github = {
        getWorkflow: async () => WF,
        listRuns: async () => [{ id: badId, status: 'completed', conclusion: 'success', event: 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59) }],
        listJobs: async () => {
          jobCalls += 1;
          return [];
        },
      };
      const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules });
      assert.equal(jobCalls, 0);
      assert.equal(out.length, rules.length);
      for (const r of out) {
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /el último run no tiene id verificable/);
        assert.doesNotMatch(r.detail, /sin jobs del último run/);
      }
    });
  }
  test('id válido sin jobs sigue diciendo "sin jobs del último run"', async () => {
    const github = {
      getWorkflow: async () => WF,
      listRuns: async () => [{ id: 7, status: 'completed', conclusion: 'success', event: 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59) }],
      listJobs: async () => [],
    };
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules });
    for (const r of out) {
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /sin jobs del último run/);
    }
  });
});

describe('F-21 sanitizeLogValue conserva el enlace al run (H-ARQ-F21-01 / QA-F21-01)', () => {
  const RUN_URL = 'https://github.com/apivasa/practica_agente/actions/runs/123456789012';
  const SEP = ' — ';
  // Sin buscar la URL como subcadena (CodeQL js/incomplete-url-substring-sanitization, ver F-08):
  // se separa por ' — ' y se compara la última parte con igualdad estricta.
  const parts = (s) => s.split(SEP);
  const lastPart = (s) => parts(s).at(-1);
  test('detalle corto con enlace: sin cambios', () => {
    assert.equal(sanitizeLogValue(`ultimo run success${SEP}${RUN_URL}`), `ultimo run success${SEP}${RUN_URL}`);
    assert.equal(sanitizeLogValue('sin enlace\n::x'), 'sin enlace ::x');
  });
  test('detalle > 300 que termina en enlace: se recorta el texto, el enlace sale completo y el total <= 300', () => {
    const detail = `${'problema largo; '.repeat(30)}failure\n::stop-commands::x${SEP}${RUN_URL}`;
    assert.ok(Array.from(detail).length > 300);
    const out = sanitizeLogValue(detail);
    const p = parts(out);
    assert.equal(p.length, 2, out);
    assert.equal(p[1], RUN_URL);
    assert.equal(Array.from(p[0]).at(-1), '…');
    assert.equal(Array.from(out).length, 300);
    assert.ok(!hasControl(out));
  });
  test('enlace con controles o que no es https: se recorta todo como un valor', () => {
    const bad = `${'x'.repeat(400)}${SEP}https://e.example/a\n::stop-commands::b`;
    const out = sanitizeLogValue(bad);
    assert.equal(Array.from(out).length, 300);
    assert.ok(!hasControl(out));
    assert.equal(Array.from(sanitizeLogValue(`${'x'.repeat(400)}${SEP}javascript:alert(1)`)).length, 300);
  });
  test('enlace enorme (no deja texto): se recorta todo a 300', () => {
    const out = sanitizeLogValue(`fallo${SEP}https://e.example/${'p'.repeat(400)}`);
    assert.equal(Array.from(out).length, 300);
    assert.equal(Array.from(out).at(-1), '…');
  });

  test('check.js: detalle > 300 con enlace -> enlace completo en log y resumen', async () => {
    const runUrl = 'https://github.com/apivasa/practica_agente/actions/runs/987654321098';
    const longConclusion = `failure\n::stop-commands::x ${'c'.repeat(300)}`;
    const fetchLong = async (url) => {
      const u = String(url);
      const json = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
      if (/\/actions\/workflows\/[^/]+\/runs/.test(u)) {
        return json({ workflow_runs: [{ id: 5, status: 'completed', conclusion: longConclusion, event: 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59), html_url: runUrl }] });
      }
      if (/\/actions\/workflows\/[^/]+$/.test(u)) return json(WF);
      return json({ workflow_runs: [], jobs: [], total_count: 0 });
    };
    const dir = mkdtempSync(join(tmpdir(), 'f21b-'));
    try {
      const summary = join(dir, 'summary.md');
      const lines = [];
      const { results } = await main({
        argv: ['--only=workflows'],
        env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', EVALUATION_ENABLED: 'false', GITHUB_STEP_SUMMARY: summary },
        fetchImpl: fetchLong, now: NOW, log: (s) => lines.push(s),
      });
      const withLink = results.map((r, i) => ({ r, i })).filter(({ r }) => lastPart(r.detail) === runUrl);
      assert.ok(withLink.some(({ r }) => Array.from(r.detail).length > 300), 'el doble no produjo detalles largos con enlace');
      // Filas del resumen en el mismo orden que results; la celda de detalle es la tercera.
      const rows = readFileSync(summary, 'utf8').split('\n').slice(2, 2 + results.length);
      assert.equal(rows.length, results.length);
      for (const { i } of withLink) {
        const l = lines[i];
        assert.equal(lastPart(l), runUrl, l);
        assert.ok(!hasControl(l));
        const row = rows[i];
        assert.equal(row.slice(-2), ' |', row);
        const detailCell = row.slice(2, -2).split(' | ')[2];
        assert.equal(lastPart(detailCell), runUrl, row);
        assert.ok(Array.from(detailCell).length <= LOG_VALUE_MAX, detailCell);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

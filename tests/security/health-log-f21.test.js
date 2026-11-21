// F-21 — Seguridad de la salida de scripts/health (H-F20-01): ningún valor que venga de la API de
// GitHub (conclusión de run o paso, nombre de paso, html_url, mensaje de error, número de issue)
// puede abrir una línea nueva en el log del job (comandos de workflow `::...::`) ni romper la tabla
// markdown de $GITHUB_STEP_SUMMARY.
// Categoría 5 (automatizaciones) y 3 (inyección). Sin red: fetch es un doble.
// Nota: el fuente no lleva caracteres de control ni espacios irregulares literales; solo escapes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOG_VALUE_MAX, WORKFLOW_RULES, sanitizeLogValue } from '../../scripts/health/lib.js';
import { main as checkMain } from '../../scripts/health/check.js';
import { main as issueMain } from '../../scripts/health/issue.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();

// Todo lo que algún consumidor (runner de Actions, navegador, editor, JS) puede tratar como fin de línea.
// Sin regex con escapes de control (no-control-regex de eslint): conjunto de code points.
const BREAK_CPS = new Set([0x0a, 0x0d, 0x0b, 0x0c, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029]);
function splitLines(s) {
  const out = [''];
  for (const c of String(s)) {
    if (BREAK_CPS.has(c.codePointAt(0))) out.push('');
    else out[out.length - 1] += c;
  }
  return out;
}
const hasBreak = (s) => splitLines(s).length > 1;
const isControl = (cp) => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
const hasControl = (s) => Array.from(s).some((c) => isControl(c.codePointAt(0)));

// Separadores hostiles para construir valores de la API.
const SEPS = ['\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029', '\u000b', '\u000c', '\u001e', '\u0000', '\u001b', '\u009b'];
const evil = (tag) => SEPS.map((s) => `${tag}${s}::add-mask::${tag}${s}::stop-commands::tok${s}::error file=x::pwn|col|`).join('');

// Líneas que el propio script emite con comando al inicio (prefijo fijo, no de la API).
const OWN_PREFIX = /^::(error|warning)::(FALLA|omitido|aviso|--only inválido:|salud:|issue de salud:) /;

function assertSafeLines(lines) {
  for (const l of lines) {
    assert.equal(typeof l, 'string');
    assert.equal(splitLines(l).length, 1, `salto de línea en la salida: ${JSON.stringify(l)}`);
    assert.ok(!hasControl(l), `carácter de control en la salida: ${JSON.stringify(l)}`);
    if (l.trimStart().startsWith('::')) assert.match(l, OWN_PREFIX, `comando de workflow no esperado: ${JSON.stringify(l)}`);
  }
}

function assertSafeSummary(text, nResults) {
  const lines = splitLines(text);
  // Encabezado, separador, una fila por resultado y la línea vacía final.
  assert.equal(lines.length, nResults + 3, JSON.stringify(text));
  assert.equal(lines[0], '| Check | Estado | Detalle |');
  assert.equal(lines[1], '|---|---|---|');
  for (const row of lines.slice(2, -1)) {
    assert.match(row, /^\| [^|]* \| [^|]* \| [^|]* \|$/, `fila de tabla rota: ${JSON.stringify(row)}`);
    assert.ok(!hasControl(row), JSON.stringify(row));
    assert.ok(!/^\s*::/.test(row));
    // Cada celda acotada.
    for (const cell of row.slice(2, -2).split(' | ')) assert.ok(Array.from(cell).length <= LOG_VALUE_MAX, cell.length);
  }
  assert.equal(lines.at(-1), '');
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });

/** fetch falso con valores hostiles en todos los campos de texto que el check reenvía. */
function hostileFetch(mode) {
  return async (url) => {
    const u = String(url);
    if (mode === 'reject') throw new Error(evil('net'));
    if (mode === 'badjson') return { ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError(evil('json')); } };
    if (/\/actions\/runs\/\d+\/jobs/.test(u)) {
      const steps = WORKFLOW_RULES.filter((r) => r.requiredStep).flatMap((r) => [
        { name: r.requiredStep, conclusion: evil('stepconc') },
        { name: evil('stepname'), conclusion: evil('stepconc2') },
      ]);
      return json({ total_count: 1, jobs: [{ id: 1, run_id: 77, steps }] });
    }
    if (/\/actions\/workflows\/[^/]+\/runs/.test(u)) {
      const conclusion = mode === 'success' ? 'success' : evil('conc');
      return json({
        workflow_runs: [
          { id: 77, status: 'completed', conclusion, event: /deploy/.test(u) ? 'push' : 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59), html_url: `https://github.com/o/r/actions/runs/77${evil('url')}` },
          { id: 76, status: 'completed', conclusion: evil('prev'), event: 'push', created_at: at(-120), run_started_at: at(-120), updated_at: at(-119), html_url: evil('url2') },
        ],
      });
    }
    if (/\/actions\/workflows\/[^/]+$/.test(u)) return json({ state: 'active', created_at: '2025-01-01T00:00:00Z' });
    return json({}, 200);
  };
}

describe('F-21 seguridad: sanitizeLogValue sobre todo el espacio Unicode', () => {
  test('ningún code point de control o separador sobrevive; el resto queda igual', () => {
    for (let cp = 0; cp <= 0x10ffff; cp += cp < 0x3000 ? 1 : 0x101) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const out = sanitizeLogValue(`a${ch}::x`);
      if (isControl(cp)) assert.equal(out, 'a ::x', `U+${cp.toString(16)}`);
      else assert.equal(out, `a${ch}::x`, `U+${cp.toString(16)}`);
      assert.equal(splitLines(out).length, 1, `U+${cp.toString(16)}`);
    }
  });
  test('sustitutos sueltos, objetos con toString hostil y cadenas enormes', () => {
    assert.equal(splitLines(sanitizeLogValue('a\ud800\n::b')).length, 1);
    assert.equal(sanitizeLogValue({ toString: () => 'x\n::add-mask::y' }), 'x ::add-mask::y');
    const big = sanitizeLogValue(`${'\n::'.repeat(200000)}`);
    assert.ok(Array.from(big).length <= LOG_VALUE_MAX);
    assert.ok(!hasControl(big));
  });
});

describe('F-21 seguridad: check.js con la API de Actions hostil', () => {
  for (const mode of ['fail', 'success', 'reject', 'badjson']) {
    for (const plain of ['0', '1']) {
      test(`modo ${mode}, HEALTH_PLAIN_LOG=${plain}: log, resumen y GITHUB_OUTPUT sin inyección`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'f21sec-'));
        try {
          const summary = join(dir, 'summary.md');
          const output = join(dir, 'out.txt');
          writeFileSync(summary, '');
          writeFileSync(output, '');
          const lines = [];
          const { results } = await checkMain({
            argv: ['--only=workflows'],
            env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', EVALUATION_ENABLED: 'true', HEALTH_PLAIN_LOG: plain, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output },
            fetchImpl: hostileFetch(mode), now: NOW, log: (s) => lines.push(s),
          });
          assert.ok(results.length >= WORKFLOW_RULES.length);
          // El doble es hostil de verdad: algún detalle crudo trae salto de línea o separador.
          assert.ok(results.some((r) => hasBreak(r.detail)), 'el doble no inyectó nada');
          assertSafeLines(lines);
          assertSafeSummary(readFileSync(summary, 'utf8'), results.length);
          // GITHUB_OUTPUT: una sola línea failures=<nombres de check fijos>.
          const out = readFileSync(output, 'utf8');
          assert.match(out, /^failures=[a-z0-9,-]*\n$/);
          const known = new Set([...WORKFLOW_RULES.map((r) => r.check), 'deploy-main', 'actions-api', 'pages', 'supabase']);
          for (const f of out.slice(9, -1).split(',').filter(Boolean)) assert.ok(known.has(f), f);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});

describe('F-21 seguridad: issue.js con número de issue hostil', () => {
  const bad = ['7\n::add-mask::x', '7\r::stop-commands::y', '7\u2028::error::z', '7\u0085::warning::w', { toString: () => '1\n::x::' }];
  for (const [i, number] of bad.entries()) {
    for (const path of ['comment', 'create']) {
      test(`caso ${i} (${path}): una sola línea de log sin comando`, async () => {
        const fetchImpl = async (url, init) => {
          const u = String(url);
          if (u.includes('/issues?state=open')) return json(path === 'comment' ? [{ number }] : []);
          if (init?.method === 'POST' && u.endsWith('/issues')) return json({ number });
          return json({}, 201);
        };
        const lines = [];
        await issueMain({ env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', FAILURES: 'ci-main', RUN_URL: 'https://github.com/o/r/actions/runs/1' }, fetchImpl, now: NOW, log: (s) => lines.push(s) });
        assert.equal(lines.length, 1);
        assertSafeLines(lines);
        assert.match(lines[0], /^issue #/);
      });
    }
  }
});

describe('F-21 reintento 1 seguridad: recorte que conserva el enlace final (2591cfc)', () => {
  const SEP = ' — ';
  const body = (n) => `último run terminó en ${'x'.repeat(n)}`;
  const assertOneSafeLine = (out, max = LOG_VALUE_MAX) => {
    assert.equal(splitLines(out).length, 1, JSON.stringify(out));
    assert.ok(!hasControl(out), JSON.stringify(out));
    assert.ok(Array.from(out).length <= max, String(Array.from(out).length));
  };
  // Enlaces hostiles: ninguno puede salir con salto, control o pasarse del máximo.
  const links = [
    'https://github.com/o/r/actions/runs/1',
    'https://github.com/o/r/actions/runs/1|col|col',
    'https://github.com/o/r/actions/runs/1%0A::add-mask::x',
    'https://github.com/o/r/actions/runs/1%0D%0A::stop-commands::t',
    'https://github.com/o/r/actions/runs/1\n::add-mask::x',
    'https://github.com/o/r/actions/runs/1\r::stop-commands::t',
    'https://github.com/o/r/actions/runs/1\u0085::error::z',
    'https://github.com/o/r/actions/runs/1\u009b31m',
    'https://github.com/o/r/actions/runs/1\u2028::error::z',
    'https://github.com/o/r/actions/runs/1\u2029::error::z',
    'https://github.com/o/r/actions/runs/1\u0000x',
    'https://github.com/o/r/actions/runs/1\u00A0::x',
    'https://github.com/o/r/\ud800x',
    `https://github.com/${'p'.repeat(400)}`,
    'javascript:alert(1)',
    'http://github.com/o/r/actions/runs/1',
  ];
  for (const [i, link] of links.entries()) {
    test(`enlace hostil ${i}: una línea, sin controles, <= ${LOG_VALUE_MAX}`, () => {
      for (const n of [0, 10, 300, 1000]) {
        const input = `${body(n)}${SEP}${link}`;
        const out = sanitizeLogValue(input);
        assertOneSafeLine(out);
        // Con recorte, si no termina en «…» es que se conservó el enlace: https, sin controles ni espacios.
        if (Array.from(input).length > LOG_VALUE_MAX && !out.endsWith('…')) {
          assert.ok(out.includes(`${SEP}https://`), JSON.stringify(out));
          const kept = out.slice(out.lastIndexOf(SEP) + SEP.length);
          assert.ok(!/\s/.test(kept), JSON.stringify(kept));
        }
      }
    });
  }
  test('enlace con controles nunca se conserva crudo (se sanea con el resto)', () => {
    const out = sanitizeLogValue(`${body(400)}${SEP}https://github.com/o/r/actions/runs/1\n::add-mask::x`);
    assert.ok(!out.includes('\n'));
    assert.ok(out.endsWith('…'));
  });
  test('enlace legítimo se conserva completo y el total queda acotado', () => {
    const link = 'https://github.com/apivasa/practica_agente/actions/runs/44925653549';
    const out = sanitizeLogValue(`${body(1000)}${SEP}${link}`);
    assert.ok(out.endsWith(`${SEP}${link}`));
    assert.equal(Array.from(out).length, LOG_VALUE_MAX);
  });
  test('"enlace" inyectado en conclusion (separador en medio y al final): una línea, acotado', () => {
    const conc = `failure${SEP}https://evil.example/a\n::add-mask::b${SEP}https://evil.example/${'q'.repeat(50)}`;
    for (const n of [0, 400]) assertOneSafeLine(sanitizeLogValue(`${body(n)} ${conc}`));
    for (const max of [1, 5, 21, 25, 40]) assertOneSafeLine(sanitizeLogValue(`${body(400)}${SEP}https://github.com/o/r`, max), max);
  });
  test('check.js de extremo a extremo con html_url largo y con | o %0A: tabla intacta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'f21sec-r1-'));
    try {
      const summary = join(dir, 'summary.md');
      writeFileSync(summary, '');
      const lines = [];
      const urls = ['https://github.com/o/r/actions/runs/77|a|b', 'https://github.com/o/r/actions/runs/77%0A::add-mask::x'];
      let k = 0;
      const fetchImpl = async (url) => {
        const u = String(url);
        if (/\/actions\/workflows\/[^/]+\/runs/.test(u)) {
          const html_url = urls[k++ % urls.length];
          return json({ workflow_runs: [{ id: 77, status: 'completed', conclusion: `failure${'z'.repeat(400)}`, event: /deploy/.test(u) ? 'push' : 'schedule', created_at: at(-60), run_started_at: at(-60), updated_at: at(-59), html_url }] });
        }
        if (/\/actions\/workflows\/[^/]+$/.test(u)) return json({ state: 'active', created_at: '2025-01-01T00:00:00Z' });
        return json({ total_count: 0, jobs: [] });
      };
      const { results } = await checkMain({
        argv: ['--only=workflows'],
        env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', EVALUATION_ENABLED: 'true', GITHUB_STEP_SUMMARY: summary },
        fetchImpl, now: NOW, log: (s) => lines.push(s),
      });
      assertSafeLines(lines);
      assertSafeSummary(readFileSync(summary, 'utf8'), results.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-21 seguridad: inventario estático de puntos de impresión en scripts/health', () => {
  const SINKS = /\b(log|console\.(log|error|warn|info|debug)|appendFileSync|writeFileSync|process\.(stdout|stderr)\.write)\(/;
  // Interpolaciones permitidas sin sanear: valores construidos solo con constantes del propio script.
  const ALLOWED = new Set(["failures.join(',')", "out.action === 'created' ? 'creado' : 'comentado'", 'tag']);
  const SANITIZED = /^(sanitizeLogValue|cell)\(/;

  function interpolations(line) {
    const found = [];
    for (let i = line.indexOf('${'); i !== -1; i = line.indexOf('${', i + 2)) {
      let depth = 1;
      let j = i + 2;
      for (; j < line.length && depth > 0; j++) {
        if (line[j] === '{') depth++;
        else if (line[j] === '}') depth--;
      }
      found.push(line.slice(i + 2, j - 1).trim());
    }
    return found;
  }

  test('lib.js no imprime nada por sí misma', () => {
    const src = readFileSync(new URL('../../scripts/health/lib.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /console\.|appendFileSync|writeFileSync|process\.(stdout|stderr)/);
  });

  for (const file of ['check.js', 'issue.js']) {
    test(`${file}: toda interpolación en un punto de impresión está saneada o es constante`, () => {
      const src = readFileSync(new URL(`../../scripts/health/${file}`, import.meta.url), 'utf8');
      const lines = src.split('\n');
      let sinks = 0;
      for (const [n, line] of lines.entries()) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        const isSink = SINKS.test(line) || /\bresults\.map\(/.test(line);
        if (!isSink) continue;
        sinks++;
        for (const expr of interpolations(line)) {
          assert.ok(SANITIZED.test(expr) || ALLOWED.has(expr), `${file}:${n + 1} interpolación sin sanear: \${${expr}}`);
        }
        // Sin concatenación de valores fuera de plantilla (p. ej. log('x' + e.message)).
        assert.doesNotMatch(line, /\+\s*(e|err|r|out)\b/, `${file}:${n + 1}`);
      }
      assert.ok(sinks >= (file === 'check.js' ? 5 : 2), `${file}: inventario de puntos de impresión incompleto (${sinks})`);
    });
  }

  test('el resumen pasa cada celda por cell(), que sanea y cambia | por /', () => {
    const src = readFileSync(new URL('../../scripts/health/check.js', import.meta.url), 'utf8');
    assert.match(src, /const cell = \(v\) => sanitizeLogValue\(v\)\.replace\(\/\\\|\/g, '\/'\);/);
    assert.match(src, /\| \$\{cell\(r\.check\)\} \| \$\{cell\(r\.status\)\} \| \$\{cell\(r\.detail\)\} \|/);
  });
});

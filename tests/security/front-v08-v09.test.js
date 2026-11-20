// V-08 + V-09 — Pruebas de seguridad del candado vigente hoy y del mapa único de alcances
// (categorías 1, 3, 4 y 5). Sin dependencias: node:test y un document falso.
//
// - XSS: change_ref, motivo, alcance, color, nivel y restricciones hostiles llegan al DOM de
//   lockTodayInfo solo como texto ("Inicio autorizado: <payload>" literal).
// - Aislamiento por unidad (defensa en profundidad sobre RLS): evaluaciones y excepciones de
//   otra unidad que llegaran al cliente no cambian el candado de hoy de la unidad pedida
//   (una suspensión total de Beta no levanta el congelamiento de Alfa).
// - Entradas hostiles: meses "__proto__"/"constructor", colores desconocidos, filas no objeto,
//   change_ref no texto: no rompen la vista ni contaminan prototipos.
// - scopeLabel por lista blanca: claves heredadas (__proto__, constructor, toString) salen literales.
// - Solo vista: lockToday/unitLockToday no se usan en scripts/ ni supabase/ (las Actions no
//   aplican candados con lo que calcula el cliente) y las vistas no escriben nada nuevo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "javascript:alert('x')",
  '<svg/onload=alert(1)>', '{{constructor.constructor("alert(1)")()}}',
];

const created = [];
globalThis.document = {
  createElement(tag) {
    const n = {
      tag, attrs: {}, listeners: {}, children: [], _text: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(k, fn) { this.listeners[k] = fn; },
      append(...c) { this.children.push(...c); },
      replaceChildren(...c) { this.children = c; },
      set textContent(v) { this._text = String(v); this.children = []; },
      get textContent() { return this._text; },
    };
    created.push(n);
    return n;
  },
  createTextNode: (t) => ({ text: t }),
};

const parts = await import('../../src/views/dashboard-parts.js');
const dash = await import('../../src/lib/dashboard.js');
const exLogic = await import('../../src/lib/exceptions-logic.js');
const { lockToday } = await import('../../engine/lock.js');

function assertInertTree(label) {
  for (const n of created) {
    assert.ok(!['script', 'iframe', 'object', 'embed', 'img', 'svg', 'a', 'base', 'meta', 'link', 'style'].includes(n.tag), `${label}: <${n.tag}>`);
    for (const k of Object.keys(n.attrs)) assert.doesNotMatch(k, /^on/i, `${label}: atributo ${k}`);
    if (n.attrs.class) assert.match(n.attrs.class, /^[a-z0-9 _-]+$/i, `${label}: clase armada con datos: ${n.attrs.class}`);
  }
}
const allText = () => created.flatMap((n) => [n._text, ...n.children.filter((c) => c && 'text' in c).map((c) => c.text)]);

const ALFA = '22222222-2222-4222-8222-000000000001';
const BETA = '22222222-2222-4222-8222-000000000002';
const TODAY = '2026-11-20';
const FROZEN = ['freeze_all_change', 'all_capacity_to_run'];
// Alfa en rojo octubre y noviembre (Q4): congelada hoy.
const closure = (unit) => [
  { unit_id: unit, indicator_id: null, month: '2026-10', color: 'red', escalation_level: 'restricted', restrictions: [] },
  { unit_id: unit, indicator_id: null, month: '2026-11', color: 'red', escalation_level: 'frozen', restrictions: FROZEN },
];
const ex = (unit, scope, i, extra = {}) => ({
  id: `x-${unit.slice(-1)}-${i}`, unit_id: unit, scope, reason: PAYLOADS[i % PAYLOADS.length],
  change_ref: scope === 'change_start' ? PAYLOADS[i % PAYLOADS.length] : null,
  expires_on: '2026-12-01', revoked_at: null, ...extra,
});

describe('3 · 4 · XSS en el candado de hoy (V-08)', () => {
  test('"Inicio autorizado: REF" con change_ref hostil sale literal y el árbol es inerte', () => {
    created.length = 0;
    const exceptions = PAYLOADS.map((_, i) => ex(ALFA, 'change_start', i));
    const lock = dash.unitLockToday({ unitId: ALFA, evaluations: closure(ALFA), exceptions, today: TODAY });
    assert.equal(lock.ok, true);
    assert.equal(lock.level, 'frozen', 'el inicio puntual no levanta el congelamiento');
    parts.lockTodayInfo(lock);
    assertInertTree('lockTodayInfo');
    const texts = allText();
    for (const p of PAYLOADS) assert.ok(texts.includes(`Inicio autorizado: ${p}`), `no aparece literal: ${p}`);
    // Los textos con payload van por textContent, nunca como atributo.
    for (const n of created) for (const v of Object.values(n.attrs)) for (const p of PAYLOADS) assert.ok(!String(v).includes(p));
  });

  test('resultado de lock manipulado (nivel, restricciones, etiquetas, basis hostiles) se pinta como texto', () => {
    created.length = 0;
    parts.lockTodayInfo({
      ok: true, level: PAYLOADS[0], restrictions: [PAYLOADS[1], '__proto__', 'constructor'],
      authorizedLabels: [PAYLOADS[3]], basis: PAYLOADS[4],
    });
    assertInertTree('lockTodayInfo manipulado');
    const texts = allText().join('\n');
    for (const p of [PAYLOADS[0], PAYLOADS[1], PAYLOADS[3], PAYLOADS[4]]) assert.ok(texts.includes(p), `no literal: ${p}`);
    created.length = 0;
    parts.lockTodayInfo({ ok: false, reason: PAYLOADS[1] });
    parts.lockTodayInfo({ ok: true, restrictions: 'no-array', authorizedLabels: { length: 2 } });
    parts.lockTodayInfo(null);
    assertInertTree('lockTodayInfo no ok');
    assert.ok(allText().includes(PAYLOADS[1]));
  });

  test('change_ref no texto (objeto, número) no rompe la vista: estado inválido, sin ejecutar nada', () => {
    created.length = 0;
    for (const ref of [{ toString: 'x' }, 42, ['<b>'], '   ']) {
      const lock = dash.unitLockToday({
        unitId: ALFA, evaluations: closure(ALFA), exceptions: [ex(ALFA, 'change_start', 0, { change_ref: ref })], today: TODAY,
      });
      assert.equal(lock.ok, false, `change_ref ${JSON.stringify(ref)}`);
      parts.lockTodayInfo(lock);
    }
    assertInertTree('change_ref no texto');
  });
});

describe('1 · aislamiento por unidad en el candado de hoy (defensa en profundidad)', () => {
  test('una suspensión total de otra unidad no levanta el congelamiento de la unidad pedida', () => {
    const lock = lockToday({
      unitId: ALFA, evaluations: closure(ALFA),
      exceptions: [ex(BETA, 'all', 0), ex(BETA, 'change_start', 1), { ...ex(ALFA, 'all', 2), unit_id: ` ${ALFA}` }],
      today: TODAY,
    });
    assert.equal(lock.ok, true);
    assert.equal(lock.level, 'frozen');
    assert.deepEqual(lock.appliedExceptions, []);
    assert.deepEqual(lock.authorizedStarts, []);
  });

  test('evaluaciones de otra unidad o por indicador no forman el cierre de la unidad', () => {
    const lock = lockToday({
      unitId: ALFA,
      evaluations: [...closure(BETA), { ...closure(ALFA)[1], indicator_id: 'i-1' }],
      exceptions: [], today: TODAY,
    });
    assert.equal(lock.ok, false);
    assert.equal(lock.status, 'no_closure');
  });

  test('la excepción revocada o vencida de la unidad no se aplica (no se falsea "En excepción")', () => {
    for (const extra of [{ revoked_at: '2026-11-19T15:00:00Z' }, { expires_on: '2026-11-19' }]) {
      const lock = lockToday({ unitId: ALFA, evaluations: closure(ALFA), exceptions: [ex(ALFA, 'all', 0, extra)], today: TODAY });
      assert.equal(lock.level, 'frozen', JSON.stringify(extra));
    }
  });

  test('unitId vacío o no texto: error controlado, no candado de "todas las unidades"', () => {
    for (const unitId of ['', null, undefined, {}]) {
      const lock = dash.unitLockToday({ unitId, evaluations: closure(ALFA), exceptions: [ex(ALFA, 'all', 0)], today: TODAY });
      assert.equal(lock.ok, false, String(unitId));
    }
  });
});

describe('3 · entradas hostiles al motor del candado de hoy', () => {
  test('meses "__proto__"/"constructor" y colores desconocidos no contaminan ni rompen', () => {
    const evaluations = [
      ...closure(ALFA),
      { unit_id: ALFA, indicator_id: null, month: '__proto__', color: 'green' },
      { unit_id: ALFA, indicator_id: null, month: 'constructor', color: 'green' },
      'no-objeto', null, 42,
    ];
    const lock = lockToday({ unitId: ALFA, evaluations, exceptions: ['x', null, 7], today: TODAY });
    assert.equal(lock.level, 'frozen');
    assert.equal({}.color, undefined, 'Object.prototype contaminado');
    const bad = lockToday({ unitId: ALFA, evaluations: [{ ...closure(ALFA)[1], color: PAYLOADS[0] }], exceptions: [], today: TODAY });
    assert.equal(bad.ok, false);
    assert.ok(!bad.reason.includes(PAYLOADS[0]), 'el mensaje de error no refleja datos');
  });

  test('evaluaciones o excepciones que no son arreglo, y fecha inválida, no lanzan desde la vista', () => {
    for (const today of [TODAY, 'x', '2026-02-30', null]) {
      const lock = dash.unitLockToday({ unitId: ALFA, evaluations: 'x', exceptions: { length: 1 }, today });
      assert.equal(lock.ok, false);
    }
  });

  test('un mes futuro guardado no se usa como cierre vigente', () => {
    const lock = lockToday({
      unitId: ALFA, exceptions: [], today: TODAY,
      evaluations: [{ unit_id: ALFA, indicator_id: null, month: '2027-01', color: 'green' }],
    });
    assert.equal(lock.ok, false);
  });
});

describe('3 · V-09 · scopeLabel por lista blanca', () => {
  test('claves heredadas y payloads salen literales; las conocidas, con su etiqueta', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', ...PAYLOADS]) {
      assert.equal(exLogic.scopeLabel(k), k);
      assert.equal(dash.scopeLabel(k), k);
    }
    assert.equal(exLogic.scopeLabel(null), '—');
    assert.equal(typeof exLogic.scopeLabel({ toString: () => 'x' }), 'string');
    assert.equal(dash.SCOPE_LABELS, exLogic.SCOPE_LABELS, 'un solo mapa');
    assert.ok(Object.isFrozen(exLogic.SCOPE_LABELS));
  });

  test('exceptionsTable con alcance heredado no pinta [object ...] ni funciones', () => {
    created.length = 0;
    const list = dash.activeExceptions(
      ['__proto__', 'constructor', 'toString'].map((scope, i) => ({ ...ex(ALFA, 'all', i), scope })), TODAY,
    );
    parts.exceptionsTable(list, () => 'U');
    assertInertTree('exceptionsTable');
    const texts = allText().join('\n');
    assert.doesNotMatch(texts, /\[object |function |native code/);
  });

  test('SCOPE_LABELS se define en un solo archivo de src/', () => {
    const files = [];
    const walk = (d) => {
      for (const f of readdirSync(join(ROOT, d))) {
        const p = join(d, f);
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk('src');
    const defs = files.filter((f) => /\bconst\s+SCOPE_LABELS\s*=/.test(read(f)));
    assert.deepEqual(defs, [join('src', 'lib', 'exceptions-logic.js')]);
  });
});

describe('5 · el candado de hoy es solo vista', () => {
  test('lockToday/unitLockToday no se usan en scripts/ ni supabase/ (las Actions no aplican candados desde el cliente)', () => {
    const hits = [];
    const walk = (d) => {
      for (const f of readdirSync(join(ROOT, d))) {
        const p = join(d, f);
        if (statSync(join(ROOT, p)).isDirectory()) { if (f !== 'node_modules') walk(p); } else if (/\.(js|mjs|sql|ya?ml)$/.test(p) && /\b(unitLockToday|lockToday)\b/.test(read(p))) hits.push(p);
      }
    };
    for (const d of ['scripts', 'supabase', '.github']) walk(d);
    assert.deepEqual(hits, []);
  });

  test('los tableros del líder y del comité solo importan lecturas (y markAlertRead) de la capa de datos', () => {
    for (const f of ['src/views/unit_leader/home.js', 'src/views/committee/home.js']) {
      const src = read(f);
      const imported = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/data\/[^']+'/g)]
        .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
      for (const name of imported) assert.ok(/^list[A-Z]/.test(name) || name === 'markAlertRead', `${f}: ${name}`);
      assert.doesNotMatch(src, /\.(insert|update|upsert|delete|rpc)\(/, `${f}: escritura directa`);
      assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, `${f}: sink HTML`);
    }
  });

  test('dashboard-parts.js y dashboard.js no usan sinks HTML', () => {
    for (const f of ['src/views/dashboard-parts.js', 'src/lib/dashboard.js', 'engine/lock.js']) {
      assert.doesNotMatch(read(f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, f);
    }
  });
});

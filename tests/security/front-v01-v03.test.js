// V-01 + V-02 + V-03 — Pruebas de seguridad de los tableros (categorías 1, 3 y 4).
// Sin dependencias: node:test y un document falso.
//
// - XSS: nombres de unidad/indicador, motivos y refs. de excepción, razones y
//   restricciones de evaluación y el payload JSON de alerts llegan al DOM solo como
//   texto; ninguna clase CSS ni atributo se arma con datos sin lista blanca.
// - Payload de alerts hostil (no objeto, message no string, __proto__) no rompe ni
//   contamina prototipos.
// - Marcar alerta como leída: la capa de datos solo envía { read_at } filtrado por id.
// - Capa de datos nueva: solo lecturas (salvo read_at), sin claves ni service role.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "javascript:alert('x')",
  '<svg/onload=alert(1)>', '{{constructor.constructor("alert(1)")()}}',
];

// document falso mínimo: registra atributos, listeners y nodos de texto.
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

/** Ningún nodo creado es ejecutable ni lleva un payload en atributos sensibles. */
function assertInertTree(label) {
  for (const n of created) {
    assert.ok(!['script', 'iframe', 'object', 'embed', 'img', 'svg', 'a', 'base', 'meta', 'link', 'style'].includes(n.tag), `${label}: <${n.tag}>`);
    for (const k of Object.keys(n.attrs)) assert.doesNotMatch(k, /^on/i, `${label}: atributo ${k}`);
    if (n.attrs.class) assert.match(n.attrs.class, /^[a-z0-9 _-]+$/i, `${label}: clase armada con datos: ${n.attrs.class}`);
    for (const ev of Object.keys(n.listeners)) assert.equal(typeof n.listeners[ev], 'function');
  }
}

const allText = () => created.flatMap((n) => [n._text, ...n.children.filter((c) => c && 'text' in c).map((c) => c.text)]);

describe('4 · XSS en los tableros V-01/V-02/V-03', () => {
  test('alertsInbox: kind, message y sent_at hostiles van como texto; solo un listener click', () => {
    created.length = 0;
    const alerts = PAYLOADS.map((p, i) => ({
      id: p, unit_id: p, kind: p, payload: { message: p, severity: p }, sent_at: p, read_at: i % 2 ? p : null,
    }));
    parts.alertsInbox({ alerts, onRead: async () => {}, title: PAYLOADS[1] });
    assertInertTree('alertsInbox');
    const texts = allText().join('\n');
    for (const p of PAYLOADS) assert.ok(texts.includes(p), `no aparece literal: ${p}`);
    const buttons = created.filter((n) => n.tag === 'button');
    assert.ok(buttons.length > 0);
    for (const b of buttons) assert.deepEqual(Object.keys(b.listeners), ['click']);
  });

  test('exceptionsTable: motivo, ref. de change, alcance y vencimiento hostiles como texto', () => {
    created.length = 0;
    const list = PAYLOADS.map((p) => ({ unit_id: p, scope: p, reason: p, change_ref: p, expires_on: p }));
    parts.exceptionsTable(list, (id) => `U:${id}`, PAYLOADS[0]);
    assertInertTree('exceptionsTable');
    const tds = created.filter((n) => n.tag === 'td');
    assert.ok(tds.length >= PAYLOADS.length * 5);
    for (const td of tds) assert.equal(td.children.length, 0, 'td con hijos: debería ser solo textContent');
  });

  test('escalationInfo/colorBadge: nivel, restricciones y color hostiles; clase por lista blanca', () => {
    created.length = 0;
    for (const p of PAYLOADS) {
      parts.escalationInfo({ escalation_level: p, restrictions: [p, { toString: () => p }] });
      parts.colorBadge(p);
    }
    parts.escalationInfo({ escalation_level: 'frozen', restrictions: PAYLOADS[0] }); // no array
    assertInertTree('escalationInfo');
    for (const b of created.filter((n) => n.tag === 'span' && /badge/.test(n.attrs.class ?? ''))) {
      assert.equal(b.attrs.class, 'badge badge-not_evaluated');
    }
  });

  test('monthPicker: opciones hostiles quedan en value/texto, sin listeners salvo change', () => {
    created.length = 0;
    parts.monthPicker('m', PAYLOADS, PAYLOADS[0], () => {});
    assertInertTree('monthPicker');
    const sel = created.find((n) => n.tag === 'select');
    assert.deepEqual(Object.keys(sel.listeners), ['change']);
  });

  test('las vistas V-01..V-03 no usan sumideros HTML ni URLs armadas con datos', () => {
    const views = ['src/views/unit_leader/home.js', 'src/views/committee/home.js', 'src/views/kpi_manager/completeness.js', 'src/views/dashboard-parts.js', 'src/lib/dashboard.js'];
    const SINKS = new RegExp(['\\.inner' + 'HTML', '\\.outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document\\.wr' + 'ite', 'srcdoc', 'srcset', 'ev' + 'al\\(', 'new Fun' + 'ction', "el\\('(script|iframe|object|embed|frame|base|meta|link|style|img)'", 'set' + 'Attribute\\([\'"]on', "href:\\s*[^\\s`'\"#]", "href:\\s*`[^#]", 'location\\.href\\s*='].join('|'));
    for (const v of views) assert.doesNotMatch(read(v), SINKS, `${v} usa un sumidero o atributo peligroso`);
  });
});

describe('3 · payload JSON de alerts hostil', () => {
  test('describeAlert tolera payload no objeto, message no string y claves de prototipo', () => {
    const cases = [null, 'x', 42, [], { message: { toString: () => '<b>x</b>' } }, { message: ['<i>'] },
      JSON.parse('{"__proto__": {"polluted": true}, "message": "ok"}'), { message: '   ' }];
    for (const payload of cases) {
      const d = dash.describeAlert({ id: 'a', kind: 'color_change', payload, sent_at: '2027-02-01T10:00:00Z' });
      assert.equal(typeof d.message, 'string');
      assert.equal(typeof d.high, 'boolean');
    }
    assert.equal({}.polluted, undefined, 'prototipo contaminado');
    assert.equal(dash.describeAlert({ kind: 'color_change', payload: { message: { a: 1 } } }).message, 'Cambio de color');
    assert.equal(dash.describeAlert({ kind: 'constructor' }).kind, 'constructor', 'kind desconocido sale literal, no del prototipo');
    assert.equal(dash.describeAlert({ kind: '__proto__' }).kind, '__proto__');
  });

  test('etiquetas por lista blanca propia: claves heredadas no resuelven', () => {
    for (const k of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.equal(dash.colorKey(k), 'not_evaluated');
      assert.equal(dash.colorLabel(k), k);
      assert.equal(dash.restrictionLabel(k), k);
      assert.equal(dash.scopeLabel(k), k);
    }
  });
});

describe('1 · capa de datos nueva (alerts, evaluations, targets, …)', () => {
  const files = ['src/data/alerts.js', 'src/data/evaluations.js', 'src/data/targets.js', 'src/data/exceptions.js', 'src/data/measurements.js', 'src/data/commitments.js'];

  test('alerts.js: solo select y update({ read_at }) filtrado por id y read_at nulo', () => {
    const s = read('src/data/alerts.js');
    assert.doesNotMatch(s, /\.(insert|upsert|delete|rpc)\(/);
    assert.equal((s.match(/\.update\(/g) ?? []).length, 1, 'se esperaba un solo update');
    assert.match(s, /\.update\(\{\s*read_at:\s*new Date\(\)\.toISOString\(\)\s*\}\)\s*\.eq\('id', id\)\.is\('read_at', null\)/);
    assert.match(s, /\.eq\('recipient_user_id', userId\)/, 'la bandeja debe filtrar por destinatario');
  });

  test('evaluations/targets: solo lectura desde el front', () => {
    for (const f of ['src/data/evaluations.js', 'src/data/targets.js']) {
      assert.doesNotMatch(read(f), /\.(insert|upsert|update|delete|rpc)\(/, f);
    }
  });

  test('sin claves secretas ni service role en la capa de datos', () => {
    for (const f of files) {
      const s = read(f);
      assert.doesNotMatch(s, new RegExp('sb_' + 'secret_|service_' + 'role|SECRET_KEY'), f);
    }
  });

  test('V-03 (completitud) es solo de la gestora; V-01/V-02 por rol en el registro de rutas', async () => {
    const { ROUTES, resolveRoute } = await import('../../src/lib/route-logic.js');
    const r = ROUTES.find((x) => x.path === '/gestora/completitud');
    assert.equal(r?.role, 'kpi_manager');
    for (const role of ['custodian', 'committee', 'unit_leader']) {
      const res = resolveRoute('/gestora/completitud', { authenticated: true, roles: [role] });
      assert.notEqual(res.view, 'kpi-completeness', `${role} llega a completitud`);
      assert.equal(res.redirected, true);
    }
    assert.equal(resolveRoute('/gestora/completitud', { authenticated: false }).view, 'login');
    assert.equal(resolveRoute('/gestora/completitud', { authenticated: true, roles: ['kpi_manager'] }).view, 'kpi-completeness');
  });
});

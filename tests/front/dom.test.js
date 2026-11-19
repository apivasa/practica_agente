// H-F05-02 — el() rechaza on* que no sean función y URL con esquemas peligrosos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, isSafeUrl, checkProp } from '../../src/views/dom.js';

function fakeDocument() {
  const make = (tag) => ({
    tag, attrs: {}, listeners: {}, children: [], textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, fn) { this.listeners[k] = fn; },
    append(c) { this.children.push(c); },
  });
  return { createElement: make, createTextNode: (t) => ({ text: t }) };
}

test('isSafeUrl: http, https, anclas y relativas sí; javascript, data, vbscript no', () => {
  for (const u of ['#/gestora', 'https://example.test/x', 'http://x', 'otra/ruta', '/abs', '?q=1', '//cdn.example.test/a']) assert.ok(isSafeUrl(u), u);
  for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:x', 'java\tscript:x', 'java\nscript:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', '\u0000javascript:x']) {
    assert.ok(!isSafeUrl(u), JSON.stringify(u));
  }
});

test('checkProp: on* solo con función; nombres de atributo raros se rechazan', () => {
  assert.equal(checkProp('onclick', () => {}), 'listener');
  assert.throws(() => checkProp('onclick', 'alert(1)'), /solo acepta una función/);
  assert.throws(() => checkProp('ONERROR', 'x'), /solo acepta una función/);
  assert.throws(() => checkProp('href', 'javascript:alert(1)'), /URL no permitida/);
  assert.throws(() => checkProp('src', 'data:x'), /URL no permitida/);
  assert.throws(() => checkProp('a b', 'x'), /no permitido/);
  assert.throws(() => checkProp('"><img', 'x'), /no permitido/);
  assert.equal(checkProp('text', '<b>'), 'text');
  assert.equal(checkProp('class', 'x'), 'attr');
});

test('el(): texto por textContent, listener registrado y atributos seguros', () => {
  globalThis.document = fakeDocument();
  try {
    const fn = () => {};
    const node = el('a', { href: '#/lider', text: '<img src=x onerror=alert(1)>', onclick: fn, hidden: true, skip: false }, ['hijo', null]);
    assert.equal(node.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(node.attrs.href, '#/lider');
    assert.equal(node.attrs.hidden, '');
    assert.ok(!('skip' in node.attrs));
    assert.equal(node.listeners.click, fn);
    assert.deepEqual(node.children, [{ text: 'hijo' }]);
    assert.throws(() => el('a', { href: 'javascript:alert(1)' }), /URL no permitida/);
    assert.throws(() => el('div', { onmouseover: 'alert(1)' }), /función/);
  } finally {
    delete globalThis.document;
  }
});

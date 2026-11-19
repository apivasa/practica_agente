// F-05 — createRouter con una ventana falsa (sin DOM real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/lib/router.js';

function fakeWindow(hash) {
  const listeners = {};
  const win = {
    location: {
      _hash: hash,
      get hash() { return this._hash; },
      set hash(v) { this._hash = `#${String(v).replace(/^#/, '')}`; listeners.hashchange?.(); },
    },
    history: { replaced: [], replaceState(_s, _t, url) { this.replaced.push(url); win.location._hash = url; } },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  return win;
}

test('redirige sin dejar la ruta prohibida en el historial y pinta la vista propia', () => {
  const win = fakeWindow('#/gestora');
  const renders = [];
  const router = createRouter({
    getState: () => ({ authenticated: true, roles: ['unit_leader'] }),
    render: (view, path) => renders.push([view, path]),
    win,
  });
  router.start();
  assert.deepEqual(win.history.replaced, ['#/lider']);
  assert.deepEqual(renders, [['unit_leader', '/lider']]);
});

test('navigate cambia el hash y vuelve a resolver; en la misma ruta refresca', () => {
  const win = fakeWindow('#/login');
  let authenticated = false;
  const renders = [];
  const router = createRouter({
    getState: () => ({ authenticated, roles: ['committee'] }),
    render: (view) => renders.push(view),
    win,
  });
  router.start();
  authenticated = true;
  router.navigate('/');
  assert.equal(win.location.hash, '#/comite');
  authenticated = false;
  router.navigate('/login');
  router.navigate('/login');
  assert.deepEqual(renders, ['login', 'committee', 'login', 'login']);
});

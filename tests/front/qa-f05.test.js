// F-05 QA — casos de enrutamiento por rol que no cubren router.test.js ni router-hash.test.js.
// Trazan a la fila F-05 del plan ("entra con cada rol y llega a su vista") y a
// docs/diseno.md ("Gestora, custodio, comité o líder, ligado a su unidad o KPI";
// cada líder ve solo lo suyo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHash, distinctRoles, resolveRoute,
  ROLE_ROUTES, LOGIN_PATH, CHOOSER_PATH, NO_ROLE_PATH,
} from '../../src/lib/route-logic.js';
import { createRouter } from '../../src/lib/router.js';

const ALL = ['kpi_manager', 'custodian', 'committee', 'unit_leader'];
const as = (...roles) => ({ authenticated: true, roles });

function fakeWindow(hash) {
  const listeners = {};
  const win = {
    listeners,
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

test('sin sesión, tener roles en el estado no da acceso a ninguna vista de rol', () => {
  for (const role of ALL) {
    const r = resolveRoute(ROLE_ROUTES[role], { authenticated: false, roles: ALL });
    assert.deepEqual(r, { view: 'login', path: LOGIN_PATH, redirected: true });
  }
});

test('con los cuatro roles: el menú es la vista por defecto y cada ruta propia es accesible', () => {
  const s = as(...ALL);
  for (const p of ['/', LOGIN_PATH, NO_ROLE_PATH, '/no-existe']) {
    assert.deepEqual(resolveRoute(p, s), { view: 'chooser', path: CHOOSER_PATH, redirected: true });
  }
  for (const role of ALL) {
    assert.deepEqual(resolveRoute(ROLE_ROUTES[role], s), { view: role, path: ROLE_ROUTES[role], redirected: false });
  }
});

test('cada par de roles: solo sus dos rutas; las otras dos llevan al menú', () => {
  for (let i = 0; i < ALL.length; i++) {
    for (let j = i + 1; j < ALL.length; j++) {
      const mine = [ALL[i], ALL[j]];
      const s = as(...mine);
      for (const role of ALL) {
        const r = resolveRoute(ROLE_ROUTES[role], s);
        if (mine.includes(role)) assert.equal(r.view, role);
        else assert.deepEqual(r, { view: 'chooser', path: CHOOSER_PATH, redirected: true });
      }
    }
  }
});

test('con un solo rol, #/inicio (menú) no se muestra y redirige a la ruta del rol', () => {
  for (const role of ALL) {
    assert.deepEqual(resolveRoute(CHOOSER_PATH, as(role)), { view: role, path: ROLE_ROUTES[role], redirected: true });
  }
});

test('custodio con varias filas (varios indicadores) sigue siendo un solo rol: no ve el menú', () => {
  const rows = [
    { role: 'custodian', indicator_id: 'i2' },
    { role: 'custodian', indicator_id: 'i3' },
    { role: 'custodian', indicator_id: 'i4' },
  ];
  const roles = distinctRoles(rows);
  assert.deepEqual(roles, ['custodian']);
  assert.deepEqual(resolveRoute('/', as(...roles)), { view: 'custodian', path: '/custodio', redirected: true });
});

test('rutas inválidas o maliciosas normalizadas nunca abren una vista ajena', () => {
  const hashes = ['#/gestora/../lider', '#//gestora', '#/gestora%2f', '#/admin', '#javascript:alert(1)', '#/GESTORA//'];
  for (const h of hashes) {
    const r = resolveRoute(parseHash(h), as('unit_leader'));
    assert.equal(r.view, 'unit_leader', h);
    assert.equal(r.path, '/lider', h);
  }
  // Mayúsculas y barra final son la misma ruta propia, no una redirección a otra vista.
  assert.equal(resolveRoute(parseHash('#/LIDER/'), as('unit_leader')).view, 'unit_leader');
});

test('roles nulos o desconocidos mezclados con uno válido cuentan como un solo rol', () => {
  assert.deepEqual(resolveRoute('/', as(null, undefined, 'root', 'committee')), { view: 'committee', path: '/comite', redirected: true });
});

test('router: hash vacío sin sesión se reemplaza por #/login', () => {
  const win = fakeWindow('');
  const renders = [];
  createRouter({ getState: () => ({ authenticated: false, roles: [] }), render: (v, p) => renders.push([v, p]), win }).start();
  assert.deepEqual(win.history.replaced, ['#/login']);
  assert.deepEqual(renders, [['login', '/login']]);
});

test('router: ruta propia con query o mayúsculas se normaliza en la URL sin cambiar de vista', () => {
  const win = fakeWindow('#/LIDER?x=1');
  const renders = [];
  createRouter({ getState: () => as('unit_leader'), render: (v) => renders.push(v), win }).start();
  assert.deepEqual(win.history.replaced, ['#/lider']);
  assert.deepEqual(renders, ['unit_leader']);
});

test('router: editar el hash a mano (hashchange) pasa por la guarda', () => {
  const win = fakeWindow('#/custodio');
  const renders = [];
  createRouter({ getState: () => as('custodian'), render: (v, p) => renders.push([v, p]), win }).start();
  win.location._hash = '#/comite';
  win.listeners.hashchange();
  assert.equal(win.location.hash, '#/custodio');
  assert.deepEqual(renders.at(-1), ['custodian', '/custodio']);
});

test('router: sin roles, cualquier ruta termina en #/sin-rol', () => {
  const win = fakeWindow('#/gestora');
  const renders = [];
  const router = createRouter({ getState: () => as(), render: (v) => renders.push(v), win });
  router.start();
  assert.equal(win.location.hash, '#/sin-rol');
  router.navigate('/comite');
  assert.equal(win.location.hash, '#/sin-rol');
  assert.deepEqual(renders, ['no-role', 'no-role']);
});

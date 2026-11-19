// F-05 — Lógica pura del router por rol (src/lib/route-logic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHash, distinctRoles, roleForPath, defaultPathFor, resolveRoute,
  ROLE_ROUTES, ROLE_LABELS, LOGIN_PATH, CHOOSER_PATH, NO_ROLE_PATH,
} from '../../src/lib/route-logic.js';

const anon = { authenticated: false, roles: [] };
const as = (...roles) => ({ authenticated: true, roles });

test('parseHash normaliza el hash', () => {
  assert.equal(parseHash(''), '/');
  assert.equal(parseHash(undefined), '/');
  assert.equal(parseHash('#'), '/');
  assert.equal(parseHash('#/gestora'), '/gestora');
  assert.equal(parseHash('#/Gestora/'), '/gestora');
  assert.equal(parseHash('#lider?x=1'), '/lider');
  assert.equal(parseHash('#/comite#a'), '/comite');
});

test('distinctRoles: sin duplicados, orden fijo y sin roles desconocidos', () => {
  const rows = [
    { role: 'custodian', indicator_id: 'a' },
    { role: 'unit_leader', unit_id: 'u' },
    { role: 'custodian', indicator_id: 'b' },
    { role: 'superadmin' },
    null,
  ];
  assert.deepEqual(distinctRoles(rows), ['custodian', 'unit_leader']);
  assert.deepEqual(distinctRoles(undefined), []);
});

test('cada rol tiene ruta y etiqueta', () => {
  for (const role of ['kpi_manager', 'custodian', 'committee', 'unit_leader']) {
    assert.ok(ROLE_ROUTES[role]);
    assert.ok(ROLE_LABELS[role]);
    assert.equal(roleForPath(ROLE_ROUTES[role]), role);
  }
  assert.equal(roleForPath('/otra'), null);
});

test('defaultPathFor según cantidad de roles', () => {
  assert.equal(defaultPathFor([]), NO_ROLE_PATH);
  assert.equal(defaultPathFor(undefined), NO_ROLE_PATH);
  assert.equal(defaultPathFor(['committee']), '/comite');
  assert.equal(defaultPathFor(['committee', 'custodian']), CHOOSER_PATH);
});

test('sin sesión cualquier ruta va a login', () => {
  for (const p of ['/', '/login', '/gestora', '/lider', '/inicio', '/x']) {
    const r = resolveRoute(p, anon);
    assert.equal(r.view, 'login');
    assert.equal(r.path, LOGIN_PATH);
    assert.equal(r.redirected, p !== LOGIN_PATH);
  }
  assert.equal(resolveRoute('/gestora').view, 'login');
});

test('con sesión y un rol, login/raíz/desconocida van a la ruta del rol', () => {
  const cases = [
    ['kpi_manager', '/gestora'], ['custodian', '/custodio'],
    ['committee', '/comite'], ['unit_leader', '/lider'],
  ];
  for (const [role, path] of cases) {
    for (const p of ['/', '/login', '/nada', CHOOSER_PATH, NO_ROLE_PATH]) {
      assert.deepEqual(resolveRoute(p, as(role)), { view: role, path, redirected: true });
    }
    assert.deepEqual(resolveRoute(path, as(role)), { view: role, path, redirected: false });
  }
});

test('un líder que pide la ruta de la gestora es redirigido a la suya', () => {
  assert.deepEqual(resolveRoute('/gestora', as('unit_leader')), { view: 'unit_leader', path: '/lider', redirected: true });
  assert.deepEqual(resolveRoute('/comite', as('custodian')), { view: 'custodian', path: '/custodio', redirected: true });
});

test('con varios roles: menú por defecto, cada ruta propia permitida y la ajena al menú', () => {
  const s = as('custodian', 'unit_leader');
  assert.deepEqual(resolveRoute('/login', s), { view: 'chooser', path: CHOOSER_PATH, redirected: true });
  assert.deepEqual(resolveRoute(CHOOSER_PATH, s), { view: 'chooser', path: CHOOSER_PATH, redirected: false });
  assert.equal(resolveRoute('/custodio', s).view, 'custodian');
  assert.equal(resolveRoute('/lider', s).view, 'unit_leader');
  assert.deepEqual(resolveRoute('/gestora', s), { view: 'chooser', path: CHOOSER_PATH, redirected: true });
});

test('con sesión y sin roles: vista sin acceso, nunca una de rol', () => {
  for (const p of ['/', '/gestora', '/lider', CHOOSER_PATH, NO_ROLE_PATH]) {
    const r = resolveRoute(p, as());
    assert.equal(r.view, 'no-role');
    assert.equal(r.path, NO_ROLE_PATH);
  }
});

test('roles desconocidos o repetidos no dan acceso extra', () => {
  assert.equal(resolveRoute('/gestora', as('admin')).view, 'no-role');
  assert.equal(resolveRoute(CHOOSER_PATH, as('committee', 'committee')).view, 'committee');
});

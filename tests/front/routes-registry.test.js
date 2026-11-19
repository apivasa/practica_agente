// M-02 (ADR 0009) — registro declarativo de rutas con subrutas por rol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES, ROLE_ROUTES, findRoute, routesForRole, roleForView, roleForPath, resolveRoute, parseHash, CHOOSER_PATH,
} from '../../src/lib/route-logic.js';

const as = (...roles) => ({ authenticated: true, roles });

test('cada ruta tiene path, role, view y label; paths y views únicos; prefijo del rol', () => {
  const paths = new Set();
  const views = new Set();
  for (const r of ROUTES) {
    assert.ok(r.path && r.role && r.view && r.label, JSON.stringify(r));
    assert.ok(r.path === ROLE_ROUTES[r.role] || r.path.startsWith(`${ROLE_ROUTES[r.role]}/`), r.path);
    assert.ok(!paths.has(r.path) && !views.has(r.view));
    paths.add(r.path);
    views.add(r.view);
    assert.ok(Object.isFrozen(r));
  }
  assert.ok(Object.isFrozen(ROUTES));
  // Inicio de cada rol: view = rol.
  for (const [role, path] of Object.entries(ROLE_ROUTES)) assert.equal(findRoute(path).view, role);
});

test('subrutas de M-02, M-03 y M-04', () => {
  assert.deepEqual(routesForRole('kpi_manager').map((r) => r.path), ['/gestora', '/gestora/indicadores', '/gestora/completitud']);
  assert.deepEqual(routesForRole('custodian').map((r) => r.path), ['/custodio', '/custodio/compromisos', '/custodio/mediciones']);
  assert.equal(roleForView('kpi-indicators'), 'kpi_manager');
  assert.equal(roleForView('nada'), null);
  assert.equal(roleForPath('/custodio/mediciones'), 'custodian');
  assert.equal(findRoute('/__proto__'), null);
});

test('la guarda autoriza la subruta solo al rol dueño', () => {
  assert.deepEqual(resolveRoute('/gestora/indicadores', as('kpi_manager')), { view: 'kpi-indicators', path: '/gestora/indicadores', redirected: false });
  assert.deepEqual(resolveRoute('/gestora/indicadores', as('custodian')), { view: 'custodian', path: '/custodio', redirected: true });
  assert.deepEqual(resolveRoute('/custodio/mediciones', as('custodian')), { view: 'custodian-measurements', path: '/custodio/mediciones', redirected: false });
  assert.deepEqual(resolveRoute('/custodio/compromisos', as('unit_leader')), { view: 'unit_leader', path: '/lider', redirected: true });
  assert.deepEqual(resolveRoute('/custodio/compromisos', as('committee', 'unit_leader')), { view: 'chooser', path: CHOOSER_PATH, redirected: true });
  assert.equal(resolveRoute('/custodio/compromisos', { authenticated: false }).view, 'login');
  assert.equal(resolveRoute('/custodio/compromisos', as()).view, 'no-role');
});

test('subruta con query o mayúsculas se normaliza a la misma ruta', () => {
  assert.equal(resolveRoute(parseHash('#/Custodio/Mediciones/?indicador=x'), as('custodian')).view, 'custodian-measurements');
  assert.equal(resolveRoute(parseHash('#/custodio/mediciones/../../gestora'), as('custodian')).view, 'custodian');
});

// C-02 (desarrollador): ruta #/comite/excepciones y lógica pura de la pantalla.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, parseHash, routesForRole, ROUTES } from '../../src/lib/route-logic.js';
import {
  guayaquilDate,
  toEngineException,
  toListItems,
  mapExceptionError,
  MSG_FORBIDDEN,
  MSG_RULES,
  MSG_GENERIC,
} from '../../src/lib/exceptions-logic.js';

const as = (...roles) => ({ authenticated: true, roles });

describe('ruta /comite/excepciones', () => {
  test('el comité entra', () => {
    assert.deepEqual(resolveRoute('/comite/excepciones', as('committee')),
      { view: 'committee-exceptions', path: '/comite/excepciones', redirected: false });
    assert.equal(resolveRoute(parseHash('#/Comite/Excepciones/?x=1'), as('committee')).view, 'committee-exceptions');
  });
  test('el líder y la gestora son redirigidos a su inicio', () => {
    assert.deepEqual(resolveRoute('/comite/excepciones', as('unit_leader')), { view: 'unit_leader', path: '/lider', redirected: true });
    assert.deepEqual(resolveRoute('/comite/excepciones', as('kpi_manager')), { view: 'kpi_manager', path: '/gestora', redirected: true });
  });
  test('sin sesión va a login', () => {
    assert.equal(resolveRoute('/comite/excepciones', { authenticated: false }).view, 'login');
  });
  test('varios roles con comité: entra directo', () => {
    assert.equal(resolveRoute('/comite/excepciones', as('unit_leader', 'committee')).view, 'committee-exceptions');
  });
  test('registro: la ruta pertenece al comité y es inmutable', () => {
    assert.deepEqual(routesForRole('committee').map((r) => r.path), ['/comite', '/comite/excepciones']);
    assert.ok(!routesForRole('unit_leader').some((r) => r.path === '/comite/excepciones'));
    const r = ROUTES.find((x) => x.path === '/comite/excepciones');
    assert.ok(Object.isFrozen(r));
    assert.equal(r.view, 'committee-exceptions');
  });
});

describe('exceptions-logic', () => {
  test('guayaquilDate usa UTC-5', () => {
    assert.equal(guayaquilDate(new Date('2026-11-20T03:00:00Z')), '2026-11-19');
    assert.equal(guayaquilDate(new Date('2026-11-20T05:00:00Z')), '2026-11-20');
    assert.equal(guayaquilDate('2026-01-01T04:59:59Z'), '2025-12-31');
    assert.throws(() => guayaquilDate('no'), TypeError);
  });
  test('toEngineException', () => {
    assert.deepEqual(
      toEngineException({ id: 'a', scope: 'change_start', expires_on: '2026-12-01', change_ref: 'CHG', revoked_at: '2026-11-20T02:00:00+00:00' }),
      { id: 'a', scope: 'change_start', expiresOn: '2026-12-01', changeRef: 'CHG', revokedOn: '2026-11-19' },
    );
    assert.equal(toEngineException({ id: 'b', scope: 'all', expires_on: '2026-12-01' }).revokedOn, null);
  });

  const units = [{ id: 'u1', name: 'Alfa' }, { id: 'u2', name: 'Beta' }];
  const rows = [
    { id: 'r', unit_id: 'u1', scope: 'all', reason: 'rev', expires_on: '2026-12-10', approved_by: 'me', revoked_at: '2026-11-18T15:00:00Z' },
    { id: 'x', unit_id: 'u2', scope: 'all', reason: 'venc', expires_on: '2026-11-01', approved_by: 'me', revoked_at: null },
    { id: 'b', unit_id: 'u2', scope: 'change_start', reason: 'otro', change_ref: 'CHG-2', expires_on: '2026-12-20', approved_by: 'other', revoked_at: null },
    { id: 'a', unit_id: 'u1', scope: 'change_start', reason: 'mía', change_ref: 'CHG-1', expires_on: '2026-12-05', approved_by: 'me', revoked_at: null },
    { id: 'z', unit_id: 'u9', scope: 'all', reason: '<b>x</b>', expires_on: '2026-11-19', approved_by: null, revoked_at: null },
  ];
  test('toListItems: estado, orden y permisos de revocación', () => {
    const items = toListItems(rows, { today: '2026-11-19', userId: 'me', units });
    assert.deepEqual(items.map((i) => [i.id, i.status]), [['z', 'active'], ['a', 'active'], ['b', 'active'], ['x', 'expired'], ['r', 'revoked']]);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    assert.equal(byId.a.canRevoke, true);
    assert.equal(byId.b.canRevoke, false, 'no revoca la de otro');
    assert.equal(byId.x.canRevoke, false, 'no revoca una vencida');
    assert.equal(byId.r.canRevoke, false);
    assert.equal(byId.r.revokedOn, '2026-11-18');
    assert.equal(byId.z.unitName, 'Unidad sin nombre');
    assert.equal(byId.z.reason, '<b>x</b>', 'el texto se conserva tal cual (la vista usa textContent)');
    assert.equal(byId.a.statusLabel, 'Vigente');
    assert.equal(byId.a.scopeLabel, 'Inicio puntual de change');
  });
  test('toListItems sin usuario: nada revocable', () => {
    assert.ok(toListItems(rows, { today: '2026-11-19', userId: null, units }).every((i) => !i.canRevoke));
  });
  test('mapExceptionError nunca devuelve el error crudo', () => {
    assert.equal(mapExceptionError({ code: '42501', message: 'new row violates row-level security policy' }), MSG_FORBIDDEN);
    assert.equal(mapExceptionError({ status: 403 }), MSG_FORBIDDEN);
    assert.equal(mapExceptionError({ code: '23514', message: 'La vigencia máxima...' }), MSG_RULES);
    assert.equal(mapExceptionError({ code: 'PGRST000', message: 'detalle interno' }), MSG_GENERIC);
    assert.equal(mapExceptionError(null), MSG_GENERIC);
  });
});

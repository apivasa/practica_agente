// M-02..M-04 — Pentest de la API con los usuarios nuevos de la semilla
// (sin rol, multirol gestora+custodio, custodio de un KPI inactivo) y de la
// asignación de custodio (user_roles) desde un rol que no es la gestora.
// Categoría 1. Corre en seguridad.yml › pentest-api (Supabase local).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  skipReason, loginAll, login, as, request, admin, adminGet, USERS, UNIT, KPI, DENIED,
} from './_lib.js';

const skip = skipReason();
const REPR = { Prefer: 'return=representation' };
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
const deniedOrEmpty = (r) => DENIED.includes(r.status) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
const NEW = {
  custodio3: { id: '11111111-1111-4111-8111-000000000008', email: 'custodio3@example.test' },
  multirol: { id: '11111111-1111-4111-8111-000000000009', email: 'multirol@example.test' },
  sinrol: { id: '11111111-1111-4111-8111-000000000010', email: 'sinrol@example.test' },
};
const KPI_CHG = '33333333-3333-4333-8333-000000000005'; // custodio3, inactivo
const KPI_LAT = '33333333-3333-4333-8333-000000000006'; // multirol, inactivo
const TABLES = ['units', 'user_roles', 'indicators', 'commitments', 'measurements', 'targets', 'evaluations', 'exceptions', 'alerts', 'audit_log'];
const MARK = `pentest-m04-${Date.now()}`;

let tokens;
const call = (token) => (path, opts = {}) => request(`/rest/v1/${path}`, { ...opts, token });

describe('pentest-api: M-02..M-04', { skip }, () => {
  let SR; let MR; let C3; let C1; let C2;
  before(async () => {
    tokens = await loginAll();
    C1 = as('custodio1', tokens);
    C2 = as('custodio2', tokens);
    const t = {};
    for (const [k, u] of Object.entries(NEW)) {
      const r = await login(u.email);
      assert.equal(r.status, 200, `login ${k}: ${fmt(r)}`);
      t[k] = r.json.access_token;
    }
    SR = call(t.sinrol);
    MR = call(t.multirol);
    C3 = call(t.custodio3);
  });

  after(async () => {
    await admin(`measurements?category=eq.${MARK}`, { method: 'DELETE' });
  });

  describe('usuario autenticado sin rol', () => {
    for (const table of TABLES) {
      test(`sinrol · GET ${table} no devuelve filas`, async () => {
        const r = await SR(`${table}?select=*`);
        assert.ok(deniedOrEmpty(r), `${table}: ${fmt(r)}`);
      });
    }
    test('sinrol · no puede darse rol custodio ni gestora', async () => {
      for (const body of [
        { user_id: NEW.sinrol.id, role: 'custodian', indicator_id: KPI.vuln },
        { user_id: NEW.sinrol.id, role: 'kpi_manager' },
      ]) {
        const r = await SR('user_roles', { method: 'POST', body, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${body.role}: ${fmt(r)}`);
      }
      const rows = await adminGet(`user_roles?user_id=eq.${NEW.sinrol.id}`);
      assert.equal(rows.length, 0);
    });
    test('sinrol · no puede insertar mediciones ni compromisos', async () => {
      const m = await SR('measurements', { method: 'POST', body: { indicator_id: KPI.vuln, unit_id: UNIT.alfa, measured_on: '2026-01-01', value: 1, category: MARK, source: 'manual' }, headers: REPR });
      assert.ok(DENIED.includes(m.status), fmt(m));
      const c = await SR('commitments', { method: 'POST', body: { indicator_id: KPI.vuln, unit_id: UNIT.alfa, period: '2031-Q1' }, headers: REPR });
      assert.ok(DENIED.includes(c.status), fmt(c));
    });
  });

  describe('asignación de custodio solo por la gestora (user_roles)', () => {
    test('custodio1 · no se asigna como custodio de otro KPI', async () => {
      const r = await C1('user_roles', { method: 'POST', body: { user_id: USERS.custodio1.id, role: 'custodian', indicator_id: KPI.avail }, headers: REPR });
      assert.ok(DENIED.includes(r.status), fmt(r));
    });
    test('custodio1 · no borra el rol del custodio de otro KPI', async () => {
      const before = await adminGet(`user_roles?role=eq.custodian&indicator_id=eq.${KPI.avail}`);
      const r = await C1(`user_roles?role=eq.custodian&indicator_id=eq.${KPI.avail}`, { method: 'DELETE', headers: REPR });
      assert.ok(deniedOrEmpty(r), fmt(r));
      const now = await adminGet(`user_roles?role=eq.custodian&indicator_id=eq.${KPI.avail}`);
      assert.equal(now.length, before.length);
    });
    test('custodio2 · no cambia indicators.custodian_user_id', async () => {
      const r = await C2(`indicators?id=eq.${KPI.vuln}`, { method: 'PATCH', body: { custodian_user_id: USERS.custodio2.id }, headers: REPR });
      assert.ok(deniedOrEmpty(r), fmt(r));
      const [ind] = await adminGet(`indicators?id=eq.${KPI.vuln}&select=custodian_user_id`);
      assert.equal(ind.custodian_user_id, USERS.custodio1.id);
    });
    test('custodio3 · no reactiva su KPI inactivo ni cambia umbrales', async () => {
      const r = await C3(`indicators?id=eq.${KPI_CHG}`, { method: 'PATCH', body: { active: true, green_threshold: 100 }, headers: REPR });
      assert.ok(deniedOrEmpty(r), fmt(r));
      const [ind] = await adminGet(`indicators?id=eq.${KPI_CHG}&select=active,green_threshold`);
      assert.equal(ind.active, false);
    });
  });

  describe('multirol (gestora + custodio de LAT)', () => {
    test('escribe mediciones solo de su KPI: ser gestora no da escritura en mediciones de otros', async () => {
      const own = await MR('measurements', { method: 'POST', body: { indicator_id: KPI_LAT, unit_id: UNIT.alfa, measured_on: '2026-01-01', value: 1, category: MARK, source: 'manual' }, headers: REPR });
      assert.equal(own.status, 201, fmt(own));
      const other = await MR('measurements', { method: 'POST', body: { indicator_id: KPI.vuln, unit_id: UNIT.alfa, measured_on: '2026-01-01', value: 1, category: MARK, source: 'manual' }, headers: REPR });
      assert.ok(DENIED.includes(other.status), fmt(other));
    });
    test('no puede fijar source=automatic ni created_by ajeno', async () => {
      for (const extra of [{ source: 'automatic' }, { source: 'manual', created_by: USERS.custodio1.id }]) {
        const r = await MR('measurements', { method: 'POST', body: { indicator_id: KPI_LAT, unit_id: UNIT.alfa, measured_on: '2026-01-02', value: 1, category: MARK, ...extra }, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${JSON.stringify(extra)}: ${fmt(r)}`);
      }
    });
    test('como custodio de LAT no lee mediciones de otros KPI más allá de lo que ya ve la gestora', async () => {
      // Es gestora: lee todo (diseño). Se verifica que el custodio3, sin ser gestora, no.
      const r = await C3(`measurements?indicator_id=eq.${KPI.vuln}&select=id`);
      assert.ok(deniedOrEmpty(r), fmt(r));
    });
  });

  describe('custodio3 (KPI inactivo)', () => {
    test('no escribe mediciones ni compromisos de KPI ajenos', async () => {
      const m = await C3('measurements', { method: 'POST', body: { indicator_id: KPI.avail, unit_id: UNIT.alfa, measured_on: '2026-01-01', value: 1, category: MARK, source: 'manual' }, headers: REPR });
      assert.ok(DENIED.includes(m.status), fmt(m));
      const c = await C3('commitments', { method: 'POST', body: { indicator_id: KPI.avail, unit_id: UNIT.alfa, period: '2031-Q1' }, headers: REPR });
      assert.ok(DENIED.includes(c.status), fmt(c));
    });
    test('solo ve su propia fila de user_roles', async () => {
      const r = await C3('user_roles?select=user_id');
      assert.equal(r.status, 200, fmt(r));
      for (const row of r.json) assert.equal(row.user_id, NEW.custodio3.id);
    });
  });
});

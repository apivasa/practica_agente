// M-10 — Reproducción por API del ataque de H-M09-01 contra cada columna numeric que
// escribe un usuario, con el rol que la escribe (categorías 1 y 3):
//   indicators.green_threshold / yellow_threshold  → gestora
//   targets.target_value                            → gestora (PATCH, POST y upsert)
//   commitments.package_total / green_override / yellow_override → custodio del KPI
// PostgREST pasa la cadena tal cual a numeric_in, que acepta 'NaN', 'Infinity', 'inf',
// mayúsculas/minúsculas, signo y espacios. Se espera 400 con código 23514 (CHECK) y que la
// fila conserve su valor. Control positivo: el mismo PATCH con el valor actual pasa (prueba
// que el rechazo no es RLS ni privilegio, sino el CHECK).
// Corre en seguridad.yml › pentest-api (Supabase local).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, as, admin, adminGet, request, env, USERS, UNIT, KPI, DENIED } from './_lib.js';

const skip = skipReason();
const REPR = { Prefer: 'return=representation' };
const fmt = (r) => `${r.status} ${r.text.slice(0, 240)}`;

// Variantes de escritura de no finitos que numeric_in acepta.
const NON_FINITE = ['NaN', 'nan', '  nan ', 'NAN', 'Infinity', 'infinity', 'inf', '+inf', ' INF ', '-Infinity', '-inf', '+Infinity'];

const rejectedByCheck = (r) => r.status === 400 && r.json?.code === '23514';

describe('pentest-api: M-10 numeric finito (H-M09-01)', { skip }, () => {
  let G; let C1; let C2; let L1; let CM;
  let target; let pkgCommit; let ovrCommit; let avail;

  before(async () => {
    const tokens = await loginAll();
    G = as('gestora', tokens);
    C1 = as('custodio1', tokens);
    C2 = as('custodio2', tokens);
    L1 = as('lider1', tokens);
    CM = as('comite', tokens);
    [target] = await adminGet(`targets?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&month=eq.2027-01&select=*`);
    [pkgCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&period=eq.2027-Q1&select=*`);
    [ovrCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.gamma}&indicator_id=eq.${KPI.avail}&period=eq.2027-01&select=*`);
    [avail] = await adminGet(`indicators?id=eq.${KPI.avail}&select=*`);
    assert.ok(target && pkgCommit && ovrCommit && avail, 'fixtures de la semilla presentes');
    assert.ok(pkgCommit.package_total !== null, 'el compromiso de VULN tiene package_total');
    assert.ok(ovrCommit.green_override !== null && ovrCommit.yellow_override !== null, 'el compromiso de AVAIL tiene overrides');
  });

  after(async () => {
    // Por si algún POST se aceptara (sería un hallazgo): no deja basura en la BD local.
    await admin('targets?month=eq.2031-05', { method: 'DELETE' });
  });

  const cases = () => [
    { who: 'gestora', call: G, table: 'indicators', id: KPI.avail, col: 'green_threshold', row: avail },
    { who: 'gestora', call: G, table: 'indicators', id: KPI.avail, col: 'yellow_threshold', row: avail },
    { who: 'gestora', call: G, table: 'targets', id: target.id, col: 'target_value', row: target },
    { who: 'custodio1', call: C1, table: 'commitments', id: pkgCommit.id, col: 'package_total', row: pkgCommit },
    { who: 'custodio2', call: C2, table: 'commitments', id: ovrCommit.id, col: 'green_override', row: ovrCommit },
    { who: 'custodio2', call: C2, table: 'commitments', id: ovrCommit.id, col: 'yellow_override', row: ovrCommit },
  ];

  test('control positivo: cada rol escribe su columna con el valor actual (200, 1 fila)', async () => {
    for (const c of cases()) {
      const r = await c.call(`${c.table}?id=eq.${c.id}`, { method: 'PATCH', body: { [c.col]: c.row[c.col] }, headers: REPR });
      assert.equal(r.status, 200, `${c.who} ${c.table}.${c.col}: ${fmt(r)}`);
      assert.equal(r.json.length, 1, `${c.who} ${c.table}.${c.col}: la fila es alcanzable`);
    }
  });

  test('PATCH con NaN / Infinity / variantes se rechaza por CHECK (23514) en cada columna', async () => {
    for (const c of cases()) {
      for (const v of NON_FINITE) {
        const r = await c.call(`${c.table}?id=eq.${c.id}`, { method: 'PATCH', body: { [c.col]: v }, headers: REPR });
        assert.ok(rejectedByCheck(r), `${c.who} ${c.table}.${c.col} = ${JSON.stringify(v)}: ${fmt(r)}`);
      }
    }
  });

  test('las filas conservan sus valores tras los intentos', async () => {
    for (const c of cases()) {
      const [now] = await adminGet(`${c.table}?id=eq.${c.id}&select=${c.col}`);
      assert.equal(String(now[c.col]), String(c.row[c.col]), `${c.table}.${c.col}`);
    }
  });

  test('gestora · POST de meta nueva con NaN / Infinity se rechaza', async () => {
    for (const v of ['NaN', 'Infinity', ' inf ']) {
      const r = await G('targets', {
        method: 'POST',
        body: { unit_id: UNIT.alfa, indicator_id: KPI.vuln, month: '2031-05', target_value: v },
        headers: REPR,
      });
      assert.ok(rejectedByCheck(r), `POST targets ${JSON.stringify(v)}: ${fmt(r)}`);
    }
  });

  test('gestora · upsert (merge-duplicates) sobre una meta existente con NaN se rechaza', async () => {
    const r = await G('targets?on_conflict=unit_id,indicator_id,month', {
      method: 'POST',
      body: { unit_id: target.unit_id, indicator_id: target.indicator_id, month: target.month, target_value: 'NaN' },
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    });
    assert.ok(rejectedByCheck(r), `upsert targets NaN: ${fmt(r)}`);
  });

  test('custodio · POST de compromiso nuevo con paquete u overrides no finitos se rechaza', async () => {
    const bodies = [
      { unit_id: UNIT.alfa, indicator_id: KPI.vuln, period: '2031-Q2', package_total: 'NaN', created_by: USERS.custodio1.id },
      { unit_id: UNIT.alfa, indicator_id: KPI.vuln, period: '2031-Q2', package_total: 'inf', created_by: USERS.custodio1.id },
    ];
    for (const body of bodies) {
      const r = await C1('commitments', { method: 'POST', body, headers: REPR });
      assert.ok(rejectedByCheck(r), `POST commitments ${JSON.stringify(body.package_total)}: ${fmt(r)}`);
    }
    const r = await C2('commitments', {
      method: 'POST',
      body: { unit_id: UNIT.alfa, indicator_id: KPI.avail, period: '2031-05', green_override: 'Infinity', yellow_override: 'NaN', created_by: USERS.custodio2.id },
      headers: REPR,
    });
    assert.ok(rejectedByCheck(r), `POST commitments overrides: ${fmt(r)}`);
    const left = await adminGet('commitments?period=in.(2031-Q2,2031-05)&select=id');
    assert.equal(left.length, 0, 'no quedó ningún compromiso de prueba');
  });

  test('roles sin escritura no llegan al CHECK: líder, comité y anónimo no cambian nada', async () => {
    const anon = (path, opts = {}) => request(`/rest/v1/${path}`, { ...opts, apikey: env.publishable });
    for (const [who, call] of [['lider1', L1], ['comite', CM], ['anon', anon]]) {
      for (const c of cases()) {
        const r = await call(`${c.table}?id=eq.${c.id}`, { method: 'PATCH', body: { [c.col]: 'NaN' }, headers: REPR });
        // 401/403 (sin privilegio) o 200 [] (RLS no deja ver la fila). Nunca 200 con filas.
        const ok = DENIED.includes(r.status) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
        assert.ok(ok, `${who} ${c.table}.${c.col}: ${fmt(r)}`);
      }
    }
  });

  test('evaluations.value: ningún rol de usuario lo escribe (lo escribe solo el backend)', async () => {
    const [ev] = await adminGet('evaluations?select=id&limit=1');
    const id = ev?.id ?? '00000000-0000-4000-8000-000000000000';
    for (const call of [G, C1, CM, L1]) {
      const r = await call(`evaluations?id=eq.${id}`, { method: 'PATCH', body: { value: 'NaN' }, headers: REPR });
      assert.ok(DENIED.includes(r.status) || (r.status === 200 && r.json.length === 0), fmt(r));
    }
  });
});

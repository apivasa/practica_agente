// M-14 (H-ARQ-M13-01) — Reproducción por API (PostgREST, JWT por rol) del borde nuevo de los
// CHECK `_safe`: |v| < 2^53 - 0,5. Antes de M-14 la BD aceptaba [2^53 - 0,5, 2^53), que
// JSON.parse redondea a 2^53 y engine/numeric.js rechaza: la evaluación mensual fallaba al
// leer el umbral. Se envían cuerpos JSON crudos (literales decimales que JSON.stringify no
// emite tal cual) con el rol que escribe cada columna:
//   indicators.green_threshold / yellow_threshold, thresholds_by_category, targets → gestora
//   commitments.package_total / overrides / package_by_category, measurements.value → custodio
// Se espera 400/23514 y la fila intacta. Control positivo: 2^53 - 0,6 pasa y, leído por la API
// con JSON.parse, el motor lo acepta (lo que la BD deja pasar, el motor lo puede leer). Líder y
// comité no escriben (0 filas). Corre en seguridad.yml › pentest-api (Supabase local).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, admin, adminGet, env, UNIT, KPI } from './_lib.js';
import { isSafeMagnitude } from '../../../engine/numeric.js';

const skip = skipReason();
const fmt = (r) => `${r.status} ${r.text.slice(0, 240)}`;
const rejectedByCheck = (r) => r.status === 400 && r.json?.code === '23514';
const MARK_DAY = '2031-08-01';

async function raw(token, path, method, bodyText, prefer = 'return=representation') {
  const headers = { apikey: env.publishable, 'Content-Type': 'application/json', Prefer: prefer };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${env.url}/rest/v1/${path}`, { method, headers, body: bodyText });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

// Valores que JSON.parse lee como ±2^53 (o más): la BD debe rechazarlos todos.
const EDGE = [
  '9007199254740991.5', '9007199254740991.9999', '9.0071992547409915e15', '9.0071992547409915E+15',
  '"9007199254740991.5"', '" 9007199254740991.75 "', '9007199254740991.50000000000000000001',
];
const EDGE_NEG = ['-9007199254740991.5', '"-9.0071992547409915e15"'];

describe('pentest-api: M-14 borde |v| < 2^53 - 0,5 (H-ARQ-M13-01)', { skip }, () => {
  let tokens; let target; let pkgCommit; let ovrCommit; let avail; let vuln;

  before(async () => {
    tokens = await loginAll();
    [target] = await adminGet(`targets?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&month=eq.2027-01&select=*`);
    [pkgCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&period=eq.2027-Q1&select=*`);
    [ovrCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.gamma}&indicator_id=eq.${KPI.avail}&period=eq.2027-01&select=*`);
    [avail] = await adminGet(`indicators?id=eq.${KPI.avail}&select=*`);
    [vuln] = await adminGet(`indicators?id=eq.${KPI.vuln}&select=*`);
    assert.ok(target && pkgCommit && ovrCommit && avail && vuln, 'fixtures de la semilla presentes');
  });

  after(async () => {
    await admin(`measurements?measured_on=eq.${MARK_DAY}`, { method: 'DELETE' });
    if (target) {
      await admin(`targets?id=eq.${target.id}`, {
        method: 'PATCH', body: { target_value: target.target_value }, headers: { Prefer: 'return=minimal' },
      });
    }
  });

  const cases = () => [
    { who: 'gestora', table: 'indicators', id: KPI.avail, col: 'green_threshold', row: avail },
    { who: 'gestora', table: 'indicators', id: KPI.avail, col: 'yellow_threshold', row: avail },
    { who: 'gestora', table: 'targets', id: target.id, col: 'target_value', row: target },
    { who: 'custodio1', table: 'commitments', id: pkgCommit.id, col: 'package_total', row: pkgCommit },
    { who: 'custodio2', table: 'commitments', id: ovrCommit.id, col: 'green_override', row: ovrCommit },
    { who: 'custodio2', table: 'commitments', id: ovrCommit.id, col: 'yellow_override', row: ovrCommit },
  ];

  test('PATCH en el borde 2^53 - 0,5 (decimal, exponencial, cadena, negativo) se rechaza por CHECK en cada columna', async () => {
    for (const c of cases()) {
      for (const v of [...EDGE, ...EDGE_NEG]) {
        const r = await raw(tokens[c.who], `${c.table}?id=eq.${c.id}`, 'PATCH', `{"${c.col}": ${v}}`);
        assert.ok(rejectedByCheck(r), `${c.who} ${c.table}.${c.col} = ${v}: ${fmt(r)}`);
      }
    }
    for (const c of cases()) {
      const [now] = await adminGet(`${c.table}?id=eq.${c.id}&select=${c.col}`);
      assert.equal(String(now[c.col]), String(c.row[c.col]), `${c.table}.${c.col} intacto`);
    }
  });

  test('gestora · thresholds_by_category con una clave en el borde se rechaza', async () => {
    assert.ok(Object.keys(vuln.thresholds_by_category ?? {}).length > 0, 'VULN tiene umbrales por categoría');
    const [cat] = Object.keys(vuln.thresholds_by_category);
    for (const v of ['9007199254740991.5', '-9.0071992547409915e15']) {
      const body = `{"thresholds_by_category": {"${cat}": {"green": ${v}, "yellow": 1}}}`;
      const r = await raw(tokens.gestora, `indicators?id=eq.${KPI.vuln}`, 'PATCH', body);
      assert.ok(rejectedByCheck(r), `PATCH ${body}: ${fmt(r)}`);
    }
    const [now] = await adminGet(`indicators?id=eq.${KPI.vuln}&select=thresholds_by_category`);
    assert.deepEqual(now.thresholds_by_category, vuln.thresholds_by_category, 'umbrales intactos');
  });

  test('custodio · package_by_category y measurements.value en el borde se rechazan', async () => {
    for (const v of ['9007199254740991.5', '9.0071992547409915e15']) {
      const r = await raw(tokens.custodio1, `commitments?id=eq.${pkgCommit.id}`, 'PATCH', `{"package_by_category": {"P0P1": ${v}}}`);
      assert.ok(rejectedByCheck(r), `PATCH package_by_category ${v}: ${fmt(r)}`);
    }
    for (const v of EDGE) {
      const body = `{"unit_id":"${UNIT.gamma}","indicator_id":"${KPI.avail}","measured_on":"${MARK_DAY}","value":${v}}`;
      const r = await raw(tokens.custodio2, 'measurements', 'POST', body);
      assert.ok(rejectedByCheck(r), `POST measurements value=${v}: ${fmt(r)}`);
    }
    const left = await adminGet(`measurements?measured_on=eq.${MARK_DAY}&select=id`);
    assert.equal(left.length, 0, 'no quedó ninguna medición de los intentos');
    const [pkg] = await adminGet(`commitments?id=eq.${pkgCommit.id}&select=package_by_category`);
    assert.deepEqual(pkg.package_by_category, pkgCommit.package_by_category, 'paquete intacto');
  });

  test('líder, comité y anónimo no escriben las columnas ni con un valor válido', async () => {
    for (const who of ['lider1', 'lider3', 'comite']) {
      for (const c of cases()) {
        const r = await raw(tokens[who], `${c.table}?id=eq.${c.id}`, 'PATCH', `{"${c.col}": 9007199254740991.4}`);
        const blocked = (r.status === 200 && Array.isArray(r.json) && r.json.length === 0) || [401, 403].includes(r.status);
        assert.ok(blocked, `${who} ${c.table}.${c.col}: ${fmt(r)}`);
      }
    }
    for (const c of cases()) {
      const r = await raw(null, `${c.table}?id=eq.${c.id}`, 'PATCH', `{"${c.col}": 9007199254740991.4}`);
      const blocked = (r.status === 200 && Array.isArray(r.json) && r.json.length === 0) || [401, 403].includes(r.status);
      assert.ok(blocked, `anon ${c.table}.${c.col}: ${fmt(r)}`);
      const [now] = await adminGet(`${c.table}?id=eq.${c.id}&select=${c.col}`);
      assert.equal(String(now[c.col]), String(c.row[c.col]), `${c.table}.${c.col} intacto`);
    }
  });

  test('control positivo: 2^53 - 0,6 pasa y lo que lee la API el motor lo acepta (BD == motor)', async () => {
    const r = await raw(tokens.gestora, `targets?id=eq.${target.id}`, 'PATCH', '{"target_value": 9007199254740991.4}');
    assert.equal(r.status, 200, fmt(r));
    assert.equal(r.json.length, 1);
    const read = await raw(tokens.gestora, `targets?id=eq.${target.id}&select=target_value`, 'GET');
    assert.equal(read.status, 200, fmt(read));
    assert.match(read.text, /9007199254740991\.4/, 'la API devuelve el valor exacto');
    const v = read.json[0].target_value;
    assert.equal(v, Number.MAX_SAFE_INTEGER, 'JSON.parse lo lee como 2^53 - 1');
    assert.equal(isSafeMagnitude(v), true, 'el motor lo acepta');
    const back = await raw(tokens.gestora, `targets?id=eq.${target.id}`, 'PATCH', JSON.stringify({ target_value: target.target_value }));
    assert.equal(back.status, 200, fmt(back));
  });

  test('lecturas de la API: ningún número de las tablas configurables llega al motor fuera de rango', async () => {
    const bad = [];
    const walk = (v, path) => {
      if (typeof v === 'number' && !isSafeMagnitude(v)) bad.push(`${path}=${v}`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    for (const who of ['gestora', 'custodio1', 'custodio2']) {
      for (const table of ['indicators', 'targets', 'commitments', 'measurements']) {
        const r = await raw(tokens[who], `${table}?select=*`, 'GET');
        assert.equal(r.status, 200, `${who} GET ${table}: ${fmt(r)}`);
        walk(r.json, `${who}:${table}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

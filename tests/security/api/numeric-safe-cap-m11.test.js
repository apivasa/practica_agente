// M-11 — Reproducción por API del ataque de H-M10-01 (categorías 1 y 3) contra PostgREST:
// valores finitos enormes (1e400) que PostgreSQL acepta pero que `JSON.parse` convierte en
// Infinity al leerlos. Se envían como LITERAL numérico JSON en el cuerpo crudo (JSON.stringify
// no puede producir 1e400: daría null), como cadena y en notación exponencial, con el rol que
// escribe cada columna:
//   indicators.green_threshold / yellow_threshold      → gestora
//   targets.target_value                                → gestora (PATCH, POST, upsert)
//   commitments.package_total / overrides / package_by_category → custodio del KPI
// Se espera 400 con código 23514 (CHECK) y que la fila no cambie. Control positivo: el mismo
// PATCH con el valor actual pasa (el rechazo no es RLS ni privilegio). Además: ninguna
// respuesta de lectura de la API contiene un número que JSON.parse vuelva no finito.
// Corre en seguridad.yml › pentest-api (Supabase local).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, admin, adminGet, env, USERS, UNIT, KPI } from './_lib.js';

const skip = skipReason();
const fmt = (r) => `${r.status} ${r.text.slice(0, 240)}`;
const rejectedByCheck = (r) => r.status === 400 && r.json?.code === '23514';

// Cuerpo JSON crudo: permite literales que JSON.stringify no puede emitir (1e400).
async function raw(token, path, method, bodyText, prefer = 'return=representation') {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.publishable,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: bodyText,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

// Literales y cadenas que numeric_in / el parser JSON de PostgreSQL aceptan como >= 2^53.
const HUGE_LITERALS = ['1e400', '-1e400', '9007199254740992', '9.007199254740992e15', '1E+16', '-9007199254740992'];
const HUGE_STRINGS = ['"1e400"', '" 1E400 "', '"9007199254740992"', '"-9.007199254740992e15"'];

describe('pentest-api: M-11 tope 2^53 (H-M10-01)', { skip }, () => {
  let tokens; let target; let pkgCommit; let ovrCommit; let avail;

  before(async () => {
    tokens = await loginAll();
    [target] = await adminGet(`targets?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&month=eq.2027-01&select=*`);
    [pkgCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&period=eq.2027-Q1&select=*`);
    [ovrCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.gamma}&indicator_id=eq.${KPI.avail}&period=eq.2027-01&select=*`);
    [avail] = await adminGet(`indicators?id=eq.${KPI.avail}&select=*`);
    assert.ok(target && pkgCommit && ovrCommit && avail, 'fixtures de la semilla presentes');
    assert.ok(pkgCommit.package_by_category, 'el compromiso de VULN tiene package_by_category');
  });

  after(async () => {
    // Por si algún POST se aceptara (sería un hallazgo): no deja basura en la BD local.
    await admin('targets?month=eq.2031-06', { method: 'DELETE' });
  });

  const cases = () => [
    { who: 'gestora', table: 'indicators', id: KPI.avail, col: 'green_threshold', row: avail },
    { who: 'gestora', table: 'indicators', id: KPI.avail, col: 'yellow_threshold', row: avail },
    { who: 'gestora', table: 'targets', id: target.id, col: 'target_value', row: target },
    { who: 'custodio1', table: 'commitments', id: pkgCommit.id, col: 'package_total', row: pkgCommit },
    { who: 'custodio2', table: 'commitments', id: ovrCommit.id, col: 'green_override', row: ovrCommit },
    { who: 'custodio2', table: 'commitments', id: ovrCommit.id, col: 'yellow_override', row: ovrCommit },
  ];

  test('control positivo: cada rol reescribe su columna con el valor actual (200, 1 fila)', async () => {
    for (const c of cases()) {
      const r = await raw(tokens[c.who], `${c.table}?id=eq.${c.id}`, 'PATCH', JSON.stringify({ [c.col]: c.row[c.col] }));
      assert.equal(r.status, 200, `${c.who} ${c.table}.${c.col}: ${fmt(r)}`);
      assert.equal(r.json.length, 1, `${c.who} ${c.table}.${c.col}: la fila es alcanzable`);
    }
  });

  test('PATCH con literal o cadena >= 2^53 se rechaza por CHECK (23514) en cada columna', async () => {
    for (const c of cases()) {
      for (const v of [...HUGE_LITERALS, ...HUGE_STRINGS]) {
        // Los negativos no caben en columnas con `>= 0`: igual deben rechazarse (23514).
        const r = await raw(tokens[c.who], `${c.table}?id=eq.${c.id}`, 'PATCH', `{"${c.col}": ${v}}`);
        assert.ok(rejectedByCheck(r), `${c.who} ${c.table}.${c.col} = ${v}: ${fmt(r)}`);
      }
    }
  });

  test('custodio · package_by_category con 1e400 o 2^53 en cualquier clave se rechaza', async () => {
    const bodies = [
      '{"package_by_category": {"P0P1": 1e400, "P2P3": 500}}',
      '{"package_by_category": {"P0P1": 1500, "P2P3": 1e400}}',
      '{"package_by_category": {"P0P1": 9.007199254740992e15}}',
      '{"package_by_category": {"P0P1": -1e400}}',
      '{"package_by_category": {"P0P1": "1500"}}',
      '{"package_by_category": {"P0P1": null}}',
      '{"package_by_category": {"__proto__": 1e400}}',
      '{"package_by_category": {"P0P1": {"n": 1}}}',
      '{"package_by_category": [1e400]}',
      '{"package_by_category": 1e400}',
    ];
    for (const body of bodies) {
      const r = await raw(tokens.custodio1, `commitments?id=eq.${pkgCommit.id}`, 'PATCH', body);
      assert.ok(rejectedByCheck(r), `PATCH ${body}: ${fmt(r)}`);
    }
  });

  test('las filas conservan sus valores tras los intentos', async () => {
    for (const c of cases()) {
      const [now] = await adminGet(`${c.table}?id=eq.${c.id}&select=${c.col}`);
      assert.equal(String(now[c.col]), String(c.row[c.col]), `${c.table}.${c.col}`);
    }
    const [pkg] = await adminGet(`commitments?id=eq.${pkgCommit.id}&select=package_by_category`);
    assert.deepEqual(pkg.package_by_category, pkgCommit.package_by_category);
  });

  test('gestora · POST y upsert de meta con 1e400 se rechazan', async () => {
    const post = await raw(tokens.gestora, 'targets', 'POST',
      `{"unit_id":"${UNIT.alfa}","indicator_id":"${KPI.vuln}","month":"2031-06","target_value":1e400}`);
    assert.ok(rejectedByCheck(post), `POST targets 1e400: ${fmt(post)}`);
    const up = await raw(tokens.gestora, 'targets?on_conflict=unit_id,indicator_id,month', 'POST',
      `{"unit_id":"${target.unit_id}","indicator_id":"${target.indicator_id}","month":"${target.month}","target_value":1e400}`,
      'return=representation,resolution=merge-duplicates');
    // El grant de columna de M-09 puede cortarlo antes (403/42501); ambos rechazos valen.
    assert.ok(rejectedByCheck(up) || (up.status === 403 && up.json?.code === '42501'), `upsert targets 1e400: ${fmt(up)}`);
    const [now] = await adminGet(`targets?id=eq.${target.id}&select=target_value`);
    assert.equal(String(now.target_value), String(target.target_value));
    const left = await adminGet('targets?month=eq.2031-06&select=id');
    assert.equal(left.length, 0, 'no quedó ninguna meta de prueba');
  });

  test('custodio · POST de compromiso con 1e400 en paquete u overrides se rechaza', async () => {
    const bodies = [
      [tokens.custodio1, `{"unit_id":"${UNIT.alfa}","indicator_id":"${KPI.vuln}","period":"2031-Q3","package_total":1e400,"created_by":"${USERS.custodio1.id}"}`],
      [tokens.custodio1, `{"unit_id":"${UNIT.alfa}","indicator_id":"${KPI.vuln}","period":"2031-Q3","package_by_category":{"P0P1":1e400},"created_by":"${USERS.custodio1.id}"}`],
      [tokens.custodio2, `{"unit_id":"${UNIT.alfa}","indicator_id":"${KPI.avail}","period":"2031-06","green_override":1e400,"yellow_override":5,"created_by":"${USERS.custodio2.id}"}`],
    ];
    for (const [token, body] of bodies) {
      const r = await raw(token, 'commitments', 'POST', body);
      assert.ok(rejectedByCheck(r), `POST commitments ${body}: ${fmt(r)}`);
    }
    const left = await adminGet('commitments?period=in.(2031-Q3,2031-06)&select=id');
    assert.equal(left.length, 0, 'no quedó ningún compromiso de prueba');
  });

  test('lecturas de la API: ningún número de indicators, targets ni commitments se vuelve no finito', async () => {
    const isUnsafe = (v) => typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) >= 2 ** 53);
    const walk = (v, path, out) => {
      if (isUnsafe(v)) out.push(`${path}=${v}`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, out);
    };
    for (const who of ['gestora', 'custodio1', 'custodio2']) {
      for (const table of ['indicators', 'targets', 'commitments']) {
        const r = await raw(tokens[who], `${table}?select=*`, 'GET');
        assert.equal(r.status, 200, `${who} GET ${table}: ${fmt(r)}`);
        const bad = [];
        walk(r.json, table, bad);
        assert.deepEqual(bad, [], `${who} GET ${table}`);
      }
    }
  });
});

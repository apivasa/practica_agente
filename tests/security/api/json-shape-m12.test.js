// M-12 — Reproducción por API (PostgREST, JWT por rol) del cierre de H-M11-01..03
// (categorías 1 y 3). Cuerpos JSON crudos para poder enviar literales que JSON.stringify no
// emite (1e400, 1e-16000, claves duplicadas):
//   indicators.thresholds_by_category → gestora: forma { cat: { green, yellow } } numérica, |v| < 2^53
//   measurements.value (KPI sin categorías) → custodio del KPI: |v| < 2^53
//   commitments.package_by_category → custodio del KPI: enteros >= 0, claves libres
// Se espera 400 con código 23514 y que la fila no cambie; el líder no puede escribir (0 filas).
// Controles positivos: la forma legítima del front pasa. Corre en seguridad.yml › pentest-api.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, admin, adminGet, env, UNIT, KPI } from './_lib.js';

const skip = skipReason();
const fmt = (r) => `${r.status} ${r.text.slice(0, 240)}`;
const rejectedByCheck = (r) => r.status === 400 && r.json?.code === '23514';
const MARK_DAY = '2031-07-01';

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

describe('pentest-api: M-12 forma y tope de JSONB y measurements.value (H-M11-01..03)', { skip }, () => {
  let tokens; let vuln; let pkgCommit;

  before(async () => {
    tokens = await loginAll();
    [vuln] = await adminGet(`indicators?id=eq.${KPI.vuln}&select=id,thresholds_by_category`);
    [pkgCommit] = await adminGet(`commitments?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&period=eq.2027-Q1&select=id,package_by_category`);
    assert.ok(vuln && pkgCommit, 'fixtures de la semilla presentes');
    assert.ok(Object.keys(vuln.thresholds_by_category ?? {}).length > 0, 'VULN tiene umbrales por categoría');
  });

  after(async () => {
    await admin(`measurements?measured_on=eq.${MARK_DAY}`, { method: 'DELETE' });
  });

  test('gestora · control positivo: reescribe thresholds_by_category con su valor actual (200)', async () => {
    const r = await raw(tokens.gestora, `indicators?id=eq.${KPI.vuln}`, 'PATCH',
      JSON.stringify({ thresholds_by_category: vuln.thresholds_by_category }));
    assert.equal(r.status, 200, fmt(r));
    assert.equal(r.json.length, 1);
  });

  test('gestora · thresholds_by_category con forma o valor inseguro se rechaza (23514)', async () => {
    const bodies = [
      '{"P0P1": {"green": 1e400, "yellow": 90}}',
      '{"P0P1": {"green": 96, "yellow": 9.007199254740992e15}}',
      '{"P0P1": {"green": -9007199254740992, "yellow": 90}}',
      '{"P0P1": {"green": "96", "yellow": 90}}',
      '{"P0P1": {"green": null, "yellow": 90}}',
      '{"P0P1": {"green": 96}}',
      '{"P0P1": {}}',
      '{"P0P1": {"green": 96, "yellow": 90, "red": 1}}',
      '{"P0P1": {"green": 96, "yellow": 90, "__proto__": 1}}',
      '{"P0P1": {"Green": 96, "yellow": 90}}',
      '{"P0P1": {"green": [96], "yellow": 90}}',
      '{"P0P1": {"green": {"v": 96}, "yellow": 90}}',
      '{"P0P1": [96, 90]}',
      '{"P0P1": 96}',
      '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 1e400, "yellow": 1}}',
      '{"P0P1": {"green": 96, "yellow": 90, "green": 1e400}}',
      '[{"green": 96, "yellow": 90}]',
      '"P0P1"',
      '96',
    ];
    for (const b of bodies) {
      const r = await raw(tokens.gestora, `indicators?id=eq.${KPI.vuln}`, 'PATCH', `{"thresholds_by_category": ${b}}`);
      assert.ok(rejectedByCheck(r), `PATCH thresholds_by_category ${b}: ${fmt(r)}`);
    }
    const up = await raw(tokens.gestora, 'indicators?on_conflict=code', 'POST',
      '{"code":"VULN","name":"x","measurement_type":"cumulative_target","direction":"higher_is_better","green_threshold":1,"yellow_threshold":0,"thresholds_by_category":{"P0P1":{"green":1e400,"yellow":1}}}',
      'return=representation,resolution=merge-duplicates');
    // Un grant de columna puede cortarlo antes (403/42501); ambos rechazos valen.
    assert.ok(rejectedByCheck(up) || (up.status === 403 && up.json?.code === '42501'), `upsert indicators: ${fmt(up)}`);
    const [now] = await adminGet(`indicators?id=eq.${KPI.vuln}&select=thresholds_by_category`);
    assert.deepEqual(now.thresholds_by_category, vuln.thresholds_by_category, 'umbrales intactos');
  });

  test('custodio · measurements.value >= 2^53 en KPI sin categorías se rechaza (23514)', async () => {
    const lits = ['1e400', '9007199254740992', '9.007199254740992e15', '1E+16', '"1e400"', '" 9.007199254740992E15 "'];
    for (const v of lits) {
      const body = `{"unit_id":"${UNIT.gamma}","indicator_id":"${KPI.avail}","measured_on":"${MARK_DAY}","value":${v}}`;
      const r = await raw(tokens.custodio2, 'measurements', 'POST', body);
      assert.ok(rejectedByCheck(r), `POST measurements value=${v}: ${fmt(r)}`);
    }
    const ok = await raw(tokens.custodio2, 'measurements', 'POST',
      `{"unit_id":"${UNIT.gamma}","indicator_id":"${KPI.avail}","measured_on":"${MARK_DAY}","value":9007199254740991}`);
    assert.equal(ok.status, 201, `control positivo 2^53 - 1: ${fmt(ok)}`);
    const left = await adminGet(`measurements?measured_on=eq.${MARK_DAY}&select=value`);
    assert.equal(left.length, 1, 'solo quedó la medición del control positivo');
  });

  test('custodio · package_by_category no entero o negativo se rechaza (23514)', async () => {
    const bodies = [
      '{"P0P1": -5}',
      '{"P0P1": 1.5}',
      '{"P0P1": 1e-16000}',
      '{"P0P1": 9007199254740991.9999}',
      '{"P0P1": 20, "P2P3": -0.5}',
      '{"P0P1": 20, "total": 0.1}',
    ];
    for (const b of bodies) {
      const r = await raw(tokens.custodio1, `commitments?id=eq.${pkgCommit.id}`, 'PATCH', `{"package_by_category": ${b}}`);
      assert.ok(rejectedByCheck(r), `PATCH package_by_category ${b}: ${fmt(r)}`);
    }
    const [now] = await adminGet(`commitments?id=eq.${pkgCommit.id}&select=package_by_category`);
    assert.deepEqual(now.package_by_category, pkgCommit.package_by_category, 'paquete intacto');
  });

  test('custodio · control positivo: claves libres, 1.0 y -0 pasan; se restaura el paquete', async () => {
    const r = await raw(tokens.custodio1, `commitments?id=eq.${pkgCommit.id}`, 'PATCH',
      '{"package_by_category": {"Crítica": 1.0, "total": 1e2, "P2P3": -0}}');
    assert.equal(r.status, 200, fmt(r));
    const back = await raw(tokens.custodio1, `commitments?id=eq.${pkgCommit.id}`, 'PATCH',
      JSON.stringify({ package_by_category: pkgCommit.package_by_category }));
    assert.equal(back.status, 200, fmt(back));
  });

  test('líder · no puede escribir umbrales ni paquete (0 filas) y nada cambia', async () => {
    const a = await raw(tokens.lider1, `indicators?id=eq.${KPI.vuln}`, 'PATCH',
      '{"thresholds_by_category": {"P0P1": {"green": 1, "yellow": 0}}}');
    assert.ok([200, 401, 403].includes(a.status), fmt(a));
    if (a.status === 200) assert.equal(a.json.length, 0, 'líder: 0 filas en indicators');
    const b = await raw(tokens.lider1, `commitments?id=eq.${pkgCommit.id}`, 'PATCH', '{"package_by_category": {"P0P1": 1}}');
    assert.ok([200, 401, 403].includes(b.status), fmt(b));
    if (b.status === 200) assert.equal(b.json.length, 0, 'líder: 0 filas en commitments');
    const [ind] = await adminGet(`indicators?id=eq.${KPI.vuln}&select=thresholds_by_category`);
    const [pkg] = await adminGet(`commitments?id=eq.${pkgCommit.id}&select=package_by_category`);
    assert.deepEqual(ind.thresholds_by_category, vuln.thresholds_by_category);
    assert.deepEqual(pkg.package_by_category, pkgCommit.package_by_category);
  });

  test('lecturas: ningún número de measurements ni de los JSONB se vuelve inseguro al parsear', async () => {
    const isUnsafe = (v) => typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) >= 2 ** 53);
    const walk = (v, path, out) => {
      if (isUnsafe(v)) out.push(`${path}=${v}`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, out);
    };
    for (const who of ['gestora', 'custodio1', 'custodio2']) {
      for (const q of ['measurements?select=value', 'indicators?select=thresholds_by_category', 'commitments?select=package_by_category']) {
        const r = await raw(tokens[who], q, 'GET');
        assert.equal(r.status, 200, `${who} GET ${q}: ${fmt(r)}`);
        const bad = [];
        walk(r.json, q, bad);
        assert.deepEqual(bad, [], `${who} GET ${q}`);
      }
    }
  });
});

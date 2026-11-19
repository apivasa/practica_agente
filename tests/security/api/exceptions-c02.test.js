// C-02 — Pentest de exceptions contra PostgREST real (categorías 1 y 3).
// Columnas nuevas: change_ref, revoked_at, revoked_by. Reglas del trigger
// private.enforce_exception_rules: solo quien aprobó edita/revoca,
// approved_by/created_at/revoked_by inmutables, tope de 90 días desde
// created_at, revocación con hora y autor del servidor, revocada no se edita.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, as, adminInsert, adminGet, USERS, UNIT, DENIED, dateInDays } from './_lib.js';

const skip = skipReason();
const REPR = { Prefer: 'return=representation' };
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
const deniedOrEmpty = (r) => DENIED.includes(r.status) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
const recent = (ts, since) => new Date(ts).getTime() >= since - 5 * 60_000;
const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
let tokens;
let CM;
let fx;

describe('pentest-api: exceptions (C-02)', { skip }, () => {
  before(async () => {
    tokens = await loginAll();
    CM = as('comite', tokens);
    const exp = dateInDays(30);
    const [foreign, orphan, ownByAdmin] = await adminInsert('exceptions', [
      { unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture foreign', expires_on: exp, approved_by: USERS.gestora.id },
      { unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture orphan', expires_on: exp, approved_by: null },
      { unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture own', expires_on: exp, approved_by: USERS.comite.id },
    ]);
    fx = { foreign, orphan, ownByAdmin };
  });

  const unchanged = async (row) => {
    const [now] = await adminGet(`exceptions?id=eq.${row.id}`);
    for (const k of ['reason', 'expires_on', 'approved_by', 'revoked_at', 'revoked_by', 'unit_id', 'scope', 'created_at']) {
      assert.deepEqual(now[k], row[k], `${k} cambió en ${row.reason}`);
    }
  };

  test('comité: no edita, no revoca ni firma la excepción de otro', async () => {
    for (const body of [{ reason: 'tomada' }, { expires_on: dateInDays(60) }, { revoked_at: new Date().toISOString() },
      { approved_by: USERS.comite.id }, { approved_by: USERS.comite.id, expires_on: dateInDays(80) }]) {
      const r = await CM(`exceptions?id=eq.${fx.foreign.id}`, { method: 'PATCH', body, headers: REPR });
      assert.ok(DENIED.includes(r.status), `${JSON.stringify(body)} → ${fmt(r)}`);
    }
    await unchanged(fx.foreign);
  });

  test('comité: no adopta una excepción sin firmante (approved_by null)', async () => {
    const r = await CM(`exceptions?id=eq.${fx.orphan.id}`, { method: 'PATCH', body: { approved_by: USERS.comite.id }, headers: REPR });
    assert.ok(DENIED.includes(r.status), fmt(r));
    const rv = await CM(`exceptions?id=eq.${fx.orphan.id}`, { method: 'PATCH', body: { revoked_at: new Date().toISOString() }, headers: REPR });
    assert.ok(DENIED.includes(rv.status), fmt(rv));
    await unchanged(fx.orphan);
  });

  test('comité: PATCH masivo por filtro no toca excepciones ajenas', async () => {
    const r = await CM('exceptions?reason=like.c02sec-fixture*', { method: 'PATCH', body: { reason: 'c02sec-fixture masivo' }, headers: REPR });
    assert.ok(DENIED.includes(r.status) || r.status === 200, fmt(r));
    await unchanged(fx.foreign);
    await unchanged(fx.orphan);
  });

  test('líder, gestora, custodio y anónimo: no revocan ni editan', async () => {
    for (const actor of ['lider1', 'gestora', 'custodio1', 'anon']) {
      const call = as(actor, tokens);
      for (const body of [{ revoked_at: new Date().toISOString() }, { change_ref: 'CHG-forjado' }, { expires_on: dateInDays(10) }]) {
        const r = await call(`exceptions?id=eq.${fx.ownByAdmin.id}`, { method: 'PATCH', body, headers: REPR });
        assert.ok(deniedOrEmpty(r), `${actor} ${JSON.stringify(body)} → ${fmt(r)}`);
      }
    }
    await unchanged(fx.ownByAdmin);
  });

  test('comité: al crear, created_at / revoked_at / revoked_by los fija el servidor', async () => {
    const since = Date.now();
    const r = await CM('exceptions', {
      method: 'POST',
      headers: REPR,
      body: {
        unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture forjada', expires_on: dateInDays(30), approved_by: USERS.comite.id,
        created_at: '2026-01-01T00:00:00Z', revoked_at: '2026-01-02T00:00:00Z', revoked_by: USERS.gestora.id,
      },
    });
    assert.equal(r.status, 201, fmt(r));
    const [row] = r.json;
    assert.ok(recent(row.created_at, since), `created_at aceptado del cliente: ${row.created_at}`);
    assert.equal(row.revoked_at, null);
    assert.equal(row.revoked_by, null);
  });

  test('comité: tope de vigencia no evadible (POST lejano, POST con created_at futuro, PATCH alargando)', async () => {
    const far = await CM('exceptions', { method: 'POST', headers: REPR, body: { unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture lejana', expires_on: dateInDays(120), approved_by: USERS.comite.id } });
    assert.equal(far.status, 400, fmt(far));
    const fut = await CM('exceptions', { method: 'POST', headers: REPR, body: { unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture futura', expires_on: dateInDays(150), approved_by: USERS.comite.id, created_at: `${dateInDays(100)}T12:00:00Z` } });
    assert.equal(fut.status, 400, fmt(fut));

    const ok = await CM('exceptions', { method: 'POST', headers: REPR, body: { unit_id: UNIT.alfa, scope: 'all', reason: 'c02sec-fixture tope', expires_on: dateInDays(10), approved_by: USERS.comite.id } });
    assert.equal(ok.status, 201, fmt(ok));
    const id = ok.json[0].id;
    const longer = await CM(`exceptions?id=eq.${id}`, { method: 'PATCH', headers: REPR, body: { expires_on: dateInDays(95) } });
    assert.equal(longer.status, 400, fmt(longer));
    const backdate = await CM(`exceptions?id=eq.${id}`, { method: 'PATCH', headers: REPR, body: { created_at: `${dateInDays(60)}T00:00:00Z`, expires_on: dateInDays(140) } });
    assert.ok(DENIED.includes(backdate.status) || backdate.status === 400, fmt(backdate));
    const [now] = await adminGet(`exceptions?id=eq.${id}`);
    assert.equal(now.expires_on, ok.json[0].expires_on);
    assert.equal(now.created_at, ok.json[0].created_at);
  });

  test('comité: revocar fija hora y autor del servidor; revocada no se reactiva ni se edita', async () => {
    const ins = await CM('exceptions', { method: 'POST', headers: REPR, body: { unit_id: UNIT.beta, scope: 'change_start', change_ref: 'CHG-C02SEC', reason: 'c02sec-fixture revocar', expires_on: dateInDays(20), approved_by: USERS.comite.id } });
    assert.equal(ins.status, 201, fmt(ins));
    const id = ins.json[0].id;
    const forge = await CM(`exceptions?id=eq.${id}`, { method: 'PATCH', headers: REPR, body: { revoked_at: '2020-01-01T00:00:00Z', revoked_by: USERS.gestora.id } });
    assert.ok(DENIED.includes(forge.status), `revoked_by escrito por el cliente: ${fmt(forge)}`);

    const since = Date.now();
    const rv = await CM(`exceptions?id=eq.${id}`, { method: 'PATCH', headers: REPR, body: { revoked_at: '2020-01-01T00:00:00Z' } });
    assert.equal(rv.status, 200, fmt(rv));
    assert.ok(recent(rv.json[0].revoked_at, since), `revoked_at del cliente aceptado: ${rv.json[0].revoked_at}`);
    assert.equal(rv.json[0].revoked_by, USERS.comite.id);

    for (const body of [{ revoked_at: null }, { expires_on: dateInDays(30) }, { scope: 'all' }, { reason: 'c02sec-fixture reabierta' }]) {
      const r = await CM(`exceptions?id=eq.${id}`, { method: 'PATCH', headers: REPR, body });
      assert.ok(DENIED.includes(r.status), `${JSON.stringify(body)} → ${fmt(r)}`);
    }
    const [now] = await adminGet(`exceptions?id=eq.${id}`);
    assert.equal(now.revoked_at, rv.json[0].revoked_at);
    assert.equal(now.revoked_by, USERS.comite.id);
  });

  test('comité: entradas inválidas (change_start sin change, motivo > 2000, change > 200)', async () => {
    const base = { unit_id: UNIT.alfa, scope: 'change_start', reason: 'c02sec-fixture inválida', expires_on: dateInDays(10), approved_by: USERS.comite.id };
    for (const body of [
      { ...base },
      { ...base, change_ref: '   ' },
      { ...base, change_ref: 'x'.repeat(201) },
      { ...base, change_ref: 'CHG-1', reason: 'r'.repeat(2001) },
    ]) {
      const r = await CM('exceptions', { method: 'POST', headers: REPR, body });
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)} → ${fmt(r)}`);
    }
  });

  test('XSS almacenado: el motivo y el change se guardan literales (la vista los pinta como texto)', async () => {
    const r = await CM('exceptions', { method: 'POST', headers: REPR, body: { unit_id: UNIT.alfa, scope: 'change_start', change_ref: '"><svg onload=alert(3)>', reason: XSS, expires_on: dateInDays(5), approved_by: USERS.comite.id } });
    assert.equal(r.status, 201, fmt(r));
    const [row] = await adminGet(`exceptions?id=eq.${r.json[0].id}`);
    assert.equal(row.reason, XSS);
    assert.equal(row.change_ref, '"><svg onload=alert(3)>');
  });

  test('el líder ve change_ref y revoked_at solo de su unidad', async () => {
    const L1 = as('lider1', tokens);
    const r = await L1('exceptions?select=unit_id,change_ref,revoked_at,revoked_by');
    assert.equal(r.status, 200, fmt(r));
    assert.ok(r.json.every((x) => x.unit_id === UNIT.alfa), 'el líder de Alfa ve excepciones de otra unidad');
  });
});

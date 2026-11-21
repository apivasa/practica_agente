// F-12 — Pentest de la API real (PostgREST local con seed) sobre la RPC
// public.mark_alerts_email_expired. Categorías 1 (RPC con roles no
// autorizados), 3 (inyección por parámetros) y 8 (auditoría consistente).
// Solo Supabase local: nunca producción, nunca Resend.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, as, admin, adminInsert, adminGet, USERS, UNIT, ACTORS } from './_lib.js';

const skip = skipReason();
const RPC = 'rpc/mark_alerts_email_expired';
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
// Sin EXECUTE: 401 (anon) / 403 (con sesión); 404 si PostgREST la oculta.
const RPC_DENIED = [401, 403, 404];
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
let tokens;
let fx;

const body = (ids, extra = {}) => ({
  p_ids: ids,
  p_before: daysAgo(7),
  p_max_attempts: 3,
  p_skipped_at: new Date().toISOString(),
  p_lookback_days: 7,
  ...extra,
});

async function untouched(ids) {
  const rows = await adminGet(`alerts?id=in.(${ids.join(',')})&select=id,email_skipped_at,email_skip_reason`);
  assert.equal(rows.length, ids.length);
  assert.ok(rows.every((r) => r.email_skipped_at === null && r.email_skip_reason === null), JSON.stringify(rows));
  const audit = await adminGet(`audit_log?entity=eq.alerts&action=eq.alert_email_skipped&entity_id=in.(${ids.join(',')})&select=id`);
  assert.deepEqual(audit, [], 'no debe haber auditoría de omisión para alertas no marcadas');
}

describe('pentest-api: RPC mark_alerts_email_expired (F-12)', { skip }, () => {
  before(async () => {
    tokens = await loginAll();
    const tag = `f12-sec:${Date.now()}`;
    // 0 y 1: vencidas y abiertas (Alfa, Beta); 2: reciente (no vence).
    const rows = [
      { unit_id: UNIT.alfa, recipient_user_id: USERS.lider1.id, kind: 'color_change', dedupe_key: `${tag}:a`, payload: {}, sent_at: daysAgo(20), email_attempts: 0 },
      { unit_id: UNIT.beta, recipient_user_id: USERS.lider2.id, kind: 'color_change', dedupe_key: `${tag}:b`, payload: {}, sent_at: daysAgo(15), email_attempts: 1 },
      { unit_id: UNIT.alfa, recipient_user_id: USERS.lider1.id, kind: 'color_change', dedupe_key: `${tag}:c`, payload: {}, sent_at: daysAgo(1), email_attempts: 0 },
    ];
    const inserted = await adminInsert('alerts', rows);
    fx = { expired: [inserted[0].id, inserted[1].id], recent: inserted[2].id, all: inserted.map((r) => r.id) };
  });

  for (const actor of ACTORS) {
    test(`${actor} · POST ${RPC} → denegado y nada marcado ni auditado`, async () => {
      const call = as(actor, tokens);
      const variants = [
        { method: 'POST', body: body(fx.all) },
        { method: 'POST', body: body(fx.all), headers: { 'Content-Profile': 'public' } },
        { method: 'POST', body: body(fx.all), headers: { Prefer: 'params=single-object' } },
        { method: 'POST', body: body(fx.all, { p_before: daysAgo(-365), p_max_attempts: 999 }) },
      ];
      for (const v of variants) {
        const r = await call(RPC, v);
        assert.ok(RPC_DENIED.includes(r.status), `${actor} ejecuta la RPC (${JSON.stringify(v.headers ?? {})}): ${fmt(r)}`);
      }
      // GET con parámetros en la query (función volatile: PostgREST lo rechaza igual).
      const qs = `p_ids=${encodeURIComponent(`{${fx.all.join(',')}}`)}&p_before=${encodeURIComponent(daysAgo(7))}&p_max_attempts=3&p_skipped_at=${encodeURIComponent(new Date().toISOString())}&p_lookback_days=7`;
      const g = await call(`${RPC}?${qs}`);
      assert.ok([...RPC_DENIED, 405].includes(g.status), `${actor} GET: ${fmt(g)}`);
      await untouched(fx.all);
    });
  }

  test('líder no se hace pasar por backend con la clave publicable y un JWT ajeno al rol', async () => {
    // Cabecera apikey publicable + Authorization de un líder: no es service_role.
    const r = await as('lider1', tokens)(RPC, { method: 'POST', body: body(fx.all), headers: { 'X-Client-Info': 'service_role' } });
    assert.ok(RPC_DENIED.includes(r.status), fmt(r));
    await untouched(fx.all);
  });

  test('backend: inyección en parámetros se rechaza como error de tipo (400), sin efecto', async () => {
    for (const bad of [
      body(["x'); drop table public.alerts; --"]),
      body([`${fx.expired[0]}' or '1'='1`]),
      body(fx.all, { p_lookback_days: '7; delete from public.audit_log' }),
      body(fx.all, { p_before: "now()' or true --" }),
      body(fx.all, { p_lookback_days: 366 }),
      body(fx.all, { p_max_attempts: 0 }),
      body(Array.from({ length: 1001 }, () => fx.recent)),
      body(null),
    ]) {
      const r = await admin(RPC, { method: 'POST', body: bad });
      assert.equal(r.status, 400, `${JSON.stringify(bad).slice(0, 80)}: ${fmt(r)}`);
    }
    await untouched(fx.all);
    // La tabla sigue ahí.
    assert.equal((await adminGet(`alerts?id=eq.${fx.recent}&select=id`)).length, 1);
  });

  test('backend: marca solo las vencidas y audita cada una una sola vez (8)', async () => {
    const r = await admin(RPC, { method: 'POST', body: body(fx.all) });
    assert.equal(r.status, 200, fmt(r));
    const marked = (r.json ?? []).map((x) => x.alert_id).sort();
    assert.deepEqual(marked, [...fx.expired].sort());
    const audit = await adminGet(`audit_log?action=eq.alert_email_skipped&entity_id=in.(${fx.all.join(',')})&select=entity_id,actor,entity,details`);
    assert.deepEqual(audit.map((a) => a.entity_id).sort(), [...fx.expired].sort(), 'una fila por alerta marcada, ninguna para la reciente');
    for (const a of audit) {
      assert.equal(a.actor, 'system:alert-email');
      assert.equal(a.entity, 'alerts');
      assert.equal(a.details.reason, 'expired');
      assert.doesNotMatch(JSON.stringify(a.details), /@/, 'sin correos en la auditoría');
    }
    // Idempotente: segunda llamada no marca ni duplica auditoría.
    const again = await admin(RPC, { method: 'POST', body: body(fx.all) });
    assert.equal(again.status, 200, fmt(again));
    assert.deepEqual(again.json, []);
    const audit2 = await adminGet(`audit_log?action=eq.alert_email_skipped&entity_id=in.(${fx.all.join(',')})&select=id`);
    assert.equal(audit2.length, 2);
  });

  for (const actor of ACTORS) {
    test(`${actor} · no borra, edita ni falsifica la auditoría de la omisión`, async () => {
      const call = as(actor, tokens);
      const filter = `audit_log?action=eq.alert_email_skipped&entity_id=in.(${fx.expired.join(',')})`;
      const d = await call(filter, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      assert.ok([401, 403].includes(d.status) || (d.status === 200 && Array.isArray(d.json) && d.json.length === 0), `DELETE: ${fmt(d)}`);
      const p = await call(filter, { method: 'PATCH', body: { details: { reason: 'manual' } }, headers: { Prefer: 'return=representation' } });
      assert.ok([401, 403].includes(p.status) || (p.status === 200 && Array.isArray(p.json) && p.json.length === 0), `PATCH: ${fmt(p)}`);
      const i = await call('audit_log', { method: 'POST', body: { actor: 'system:alert-email', action: 'alert_email_skipped', entity: 'alerts', entity_id: fx.recent, details: { reason: 'expired' } } });
      assert.ok([401, 403].includes(i.status), `INSERT: ${fmt(i)}`);
      // Ni desmarcar la alerta para forzar un reenvío.
      const u = await call(`alerts?id=in.(${fx.expired.join(',')})`, { method: 'PATCH', body: { email_skipped_at: null, email_skip_reason: null }, headers: { Prefer: 'return=representation' } });
      assert.ok([401, 403].includes(u.status), `PATCH alerts: ${fmt(u)}`);
      const rows = await adminGet(`${filter}&select=details`);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((x) => x.details.reason === 'expired'));
      const al = await adminGet(`alerts?id=in.(${fx.expired.join(',')})&select=email_skip_reason`);
      assert.ok(al.every((x) => x.email_skip_reason === 'expired'));
    });
  }
});

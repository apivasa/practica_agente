// C-05 — Pentest de la API real (PostgREST + GoTrue locales) sobre el estado de correo
// de las alertas. Categorías 1, 2 y 8. Nunca llama a Resend.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, loginAll, as, adminInsert, adminGet, request, USERS, UNIT, ROLES, ACTORS, DENIED } from './_lib.js';

const skip = skipReason();
const REPR = { Prefer: 'return=representation' };
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
const deniedOrEmpty = (r) => DENIED.includes(r.status) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
let tokens;
let fx;

describe('pentest-api: estado de correo de alertas (C-05)', { skip }, () => {
  before(async () => {
    tokens = await loginAll();
    const tag = `c05-sec:${Date.now()}`;
    // Una alerta por actor con rol (destinatario = él mismo) y dos de unidades distintas.
    const rows = ROLES.map((r) => ({
      unit_id: UNIT.alfa, recipient_user_id: USERS[r].id, kind: 'color_change', dedupe_key: `${tag}:${r}`,
      payload: { unit_name: 'Alfa', message: 'Alfa: rojo' },
    }));
    rows.push({ unit_id: UNIT.beta, recipient_user_id: USERS.lider2.id, kind: 'color_change', dedupe_key: `${tag}:beta`, payload: {} });
    const inserted = await adminInsert('alerts', rows);
    fx = { own: Object.fromEntries(ROLES.map((r, i) => [r, inserted[i]])), beta: inserted[inserted.length - 1] };
  });

  test('ningún rol marca, desmarca ni reinicia el correo de su propia alerta', async () => {
    const bodies = [
      { emailed_at: new Date().toISOString() },
      { emailed_at: null },
      { email_attempts: 0 },
      { email_attempts: 99 },
      { read_at: new Date().toISOString(), emailed_at: null },
      { read_at: new Date().toISOString(), email_attempts: 0 },
    ];
    for (const role of ROLES) {
      const call = as(role, tokens);
      for (const body of bodies) {
        const r = await call(`alerts?id=eq.${fx.own[role].id}`, { method: 'PATCH', body, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${role} ${JSON.stringify(body)}: ${fmt(r)}`);
      }
    }
    // El backend confirma que nada cambió.
    const rows = await adminGet(`alerts?id=in.(${ROLES.map((r) => fx.own[r].id).join(',')})&select=emailed_at,email_attempts`);
    assert.ok(rows.every((x) => x.emailed_at === null && x.email_attempts === 0), JSON.stringify(rows));
  });

  test('anónimo no lee ni escribe el estado de correo', async () => {
    const call = as('anon', tokens);
    const r = await call('alerts?select=id,emailed_at,email_attempts');
    assert.ok(deniedOrEmpty(r), fmt(r));
    const w = await call(`alerts?id=eq.${fx.beta.id}`, { method: 'PATCH', body: { emailed_at: null }, headers: REPR });
    assert.ok(DENIED.includes(w.status), fmt(w));
  });

  test('líder de Alfa no ve ni filtra por el estado de correo de alertas de Beta', async () => {
    const L1 = as('lider1', tokens);
    for (const q of [
      `alerts?id=eq.${fx.beta.id}&select=id,emailed_at,email_attempts`,
      `alerts?unit_id=eq.${UNIT.beta}&emailed_at=is.null`,
      `alerts?or=(emailed_at.is.null,email_attempts.gte.0)&recipient_user_id=neq.${USERS.lider1.id}`,
    ]) {
      const r = await L1(q);
      assert.ok(deniedOrEmpty(r), `${q}: ${fmt(r)}`);
    }
  });

  test('ningún token de usuario usa la API admin de Auth para leer correos (getUserById)', async () => {
    for (const actor of ACTORS) {
      const token = actor === 'anon' ? undefined : tokens[actor];
      for (const id of [USERS.lider2.id, USERS.gestora.id]) {
        const r = await request(`/auth/v1/admin/users/${id}`, { token });
        assert.ok(DENIED.includes(r.status), `${actor} → admin/users/${id}: ${fmt(r)}`);
        assert.doesNotMatch(r.text, /@example\.test/, `${actor}: la respuesta trae un correo`);
      }
    }
  });

  test('PostgREST no expone auth.users ni vistas con correos', async () => {
    for (const actor of ACTORS) {
      const call = as(actor, tokens);
      for (const p of ['users?select=email', 'auth.users?select=email']) {
        const r = await call(p);
        assert.ok(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), `${actor} ${p}: ${fmt(r)}`);
        assert.doesNotMatch(r.text, /@example\.test/);
      }
      const prof = await call('user_roles?select=*');
      assert.doesNotMatch(prof.text, /@example\.test/, `${actor}: user_roles trae correos`);
    }
  });
});

// S-03 — Pentest de la API real: matriz rol × tabla × operación contra
// PostgREST (Supabase local con seed). Cada celda verifica permitido/denegado
// según docs/adr/0005-modelo-datos-y-rls.md. Categoría 1 (autorización y RLS).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  skipReason, assertKeyFormats, loginAll, as, admin, adminInsert, adminGet, sql,
  ACTORS, USERS, UNIT, KPI, DENIED,
} from './_lib.js';
import { MATRIX, RPC_ALLOWLIST } from './matrix.js';

const skip = skipReason();
const REPR = { Prefer: 'return=representation' };
let tokens;
const created = []; // [table, id] creados por actores autorizados: se limpian al final

const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;

describe('pentest-api: matriz rol × tabla × operación', { skip }, () => {
  before(async () => {
    assertKeyFormats();
    tokens = await loginAll();
    // Fixtures que el seed no trae (las escribiría el backend).
    await admin('evaluations?month=eq.2027-01', { method: 'DELETE' });
    await adminInsert('evaluations', [
      { unit_id: UNIT.alfa, indicator_id: null, month: '2027-01', color: 'red', sample_size: 0 },
      { unit_id: UNIT.beta, indicator_id: null, month: '2027-01', color: 'red', sample_size: 0 },
      { unit_id: UNIT.alfa, indicator_id: KPI.vuln, month: '2027-01', color: 'yellow', sample_size: 1 },
    ]);
    const exp = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await adminInsert('exceptions', [
      { unit_id: UNIT.alfa, reason: 'pentest-fixture A', expires_on: exp, approved_by: USERS.comite.id },
      { unit_id: UNIT.beta, reason: 'pentest-fixture B', expires_on: exp, approved_by: USERS.comite.id },
    ]);
    await adminInsert('alerts', [
      { unit_id: UNIT.alfa, recipient_user_id: USERS.lider1.id, kind: 'pentest-fixture' },
      { unit_id: UNIT.beta, recipient_user_id: USERS.lider2.id, kind: 'pentest-fixture' },
    ]);
  });

  after(async () => {
    for (const [table, id] of created.reverse()) {
      await admin(`${table}?id=eq.${id}`, { method: 'DELETE' });
    }
  });

  // -------------------------------------------------------------------------
  // Catálogo: toda tabla de public tiene RLS y está en la matriz.
  // -------------------------------------------------------------------------
  describe('catálogo', () => {
    test('toda tabla de public tiene RLS activado (si no, falla el job)', () => {
      const noRls = sql(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
                         and c.relkind in ('r','p') and not c.relrowsecurity`);
      assert.deepEqual(noRls, [], `tablas sin RLS: ${noRls.join(', ')}`);
    });

    test('ninguna vista de public salta RLS (security_invoker obligatorio)', () => {
      const views = sql(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
                         and c.relkind in ('v','m')
                         and not coalesce(c.reloptions @> array['security_invoker=true'], false)`);
      assert.deepEqual(views, []);
    });

    test('toda tabla de public tiene fila en la matriz del pentest', () => {
      const tables = sql(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
                          and c.relkind in ('r','p','v','m','f') order by 1`);
      assert.ok(tables.length >= 10, `catálogo inesperado: ${tables.join(', ')}`);
      const missing = tables.filter((t) => !(t in MATRIX));
      assert.deepEqual(missing, [], `tablas sin matriz de pentest: ${missing.join(', ')}`);
      const stale = Object.keys(MATRIX).filter((t) => !tables.includes(t));
      assert.deepEqual(stale, [], `matriz con tablas inexistentes: ${stale.join(', ')}`);
    });

    test('funciones expuestas por RPC (public) coinciden con la lista permitida', () => {
      const fns = sql(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`);
      const extra = fns.filter((f) => !RPC_ALLOWLIST.includes(f));
      assert.deepEqual(extra, [], `funciones RPC no previstas: ${extra.join(', ')}`);
    });

    test('la API (OpenAPI) solo publica las tablas de la matriz', async () => {
      const r = await admin('', { headers: { Accept: 'application/openapi+json' } });
      assert.equal(r.status, 200, fmt(r));
      const paths = Object.keys(r.json.paths ?? {}).filter((p) => p !== '/');
      const tables = paths.filter((p) => !p.startsWith('/rpc/')).map((p) => p.slice(1));
      const rpcs = paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));
      assert.deepEqual(tables.filter((t) => !(t in MATRIX)), []);
      assert.deepEqual(rpcs.filter((f) => !RPC_ALLOWLIST.includes(f)), []);
    });
  });

  // -------------------------------------------------------------------------
  // Matriz
  // -------------------------------------------------------------------------
  for (const [table, spec] of Object.entries(MATRIX)) {
    describe(table, () => {
      for (const actor of ACTORS) {
        test(`${actor} · GET`, async () => {
          const r = await as(actor, tokens)(`${table}?select=*`);
          if (actor === 'anon') {
            assert.ok(DENIED.includes(r.status), `anon lee ${table}: ${fmt(r)}`);
            return;
          }
          assert.equal(r.status, 200, fmt(r));
          const { visible, mustInclude } = spec.read(actor);
          const leaked = r.json.filter((row) => !visible(row));
          assert.deepEqual(leaked.map((x) => x.id), [], `${actor} ve filas ajenas de ${table}`);
          if (mustInclude) assert.equal(mustInclude(r.json), null, `${actor} no ve lo que el diseño permite en ${table}`);
        });

        test(`${actor} · POST`, async () => {
          const r = await as(actor, tokens)(table, { method: 'POST', body: spec.insertBody(actor), headers: REPR });
          if (spec.insert.includes(actor)) {
            assert.equal(r.status, 201, `${actor} debería poder insertar en ${table}: ${fmt(r)}`);
            for (const row of r.json) created.push([table, row.id]);
          } else {
            assert.ok(DENIED.includes(r.status), `${actor} inserta en ${table}: ${fmt(r)}`);
          }
        });

        test(`${actor} · PATCH`, async () => {
          const { filter, change, restore } = spec.updateTarget(actor);
          const before = await adminGet(`${table}?${filter}`);
          assert.ok(before.length > 0, `fixture inexistente para PATCH ${table}?${filter}`);
          const r = await as(actor, tokens)(`${table}?${filter}`, { method: 'PATCH', body: change, headers: REPR });
          const afterRows = await adminGet(`${table}?id=in.(${before.map((x) => x.id).join(',')})`);
          try {
            if (spec.update.includes(actor)) {
              assert.equal(r.status, 200, `${actor} debería poder actualizar ${table}: ${fmt(r)}`);
              assert.ok(r.json.length > 0, `${actor} no actualizó ninguna fila de ${table}`);
            } else {
              const denied = DENIED.includes(r.status) || (r.status === 200 && r.json.length === 0);
              assert.ok(denied, `${actor} actualiza ${table}: ${fmt(r)}`);
              const byId = new Map(before.map((x) => [x.id, x]));
              for (const row of afterRows) {
                const orig = byId.get(row.id);
                if (orig) assert.deepEqual(row, orig, `${table} ${row.id} cambió tras PATCH de ${actor}`);
              }
            }
          } finally {
            if (restore) {
              for (const orig of before) {
                const body = Object.fromEntries(restore.map((c) => [c, orig[c]]));
                await admin(`${table}?id=eq.${orig.id}`, { method: 'PATCH', body });
              }
            }
          }
        });

        test(`${actor} · DELETE`, async () => {
          let id;
          if (spec.tempRow) {
            [{ id }] = await adminInsert(table, [spec.tempRow()]);
          } else {
            const { filter } = spec.updateTarget(actor);
            [{ id }] = await adminGet(`${table}?${filter}&limit=1`);
          }
          const r = await as(actor, tokens)(`${table}?id=eq.${id}`, { method: 'DELETE', headers: REPR });
          const still = await adminGet(`${table}?id=eq.${id}`);
          try {
            if (spec.remove.includes(actor)) {
              assert.equal(r.status, 200, fmt(r));
              assert.equal(r.json.length, 1, `${actor} no borró en ${table}`);
              assert.equal(still.length, 0);
            } else {
              const denied = DENIED.includes(r.status) || (r.status === 200 && r.json.length === 0);
              assert.ok(denied, `${actor} borra en ${table}: ${fmt(r)}`);
              assert.equal(still.length, 1, `${table} ${id} desapareció tras DELETE de ${actor}`);
            }
          } finally {
            if (spec.tempRow && still.length) await admin(`${table}?id=eq.${id}`, { method: 'DELETE' });
          }
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // RPC: las funciones de autorización (esquema private) no son invocables.
  // -------------------------------------------------------------------------
  describe('RPC', () => {
    const PRIVATE_FNS = [
      ['has_role', { r: 'kpi_manager' }],
      ['has_any_role', {}],
      ['is_leader_of', { unit: UNIT.beta }],
      ['is_custodian_of', { indicator: KPI.avail }],
      ['audit_row_change', {}],
      ['forbid_audit_log_change', {}],
    ];
    for (const actor of ACTORS) {
      for (const [fn, args] of PRIVATE_FNS) {
        test(`${actor} · rpc/${fn} no está expuesta`, async () => {
          const call = as(actor, tokens);
          const pub = await call(`rpc/${fn}`, { method: 'POST', body: args });
          assert.ok([401, 403, 404].includes(pub.status), `rpc/${fn} en public: ${fmt(pub)}`);
          const priv = await call(`rpc/${fn}`, { method: 'POST', body: args, headers: { 'Content-Profile': 'private' } });
          assert.ok([401, 403, 406].includes(priv.status), `rpc/${fn} con Content-Profile private: ${fmt(priv)}`);
        });
      }
    }
  });
});

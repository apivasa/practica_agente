// S-05 — Pentest previo a producción, fase A (Supabase local con seed, job
// `pentest-api` de seguridad.yml). Complementa la matriz de S-03 con lo que un
// atacante probaría con la clave publicable y una sesión de cada rol:
//   1. Inyección en filtros, orden, select y `or=` de PostgREST (categoría 3):
//      nunca 5xx, nunca sleep efectivo y nunca filas fuera del alcance del rol.
//   2. Esquemas no expuestos por Accept-Profile / Content-Profile (auth, private…).
//   3. Embebidos (`select=*,units(*)`) que podrían saltar el alcance de la unidad.
//   4. GraphQL (`/graphql/v1`, pg_graphql viene activado en los proyectos de
//      Supabase): sin tablas para anónimo y con RLS para el líder.
//   5. Auth (categoría 2): ajustes públicos, enumeración de usuarios en el
//      login, refresh token inventado, duración de la sesión.
//   6. Integridad: ninguna de las sondas cambia datos.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  skipReason, assertKeyFormats, loginAll, as, admin, request, decode,
  USERS, UNIT, LEADER_UNIT, DENIED,
} from './_lib.js';
import { MATRIX } from './matrix.js';

const skip = skipReason();
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
// Un rol de cada tipo (los 4 del diseño) más el anónimo.
const ACTORS_S05 = ['gestora', 'custodio1', 'comite', 'lider1', 'anon'];
const TABLES = Object.keys(MATRIX);
let tokens;
let countsBefore;

// Sondas de inyección sobre la cadena de consulta de PostgREST. Cada una se
// añade a `<tabla>?select=*&`. Lo aceptable es 200 (con filas dentro del
// alcance) o 4xx; nunca 5xx ni una espera inducida.
const UNIT_B = UNIT.beta;
const PROBES = [
  ['comilla clásica', `id=eq.${encodeURIComponent("' OR '1'='1")}`],
  ['comentario SQL', `id=eq.${encodeURIComponent("1'--")}`],
  ['apilada con pg_sleep', `id=eq.${encodeURIComponent("1; select pg_sleep(3)--")}`],
  ['or= tautología', `or=${encodeURIComponent('(id.not.is.null,id.is.null)')}`],
  ['or= hacia otra unidad', `or=${encodeURIComponent(`(unit_id.eq.${UNIT_B},unit_id.neq.${UNIT_B})`)}`],
  ['or= anidado con not', `or=${encodeURIComponent(`(not.and(unit_id.eq.${UNIT_B},unit_id.eq.${UNIT_B})),id.not.is.null`)}`],
  ['in= con ids ajenos', `unit_id=in.${encodeURIComponent(`(${Object.values(UNIT).join(',')})`)}`],
  ['order con SQL', `order=${encodeURIComponent('id.asc;drop table public.units--')}`],
  ['order por expresión', `order=${encodeURIComponent('(select 1)')}`],
  ['select con función', `select=${encodeURIComponent('*,pg_sleep(3)')}`],
  ['select con cast a texto', `select=${encodeURIComponent('id::text,current_user')}`],
  ['select agregado', `select=${encodeURIComponent('count()')}`],
  ['columna inventada', `${encodeURIComponent("id);drop table units;--")}=eq.1`],
  ['operador inventado', `id=sleep.3`],
  ['like con comodines', `id=like.${encodeURIComponent('%')}`],
  ['fts con inyección', `id=fts.${encodeURIComponent("x') or ('1'='1")}`],
  ['limit enorme', 'limit=99999999999999999999'],
  ['offset negativo', 'offset=-1'],
  ['byte NUL', `id=eq.${encodeURIComponent('\u0000')}`],
  ['unicode raro', `id=eq.${encodeURIComponent('‮😀﻿')}`],
  ['valor muy largo', `id=eq.${'A'.repeat(6000)}`],
];

// Filas que el rol puede ver según la matriz de S-03.
function assertScoped(actor, table, rows) {
  assert.ok(Array.isArray(rows), `${actor} ${table}: respuesta no es una lista`);
  const { visible } = MATRIX[table].read(actor);
  const leaked = rows.filter((row) => !visible(row));
  assert.deepEqual(leaked.map((x) => x.id ?? x.user_id ?? x), [], `${actor} ve filas ajenas de ${table}`);
}

async function countAll() {
  const out = {};
  for (const t of TABLES) {
    const r = await admin(`${t}?select=*`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
    out[t] = r.headers.get('content-range');
  }
  return out;
}

describe('pentest-api S-05: inyección, esquemas, GraphQL y Auth', { skip }, () => {
  before(async () => {
    assertKeyFormats();
    tokens = await loginAll();
    countsBefore = await countAll();
  });

  // -------------------------------------------------------------------------
  // 1. Inyección en la cadena de consulta
  // -------------------------------------------------------------------------
  for (const table of TABLES) {
    describe(`inyección · ${table}`, () => {
      for (const actor of ACTORS_S05) {
        test(`${actor}: ${PROBES.length} sondas sin 5xx, sin espera y sin filas ajenas`, async () => {
          const call = as(actor, tokens);
          for (const [label, qs] of PROBES) {
            const t0 = Date.now();
            const r = await call(`${table}?${qs.startsWith('select=') ? '' : 'select=*&'}${qs}`);
            const ms = Date.now() - t0;
            assert.ok(r.status < 500, `${actor} ${table} [${label}] → ${fmt(r)}`);
            assert.ok(ms < 2500, `${actor} ${table} [${label}] tardó ${ms} ms (¿pg_sleep ejecutado?)`);
            if (actor === 'anon') {
              assert.notEqual(r.status, 200, `anon lee ${table} con [${label}]: ${fmt(r)}`);
              continue;
            }
            // Las sondas de select= no devuelven filas completas: basta con que no haya 5xx ni fuga de rol.
            if (r.status === 200 && !qs.startsWith('select=')) assertScoped(actor, table, r.json);
            assert.doesNotMatch(r.text, /"current_user"\s*:\s*"(postgres|supabase_admin|service_role)"/);
          }
        });
      }
    });
  }

  test('ninguna sonda cambió datos (conteos idénticos)', async () => {
    assert.deepEqual(await countAll(), countsBefore);
  });

  // -------------------------------------------------------------------------
  // 2. Esquemas no expuestos
  // -------------------------------------------------------------------------
  describe('esquemas no expuestos (Accept-Profile / Content-Profile)', () => {
    const HIDDEN = [
      ['auth', 'users'], ['auth', 'sessions'], ['auth', 'refresh_tokens'],
      ['private', 'exception_max_days'], ['storage', 'objects'], ['vault', 'secrets'],
      ['extensions', 'pg_stat_statements'], ['pg_catalog', 'pg_authid'],
      ['information_schema', 'tables'], ['graphql_public', 'units'],
    ];
    for (const actor of ACTORS_S05) {
      test(`${actor}: no lee ni escribe auth, private, storage, vault, pg_catalog…`, async () => {
        const call = as(actor, tokens);
        for (const [schema, rel] of HIDDEN) {
          const r = await call(`${rel}?select=*&limit=1`, { headers: { 'Accept-Profile': schema } });
          assert.ok(r.status >= 400 && r.status < 500, `${actor} lee ${schema}.${rel}: ${fmt(r)}`);
          const w = await call(rel, {
            method: 'POST', body: { x: 1 }, headers: { 'Content-Profile': schema },
          });
          assert.ok(w.status >= 400 && w.status < 500, `${actor} escribe ${schema}.${rel}: ${fmt(w)}`);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. Embebidos: el alcance se mantiene en la relación anidada
  // -------------------------------------------------------------------------
  describe('embebidos no saltan el alcance de la unidad', () => {
    const EMBEDS = [
      ['targets', 'units(*)'], ['commitments', 'units(*)'], ['measurements', 'units(*)'],
      ['evaluations', 'units(*)'], ['exceptions', 'units(*)'], ['alerts', 'units(*)'],
      ['units', 'targets(*)'], ['units', 'evaluations(*)'], ['units', 'exceptions(*)'],
      ['units', 'measurements(*)'], ['units', 'alerts(*)'], ['indicators', 'measurements(*)'],
      ['indicators', 'targets(*)'], ['indicators', 'evaluations(*)'],
    ];
    for (const actor of ['lider1', 'lider2', 'custodio1']) {
      test(`${actor}: ${EMBEDS.length} embebidos devuelven solo filas propias`, async () => {
        const call = as(actor, tokens);
        for (const [table, embed] of EMBEDS) {
          const r = await call(`${table}?select=*,${embed}`);
          assert.ok(r.status < 500, `${actor} ${table}+${embed}: ${fmt(r)}`);
          if (r.status !== 200) continue;
          assertScoped(actor, table, r.json);
          const child = embed.split('(')[0];
          for (const row of r.json) {
            const nested = row[child];
            const list = Array.isArray(nested) ? nested : nested ? [nested] : [];
            if (MATRIX[child]) assertScoped(actor, child, list);
          }
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // 4. GraphQL
  // -------------------------------------------------------------------------
  describe('GraphQL (/graphql/v1)', () => {
    const gql = (actor, query) =>
      request('/graphql/v1', {
        method: 'POST',
        token: actor === 'anon' ? undefined : tokens[actor],
        body: { query },
      });

    test('anónimo: la introspección no publica tablas ni mutaciones', async (ctx) => {
      const r = await gql('anon', '{ __schema { queryType { fields { name } } mutationType { fields { name } } } }');
      ctx.diagnostic(`graphql anon: ${r.status} ${r.text.slice(0, 200)}`);
      assert.ok(r.status < 500, fmt(r));
      if (r.status !== 200 || !r.json?.data?.__schema) return; // endpoint cerrado o sin esquema: correcto
      const names = [
        ...(r.json.data.__schema.queryType?.fields ?? []),
        ...(r.json.data.__schema.mutationType?.fields ?? []),
      ].map((f) => f.name);
      const norm = (x) => x.toLowerCase().replace(/_/g, '');
      const exposed = names.filter((n) => TABLES.some((t) => norm(n).includes(norm(t))));
      assert.deepEqual(exposed, [], `GraphQL publica tablas al anónimo: ${exposed.join(', ')}`);
    });

    test('anónimo: no lee unidades ni auditoría por GraphQL', async () => {
      for (const q of ['{ unitsCollection { edges { node { id } } } }', '{ audit_logCollection { edges { node { id } } } }']) {
        const r = await gql('anon', q);
        assert.ok(r.status < 500, fmt(r));
        const edges = r.json?.data && Object.values(r.json.data)[0]?.edges;
        assert.ok(!edges || edges.length === 0, `anon lee por GraphQL: ${fmt(r)}`);
      }
    });

    // Una consulta por colección: si pg_graphql no publica la tabla para el rol,
    // la respuesta trae errors y no hay nada que filtrar.
    const LEADER_GQL = [
      ['unitsCollection', 'id', (n) => n.id === LEADER_UNIT.lider1],
      ['alertsCollection', 'id recipient_user_id', (n) => n.recipient_user_id === USERS.lider1.id],
      ['exceptionsCollection', 'id unit_id', (n) => n.unit_id === LEADER_UNIT.lider1],
      ['evaluationsCollection', 'id unit_id', (n) => n.unit_id === LEADER_UNIT.lider1],
      ['audit_logCollection', 'id', () => false],
    ];
    for (const [coll, fields, ok] of LEADER_GQL) {
      test(`líder: GraphQL ${coll} respeta RLS`, async (ctx) => {
        const r = await gql('lider1', `{ ${coll} { edges { node { ${fields} } } } }`);
        ctx.diagnostic(`graphql lider1 ${coll}: ${r.status} ${r.text.slice(0, 160)}`);
        assert.ok(r.status < 500, fmt(r));
        const edges = r.json?.data?.[coll]?.edges ?? [];
        const leaked = edges.map((e) => e.node).filter((n) => !ok(n));
        assert.deepEqual(leaked, [], `GraphQL ${coll}: filas ajenas para lider1`);
      });
    }

    test('líder: las mutaciones GraphQL no escalan (rol propio, unidad ajena)', async () => {
      const r = await gql('lider1', `mutation {
        updateuser_rolesCollection(set: { role: kpi_manager }, filter: { user_id: { eq: "${USERS.lider1.id}" } }) { affectedCount }
      }`);
      assert.ok(r.status < 500, fmt(r));
      const affected = r.json?.data?.updateuser_rolesCollection?.affectedCount ?? 0;
      assert.equal(affected, 0, `el líder cambió su rol por GraphQL: ${fmt(r)}`);
      const roles = await admin(`user_roles?user_id=eq.${USERS.lider1.id}&select=role`);
      assert.deepEqual(roles.json.map((x) => x.role), ['unit_leader']);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Auth
  // -------------------------------------------------------------------------
  describe('Auth (configuración efectiva)', () => {
    test('/auth/v1/settings: registro cerrado, sin anónimos, sin proveedores externos', async () => {
      const r = await request('/auth/v1/settings');
      assert.equal(r.status, 200, fmt(r));
      assert.equal(r.json.disable_signup, true, 'registro abierto');
      const ext = r.json.external ?? {};
      assert.notEqual(ext.anonymous_users, true, 'inicio de sesión anónimo activado');
      const oauth = Object.entries(ext).filter(([k, v]) => v === true && !['email'].includes(k));
      assert.deepEqual(oauth.map(([k]) => k), [], 'proveedores externos activos sin decisión de diseño');
    });

    test('login: misma respuesta para correo existente con clave errónea y correo inexistente (sin enumeración)', async () => {
      const a = await request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: USERS.lider1.email, password: 'definitivamente-no' },
      });
      const b = await request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: 'no-existe-s05@example.test', password: 'definitivamente-no' },
      });
      if (a.status === 429 || b.status === 429) return; // límite de GoTrue alcanzado: también es un control
      assert.equal(a.status, b.status);
      assert.equal(a.json?.error_code ?? a.json?.error, b.json?.error_code ?? b.json?.error);
      assert.ok(!a.json?.access_token && !b.json?.access_token);
    });

    test('refresh token inventado → rechazado sin sesión', async () => {
      const r = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: 'aaaaaaaaaaaa' },
      });
      assert.ok(r.status >= 400 && r.status < 500, fmt(r));
      assert.ok(!r.json?.access_token);
    });

    test('las sesiones duran como mucho 1 h (jwt_expiry ≤ 3600; mitiga H-S03-01)', () => {
      for (const role of ['gestora', 'custodio1', 'comite', 'lider1']) {
        const { payload } = decode(tokens[role]);
        assert.ok(payload.exp - payload.iat <= 3600, `${role}: sesión de ${payload.exp - payload.iat} s`);
        assert.equal(payload.role, 'authenticated');
      }
    });

    test('la clave publicable no abre /auth/v1/admin ni la lista de usuarios', async () => {
      for (const p of ['/auth/v1/admin/users', '/auth/v1/admin/audit', '/auth/v1/admin/sso/providers']) {
        const r = await request(p);
        assert.ok(DENIED.includes(r.status) || r.status === 404, `${p}: ${fmt(r)}`);
      }
    });
  });
});

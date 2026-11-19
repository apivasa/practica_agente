// S-03 — IDOR, escalada de privilegios, upsert indebido y esquema private
// contra PostgREST real. Categoría 1.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  skipReason, loginAll, as, adminInsert, adminGet, USERS, UNIT, KPI, DENIED,
} from './_lib.js';

const skip = skipReason();
const REPR = { Prefer: 'return=representation' };
const fmt = (r) => `${r.status} ${r.text.slice(0, 200)}`;
const deniedOrEmpty = (r) => DENIED.includes(r.status) || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
let tokens;
let L1; // líder de Alfa
let C1; // custodio de VULN
let C2; // custodio de AVAIL/MTTR/OBS
let CM; // comité
let G; // gestora
let fx; // fixtures

describe('pentest-api: IDOR y escalada', { skip }, () => {
  before(async () => {
    tokens = await loginAll();
    L1 = as('lider1', tokens);
    C1 = as('custodio1', tokens);
    C2 = as('custodio2', tokens);
    CM = as('comite', tokens);
    G = as('gestora', tokens);
    const exp = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const [excA, excB] = await adminInsert('exceptions', [
      { unit_id: UNIT.alfa, reason: 'idor-fixture A', expires_on: exp, approved_by: USERS.comite.id },
      { unit_id: UNIT.beta, reason: 'idor-fixture B', expires_on: exp, approved_by: USERS.comite.id },
    ]);
    const [alA, alB] = await adminInsert('alerts', [
      { unit_id: UNIT.alfa, recipient_user_id: USERS.lider1.id, kind: 'idor-fixture' },
      { unit_id: UNIT.beta, recipient_user_id: USERS.lider2.id, kind: 'idor-fixture' },
    ]);
    const [mBeta] = await adminGet(`measurements?unit_id=eq.${UNIT.beta}&indicator_id=eq.${KPI.avail}&limit=1`);
    const [mAlfaVuln] = await adminGet(`measurements?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&limit=1`);
    const [ownRole] = await adminGet(`user_roles?user_id=eq.${USERS.lider1.id}`);
    const [c1Role] = await adminGet(`user_roles?user_id=eq.${USERS.custodio1.id}`);
    const [comVuln] = await adminGet(`commitments?unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}`);
    fx = { excA, excB, alA, alB, mBeta, mAlfaVuln, ownRole, c1Role, comVuln };
  });

  // -------------------------------------------------------------------------
  // IDOR por filtros: el líder de Alfa pide datos de Beta.
  // -------------------------------------------------------------------------
  describe('IDOR por filtros (líder Alfa → Beta)', () => {
    const tables = ['units', 'measurements', 'commitments', 'targets', 'evaluations', 'exceptions', 'alerts'];
    const col = (t) => (t === 'units' ? 'id' : 'unit_id');
    for (const t of tables) {
      test(`${t}: eq / in / or / not / select de columnas`, async () => {
        const c = col(t);
        const queries = [
          `${t}?${c}=eq.${UNIT.beta}`,
          `${t}?${c}=in.(${UNIT.beta},${UNIT.gamma})`,
          `${t}?or=(${c}.eq.${UNIT.beta},${c}.eq.${UNIT.gamma})`,
          `${t}?or=(${c}.eq.${UNIT.beta},${c}.is.null,${c}.neq.${UNIT.alfa})`,
          `${t}?${c}=neq.${UNIT.alfa}`,
          `${t}?not.${c}.eq.${UNIT.alfa}`,
          `${t}?select=${c}&${c}=not.is.null&${c}=neq.${UNIT.alfa}`,
          `${t}?and=(${c}.neq.${UNIT.alfa})&or=(id.not.is.null)`,
        ];
        for (const q of queries) {
          const r = await L1(q);
          assert.equal(r.status, 200, `${q}: ${fmt(r)}`);
          assert.deepEqual(r.json, [], `fuga con ${q}`);
        }
      });
    }

    test('alerts: in= con ids propios y ajenos devuelve solo la propia', async () => {
      const r = await L1(`alerts?id=in.(${fx.alA.id},${fx.alB.id})`);
      assert.deepEqual(r.json.map((x) => x.id), [fx.alA.id]);
    });

    test('exceptions: pedir el id de la excepción de Beta no devuelve nada', async () => {
      const r = await L1(`exceptions?id=eq.${fx.excB.id}`);
      assert.deepEqual(r.json, []);
    });

    test('HEAD con Prefer count=exact no filtra cuántas filas tiene Beta', async () => {
      for (const t of ['measurements', 'commitments', 'targets', 'exceptions', 'evaluations']) {
        const r = await L1(`${t}?unit_id=eq.${UNIT.beta}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
        assert.ok([200, 206].includes(r.status), `${t}: ${r.status}`);
        assert.match(r.headers.get('content-range') ?? '', /\/0$/, `${t}: ${r.headers.get('content-range')}`);
      }
    });

    test('custodio VULN no ve mediciones de AVAIL ni con or= sobre indicator_id', async () => {
      for (const q of [
        `measurements?indicator_id=eq.${KPI.avail}`,
        `measurements?or=(indicator_id.eq.${KPI.avail},indicator_id.eq.${KPI.mttr})`,
        `measurements?id=eq.${fx.mBeta.id}`,
        `commitments?indicator_id=neq.${KPI.vuln}`,
        `evaluations?indicator_id=is.null`,
      ]) {
        const r = await C1(q);
        assert.equal(r.status, 200, fmt(r));
        assert.deepEqual(r.json, [], `fuga con ${q}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // IDOR por embebidos (select= con recursos relacionados)
  // -------------------------------------------------------------------------
  describe('IDOR por embebidos', () => {
    test('líder: indicators?select=*,measurements(*),commitments(*),targets(*),evaluations(*) solo trae Alfa', async () => {
      const r = await L1('indicators?select=id,measurements(unit_id),commitments(unit_id),targets(unit_id),evaluations(unit_id)');
      assert.equal(r.status, 200, fmt(r));
      assert.ok(r.json.length >= 4);
      for (const ind of r.json) {
        for (const rel of ['measurements', 'commitments', 'targets', 'evaluations']) {
          for (const row of ind[rel]) assert.equal(row.unit_id, UNIT.alfa, `fuga en indicators→${rel}`);
        }
      }
    });

    test('líder: units con embebidos de todas las relaciones', async () => {
      const r = await L1('units?select=id,measurements(unit_id),exceptions(unit_id),alerts(unit_id),user_roles(user_id,unit_id)');
      assert.equal(r.status, 200, fmt(r));
      assert.deepEqual(r.json.map((u) => u.id), [UNIT.alfa]);
      for (const rel of ['measurements', 'exceptions', 'alerts']) {
        for (const row of r.json[0][rel]) assert.equal(row.unit_id, UNIT.alfa);
      }
      for (const row of r.json[0].user_roles) assert.equal(row.user_id, USERS.lider1.id, 've roles de otros usuarios');
    });

    test('líder: measurements?select=*,units!inner(*) con filtro en el embebido hacia Beta', async () => {
      const r = await L1(`measurements?select=id,unit_id,units!inner(id,name)&units.id=eq.${UNIT.beta}`);
      assert.equal(r.status, 200, fmt(r));
      assert.deepEqual(r.json, []);
    });

    test('custodio: indicators?select=*,commitments(*) no trae compromisos de otros KPI', async () => {
      const r = await C2('indicators?select=id,commitments(indicator_id),measurements(indicator_id)');
      assert.equal(r.status, 200, fmt(r));
      for (const ind of r.json) {
        for (const row of ind.commitments) assert.ok([KPI.avail, KPI.mttr, KPI.obs].includes(row.indicator_id));
        for (const row of ind.measurements) assert.ok([KPI.avail, KPI.mttr, KPI.obs].includes(row.indicator_id));
      }
    });

    test('nadie salta a auth.users ni al esquema private vía embebido', async () => {
      for (const q of ['units?select=id,users(*)', 'user_roles?select=id,users(email)', 'units?select=id,leader:leader_user_id(*)']) {
        const r = await L1(q);
        assert.ok(r.status >= 400, `${q}: ${fmt(r)}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Escalada de privilegios
  // -------------------------------------------------------------------------
  describe('escalada', () => {
    test('líder: PATCH a su fila de user_roles (rol, unidad) no aplica', async () => {
      for (const body of [{ role: 'kpi_manager', unit_id: null }, { role: 'committee', unit_id: null }, { unit_id: UNIT.beta }, { user_id: USERS.lider2.id }]) {
        const r = await L1(`user_roles?id=eq.${fx.ownRole.id}`, { method: 'PATCH', body, headers: REPR });
        assert.ok(deniedOrEmpty(r), `${JSON.stringify(body)}: ${fmt(r)}`);
      }
      const [now] = await adminGet(`user_roles?id=eq.${fx.ownRole.id}`);
      assert.deepEqual(now, fx.ownRole);
    });

    test('líder y custodio: POST user_roles para darse gestora o comité', async () => {
      for (const [call, uid] of [[L1, USERS.lider1.id], [C1, USERS.custodio1.id]]) {
        for (const role of ['kpi_manager', 'committee']) {
          const r = await call('user_roles', { method: 'POST', body: { user_id: uid, role }, headers: REPR });
          assert.ok(DENIED.includes(r.status), `${role}: ${fmt(r)}`);
        }
      }
    });

    test('custodio: se reasigna a otro KPI en user_roles', async () => {
      const r = await C1(`user_roles?id=eq.${fx.c1Role.id}`, { method: 'PATCH', body: { indicator_id: KPI.avail }, headers: REPR });
      assert.ok(deniedOrEmpty(r), fmt(r));
    });

    test('líder: se apropia de la unidad Beta vía units.leader_user_id', async () => {
      const r = await L1(`units?id=eq.${UNIT.beta}`, { method: 'PATCH', body: { leader_user_id: USERS.lider1.id }, headers: REPR });
      assert.ok(deniedOrEmpty(r), fmt(r));
    });

    test('custodio: PATCH de columnas inmutables de su medición (created_by, source, unit_id, indicator_id)', async () => {
      for (const body of [
        { created_by: USERS.custodio2.id },
        { source: 'automatic' },
        { unit_id: UNIT.beta },
        { indicator_id: KPI.avail },
        { id: '00000000-0000-4000-8000-000000000000' },
      ]) {
        const r = await C1(`measurements?id=eq.${fx.mAlfaVuln.id}`, { method: 'PATCH', body, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${JSON.stringify(body)}: ${fmt(r)}`);
      }
      const [now] = await adminGet(`measurements?id=eq.${fx.mAlfaVuln.id}`);
      assert.deepEqual(now, fx.mAlfaVuln);
    });

    test('custodio: PATCH de created_by/unit_id/indicator_id de su compromiso', async () => {
      for (const body of [{ created_by: USERS.custodio2.id }, { unit_id: UNIT.beta }, { indicator_id: KPI.avail }]) {
        const r = await C1(`commitments?id=eq.${fx.comVuln.id}`, { method: 'PATCH', body, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${JSON.stringify(body)}: ${fmt(r)}`);
      }
    });

    test('custodio: POST de mediciones falsificadas (otro KPI, otro autor, source automatic)', async () => {
      const base = { unit_id: UNIT.alfa, indicator_id: KPI.vuln, measured_on: '2027-02-02', value: 1, created_by: USERS.custodio1.id };
      for (const body of [
        { ...base, indicator_id: KPI.avail },
        { ...base, created_by: USERS.custodio2.id },
        { ...base, source: 'automatic' },
        [{ ...base }, { ...base, indicator_id: KPI.avail }], // lote mixto: todo o nada
      ]) {
        const r = await C1('measurements', { method: 'POST', body, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${JSON.stringify(body)}: ${fmt(r)}`);
      }
      const leaked = await adminGet('measurements?measured_on=eq.2027-02-02');
      assert.deepEqual(leaked, [], 'quedó una medición del lote rechazado');
    });

    test('líder y gestora: crear o extender una excepción', async () => {
      const body = { unit_id: UNIT.alfa, reason: 'auto', expires_on: '2099-12-31', approved_by: USERS.comite.id };
      for (const call of [L1, G]) {
        const ins = await call('exceptions', { method: 'POST', body, headers: REPR });
        assert.ok(DENIED.includes(ins.status), fmt(ins));
        const upd = await call(`exceptions?id=eq.${fx.excA.id}`, { method: 'PATCH', body: { expires_on: '2099-12-31' }, headers: REPR });
        assert.ok(deniedOrEmpty(upd), fmt(upd));
      }
      const [now] = await adminGet(`exceptions?id=eq.${fx.excA.id}`);
      assert.equal(now.expires_on, fx.excA.expires_on);
    });

    test('comité: no firma a nombre de otro, no mueve de unidad, no crea vencidas', async () => {
      const ins = await CM('exceptions', { method: 'POST', body: { unit_id: UNIT.alfa, reason: 'x', expires_on: '2099-01-01', approved_by: USERS.gestora.id }, headers: REPR });
      assert.ok(DENIED.includes(ins.status), fmt(ins));
      const past = await CM('exceptions', { method: 'POST', body: { unit_id: UNIT.alfa, reason: 'x', expires_on: '2020-01-01', approved_by: USERS.comite.id }, headers: REPR });
      assert.ok(DENIED.includes(past.status), fmt(past));
      const sign = await CM(`exceptions?id=eq.${fx.excA.id}`, { method: 'PATCH', body: { approved_by: USERS.gestora.id }, headers: REPR });
      assert.ok(DENIED.includes(sign.status), fmt(sign));
      const move = await CM(`exceptions?id=eq.${fx.excA.id}`, { method: 'PATCH', body: { unit_id: UNIT.beta }, headers: REPR });
      assert.ok(DENIED.includes(move.status), fmt(move));
    });

    test('nadie escribe evaluaciones (se pinta de verde) ni alertas ni auditoría', async () => {
      for (const actor of ['gestora', 'comite', 'custodio1', 'lider1']) {
        const call = as(actor, tokens);
        const ev = await call(`evaluations?unit_id=eq.${UNIT.alfa}`, { method: 'PATCH', body: { color: 'green' }, headers: REPR });
        assert.ok(DENIED.includes(ev.status), `${actor} evaluations: ${fmt(ev)}`);
        const al = await call('alerts', { method: 'POST', body: { recipient_user_id: USERS.lider2.id, kind: 'fake' }, headers: REPR });
        assert.ok(DENIED.includes(al.status), `${actor} alerts: ${fmt(al)}`);
        const au = await call('audit_log?entity=eq.units', { method: 'DELETE', headers: REPR });
        assert.ok(DENIED.includes(au.status), `${actor} audit_log: ${fmt(au)}`);
      }
    });

    test('alerta: el destinatario solo marca read_at; no cambia payload ni destinatario', async () => {
      for (const body of [{ payload: { x: 1 } }, { recipient_user_id: USERS.lider2.id }, { kind: 'x' }]) {
        const r = await L1(`alerts?id=eq.${fx.alA.id}`, { method: 'PATCH', body, headers: REPR });
        assert.ok(DENIED.includes(r.status), `${JSON.stringify(body)}: ${fmt(r)}`);
      }
      const other = await L1(`alerts?id=eq.${fx.alB.id}`, { method: 'PATCH', body: { read_at: new Date().toISOString() }, headers: REPR });
      assert.ok(deniedOrEmpty(other), fmt(other));
    });
  });

  // -------------------------------------------------------------------------
  // Prefer / on_conflict: upsert indebido
  // -------------------------------------------------------------------------
  describe('upsert (Prefer resolution + on_conflict)', () => {
    const MERGE = { Prefer: 'return=representation,resolution=merge-duplicates' };
    const IGNORE = { Prefer: 'return=representation,resolution=ignore-duplicates' };

    test('custodio AVAIL hace upsert sobre el compromiso VULN de Alfa', async () => {
      const body = { unit_id: UNIT.alfa, indicator_id: KPI.vuln, period: '2027-Q1', package_total: 1, created_by: USERS.custodio2.id };
      const merge = await C2('commitments?on_conflict=unit_id,indicator_id,period', { method: 'POST', body, headers: MERGE });
      assert.ok(DENIED.includes(merge.status), fmt(merge));
      const ignore = await C2('commitments?on_conflict=unit_id,indicator_id,period', { method: 'POST', body, headers: IGNORE });
      assert.ok(deniedOrEmpty(ignore) || (ignore.status === 201 && ignore.json.length === 0), fmt(ignore));
      const [now] = await adminGet(`commitments?id=eq.${fx.comVuln.id}`);
      assert.equal(now.package_total, fx.comVuln.package_total);
    });

    test('custodio VULN roba por id una medición de AVAIL (upsert on_conflict=id)', async () => {
      const body = { ...fx.mBeta, indicator_id: KPI.vuln, created_by: USERS.custodio1.id, value: 0 };
      delete body.created_at;
      const r = await C1('measurements?on_conflict=id', { method: 'POST', body, headers: MERGE });
      assert.ok(DENIED.includes(r.status), fmt(r));
      const [now] = await adminGet(`measurements?id=eq.${fx.mBeta.id}`);
      assert.deepEqual(now, fx.mBeta);
    });

    test('custodio VULN reescribe por upsert una medición propia cambiando columnas inmutables', async () => {
      const body = { ...fx.mAlfaVuln, source: 'automatic', unit_id: UNIT.beta };
      delete body.created_at;
      const r = await C1('measurements?on_conflict=id', { method: 'POST', body, headers: MERGE });
      assert.ok(DENIED.includes(r.status), fmt(r));
    });

    test('líder hace upsert sobre su fila de user_roles para darse gestora', async () => {
      const body = { id: fx.ownRole.id, user_id: USERS.lider1.id, role: 'kpi_manager', unit_id: null };
      const r = await L1('user_roles?on_conflict=id', { method: 'POST', body, headers: MERGE });
      assert.ok(DENIED.includes(r.status), fmt(r));
      const [now] = await adminGet(`user_roles?id=eq.${fx.ownRole.id}`);
      assert.equal(now.role, 'unit_leader');
    });

    test('comité hace upsert sobre la excepción de otro cambiando la unidad', async () => {
      const body = { ...fx.excB, unit_id: UNIT.alfa, approved_by: USERS.comite.id };
      delete body.created_at;
      const r = await CM('exceptions?on_conflict=id', { method: 'POST', body, headers: MERGE });
      assert.ok(DENIED.includes(r.status), fmt(r));
      const [now] = await adminGet(`exceptions?id=eq.${fx.excB.id}`);
      assert.equal(now.unit_id, UNIT.beta);
    });

    test('gestora hace upsert de evaluaciones (on_conflict=unit_id,indicator_id,month)', async () => {
      const r = await G('evaluations?on_conflict=unit_id,indicator_id,month', {
        method: 'POST', body: { unit_id: UNIT.alfa, indicator_id: null, month: '2027-01', color: 'green' }, headers: MERGE,
      });
      assert.ok(DENIED.includes(r.status), fmt(r));
    });

    test('Prefer: tx=commit / missing=default no amplían permisos', async () => {
      const r = await L1('exceptions', {
        method: 'POST', body: { unit_id: UNIT.alfa, reason: 'x', expires_on: '2099-01-01' },
        headers: { Prefer: 'return=representation,tx=commit,missing=default' },
      });
      assert.ok(DENIED.includes(r.status) || r.status === 400, fmt(r));
    });
  });

  // -------------------------------------------------------------------------
  // Esquemas no expuestos
  // -------------------------------------------------------------------------
  describe('esquemas no expuestos', () => {
    for (const profile of ['private', 'auth', 'pg_catalog', 'information_schema', 'extensions', 'storage']) {
      test(`Accept-Profile: ${profile} rechazado para todos`, async () => {
        for (const actor of ['anon', 'lider1', 'gestora']) {
          const call = as(actor, tokens);
          const r = await call('user_roles', { headers: { 'Accept-Profile': profile } });
          assert.ok([401, 403, 404, 406].includes(r.status), `${actor} ${profile}: ${fmt(r)}`);
          assert.ok(!Array.isArray(r.json), `${actor} ${profile} devolvió filas`);
          const w = await call('user_roles', { method: 'POST', body: { user_id: USERS.lider1.id, role: 'kpi_manager' }, headers: { 'Content-Profile': profile } });
          assert.ok([401, 403, 404, 406].includes(w.status), `${actor} ${profile} escritura: ${fmt(w)}`);
        }
      });
    }

    test('las tablas de auth no son accesibles por la API REST', async () => {
      for (const q of ['users', 'auth.users', 'identities', 'sessions', 'refresh_tokens']) {
        const r = await L1(q);
        assert.ok(r.status >= 400, `${q}: ${fmt(r)}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Inyección por filtros (categoría 3)
  // -------------------------------------------------------------------------
  describe('inyección en filtros', () => {
    test('payloads SQL en filtros no amplían resultados', async () => {
      const payloads = [
        `units?name=eq.${encodeURIComponent("x' or '1'='1")}`,
        `units?id=eq.${encodeURIComponent(`${UNIT.alfa}') or ('1'='1`)}`,
        `units?name=like.${encodeURIComponent('%')}`,
        `measurements?unit_id=eq.${encodeURIComponent(`${UNIT.beta};select 1`)}`,
        `units?select=${encodeURIComponent('id,(select count(*) from public.units)')}`,
        `units?order=${encodeURIComponent('id;drop table public.units')}`,
      ];
      for (const q of payloads) {
        const r = await L1(q);
        if (r.status === 200) {
          for (const row of r.json) if ('unit_id' in row) assert.equal(row.unit_id, UNIT.alfa);
          if (q.startsWith('units')) for (const row of r.json) assert.equal(row.id, UNIT.alfa, `fuga con ${q}`);
        } else {
          assert.ok(r.status >= 400 && r.status < 500, `${q}: ${fmt(r)}`);
        }
      }
      const units = await adminGet('units?select=id');
      assert.ok(units.length >= 3, 'la tabla units sigue intacta');
    });
  });
});

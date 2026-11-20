// S-03 — Matriz rol × tabla × operación esperada, según
// docs/adr/0005-modelo-datos-y-rls.md y supabase/migrations/*rls*.sql.
// Toda tabla de `public` debe tener entrada aquí: la prueba de catálogo falla
// si aparece una tabla nueva sin fila en la matriz.
import { USERS, UNIT, KPI, CUSTODIAN_KPIS, LEADER_UNIT, dateInDays } from './_lib.js';

const isLeader = (a) => a in LEADER_UNIT;
const isCustodian = (a) => a in CUSTODIAN_KPIS;
const isBoard = (a) => a === 'gestora' || a === 'comite';
const ownUnit = (a) => LEADER_UNIT[a] ?? UNIT.alfa;
const ownKpi = (a) => CUSTODIAN_KPIS[a]?.[0] ?? KPI.vuln;
const uid = (a) => USERS[a]?.id ?? USERS.lider1.id;
const rand = () => Math.random().toString(36).slice(2, 10);
const futureMonth = () =>
  `${2030 + Math.floor(Math.random() * 60)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;
const futureQuarter = () => `${2030 + Math.floor(Math.random() * 60)}-Q${1 + Math.floor(Math.random() * 4)}`;
const inDays = dateInDays;

/**
 * read(actor) → { visible(row): bool, mustInclude?: (rows) => string|null }
 *   visible: toda fila devuelta debe cumplirlo (si no, fuga/IDOR).
 *   mustInclude: devuelve un mensaje si falta algo que el rol sí debe ver.
 * insert/update/remove: actores autorizados (los demás: denegado).
 */
export const MATRIX = {
  units: {
    read: (a) =>
      isLeader(a)
        ? { visible: (r) => r.id === LEADER_UNIT[a], mustInclude: has('id', [LEADER_UNIT[a]]) }
        : { visible: () => true, mustInclude: has('id', Object.values(UNIT)) },
    insert: ['gestora'],
    insertBody: () => ({ name: `pentest-${rand()}` }),
    update: ['gestora'],
    updateTarget: () => ({ filter: `id=eq.${UNIT.alfa}`, change: { name: `Unidad Alfa ${rand()}` }, restore: ['name'] }),
    remove: ['gestora'],
    tempRow: () => ({ name: `pentest-del-${rand()}` }),
  },
  user_roles: {
    read: (a) =>
      isBoard(a)
        ? { visible: () => true, mustInclude: has('user_id', Object.values(USERS).map((u) => u.id)) }
        : { visible: (r) => r.user_id === USERS[a].id, mustInclude: has('user_id', [USERS[a].id]) },
    insert: ['gestora'],
    insertBody: (a) => ({ user_id: uid(a), role: 'unit_leader', unit_id: UNIT.gamma }),
    update: ['gestora'],
    updateTarget: () => ({ filter: `user_id=eq.${USERS.lider1.id}&role=eq.unit_leader`, change: { unit_id: UNIT.beta }, restore: ['unit_id'] }),
    remove: ['gestora'],
    tempRow: () => ({ user_id: USERS.lider3.id, role: 'unit_leader', unit_id: UNIT.beta }),
  },
  indicators: {
    read: () => ({ visible: () => true, mustInclude: has('id', Object.values(KPI)) }),
    insert: ['gestora'],
    insertBody: () => ({
      code: `PT_${rand()}`, name: 'pentest', measurement_type: 'window_average',
      direction: 'higher_is_better', green_threshold: 2, yellow_threshold: 1,
    }),
    update: ['gestora'],
    updateTarget: () => ({ filter: `id=eq.${KPI.vuln}`, change: { description: `pentest ${rand()}` }, restore: ['description'] }),
    remove: ['gestora'],
    tempRow: () => ({
      code: `PTD_${rand()}`, name: 'pentest-del', measurement_type: 'window_average',
      direction: 'higher_is_better', green_threshold: 2, yellow_threshold: 1,
    }),
  },
  targets: {
    read: (a) =>
      isLeader(a)
        ? { visible: (r) => r.unit_id === LEADER_UNIT[a], mustInclude: has('unit_id', [LEADER_UNIT[a]]) }
        : { visible: () => true, mustInclude: has('unit_id', Object.values(UNIT)) },
    insert: ['gestora'],
    insertBody: (a) => ({ unit_id: ownUnit(a), indicator_id: ownKpi(a), month: futureMonth(), target_value: 1 }),
    update: ['gestora'],
    updateTarget: () => ({
      filter: `unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&month=eq.2027-01`,
      change: { target_value: 1 }, restore: ['target_value'],
    }),
    remove: ['gestora'],
    tempRow: () => ({ unit_id: UNIT.gamma, indicator_id: KPI.mttr, month: futureMonth(), target_value: 1 }),
  },
  commitments: {
    read: (a) => scopedRead(a, { custodianMust: a === 'custodio1' }),
    insert: ['custodio1', 'custodio2'],
    insertBody: (a) => ({
      unit_id: ownUnit(a), indicator_id: ownKpi(a), period: futureQuarter(), package_total: 1, created_by: uid(a),
    }),
    update: ['custodio1'],
    updateTarget: () => ({
      filter: `unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&period=eq.2027-Q1`,
      change: { notes: `pentest ${rand()}` }, restore: ['notes'],
    }),
    remove: [],
  },
  measurements: {
    read: (a) => scopedRead(a, { custodianMust: true }),
    insert: ['custodio1', 'custodio2'],
    // M-08: VULN (cumulative_target con categorías) exige category P0P1/P2P3 y valor
    // entero (trigger measurements_category_guard). La fila del custodio es válida para
    // que una negación sea por RLS y una aceptación no choque con el trigger.
    insertBody: (a) => ({
      unit_id: ownUnit(a), indicator_id: ownKpi(a), measured_on: '2027-02-01', value: 1,
      created_by: uid(a), source: 'manual',
      ...(ownKpi(a) === KPI.vuln ? { category: 'P0P1', kind: 'resolved' } : {}),
    }),
    update: ['custodio1'],
    updateTarget: () => ({
      filter: `unit_id=eq.${UNIT.alfa}&indicator_id=eq.${KPI.vuln}&category=eq.P0P1&measured_on=eq.2027-01-31`,
      change: { value: 451 }, restore: ['value'],
    }),
    remove: [],
  },
  evaluations: {
    // Fixtures: color global de Alfa y Beta y color VULN de Alfa (ver beforeAll).
    read: (a) => {
      if (isBoard(a)) return { visible: () => true, mustInclude: has('unit_id', [UNIT.alfa, UNIT.beta]) };
      if (isCustodian(a)) {
        return {
          visible: (r) => r.indicator_id !== null && CUSTODIAN_KPIS[a].includes(r.indicator_id),
          mustInclude: a === 'custodio1' ? has('indicator_id', [KPI.vuln]) : null,
        };
      }
      return {
        visible: (r) => r.unit_id === LEADER_UNIT[a],
        mustInclude: a === 'lider3' ? null : has('unit_id', [LEADER_UNIT[a]]),
      };
    },
    insert: [],
    insertBody: (a) => ({ unit_id: ownUnit(a), month: '2031-01', color: 'green' }),
    update: [],
    updateTarget: () => ({ filter: `unit_id=eq.${UNIT.alfa}&indicator_id=is.null&month=eq.2027-01`, change: { color: 'green' }, restore: ['color'] }),
    remove: [],
  },
  exceptions: {
    read: (a) => {
      if (isBoard(a)) return { visible: () => true, mustInclude: has('unit_id', [UNIT.alfa, UNIT.beta]) };
      if (isLeader(a)) {
        return { visible: (r) => r.unit_id === LEADER_UNIT[a], mustInclude: a === 'lider3' ? null : has('unit_id', [LEADER_UNIT[a]]) };
      }
      return { visible: () => false };
    },
    insert: ['comite'],
    insertBody: (a) => ({ unit_id: ownUnit(a), scope: 'all', reason: 'pentest', expires_on: inDays(30), approved_by: uid(a) }),
    update: ['comite'],
    updateTarget: (a) => ({
      filter: `unit_id=eq.${UNIT.alfa}&reason=like.pentest-fixture*`,
      change: { reason: `pentest-fixture ${rand()}`, approved_by: uid(a) }, restore: ['reason', 'approved_by'],
    }),
    remove: [],
  },
  alerts: {
    read: (a) =>
      isBoard(a)
        ? { visible: () => true, mustInclude: has('recipient_user_id', [USERS.lider1.id, USERS.lider2.id]) }
        : {
            visible: (r) => r.recipient_user_id === USERS[a].id,
            mustInclude: a === 'lider1' || a === 'lider2' ? has('recipient_user_id', [USERS[a].id]) : null,
          },
    insert: [],
    // C-04: kind válido (alerts_kind_allowed) para que la negación sea por privilegios, no por CHECK.
    insertBody: (a) => ({ recipient_user_id: uid(a), unit_id: ownUnit(a), kind: 'color_change', dedupe_key: `pentest:forged:${a}` }),
    update: ['lider1'],
    updateTarget: () => ({
      filter: `recipient_user_id=eq.${USERS.lider1.id}&dedupe_key=eq.pentest-fixture:alfa`,
      change: { read_at: new Date().toISOString() }, restore: ['read_at'],
    }),
    remove: [],
  },
  audit_log: {
    read: (a) => (isBoard(a) ? { visible: () => true, mustInclude: (rows) => (rows.length ? null : 'auditoría vacía') } : { visible: () => false }),
    insert: [],
    insertBody: () => ({ actor: 'pentest', action: 'forged', entity: 'units' }),
    update: [],
    updateTarget: () => ({ filter: 'entity=eq.units', change: { action: 'forged' }, restore: null }),
    remove: [],
  },
};

function scopedRead(a, { custodianMust }) {
  if (isBoard(a)) return { visible: () => true, mustInclude: has('unit_id', Object.values(UNIT)) };
  if (isCustodian(a)) {
    return {
      visible: (r) => CUSTODIAN_KPIS[a].includes(r.indicator_id),
      mustInclude: custodianMust ? has('indicator_id', CUSTODIAN_KPIS[a]) : null,
    };
  }
  return { visible: (r) => r.unit_id === LEADER_UNIT[a], mustInclude: has('unit_id', [LEADER_UNIT[a]]) };
}

function has(col, values) {
  return (rows) => {
    const seen = new Set(rows.map((r) => r[col]));
    const missing = values.filter((v) => !seen.has(v));
    return missing.length ? `faltan ${col}=${missing.join(',')}` : null;
  };
}

// Funciones que la API puede exponer por /rest/v1/rpc. Hoy ninguna: toda la
// lógica de autorización vive en el esquema `private`, no expuesto.
export const RPC_ALLOWLIST = [];

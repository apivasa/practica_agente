// BD en memoria con el contrato de scripts/lib/run.js (Db). Emula las restricciones que
// importan: unique (unit_id, indicator_id, month) en evaluations y unique dedupe_key en alerts.
import { randomUUID } from 'node:crypto';

/** Como jsonb: las claves de los objetos se guardan ordenadas (no conserva el orden). */
function jsonbLike(v) {
  if (Array.isArray(v)) return v.map(jsonbLike);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, jsonbLike(v[k])]));
  }
  return v;
}

export function createFakeDb(data) {
  const t = {
    units: [],
    indicators: [],
    user_roles: [],
    commitments: [],
    targets: [],
    measurements: [],
    evaluations: [],
    exceptions: [],
    alerts: [],
    audit_log: [],
    ...structuredClone(data),
  };
  let clock = 0;
  const now = () => new Date(Date.UTC(2030, 0, 1) + clock++).toISOString();
  const clone = (x) => structuredClone(x);
  const db = {
    tables: t,
    units: async () => clone(t.units),
    indicators: async () => clone(t.indicators.filter((i) => i.active !== false)),
    userRoles: async () => clone(t.user_roles.filter((r) => r.role === 'unit_leader' || r.role === 'committee')),
    commitments: async (periods) => clone(t.commitments.filter((c) => periods.includes(c.period))),
    targets: async (month) => clone(t.targets.filter((x) => x.month === month)),
    measurements: async ({ indicatorIds, from, to }) =>
      clone(
        t.measurements.filter(
          (m) => indicatorIds.includes(m.indicator_id) && m.measured_on >= from && m.measured_on <= to,
        ),
      ),
    evaluations: async (months) => clone(t.evaluations.filter((e) => months.includes(e.month))),
    exceptions: async ({ expiresFrom }) => clone(t.exceptions.filter((e) => e.expires_on >= expiresFrom)),
    async upsertEvaluations(rows) {
      return rows.map((r) => {
        const i = t.evaluations.findIndex(
          (e) => e.unit_id === r.unit_id && (e.indicator_id ?? null) === (r.indicator_id ?? null) && e.month === r.month,
        );
        if (i >= 0) {
          t.evaluations[i] = { ...t.evaluations[i], ...clone(r) };
          return clone(t.evaluations[i]);
        }
        const row = { id: randomUUID(), ...clone(r) };
        t.evaluations.push(row);
        return clone(row);
      });
    },
    async insertAlerts(rows) {
      const out = [];
      for (const r of rows) {
        if (t.alerts.some((a) => a.dedupe_key === r.dedupe_key)) continue;
        const row = { id: randomUUID(), sent_at: now(), read_at: null, ...clone(r), payload: jsonbLike(r.payload ?? {}) };
        t.alerts.push(row);
        out.push(clone(row));
      }
      return out;
    },
    async insertAudit(rows) {
      for (const r of rows) t.audit_log.push({ id: t.audit_log.length + 1, created_at: now(), ...clone(r), details: jsonbLike(r.details ?? {}) });
    },
    paceSnapshots: async (entityIds, quarter) =>
      clone(
        t.audit_log.filter(
          (a) =>
            a.action === 'pace_snapshot' &&
            a.entity === 'pace' &&
            entityIds.includes(a.entity_id) &&
            a.details?.quarter === quarter,
        ),
      ),
  };
  return db;
}

// Escenario equivalente a supabase/seed.sql (mismos valores, ids cortos).
const U = { alfa: 'u-alfa', beta: 'u-beta', gamma: 'u-gamma' };
const I = { vuln: 'i-vuln', avail: 'i-avail', mttr: 'i-mttr', obs: 'i-obs' };
export const IDS = { U, I, leaders: { alfa: 'p-l1', beta: 'p-l2', gamma: 'p-l3' }, committee: 'p-com' };

const ind = (id, code, measurement_type, direction, window_days, g, y, extra = {}) => ({
  id,
  code,
  measurement_type,
  direction,
  window_days,
  green_threshold: g,
  yellow_threshold: y,
  thresholds_by_category: {},
  frequency: 'monthly',
  min_sample: 0,
  source: 'manual',
  active: true,
  ...extra,
});

const m = (unit_id, indicator_id, measured_on, fields) => ({
  unit_id,
  indicator_id,
  measured_on,
  value: null,
  app_id: null,
  compliant: null,
  category: null,
  kind: null,
  created_at: `${measured_on}T12:00:00Z`,
  ...fields,
});

export function seedScenario() {
  return {
    units: [
      { id: U.alfa, name: 'Unidad Alfa' },
      { id: U.beta, name: 'Unidad Beta' },
      { id: U.gamma, name: 'Unidad Gamma' },
    ],
    indicators: [
      ind(I.vuln, 'VULN', 'cumulative_target', 'higher_is_better', 90, 96, 90, {
        thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
      }),
      ind(I.avail, 'AVAIL', 'window_average', 'higher_is_better', 30, 99.9, 99.5),
      ind(I.mttr, 'MTTR', 'window_average', 'lower_is_better', 30, 4, 8, { min_sample: 3 }),
      ind(I.obs, 'OBS', 'coverage', 'higher_is_better', 30, 90, 75),
    ],
    user_roles: [
      { user_id: 'p-gestora', role: 'kpi_manager', unit_id: null },
      { user_id: IDS.committee, role: 'committee', unit_id: null },
      { user_id: IDS.leaders.alfa, role: 'unit_leader', unit_id: U.alfa },
      { user_id: IDS.leaders.beta, role: 'unit_leader', unit_id: U.beta },
      { user_id: IDS.leaders.gamma, role: 'unit_leader', unit_id: U.gamma },
    ],
    commitments: [
      { unit_id: U.alfa, indicator_id: I.vuln, period: '2027-Q1', package_total: 2000, package_by_category: { P0P1: 1500, P2P3: 500 } },
      { unit_id: U.beta, indicator_id: I.vuln, period: '2027-Q1', package_total: 1500, package_by_category: { P0P1: 1000, P2P3: 500 } },
      { unit_id: U.gamma, indicator_id: I.vuln, period: '2027-Q1', package_total: 900, package_by_category: { P0P1: 600, P2P3: 300 } },
      { unit_id: U.gamma, indicator_id: I.avail, period: '2027-01', green_override: 99.5, yellow_override: 99.0 },
    ],
    targets: [
      ['2027-01', 1 / 3],
      ['2027-02', 2 / 3],
      ['2027-03', 1],
    ].flatMap(([month, share]) =>
      [
        [U.alfa, 2000],
        [U.beta, 1500],
        [U.gamma, 900],
      ].map(([unit_id, total]) => ({ unit_id, indicator_id: I.vuln, month, target_value: Math.round(total * share) })),
    ),
    measurements: [
      m(U.alfa, I.vuln, '2027-01-31', { value: 450, category: 'P0P1', kind: 'resolved' }),
      m(U.alfa, I.vuln, '2027-01-31', { value: 250, category: 'P2P3', kind: 'resolved' }),
      m(U.beta, I.vuln, '2027-01-31', { value: 300, category: 'P0P1', kind: 'resolved' }),
      m(U.gamma, I.vuln, '2027-01-31', { value: 280, category: 'P0P1', kind: 'resolved' }),
      m(U.alfa, I.vuln, '2027-02-09', { value: 400, category: 'P0P1', kind: 'resolved' }),
      m(U.alfa, I.vuln, '2027-02-09', { value: 100, category: 'P2P3', kind: 'resolved' }),
      m(U.alfa, I.vuln, '2027-02-10', { value: 200, category: 'P0P1', kind: 'detected' }),
      m(U.alfa, I.avail, '2027-01-15', { value: 99.95 }),
      m(U.beta, I.avail, '2027-01-15', { value: 99.6 }),
      m(U.gamma, I.avail, '2027-01-15', { value: 99.6 }),
      m(U.alfa, I.mttr, '2027-01-05', { value: 2.5 }),
      m(U.alfa, I.mttr, '2027-01-12', { value: 3.0 }),
      m(U.alfa, I.mttr, '2027-01-20', { value: 5.0 }),
      m(U.beta, I.mttr, '2027-01-08', { value: 9.0 }),
      m(U.alfa, I.obs, '2027-01-31', { app_id: 'app-alfa-01', compliant: true }),
      m(U.alfa, I.obs, '2027-01-31', { app_id: 'app-alfa-02', compliant: true }),
      m(U.beta, I.obs, '2027-01-31', { app_id: 'app-beta-01', compliant: false }),
      m(U.gamma, I.obs, '2027-01-31', { app_id: 'app-gamma-01', compliant: true }),
    ],
    exceptions: [
      { id: 'ex-beta', unit_id: U.beta, scope: 'change_start', expires_on: '2027-02-10' },
      { id: 'ex-gamma', unit_id: U.gamma, scope: 'all', expires_on: '2027-02-05' },
    ],
  };
}

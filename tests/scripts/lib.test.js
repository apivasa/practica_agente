// C-03/C-04: funciones puras de scripts/lib (fechas, armado de entradas, alertas, configuración).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayInGuayaquil,
  addDays,
  addMonths,
  monthEnd,
  quarterBounds,
  parseArgs,
  assertNotFuture,
  allowFutureFromEnv,
} from '../../scripts/lib/dates.js';
import {
  pickCommitment,
  indicatorConfig,
  toEngineMeasurements,
  evaluateIndicatorMonth,
  buildHistory,
  assertHistoryFresh,
  evaluateUnitMonth,
  monthToClose,
  buildPackageInput,
} from '../../scripts/lib/build.js';
import {
  recipientsFor,
  colorChangeAlerts,
  paceAlerts,
  intakeAlerts,
  exceptionAlerts,
  ALERT_KINDS,
} from '../../scripts/lib/alerts.js';
import { readConfig } from '../../scripts/lib/config.js';

describe('dates', () => {
  test('fecha de negocio en America/Guayaquil (UTC-5, sin horario de verano)', () => {
    assert.equal(todayInGuayaquil(new Date('2027-02-01T04:59:59Z')), '2027-01-31');
    assert.equal(todayInGuayaquil(new Date('2027-02-01T05:00:00Z')), '2027-02-01');
    // Cron mensual 11:07 UTC = 06:07 en Guayaquil del mismo día.
    assert.equal(todayInGuayaquil(new Date('2027-03-01T11:07:00Z')), '2027-03-01');
    assert.equal(todayInGuayaquil(new Date('2027-07-15T03:00:00Z')), '2027-07-14');
  });
  test('aritmética de calendario', () => {
    assert.equal(addDays('2027-03-01', -1), '2027-02-28');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addMonths('2027-01', -1), '2026-12');
    assert.equal(addMonths('2026-12', 1), '2027-01');
    assert.equal(monthEnd('2027-02'), '2027-02-28');
    assert.equal(monthEnd('2028-02'), '2028-02-29');
    assert.deepEqual(quarterBounds('2027-05'), {
      quarter: '2027-Q2',
      start: '2027-04-01',
      end: '2027-06-30',
      months: ['2027-04', '2027-05', '2027-06'],
    });
    assert.throws(() => addDays('2027-02-30', 1), TypeError);
    assert.throws(() => addMonths('2027-13', 1), TypeError);
    assert.throws(() => monthEnd('x'), TypeError);
  });
  test('parseArgs', () => {
    const now = new Date('2027-02-01T11:07:00Z');
    assert.deepEqual(parseArgs(['--mode=monthly'], now), { mode: 'monthly', asOf: '2027-02-01', reprocess: false });
    assert.deepEqual(parseArgs(['--mode=daily', '--as-of='], now), { mode: 'daily', asOf: '2027-02-01', reprocess: false });
    assert.deepEqual(parseArgs(['--mode=daily', '--as-of=2027-02-10']), { mode: 'daily', asOf: '2027-02-10', reprocess: false });
    assert.deepEqual(parseArgs(['--reprocess', '--mode=monthly', '--as-of=2027-02-01']), { mode: 'monthly', asOf: '2027-02-01', reprocess: true });
    assert.throws(() => parseArgs(['--mode=daily', '--reprocess']), /solo aplica/);
    assert.throws(() => parseArgs(['--mode=monthly', '--reprocess=true']), /desconocido/);
    assert.throws(() => parseArgs([]), /--mode/);
    assert.throws(() => parseArgs(['--mode=weekly']), /--mode/);
    assert.throws(() => parseArgs(['--mode=daily', '--as-of=2027-02-31']), TypeError);
    assert.throws(() => parseArgs(['--mode=daily', "--as-of=2027-01-01'; drop table x;--"]), TypeError);
    assert.throws(() => parseArgs(['--mode=daily', '--foo']), /desconocido/);
  });
});

const VULN = {
  id: 'v',
  code: 'VULN',
  measurement_type: 'cumulative_target',
  direction: 'higher_is_better',
  window_days: 90,
  green_threshold: 96,
  yellow_threshold: 90,
  thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  frequency: 'monthly',
  min_sample: 0,
  source: 'manual',
};
const AVAIL = { ...VULN, id: 'a', code: 'AVAIL', measurement_type: 'window_average', window_days: 30, green_threshold: 99.9, yellow_threshold: 99.5, thresholds_by_category: {} };

describe('H-C03-01: fechas futuras', () => {
  const now = new Date('2026-11-20T04:00:00Z'); // 2026-11-19 23:00 en Guayaquil
  test('rechaza asOf posterior a hoy en America/Guayaquil', () => {
    assert.doesNotThrow(() => assertNotFuture('2026-11-19', { now }));
    assert.doesNotThrow(() => assertNotFuture('2026-01-01', { now }));
    assert.throws(() => assertNotFuture('2026-11-20', { now }), RangeError);
    assert.throws(() => assertNotFuture('2027-02-10', { now }), /posterior a hoy \(2026-11-19/);
    assert.doesNotThrow(() => assertNotFuture('2027-02-10', { now, allowFuture: true }));
  });
  test('EVALUATE_ALLOW_FUTURE=1 solo contra Supabase local', () => {
    assert.equal(allowFutureFromEnv({}, 'https://x.supabase.co'), false);
    assert.equal(allowFutureFromEnv({ EVALUATE_ALLOW_FUTURE: 'true' }, 'http://127.0.0.1:54321'), false);
    assert.equal(allowFutureFromEnv({ EVALUATE_ALLOW_FUTURE: '1' }, 'http://127.0.0.1:54321'), true);
    assert.equal(allowFutureFromEnv({ EVALUATE_ALLOW_FUTURE: '1' }, 'http://localhost:54321'), true);
    assert.throws(() => allowFutureFromEnv({ EVALUATE_ALLOW_FUTURE: '1' }, 'https://x.supabase.co'), /local/);
  });
});

describe('build', () => {
  test('pickCommitment: mes antes que trimestre', () => {
    const cs = [
      { unit_id: 'u', indicator_id: 'a', period: '2027-Q1', id: 'q' },
      { unit_id: 'u', indicator_id: 'a', period: '2027-02', id: 'm' },
      { unit_id: 'x', indicator_id: 'a', period: '2027-01', id: 'otro' },
    ];
    assert.equal(pickCommitment(cs, 'u', 'a', '2027-02').id, 'm');
    assert.equal(pickCommitment(cs, 'u', 'a', '2027-01').id, 'q');
    assert.equal(pickCommitment(cs, 'u', 'a', '2027-04'), null);
  });
  test('indicatorConfig: override parcial, completo e incoherente', () => {
    assert.equal(indicatorConfig(AVAIL).thresholdSource, 'indicator');
    const full = indicatorConfig(AVAIL, { green_override: '99.5', yellow_override: 99 });
    assert.deepEqual(full.cfg.thresholds, { green: 99.5, yellow: 99 });
    assert.equal(full.thresholdSource, 'commitment');
    // Regla única (engine/effectiveThresholds, H-1 de M-03): un override a medias no se aplica.
    const half = indicatorConfig(AVAIL, { green_override: null, yellow_override: 99 });
    assert.deepEqual(half.cfg.thresholds, { green: 99.9, yellow: 99.5 });
    assert.equal(half.thresholdSource, 'indicator');
    assert.match(half.note, /incompleto/);
    const bad = indicatorConfig(AVAIL, { green_override: 90, yellow_override: 99 });
    assert.equal(bad.thresholdSource, 'indicator');
    assert.match(bad.note, /incoherente/);
  });
  test('toEngineMeasurements ordena por fecha y creación', () => {
    const out = toEngineMeasurements([
      { measured_on: '2027-01-02', created_at: 'b', app_id: 'x', compliant: false },
      { measured_on: '2027-01-02', created_at: 'a', app_id: 'x', compliant: true },
      { measured_on: '2027-01-01', created_at: 'z', value: '3' },
    ]);
    assert.deepEqual(out.map((m) => m.date), ['2027-01-01', '2027-01-02', '2027-01-02']);
    assert.equal(out[0].value, 3);
    assert.equal(out[2].compliant, false, 'la última creada gana en cobertura');
  });
  test('evaluateIndicatorMonth: cumulative solo cuenta resueltas del trimestre', () => {
    const rows = [
      { measured_on: '2026-12-20', value: 1000, kind: 'resolved' },
      { measured_on: '2027-01-10', value: 640, kind: 'resolved' },
      { measured_on: '2027-01-11', value: 500, kind: 'detected', category: 'P0P1' },
      { measured_on: '2027-02-01', value: 500, kind: 'resolved' },
    ];
    // M-06: sin categorías la meta acumulada sigue saliendo de `targets`.
    const PLAIN = { ...VULN, thresholds_by_category: {} };
    const r = evaluateIndicatorMonth({ indicator: PLAIN, measurements: rows, target: { target_value: 667 }, evalMonth: '2027-01' });
    assert.equal(r.color, 'yellow');
    assert.ok(Math.abs(r.value - 95.95) < 0.01);
    const none = evaluateIndicatorMonth({ indicator: PLAIN, measurements: rows, target: null, evalMonth: '2027-01' });
    assert.equal(none.color, 'not_evaluated');
  });
  test('M-06: evaluateIndicatorMonth por criticidad solo cuenta resueltas del trimestre y del mes', () => {
    const rows = [
      { measured_on: '2026-12-20', value: 1000, kind: 'resolved', category: 'P0P1' },
      { measured_on: '2027-01-10', value: 640, kind: 'resolved', category: 'P0P1' },
      { measured_on: '2027-01-10', value: 300, kind: 'resolved', category: 'P2P3' },
      { measured_on: '2027-02-01', value: 500, kind: 'resolved', category: 'P0P1' },
    ];
    const commitment = { period: '2027-Q1', package_by_category: { P0P1: 2000, P2P3: 1000 } };
    // Meta de enero: P0/P1 667, P2/P3 334. 640/667 = 95,95 % < 96 → amarillo, aunque target diga 1.
    const r = evaluateIndicatorMonth({ indicator: VULN, commitment, measurements: rows, target: { target_value: 1 }, evalMonth: '2027-01' });
    assert.equal(r.color, 'yellow');
    assert.ok(Math.abs(r.value - 95.95) < 0.01);
    const none = evaluateIndicatorMonth({ indicator: VULN, commitment: null, measurements: rows, target: { target_value: 1 }, evalMonth: '2027-01' });
    assert.equal(none.color, 'not_evaluated', 'sin paquete no hay color aunque exista target');
  });
  test('buildHistory rellena meses faltantes y descarta otros trimestres', () => {
    assert.deepEqual(buildHistory('2027-03', { '2027-02': 'red', '2026-12': 'red' }, 'yellow'), [
      { month: '2027-01', color: 'not_evaluated' },
      { month: '2027-02', color: 'red' },
      { month: '2027-03', color: 'yellow' },
    ]);
    assert.deepEqual(buildHistory('2027-04', { '2027-03': 'red' }, 'red'), [{ month: '2027-04', color: 'red' }]);
  });
  test('H-C01-02: el historial debe terminar en el mes de asOf o el anterior', () => {
    assert.doesNotThrow(() => assertHistoryFresh([{ month: '2027-01' }], '2027-02-01'));
    assert.doesNotThrow(() => assertHistoryFresh([{ month: '2027-02' }], '2027-02-15'));
    assert.throws(() => assertHistoryFresh([{ month: '2026-03' }], '2026-09-01'), RangeError);
    assert.throws(() => assertHistoryFresh([], '2026-09-01'), RangeError);
    assert.throws(
      () => evaluateUnitMonth({ evalMonth: '2026-03', asOf: '2026-09-01', indicatorColors: ['red'], storedColors: { '2026-02': 'red' }, exceptions: [] }),
      /H-C01-02/,
    );
  });
  test('evaluateUnitMonth aplica excepciones de la unidad', () => {
    const r = evaluateUnitMonth({
      evalMonth: '2027-02',
      asOf: '2027-03-01',
      indicatorColors: ['red', 'green', 'not_evaluated'],
      storedColors: { '2027-01': 'yellow' },
      exceptions: [{ id: 'e1', scope: 'all', expires_on: '2027-03-01' }],
    });
    assert.equal(r.color, 'red');
    assert.equal(r.escalation.level, 'exception');
    assert.deepEqual(r.escalation.suppressedRestrictions, ['freeze_all_change', 'all_capacity_to_run']);
    const q3 = evaluateUnitMonth({ evalMonth: '2027-02', asOf: '2027-03-01', indicatorColors: ['yellow'], storedColors: { '2027-01': 'yellow' }, exceptions: [], yellowLikeRed: true });
    assert.equal(q3.escalation.level, 'frozen');
  });
  test('monthToClose', () => {
    assert.equal(monthToClose('2027-02-01'), '2027-01');
    assert.equal(monthToClose('2027-01-01'), '2026-12');
  });
  test('buildPackageInput', () => {
    const rows = [
      { measured_on: '2026-12-31', value: 9, kind: 'detected', category: 'P0P1' },
      { measured_on: '2027-01-05', value: 10, kind: 'detected', category: 'P0P1' },
      { measured_on: '2027-01-06', value: 7, kind: 'detected', category: 'P2P3' },
      { measured_on: '2027-01-07', value: 5, kind: null, category: 'P2P3' },
      { measured_on: '2027-01-08', value: 4, kind: 'resolved', category: 'P0P1' },
      { measured_on: '2027-01-09', value: 4, kind: 'resolved', category: 'P0P1' },
    ];
    const r = buildPackageInput({ indicator: VULN, commitment: { package_by_category: { P0P1: 100, P2P3: '50' } }, measurements: rows, asOf: '2027-01-08' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.input.initialPackage, { p0p1: 100, p2p3: 50 });
    assert.deepEqual(r.input.newCritical, [{ detectedOn: '2027-01-05', count: 10 }]);
    assert.deepEqual(r.input.resolved, [
      { resolvedOn: '2027-01-07', criticality: 'P2P3', count: 5 },
      { resolvedOn: '2027-01-08', criticality: 'P0P1', count: 4 },
    ]);
    assert.deepEqual(r.input.thresholds, { p0p1: 96, p2p3: 85 });
    assert.equal(r.input.quarterEnd, '2027-03-31');
    assert.equal(buildPackageInput({ indicator: VULN, commitment: { package_total: 5 }, measurements: [], asOf: '2027-01-08' }).ok, false);
    const noTh = buildPackageInput({ indicator: { ...VULN, thresholds_by_category: null }, commitment: { package_by_category: {} }, measurements: [], asOf: '2027-01-08' });
    assert.deepEqual(noTh.input.thresholds, {});
    assert.deepEqual(noTh.input.initialPackage, { p0p1: 0, p2p3: 0 });
  });
});

describe('alerts', () => {
  const roles = [
    { user_id: 'l1', role: 'unit_leader', unit_id: 'u1' },
    { user_id: 'l2', role: 'unit_leader', unit_id: 'u2' },
    { user_id: 'c1', role: 'committee', unit_id: null },
    { user_id: 'c1', role: 'committee', unit_id: null },
    { user_id: 'k', role: 'kpi_manager', unit_id: null },
    { user_id: 'cu', role: 'custodian', unit_id: null },
  ];
  const unit = { id: 'u1', name: 'Unidad 1' };
  test('recipientsFor: líder de la unidad + comité, sin duplicados', () => {
    assert.deepEqual(recipientsFor('u1', roles), ['c1', 'l1']);
    assert.deepEqual(recipientsFor('u3', roles), ['c1']);
  });
  test('colorChangeAlerts', () => {
    const cur = { color: 'red', level: 'restricted', restrictions: ['no_new_change'], reason: 'r' };
    const a = colorChangeAlerts({ unit, evalMonth: '2027-01', current: cur, previous: { color: 'green', level: 'normal' }, recipients: ['c1', 'l1'] });
    assert.equal(a.length, 2);
    assert.equal(new Set(a.map((x) => x.dedupe_key)).size, 2);
    assert.ok(a.every((x) => x.kind === 'color_change' && x.unit_id === 'u1'));
    assert.match(a[0].payload.message, /de verde a rojo/);
    assert.equal(a[0].payload.severity, 'high');
    assert.deepEqual(colorChangeAlerts({ unit, evalMonth: '2027-01', current: cur, previous: { color: 'red', level: 'restricted' }, recipients: ['c1'] }), []);
    assert.deepEqual(colorChangeAlerts({ unit, evalMonth: '2027-01', current: { ...cur, color: 'green', level: 'normal' }, previous: null, recipients: ['c1'] }), []);
    const first = colorChangeAlerts({ unit, evalMonth: '2027-01', current: { ...cur, color: 'yellow' }, previous: null, recipients: ['c1'] });
    assert.equal(first[0].payload.previous_color, 'not_evaluated');
    assert.equal(first[0].payload.severity, 'normal');
    const lvl = colorChangeAlerts({ unit, evalMonth: '2027-02', current: { ...cur, level: 'frozen' }, previous: { color: 'red', level: 'restricted' }, recipients: ['c1'] });
    assert.match(lvl[0].payload.message, /restringida a congelada/);
    assert.notEqual(lvl[0].dedupe_key, first[0].dedupe_key);
  });
  test('paceAlerts: solo en la transición a atrasada', () => {
    const pace = { behindAny: true, gap: 3, expected: 10, resolved: 7, byCriticality: {}, reason: 'Atraso' };
    const base = { unit, indicator: { id: 'v', code: 'VULN' }, asOf: '2027-02-10', quarter: '2027-Q1', pace, recipients: ['c1'] };
    assert.equal(paceAlerts({ ...base, previousBehind: null }).length, 1);
    assert.equal(paceAlerts({ ...base, previousBehind: false }).length, 1);
    assert.equal(paceAlerts({ ...base, previousBehind: true }).length, 0);
    assert.equal(paceAlerts({ ...base, pace: { ...pace, behindAny: false }, previousBehind: false }).length, 0);
  });
  test('intakeAlerts: solo si la meta sube; clave por nuevo total', () => {
    const base = { unit, indicator: { id: 'v', code: 'VULN' }, asOf: '2027-02-10', quarter: '2027-Q1', recipients: ['c1'] };
    const recalc = { targetChanged: true, delta: 200, previousTotal: 2000, newTotal: 2200, previousPace: 1, newPace: 2, reason: 'Ingresaron 200' };
    const a = intakeAlerts({ ...base, recalc });
    assert.equal(a[0].dedupe_key, 'critical_intake:u1:v:2027-Q1:2200:c1');
    assert.deepEqual(intakeAlerts({ ...base, recalc: { ...recalc, targetChanged: false, delta: 0 } }), []);
    assert.deepEqual(intakeAlerts({ ...base, recalc: { ...recalc, delta: -5 } }), []);
  });
  test('exceptionAlerts: vence hoy y vencida, claves distintas', () => {
    const exceptions = [
      { id: 'e1', unit_id: 'u1', scope: 'all', expires_on: '2027-02-10' },
      { id: 'e2', unit_id: 'u2', scope: 'change_start', expires_on: '2027-02-05' },
      { id: 'e3', unit_id: 'u1', scope: 'all', expires_on: '2027-02-11' },
    ];
    const units = new Map([['u1', unit]]);
    const a = exceptionAlerts({ exceptions, asOf: '2027-02-10', units, recipientsByUnit: (u) => recipientsFor(u, roles) });
    assert.deepEqual(a.map((x) => x.dedupe_key), [
      'exception_expired:e1:expires_today:c1',
      'exception_expired:e1:expires_today:l1',
      'exception_expired:e2:expired:c1',
      'exception_expired:e2:expired:l2',
    ]);
    assert.match(a[0].payload.message, /vence hoy/);
    assert.match(a[2].payload.message, /^u2: .*venció/);
  });
  test('tipos de alerta alineados con la migración', () => {
    assert.deepEqual([...ALERT_KINDS], ['color_change', 'pace_behind', 'critical_intake', 'exception_expired']);
  });
});

describe('config', () => {
  const key = ['sb', 'secret', 'x'.repeat(20)].join('_');
  test('exige ambas variables sin revelar valores', () => {
    assert.throws(() => readConfig({}), /SUPABASE_URL, SUPABASE_SECRET_KEY/);
    assert.throws(() => readConfig({ SUPABASE_URL: 'https://x.supabase.co' }), /SUPABASE_SECRET_KEY/);
    try {
      readConfig({ SUPABASE_URL: 'notaurl', SUPABASE_SECRET_KEY: key });
      assert.fail('debía lanzar');
    } catch (e) {
      assert.doesNotMatch(String(e.message), /xxxx/);
    }
  });
  test('https obligatorio salvo local; solo claves sb_secret_', () => {
    assert.deepEqual(readConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: key }), { url: 'https://x.supabase.co', secretKey: key });
    assert.ok(readConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: key }));
    assert.throws(() => readConfig({ SUPABASE_URL: 'http://x.supabase.co', SUPABASE_SECRET_KEY: key }), /https/);
    assert.throws(() => readConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'eyJabc.def.ghi' }), /sb_secret_/);
  });
});

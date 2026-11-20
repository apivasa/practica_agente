// C-03/C-04: evaluación mensual y diaria contra una BD en memoria con el escenario de la semilla.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runMonthly,
  runDaily,
  latestSnapshot,
  stableStringify,
  measurementsFrom,
  MonthClosedError,
  ACTOR,
} from '../../scripts/lib/run.js';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';

const { U, I } = IDS;
const unitRow = (db, unit, month) =>
  db.tables.evaluations.find((e) => e.unit_id === unit && e.indicator_id === null && e.month === month);
const indRow = (db, unit, ind, month) =>
  db.tables.evaluations.find((e) => e.unit_id === unit && e.indicator_id === ind && e.month === month);
const countBy = (rows, f) => rows.reduce((acc, r) => ({ ...acc, [f(r)]: (acc[f(r)] ?? 0) + 1 }), {});

describe('runMonthly (cierre de enero, asOf 2027-02-01)', () => {
  test('colores por indicador, color global y candados', async () => {
    const db = createFakeDb(seedScenario());
    const r = await runMonthly(db, { asOf: '2027-02-01' });
    assert.equal(r.month, '2027-01');
    assert.deepEqual(r.errors, []);
    assert.equal(db.tables.evaluations.length, 15);

    assert.equal(indRow(db, U.alfa, I.vuln, '2027-01').color, 'green'); // M-06: P0/P1 500/500, P2/P3 250/167
    assert.equal(indRow(db, U.alfa, I.mttr, '2027-01').color, 'green'); // 3.5 h, 3 muestras
    assert.equal(indRow(db, U.beta, I.vuln, '2027-01').color, 'red'); // M-06: P0/P1 300/334 = 89,8 %
    assert.equal(indRow(db, U.beta, I.avail, '2027-01').color, 'yellow');
    assert.equal(indRow(db, U.beta, I.mttr, '2027-01').color, 'not_evaluated'); // muestra 1 < 3
    assert.equal(indRow(db, U.gamma, I.vuln, '2027-01').color, 'yellow'); // M-06: P2/P3 80/100 = 80 % (P0/P1 280/200 verde)
    const gAvail = indRow(db, U.gamma, I.avail, '2027-01');
    assert.equal(gAvail.color, 'green', 'umbral del compromiso 99,5 en lugar de 99,9');
    assert.match(gAvail.reason, /compromiso/);

    const alfa = unitRow(db, U.alfa, '2027-01');
    assert.deepEqual([alfa.color, alfa.escalation_level, alfa.restrictions], ['green', 'normal', []]);
    const beta = unitRow(db, U.beta, '2027-01');
    assert.equal(beta.color, 'red');
    assert.equal(beta.escalation_level, 'restricted');
    assert.deepEqual(beta.restrictions, ['no_backlog_additions', 'prioritize_run'], 'change_start vigente');
    const gamma = unitRow(db, U.gamma, '2027-01');
    assert.deepEqual([gamma.color, gamma.escalation_level, gamma.restrictions], ['yellow', 'exception', []]);
  });

  test('alertas de cambio de color: líder + comité, sin alerta para verde inicial', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-02-01' });
    const alerts = db.tables.alerts;
    assert.equal(alerts.length, 4);
    assert.ok(alerts.every((a) => a.kind === 'color_change'));
    assert.deepEqual(
      alerts.map((a) => `${a.unit_id}>${a.recipient_user_id}`).sort(),
      [`${U.beta}>${IDS.committee}`, `${U.beta}>${IDS.leaders.beta}`, `${U.gamma}>${IDS.committee}`, `${U.gamma}>${IDS.leaders.gamma}`].sort(),
    );
    const audit = db.tables.audit_log;
    assert.ok(audit.every((a) => a.actor === ACTOR));
    assert.equal(audit.filter((a) => a.action === 'alert_sent').length, 4);
    assert.equal(audit.filter((a) => a.action === 'escalation_applied').length, 3);
    assert.equal(audit.filter((a) => a.action === 'evaluation_upsert').length, 12);
  });

  test('idempotente: correr dos veces no duplica evaluaciones, alertas ni auditoría', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-02-01' });
    const snap = { ev: db.tables.evaluations.length, al: db.tables.alerts.length, au: db.tables.audit_log.length };
    const r2 = await runMonthly(db, { asOf: '2027-02-01' });
    assert.equal(r2.written, 0);
    assert.equal(r2.alerts, 0);
    assert.deepEqual({ ev: db.tables.evaluations.length, al: db.tables.alerts.length, au: db.tables.audit_log.length }, snap);
  });

  test('mes 2 (cierre de febrero): rojo dos meses congela; cambio de nivel alerta', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-02-01' });
    await runMonthly(db, { asOf: '2027-03-01' });
    const beta = unitRow(db, U.beta, '2027-02');
    assert.deepEqual([beta.color, beta.escalation_level], ['red', 'frozen']);
    assert.deepEqual(beta.restrictions, ['freeze_all_change', 'all_capacity_to_run']);
    const gamma = unitRow(db, U.gamma, '2027-02');
    assert.deepEqual([gamma.color, gamma.escalation_level], ['red', 'frozen'], 'excepción "all" vencida el 02-05');
    const alfa = unitRow(db, U.alfa, '2027-02');
    assert.deepEqual([alfa.color, alfa.escalation_level], ['yellow', 'restricted']); // M-06: VULN P0/P1 1050/1134 = 92,6 %
    const feb = db.tables.alerts.filter((a) => a.payload.month === '2027-02');
    assert.equal(feb.length, 6);
    const betaFeb = feb.find((a) => a.unit_id === U.beta);
    assert.equal(betaFeb.payload.previous_level, 'restricted');
    assert.equal(betaFeb.payload.level, 'frozen');
    assert.equal(betaFeb.payload.severity, 'high');
  });

  test('un trimestre nuevo reinicia la racha (historial solo del trimestre)', async () => {
    const data = seedScenario();
    data.evaluations = [
      { id: 'old', unit_id: U.beta, indicator_id: null, month: '2026-12', color: 'red', value: null, sample_size: 1, reason: 'x', escalation_level: 'frozen', restrictions: [] },
    ];
    const db = createFakeDb(data);
    await runMonthly(db, { asOf: '2027-02-01' });
    assert.equal(unitRow(db, U.beta, '2027-01').escalation_level, 'restricted');
    // Rojo en dic y en ene, mismo nivel? No: frozen -> restricted cambia el nivel; el color no.
    const a = db.tables.alerts.find((x) => x.unit_id === U.beta);
    assert.equal(a.payload.previous_color, 'red');
  });

  test('un mes intermedio sin evaluación cuenta como sin evaluar (no rompe el historial)', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-03-01' }); // sin cierre de enero
    assert.equal(unitRow(db, U.beta, '2027-02').escalation_level, 'restricted', 'racha de 1 mes');
  });

  test('error en una unidad no detiene a las demás y se informa', async () => {
    const data = seedScenario();
    data.indicators[1].green_threshold = 'x'; // AVAIL inválido: el motor lanza
    const db = createFakeDb(data);
    const r = await runMonthly(db, { asOf: '2027-02-01' });
    // Gamma tiene umbral de compromiso para AVAIL y sí se evalúa; Alfa y Beta fallan.
    assert.equal(r.errors.length, 2);
    assert.match(r.errors.join('\n'), /Unidad Alfa[\s\S]*Unidad Beta/);
    assert.deepEqual([...new Set(db.tables.evaluations.map((e) => e.unit_id))], [U.gamma]);
  });
});

describe('runDaily (2027-02-10)', () => {
  test('atraso, ingreso de P0/P1 y vencimiento de excepciones', async () => {
    const db = createFakeDb(seedScenario());
    const r = await runDaily(db, { asOf: '2027-02-10' });
    assert.deepEqual(r.errors, []);
    const kinds = countBy(db.tables.alerts, (a) => `${a.kind}:${a.unit_id}`);
    assert.deepEqual(kinds, {
      [`critical_intake:${U.alfa}`]: 2,
      [`pace_behind:${U.beta}`]: 2,
      [`pace_behind:${U.gamma}`]: 2,
      [`exception_expired:${U.beta}`]: 2,
      [`exception_expired:${U.gamma}`]: 2,
    });
    const intake = db.tables.alerts.find((a) => a.kind === 'critical_intake');
    assert.equal(intake.payload.new_total, 2200);
    assert.equal(intake.payload.delta, 200);
    const states = db.tables.alerts.filter((a) => a.kind === 'exception_expired').map((a) => a.payload.state);
    assert.deepEqual(countBy(states, (s) => s), { expires_today: 2, expired: 2 });
    const audit = db.tables.audit_log;
    assert.equal(audit.filter((a) => a.action === 'pace_snapshot').length, 3);
    assert.equal(audit.filter((a) => a.action === 'alert_sent').length, 10);
    assert.deepEqual(
      audit.filter((a) => a.action === 'exception_expired').map((a) => a.entity_id),
      ['ex-gamma'],
    );
  });

  test('idempotente el mismo día', async () => {
    const db = createFakeDb(seedScenario());
    await runDaily(db, { asOf: '2027-02-10' });
    const n = { al: db.tables.alerts.length, au: db.tables.audit_log.length };
    const r2 = await runDaily(db, { asOf: '2027-02-10' });
    assert.equal(r2.alerts, 0);
    assert.equal(r2.snapshots, 0);
    assert.deepEqual({ al: db.tables.alerts.length, au: db.tables.audit_log.length }, n);
  });

  test('al día siguiente: no repite atraso ni ingreso; un ingreso nuevo sí alerta', async () => {
    const db = createFakeDb(seedScenario());
    await runDaily(db, { asOf: '2027-02-10' });
    const before = db.tables.alerts.length;
    await runDaily(db, { asOf: '2027-02-11' });
    const day2 = db.tables.alerts.slice(before);
    assert.deepEqual(
      day2.map((a) => a.kind),
      ['exception_expired', 'exception_expired'],
      'solo la excepción de Beta, que venció ayer',
    );
    db.tables.measurements.push({
      unit_id: U.beta, indicator_id: I.vuln, measured_on: '2027-02-12', value: 50, category: 'P0P1', kind: 'detected', created_at: 'z',
    });
    const before3 = db.tables.alerts.length;
    await runDaily(db, { asOf: '2027-02-12' });
    const day3 = db.tables.alerts.slice(before3);
    assert.deepEqual(day3.map((a) => `${a.kind}:${a.unit_id}`), [`critical_intake:${U.beta}`, `critical_intake:${U.beta}`]);
    assert.equal(day3[0].payload.previous_total, 1500);
    assert.equal(day3[0].payload.new_total, 1550);
  });

  test('P0/P1 detectadas en el mes 3 no recalculan la meta', async () => {
    const data = seedScenario();
    data.measurements = data.measurements.filter((x) => x.kind !== 'detected');
    data.measurements.push({
      unit_id: U.alfa, indicator_id: I.vuln, measured_on: '2027-03-02', value: 30, category: 'P0P1', kind: 'detected', created_at: 'z',
    });
    data.exceptions = [];
    const db = createFakeDb(data);
    await runDaily(db, { asOf: '2027-03-03' });
    assert.equal(db.tables.alerts.filter((a) => a.kind === 'critical_intake').length, 0);
  });

  test('fechas fuera del trimestre o posteriores a asOf se filtran antes del motor', async () => {
    const data = seedScenario();
    data.measurements.push(
      { unit_id: U.alfa, indicator_id: I.vuln, measured_on: '2026-12-30', value: 999, category: 'P0P1', kind: 'detected', created_at: 'z' },
      { unit_id: U.alfa, indicator_id: I.vuln, measured_on: '2027-02-20', value: 999, category: 'P0P1', kind: 'detected', created_at: 'z' },
    );
    const db = createFakeDb(data);
    const r = await runDaily(db, { asOf: '2027-02-10' });
    assert.deepEqual(r.errors, []);
    assert.equal(db.tables.alerts.find((a) => a.kind === 'critical_intake').payload.new_total, 2200);
  });

  test('sin package_by_category la unidad se omite sin error', async () => {
    const data = seedScenario();
    data.commitments = data.commitments.map((c) => ({ ...c, package_by_category: null }));
    data.exceptions = [];
    const db = createFakeDb(data);
    const logs = [];
    const r = await runDaily(db, { asOf: '2027-02-10', log: (x) => logs.push(x) });
    assert.deepEqual(r.errors, []);
    assert.equal(db.tables.alerts.length, 0);
    assert.ok(logs.some((l) => /package_by_category/.test(l)));
  });

  test('datos inválidos de una unidad se reportan como error', async () => {
    const data = seedScenario();
    data.measurements.push({
      unit_id: U.beta, indicator_id: I.vuln, measured_on: '2027-02-01', value: 1.5, category: 'P0P1', kind: 'resolved', created_at: 'z',
    });
    const db = createFakeDb(data);
    const r = await runDaily(db, { asOf: '2027-02-10' });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /Unidad Beta/);
  });
});

describe('latestSnapshot', () => {
  const s = (entity_id, as_of, quarter, created_at) => ({ entity_id, created_at, details: { as_of, quarter } });
  test('elige el último anterior a asOf del mismo trimestre', () => {
    const rows = [
      s('e', '2027-02-08', '2027-Q1', '1'),
      s('e', '2027-02-09', '2027-Q1', '2'),
      s('e', '2027-02-09', '2027-Q1', '3'),
      s('e', '2027-02-10', '2027-Q1', '4'),
      s('e', '2026-12-31', '2026-Q4', '5'),
      s('x', '2027-02-09', '2027-Q1', '6'),
    ];
    assert.equal(latestSnapshot(rows, 'e', '2027-Q1', '2027-02-10').created_at, '3');
    assert.equal(latestSnapshot(rows, 'e', '2027-Q1', '2027-02-08'), null);
    assert.equal(latestSnapshot([{ entity_id: 'e' }], 'e', '2027-Q1', '2027-02-08'), null);
  });
});

test('stableStringify ignora el orden de claves (jsonb lo reordena)', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 2, c: null }] }), stableStringify({ a: [{ c: null, d: 2 }], b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
  assert.equal(stableStringify('x'), '"x"');
});

describe('carga de mediciones: trimestres de 92 días', () => {
  test('measurementsFrom cubre el inicio del trimestre y la ventana más larga', () => {
    assert.equal(measurementsFrom('2027-09', 90), '2027-07-01');
    assert.equal(measurementsFrom('2027-12', 90), '2027-10-01');
    assert.equal(measurementsFrom('2027-03', 90), '2026-12-31'); // ventana antes que el trimestre
    assert.equal(measurementsFrom('2027-02', 30), '2027-01-01');
    assert.equal(measurementsFrom('2027-01', 120), '2026-10-03');
  });

  for (const [first, close, asOf] of [
    ['2027-07-01', '2027-09', '2027-10-01'],
    ['2027-10-01', '2027-12', '2028-01-01'],
  ]) {
    test(`lo resuelto el ${first} cuenta en el cierre de ${close}`, async () => {
      const q = first.slice(0, 4) + '-Q' + (first.slice(5, 7) === '07' ? '3' : '4');
      const data = seedScenario();
      data.indicators = data.indicators.filter((i) => i.id === I.vuln);
      data.exceptions = [];
      // M-06: VULN usa el paquete del compromiso trimestral (P0/P1 100, P2/P3 0 → meta 0).
      data.commitments = [{ unit_id: U.alfa, indicator_id: I.vuln, period: q, package_by_category: { P0P1: 100, P2P3: 0 } }];
      data.targets = [];
      data.measurements = [
        { unit_id: U.alfa, indicator_id: I.vuln, measured_on: first, value: 60, category: 'P0P1', kind: 'resolved', created_at: 'a' },
        { unit_id: U.alfa, indicator_id: I.vuln, measured_on: `${close}-15`, value: 40, category: 'P0P1', kind: 'resolved', created_at: 'b' },
      ];
      const db = createFakeDb(data);
      await runMonthly(db, { asOf });
      const row = indRow(db, U.alfa, I.vuln, close);
      assert.equal(row.value, 100, `${q}: 60 + 40 resueltas sobre meta 100 (cierre 3/3)`);
      assert.equal(row.color, 'green');
    });
  }
});

describe('H-C03-01: re-cierre de un mes ya evaluado', () => {
  test('con guardReclose, sin --reprocess se rechaza sin escribir', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-02-01', guardReclose: true });
    const n = { ev: db.tables.evaluations.length, al: db.tables.alerts.length, au: db.tables.audit_log.length };
    await assert.rejects(runMonthly(db, { asOf: '2027-02-01', guardReclose: true }), MonthClosedError);
    assert.deepEqual({ ev: db.tables.evaluations.length, al: db.tables.alerts.length, au: db.tables.audit_log.length }, n);
  });
  test('con --reprocess vuelve a evaluar y queda auditado como evaluation_reprocess', async () => {
    const db = createFakeDb(seedScenario());
    const first = await runMonthly(db, { asOf: '2027-02-01', guardReclose: true, reprocess: true });
    assert.equal(first.reprocessed, false, 'el primer cierre no es reproceso');
    assert.equal(db.tables.audit_log.filter((a) => a.action === 'evaluation_reprocess').length, 0);
    // Dato tardío: Beta resuelve lo pendiente de enero.
    db.tables.measurements.push({
      unit_id: U.beta, indicator_id: I.vuln, measured_on: '2027-01-31', value: 200, category: 'P2P3', kind: 'resolved', created_at: 'z',
    });
    const r = await runMonthly(db, { asOf: '2027-02-01', guardReclose: true, reprocess: true });
    assert.equal(r.reprocessed, true);
    assert.equal(r.written, 1, 'solo cambia el VULN de Beta (el global sigue rojo por OBS)');
    const audit = db.tables.audit_log.filter((a) => a.action === 'evaluation_reprocess');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor, ACTOR);
    assert.equal(audit[0].entity_id, '2027-01');
    assert.equal(audit[0].details.written, 1);
  });
});

// QA C-03/C-04: huecos frente al criterio de aceptación y a docs/diseno.md (Alertas,
// Reglas de escalada). Cada caso cita la frase que prueba.
//   C-03: "idempotente (correr dos veces no duplica)".
//   C-04: "Cada disparador genera exactamente una alerta por destinatario; agrupación sin duplicados".
//   Diseño, Alertas: "Destinatarios: líder de unidad y comité de delivery".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runMonthly, runDaily } from '../../scripts/lib/run.js';
import { ALERT_KINDS } from '../../scripts/lib/alerts.js';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';

const { U, I } = IDS;
const snapshot = (db) => ({
  ev: db.tables.evaluations.length,
  al: db.tables.alerts.length,
  au: db.tables.audit_log.length,
});
/** Exactamente una alerta por (disparador, destinatario): sin dos filas con la misma clave lógica. */
function assertOnePerTriggerAndRecipient(alerts) {
  const logical = alerts.map((a) =>
    [a.kind, a.unit_id, a.recipient_user_id, a.payload.month, a.payload.as_of, a.payload.exception_id, a.payload.state, a.payload.new_total].join('|'),
  );
  assert.equal(new Set(logical).size, logical.length, 'alerta duplicada para el mismo disparador y destinatario');
  assert.equal(new Set(alerts.map((a) => a.dedupe_key)).size, alerts.length, 'dedupe_key repetida');
  assert.ok(alerts.every((a) => ALERT_KINDS.includes(a.kind)), 'tipo de alerta fuera de los disparadores del diseño');
}
const recipientsOf = (alerts, unit, kind) =>
  alerts.filter((a) => a.unit_id === unit && a.kind === kind).map((a) => a.recipient_user_id).sort();

describe('QA destinatarios (diseño: líder de unidad y comité)', () => {
  test('líder sin fila en user_roles: la alerta llega al comité, sin error ni destinatario huérfano', async () => {
    const data = seedScenario();
    data.user_roles = data.user_roles.filter((r) => r.user_id !== IDS.leaders.beta);
    const db = createFakeDb(data);
    const r = await runMonthly(db, { asOf: '2027-02-01' });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(recipientsOf(db.tables.alerts, U.beta, 'color_change'), [IDS.committee]);
    assert.deepEqual(recipientsOf(db.tables.alerts, U.gamma, 'color_change'), [IDS.committee, IDS.leaders.gamma].sort());
  });

  test(
    'líder registrado solo en units.leader_user_id también recibe la alerta (ADR 0005: la columna sirve para elegir destinatarios)',
    { todo: 'H-C04-QA-01: recipientsFor solo lee user_roles; db.units no selecciona leader_user_id' },
    async () => {
      const data = seedScenario();
      data.user_roles = data.user_roles.filter((r) => r.user_id !== IDS.leaders.beta);
      data.units = data.units.map((u) => (u.id === U.beta ? { ...u, leader_user_id: IDS.leaders.beta } : u));
      const db = createFakeDb(data);
      await runMonthly(db, { asOf: '2027-02-01' });
      assert.deepEqual(recipientsOf(db.tables.alerts, U.beta, 'color_change'), [IDS.committee, IDS.leaders.beta].sort());
    },
  );

  test('varios miembros del comité: una alerta por cada uno; quien es líder y comité recibe una sola', async () => {
    const data = seedScenario();
    data.user_roles.push(
      { user_id: 'p-com2', role: 'committee', unit_id: null },
      { user_id: IDS.leaders.gamma, role: 'committee', unit_id: null },
    );
    const db = createFakeDb(data);
    await runMonthly(db, { asOf: '2027-02-01' });
    await runDaily(db, { asOf: '2027-02-10' });
    const alerts = db.tables.alerts;
    assertOnePerTriggerAndRecipient(alerts);
    assert.deepEqual(
      recipientsOf(alerts, U.beta, 'color_change'),
      [IDS.committee, 'p-com2', IDS.leaders.beta, IDS.leaders.gamma].sort(),
      'el líder de Gamma, como comité, ve también Beta',
    );
    assert.deepEqual(recipientsOf(alerts, U.gamma, 'color_change'), [IDS.committee, 'p-com2', IDS.leaders.gamma].sort());
  });

  test('nadie fuera de líder de la unidad y comité recibe alertas (gestora, custodio, líder de otra unidad)', async () => {
    const data = seedScenario();
    data.user_roles.push({ user_id: 'p-cust', role: 'custodian', unit_id: null });
    const db = createFakeDb(data);
    await runMonthly(db, { asOf: '2027-02-01' });
    await runDaily(db, { asOf: '2027-02-10' });
    await runMonthly(db, { asOf: '2027-03-01' });
    const leaderOf = { [U.alfa]: IDS.leaders.alfa, [U.beta]: IDS.leaders.beta, [U.gamma]: IDS.leaders.gamma };
    for (const a of db.tables.alerts) {
      assert.ok(
        a.recipient_user_id === IDS.committee || a.recipient_user_id === leaderOf[a.unit_id],
        `${a.kind} de ${a.unit_id} enviada a ${a.recipient_user_id}`,
      );
    }
  });

  test('unidad sin ningún destinatario (sin líder y sin comité): no falla ni inserta alertas', async () => {
    const data = seedScenario();
    data.user_roles = data.user_roles.filter((r) => r.role !== 'committee' && r.role !== 'unit_leader');
    const db = createFakeDb(data);
    const m = await runMonthly(db, { asOf: '2027-02-01' });
    const d = await runDaily(db, { asOf: '2027-02-10' });
    assert.deepEqual([...m.errors, ...d.errors], []);
    assert.equal(db.tables.alerts.length, 0);
    assert.equal(db.tables.audit_log.filter((a) => a.action === 'alert_sent').length, 0);
  });
});

describe('QA unidad sin indicadores', () => {
  test('sin indicadores activos: unidad sin evaluar, operación normal, sin alertas e idempotente', async () => {
    const data = seedScenario();
    data.indicators = data.indicators.map((i) => ({ ...i, active: false }));
    const db = createFakeDb(data);
    const r = await runMonthly(db, { asOf: '2027-02-01' });
    assert.deepEqual(r.errors, []);
    assert.equal(db.tables.evaluations.length, 3, 'solo la fila global por unidad');
    assert.ok(db.tables.evaluations.every((e) => e.color === 'not_evaluated' && e.escalation_level === 'normal'));
    assert.equal(db.tables.alerts.length, 0, 'sin evaluar no es un cambio de color que alertar');
    const before = snapshot(db);
    await runMonthly(db, { asOf: '2027-02-01' });
    assert.deepEqual(snapshot(db), before);
    const daily = await runDaily(db, { asOf: '2027-01-20' });
    assert.deepEqual(daily, { mode: 'daily', asOf: '2027-01-20', snapshots: 0, alerts: 0, errors: [] });
  });

  test('unidad nueva sin mediciones ni compromisos: sin evaluar, sin alertas, no afecta a las demás', async () => {
    const data = seedScenario();
    data.units.push({ id: 'u-delta', name: 'Unidad Delta' });
    data.user_roles.push({ user_id: 'p-l4', role: 'unit_leader', unit_id: 'u-delta' });
    const db = createFakeDb(data);
    const m = await runMonthly(db, { asOf: '2027-02-01' });
    const d = await runDaily(db, { asOf: '2027-02-10' });
    assert.deepEqual([...m.errors, ...d.errors], []);
    const delta = db.tables.evaluations.filter((e) => e.unit_id === 'u-delta');
    assert.equal(delta.length, 5);
    assert.ok(delta.every((e) => e.color === 'not_evaluated'));
    assert.equal(db.tables.alerts.filter((a) => a.unit_id === 'u-delta').length, 0);
    assert.equal(db.tables.alerts.filter((a) => a.recipient_user_id === 'p-l4').length, 0);
    assert.equal(db.tables.alerts.length, 4 + 10, 'mismas alertas que la semilla sin Delta');
  });
});

describe('QA mes sin evaluación previa', () => {
  test('primer cierre sin historial: alerta los no verdes (desde "sin evaluar") y no el verde', async () => {
    const data = seedScenario();
    data.measurements.push(
      { unit_id: U.alfa, indicator_id: I.avail, measured_on: '2027-02-15', value: 99.95, app_id: null, compliant: null, category: null, kind: null, created_at: 'z' },
    );
    const db = createFakeDb(data);
    const r = await runMonthly(db, { asOf: '2027-03-01' }); // enero nunca se evaluó
    assert.deepEqual(r.errors, []);
    const cc = db.tables.alerts.filter((a) => a.kind === 'color_change');
    assert.ok(cc.every((a) => a.payload.previous_color === 'not_evaluated' && a.payload.previous_level === null));
    assert.ok(cc.every((a) => a.payload.color !== 'green'));
    assertOnePerTriggerAndRecipient(cc);
    const before = snapshot(db);
    await runMonthly(db, { asOf: '2027-03-01' });
    assert.deepEqual(snapshot(db), before, 'idempotente también sin historial');
  });

  test('evaluar después el mes faltante no duplica la alerta del mes ya cerrado', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-03-01' }); // febrero primero
    const febAlerts = db.tables.alerts.filter((a) => a.payload.month === '2027-02').length;
    await runMonthly(db, { asOf: '2027-02-01' }); // luego enero (reproceso manual)
    assert.equal(db.tables.alerts.filter((a) => a.payload.month === '2027-02').length, febAlerts);
    assertOnePerTriggerAndRecipient(db.tables.alerts);
  });
});

describe('QA disparadores: exactamente una alerta por destinatario', () => {
  test('atraso: se repite atrasada sin alertar; se pone al día; vuelve a atrasarse y alerta otra vez', async () => {
    const db = createFakeDb(seedScenario());
    await runDaily(db, { asOf: '2027-02-10' });
    const paceBeta = () => db.tables.alerts.filter((a) => a.kind === 'pace_behind' && a.unit_id === U.beta);
    assert.equal(paceBeta().length, 2, 'líder + comité');
    db.tables.measurements.push(
      { unit_id: U.beta, indicator_id: I.vuln, measured_on: '2027-02-11', value: 700, category: 'P0P1', kind: 'resolved', created_at: 'z' },
      { unit_id: U.beta, indicator_id: I.vuln, measured_on: '2027-02-11', value: 300, category: 'P2P3', kind: 'resolved', created_at: 'z' },
    );
    await runDaily(db, { asOf: '2027-02-11' });
    assert.equal(paceBeta().length, 2, 'al ponerse al día no alerta');
    db.tables.measurements.push(
      { unit_id: U.beta, indicator_id: I.vuln, measured_on: '2027-02-12', value: 900, category: 'P0P1', kind: 'detected', created_at: 'z' },
    );
    await runDaily(db, { asOf: '2027-02-20' });
    assert.equal(paceBeta().length, 4, 'nuevo atraso: una alerta más por destinatario');
    await runDaily(db, { asOf: '2027-02-20' });
    await runDaily(db, { asOf: '2027-02-21' });
    assert.equal(paceBeta().length, 4, 'sigue atrasada: no repite');
    assertOnePerTriggerAndRecipient(db.tables.alerts);
  });

  test('vencimiento de excepción: nada el día antes, una "vence hoy", una "vencida", luego nada', async () => {
    const data = seedScenario();
    data.exceptions = [{ id: 'ex-q', unit_id: U.alfa, scope: 'all', expires_on: '2027-02-15' }];
    const db = createFakeDb(data);
    const states = () =>
      db.tables.alerts.filter((a) => a.kind === 'exception_expired').map((a) => `${a.payload.state}>${a.recipient_user_id}`).sort();
    await runDaily(db, { asOf: '2027-02-14' });
    assert.deepEqual(states(), []);
    await runDaily(db, { asOf: '2027-02-15' });
    await runDaily(db, { asOf: '2027-02-15' });
    assert.deepEqual(states(), [`expires_today>${IDS.committee}`, `expires_today>${IDS.leaders.alfa}`].sort());
    for (const d of ['2027-02-16', '2027-02-16', '2027-02-17', '2027-02-22']) await runDaily(db, { asOf: d });
    assert.deepEqual(
      states(),
      [`expires_today>${IDS.committee}`, `expires_today>${IDS.leaders.alfa}`, `expired>${IDS.committee}`, `expired>${IDS.leaders.alfa}`].sort(),
    );
    assert.equal(
      db.tables.audit_log.filter((a) => a.action === 'exception_expired' && a.entity_id === 'ex-q').length,
      1,
      'auditoría del vencimiento una sola vez',
    );
  });

  test('ingreso de P0/P1: dos ingresos distintos el mismo día suman una sola alerta por destinatario', async () => {
    const data = seedScenario();
    data.measurements.push(
      { unit_id: U.alfa, indicator_id: I.vuln, measured_on: '2027-02-10', value: 50, category: 'P0P1', kind: 'detected', created_at: 'z' },
    );
    data.exceptions = [];
    const db = createFakeDb(data);
    await runDaily(db, { asOf: '2027-02-10' });
    const intake = db.tables.alerts.filter((a) => a.kind === 'critical_intake');
    assert.deepEqual(intake.map((a) => a.recipient_user_id).sort(), [IDS.committee, IDS.leaders.alfa].sort());
    assert.equal(intake[0].payload.new_total, 2250);
  });

  test('corrección de datos del mes ya cerrado: el nuevo color alerta una vez y el reproceso no duplica', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-02-01' });
    db.tables.measurements.push(
      { unit_id: U.alfa, indicator_id: I.avail, measured_on: '2027-01-20', value: 90, app_id: null, compliant: null, category: null, kind: null, created_at: 'z' },
    );
    await runMonthly(db, { asOf: '2027-02-01' });
    const alfa = db.tables.alerts.filter((a) => a.unit_id === U.alfa && a.kind === 'color_change');
    assert.equal(alfa.length, 2, 'Alfa pasa de verde a no verde: líder + comité');
    const before = snapshot(db);
    await runMonthly(db, { asOf: '2027-02-01' });
    assert.deepEqual(snapshot(db), before);
  });

  test('secuencia completa del trimestre corrida dos veces: sin duplicados y todo auditado', async () => {
    const db = createFakeDb(seedScenario());
    const seq = [
      ['m', '2027-02-01'], ['d', '2027-02-10'], ['d', '2027-02-11'], ['m', '2027-03-01'], ['d', '2027-03-05'], ['m', '2027-04-01'],
    ];
    const runAll = async () => {
      for (const [k, asOf] of seq) {
        const r = await (k === 'm' ? runMonthly : runDaily)(db, { asOf });
        assert.deepEqual(r.errors, [], `${k} ${asOf}`);
      }
    };
    await runAll();
    const first = snapshot(db);
    await runAll();
    assert.deepEqual(snapshot(db), first);
    assertOnePerTriggerAndRecipient(db.tables.alerts);
    assert.equal(
      db.tables.audit_log.filter((a) => a.action === 'alert_sent').length,
      db.tables.alerts.length,
      'cada alerta enviada queda en auditoría (CLAUDE.md §4)',
    );
  });
});

// C-02 (desarrollador): las Actions respetan revocación y change_ref.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUnitMonth } from '../../scripts/lib/build.js';
import { exceptionAlerts } from '../../scripts/lib/alerts.js';
import { runDaily } from '../../scripts/lib/run.js';
import { exceptionFromRow } from '../../engine/index.js';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';

const U = IDS.U;

describe('exceptionFromRow (engine)', () => {
  test('convierte snake_case y toma revoked_at en America/Guayaquil', () => {
    assert.deepEqual(
      exceptionFromRow({ id: 'a', scope: 'change_start', expires_on: '2026-12-31', change_ref: 'CHG', revoked_at: '2026-12-01T03:00:00Z' }),
      { id: 'a', scope: 'change_start', expiresOn: '2026-12-31', changeRef: 'CHG', revokedOn: '2026-11-30' },
    );
    assert.deepEqual(exceptionFromRow({ id: 'b', scope: 'all', expires_on: '2026-12-31' }),
      { id: 'b', scope: 'all', expiresOn: '2026-12-31', changeRef: null, revokedOn: null });
  });
  test('rechaza filas y fechas inválidas', () => {
    assert.throws(() => exceptionFromRow(null), TypeError);
    assert.throws(() => exceptionFromRow({ id: 'x', scope: 'all', expires_on: '2026-12-31', revoked_at: 'ayer' }), TypeError);
  });
});

describe('evaluateUnitMonth con excepciones C-02', () => {
  const base = { evalMonth: '2026-11', asOf: '2026-11-25', indicatorColors: ['red'], storedColors: { '2026-10': 'red' } };
  test('revocada antes de asOf: el congelamiento vuelve', () => {
    const r = evaluateUnitMonth({ ...base, exceptions: [{ id: 'e', scope: 'all', expires_on: '2026-12-31', revoked_at: '2026-11-20T15:00:00Z' }] });
    assert.equal(r.escalation.level, 'frozen');
    assert.deepEqual(r.escalation.revokedExceptions, ['e']);
  });
  test('sin revocar: suspende', () => {
    const r = evaluateUnitMonth({ ...base, exceptions: [{ id: 'e', scope: 'all', expires_on: '2026-12-31', revoked_at: null }] });
    assert.equal(r.escalation.level, 'exception');
  });
  test('change_start en frozen informa el change', () => {
    const r = evaluateUnitMonth({ ...base, exceptions: [{ id: 'c', scope: 'change_start', expires_on: '2026-12-31', change_ref: 'CHG-9' }] });
    assert.deepEqual(r.escalation.authorizedStarts, [{ id: 'c', change_ref: 'CHG-9' }]);
  });
});

describe('exceptionAlerts excluye revocadas', () => {
  const units = new Map([['u', { id: 'u', name: 'Unidad U' }]]);
  const recipientsByUnit = () => ['r1'];
  test('revocada que vence hoy o ya venció: sin alerta', () => {
    const exceptions = [
      { id: 'a', unit_id: 'u', scope: 'all', expires_on: '2027-02-10', revoked_at: '2027-02-01T12:00:00Z' },
      { id: 'b', unit_id: 'u', scope: 'all', expires_on: '2027-02-05', revoked_at: '2027-02-01T12:00:00Z' },
    ];
    assert.deepEqual(exceptionAlerts({ exceptions, asOf: '2027-02-10', units, recipientsByUnit }), []);
  });
  test('no revocada sí alerta', () => {
    const exceptions = [{ id: 'a', unit_id: 'u', scope: 'all', expires_on: '2027-02-10', revoked_at: null }];
    assert.equal(exceptionAlerts({ exceptions, asOf: '2027-02-10', units, recipientsByUnit }).length, 1);
  });
});

test('runDaily: una excepción revocada no genera alerta ni auditoría de vencimiento', async () => {
  const data = seedScenario();
  data.exceptions = data.exceptions.map((e) => ({ ...e, revoked_at: '2027-02-01T12:00:00Z' }));
  const db = createFakeDb(data);
  const r = await runDaily(db, { asOf: '2027-02-10' });
  assert.deepEqual(r.errors, []);
  assert.equal(db.tables.alerts.filter((a) => a.kind === 'exception_expired').length, 0);
  assert.equal(db.tables.audit_log.filter((a) => a.action === 'exception_expired').length, 0);
  assert.ok(db.tables.alerts.some((a) => a.kind === 'pace_behind' && a.unit_id === U.beta), 'el resto del parte diario sigue');
});

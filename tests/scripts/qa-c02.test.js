// C-02 (QA): el cálculo programado (Actions) debe respetar la revocación.
// Traza a "suspenden el candado mientras estén vigentes": una revocada no está vigente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUnitMonth } from '../../scripts/lib/build.js';

test('evaluateUnitMonth: una excepción revocada (revoked_at) no suspende el candado', () => {
  const r = evaluateUnitMonth({
    evalMonth: '2026-11',
    asOf: '2026-11-19',
    indicatorColors: ['red'],
    storedColors: { '2026-10': 'red' },
    exceptions: [
      { id: 'x', unit_id: 'u', scope: 'all', expires_on: '2026-12-31', revoked_at: '2026-11-18T15:00:00Z' },
    ],
  });
  assert.equal(r.escalation.level, 'frozen');
  assert.deepEqual(r.escalation.revokedExceptions, ['x']);
});

test('evaluateUnitMonth: change_start con change_ref llega a authorizedStarts', () => {
  const r = evaluateUnitMonth({
    evalMonth: '2026-11',
    asOf: '2026-11-19',
    indicatorColors: ['red'],
    storedColors: { '2026-10': 'red' },
    exceptions: [{ id: 'c', unit_id: 'u', scope: 'change_start', expires_on: '2026-12-31', change_ref: 'CHG-1' }],
  });
  assert.deepEqual(r.escalation.authorizedStarts, [{ id: 'c', change_ref: 'CHG-1' }]);
});

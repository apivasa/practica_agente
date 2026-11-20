// V-08 (desarrollador): candado vigente hoy (engine/lock.js) y su uso en los tableros.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lockToday, buildHistory, assertHistoryFresh, YELLOW_MONTH2_ESCALATES_LIKE_RED } from '../../engine/lock.js';
import * as engine from '../../engine/index.js';
import * as build from '../../scripts/lib/build.js';
import { RESTRICTIONS } from '../../engine/escalation.js';
import { unitLockToday } from '../../src/lib/dashboard.js';

const U = 'unit-1';
const OTHER = 'unit-2';
const g = (month, color, unit = U) => ({ unit_id: unit, indicator_id: null, month, color });
const exc = (o) => ({
  id: 'x1', unit_id: U, scope: 'all', reason: 'Ficticia', change_ref: null, expires_on: '2027-03-31', revoked_at: null, ...o,
});
const FROZEN_EVALS = [g('2027-01', 'red'), g('2027-02', 'red')];

describe('lockToday: cierre vigente', () => {
  test('sin evaluaciones: no_closure con el mes anterior y el actual en el motivo', () => {
    const r = lockToday({ unitId: U, evaluations: [], exceptions: [], today: '2027-03-10' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'no_closure');
    assert.match(r.reason, /2027-02.*2027-03/);
  });
  test('cierre viejo (antes del mes anterior) no aplica candado', () => {
    const r = lockToday({ unitId: U, evaluations: [g('2026-12', 'red')], exceptions: [], today: '2027-03-10' });
    assert.equal(r.ok, false);
    assert.equal(r.closureMonth, '2026-12');
  });
  test('evaluaciones futuras se ignoran (no rompen el motor)', () => {
    const r = lockToday({ unitId: U, evaluations: [g('2027-04', 'red')], exceptions: [], today: '2027-03-10' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'no_closure');
  });
  test('cierre del mes anterior: congelada por dos rojos', () => {
    const r = lockToday({ unitId: U, evaluations: FROZEN_EVALS, exceptions: [], today: '2027-03-10' });
    assert.equal(r.ok, true);
    assert.equal(r.closureMonth, '2027-02');
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
  });
  test('primer mes de trimestre: usa el cierre del trimestre anterior', () => {
    const r = lockToday({ unitId: U, evaluations: [g('2027-02', 'red'), g('2027-03', 'red')], exceptions: [], today: '2027-04-02' });
    assert.equal(r.ok, true);
    assert.equal(r.closureMonth, '2027-03');
    assert.equal(r.level, 'frozen');
  });
  test('solo cuentan las filas globales de la unidad pedida', () => {
    const evaluations = [
      g('2027-02', 'red', OTHER), g('2027-01', 'red', OTHER),
      { unit_id: U, indicator_id: 'ind', month: '2027-02', color: 'red' },
      g('2027-02', 'green'),
    ];
    const r = lockToday({ unitId: U, evaluations, exceptions: [], today: '2027-03-01' });
    assert.equal(r.level, 'normal');
  });
  test('color guardado inválido: invalid, sin lanzar', () => {
    const r = lockToday({ unitId: U, evaluations: [g('2027-02', '<b>x</b>')], exceptions: [], today: '2027-03-01' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'invalid');
  });
  test('excepción con fecha inválida: invalid, sin lanzar', () => {
    const r = lockToday({ unitId: U, evaluations: FROZEN_EVALS, exceptions: [exc({ expires_on: 'x' })], today: '2027-03-01' });
    assert.equal(r.status, 'invalid');
  });
  test('today y unitId obligatorios', () => {
    assert.throws(() => lockToday({ unitId: U, evaluations: [], exceptions: [], today: '2027-02-31' }), TypeError);
    assert.throws(() => lockToday({ unitId: '', evaluations: [], exceptions: [], today: '2027-03-01' }), TypeError);
  });
});

describe('lockToday: excepciones de hoy (sin esperar al cierre)', () => {
  const today = '2027-03-10';
  test('scope all vigente hoy: en excepción, restricciones suspendidas', () => {
    const r = lockToday({ unitId: U, evaluations: FROZEN_EVALS, exceptions: [exc({ expires_on: '2027-03-10' })], today });
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.restrictions, []);
    assert.deepEqual(r.suppressedRestrictions, [...RESTRICTIONS.frozen]);
    assert.deepEqual(r.appliedExceptions, ['x1']);
  });
  test('scope all de otra unidad no aplica', () => {
    const r = lockToday({ unitId: U, evaluations: FROZEN_EVALS, exceptions: [exc({ unit_id: OTHER })], today });
    assert.equal(r.level, 'frozen');
  });
  test('scope all vencida ayer o revocada hoy: el candado vuelve', () => {
    for (const e of [exc({ expires_on: '2027-03-09' }), exc({ revoked_at: '2027-03-10T15:00:00Z' })]) {
      assert.equal(lockToday({ unitId: U, evaluations: FROZEN_EVALS, exceptions: [e], today }).level, 'frozen');
    }
  });
  test('change_start con unidad congelada: inicio autorizado sin levantar el congelamiento', () => {
    const r = lockToday({
      unitId: U, evaluations: FROZEN_EVALS, today,
      exceptions: [exc({ scope: 'change_start', change_ref: 'CHG-FICT-9' })],
    });
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
    assert.deepEqual(r.authorizedStarts, [{ id: 'x1', change_ref: 'CHG-FICT-9' }]);
  });
  test('change_start con unidad restringida: quita no_new_change, sin inicio autorizado', () => {
    const r = lockToday({
      unitId: U, evaluations: [g('2027-02', 'yellow')], today,
      exceptions: [exc({ scope: 'change_start', change_ref: 'CHG-1' })],
    });
    assert.equal(r.level, 'restricted');
    assert.ok(!r.restrictions.includes('no_new_change'));
    assert.deepEqual(r.authorizedStarts, []);
  });
});

describe('unitLockToday (front)', () => {
  test('añade "Inicio autorizado: REF" y la base del cálculo', () => {
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_EVALS, today: '2027-03-10',
      exceptions: [exc({ scope: 'change_start', change_ref: 'CHG-FICT-9' })],
    });
    assert.deepEqual(r.authorizedLabels, ['Inicio autorizado: CHG-FICT-9']);
    assert.equal(r.basis, 'Según el cierre de 2027-02 y las excepciones vigentes al 2027-03-10');
  });
  test('sin cierre vigente devuelve el motivo del motor', () => {
    const r = unitLockToday({ unitId: U, evaluations: [], exceptions: [], today: '2027-03-10' });
    assert.equal(r.ok, false);
    assert.equal(r.authorizedLabels, undefined);
  });
});

describe('una sola fuente del historial (Actions y front)', () => {
  test('scripts/lib/build.js reexporta las funciones del motor', () => {
    assert.equal(build.buildHistory, buildHistory);
    assert.equal(build.assertHistoryFresh, assertHistoryFresh);
    assert.equal(build.YELLOW_MONTH2_ESCALATES_LIKE_RED, YELLOW_MONTH2_ESCALATES_LIKE_RED);
    assert.equal(engine.lockToday, lockToday);
  });
  test('buildHistory no lee claves heredadas del prototipo', () => {
    assert.deepEqual(buildHistory('2027-02', {}, 'red'), [
      { month: '2027-01', color: 'not_evaluated' }, { month: '2027-02', color: 'red' },
    ]);
  });
});

test('unitLockToday no lanza con unidad o fecha inválidas (la vista muestra el motivo)', () => {
  for (const input of [{ unitId: '', today: '2027-03-10' }, { unitId: U, today: 'x' }]) {
    const r = unitLockToday({ ...input, evaluations: [], exceptions: [] });
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
  }
});

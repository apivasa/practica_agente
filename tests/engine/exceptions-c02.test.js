// C-02 (desarrollador): excepciones del comité en el motor.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEscalation, RESTRICTIONS } from '../../engine/escalation.js';
import {
  EXCEPTION_MAX_DAYS,
  addDays,
  maxExpiry,
  exceptionStatus,
  validateExceptionDraft,
} from '../../engine/exceptions.js';
import * as engine from '../../engine/index.js';

const ASOF = '2026-03-15';
const RED1 = [{ month: '2026-03', color: 'red' }];
const RED2 = [{ month: '2026-02', color: 'red' }, { month: '2026-03', color: 'red' }];
const ev = (history, activeExceptions, asOf = ASOF) => evaluateEscalation(history, { asOf, activeExceptions });

describe('evaluateEscalation: change_start con unidad congelada (ADR 0003)', () => {
  test('se reporta como inicio puntual autorizado y el congelamiento sigue', () => {
    const r = ev(RED2, [{ id: 'e1', scope: 'change_start', expiresOn: '2026-03-31', changeRef: 'CHG-1' }]);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
    assert.deepEqual(r.suppressedRestrictions, []);
    assert.deepEqual(r.appliedExceptions, []);
    assert.deepEqual(r.authorizedStarts, [{ id: 'e1', change_ref: 'CHG-1' }]);
    assert.match(r.reason, /Inicio puntual autorizado.*CHG-1/);
  });
  test('sin changeRef (fila previa a C-02) se reporta con change_ref null', () => {
    const r = ev(RED2, [{ id: 'old', scope: 'change_start', expiresOn: '2026-03-31' }]);
    assert.deepEqual(r.authorizedStarts, [{ id: 'old', change_ref: null }]);
  });
  test('ids duplicados no se repiten', () => {
    const ex = { id: 'd', scope: 'change_start', expiresOn: '2026-03-31', changeRef: 'CHG-2' };
    assert.deepEqual(ev(RED2, [ex, { ...ex }]).authorizedStarts, [{ id: 'd', change_ref: 'CHG-2' }]);
  });
  test('en restricted no hay authorizedStarts: se quita no_new_change como antes', () => {
    const r = ev(RED1, [{ id: 'e1', scope: 'change_start', expiresOn: '2026-03-31', changeRef: 'CHG-1' }]);
    assert.equal(r.level, 'restricted');
    assert.ok(!r.restrictions.includes('no_new_change'));
    assert.deepEqual(r.authorizedStarts, []);
  });
  test('scope all prevalece y no hay authorizedStarts', () => {
    const r = ev(RED2, [
      { id: 'a', scope: 'all', expiresOn: '2026-03-31' },
      { id: 'c', scope: 'change_start', expiresOn: '2026-03-31', changeRef: 'CHG-3' },
    ]);
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.authorizedStarts, []);
  });
});

describe('evaluateEscalation: vencidas y revocadas', () => {
  test('vencida: el candado vuelve', () => {
    const ex = [{ id: 'a', scope: 'all', expiresOn: '2026-03-14' }];
    const r = ev(RED2, ex);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
    assert.deepEqual(r.expiredExceptions, ['a']);
    // un día antes seguía vigente
    assert.equal(ev(RED2, ex, '2026-03-14').level, 'exception');
  });
  test('vencida change_start en frozen: ya no hay inicio autorizado', () => {
    const r = ev(RED2, [{ id: 'c', scope: 'change_start', expiresOn: '2026-03-14', changeRef: 'X' }]);
    assert.deepEqual(r.authorizedStarts, []);
    assert.deepEqual(r.expiredExceptions, ['c']);
  });
  test('revocada: se ignora y se informa aparte', () => {
    const r = ev(RED2, [{ id: 'a', scope: 'all', expiresOn: '2026-03-31', revokedOn: '2026-03-10' }]);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.revokedExceptions, ['a']);
    assert.deepEqual(r.expiredExceptions, []);
    assert.deepEqual(r.appliedExceptions, []);
  });
  test('revocada el mismo día de asOf ya no aplica', () => {
    const r = ev(RED1, [{ id: 'c', scope: 'change_start', expiresOn: '2026-03-31', changeRef: 'X', revokedOn: ASOF }]);
    assert.ok(r.restrictions.includes('no_new_change'));
    assert.deepEqual(r.revokedExceptions, ['c']);
  });
  test('revocación posterior a asOf: aún aplicaba en esa fecha', () => {
    const r = ev(RED2, [{ id: 'a', scope: 'all', expiresOn: '2026-03-31', revokedOn: '2026-03-20' }]);
    assert.equal(r.level, 'exception');
  });
  test('revokedOn y changeRef inválidos se rechazan', () => {
    for (const revokedOn of ['2026-02-31', 'ayer', 5, '']) {
      assert.throws(() => ev(RED2, [{ id: 'x', scope: 'all', expiresOn: '2026-03-31', revokedOn }]), TypeError);
    }
    for (const changeRef of ['', '  ', 7, {}]) {
      assert.throws(() => ev(RED2, [{ id: 'x', scope: 'change_start', expiresOn: '2026-03-31', changeRef }]), TypeError);
    }
  });
  test('resultado siempre trae revokedExceptions y authorizedStarts', () => {
    const r = ev([{ month: '2026-03', color: 'green' }], []);
    assert.deepEqual(r.revokedExceptions, []);
    assert.deepEqual(r.authorizedStarts, []);
  });
});

describe('engine/exceptions.js', () => {
  test('addDays y maxExpiry cruzan meses y años bisiestos', () => {
    assert.equal(addDays('2026-11-19', 90), '2027-02-17');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(maxExpiry('2026-11-19'), addDays('2026-11-19', EXCEPTION_MAX_DAYS));
    assert.throws(() => addDays('2026-02-30', 1), TypeError);
    assert.throws(() => addDays('2026-02-01', 1.5), TypeError);
  });
  test('exceptionStatus', () => {
    assert.equal(exceptionStatus({ expiresOn: '2026-03-15' }, '2026-03-15'), 'active');
    assert.equal(exceptionStatus({ expiresOn: '2026-03-14' }, '2026-03-15'), 'expired');
    assert.equal(exceptionStatus({ expiresOn: '2026-03-31', revokedOn: '2026-03-01' }, '2026-03-15'), 'revoked');
    assert.equal(exceptionStatus({ expiresOn: '2026-03-01', revokedOn: '2026-02-01' }, '2026-03-15'), 'revoked');
    assert.equal(exceptionStatus({ expiresOn: '2026-03-31', revokedOn: null }, '2026-03-15'), 'active');
    assert.throws(() => exceptionStatus({ expiresOn: 'x' }, '2026-03-15'), TypeError);
  });

  const TODAY = '2026-11-19';
  const base = { unitId: 'u-1', scope: 'change_start', reason: ' Urgente ', changeRef: ' CHG-1 ', expiresOn: '2026-12-01' };
  test('validateExceptionDraft: borrador válido normalizado', () => {
    const r = validateExceptionDraft(base, TODAY);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { unitId: 'u-1', scope: 'change_start', reason: 'Urgente', changeRef: 'CHG-1', expiresOn: '2026-12-01' });
  });
  test('validateExceptionDraft: scope all descarta changeRef', () => {
    const r = validateExceptionDraft({ ...base, scope: 'all', changeRef: 'ignorado' }, TODAY);
    assert.equal(r.ok, true);
    assert.equal(r.value.changeRef, null);
  });
  test('validateExceptionDraft: errores por campo', () => {
    const r = validateExceptionDraft({ unitId: '', scope: 'otra', reason: '  ', changeRef: '', expiresOn: '2026-13-01' }, TODAY);
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ['expiresOn', 'reason', 'scope', 'unitId']);
    assert.equal(validateExceptionDraft({ ...base, changeRef: '  ' }, TODAY).errors.changeRef, 'Indica el change que se autoriza.');
    assert.ok(validateExceptionDraft({ ...base, changeRef: 'x'.repeat(201) }, TODAY).errors.changeRef);
    assert.ok(validateExceptionDraft({ ...base, reason: 'x'.repeat(2001) }, TODAY).errors.reason);
  });
  test('validateExceptionDraft: vencimiento entre hoy y el tope', () => {
    assert.equal(validateExceptionDraft({ ...base, expiresOn: TODAY }, TODAY).ok, true);
    assert.equal(validateExceptionDraft({ ...base, expiresOn: '2027-02-17' }, TODAY).ok, true);
    assert.match(validateExceptionDraft({ ...base, expiresOn: '2027-02-18' }, TODAY).errors.expiresOn, /90 días/);
    assert.match(validateExceptionDraft({ ...base, expiresOn: '2026-11-18' }, TODAY).errors.expiresOn, /pasado/);
  });
  test('index reexporta las funciones de excepciones', () => {
    assert.equal(engine.validateExceptionDraft, validateExceptionDraft);
    assert.equal(engine.EXCEPTION_MAX_DAYS, 90);
  });
});

// C-02 (QA): excepciones del comité. Cada caso traza al criterio
// "el comité aprueba; vencida -> el candado vuelve" y a docs/diseno.md
// ("aprobadas por el comité, con motivo y vencimiento"; "suspenden el candado
// mientras estén vigentes") y a ADR 0003 (change_start en frozen no levanta).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEscalation, RESTRICTIONS } from '../../engine/escalation.js';
import { maxExpiry, exceptionStatus, validateExceptionDraft } from '../../engine/exceptions.js';

const RED2 = [{ month: '2026-10', color: 'red' }, { month: '2026-11', color: 'red' }];
const RED1 = [{ month: '2026-11', color: 'red' }];
const TODAY = '2026-11-19';
const ev = (h, ex, asOf = TODAY) => evaluateEscalation(h, { asOf, activeExceptions: ex });
const draft = { unitId: 'u', scope: 'all', reason: 'Urgente', expiresOn: TODAY };

describe('QA C-02: tope de 90 días', () => {
  test('exactamente 90 días es válido; 91 no', () => {
    assert.equal(maxExpiry(TODAY), '2027-02-17');
    assert.equal(validateExceptionDraft({ ...draft, expiresOn: '2027-02-17' }, TODAY).ok, true);
    const r = validateExceptionDraft({ ...draft, expiresOn: '2027-02-18' }, TODAY);
    assert.equal(r.ok, false);
    assert.match(r.errors.expiresOn, /90 días.*2027-02-17/);
  });
  test('tope cruzando el 29 de febrero de año bisiesto', () => {
    assert.equal(maxExpiry('2027-12-01'), '2028-02-29');
    assert.equal(validateExceptionDraft({ ...draft, expiresOn: '2028-02-29' }, '2027-12-01').ok, true);
    assert.equal(validateExceptionDraft({ ...draft, expiresOn: '2028-03-01' }, '2027-12-01').ok, false);
  });
  test('motivo obligatorio (diseño: con motivo registrado)', () => {
    assert.ok(validateExceptionDraft({ ...draft, reason: '\n\t ' }, TODAY).errors.reason);
    assert.ok(validateExceptionDraft({ ...draft, reason: undefined }, TODAY).errors.reason);
  });
  test('fecha inexistente o sin vencimiento se rechaza', () => {
    for (const expiresOn of ['2026-11-31', undefined, null, '19/11/2026']) {
      assert.ok(validateExceptionDraft({ ...draft, expiresOn }, TODAY).errors.expiresOn, String(expiresOn));
    }
  });
});

describe('QA C-02: vence hoy / vencida -> el candado vuelve', () => {
  const all = { id: 'a', scope: 'all', expiresOn: TODAY };
  test('vence hoy: sigue vigente y suspende el candado', () => {
    assert.equal(exceptionStatus(all, TODAY), 'active');
    const r = ev(RED2, [all]);
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.appliedExceptions, ['a']);
    assert.deepEqual(r.suppressedRestrictions, [...RESTRICTIONS.frozen]);
  });
  test('al día siguiente: vencida y el candado vuelve completo', () => {
    assert.equal(exceptionStatus(all, '2026-11-20'), 'expired');
    const r = ev(RED2, [all], '2026-11-20');
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
    assert.deepEqual(r.expiredExceptions, ['a']);
    assert.deepEqual(r.appliedExceptions, []);
  });
  test('vencida en restricted: no_new_change vuelve', () => {
    const r = ev(RED1, [{ id: 'c', scope: 'change_start', expiresOn: '2026-11-18', changeRef: 'CHG' }]);
    assert.equal(r.level, 'restricted');
    assert.ok(r.restrictions.includes('no_new_change'));
  });
});

describe('QA C-02: revocada', () => {
  test('revocada antes de vencer: el candado vuelve', () => {
    const r = ev(RED2, [{ id: 'a', scope: 'all', expiresOn: '2026-12-31', revokedOn: '2026-11-19' }]);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.revokedExceptions, ['a']);
    assert.deepEqual(r.appliedExceptions, []);
  });
  test('revocada y además vencida cuenta como revocada (no duplica)', () => {
    const r = ev(RED2, [{ id: 'a', scope: 'all', expiresOn: '2026-11-01', revokedOn: '2026-10-20' }]);
    assert.deepEqual(r.revokedExceptions, ['a']);
    assert.deepEqual(r.expiredExceptions, []);
  });
  test('revocada change_start en frozen: no hay inicio autorizado', () => {
    const r = ev(RED2, [{ id: 'c', scope: 'change_start', expiresOn: '2026-12-31', changeRef: 'CHG', revokedOn: '2026-11-18' }]);
    assert.deepEqual(r.authorizedStarts, []);
    assert.doesNotMatch(r.reason, /Inicio puntual/);
  });
  test('una revocada no anula otra vigente', () => {
    const r = ev(RED2, [
      { id: 'r', scope: 'all', expiresOn: '2026-12-31', revokedOn: '2026-11-01' },
      { id: 'v', scope: 'all', expiresOn: '2026-12-31' },
    ]);
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.appliedExceptions, ['v']);
    assert.deepEqual(r.revokedExceptions, ['r']);
  });
});

describe('QA C-02: change_start con unidad congelada (ADR 0003)', () => {
  test('authorizedStarts informa el change y el candado no se levanta', () => {
    const r = ev(RED2, [
      { id: 'c1', scope: 'change_start', expiresOn: TODAY, changeRef: 'CHG-1' },
      { id: 'c2', scope: 'change_start', expiresOn: '2026-12-01', changeRef: 'CHG-2' },
    ]);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
    assert.deepEqual(r.suppressedRestrictions, []);
    assert.deepEqual(r.authorizedStarts, [
      { id: 'c1', change_ref: 'CHG-1' },
      { id: 'c2', change_ref: 'CHG-2' },
    ]);
    assert.match(r.reason, /CHG-1, CHG-2/);
  });
  test('al vencer el change_start desaparece el inicio autorizado', () => {
    const r = ev(RED2, [{ id: 'c1', scope: 'change_start', expiresOn: TODAY, changeRef: 'CHG-1' }], '2026-11-20');
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.authorizedStarts, []);
  });
  test('en verde no se reportan inicios autorizados', () => {
    const r = ev([{ month: '2026-11', color: 'green' }], [{ id: 'c', scope: 'change_start', expiresOn: TODAY, changeRef: 'X' }]);
    assert.deepEqual(r.authorizedStarts, []);
  });
});

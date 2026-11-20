// QA V-08 (tester, independiente del desarrollador). Cada caso traza a una frase:
// - plan-maestro V-08: "Candado vigente hoy en el front (motor evaluateEscalation + excepciones
//   vigentes) e 'Inicio autorizado: REF'"; criterio: "excepción 'todo' se ve el mismo día;
//   inicio puntual con unidad congelada".
// - ADR 0003 punto 2: change_start en frozen no levanta el congelamiento; solo 'all' suspende todo.
// - ADR 0003 punto 3: asOf en America/Guayaquil; vigente si expiresOn >= asOf.
// - ADR 0003 "racha dentro del trimestre calendario"; punto 1: not_evaluated corta la racha.
// - ADR 0003 punto 4 (Q-03): amarillo en mes 2 no congela por defecto.
// - ADR 0012 punto 3: revocada se ignora desde revokedOn <= asOf (fecha en Guayaquil).
// - H-C01-02: el cierre debe ser del mes de hoy o del anterior.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lockToday } from '../../engine/lock.js';
import { RESTRICTIONS } from '../../engine/escalation.js';
import { unitLockToday } from '../../src/lib/dashboard.js';
import { todayInBusinessTz } from '../../src/lib/dates.js';

const U = 'unit-qa';
const OTHER = 'unit-otra';
const ev = (month, color, unit = U, indicator = null) => ({ unit_id: unit, indicator_id: indicator, month, color });
let seq = 0;
const ex = (o) => ({
  id: `qa-${++seq}`, unit_id: U, scope: 'all', reason: 'Ficticia QA', change_ref: null,
  expires_on: '2027-01-31', revoked_at: null, created_at: '2026-11-20T15:00:00Z', ...o,
});
// Q4 2026: octubre y noviembre en rojo -> congelada (cierre de noviembre).
const FROZEN_Q4 = [ev('2026-10', 'red'), ev('2026-11', 'red')];
const T = '2026-12-10';

describe('QA V-08 · bordes de fecha en America/Guayaquil', () => {
  test('excepción "todo" que vence hoy sigue vigente hoy (día de vencimiento incluido)', () => {
    const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, exceptions: [ex({ expires_on: T })], today: T });
    assert.equal(r.ok, true);
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.restrictions, []);
  });

  test('excepción "todo" que venció ayer ya no suspende: vuelve el congelamiento', () => {
    const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, exceptions: [ex({ expires_on: '2026-12-09' })], today: T });
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, RESTRICTIONS.frozen);
  });

  test('aprobada hoy a las 23:30 de Guayaquil (ya es mañana en UTC) y que vence hoy: se ve hoy', () => {
    const now = new Date('2026-12-11T04:30:00Z'); // 2026-12-10 23:30 en Guayaquil
    const today = todayInBusinessTz(now);
    assert.equal(today, T);
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_Q4, today,
      exceptions: [ex({ expires_on: T, created_at: now.toISOString() })],
    });
    assert.equal(r.level, 'exception');
  });

  test('revocada hoy a las 23:30 de Guayaquil (mañana en UTC): ya no suspende hoy', () => {
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_Q4, today: T,
      exceptions: [ex({ revoked_at: '2026-12-11T04:30:00Z' })],
    });
    assert.equal(r.level, 'frozen');
  });

  test('revocación con fecha de Guayaquil posterior a hoy (00:30 de mañana) no afecta hoy', () => {
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_Q4, today: T,
      exceptions: [ex({ revoked_at: '2026-12-11T05:30:00Z' })],
    });
    assert.equal(r.level, 'exception');
  });

  test('frescura con la fecha de Guayaquil: 30-nov 22:00 local (1-dic en UTC) acepta el cierre de octubre', () => {
    const today = todayInBusinessTz(new Date('2026-12-01T03:00:00Z'));
    assert.equal(today, '2026-11-30');
    const r = lockToday({ unitId: U, evaluations: [ev('2026-10', 'red')], exceptions: [], today });
    assert.equal(r.ok, true);
    assert.equal(r.closureMonth, '2026-10');
    assert.equal(r.level, 'restricted');
  });

  test('cierre viejo: con hoy 2026-12-01 el cierre de octubre ya no rige (no_closure, sin candado inventado)', () => {
    const r = lockToday({ unitId: U, evaluations: FROZEN_Q4.slice(0, 1), exceptions: [], today: '2026-12-01' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'no_closure');
    assert.equal(r.closureMonth, '2026-10');
    assert.equal('level' in r, false);
  });

  test('cierre viejo con una excepción "todo" vigente: sigue sin candado (no muestra "En excepción")', () => {
    const r = unitLockToday({ unitId: U, evaluations: [ev('2026-09', 'red')], exceptions: [ex({})], today: T });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'no_closure');
  });
});

describe('QA V-08 · cambio de trimestre', () => {
  test('enero sin cierre propio: rige el cierre de diciembre (Q4 en rojo tres meses -> congelada)', () => {
    const evals = [ev('2026-10', 'red'), ev('2026-11', 'red'), ev('2026-12', 'red')];
    const r = lockToday({ unitId: U, evaluations: evals, exceptions: [], today: '2027-01-15' });
    assert.equal(r.closureMonth, '2026-12');
    assert.equal(r.level, 'frozen');
  });

  test('cierre de enero en rojo tras un Q4 rojo: la racha se reinicia (mes 1 -> restringida)', () => {
    const evals = [ev('2026-10', 'red'), ev('2026-11', 'red'), ev('2026-12', 'red'), ev('2027-01', 'red')];
    const r = lockToday({ unitId: U, evaluations: evals, exceptions: [], today: '2027-02-03' });
    assert.equal(r.closureMonth, '2027-01');
    assert.equal(r.level, 'restricted');
    assert.deepEqual(r.restrictions, RESTRICTIONS.restricted);
  });

  test('un mes rojo del trimestre anterior no suma a la racha del trimestre actual', () => {
    const evals = [ev('2026-09', 'red'), ev('2026-10', 'green'), ev('2026-11', 'red')];
    const r = lockToday({ unitId: U, evaluations: evals, exceptions: [], today: T });
    assert.equal(r.level, 'restricted');
  });

  test('primer mes del trimestre con cierre en rojo y septiembre rojo: no congela', () => {
    const r = lockToday({ unitId: U, evaluations: [ev('2026-09', 'red'), ev('2026-10', 'red')], exceptions: [], today: '2026-11-05' });
    assert.equal(r.closureMonth, '2026-10');
    assert.equal(r.level, 'restricted');
  });

  test('mes sin evaluación dentro del trimestre corta la racha (ADR 0003 punto 1)', () => {
    const evals = [ev('2026-10', 'red'), ev('2026-12', 'red')];
    const r = lockToday({ unitId: U, evaluations: evals, exceptions: [], today: '2027-01-05' });
    assert.equal(r.closureMonth, '2026-12');
    assert.equal(r.level, 'restricted');
  });

  test('si hay cierre del mes actual, manda sobre el del anterior', () => {
    const r = lockToday({ unitId: U, evaluations: [ev('2026-10', 'red'), ev('2026-11', 'green')], exceptions: [], today: '2026-11-20' });
    assert.equal(r.closureMonth, '2026-11');
    assert.equal(r.level, 'normal');
  });

  test('Q-03 por defecto: amarillo en mes 2 mantiene restringida, no congela', () => {
    const r = unitLockToday({ unitId: U, evaluations: [ev('2026-10', 'red'), ev('2026-11', 'yellow')], exceptions: [], today: T });
    assert.equal(r.level, 'restricted');
  });

  test('filas por indicador y de otra unidad no forman el cierre', () => {
    const evals = [ev('2026-11', 'red', OTHER), ev('2026-11', 'red', U, 'ind-1')];
    const r = lockToday({ unitId: U, evaluations: evals, exceptions: [], today: T });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'no_closure');
  });
});

describe('QA V-08 · inicio puntual con unidad congelada (ADR 0003 punto 2, ADR 0012 punto 1)', () => {
  test('congelada + change_start: sigue "frozen" con todas sus restricciones y muestra "Inicio autorizado: REF"', () => {
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_Q4, today: T,
      exceptions: [ex({ scope: 'change_start', change_ref: 'CHG-QA-1' })],
    });
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, RESTRICTIONS.frozen);
    assert.deepEqual(r.suppressedRestrictions, []);
    assert.deepEqual(r.appliedExceptions, []);
    assert.deepEqual(r.authorizedLabels, ['Inicio autorizado: CHG-QA-1']);
  });

  test('fila previa a C-02 sin change_ref: se muestra como inicio autorizado sin referencia', () => {
    const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, today: T, exceptions: [ex({ scope: 'change_start' })] });
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.authorizedLabels, ['Inicio autorizado: sin referencia']);
  });

  test('dos inicios puntuales vigentes: dos líneas, una por change', () => {
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_Q4, today: T,
      exceptions: [ex({ scope: 'change_start', change_ref: 'CHG-A' }), ex({ scope: 'change_start', change_ref: 'CHG-B' })],
    });
    assert.deepEqual([...r.authorizedLabels].sort(), ['Inicio autorizado: CHG-A', 'Inicio autorizado: CHG-B']);
  });

  test('inicio puntual vencido ayer o revocado hoy: sin "Inicio autorizado"', () => {
    for (const o of [{ expires_on: '2026-12-09' }, { revoked_at: '2026-12-10T15:00:00Z' }]) {
      const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, today: T, exceptions: [ex({ scope: 'change_start', change_ref: 'CHG-X', ...o })] });
      assert.equal(r.level, 'frozen');
      assert.deepEqual(r.authorizedLabels, [], JSON.stringify(o));
    }
  });

  test('inicio puntual que vence hoy: todavía autorizado', () => {
    const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, today: T, exceptions: [ex({ scope: 'change_start', change_ref: 'CHG-HOY', expires_on: T })] });
    assert.deepEqual(r.authorizedLabels, ['Inicio autorizado: CHG-HOY']);
  });

  test('inicio puntual de otra unidad no se muestra en esta', () => {
    const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, today: T, exceptions: [ex({ unit_id: OTHER, scope: 'change_start', change_ref: 'CHG-OTRA' })] });
    assert.deepEqual(r.authorizedLabels, []);
  });

  test('congelada + change_start + "todo": solo "todo" suspende; nivel "exception" sin restricciones', () => {
    const r = unitLockToday({
      unitId: U, evaluations: FROZEN_Q4, today: T,
      exceptions: [ex({ scope: 'change_start', change_ref: 'CHG-1' }), ex({ scope: 'all' })],
    });
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.restrictions, []);
  });

  test('restringida + change_start: quita solo no_new_change y no habla de "Inicio autorizado"', () => {
    const r = unitLockToday({ unitId: U, evaluations: [ev('2026-11', 'yellow')], today: T, exceptions: [ex({ scope: 'change_start', change_ref: 'CHG-R' })] });
    assert.equal(r.level, 'restricted');
    assert.deepEqual(r.restrictions, RESTRICTIONS.restricted.filter((x) => x !== 'no_new_change'));
    assert.deepEqual(r.authorizedLabels, []);
  });

  test('en verde, una excepción vigente no cambia el nivel (operación normal)', () => {
    const r = unitLockToday({ unitId: U, evaluations: [ev('2026-11', 'green')], today: T, exceptions: [ex({}), ex({ scope: 'change_start', change_ref: 'CHG-V' })] });
    assert.equal(r.level, 'normal');
    assert.deepEqual(r.restrictions, []);
    assert.deepEqual(r.authorizedLabels, []);
  });

  test('la base del cálculo nombra el cierre usado y la fecha de hoy', () => {
    const r = unitLockToday({ unitId: U, evaluations: FROZEN_Q4, today: T, exceptions: [] });
    assert.equal(r.basis, 'Según el cierre de 2026-11 y las excepciones vigentes al 2026-12-10');
  });
});

describe('QA V-08 · pureza del motor', () => {
  test('lockToday no muta las filas recibidas y es determinista', () => {
    const evals = structuredClone(FROZEN_Q4);
    const excs = [ex({ scope: 'change_start', change_ref: 'CHG-P' }), ex({ scope: 'all', expires_on: '2026-12-01' })];
    const before = structuredClone({ evals, excs });
    const a = lockToday({ unitId: U, evaluations: evals, exceptions: excs, today: T });
    const b = lockToday({ unitId: U, evaluations: evals, exceptions: excs, today: T });
    assert.deepEqual({ evals, excs }, before);
    assert.deepEqual(a, b);
  });
});

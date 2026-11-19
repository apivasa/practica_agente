import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  unitColor,
  evaluateEscalation,
  quarterOf,
  carryOver,
  RESTRICTIONS,
} from '../../engine/escalation.js';

const ASOF = '2026-03-15';
const MONTHS = ['2026-01', '2026-02', '2026-03'];
const COLORS = ['green', 'yellow', 'red', 'not_evaluated'];
const R1 = ['no_new_change', 'no_backlog_additions', 'prioritize_run'];
const R2 = ['freeze_all_change', 'all_capacity_to_run'];

/** @param {string[]} colors */
const hist = (colors) => colors.map((color, i) => ({ month: MONTHS[i], color }));

/** Todas las secuencias de longitud n sobre COLORS. */
function sequences(n) {
  if (n === 0) return [[]];
  return sequences(n - 1).flatMap((s) => COLORS.map((c) => [...s, c]));
}

/**
 * Oráculo independiente escrito a partir del texto del diseño:
 * cuenta la racha final de amarillo/rojo y decide el nivel.
 */
function expected(colors, yellowLikeRed) {
  let n = 0;
  for (let i = colors.length - 1; i >= 0 && ['yellow', 'red'].includes(colors[i]); i--) n++;
  if (n === 0) return { level: 'normal', restrictions: [], n };
  if (n === 1) return { level: 'restricted', restrictions: R1, n };
  const last = colors.at(-1);
  if (last === 'red' || yellowLikeRed) return { level: 'frozen', restrictions: R2, n };
  return { level: 'restricted', restrictions: R1, n };
}

describe('unitColor', () => {
  test('peor color gana', () => {
    assert.equal(unitColor(['green', 'yellow', 'red']), 'red');
    assert.equal(unitColor(['green', 'yellow']), 'yellow');
    assert.equal(unitColor(['yellow', 'green']), 'yellow');
    assert.equal(unitColor(['green', 'green']), 'green');
    assert.equal(unitColor(['red', 'yellow']), 'red');
  });
  test('not_evaluated se ignora', () => {
    assert.equal(unitColor(['not_evaluated', 'green']), 'green');
    assert.equal(unitColor(['not_evaluated', 'red', 'not_evaluated']), 'red');
  });
  test('todos sin evaluar o vacío → not_evaluated', () => {
    assert.equal(unitColor(['not_evaluated', 'not_evaluated']), 'not_evaluated');
    assert.equal(unitColor([]), 'not_evaluated');
  });
  test('entradas inválidas lanzan error', () => {
    assert.throws(() => unitColor(['blue']), TypeError);
    assert.throws(() => unitColor('red'), TypeError);
  });
});

describe('quarterOf', () => {
  test('meses a trimestres', () => {
    assert.equal(quarterOf('2026-01'), '2026-Q1');
    assert.equal(quarterOf('2026-03'), '2026-Q1');
    assert.equal(quarterOf('2026-04'), '2026-Q2');
    assert.equal(quarterOf('2026-09'), '2026-Q3');
    assert.equal(quarterOf('2026-10'), '2026-Q4');
    assert.equal(quarterOf('2026-12'), '2026-Q4');
  });
  test('formato inválido', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '202601', '', null, 202601]) {
      assert.throws(() => quarterOf(bad), TypeError);
    }
  });
});

describe('evaluateEscalation: tabla de verdad completa (1 a 3 meses)', () => {
  for (const flag of [false, true]) {
    for (const n of [1, 2, 3]) {
      for (const seq of sequences(n)) {
        test(`${seq.join(' → ')} | yellowLikeRed=${flag}`, () => {
          const r = evaluateEscalation(hist(seq), { yellowMonth2EscalatesLikeRed: flag, asOf: ASOF });
          const e = expected(seq, flag);
          assert.equal(r.level, e.level);
          assert.deepEqual(r.restrictions, e.restrictions);
          assert.equal(r.monthsInBreach, e.n);
          assert.equal(typeof r.reason, 'string');
          assert.ok(r.reason.length > 10);
          assert.deepEqual(r.suppressedRestrictions, []);
          assert.deepEqual(r.expiredExceptions, []);
        });
      }
    }
  }
});

describe('evaluateEscalation: casos del diseño', () => {
  const ev = (colors, opts = {}) => evaluateEscalation(hist(colors), { asOf: ASOF, ...opts });

  test('historial vacío → normal', () => {
    const r = ev([]);
    assert.equal(r.level, 'normal');
    assert.match(r.reason, /Sin meses evaluados/);
  });
  test('verde → normal', () => {
    assert.match(ev(['green']).reason, /verde/);
  });
  test('not_evaluated → normal', () => {
    const r = ev(['red', 'not_evaluated']);
    assert.equal(r.level, 'normal');
    assert.match(r.reason, /sin evaluar/);
  });
  test('mes 1 en amarillo o rojo → restricted', () => {
    for (const c of ['yellow', 'red']) {
      const r = ev([c]);
      assert.equal(r.level, 'restricted');
      assert.deepEqual(r.restrictions, R1);
      assert.match(r.reason, /Primer mes/);
    }
  });
  test('segundo mes en rojo → frozen con texto claro', () => {
    const r = ev(['red', 'red']);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, R2);
    assert.match(r.reason, /Segundo mes consecutivo/);
    assert.match(r.reason, /se frena todo el change/);
  });
  test('amarillo → rojo también congela (mes 2 en rojo)', () => {
    assert.equal(ev(['yellow', 'red']).level, 'frozen');
  });
  test('Q-03 por defecto: amarillo en mes 2 mantiene restricted', () => {
    for (const seq of [['yellow', 'yellow'], ['red', 'yellow']]) {
      const r = ev(seq);
      assert.equal(r.level, 'restricted');
      assert.match(r.reason, /se mantiene la restricción del mes 1/);
    }
  });
  test('Q-03 activado: amarillo en mes 2 congela', () => {
    for (const seq of [['yellow', 'yellow'], ['red', 'yellow']]) {
      const r = ev(seq, { yellowMonth2EscalatesLikeRed: true });
      assert.equal(r.level, 'frozen');
      assert.match(r.reason, /escalar como rojo/);
    }
  });
  test('tercer mes en rojo sigue congelado', () => {
    const r = ev(['red', 'red', 'red']);
    assert.equal(r.level, 'frozen');
    assert.equal(r.monthsInBreach, 3);
    assert.match(r.reason, /Tercer mes/);
  });
  test('volver a verde reinicia el conteo', () => {
    assert.equal(ev(['red', 'green']).level, 'normal');
    const r = ev(['red', 'green', 'red']);
    assert.equal(r.level, 'restricted');
    assert.equal(r.monthsInBreach, 1);
  });
  test('restricciones devueltas no comparten referencia con las constantes', () => {
    const r = ev(['red']);
    r.restrictions.push('x');
    assert.deepEqual([...RESTRICTIONS.restricted], R1);
  });
});

describe('evaluateEscalation: excepciones', () => {
  const ev = (colors, activeExceptions, extra = {}) =>
    evaluateEscalation(hist(colors), { asOf: ASOF, activeExceptions, ...extra });

  test('change_start vigente quita no_new_change en restricted', () => {
    const r = ev(['red'], [{ id: 'e1', scope: 'change_start', expiresOn: '2026-03-31' }]);
    assert.equal(r.level, 'restricted');
    assert.deepEqual(r.restrictions, ['no_backlog_additions', 'prioritize_run']);
    assert.deepEqual(r.suppressedRestrictions, ['no_new_change']);
    assert.deepEqual(r.appliedExceptions, ['e1']);
    assert.match(r.reason, /Excepción vigente/);
  });
  test('vence el mismo día de asOf: sigue vigente', () => {
    const r = ev(['red'], [{ id: 'e1', scope: 'change_start', expiresOn: ASOF }]);
    assert.deepEqual(r.suppressedRestrictions, ['no_new_change']);
  });
  test('change_start en frozen no cambia restricciones', () => {
    const r = ev(['red', 'red'], [{ id: 'e1', scope: 'change_start', expiresOn: '2026-03-31' }]);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, R2);
    assert.deepEqual(r.suppressedRestrictions, []);
    assert.deepEqual(r.appliedExceptions, []);
  });
  test('all vigente → exception sin restricciones', () => {
    for (const [seq, base] of [[['red'], R1], [['red', 'red'], R2]]) {
      const r = ev(seq, [{ id: 'e2', scope: 'all', expiresOn: '2026-04-30' }]);
      assert.equal(r.level, 'exception');
      assert.deepEqual(r.restrictions, []);
      assert.deepEqual(r.suppressedRestrictions, base);
      assert.deepEqual(r.appliedExceptions, ['e2']);
    }
  });
  test('all prevalece sobre change_start', () => {
    const r = ev(['yellow'], [
      { id: 'a', scope: 'change_start', expiresOn: '2026-03-31' },
      { id: 'b', scope: 'all', expiresOn: '2026-03-31' },
    ]);
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.appliedExceptions, ['b']);
  });
  test('vencidas se ignoran y se informan', () => {
    const r = ev(['red', 'red'], [
      { id: 'old1', scope: 'all', expiresOn: '2026-03-14' },
      { id: 'old2', scope: 'change_start', expiresOn: '2026-01-01' },
    ]);
    assert.equal(r.level, 'frozen');
    assert.deepEqual(r.restrictions, R2);
    assert.deepEqual(r.expiredExceptions, ['old1', 'old2']);
    assert.deepEqual(r.appliedExceptions, []);
  });
  test('mezcla vigente y vencida', () => {
    const r = ev(['red'], [
      { id: 'old', scope: 'all', expiresOn: '2026-02-01' },
      { id: 'new', scope: 'change_start', expiresOn: '2026-06-01' },
    ]);
    assert.equal(r.level, 'restricted');
    assert.deepEqual(r.expiredExceptions, ['old']);
    assert.deepEqual(r.appliedExceptions, ['new']);
  });
  test('en verde la excepción no aplica pero las vencidas se informan', () => {
    const r = ev(['green'], [
      { id: 'v', scope: 'all', expiresOn: '2026-12-31' },
      { id: 'x', scope: 'all', expiresOn: '2026-01-31' },
    ]);
    assert.equal(r.level, 'normal');
    assert.deepEqual(r.appliedExceptions, []);
    assert.deepEqual(r.expiredExceptions, ['x']);
  });
  test('excepción malformada lanza error', () => {
    assert.throws(() => ev(['red'], [{ id: 'z', scope: 'all', expiresOn: '31/03/2026' }]), TypeError);
    assert.throws(() => ev(['red'], [{ id: 'z', scope: 'other', expiresOn: '2026-03-31' }]), TypeError);
    assert.throws(() => ev(['red'], [null]), TypeError);
    assert.throws(() => ev(['red'], 'all'), TypeError);
  });
});

describe('evaluateEscalation: validación de entrada', () => {
  test('asOf obligatorio y con formato', () => {
    assert.throws(() => evaluateEscalation(hist(['red'])), TypeError);
    assert.throws(() => evaluateEscalation(hist(['red']), {}), TypeError);
    assert.throws(() => evaluateEscalation(hist(['red']), { asOf: '2026-3-1' }), TypeError);
  });
  test('history inválido', () => {
    const o = { asOf: ASOF };
    assert.throws(() => evaluateEscalation(null, o), TypeError);
    assert.throws(() => evaluateEscalation([null], o), TypeError);
    assert.throws(() => evaluateEscalation([{ month: '2026-01', color: 'blue' }], o), TypeError);
    assert.throws(() => evaluateEscalation([{ month: 'enero', color: 'red' }], o), TypeError);
    assert.throws(
      () => evaluateEscalation([...hist(['red', 'red', 'red']), { month: '2026-04', color: 'red' }], o),
      RangeError,
    );
    assert.throws(
      () => evaluateEscalation([{ month: '2026-03', color: 'red' }, { month: '2026-04', color: 'red' }], o),
      RangeError,
    );
    assert.throws(
      () => evaluateEscalation([{ month: '2026-02', color: 'red' }, { month: '2026-01', color: 'red' }], o),
      RangeError,
    );
    assert.throws(
      () => evaluateEscalation([{ month: '2026-02', color: 'red' }, { month: '2026-02', color: 'red' }], o),
      RangeError,
    );
  });
  test('H-C01-01: fechas inexistentes se rechazan en asOf y expiresOn', () => {
    for (const bad of ['2026-02-29', '2026-02-31', '2026-04-31', '2025-02-29']) {
      assert.throws(() => evaluateEscalation(hist(['red']), { asOf: bad }), TypeError);
      assert.throws(
        () => evaluateEscalation(hist(['red']), { asOf: ASOF, activeExceptions: [{ id: 'e', scope: 'all', expiresOn: bad }] }),
        TypeError,
      );
    }
    // Bisiesto válido y fin de mes válidos.
    assert.equal(evaluateEscalation([{ month: '2028-02', color: 'red' }], { asOf: '2028-02-29' }).level, 'restricted');
    assert.equal(evaluateEscalation(hist(['red']), { asOf: '2026-01-31' }).level, 'restricted');
  });
  test('H-C01-02: meses con hueco se rechazan', () => {
    assert.throws(
      () => evaluateEscalation([{ month: '2026-01', color: 'red' }, { month: '2026-03', color: 'red' }], { asOf: ASOF }),
      /hueco: falta el mes 2026-02/,
    );
  });
  test('H-C01-02: meses posteriores al mes de asOf se rechazan', () => {
    assert.throws(() => evaluateEscalation(hist(['red', 'red']), { asOf: '2026-01-31' }), /posterior a la fecha/);
    assert.equal(evaluateEscalation(hist(['red', 'red']), { asOf: '2026-02-01' }).level, 'frozen');
  });
  test('excepción sin id válido se rechaza', () => {
    for (const id of [undefined, null, '', '   ', 7, {}]) {
      assert.throws(
        () => evaluateEscalation(hist(['red']), { asOf: ASOF, activeExceptions: [{ id, scope: 'all', expiresOn: '2026-12-31' }] }),
        TypeError,
      );
    }
  });
  test('función pura: no muta la entrada', () => {
    const h = hist(['red', 'red']);
    const ex = [{ id: 'e', scope: 'all', expiresOn: '2026-03-31' }];
    const snapshot = JSON.stringify({ h, ex });
    evaluateEscalation(h, { asOf: ASOF, activeExceptions: ex });
    assert.equal(JSON.stringify({ h, ex }), snapshot);
  });
});

describe('carryOver', () => {
  test('ejemplo del diseño: 2.000 → 2.200', () => {
    const r = carryOver({ packageTotal: 2000, resolved: 1900, newCriticalByMonth: [120, 80, 50] });
    assert.equal(r.effectiveTotal, 2200);
    assert.equal(r.pendingCarry, 300 + 50);
  });
  test('todo resuelto: solo arrastra lo del mes 3', () => {
    const r = carryOver({ packageTotal: 2000, resolved: 2200, newCriticalByMonth: [100, 100, 30] });
    assert.deepEqual(r, { effectiveTotal: 2200, pendingCarry: 30 });
  });
  test('resuelto por encima del total no da arrastre negativo', () => {
    const r = carryOver({ packageTotal: 100, resolved: 500, newCriticalByMonth: [0, 0, 0] });
    assert.deepEqual(r, { effectiveTotal: 100, pendingCarry: 0 });
  });
  test('validación', () => {
    assert.throws(() => carryOver(), TypeError);
    assert.throws(() => carryOver({ packageTotal: -1, resolved: 0, newCriticalByMonth: [0, 0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 1, resolved: NaN, newCriticalByMonth: [0, 0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 1, resolved: 0, newCriticalByMonth: [0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 1, resolved: 0, newCriticalByMonth: [0, '1', 0] }), TypeError);
  });
});

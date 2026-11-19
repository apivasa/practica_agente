// Pruebas QA independientes de C-01 (motor de escalada).
// Cada caso traza a una frase de docs/diseno.md, del criterio de C-01 en
// docs/plan-maestro.md o de Q-03 en docs/pendientes-usuario.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  unitColor,
  evaluateEscalation,
  quarterOf,
  carryOver,
} from '../../engine/escalation.js';

const Q1 = ['2026-01', '2026-02', '2026-03'];
const ASOF = '2026-03-10';
const h = (colors, months = Q1) => colors.map((color, i) => ({ month: months[i], color }));
const ev = (colors, opts = {}) => evaluateEscalation(h(colors), { asOf: ASOF, ...opts });

const NO_NEW = 'no_new_change';
const NO_BACKLOG = 'no_backlog_additions';
const FREEZE = 'freeze_all_change';
const ALL_RUN = 'all_capacity_to_run';

describe('QA C-01 · diseño "Verde: operación normal"', () => {
  test('verde en cualquier mes → normal, sin restricciones', () => {
    for (const seq of [['green'], ['green', 'green'], ['green', 'green', 'green']]) {
      const r = ev(seq);
      assert.equal(r.level, 'normal');
      assert.deepEqual(r.restrictions, []);
      assert.equal(r.monthsInBreach, 0);
    }
  });
  test('trimestre sin meses evaluados → normal', () => {
    const r = evaluateEscalation([], { asOf: ASOF });
    assert.equal(r.level, 'normal');
    assert.deepEqual(r.restrictions, []);
  });
});

describe('QA C-01 · "Mes 1 en amarillo o rojo: no se inicia change nuevo ni se agrega al backlog"', () => {
  for (const color of ['yellow', 'red']) {
    test(`mes 1 en ${color} → no change nuevo y no backlog, sin congelar`, () => {
      const r = ev([color]);
      assert.equal(r.level, 'restricted');
      assert.ok(r.restrictions.includes(NO_NEW));
      assert.ok(r.restrictions.includes(NO_BACKLOG));
      assert.ok(!r.restrictions.includes(FREEZE), 'mes 1 no frena todo el change');
      assert.equal(r.monthsInBreach, 1);
      assert.match(r.reason, /change nuevo/);
    });
  }
  test('primer mes fuera de verde tras un verde también es "mes 1"', () => {
    const r = ev(['green', 'red']);
    assert.equal(r.level, 'restricted');
    assert.equal(r.monthsInBreach, 1);
  });
});

describe('QA C-01 · "Mes 2 en rojo: se frena todo el change; toda la capacidad va a resolver el RUN"', () => {
  for (const first of ['yellow', 'red']) {
    test(`${first} → rojo congela todo el change`, () => {
      const r = ev([first, 'red']);
      assert.equal(r.level, 'frozen');
      assert.ok(r.restrictions.includes(FREEZE));
      assert.ok(r.restrictions.includes(ALL_RUN));
      assert.equal(r.monthsInBreach, 2);
    });
  }
  test('tercer mes consecutivo en rojo sigue congelado', () => {
    const r = ev(['red', 'red', 'red']);
    assert.equal(r.level, 'frozen');
    assert.equal(r.monthsInBreach, 3);
  });
  test('rojo → amarillo (mejora parcial) no congela por defecto', () => {
    const r = ev(['red', 'yellow']);
    assert.equal(r.level, 'restricted');
    assert.ok(r.restrictions.includes(NO_NEW));
  });
});

describe('QA C-01 · volver a verde reinicia la racha', () => {
  test('rojo, verde, rojo → vuelve a ser mes 1 (restricted, no frozen)', () => {
    const r = ev(['red', 'green', 'red']);
    assert.equal(r.level, 'restricted');
    assert.equal(r.monthsInBreach, 1);
  });
  test('rojo, rojo, verde → normal', () => {
    const r = ev(['red', 'red', 'green']);
    assert.equal(r.level, 'normal');
    assert.deepEqual(r.restrictions, []);
  });
  test('decisión del orquestador: not_evaluated corta la racha igual que verde', () => {
    assert.equal(ev(['red', 'not_evaluated', 'red']).level, 'restricted');
    assert.equal(ev(['red', 'not_evaluated']).level, 'normal');
  });
});

describe('QA C-01 · Q-03 "amarillo en mes 2 mantiene la restricción del mes 1. Es configurable"', () => {
  test('por defecto (sin flag) amarillo en mes 2 → restricción del mes 1', () => {
    for (const first of ['yellow', 'red']) {
      const r = ev([first, 'yellow']);
      assert.equal(r.level, 'restricted');
      assert.deepEqual([...r.restrictions].sort(), [...ev(['yellow']).restrictions].sort());
    }
  });
  test('flag explícito false equivale al defecto', () => {
    assert.equal(ev(['yellow', 'yellow'], { yellowMonth2EscalatesLikeRed: false }).level, 'restricted');
  });
  test('flag true: amarillo en mes 2 escala como rojo', () => {
    const r = ev(['yellow', 'yellow'], { yellowMonth2EscalatesLikeRed: true });
    assert.equal(r.level, 'frozen');
    assert.deepEqual([...r.restrictions].sort(), [...ev(['red', 'red']).restrictions].sort());
  });
  test('flag true no afecta al mes 1 en amarillo', () => {
    assert.equal(ev(['yellow'], { yellowMonth2EscalatesLikeRed: true }).level, 'restricted');
  });
  test('flag true no afecta a verde', () => {
    assert.equal(ev(['yellow', 'green'], { yellowMonth2EscalatesLikeRed: true }).level, 'normal');
  });
});

describe('QA C-01 · tabla de verdad completa contra un modelo de referencia del diseño', () => {
  // Modelo independiente escrito desde docs/diseno.md + Q-03 + decisiones del orquestador.
  const expected = (seq, flag) => {
    let streak = 0;
    for (let i = seq.length - 1; i >= 0 && (seq[i] === 'yellow' || seq[i] === 'red'); i--) streak++;
    if (streak === 0) return 'normal';
    if (streak === 1) return 'restricted';
    const last = seq[seq.length - 1];
    return last === 'red' || flag ? 'frozen' : 'restricted';
  };
  const C = ['green', 'yellow', 'red', 'not_evaluated'];
  const seqs = [[]];
  for (let n = 1; n <= 3; n++) {
    const prev = seqs.filter((s) => s.length === n - 1);
    for (const p of prev) for (const c of C) seqs.push([...p, c]);
  }
  test(`85 secuencias x 2 valores del flag`, () => {
    assert.equal(seqs.length, 85);
    for (const flag of [false, true]) {
      for (const s of seqs) {
        const r = ev(s, { yellowMonth2EscalatesLikeRed: flag });
        assert.equal(r.level, expected(s, flag), `seq=${s.join(',')} flag=${flag}`);
        if (r.level === 'normal') assert.deepEqual(r.restrictions, []);
        if (r.level === 'restricted') {
          assert.ok(r.restrictions.includes(NO_NEW) && r.restrictions.includes(NO_BACKLOG));
        }
        if (r.level === 'frozen') assert.ok(r.restrictions.includes(FREEZE) && r.restrictions.includes(ALL_RUN));
      }
    }
  });
});

describe('QA C-01 · Excepciones "con motivo registrado, fecha de vencimiento"', () => {
  test('excepción vigente "all" en rojo mes 2 → se suspenden las restricciones', () => {
    const r = ev(['red', 'red'], { activeExceptions: [{ id: 'e1', scope: 'all', expiresOn: '2026-03-31' }] });
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.restrictions, []);
    assert.ok(r.suppressedRestrictions.includes(FREEZE));
    assert.deepEqual(r.appliedExceptions, ['e1']);
  });
  test('"arrancar algo urgente estando en rojo" (mes 1): change_start quita solo no_new_change', () => {
    const r = ev(['red'], { activeExceptions: [{ id: 'u1', scope: 'change_start', expiresOn: '2026-04-01' }] });
    assert.equal(r.level, 'restricted');
    assert.ok(!r.restrictions.includes(NO_NEW));
    assert.ok(r.restrictions.includes(NO_BACKLOG));
    assert.deepEqual(r.suppressedRestrictions, [NO_NEW]);
    assert.deepEqual(r.appliedExceptions, ['u1']);
  });
  test('vence el mismo día de la evaluación → sigue vigente', () => {
    const r = ev(['red', 'red'], { activeExceptions: [{ id: 'e1', scope: 'all', expiresOn: ASOF }] });
    assert.equal(r.level, 'exception');
    assert.deepEqual(r.expiredExceptions, []);
  });
  test('venció el día anterior → el candado vuelve y se reporta como vencida', () => {
    const r = ev(['red', 'red'], { activeExceptions: [{ id: 'e1', scope: 'all', expiresOn: '2026-03-09' }] });
    assert.equal(r.level, 'frozen');
    assert.ok(r.restrictions.includes(FREEZE));
    assert.deepEqual(r.expiredExceptions, ['e1']);
    assert.deepEqual(r.appliedExceptions, []);
  });
  test('vencimiento a fin de mes vs. evaluación el 1 del mes siguiente → vencida', () => {
    const r = evaluateEscalation(h(['red']), {
      asOf: '2026-03-01',
      activeExceptions: [{ id: 'e1', scope: 'all', expiresOn: '2026-02-28' }],
    });
    assert.equal(r.level, 'restricted');
    assert.deepEqual(r.expiredExceptions, ['e1']);
  });
  test('mezcla vigente y vencida: solo la vigente se aplica', () => {
    const r = ev(['yellow'], {
      activeExceptions: [
        { id: 'old', scope: 'all', expiresOn: '2026-01-31' },
        { id: 'new', scope: 'change_start', expiresOn: '2026-12-31' },
      ],
    });
    assert.deepEqual(r.appliedExceptions, ['new']);
    assert.deepEqual(r.expiredExceptions, ['old']);
    assert.ok(!r.restrictions.includes(NO_NEW));
  });
  test('excepción en verde no cambia el nivel normal', () => {
    const r = ev(['green'], { activeExceptions: [{ id: 'e1', scope: 'all', expiresOn: '2026-12-31' }] });
    assert.equal(r.level, 'normal');
  });
  test('excepción con fecha mal formada se rechaza (no se interpreta como vigente)', () => {
    assert.throws(() => ev(['red'], { activeExceptions: [{ id: 'x', scope: 'all', expiresOn: '31/03/2026' }] }), TypeError);
    assert.throws(() => ev(['red'], { activeExceptions: [{ id: 'x', scope: 'otro', expiresOn: '2026-03-31' }] }), TypeError);
  });
  test('asOf es obligatorio (el vencimiento depende de la fecha)', () => {
    assert.throws(() => evaluateEscalation(h(['red'])), TypeError);
    assert.throws(() => evaluateEscalation(h(['red']), { asOf: '2026-3-1' }), TypeError);
  });
});

describe('QA C-01 · "Cierre de trimestre: lo no resuelto se arrastra al paquete siguiente"', () => {
  test('ejemplo del diseño: 2.000 + P0/P1 meses 1 y 2 → 2.200', () => {
    const r = carryOver({ packageTotal: 2000, resolved: 0, newCriticalByMonth: [120, 80, 0] });
    assert.equal(r.effectiveTotal, 2200);
    assert.equal(r.pendingCarry, 2200);
  });
  test('P0/P1 del mes 3 no suben el paquete actual, pasan al siguiente', () => {
    const r = carryOver({ packageTotal: 2000, resolved: 2100, newCriticalByMonth: [120, 80, 50] });
    assert.equal(r.effectiveTotal, 2200);
    assert.equal(r.pendingCarry, 100 + 50);
  });
  test('todo resuelto: solo se arrastra lo del mes 3', () => {
    const r = carryOver({ packageTotal: 2000, resolved: 2200, newCriticalByMonth: [120, 80, 30] });
    assert.equal(r.pendingCarry, 30);
  });
  test('resuelto por encima del paquete no genera arrastre negativo', () => {
    const r = carryOver({ packageTotal: 2000, resolved: 2500, newCriticalByMonth: [0, 0, 10] });
    assert.equal(r.pendingCarry, 10);
  });
  test('entradas inválidas se rechazan', () => {
    assert.throws(() => carryOver({ packageTotal: -1, resolved: 0, newCriticalByMonth: [0, 0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 2000, resolved: NaN, newCriticalByMonth: [0, 0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 2000, resolved: 0, newCriticalByMonth: [0, 0] }), TypeError);
    assert.throws(() => carryOver(), TypeError);
  });
  test('la escalada es por trimestre: el historial no mezcla trimestres', () => {
    assert.equal(quarterOf('2026-03'), '2026-Q1');
    assert.equal(quarterOf('2026-04'), '2026-Q2');
    assert.throws(() => evaluateEscalation(h(['red', 'red'], ['2026-03', '2026-04']), { asOf: ASOF }), RangeError);
  });
  test('primer mes del trimestre nuevo empieza como mes 1', () => {
    const r = evaluateEscalation(h(['red'], ['2026-04']), { asOf: '2026-04-05' });
    assert.equal(r.level, 'restricted');
  });
});

describe('QA C-01 · color de la unidad ("calcular el color de cada unidad")', () => {
  test('peor color manda', () => {
    assert.equal(unitColor(['green', 'yellow', 'red']), 'red');
    assert.equal(unitColor(['green', 'yellow']), 'yellow');
    assert.equal(unitColor(['green']), 'green');
  });
  test('"mínimo de muestra": not_evaluated se ignora; todo sin evaluar → not_evaluated', () => {
    assert.equal(unitColor(['not_evaluated', 'green']), 'green');
    assert.equal(unitColor(['not_evaluated']), 'not_evaluated');
    assert.equal(unitColor([]), 'not_evaluated');
  });
  test('color desconocido se rechaza', () => {
    assert.throws(() => unitColor(['blue']), TypeError);
    assert.throws(() => ev(['blue']), TypeError);
  });
  test('historial desordenado, repetido o > 3 meses se rechaza', () => {
    assert.throws(() => evaluateEscalation(h(['red', 'red'], ['2026-02', '2026-01']), { asOf: ASOF }), RangeError);
    assert.throws(() => evaluateEscalation(h(['red', 'red'], ['2026-01', '2026-01']), { asOf: ASOF }), RangeError);
    assert.throws(() => evaluateEscalation(h(['red', 'red', 'red', 'red'], [...Q1, '2026-04']), { asOf: ASOF }), RangeError);
  });
});

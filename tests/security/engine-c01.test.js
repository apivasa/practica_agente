// C-01 — Pruebas de seguridad del motor de escalada (categoría 3: entradas; 5: automatizaciones).
// Objetivo: que datos manipulados no permitan evadir un candado ni aplicarlo sin motivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitColor, quarterOf, evaluateEscalation, carryOver, RESTRICTIONS, COLORS } from '../../engine/escalation.js';

const RED2 = [{ month: '2026-01', color: 'red' }, { month: '2026-02', color: 'red' }];
const ASOF = '2026-02-15';
const ev = (h, o = {}) => evaluateEscalation(h, { asOf: ASOF, ...o });

// --- Fechas de vencimiento manipuladas -------------------------------------
for (const bad of ['9999-99-99', '2026-1-5', '2026-13-01', '2026-00-10', '2026-02-00', '2026-02-32',
  '20260301', '2026/03/01', ' 2026-03-01', '2026-03-01 ', '2026-03-01T00:00', '2026-03-01\n',
  '+2026-03-01', '٢٠٢٦-٠٣-٠١', '', 'Infinity']) {
  test(`expiresOn inválido ${JSON.stringify(bad)} se rechaza (no suspende el candado)`, () => {
    assert.throws(() => ev(RED2, { activeExceptions: [{ id: 'x', scope: 'all', expiresOn: bad }] }), TypeError);
  });
}

for (const bad of [null, undefined, 20260301, new Date('2026-03-01'), { toString: () => '2999-01-01' }, ['2999-01-01']]) {
  test(`expiresOn no-string (${Object.prototype.toString.call(bad)}) se rechaza`, () => {
    assert.throws(() => ev(RED2, { activeExceptions: [{ id: 'x', scope: 'all', expiresOn: bad }] }), TypeError);
  });
}

test('asOf manipulado se rechaza (no puede retroceder el reloj con formato raro)', () => {
  for (const bad of ['2026-2-15', '0000-00-00', '2026-02-15T00:00', '', undefined, 20260215]) {
    assert.throws(() => evaluateEscalation(RED2, { asOf: bad }), TypeError);
  }
});

test('excepción vencida ayer no suspende; la que vence hoy sí (límite inclusivo)', () => {
  const r1 = ev(RED2, { activeExceptions: [{ id: 'a', scope: 'all', expiresOn: '2026-02-14' }] });
  assert.equal(r1.level, 'frozen');
  assert.deepEqual(r1.expiredExceptions, ['a']);
  const r2 = ev(RED2, { activeExceptions: [{ id: 'b', scope: 'all', expiresOn: '2026-02-15' }] });
  assert.equal(r2.level, 'exception');
});

// Hallazgo H-C01-01 (baja): fechas imposibles del calendario pasan el regex.
test('H-C01-01 (documentado): fecha imposible 2026-02-31 se acepta y cuenta como vigente el 2026-02-29/30', () => {
  const r = evaluateEscalation(RED2, { asOf: '2026-02-30', activeExceptions: [{ id: 'c', scope: 'all', expiresOn: '2026-02-31' }] });
  // Comportamiento actual: acepta. Impacto acotado: no supera el mes 2026-02 frente a un asOf real (>= 2026-03-01).
  assert.equal(r.level, 'exception');
  const real = evaluateEscalation(RED2, { asOf: '2026-03-01', activeExceptions: [{ id: 'c', scope: 'all', expiresOn: '2026-02-31' }] });
  assert.equal(real.level, 'frozen');
});

// --- Scope manipulado -------------------------------------------------------
for (const bad of ['ALL', 'All', ' all', 'all ', 'change-start', '*', '', null, undefined, ['all'], { toString: () => 'all' }, '__proto__']) {
  test(`scope desconocido ${String(bad)} se rechaza`, () => {
    assert.throws(() => ev(RED2, { activeExceptions: [{ id: 'x', scope: bad, expiresOn: '2026-12-31' }] }), TypeError);
  });
}

test('change_start no rompe un candado frozen', () => {
  const r = ev(RED2, { activeExceptions: [{ id: 'x', scope: 'change_start', expiresOn: '2026-12-31' }] });
  assert.equal(r.level, 'frozen');
  assert.deepEqual(r.restrictions, [...RESTRICTIONS.frozen]);
  assert.deepEqual(r.appliedExceptions, []);
});

test('una excepción inválida en la lista invalida todo (no se ignora en silencio)', () => {
  assert.throws(() => ev(RED2, { activeExceptions: [
    { id: 'ok', scope: 'all', expiresOn: '2026-12-31' }, { id: 'bad', scope: 'all', expiresOn: '9999-99-99' }] }), TypeError);
});

test('activeExceptions que no es arreglo se rechaza', () => {
  for (const bad of [{}, 'all', { length: 1, 0: { id: 'x', scope: 'all', expiresOn: '2026-12-31' } }]) {
    assert.throws(() => ev(RED2, { activeExceptions: bad }), TypeError);
  }
});

test('ids duplicados no alteran el nivel ni duplican efectos', () => {
  const ex = { id: 'dup', scope: 'change_start', expiresOn: '2026-12-31' };
  const r = ev([{ month: '2026-01', color: 'red' }], { activeExceptions: [ex, { ...ex }] });
  assert.equal(r.level, 'restricted');
  assert.deepEqual(r.restrictions, ['no_backlog_additions', 'prioritize_run']);
});

// --- Prototype pollution / claves __proto__ ---------------------------------
test('options con __proto__ (JSON.parse) no activa Q-03 ni excepciones', () => {
  const opts = JSON.parse('{"asOf":"2026-02-15","__proto__":{"yellowMonth2EscalatesLikeRed":true,"activeExceptions":[{"id":"p","scope":"all","expiresOn":"2999-12-31"}]}}');
  const h = [{ month: '2026-01', color: 'yellow' }, { month: '2026-02', color: 'yellow' }];
  const r = evaluateEscalation(h, opts);
  assert.equal(r.level, 'restricted');
  assert.deepEqual(r.appliedExceptions, []);
});

test('yellowMonth2EscalatesLikeRed solo se activa con true estricto', () => {
  const h = [{ month: '2026-01', color: 'yellow' }, { month: '2026-02', color: 'yellow' }];
  for (const v of ['true', 1, {}, [1]]) assert.equal(ev(h, { yellowMonth2EscalatesLikeRed: v }).level, 'restricted');
  assert.equal(ev(h, { yellowMonth2EscalatesLikeRed: true }).level, 'frozen');
});

test('colores con nombres de Object.prototype se rechazan', () => {
  for (const c of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => unitColor([c]), TypeError);
    assert.throws(() => ev([{ month: '2026-01', color: c }]), TypeError);
  }
});

test('Object.prototype contaminado no cambia el resultado', () => {
  try {
    Object.prototype.activeExceptions = [{ id: 'p', scope: 'all', expiresOn: '2999-12-31' }];
    Object.prototype.yellowMonth2EscalatesLikeRed = true;
    const h = [{ month: '2026-01', color: 'yellow' }, { month: '2026-02', color: 'yellow' }];
    const r = evaluateEscalation(h, { asOf: ASOF, activeExceptions: [], yellowMonth2EscalatesLikeRed: false });
    assert.equal(r.level, 'restricted');
  } finally {
    delete Object.prototype.activeExceptions;
    delete Object.prototype.yellowMonth2EscalatesLikeRed;
  }
});

// --- Colores manipulados ----------------------------------------------------
for (const c of ['RED', 'Red', ' red', 'red ', 'verde', 'rojo', '', null, undefined, 2, { toString: () => 'green' }]) {
  test(`color inválido ${JSON.stringify(c) ?? String(c)} se rechaza (no se trata como verde)`, () => {
    assert.throws(() => unitColor(['red', c]), TypeError);
    assert.throws(() => ev([{ month: '2026-01', color: c }]), TypeError);
  });
}

test('unitColor: un rojo no se oculta con not_evaluated ni con orden', () => {
  assert.equal(unitColor(['not_evaluated', 'red', 'green']), 'red');
  assert.equal(unitColor(['green', 'yellow', 'not_evaluated']), 'yellow');
  assert.throws(() => unitColor('red'), TypeError);
});

// --- Historial manipulado ---------------------------------------------------
test('meses fuera de orden, repetidos o de otro trimestre se rechazan', () => {
  assert.throws(() => ev([{ month: '2026-02', color: 'red' }, { month: '2026-01', color: 'green' }]), RangeError);
  assert.throws(() => ev([{ month: '2026-02', color: 'red' }, { month: '2026-02', color: 'green' }]), RangeError);
  assert.throws(() => ev([{ month: '2026-03', color: 'red' }, { month: '2026-04', color: 'green' }]), RangeError);
  assert.throws(() => ev([{ month: '2025-01', color: 'red' }, { month: '2026-01', color: 'green' }]), RangeError);
  assert.throws(() => ev([1, 2, 3, 4].map(() => ({ month: '2026-01', color: 'red' }))), RangeError);
});

test('green al final no puede ocultarse añadiendo meses falsos fuera de formato', () => {
  for (const m of ['2026-1', '2026-13', '2026-00', '26-01', '2026-01-01', ' 2026-01', '2026-01\n']) {
    assert.throws(() => ev([{ month: m, color: 'green' }]), TypeError);
  }
});

test('entradas no-objeto en history se rechazan', () => {
  for (const e of [null, 'x', 1]) assert.throws(() => ev([e]), TypeError);
  assert.throws(() => ev({ length: 0 }), TypeError);
});

// Hallazgo H-C01-02 (baja): huecos y desfase con asOf no se validan.
test('H-C01-02 (documentado): hueco de mes cuenta como consecutivo', () => {
  const r = evaluateEscalation([{ month: '2026-01', color: 'red' }, { month: '2026-03', color: 'red' }], { asOf: '2026-03-31' });
  assert.equal(r.monthsInBreach, 2); // comportamiento actual: no detecta que falta 2026-02
});

test('H-C01-02 (documentado): historial de un trimestre que no contiene asOf se acepta', () => {
  const r = evaluateEscalation(RED2, { asOf: '2026-09-01' });
  assert.equal(r.level, 'frozen'); // comportamiento actual: no verifica que history sea del trimestre de asOf
});

// --- No mutación ------------------------------------------------------------
test('evaluateEscalation no muta history, options ni excepciones', () => {
  const history = [{ month: '2026-01', color: 'red' }, { month: '2026-02', color: 'yellow' }];
  const options = { asOf: ASOF, yellowMonth2EscalatesLikeRed: true,
    activeExceptions: [{ id: 'a', scope: 'all', expiresOn: '2026-12-31' }, { id: 'b', scope: 'change_start', expiresOn: '2026-01-01' }] };
  const snapshot = structuredClone({ history, options });
  const deep = (o) => { Object.freeze(o); Object.values(o).forEach((v) => v && typeof v === 'object' && deep(v)); return o; };
  deep(history); deep(options);
  evaluateEscalation(history, options);
  assert.deepEqual({ history, options }, snapshot);
});

test('el resultado no comparte referencias con RESTRICTIONS (no se puede contaminar el catálogo)', () => {
  const r = ev([{ month: '2026-01', color: 'red' }]);
  r.restrictions.length = 0;
  assert.deepEqual([...RESTRICTIONS.restricted], ['no_new_change', 'no_backlog_additions', 'prioritize_run']);
  const r2 = ev(RED2, { activeExceptions: [{ id: 'x', scope: 'all', expiresOn: '2026-12-31' }] });
  r2.suppressedRestrictions.push('hack');
  assert.deepEqual([...RESTRICTIONS.frozen], ['freeze_all_change', 'all_capacity_to_run']);
  assert.ok(Object.isFrozen(RESTRICTIONS) && Object.isFrozen(RESTRICTIONS.frozen) && Object.isFrozen(COLORS));
});

test('quarterOf rechaza formatos raros', () => {
  for (const m of ['2026-1', '2026-13', 202601, null, '2026-01 ']) assert.throws(() => quarterOf(m), TypeError);
  assert.equal(quarterOf('2026-12'), '2026-Q4');
});

// --- carryOver ----------------------------------------------------------------
test('carryOver rechaza números manipulados y no muta la entrada', () => {
  for (const bad of [-1, NaN, Infinity, '5', null, 1n]) {
    assert.throws(() => carryOver({ packageTotal: bad, resolved: 0, newCriticalByMonth: [0, 0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 1, resolved: bad, newCriticalByMonth: [0, 0, 0] }), TypeError);
    assert.throws(() => carryOver({ packageTotal: 1, resolved: 0, newCriticalByMonth: [bad, 0, 0] }), TypeError);
  }
  assert.throws(() => carryOver({ packageTotal: 1, resolved: 0, newCriticalByMonth: [0, 0] }), TypeError);
  const input = Object.freeze({ packageTotal: 10, resolved: 20, newCriticalByMonth: Object.freeze([1, 2, 3]) });
  assert.deepEqual(carryOver(input), { effectiveTotal: 13, pendingCarry: 3 });
});

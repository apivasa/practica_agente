// QA F-16 — bajos de F-15 en scripts/health/lib.js. Cada caso traza a una frase del ítem:
// - H-F15-01: «parseApiTime exige ISO 8601 con zona (como devuelve la API de GitHub), también
//   en newerPendingRun».
// - H-F15-02: «desempate por id cuando dos completados comparten created_at».
// - H-F15-03 / QA-F15-01: «un pendiente con created_at válido y run_started_at ilegible o
//   futuro mide el atasco con created_at (compatible con qa-v04b)»; sigue sin cubrir un fallo.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, FUTURE_SKEW_MIN, assessDeploy, newerPendingRun, parseApiTime } from '../../scripts/health/lib.js';

const NOW = new Date('2027-08-02T09:30:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active' };
const ago = (m) => new Date(NOW_MS - m * MIN).toISOString();
const url = (id) => `https://github.com/apivasa/practica_agente/actions/runs/${id}`;
function r(id, created, { status = 'completed', conclusion = 'success', started, event = 'push' } = {}) {
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: created,
    run_started_at: started === undefined ? created : started,
    html_url: url(id),
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });
const MAX = DEPLOY_RULE.maxPendingMin;

describe('QA F-16 / H-F15-01: parseApiTime exige ISO 8601 con zona', () => {
  test('formatos de la API de GitHub se aceptan (Z, offset, fracción)', () => {
    assert.equal(parseApiTime('2027-08-02T09:00:00Z', NOW_MS), Date.parse('2027-08-02T09:00:00Z'));
    assert.equal(parseApiTime('2027-08-02T04:00:00-05:00', NOW_MS), Date.parse('2027-08-02T09:00:00Z'));
    assert.equal(parseApiTime('2027-08-02T09:00:00.123Z', NOW_MS), Date.parse('2027-08-02T09:00:00.123Z'));
  });

  for (const bad of [
    '1',
    'March 1 2001',
    '2027-08-02',
    '2027-08-02T09:00:00', // sin zona
    '2027-08-02 09:00:00Z', // espacio en vez de T
    '2027-08-02T09:00Z', // sin segundos
    '2027-08-02T09:00:00+0500', // offset sin dos puntos
    ' 2027-08-02T09:00:00Z', // espacio delante
    '2027-08-02T09:00:00Z ', // espacio detrás
    '2027-08-02T09:00:00Zjunk',
    'x2027-08-02T09:00:00Z',
    '2027-13-01T00:00:00Z', // cumple el patrón pero Date.parse no lo lee
    '',
  ]) {
    test(`texto no ISO con zona → NaN: ${JSON.stringify(bad)}`, () => {
      assert.ok(Number.isNaN(parseApiTime(bad, NOW_MS)));
    });
  }

  test('no-strings siguen dando NaN', () => {
    for (const v of [12, null, undefined, new Date(NOW_MS), {}]) assert.ok(Number.isNaN(parseApiTime(v, NOW_MS)));
  });

  test('el margen de futuro se mantiene con el formato válido', () => {
    const edge = new Date(NOW_MS + FUTURE_SKEW_MIN * MIN).toISOString();
    const over = new Date(NOW_MS + FUTURE_SKEW_MIN * MIN + 1000).toISOString();
    assert.ok(Number.isFinite(parseApiTime(edge, NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime(over, NOW_MS)));
  });

  test('assessDeploy: failure reciente con fecha "March 1 2001" no queda detrás de un success → fail', () => {
    const out = assess([r(9, 'March 1 2001', { conclusion: 'failure' }), r(8, ago(120))]);
    assert.equal(out.status, 'fail');
    assert.ok(out.detail.includes(url(9)), out.detail);
  });

  test('assessDeploy: success con fecha sin zona no se toma como el más reciente → fail', () => {
    const out = assess([r(9, '2027-08-02T09:29:00'), r(8, ago(10), { conclusion: 'failure' })]);
    assert.equal(out.status, 'fail');
  });

  test('newerPendingRun: pendiente con created_at no ISO no cubre el fallo', () => {
    const failed = r(1, ago(20), { conclusion: 'failure' });
    const pend = r(2, 'Aug 2 2027 09:25 UTC', { status: 'in_progress', started: ago(5) });
    assert.equal(newerPendingRun([pend, failed], failed, NOW_MS, MAX), null);
    const ok = r(3, ago(5), { status: 'in_progress' });
    assert.equal(newerPendingRun([ok, failed], failed, NOW_MS, MAX), ok);
  });

  test('newerPendingRun: fallo con created_at no ISO → null', () => {
    const failed = r(1, '1', { conclusion: 'failure' });
    assert.equal(newerPendingRun([r(2, ago(1), { status: 'queued' }), failed], failed, NOW_MS, MAX), null);
  });

  test('newerPendingRun: run_started_at no ISO no cubre (since inválido)', () => {
    const failed = r(1, ago(20), { conclusion: 'failure' });
    const pend = r(2, ago(5), { status: 'in_progress', started: '1' });
    assert.equal(newerPendingRun([pend, failed], failed, NOW_MS, MAX), null);
  });
});

describe('QA F-16 / H-F15-02: desempate por id con el mismo created_at', () => {
  const t = ago(30);

  test('repro del hallazgo: [success id 1, failure id 2] misma fecha → fail (decide el id mayor)', () => {
    const out = assess([r(1, t), r(2, t, { conclusion: 'failure' })]);
    assert.equal(out.status, 'fail');
    assert.ok(out.detail.includes(url(2)), out.detail);
  });

  test('el orden de entrada no cambia el resultado', () => {
    const a = assess([r(1, t), r(2, t, { conclusion: 'failure' })]);
    const b = assess([r(2, t, { conclusion: 'failure' }), r(1, t)]);
    assert.equal(a.status, b.status);
    assert.equal(a.detail, b.detail);
  });

  test('[failure id 1, success id 2] misma fecha → ok con el success', () => {
    for (const runs of [
      [r(1, t, { conclusion: 'failure' }), r(2, t)],
      [r(2, t), r(1, t, { conclusion: 'failure' })],
    ]) {
      const out = assess(runs);
      assert.equal(out.status, 'ok', out.detail);
      assert.ok(out.detail.includes(url(2)));
    }
  });

  test('cancelado con id mayor y mismo created_at que un failure → fail (cancelación no corrige)', () => {
    const out = assess([r(1, t, { conclusion: 'failure' }), r(2, t, { conclusion: 'cancelled' })]);
    assert.equal(out.status, 'fail');
  });

  test('la fecha manda sobre el id: id mayor pero más viejo no es el más reciente', () => {
    const out = assess([r(99, ago(60), { conclusion: 'failure' }), r(5, ago(10))]);
    assert.equal(out.status, 'ok', out.detail);
  });

  test('cadena de fallos con empate se detecta (isolatedFailure usa el orden por id)', () => {
    // failure id 3 y failure id 2 con la misma fecha; pendiente nuevo reciente: no debe dar warn.
    const out = assess([
      r(2, t, { conclusion: 'failure' }),
      r(3, t, { conclusion: 'failure' }),
      r(1, ago(90)),
      r(4, ago(2), { status: 'in_progress' }),
    ]);
    assert.equal(out.status, 'fail', out.detail);
  });
});

describe('QA F-16 / H-F15-03: atasco medido con created_at si run_started_at no sirve', () => {
  const base = () => r(1, ago(400));

  for (const [label, started] of [
    ['futuro', new Date(NOW_MS + 10 * 60 * MIN).toISOString()],
    ['ilegible', 'mañana'],
    ['sin zona', '2027-08-02T05:00:00'],
    ['número', 12],
    ['vacío', ''],
    ['null', null],
  ]) {
    test(`run_started_at ${label} + created_at viejo → fail atascado con minutos de created_at`, () => {
      const out = assess([r(2, ago(200), { status: 'in_progress', started }), base()]);
      assert.equal(out.status, 'fail', out.detail);
      assert.match(out.detail, new RegExp(`200 min en in_progress \\(máximo ${MAX}\\)`));
      assert.ok(out.detail.includes(url(2)));
    });
  }

  test('borde: created_at justo en maxPendingMin no es atasco; un minuto más sí', () => {
    assert.equal(assess([r(2, ago(MAX), { status: 'queued', started: 'x' }), base()]).status, 'ok');
    assert.equal(assess([r(2, ago(MAX + 1), { status: 'queued', started: 'x' }), base()]).status, 'fail');
  });

  test('pendiente reciente con run_started_at ilegible no atasca y no da fail por sí solo', () => {
    const out = assess([r(2, ago(5), { status: 'in_progress', started: 'x' }), base()]);
    assert.equal(out.status, 'ok', out.detail);
  });

  test('sigue sin cubrir un fallo: failure aislado + pendiente reciente con run_started_at ilegible → fail', () => {
    const out = assess([
      r(3, ago(5), { status: 'in_progress', started: 'x' }),
      r(2, ago(20), { conclusion: 'failure' }),
      base(),
    ]);
    assert.equal(out.status, 'fail', out.detail);
    assert.doesNotMatch(out.detail, /lo cubre/);
  });

  test('control: con run_started_at válido el mismo escenario sí da warn (cubre)', () => {
    const out = assess([r(3, ago(5), { status: 'in_progress' }), r(2, ago(20), { conclusion: 'failure' }), base()]);
    assert.equal(out.status, 'warn', out.detail);
  });

  test('run_started_at válido sigue mandando sobre created_at', () => {
    const out = assess([r(2, ago(300), { status: 'in_progress', started: ago(10) }), base()]);
    assert.equal(out.status, 'ok', out.detail);
  });

  test('qa-v04b: created_at inválido → se descarta aunque run_started_at sea viejo y válido', () => {
    const out = assess([r(2, 'x', { status: 'in_progress', started: ago(300) }), base()]);
    assert.equal(out.status, 'ok', out.detail);
    const none = assess([r(2, 'x', { status: 'queued', started: 'y' })]);
    assert.equal(none.status, 'ok', none.detail);
  });
});

// F-14 — pruebas del desarrollador:
// - H-F13-01: el warn de assessDeploy (fallo cubierto por un run más nuevo pendiente) solo
//   vale para un fallo aislado; una cadena de fallos consecutivos falla.
// - H-F13-02: newerPendingRun rechaza timestamps que no son texto o que están en el futuro
//   más allá de FUTURE_SKEW_MIN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOY_RULE,
  FUTURE_SKEW_MIN,
  assessDeploy,
  isolatedFailure,
  newerPendingRun,
  parseApiTime,
} from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z');
const MIN = 60_000;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const at = (offsetMin) => new Date(NOW.getTime() + offsetMin * MIN).toISOString();
function run(id, min, { status = 'completed', conclusion = 'success', started } = {}) {
  const created = at(-min);
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event: 'push',
    created_at: created,
    run_started_at: started ?? created,
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });
const queued = (id, min) => run(id, min, { status: 'queued' });
const fail = (id, min, conclusion = 'failure') => run(id, min, { conclusion });

test('H-F13-01: reproducción del hallazgo (pendiente + tres fallos) → fail', () => {
  const r = assess([queued(4, 5), fail(3, 60), fail(2, 400), fail(1, 800)]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /runs\/3/);
});

test('H-F13-01: dos fallos seguidos recientes (< maxPendingMin) con pendiente → fail', () => {
  assert.equal(assess([queued(3, 2), fail(2, 10), fail(1, 40)]).status, 'fail');
  assert.equal(assess([queued(3, 2), fail(2, 10), fail(1, 40, 'timed_out')]).status, 'fail');
});

test('H-F13-01: fallo aislado tras un success con pendiente → warn', () => {
  const r = assess([queued(3, 5), fail(2, 60), run(1, 400)]);
  assert.equal(r.status, 'warn');
  assert.match(r.detail, /H-F11-06/);
});

test('H-F13-01: los cancelados entre fallos no rompen la cadena', () => {
  assert.equal(assess([queued(4, 5), fail(3, 60), run(2, 100, { conclusion: 'cancelled' }), fail(1, 200)]).status, 'fail');
  assert.equal(assess([queued(4, 5), fail(3, 60), run(2, 100, { conclusion: 'cancelled' }), run(1, 200)]).status, 'warn');
});

test('H-F13-01: sin despliegue anterior (primer despliegue) el pendiente sigue cubriendo', () => {
  assert.equal(assess([queued(2, 5), fail(1, 60)]).status, 'warn');
});

test('isolatedFailure: casos directos', () => {
  const f = fail(2, 10);
  assert.equal(isolatedFailure([f], f), true);
  assert.equal(isolatedFailure([f, run(1, 20)], f), true);
  assert.equal(isolatedFailure([f, fail(1, 20)], f), false);
  assert.equal(isolatedFailure([run(1, 20)], f), false); // el fallo no está en la lista
  assert.equal(isolatedFailure(null, f), false);
});

test('H-F13-02: parseApiTime rechaza no-strings, vacíos, ilegibles y futuros', () => {
  const nowMs = NOW.getTime();
  for (const bad of [12, 0, null, undefined, {}, [], true, '', '   ', 'no-fecha', new Date(nowMs)]) {
    assert.ok(Number.isNaN(parseApiTime(bad, nowMs)), JSON.stringify(bad));
  }
  assert.ok(Number.isNaN(parseApiTime(at(FUTURE_SKEW_MIN + 1), nowMs)));
  assert.equal(parseApiTime(at(FUTURE_SKEW_MIN), nowMs), nowMs + FUTURE_SKEW_MIN * MIN);
  assert.equal(parseApiTime(at(-30), nowMs), nowMs - 30 * MIN);
});

test('H-F13-02: un pendiente con created_at futuro (+10 h) no cubre → fail', () => {
  const p = { ...queued(2, 0), created_at: at(600), run_started_at: at(600) };
  assert.equal(assess([p, fail(1, 60)]).status, 'fail');
  assert.equal(newerPendingRun([p], fail(1, 60), NOW.getTime(), 90), null);
});

test('H-F13-02: run_started_at futuro o numérico no cubre', () => {
  const failed = fail(1, 60);
  assert.equal(newerPendingRun([{ ...queued(2, 10), run_started_at: at(60) }], failed, NOW.getTime(), 90), null);
  assert.equal(newerPendingRun([{ ...queued(2, 10), run_started_at: NOW.getTime() }], failed, NOW.getTime(), 90), null);
});

test('H-F13-02: created_at numérico (Date.parse lo aceptaría) no cubre', () => {
  const failed = fail(1, 60);
  assert.equal(newerPendingRun([{ ...queued(2, 10), created_at: NOW.getTime() - MIN }], failed, NOW.getTime(), 90), null);
  assert.equal(newerPendingRun([queued(2, 10)], { ...failed, created_at: 12 }, NOW.getTime(), 90), null);
});

test('H-F13-02: dentro del margen de reloj (+2 min) sí cubre', () => {
  const p = { ...queued(2, 0), created_at: at(2), run_started_at: at(2) };
  assert.equal(newerPendingRun([p], fail(1, 60), NOW.getTime(), 90), p);
});

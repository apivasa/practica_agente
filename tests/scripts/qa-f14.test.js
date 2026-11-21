// F-14 — QA independiente (tester). Cada caso traza al criterio de aceptación:
//   [1] H-F13-01: "assessDeploy cubre un fallo con warn solo si el despliegue completado anterior
//       a él fue success (...); una cadena de fallos no debe quedar oculta".
//       Reproducción del hallazgo: [pendiente nuevo, failure, failure, failure] → debe ser fail.
//       Intención de H-F11-06 que se conserva: "un único fallo seguido del run que lo supera" → warn.
//   [2] H-F13-02: "newerPendingRun rechaza timestamps que no sean texto o estén en el futuro más
//       un margen".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, FUTURE_SKEW_MIN, assessDeploy, newerPendingRun } from '../../scripts/health/lib.js';

const NOW = new Date('2027-08-01T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active' };
const iso = (ms) => new Date(ms).toISOString();
const ago = (min) => iso(NOW_MS - min * MIN);
let seq = 100;
function r(minAgo, conclusion = 'success', extra = {}) {
  const id = ++seq;
  return {
    id,
    status: 'completed',
    conclusion,
    event: 'push',
    created_at: ago(minAgo),
    run_started_at: ago(minAgo),
    html_url: `https://github.com/example/runs/${id}`,
    ...extra,
  };
}
const pending = (minAgo, status = 'queued', extra = {}) => r(minAgo, null, { status, ...extra });
const assess = (runs, now = NOW) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now });

describe('QA F-14 [1] H-F13-01: cadena de fallos no queda oculta', () => {
  test('reproducción literal del hallazgo (pendiente 5 min, fallos 60/400/800) → fail', () => {
    assert.equal(assess([pending(5), r(60, 'failure'), r(400, 'failure'), r(800, 'failure')]).status, 'fail');
  });

  test('desviación del desarrollador: el fallo reciente (< maxPendingMin) sobre otro fallo no se cubre', () => {
    // Con la alternativa "o el fallo tiene menos de maxPendingMin" este caso daría warn.
    const res = assess([pending(1), r(20, 'failure'), r(30, 'failure')]);
    assert.equal(res.status, 'fail');
  });

  test('anterior en timed_out o startup_failure también es cadena → fail', () => {
    for (const c of ['timed_out', 'startup_failure', 'action_required']) {
      assert.equal(assess([pending(5), r(60, 'failure'), r(200, c)]).status, 'fail', c);
    }
  });

  test('skipped/neutral entre dos fallos no rompen la cadena → fail', () => {
    assert.equal(assess([pending(5), r(60, 'failure'), r(100, 'skipped'), r(200, 'failure')]).status, 'fail');
    assert.equal(assess([pending(5), r(60, 'failure'), r(100, 'neutral'), r(200, 'failure')]).status, 'fail');
  });

  test('varios cancelados entre fallos no rompen la cadena → fail', () => {
    const runs = [pending(5), r(60, 'failure'), r(80, 'cancelled'), r(90, 'cancelled'), r(200, 'failure')];
    assert.equal(assess(runs).status, 'fail');
  });

  test('la entrada desordenada no cambia el veredicto (se ordena por created_at)', () => {
    const runs = [r(400, 'failure'), pending(5), r(800, 'failure'), r(60, 'failure')];
    assert.equal(assess(runs).status, 'fail');
  });

  test('en el tiempo: fallo aislado → warn; cuando el pendiente también falla y llega otro → fail', () => {
    const okRun = r(500);
    const failA = r(120, 'failure');
    const runB = pending(10, 'in_progress');
    assert.equal(assess([runB, failA, okRun]).status, 'warn');
    // Siguiente corrida de salud: B terminó en failure y ya hay un C en cola.
    const failB = { ...runB, status: 'completed', conclusion: 'failure' };
    assert.equal(assess([pending(2), failB, failA, okRun]).status, 'fail');
  });

  test('un fallo de pull_request no forma cadena (solo cuentan push/workflow_dispatch) → warn', () => {
    const runs = [pending(5), r(60, 'failure'), r(100, 'failure', { event: 'pull_request' }), r(300)];
    assert.equal(assess(runs).status, 'warn');
  });

  test('un fallo de workflow_dispatch sí forma cadena con uno de push → fail', () => {
    const runs = [pending(5), r(60, 'failure'), r(100, 'failure', { event: 'workflow_dispatch' }), r(300)];
    assert.equal(assess(runs).status, 'fail');
  });

  test('H-F11-06 se conserva: fallo aislado (anterior success) con pendiente reciente → warn, aunque el fallo sea viejo', () => {
    const res = assess([pending(5), r(300, 'failure'), r(1000)]);
    assert.equal(res.status, 'warn');
    assert.match(res.detail, /H-F11-06/);
  });

  test('fallo aislado con success antes de un cancelado → warn', () => {
    assert.equal(assess([pending(5), r(60, 'failure'), r(70, 'cancelled'), r(300)]).status, 'warn');
  });

  test('fallo aislado pero el pendiente está atascado (> maxPendingMin) → fail', () => {
    assert.equal(assess([pending(DEPLOY_RULE.maxPendingMin + 5), r(DEPLOY_RULE.maxPendingMin + 10, 'failure'), r(1000)]).status, 'fail');
  });

  test('cadena sin pendiente → fail (regresión)', () => {
    assert.equal(assess([r(60, 'failure'), r(400, 'failure')]).status, 'fail');
  });

  test('success con fallos viejos detrás → ok (regresión)', () => {
    assert.equal(assess([r(10), r(60, 'failure'), r(400, 'failure')]).status, 'ok');
  });
});

describe('QA F-14 [2] H-F13-02: timestamps inválidos o futuros no cubren', () => {
  const failed = r(60, 'failure');
  const cover = (p, f = failed, max = 90) => newerPendingRun([p], f, NOW_MS, max);

  test('límite exacto: created_at = now + FUTURE_SKEW_MIN cubre; 1 ms más, no', () => {
    const edge = iso(NOW_MS + FUTURE_SKEW_MIN * MIN);
    const over = iso(NOW_MS + FUTURE_SKEW_MIN * MIN + 1);
    assert.ok(cover(pending(0, 'queued', { created_at: edge, run_started_at: edge })));
    assert.equal(cover(pending(0, 'queued', { created_at: over, run_started_at: over })), null);
  });

  test('el margen es de unos minutos (no horas): FUTURE_SKEW_MIN entre 1 y 15', () => {
    assert.ok(FUTURE_SKEW_MIN >= 1 && FUTURE_SKEW_MIN <= 15, String(FUTURE_SKEW_MIN));
  });

  test('pendiente con created_at +10 h sobre un fallo aislado → assessDeploy fail', () => {
    const t = iso(NOW_MS + 600 * MIN);
    assert.equal(assess([pending(0, 'queued', { created_at: t, run_started_at: t }), failed, r(500)]).status, 'fail');
  });

  test('created_at válido pero run_started_at futuro (+1 h) → no cubre', () => {
    assert.equal(cover(pending(10, 'in_progress', { run_started_at: iso(NOW_MS + 60 * MIN) })), null);
  });

  test('created_at del fallo en el futuro o no texto → no cubre', () => {
    const p = pending(10);
    assert.equal(cover(p, { ...failed, created_at: iso(NOW_MS + 600 * MIN) }), null);
    assert.equal(cover(p, { ...failed, created_at: NOW_MS - 60 * MIN }), null);
    assert.equal(cover(p, { ...failed, created_at: new Date(NOW_MS - 60 * MIN) }), null);
    assert.equal(cover(p, { ...failed, created_at: undefined }), null);
  });

  test('created_at del pendiente no texto (número, Date, 12) → no cubre', () => {
    for (const v of [NOW_MS - 5 * MIN, new Date(NOW_MS - 5 * MIN), 12, null]) {
      assert.equal(cover(pending(5, 'queued', { created_at: v, run_started_at: ago(5) })), null, String(v));
    }
  });

  test('run_started_at numérico → no cubre (no cae a created_at)', () => {
    assert.equal(cover(pending(5, 'queued', { run_started_at: NOW_MS - 5 * MIN })), null);
  });

  test('run_started_at null o vacío usa created_at (comportamiento previo)', () => {
    assert.ok(cover(pending(5, 'queued', { run_started_at: null })));
    assert.ok(cover(pending(5, 'queued', { run_started_at: '' })));
    assert.equal(cover(pending(95, 'queued', { run_started_at: null, created_at: ago(30) })) !== null, true);
  });

  test('cadenas ISO válidas de la API siguen funcionando (con milisegundos y con Z)', () => {
    assert.ok(cover(pending(5, 'queued', { created_at: '2027-08-01T14:55:00Z', run_started_at: '2027-08-01T14:56:00.000Z' })));
  });

  test('pendiente creado antes del fallo nunca cubre', () => {
    assert.equal(cover(pending(70)), null);
  });
});

// F-14 — Seguridad del `warn` de deploy-main tras H-F13-01 y H-F13-02
// (scripts/health/lib.js: assessDeploy, isolatedFailure, parseApiTime, newerPendingRun).
// Categoría 5 (automatizaciones): ninguna entrada de la API de Actions (timestamps
// manipulados, tipos raros, runs ausentes o nulos) puede convertir un despliegue fallido en
// `ok` o `warn`. Solo un fallo aislado (el anterior completado no cancelado fue success, o no
// hay anterior) con un run nuevo pendiente real da `warn`. Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOY_RULE,
  FUTURE_SKEW_MIN,
  assessDeploy,
  checkDeploy,
  isolatedFailure,
  newerPendingRun,
  parseApiTime,
} from '../../scripts/health/lib.js';

const NOW = new Date('2027-04-02T09:00:00Z');
const NOW_MS = NOW.getTime();
const WF = { state: 'active' };
const at = (offsetMin) => new Date(NOW_MS + offsetMin * 60_000).toISOString();
const run = (id, minAgo, extra = {}) => ({
  id,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  created_at: at(-minAgo),
  run_started_at: at(-minAgo),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  ...extra,
});
const ok = (id, m, e) => run(id, m, e);
const fail = (id, m, e) => run(id, m, { conclusion: 'failure', ...e });
const queued = (id, m, e) => run(id, m, { status: 'queued', conclusion: null, ...e });
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW }).status;

describe('F-14 · H-F13-01: una cadena de fallos no queda en warn', () => {
  test('control: fallo aislado (anterior success) + pendiente nuevo da warn', () => {
    assert.equal(assess([queued(9, 5), fail(1, 60), ok(2, 400)]), 'warn');
  });

  const chains = {
    'dos failure seguidos': [queued(9, 5), fail(1, 60), fail(2, 400)],
    'cuatro failure seguidos (repro H-F13-01)': [queued(9, 5), fail(1, 60), fail(2, 400), fail(3, 800)],
    'cancelado entre dos failure': [queued(9, 5), fail(1, 60), run(3, 200, { conclusion: 'cancelled' }), fail(2, 400)],
    'skipped/neutral entre dos failure': [
      queued(9, 5),
      fail(1, 60),
      run(3, 200, { conclusion: 'skipped' }),
      run(4, 250, { conclusion: 'neutral' }),
      fail(2, 400),
    ],
    'anterior timed_out': [queued(9, 5), fail(1, 60), run(3, 200, { conclusion: 'timed_out' })],
    'anterior startup_failure': [queued(9, 5), fail(1, 60), run(3, 200, { conclusion: 'startup_failure' })],
    'anterior con conclusion null': [queued(9, 5), fail(1, 60), run(3, 200, { conclusion: null })],
    'anterior con conclusion de tipo raro': [queued(9, 5), fail(1, 60), run(3, 200, { conclusion: ['success'] })],
    'success de otro evento no rompe la cadena': [
      queued(9, 5),
      fail(1, 60),
      ok(3, 200, { event: 'pull_request' }),
      fail(2, 400),
    ],
  };
  for (const [name, runs] of Object.entries(chains)) {
    test(`${name}: fail`, () => assert.equal(assess(runs), 'fail'));
  }

  test('isolatedFailure falla cerrado si el fallo no está en la lista', () => {
    const f = fail(1, 60);
    assert.equal(isolatedFailure([ok(2, 400)], f), false);
    assert.equal(isolatedFailure(null, f), false);
    assert.equal(isolatedFailure([], f), false);
  });
});

describe('F-14 · H-F13-02: timestamps manipulados no cubren un fallo', () => {
  const base = [fail(1, 60), ok(2, 400)];
  const cases = {
    'pendiente con created_at 10 h en el futuro': queued(9, -600),
    'pendiente con created_at justo pasado el margen': queued(9, -(FUTURE_SKEW_MIN + 1)),
    'pendiente con run_started_at en el futuro': queued(9, 5, { run_started_at: at(600) }),
    'pendiente con created_at numérico': queued(9, 5, { created_at: 12 }),
    'pendiente con created_at Date': queued(9, 5, { created_at: new Date(NOW_MS - 5 * 60_000) }),
    'pendiente con created_at objeto con toString': queued(9, 5, { created_at: { toString: () => at(-5) } }),
    'pendiente con created_at vacío': queued(9, 5, { created_at: '   ' }),
    'pendiente con run_started_at numérico': queued(9, 5, { run_started_at: 12 }),
    'pendiente con run_started_at objeto': queued(9, 5, { run_started_at: {} }),
    'pendiente con run_started_at ilegible': queued(9, 5, { run_started_at: 'mañana' }),
    'pendiente creado antes del fallo': queued(9, 100),
    'pendiente de pull_request': queued(9, 5, { event: 'pull_request' }),
    'pendiente con status desconocido': run(9, 5, { status: 'paused', conclusion: null }),
  };
  for (const [name, pend] of Object.entries(cases)) {
    test(`${name}: fail`, () => assert.equal(assess([pend, ...base]), 'fail'));
  }

  test('fallo con created_at ilegible o futuro: no se cubre', () => {
    assert.equal(assess([queued(9, 5), fail(1, 60, { created_at: 'x' }), ok(2, 400)]), 'fail');
    assert.equal(assess([queued(9, 5), fail(1, -600), ok(2, 400)]), 'fail');
  });

  test('parseApiTime: solo texto legible y no más allá de now + margen', () => {
    assert.ok(Number.isNaN(parseApiTime(12, NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime(null, NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime(undefined, NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime({}, NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime('', NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime(at(FUTURE_SKEW_MIN + 1), NOW_MS)));
    assert.ok(Number.isNaN(parseApiTime(at(-5), NaN)));
    assert.equal(parseApiTime(at(-5), NOW_MS), NOW_MS - 5 * 60_000);
  });

  test('el margen futuro queda acotado (no más de 15 min)', () => {
    assert.ok(Number.isFinite(FUTURE_SKEW_MIN) && FUTURE_SKEW_MIN > 0 && FUTURE_SKEW_MIN <= 15);
  });

  test('newerPendingRun con entradas nulas o rotas devuelve null', () => {
    assert.equal(newerPendingRun(null, fail(1, 60), NOW_MS, 30), null);
    assert.equal(newerPendingRun([null, undefined, 7, 'x'], fail(1, 60), NOW_MS, 30), null);
    assert.equal(newerPendingRun([queued(9, 5)], null, NOW_MS, 30), null);
  });
});

describe('F-14: runs ausentes o malformados fallan cerrado en checkDeploy', () => {
  const github = (runs) => ({ getWorkflow: async () => WF, listRuns: async () => runs });
  for (const [name, runs] of Object.entries({
    'entrada null en la lista': [null, fail(1, 60)],
    // Una entrada sin `event` se descarta; no puede romper la cadena de fallos que sigue.
    'entrada numérica en medio de una cadena': [7, queued(9, 5), fail(1, 60), 'x', fail(2, 400)],
  })) {
    test(`${name}: no da ok ni warn`, async () => {
      const [r] = await checkDeploy({ env: {}, github: github(runs), now: NOW });
      assert.equal(r.status, 'fail');
    });
  }
  test('listRuns que lanza: fail', async () => {
    const gh = { getWorkflow: async () => WF, listRuns: async () => { throw new Error('boom'); } };
    const [r] = await checkDeploy({ env: {}, github: gh, now: NOW });
    assert.equal(r.status, 'fail');
  });
});

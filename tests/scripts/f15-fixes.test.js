// F-15 — pruebas del desarrollador (H-F14-01): assessDeploy ordena y detecta atascos con
// parseApiTime; un completado con fecha inválida o futura no puede dar ok ni warn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, FUTURE_SKEW_MIN, assessDeploy } from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z');
const MIN = 60_000;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const at = (offsetMin) => new Date(NOW.getTime() + offsetMin * MIN).toISOString();
function run(id, min, { status = 'completed', conclusion = 'success', created, started } = {}) {
  const c = created === undefined ? at(-min) : created;
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event: 'push',
    created_at: c,
    run_started_at: started === undefined ? c : started,
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

test('H-F14-01: reproducción (success +10 h en el futuro sobre dos failure) → fail', () => {
  const r = assess([run(3, 0, { created: at(600) }), run(2, 60, { conclusion: 'failure' }), run(1, 400, { conclusion: 'failure' })]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /fecha inválida o en el futuro/);
  assert.match(r.detail, /runs\/3/);
});

test('H-F14-01: un success con fecha futura no tapa nada aunque el resto sea success', () => {
  assert.equal(assess([run(2, 0, { created: at(600) }), run(1, 60)]).status, 'fail');
});

test('H-F14-01: completado con created_at null, numérico u objeto → fail, sin depender del orden', () => {
  for (const bad of [null, '', 12, NOW.getTime(), {}, 'no-fecha']) {
    const b = run(9, 0, { created: bad, started: at(-5) });
    assert.equal(assess([b, run(1, 60)]).status, 'fail', JSON.stringify(bad));
    assert.equal(assess([run(1, 60), b]).status, 'fail', JSON.stringify(bad));
  }
});

test('H-F14-01: cancelado con fecha inválida también impide el ok/warn', () => {
  assert.equal(assess([run(2, 0, { created: at(600), conclusion: 'cancelled' }), run(1, 60)]).status, 'fail');
});

test('H-F14-01: omitido (skipped) con fecha inválida se ignora como antes', () => {
  assert.equal(assess([run(2, 0, { created: 'x', conclusion: 'skipped' }), run(1, 60)]).status, 'ok');
});

test('H-F14-01: dentro del margen de reloj (+FUTURE_SKEW_MIN) se acepta y ordena primero', () => {
  const r = assess([run(1, 60, { conclusion: 'failure' }), run(2, 0, { created: at(FUTURE_SKEW_MIN) })]);
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /runs\/2/);
});

test('H-F14-01: el orden usa fechas validadas aunque la entrada venga desordenada', () => {
  assert.equal(assess([run(1, 400), run(2, 60, { conclusion: 'failure' })]).status, 'fail');
  assert.equal(assess([run(2, 60, { conclusion: 'failure' }), run(1, 10)]).status, 'ok');
});

test('stuck: se mide con run_started_at validado; futuro o inválido no lanza ni cuenta', () => {
  const r = assess([run(2, 200, { status: 'in_progress', started: at(-120) }), run(1, 300)]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /120 min en in_progress/);
  assert.equal(assess([run(2, 200, { status: 'in_progress', started: at(600) }), run(1, 300)]).status, 'ok');
  assert.equal(assess([run(2, 200, { status: 'queued', started: 12 }), run(1, 300)]).status, 'ok');
});

test('pendiente con fecha inválida no cubre un failure → fail', () => {
  assert.equal(assess([run(2, 0, { status: 'queued', created: at(600) }), run(1, 60, { conclusion: 'failure' })]).status, 'fail');
});

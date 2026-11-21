// F-16 — pruebas del desarrollador:
// - H-F15-01: parseApiTime exige ISO 8601 con zona (API_TIME_RE).
// - H-F15-02: empate de created_at entre completados se resuelve por id (mayor = más reciente).
// - H-F15-03: pendiente con created_at válido y run_started_at ilegible/futuro mide el atasco
//   con created_at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, API_TIME_RE, assessDeploy, newerPendingRun, parseApiTime } from '../../scripts/health/lib.js';

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

test('H-F15-01: reproducción (failure con created_at "1" sobre success viejo) → fail', () => {
  const r = assess([run(2, 0, { created: '1', conclusion: 'failure' }), run(1, 120)]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /fecha inválida/);
});

test('H-F15-01: parseApiTime rechaza textos que Date.parse acepta sin ser ISO con zona', () => {
  const nowMs = NOW.getTime();
  for (const bad of ['1', 'March 1 2001', '2027-03-20', '2027-03-20T11:00:00', '2027-03-20 11:00:00Z', ' 2027-03-20T11:00:00Z', '2027-03-20T11:00:00Z ', 'Sat, 20 Mar 2027 11:00:00 GMT', '2027-03-20T11:00Z', '2027-03-20T11:00:00+0500']) {
    assert.ok(Number.isNaN(parseApiTime(bad, nowMs)), bad);
  }
  assert.equal(parseApiTime('2027-03-20T11:00:00Z', nowMs), nowMs - 60 * MIN);
  assert.equal(parseApiTime('2027-03-20T11:00:00.123Z', nowMs), nowMs - 60 * MIN + 123);
  assert.equal(parseApiTime('2027-03-20T06:00:00-05:00', nowMs), nowMs - 60 * MIN);
  assert.ok(Number.isNaN(parseApiTime('2027-13-45T99:99:99Z', nowMs)));
  assert.ok(API_TIME_RE.test('2026-11-21T12:00:00Z'));
});

test('H-F15-01: newerPendingRun no cubre con fechas no ISO', () => {
  const nowMs = NOW.getTime();
  const failed = run(1, 60, { conclusion: 'failure' });
  assert.equal(newerPendingRun([run(2, 5, { status: 'queued', created: 'March 20 2027 11:55 UTC' })], failed, nowMs, 90), null);
  assert.equal(newerPendingRun([run(2, 5, { status: 'queued' })], { ...failed, created_at: '1' }, nowMs, 90), null);
  const ok = run(2, 5, { status: 'queued' });
  assert.equal(newerPendingRun([ok], failed, nowMs, 90), ok);
});

test('H-F15-02: mismo created_at, desempata el id mayor sin importar el orden de entrada', () => {
  const t = at(-60);
  const s = run(1, 0, { created: t });
  const f = run(2, 0, { created: t, conclusion: 'failure' });
  assert.equal(assess([s, f]).status, 'fail');
  assert.equal(assess([f, s]).status, 'fail');
  const f2 = run(1, 0, { created: t, conclusion: 'failure' });
  const s2 = run(2, 0, { created: t });
  assert.equal(assess([f2, s2]).status, 'ok');
  assert.equal(assess([s2, f2]).status, 'ok');
});

test('H-F15-03: run_started_at futuro con created_at válido viejo → atascado (fail)', () => {
  const r = assess([run(2, 200, { status: 'in_progress', started: at(600) }), run(1, 300)]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /200 min en in_progress/);
});

test('H-F15-03: run_started_at ilegible con created_at reciente → ni atascado ni cubre', () => {
  assert.equal(assess([run(2, 10, { status: 'queued', started: 'x' }), run(1, 300)]).status, 'ok');
  assert.equal(assess([run(2, 10, { status: 'queued', started: 'x' }), run(1, 60, { conclusion: 'failure' })]).status, 'fail');
});

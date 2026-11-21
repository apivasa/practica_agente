// F-17 — pruebas del desarrollador:
// - H-F16-01: empate de created_at con ids no enteros seguros: nunca ok, orden total.
// - H-ARQ-F16-03: assessWorkflow valida workflow.created_at con parseApiTime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, WORKFLOW_RULES, assessDeploy, assessWorkflow } from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z');
const MIN = 60_000;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const T = new Date(NOW.getTime() - 30 * MIN).toISOString();
const run = (id, conclusion = 'success', created = T) => ({
  id,
  status: 'completed',
  conclusion,
  event: 'push',
  created_at: created,
  run_started_at: created,
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${String(id).replace(/\W/g, '')}`,
});
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

test('H-F16-01: repro (success id "1", failure id "2", misma fecha) → fail en ambos órdenes', () => {
  const s = run('1');
  const f = run('2', 'failure');
  assert.equal(assess([s, f]).status, 'fail');
  assert.equal(assess([f, s]).status, 'fail');
});

test('H-F16-01: ids no enteros seguros (decimal, > 2^53, ausente, texto) con empate → nunca ok', () => {
  for (const bad of [1.5, 2 ** 53 + 2, undefined, null, 'abc', '7']) {
    for (const other of [bad, 10, '3']) {
      for (const [sId, fId] of [[bad, other], [other, bad]]) {
        const s = run(sId);
        const f = run(fId, 'failure');
        for (const runs of [[s, f], [f, s]]) {
          assert.equal(assess(runs).status, 'fail', `${String(sId)} / ${String(fId)}`);
        }
      }
    }
  }
});

test('H-F16-01: con 3 runs mezclados el resultado no depende del orden de entrada', () => {
  const sets = [
    [run(5), run('x', 'failure'), run(3)],
    [run(5, 'failure'), run('x'), run(3)],
    [run(undefined), run(4, 'cancelled'), run(2, 'failure')],
    [run('a'), run('b', 'cancelled'), run(7)],
  ];
  for (const set of sets) {
    const outs = permutations(set).map((p) => assess(p));
    for (const o of outs) {
      assert.equal(o.status, outs[0].status);
      assert.equal(o.detail, outs[0].detail);
    }
  }
  assert.equal(assess(sets[0]).status, 'fail');
  assert.equal(assess(sets[1]).status, 'fail');
});

test('H-F16-01: ids enteros seguros siguen desempatando por id mayor', () => {
  assert.equal(assess([run(1, 'failure'), run(2)]).status, 'ok');
  assert.equal(assess([run(2), run(1, 'failure')]).status, 'ok');
  assert.equal(assess([run(1), run(2, 'failure')]).status, 'fail');
});

test('H-F16-01: sin empate de fecha el id no importa', () => {
  const older = new Date(NOW.getTime() - 90 * MIN).toISOString();
  assert.equal(assess([run('x', 'failure', older), run('y')]).status, 'ok');
});

test('H-ARQ-F16-03: workflow.created_at inválido o futuro no cuenta como reciente (fail)', () => {
  const rule = WORKFLOW_RULES.find((r) => r.check === 'seguridad-semanal');
  const recent = new Date(NOW.getTime() - 60 * MIN).toISOString();
  const base = { runs: [], now: NOW, productionEnabled: false };
  assert.equal(assessWorkflow(rule, { ...base, workflow: { state: 'active', created_at: recent } }).status, 'ok');
  for (const bad of ['1', 'March 20 2027', '2027-03-20T11:00:00', 12, null, undefined, '2027-03-21T12:00:00Z']) {
    assert.equal(assessWorkflow(rule, { ...base, workflow: { state: 'active', created_at: bad } }).status, 'fail', String(bad));
  }
});

test('H-ARQ-F16-03: mensual con created_at inválido no se salva por «creado este mes»', () => {
  const rule = WORKFLOW_RULES.find((r) => r.check === 'evaluacion-mensual');
  const base = { runs: [], now: NOW, productionEnabled: true };
  assert.equal(assessWorkflow(rule, { ...base, workflow: { state: 'active', created_at: '2027-03-05T00:00:00Z' } }).status, 'ok');
  assert.equal(assessWorkflow(rule, { ...base, workflow: { state: 'active', created_at: 'March 5 2027' } }).status, 'fail');
});

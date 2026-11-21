// F-18 — pruebas del desarrollador:
// - QA-F17-01 / H-F17-01: mismo created_at y mismo id entero seguro con distinta conclusión:
//   el no-success va primero (fail-closed, independiente del orden de entrada).
// - H-F17-02 / H-ARQ-F17-01: assessWorkflow valida el created_at de cada run con parseApiTime
//   y desempata con compareSameTime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, WORKFLOW_RULES, FUTURE_SKEW_MIN, assessDeploy, assessWorkflow } from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const T = new Date(NOW.getTime() - 30 * MIN).toISOString();
const run = (id, conclusion = 'success', created = T, event = 'push') => ({
  id,
  status: 'completed',
  conclusion,
  event,
  created_at: created,
  run_started_at: created,
  updated_at: created,
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${String(id).replace(/\W/g, '')}`,
});
const deploy = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });
const rule = (check) => WORKFLOW_RULES.find((r) => r.check === check);
const wf = (check, runs) => assessWorkflow(rule(check), { workflow: WF, runs, now: NOW, productionEnabled: false });

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

test('QA-F17-01: mismo id entero seguro, success y startup_failure → no ok en ambos órdenes', () => {
  const s = run(42, 'success');
  const f = run(42, 'startup_failure');
  assert.equal(deploy([s, f]).status, 'fail');
  assert.equal(deploy([f, s]).status, 'fail');
});

test('QA-F17-01: con id repetido, ninguna permutación da ok si hay no-success', () => {
  for (const c of ['failure', 'timed_out', 'cancelled', 'action_required']) {
    for (const p of permutations([run(7, 'success'), run(7, c), run(6, 'success')])) {
      assert.notEqual(deploy(p).status, 'ok', `${c}: ${JSON.stringify(p.map((r) => r.conclusion))}`);
    }
  }
});

test('QA-F17-01: id mayor sigue ganando sobre el desempate por conclusión (no regresión)', () => {
  assert.equal(deploy([run(5, 'failure'), run(6, 'success')]).status, 'ok');
  assert.equal(deploy([run(6, 'success'), run(5, 'failure')]).status, 'ok');
  assert.equal(deploy([run(6, 'failure'), run(5, 'success')]).status, 'fail');
});

test('H-F17-02: ci-main con success id 1 y failure id 2 en la misma fecha → fail en ambos órdenes', () => {
  const s = run(1, 'success');
  const f = run(2, 'failure');
  assert.equal(wf('ci-main', [s, f]).status, 'fail');
  assert.equal(wf('ci-main', [f, s]).status, 'fail');
  // Al revés (success más reciente por id) sí es ok.
  assert.equal(wf('ci-main', [run(2), run(1, 'failure')]).status, 'ok');
  assert.equal(wf('ci-main', [run(1, 'failure'), run(2)]).status, 'ok');
});

test('H-F17-02: ci-main con id repetido y distinta conclusión → fail', () => {
  assert.equal(wf('ci-main', [run(9), run(9, 'failure')]).status, 'fail');
  assert.equal(wf('ci-main', [run(9, 'failure'), run(9)]).status, 'fail');
});

test('H-F17-02: ci-main con ids no enteros y no-success empatado → fail (fail-closed)', () => {
  for (const p of permutations([run('1'), run('2', 'failure')])) assert.equal(wf('ci-main', p).status, 'fail');
});

test('H-F17-02: seguridad-semanal no se salta maxAgeHours con un success de fecha futura', () => {
  const old = new Date(NOW.getTime() - 10 * 24 * HOUR).toISOString();
  const future = new Date(NOW.getTime() + (FUTURE_SKEW_MIN + 1) * MIN).toISOString();
  const runs = [run(1, 'success', old, 'schedule'), run(2, 'success', future, 'schedule')];
  const r = wf('seguridad-semanal', runs);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /fecha inválida o en el futuro/);
  assert.equal(wf('seguridad-semanal', [...runs].reverse()).status, 'fail');
});

test('H-F17-02: seguridad-semanal no se salta maxAgeHours con un success de fecha ilegible', () => {
  const old = new Date(NOW.getTime() - 10 * 24 * HOUR).toISOString();
  for (const bad of ['no-es-fecha', '1', 'March 20 2027', 12, null, undefined, '2027-03-20 11:00:00']) {
    const runs = [run(1, 'success', old, 'schedule'), { ...run(2, 'success', T, 'schedule'), created_at: bad }];
    assert.equal(wf('seguridad-semanal', runs).status, 'fail', `created_at=${String(bad)}`);
  }
});

test('H-F17-02: un success solo con fecha inválida no cuenta como reciente', () => {
  assert.equal(wf('seguridad-semanal', [run(1, 'success', 'mañana', 'schedule')]).status, 'fail');
  assert.equal(wf('ci-main', [run(1, 'success', '2099-01-01T00:00:00Z')]).status, 'fail');
});

test('H-F17-02: margen de reloj tolerado (dentro de FUTURE_SKEW_MIN) sigue dando ok', () => {
  const nearFuture = new Date(NOW.getTime() + (FUTURE_SKEW_MIN - 1) * MIN).toISOString();
  assert.equal(wf('seguridad-semanal', [run(1, 'success', nearFuture, 'schedule')]).status, 'ok');
});

test('H-F17-02: runs cancelados, omitidos, pendientes o de otro evento con fecha inválida no afectan', () => {
  const ok = run(1, 'success', T, 'schedule');
  const others = [
    { ...run(2, 'cancelled', 'x', 'schedule') },
    { ...run(3, 'skipped', 'x', 'schedule') },
    { ...run(4, null, 'x', 'schedule'), status: 'in_progress' },
    run(5, 'success', 'x', 'push'),
  ];
  assert.equal(wf('seguridad-semanal', [ok, ...others]).status, 'ok');
});

test('H-F17-02: seguridad-semanal con último run válido viejo sigue fallando por antigüedad', () => {
  const old = new Date(NOW.getTime() - 9 * 24 * HOUR).toISOString();
  const r = wf('seguridad-semanal', [run(1, 'success', old, 'schedule')]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /máximo 192 h/);
});

test('H-F17-02: evaluacion-mensual con un run de fecha inválida → fail', () => {
  const r = assessWorkflow(rule('evaluacion-mensual'), {
    workflow: WF,
    runs: [run(1, 'success', '2027-03-02T12:00:00Z'), run(2, 'success', 'roto')],
    now: NOW,
    productionEnabled: true,
  });
  assert.equal(r.status, 'fail');
});

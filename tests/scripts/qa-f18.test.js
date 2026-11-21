// QA F-18 — pruebas adversariales del tester (no escribió el código).
// Trazan a docs/plan-maestro.md fila F-18:
//  (1) QA-F17-01: mismo created_at y mismo id entero con conclusiones distintas → no-success
//      primero; no da ok en ningún orden.
//  (2) H-F17-02 / H-ARQ-F17-01: assessWorkflow valida cada created_at con parseApiTime
//      (completado con fecha inválida/futura → fail) y desempata con compareSameTime.
//  (3) Encargo del orquestador: con datos reales normales los checks siguen en ok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, WORKFLOW_RULES, FUTURE_SKEW_MIN, assessDeploy, assessWorkflow } from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z'); // formato real de la API
const T = iso(NOW.getTime() - 30 * MIN);
const rule = (check) => WORKFLOW_RULES.find((r) => r.check === check);
const run = (id, conclusion = 'success', created = T, event = 'push', status = 'completed') => ({
  id,
  status,
  conclusion: status === 'completed' ? conclusion : null,
  event,
  created_at: created,
  run_started_at: created,
  updated_at: created,
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
});
const wf = (check, runs, productionEnabled = false, jobs = []) =>
  assessWorkflow(rule(check), { workflow: WF, runs, jobs, now: NOW, productionEnabled }).status;
// F-19 (QA): jobs reales del run `runId` con el paso requerido de la regla en success.
const stepJobs = (check, runId) => [
  { id: Number(runId) * 10, run_id: runId, status: 'completed', conclusion: 'success', steps: [{ name: rule(check).requiredStep, conclusion: 'success' }] },
];
const deploy = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW }).status;

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

// (1) QA-F17-01
test('QA-F18 (1): mismo id y fecha, success + cada conclusión no-success → fail en todo orden (deploy)', () => {
  for (const bad of ['failure', 'timed_out', 'startup_failure', 'action_required']) {
    for (const p of permutations([run(42, 'success'), run(42, bad)])) assert.equal(deploy(p), 'fail', bad);
  }
});

test('QA-F18 (1): mismo id repetido junto a un id menor en success → sigue fail en las 6 permutaciones', () => {
  for (const p of permutations([run(42, 'success'), run(42, 'failure'), run(41, 'success')])) assert.equal(deploy(p), 'fail');
});

test('QA-F18 (1): id mayor en success sí gana a un id menor repetido con failure (no regresión)', () => {
  for (const p of permutations([run(43, 'success'), run(42, 'failure'), run(42, 'success')])) assert.equal(deploy(p), 'ok');
});

test('QA-F18 (1): mismo id en assessWorkflow (ci-main) → fail en ambos órdenes', () => {
  for (const p of permutations([run(7, 'success'), run(7, 'failure')])) assert.equal(wf('ci-main', p), 'fail');
});

// (2) H-F17-02 / H-ARQ-F17-01
test('QA-F18 (2): ci-main [success id 1, failure id 2] empatados → fail; [failure 1, success 2] → ok', () => {
  for (const p of permutations([run(1, 'success'), run(2, 'failure')])) assert.equal(wf('ci-main', p), 'fail');
  for (const p of permutations([run(1, 'failure'), run(2, 'success')])) assert.equal(wf('ci-main', p), 'ok');
});

test('QA-F18 (2): ci-main empate con id no entero y failure → fail en todo orden', () => {
  for (const p of permutations([run(5, 'success'), run('x', 'failure'), run(undefined, 'success')])) assert.equal(wf('ci-main', p), 'fail');
});

test('QA-F18 (2): seguridad-semanal — success de fecha futura no salva un run viejo', () => {
  const old = iso(NOW.getTime() - 10 * 24 * HOUR);
  const future = iso(NOW.getTime() + 2 * HOUR);
  const runs = [run(2, 'success', future, 'schedule'), run(1, 'success', old, 'schedule')];
  for (const p of permutations(runs)) assert.equal(wf('seguridad-semanal', p), 'fail');
  // También solo: un único success futuro no cumple maxAgeHours.
  assert.equal(wf('seguridad-semanal', [run(2, 'success', future, 'schedule')]), 'fail');
});

test('QA-F18 (2): seguridad-semanal — borde FUTURE_SKEW_MIN aceptado, 1 s más → fail', () => {
  const edge = new Date(NOW.getTime() + FUTURE_SKEW_MIN * MIN).toISOString();
  const beyond = new Date(NOW.getTime() + FUTURE_SKEW_MIN * MIN + 1000).toISOString();
  assert.equal(wf('seguridad-semanal', [run(1, 'success', edge, 'schedule')]), 'ok');
  assert.equal(wf('seguridad-semanal', [run(1, 'success', beyond, 'schedule')]), 'fail');
});

test('QA-F18 (2): fechas ilegibles o fuera del formato de la API en un completado → fail en cada regla', () => {
  // at(): fija created_at tal cual (pasar undefined a run() activaría el valor por defecto).
  const at = (r, v) => ({ ...r, created_at: v });
  const bads = ['', 'nope', '2027-03-20', '2027-03-20 11:00:00Z', 'Sat, 20 Mar 2027 11:00:00 GMT', null, undefined, 12, {}, NOW];
  for (const bad of bads) {
    assert.equal(wf('seguridad-semanal', [at(run(9, 'success', T, 'schedule'), bad), run(1, 'success', T, 'schedule')]), 'fail', String(bad));
    assert.equal(wf('ci-main', [run(1, 'success'), at(run(9, 'success'), bad)]), 'fail', String(bad));
    assert.equal(wf('ritmo-diario', [at(run(9, 'success'), bad), run(1, 'success')], true), 'fail', String(bad));
    assert.equal(wf('evaluacion-mensual', [at(run(9, 'success'), bad), run(1, 'success')], true), 'fail', String(bad));
  }
});

test('QA-F18 (2): run inválido que la regla no considera (otro evento, cancelado, pendiente) no provoca fail', () => {
  const good = run(1, 'success', T, 'schedule');
  assert.equal(wf('seguridad-semanal', [good, run(9, 'success', 'nope', 'push')]), 'ok');
  assert.equal(wf('seguridad-semanal', [good, run(9, 'cancelled', 'nope', 'schedule')]), 'ok');
  assert.equal(wf('seguridad-semanal', [good, run(9, null, 'nope', 'schedule', 'in_progress')]), 'ok');
});

test('QA-F18 (2): evaluacion-mensual — success con fecha futura del mes no cuenta como cierre', () => {
  // Día 20: sin cierre válido del mes debe fallar aunque haya un success "futuro".
  const future = iso(NOW.getTime() + 3 * HOUR);
  const lastMonth = iso(Date.parse('2027-02-28T12:00:00Z'));
  assert.equal(wf('evaluacion-mensual', [run(2, 'success', future), run(1, 'success', lastMonth)], true), 'fail');
});

test('QA-F18 (2): ritmo-diario — empate success/failure con ids ordenados por id', () => {
  for (const p of permutations([run(10, 'success'), run(11, 'failure')])) assert.equal(wf('ritmo-diario', p, true), 'fail');
  for (const p of permutations([run(11, 'success'), run(10, 'failure')])) assert.equal(wf('ritmo-diario', p, true, stepJobs('ritmo-diario', 11)), 'ok');
});

test('QA-F18 (2): entrada sin runs o con elementos nulos no lanza', () => {
  assert.doesNotThrow(() => assessWorkflow(rule('ci-main'), { workflow: WF, runs: [null, undefined, run(1)], now: NOW, productionEnabled: false }));
  assert.equal(assessWorkflow(rule('ci-main'), { workflow: WF, runs: undefined, now: NOW, productionEnabled: false }).status, 'skip');
});

// (3) Sin falsos fail con datos reales normales
test('QA-F18 (3): historial realista (ISO de la API, ids enteros crecientes) → ok en todas las reglas', () => {
  const at = (h) => iso(NOW.getTime() - h * HOUR);
  let id = 11_000_000_000;
  const hist = (event, hours) => hours.map((h) => run(id++, 'success', at(h), event)).reverse();
  assert.equal(wf('ci-main', [...hist('push', [5, 3, 1]), run(id++, 'cancelled', at(0.5)), run(id++, null, at(0.1), 'push', 'in_progress')].reverse()), 'ok');
  assert.equal(wf('seguridad-semanal', hist('schedule', [24 * 14, 24 * 7, 24])), 'ok');
  // hist(...)[0] es el run más reciente (id mayor): el que juzga la regla y cuyos jobs se piden.
  const daily = hist('schedule', [48, 24, 2]);
  assert.equal(wf('ritmo-diario', daily, true, stepJobs('ritmo-diario', daily[0].id)), 'ok');
  const mail = hist('schedule', [27, 24, 3]);
  assert.equal(wf('correo-alertas', mail, true, stepJobs('correo-alertas', mail[0].id)), 'ok');
  const closeId = id++;
  assert.equal(
    wf('evaluacion-mensual', [run(closeId, 'success', '2027-03-01T05:10:00Z', 'schedule'), run(id++, 'success', '2027-02-01T05:10:00Z', 'schedule')], true, stepJobs('evaluacion-mensual', closeId)),
    'ok',
  );
  // Offsets ±hh:mm y fracciones de segundo también son formato válido.
  assert.equal(wf('ci-main', [run(id++, 'success', '2027-03-20T06:30:00-05:00'), run(id++, 'success', '2027-03-20T11:00:00.123Z')]), 'ok');
});

test('QA-F18 (3): un fallo real antiguo, seguido de un success reciente, no da falso fail', () => {
  const runs = [run(3, 'success', iso(NOW.getTime() - HOUR)), run(2, 'failure', iso(NOW.getTime() - 2 * HOUR))];
  for (const p of permutations(runs)) assert.equal(wf('ci-main', p), 'ok');
});

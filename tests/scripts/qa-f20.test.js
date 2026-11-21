// F-20 — Pruebas de QA (independientes del desarrollador) para requiredStepProblem en
// scripts/health/lib.js. Cada caso traza a un punto del criterio de aceptación:
//   (1) cada job trae run_id entero seguro igual a candidate.id; si no → fail.
//   (2) al menos una aparición del paso requerido con conclusion === 'success'.
//   (3) paso en varios jobs (matriz): TODAS las apariciones en success; si no → fail.
//   (0) el caso normal sigue en ok.
// Fixtures con la forma de GET /repos/{o}/{r}/actions/runs/{run_id}/jobs (campo jobs[]). Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_RULES, assessWorkflow, checkWorkflows } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const STEP_RULES = WORKFLOW_RULES.filter((r) => r.requiredStep);
const RUN_ID = 123;

const run = (id = RUN_ID, extra = {}) => ({
  id, status: 'completed', conclusion: 'success', event: 'schedule',
  created_at: at(-60), run_started_at: at(-60), updated_at: at(-59),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  ...extra,
});
let jobSeq = 1;
const job = (rule, conclusion = 'success', { runId = RUN_ID, name = rule.requiredStep, extraSteps = [] } = {}) => ({
  id: 9000 + jobSeq++,
  run_id: runId,
  status: 'completed',
  conclusion: 'success',
  name: `job-${jobSeq}`,
  steps: [{ name: 'Set up job', conclusion: 'success', number: 1 }, { name, conclusion, number: 2 }, ...extraSteps],
});
const jobNoStep = (runId = RUN_ID) => ({ id: 9500 + jobSeq++, run_id: runId, status: 'completed', conclusion: 'success', steps: [{ name: 'Set up job', conclusion: 'success' }] });
const assess = (rule, jobs, { runs = [run()], productionEnabled = true } = {}) =>
  assessWorkflow(rule, { workflow: WF, runs, jobs, now: NOW, productionEnabled });

for (const rule of STEP_RULES) {
  describe(`QA F-20 ${rule.check}`, () => {
    // (0)
    test('(0) caso normal: un job del candidato con el paso en success → ok', () => {
      const r = assess(rule, [job(rule)]);
      assert.equal(r.status, 'ok', r.detail);
    });
    test('(0) matriz: un job sin el paso y otro con el paso en success → ok (solo cuentan las apariciones)', () => {
      const r = assess(rule, [jobNoStep(), job(rule)]);
      assert.equal(r.status, 'ok', r.detail);
    });

    // (1)
    test('(1) run_id como texto "123" con candidate.id 123 → fail por run_id', () => {
      const r = assess(rule, [job(rule, 'success', { runId: String(RUN_ID) })]);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /run_id del último run/);
    });
    for (const [label, runId] of [['ausente', undefined], ['null', null], ['decimal', RUN_ID + 0.5], ['NaN', NaN],
      ['Infinity', Infinity], ['booleano', true], ['objeto', { id: RUN_ID }], ['otro run', RUN_ID + 1]]) {
      test(`(1) run_id ${label} → fail por run_id`, () => {
        const j = job(rule);
        if (runId === undefined) delete j.run_id; else j.run_id = runId;
        const r = assess(rule, [j]);
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /run_id del último run/);
      });
    }
    test('(1) jobs del candidato mezclados con uno de otro run → fail aunque todos estén en success', () => {
      const r = assess(rule, [job(rule), job(rule), job(rule, 'success', { runId: RUN_ID - 1 })]);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /run_id del último run/);
    });
    test('(1) null o no-objeto en la lista de jobs → fail sin lanzar', () => {
      for (const extra of [null, undefined, 'x', 7, []]) {
        const r = assess(rule, [job(rule), extra]);
        assert.equal(r.status, 'fail', JSON.stringify(extra));
        assert.match(r.detail, /run_id del último run/);
      }
    });
    test('(1) candidate.id no entero seguro → fail aunque run_id coincida', () => {
      for (const id of ['123', 12.5, 2 ** 53, null]) {
        const r = assess(rule, [job(rule, 'success', { runId: id })], { runs: [run(id)] });
        assert.equal(r.status, 'fail', String(id));
        assert.match(r.detail, /id verificable/, String(id));
      }
    });
    test('(1) candidate sin id → fail', () => {
      const { id: _omit, ...noId } = run();
      const r = assess(rule, [job(rule)], { runs: [noId] });
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /id verificable/);
    });

    // (2)
    for (const c of ['failure', 'cancelled', 'neutral', 'action_required', 'timed_out', null, undefined, '', 'SUCCESS']) {
      test(`(2) única aparición con conclusion ${JSON.stringify(c)} → fail`, () => {
        const j = job(rule);
        if (c === undefined) delete j.steps[1].conclusion; else j.steps[1].conclusion = c; // undefined = clave ausente
        const r = assess(rule, [j]);
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /no terminó en success/);
      });
    }
    test('(2) paso con nombre distinto (mayúsculas o espacio) → no aparece', () => {
      for (const name of [rule.requiredStep.toUpperCase(), `${rule.requiredStep} `]) {
        const r = assess(rule, [job(rule, 'success', { name })]);
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /no aparece/);
      }
    });

    // (3)
    for (const c of ['skipped', 'cancelled', null, 'failure']) {
      test(`(3) matriz success + ${JSON.stringify(c)} → fail con conteo`, () => {
        const r = assess(rule, [job(rule), job(rule, c), job(rule)]);
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /no terminó en success en todas sus apariciones \(1 de 3/);
        assert.match(r.detail, new RegExp(c === null ? 'sin conclusión' : c));
      });
    }
    test('(3) matriz success + skipped + cancelled → fail y lista ambas conclusiones', () => {
      const r = assess(rule, [job(rule), job(rule, 'skipped'), job(rule, 'cancelled')]);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /2 de 3: skipped, cancelled/);
    });
    test('(3) el paso repetido dentro del mismo job también cuenta como aparición', () => {
      const r = assess(rule, [job(rule, 'success', { extraSteps: [{ name: rule.requiredStep, conclusion: 'skipped' }] })]);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /1 de 2/);
    });
    test('(3) matriz con todas las apariciones skipped → mensaje omitido', () => {
      const r = assess(rule, [job(rule, 'skipped'), job(rule, 'skipped')]);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /omitido con EVALUATION_ENABLED=true/);
    });
    test('(3) matriz skipped + failure (ninguna success) → fail sin decir omitido', () => {
      const r = assess(rule, [job(rule, 'skipped'), job(rule, 'failure')]);
      assert.equal(r.status, 'fail');
      assert.doesNotMatch(r.detail, /omitido/);
      assert.match(r.detail, /2 de 2/);
    });
    test('(3) matriz de 3 jobs todos en success → ok', () => {
      assert.equal(assess(rule, [job(rule), job(rule), job(rule)]).status, 'ok');
    });

    // Fuera de alcance del paso: no debe cambiar
    test('sin producción el paso no se exige (skip), aunque los jobs vengan sin run_id', () => {
      const j = job(rule); delete j.run_id;
      assert.equal(assess(rule, [j], { productionEnabled: false }).status, 'skip');
    });
  });
}

describe('QA F-20 checkWorkflows (integración con la API simulada)', () => {
  const daily = WORKFLOW_RULES.find((r) => r.check === 'ritmo-diario');
  const gh = (listJobs) => ({
    getWorkflow: async () => WF,
    listRuns: async () => [run()],
    listJobs,
  });
  test('API devuelve jobs del candidato: ok', async () => {
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh(async (id) => [job(daily, 'success', { runId: id })]), now: NOW, rules: [daily] });
    assert.equal(out[0].status, 'ok', out[0].detail);
  });
  test('API devuelve jobs de otro run (respuesta cruzada o caché): fail', async () => {
    const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github: gh(async (id) => [job(daily, 'success', { runId: id + 1 })]), now: NOW, rules: [daily] });
    assert.equal(out[0].status, 'fail');
    assert.match(out[0].detail, /run_id del último run/);
  });
});

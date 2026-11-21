// F-20 — Pruebas del desarrollador para H-F19-01 (run_id obligatorio e igual al candidato),
// H-F19-02 (al menos una aparición en success) y QA-F19-01 (todas las apariciones en success). Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_RULES, assessWorkflow } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const STEP_RULES = WORKFLOW_RULES.filter((r) => r.requiredStep);
const run = (id) => ({
  id, status: 'completed', conclusion: 'success', event: 'schedule',
  created_at: at(-60), run_started_at: at(-60), updated_at: at(-59),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
});
const job = (rule, conclusion, runId = 7) => ({
  id: Math.floor(Math.random() * 1e6), run_id: runId,
  steps: [{ name: 'Checkout', conclusion: 'success' }, { name: rule.requiredStep, conclusion }],
});
const assess = (rule, jobs) => assessWorkflow(rule, { workflow: WF, runs: [run(7)], jobs, now: NOW, productionEnabled: true });

for (const rule of STEP_RULES) {
  describe(`F-20 ${rule.check}`, () => {
    test('caso normal: jobs del run con el paso en success → ok', () => {
      assert.equal(assess(rule, [job(rule, 'success')]).status, 'ok');
      assert.equal(assess(rule, [job(rule, 'success'), job(rule, 'success')]).status, 'ok');
    });
    test('H-F19-01: job sin run_id o con run_id no entero/distinto → fail', () => {
      const { run_id: _omit, ...noRunId } = job(rule, 'success');
      for (const jobs of [[noRunId], [job(rule, 'success', 8)], [job(rule, 'success', '7')], [job(rule, 'success', 7.5)],
        [job(rule, 'success'), job(rule, 'success', 8)], [job(rule, 'success'), null]]) {
        const r = assess(rule, jobs);
        assert.equal(r.status, 'fail', JSON.stringify(jobs));
        assert.match(r.detail, /run_id del último run/);
      }
    });
    test('H-F19-02: paso en failure, null o cancelled → fail', () => {
      for (const c of ['failure', null, 'cancelled', undefined]) {
        const r = assess(rule, [job(rule, c)]);
        assert.equal(r.status, 'fail', String(c));
        assert.match(r.detail, /no terminó en success/);
      }
    });
    test('QA-F19-01: matriz con una aparición no success → fail', () => {
      for (const c of ['skipped', 'failure', null]) {
        const r = assess(rule, [job(rule, 'success'), job(rule, c)]);
        assert.equal(r.status, 'fail', String(c));
        assert.match(r.detail, /1 de 2/);
      }
    });
    test('todas skipped mantiene el mensaje de omitido', () => {
      assert.match(assess(rule, [job(rule, 'skipped')]).detail, /omitido/);
    });
  });
}

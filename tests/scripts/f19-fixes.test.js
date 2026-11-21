// F-19 — Pruebas del desarrollador para H-F18-01 (duración validada con parseApiTime) y
// H-F18-02 (jobs del candidato elegido; paso requerido ausente o jobs vacíos → fail). Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_RULES, assessWorkflow, checkWorkflows, createGitHubClient, pickWorkflowCandidate } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const at = (offsetMin) => new Date(NOW_MS + offsetMin * MIN).toISOString();
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const RULE = Object.fromEntries(WORKFLOW_RULES.map((r) => [r.check, r]));
const STEP_RULES = WORKFLOW_RULES.filter((r) => r.requiredStep);

const run = (id, { createdMin = -60, durMin = 1, conclusion = 'success', event = 'schedule', ...extra } = {}) => ({
  id,
  status: 'completed',
  conclusion,
  event,
  created_at: at(createdMin),
  run_started_at: at(createdMin),
  updated_at: at(createdMin + durMin),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  ...extra,
});
const jobsWith = (rule, conclusion = 'success', runId) => [
  { ...(runId === undefined ? {} : { run_id: runId }), steps: [{ name: 'Checkout', conclusion: 'success' }, { name: rule.requiredStep, conclusion }] },
];
const assess = (rule, runs, jobs, productionEnabled = true) => assessWorkflow(rule, { workflow: WF, runs, jobs, now: NOW, productionEnabled });

describe('H-F18-01: duración validada con parseApiTime', () => {
  const daily = RULE['ritmo-diario'];
  test('success con updated_at ilegible no da ok (repro del hallazgo)', () => {
    const r = assess(daily, [run(1, { updated_at: 'ayer' })], jobsWith(daily));
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /duración no verificable/);
  });
  for (const [name, extra] of [
    ['updated_at ausente', { updated_at: undefined }],
    ['run_started_at ausente', { run_started_at: undefined }],
    ['updated_at null', { updated_at: null }],
    ['run_started_at numérico', { run_started_at: 12 }],
    ['updated_at sin zona', { updated_at: '2027-05-10T14:01:00' }],
    ['updated_at futuro', { updated_at: at(60) }],
    ['run_started_at futuro', { run_started_at: at(60) }],
    ['updated_at anterior a run_started_at', { updated_at: at(-120) }],
  ]) {
    test(`${name} → fail en cada regla con maxDurationMin`, () => {
      for (const rule of WORKFLOW_RULES.filter((x) => x.maxDurationMin)) {
        const r = assess(rule, [run(1, extra)], jobsWith(rule));
        assert.equal(r.status, 'fail', `${rule.check}: ${r.detail}`);
        assert.match(r.detail, /duración no verificable/);
      }
    });
  }
  test('reglas sin maxDurationMin no exigen las fechas de duración', () => {
    const r = assess(RULE['seguridad-semanal'], [run(1, { updated_at: 'x', run_started_at: undefined })], []);
    assert.equal(r.status, 'ok', r.detail);
  });
  test('duración válida dentro del máximo da ok; por encima, fail', () => {
    assert.equal(assess(daily, [run(1, { durMin: 5 })], jobsWith(daily)).status, 'ok');
    const slow = assess(daily, [run(1, { durMin: 6 })], jobsWith(daily));
    assert.equal(slow.status, 'fail');
    assert.match(slow.detail, /duró 6 min/);
  });
  test('updated_at dentro del margen de reloj (FUTURE_SKEW_MIN) se acepta', () => {
    assert.equal(assess(daily, [run(1, { createdMin: -2, durMin: 4 })], jobsWith(daily)).status, 'ok');
  });
});

describe('H-F18-02: paso requerido del candidato', () => {
  test('pickWorkflowCandidate elige el más reciente aunque la API lo dé en otro orden', () => {
    const daily = RULE['ritmo-diario'];
    const runs = [run(1, { createdMin: -24 * 60 }), run(2, { createdMin: -60 })];
    assert.equal(pickWorkflowCandidate(daily, { runs, now: NOW }).candidate.id, 2);
    assert.equal(pickWorkflowCandidate(daily, { runs: [...runs].reverse(), now: NOW }).candidate.id, 2);
  });
  test('pickWorkflowCandidate con un completado de fecha inválida: sin candidato', () => {
    const out = pickWorkflowCandidate(RULE['ritmo-diario'], { runs: [run(1), run(2, { created_at: 'x' })], now: NOW });
    assert.equal(out.candidate, null);
    assert.equal(out.invalid.length, 1);
  });

  for (const rule of STEP_RULES) {
    test(`${rule.check}: jobs vacíos con producción activa → fail`, () => {
      const r = assess(rule, [run(1)], []);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /sin jobs/);
    });
    test(`${rule.check}: paso requerido ausente (renombrado) → fail`, () => {
      const r = assess(rule, [run(1)], [{ steps: [{ name: 'Otro nombre', conclusion: 'success' }] }]);
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /no aparece/);
    });
    test(`${rule.check}: jobs de otro run (run_id distinto) → fail; del mismo → ok`, () => {
      assert.equal(assess(rule, [run(7)], jobsWith(rule, 'success', 8)).status, 'fail');
      assert.equal(assess(rule, [run(7)], jobsWith(rule, 'success', 7)).status, 'ok');
    });
    test(`${rule.check}: jobs con forma rara → fail sin lanzar`, () => {
      for (const jobs of [null, {}, 'x', [null], [{ steps: 'x' }], [{ steps: [null] }]]) {
        assert.equal(assess(rule, [run(1)], jobs).status, 'fail', JSON.stringify(jobs));
      }
    });
    test(`${rule.check}: paso presente y en success → ok; sin producción no se exige`, () => {
      assert.equal(assess(rule, [run(1)], jobsWith(rule)).status, 'ok');
      assert.equal(assess(rule, [run(1)], [], false).status, 'skip');
    });
  }

  test('ci-main y seguridad-semanal (sin requiredStep) no piden jobs', () => {
    assert.equal(assess(RULE['ci-main'], [run(1, { event: 'push' })], []).status, 'ok');
    assert.equal(assess(RULE['seguridad-semanal'], [run(1)], []).status, 'ok');
  });
});

describe('checkWorkflows usa el candidato de assessWorkflow', () => {
  const fakeGithub = ({ runsFor, jobsFor }) => {
    const calls = [];
    return {
      calls,
      getWorkflow: async () => WF,
      listRuns: async (file) => runsFor(file),
      listJobs: async (id) => (calls.push(id), jobsFor(id)),
    };
  };
  const daily = RULE['ritmo-diario'];

  test('repro QA-F18-01: [success 1 de ayer, success 2 de hoy] con Evaluar omitido solo en el 2 → no ok', async () => {
    const github = fakeGithub({
      runsFor: () => [run(1, { createdMin: -24 * 60 }), run(2, { createdMin: -60 })],
      jobsFor: (id) => jobsWith(daily, id === 2 ? 'skipped' : 'success', id),
    });
    const [r] = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules: [daily] });
    assert.deepEqual(github.calls, [2]);
    assert.notEqual(r.status, 'ok');
    assert.match(r.detail, /omitido/);
  });

  test('mismo historial con el paso presente en el candidato → ok', async () => {
    const github = fakeGithub({
      runsFor: () => [run(1, { createdMin: -24 * 60 }), run(2, { createdMin: -60 })],
      jobsFor: (id) => jobsWith(daily, id === 1 ? 'skipped' : 'success', id),
    });
    const [r] = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules: [daily] });
    assert.deepEqual(github.calls, [2]);
    assert.equal(r.status, 'ok', r.detail);
  });

  test('candidato en failure: no pide jobs y falla por la conclusión', async () => {
    const github = fakeGithub({ runsFor: () => [run(1, { createdMin: -120 }), run(2, { conclusion: 'failure' })], jobsFor: () => [] });
    const [r] = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules: [daily] });
    assert.deepEqual(github.calls, []);
    assert.equal(r.status, 'fail');
  });

  test('jobs vacíos del candidato → fail', async () => {
    const github = fakeGithub({ runsFor: () => [run(5)], jobsFor: () => [] });
    const [r] = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules: [daily] });
    assert.equal(r.status, 'fail');
  });
});

describe('createGitHubClient.listJobs', () => {
  const client = (pages) => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(new URL(url));
      const page = Number(new URL(url).searchParams.get('page'));
      return { status: 200, ok: true, json: async () => pages[page - 1] ?? { total_count: 0, jobs: [] } };
    };
    return { urls, gh: createGitHubClient({ token: 't', repo: 'o/r', fetchImpl }) };
  };
  const many = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i, steps: [] }));

  test('pide per_page=100 y una sola página si caben', async () => {
    const { urls, gh } = client([{ total_count: 2, jobs: many(2) }]);
    assert.equal((await gh.listJobs(9)).length, 2);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].pathname, '/repos/o/r/actions/runs/9/jobs');
    assert.equal(urls[0].searchParams.get('per_page'), '100');
    assert.equal(urls[0].searchParams.get('page'), '1');
  });
  test('sigue las páginas según total_count', async () => {
    const { urls, gh } = client([{ total_count: 150, jobs: many(100) }, { total_count: 150, jobs: many(50, 100) }]);
    assert.equal((await gh.listJobs(9)).length, 150);
    assert.equal(urls.length, 2);
  });
  test('respuesta sin jobs válidos → lista vacía', async () => {
    const { gh } = client([{ jobs: 'x' }]);
    assert.deepEqual(await gh.listJobs(9), []);
  });
});

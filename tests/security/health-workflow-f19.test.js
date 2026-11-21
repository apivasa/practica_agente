// F-19 — Seguridad de assessWorkflow / checkWorkflows tras H-F18-01 y H-F18-02.
// Categoría 5 (automatizaciones): con datos manipulados de la API de Actions el check de salud
// no puede dar un `ok` falso.
// - H-F18-01: maxDurationMin con run_started_at / updated_at ausentes, ilegibles, futuros,
//   de otro tipo o invertidos → fail; duración real mayor que el máximo → fail.
// - H-F18-02: checkWorkflows pide los jobs al candidato de pickWorkflowCandidate (no al primer
//   success en el orden de la API); jobs vacíos, de otro run, paso renombrado o todo skipped →
//   fail; id del candidato no entero → no se consulta y fail.
// - listJobs: per_page=100, máximo 5 páginas, total_count hostil (enorme, negativo, texto) no
//   produce bucle ni ok falso.
// Sin red: fetch y cliente de GitHub son dobles.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUTURE_SKEW_MIN,
  WORKFLOW_RULES,
  assessWorkflow,
  checkWorkflows,
  createGitHubClient,
  pickWorkflowCandidate,
} from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const at = (offsetMin) => new Date(NOW_MS + offsetMin * MIN).toISOString();
const RULE = Object.fromEntries(WORKFLOW_RULES.map((r) => [r.check, r]));
const DURATION_RULES = WORKFLOW_RULES.filter((r) => r.maxDurationMin);
const STEP_RULES = WORKFLOW_RULES.filter((r) => r.requiredStep);

const runFor = (rule, id, conclusion, extra = {}) => ({
  id,
  event: rule.event ?? 'schedule',
  status: 'completed',
  conclusion,
  created_at: at(-60),
  run_started_at: at(-60),
  updated_at: at(-59),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${String(id)}`,
  ...extra,
});
const jobsFor = (rule, runId, conclusion = 'success', extra = {}) => [
  { id: runId * 10, run_id: runId, steps: [{ name: 'Checkout', conclusion: 'success' }, { name: rule.requiredStep, conclusion }], ...extra },
];
const wf = (rule, runs, jobs, extra = {}) =>
  assessWorkflow(rule, { workflow: WF, runs, jobs, now: NOW, productionEnabled: true, ...extra }).status;

describe('H-F18-01: maxDurationMin con fechas manipuladas', () => {
  const hostile = [
    ['run_started_at ausente', { run_started_at: undefined }],
    ['updated_at ausente', { updated_at: undefined }],
    ['ambos ausentes', { run_started_at: undefined, updated_at: undefined }],
    ['run_started_at null', { run_started_at: null }],
    ['updated_at vacío', { updated_at: '' }],
    ['updated_at ilegible', { updated_at: 'ayer' }],
    ['updated_at numérico (época)', { updated_at: NOW_MS - 59 * MIN }],
    ['run_started_at como objeto', { run_started_at: { toString: () => at(-60) } }],
    ['updated_at futuro', { updated_at: at(FUTURE_SKEW_MIN + 10) }],
    ['run_started_at futuro', { run_started_at: at(FUTURE_SKEW_MIN + 10), updated_at: at(FUTURE_SKEW_MIN + 11) }],
    ['updated_at anterior a run_started_at', { run_started_at: at(-30), updated_at: at(-300) }],
    ['fecha sin zona horaria', { updated_at: '2027-05-10T14:01:00' }],
    ['fecha con mes 13', { updated_at: '2027-13-10T14:01:00Z' }],
  ];
  for (const rule of DURATION_RULES) {
    for (const [name, extra] of hostile) {
      test(`${rule.check}: ${name} → fail`, () => {
        const run = runFor(rule, 101, 'success', extra);
        assert.equal(wf(rule, [run], jobsFor(rule, 101)), 'fail');
      });
    }
    test(`${rule.check}: duración real mayor que el máximo → fail`, () => {
      const run = runFor(rule, 101, 'success', { run_started_at: at(-60), updated_at: at(-60 + rule.maxDurationMin + 2) });
      assert.equal(wf(rule, [run], jobsFor(rule, 101)), 'fail');
    });
    test(`${rule.check}: control positivo, duración válida dentro del máximo → ok`, () => {
      const run = runFor(rule, 101, 'success');
      assert.equal(wf(rule, [run], rule.requiredStep ? jobsFor(rule, 101) : []), 'ok');
    });
  }
});

describe('H-F18-02: jobs del candidato y paso requerido', () => {
  for (const rule of STEP_RULES) {
    const run = runFor(rule, 200, 'success');
    const cases = [
      ['jobs vacíos', []],
      ['jobs no es lista', { jobs: jobsFor(rule, 200) }],
      ['jobs null', null],
      ['jobs de otro run (run_id ajeno)', jobsFor(rule, 199)],
      ['run_id como texto', jobsFor(rule, 200, 'success', { run_id: '200' })],
      ['run_id null', jobsFor(rule, 200, 'success', { run_id: null })],
      ['mezcla de jobs propios y ajenos', [...jobsFor(rule, 200), ...jobsFor(rule, 199)]],
      ['paso renombrado', [{ id: 1, run_id: 200, steps: [{ name: `${rule.requiredStep} (v2)`, conclusion: 'success' }] }]],
      ['paso con mayúsculas distintas', [{ id: 1, run_id: 200, steps: [{ name: rule.requiredStep.toUpperCase(), conclusion: 'success' }] }]],
      ['steps no es lista', [{ id: 1, run_id: 200, steps: { name: rule.requiredStep, conclusion: 'success' } }]],
      ['job sin steps', [{ id: 1, run_id: 200 }]],
      ['paso skipped', jobsFor(rule, 200, 'skipped')],
      ['paso skipped en todos los jobs', [...jobsFor(rule, 200, 'skipped'), ...jobsFor(rule, 200, 'skipped')]],
    ];
    for (const [name, jobs] of cases) {
      test(`${rule.check}: ${name} → fail`, () => {
        assert.equal(wf(rule, [run], jobs), 'fail');
      });
    }
    test(`${rule.check}: control positivo, paso ejecutado en el run candidato → ok`, () => {
      assert.equal(wf(rule, [run], jobsFor(rule, 200)), 'ok');
    });
  }
});

/** Cliente de GitHub doble: registra a qué run se piden los jobs. */
function fakeGithub(runs, jobsByRun) {
  const asked = [];
  return {
    asked,
    getWorkflow: async () => WF,
    listRuns: async () => runs,
    listJobs: async (id) => {
      asked.push(id);
      return jobsByRun[id] ?? [];
    },
  };
}
const ENV = { EVALUATION_ENABLED: 'true', DEFAULT_BRANCH: 'main' };

describe('checkWorkflows: los jobs se piden al candidato, no al orden de la API', () => {
  for (const rule of STEP_RULES) {
    test(`${rule.check}: run viejo success con paso ejecutado primero en la lista, candidato con paso omitido → fail`, async () => {
      const recent = runFor(rule, 302, 'success', { created_at: at(-30), run_started_at: at(-30), updated_at: at(-29) });
      const old = runFor(rule, 301, 'success', { created_at: at(-90), run_started_at: at(-90), updated_at: at(-89) });
      const gh = fakeGithub([old, recent], { 301: jobsFor(rule, 301), 302: jobsFor(rule, 302, 'skipped') });
      const [r] = await checkWorkflows({ env: ENV, github: gh, now: NOW, rules: [rule] });
      assert.deepEqual(gh.asked, [302]);
      assert.equal(r.status, 'fail');
    });

    test(`${rule.check}: la API devuelve jobs de otro run para el candidato → fail`, async () => {
      const recent = runFor(rule, 402, 'success');
      const gh = fakeGithub([recent], { 402: jobsFor(rule, 401) });
      const [r] = await checkWorkflows({ env: ENV, github: gh, now: NOW, rules: [rule] });
      assert.equal(r.status, 'fail');
    });

    for (const [name, id] of [
      ['texto', '500'],
      ['decimal', 500.5],
      ['NaN', NaN],
      ['ausente', undefined],
      ['enorme', 2 ** 60],
    ]) {
      test(`${rule.check}: id del candidato ${name} → no se piden jobs y fail`, async () => {
        const run = runFor(rule, id, 'success');
        const gh = fakeGithub([run], {});
        const [r] = await checkWorkflows({ env: ENV, github: gh, now: NOW, rules: [rule] });
        assert.deepEqual(gh.asked, []);
        assert.equal(r.status, 'fail');
      });
    }

    test(`${rule.check}: listJobs lanza error → fail, sin excepción`, async () => {
      const run = runFor(rule, 600, 'success');
      const gh = { ...fakeGithub([run], {}), listJobs: async () => { throw new Error('HTTP 500'); } };
      const [r] = await checkWorkflows({ env: ENV, github: gh, now: NOW, rules: [rule] });
      assert.equal(r.status, 'fail');
    });

    test(`${rule.check}: candidato con created_at futuro → no se piden jobs y fail`, async () => {
      const future = runFor(rule, 701, 'success', { created_at: at(FUTURE_SKEW_MIN + 30) });
      const good = runFor(rule, 700, 'success');
      const gh = fakeGithub([good, future], { 700: jobsFor(rule, 700), 701: jobsFor(rule, 701) });
      const [r] = await checkWorkflows({ env: ENV, github: gh, now: NOW, rules: [rule] });
      assert.deepEqual(gh.asked, []);
      assert.equal(r.status, 'fail');
    });
  }

  test('pickWorkflowCandidate es pura: no reordena el arreglo recibido', () => {
    const rule = RULE['ritmo-diario'];
    const runs = [runFor(rule, 1, 'success', { created_at: at(-90) }), runFor(rule, 2, 'success', { created_at: at(-30) })];
    const before = runs.map((r) => r.id);
    const { candidate } = pickWorkflowCandidate(rule, { runs, now: NOW });
    assert.equal(candidate.id, 2);
    assert.deepEqual(runs.map((r) => r.id), before);
  });
});

/** fetch doble para listJobs: devuelve páginas según `pages(page)` y registra las URL. */
function fakeFetch(pages) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const page = Number(new URL(url).searchParams.get('page'));
    const body = pages(page);
    if (body === 404) return { ok: false, status: 404, json: async () => null, text: async () => '' };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { urls, fetchImpl };
}
const client = (fetchImpl) => createGitHubClient({ token: 'test', repo: 'apivasa/practica_agente', fetchImpl });
const mkJobs = (n, runId = 9, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i, run_id: runId, steps: [] }));

describe('listJobs: paginación acotada y total_count hostil', () => {
  test('pide per_page=100 y la URL solo lleva el id numérico', async () => {
    const { urls, fetchImpl } = fakeFetch(() => ({ total_count: 1, jobs: mkJobs(1) }));
    await client(fetchImpl).listJobs('9/../../secrets?x=');
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/actions\/runs\/NaN\/jobs\?per_page=100&page=1$/);
  });

  for (const [name, total] of [
    ['enorme', 10 ** 9],
    ['Infinity serializado como texto', 'Infinity'],
    ['negativo', -1],
    ['decimal', 150.5],
    ['ausente', undefined],
  ]) {
    test(`total_count ${name} con páginas llenas → como máximo 5 páginas`, async () => {
      const { urls, fetchImpl } = fakeFetch((p) => ({ total_count: total, jobs: mkJobs(100, 9, p * 100) }));
      const jobs = await client(fetchImpl).listJobs(9);
      assert.ok(urls.length <= 5, `páginas pedidas: ${urls.length}`);
      assert.ok(jobs.length <= 500);
    });
  }

  test('total_count=250 con páginas de 100, 100, 50 → 3 páginas y 250 jobs', async () => {
    const { urls, fetchImpl } = fakeFetch((p) => ({ total_count: 250, jobs: mkJobs(p === 3 ? 50 : 100, 9, p * 100) }));
    const jobs = await client(fetchImpl).listJobs(9);
    assert.equal(urls.length, 3);
    assert.equal(jobs.length, 250);
  });

  for (const [name, body] of [
    ['jobs objeto', { total_count: 5, jobs: { a: 1 } }],
    ['jobs texto', { total_count: 5, jobs: 'x' }],
    ['cuerpo null (404)', 404],
    ['cuerpo lista', []],
  ]) {
    test(`página con ${name} → lista vacía, sin excepción; y el check da fail`, async () => {
      const { fetchImpl } = fakeFetch(() => body);
      const jobs = await client(fetchImpl).listJobs(9);
      assert.deepEqual(jobs, []);
      const rule = RULE['ritmo-diario'];
      assert.equal(wf(rule, [runFor(rule, 9, 'success')], jobs), 'fail');
    });
  }

  test('paso requerido solo en una página posterior a la truncada → fail (nunca ok falso)', async () => {
    const rule = RULE['ritmo-diario'];
    // total_count hostil (1) corta en la página 1; el paso estaría en la 2.
    const { fetchImpl } = fakeFetch((p) =>
      p === 1
        ? { total_count: 1, jobs: mkJobs(100, 9) }
        : { total_count: 1, jobs: [{ id: 999, run_id: 9, steps: [{ name: rule.requiredStep, conclusion: 'skipped' }] }] },
    );
    const jobs = await client(fetchImpl).listJobs(9);
    assert.equal(wf(rule, [runFor(rule, 9, 'success')], jobs), 'fail');
  });
});

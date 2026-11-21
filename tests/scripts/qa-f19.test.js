// QA F-19 — pruebas adversariales del tester (no escribió el código).
// Trazan a docs/plan-maestro.md fila F-19:
//  (1) H-F18-01 / H-ARQ-F18-01: maxDurationMin valida run_started_at y updated_at del
//      candidato con parseApiTime; ilegible, futura o ausente → fail (no saltarse el control).
//  (2) H-F18-02 / QA-F18-01: checkWorkflows pide los jobs de requiredStep al candidato que
//      elige assessWorkflow (no al primer success en el orden de la API); jobs vacíos o paso
//      ausente/omitido → fail con producción activa. listJobs pagina con per_page=100.
//  (3) Encargo del orquestador: con datos realistas las 5 reglas dan ok.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_RULES, FUTURE_SKEW_MIN, assessWorkflow, checkWorkflows, createGitHubClient } from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z'); // día 20, 07:00 Guayaquil
const MIN = 60_000;
const HOUR = 60 * MIN;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z'); // formato real de la API
const rule = (check) => WORKFLOW_RULES.find((r) => r.check === check);
const PROD = { EVALUATION_ENABLED: 'true' };
const EVENT = { 'seguridad-semanal': 'schedule', 'ci-main': 'push' };

/** Run completado como lo devuelve la API: created_at = run_started_at, dura `durMin`. */
function run(id, { ageH = 2, conclusion = 'success', event = 'schedule', durMin = 1, status = 'completed' } = {}) {
  const created = NOW.getTime() - ageH * HOUR;
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: iso(created),
    run_started_at: iso(created),
    updated_at: iso(created + durMin * MIN),
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  };
}

/** Jobs reales del run `runId`: el paso requerido de la regla con `stepConclusion`. */
function jobsOf(check, runId, stepConclusion = 'success') {
  const steps = [{ name: 'Set up job', conclusion: 'success' }, { name: 'Verificar configuración', conclusion: 'success' }];
  const step = rule(check).requiredStep;
  if (step) steps.push({ name: step, conclusion: stepConclusion });
  return [{ id: runId * 10, run_id: runId, status: 'completed', conclusion: 'success', steps }];
}

const assess = (check, runs, jobs = [], productionEnabled = true) =>
  assessWorkflow(rule(check), { workflow: WF, runs, jobs, now: NOW, productionEnabled });

// ---------------------------------------------------------------------------------------------
// (1) Duración con fechas validadas
// ---------------------------------------------------------------------------------------------
describe('QA-F19 (1): maxDurationMin valida run_started_at / updated_at del candidato', () => {
  const durRules = WORKFLOW_RULES.filter((r) => r.maxDurationMin).map((r) => r.check);

  test('las reglas con duración máxima son ritmo-diario, evaluacion-mensual y correo-alertas', () => {
    assert.deepEqual(durRules.sort(), ['correo-alertas', 'evaluacion-mensual', 'ritmo-diario']);
  });

  const bads = ['', 'nope', '2027-03-20', '2027-03-20 11:00:00Z', 'Sat, 20 Mar 2027 11:00:00 GMT', null, 12, {}, NOW];
  for (const check of ['ritmo-diario', 'evaluacion-mensual', 'correo-alertas']) {
    for (const field of ['updated_at', 'run_started_at']) {
      test(`${check}: success con ${field} ilegible → fail (no se salta el control)`, () => {
        for (const bad of bads) {
          const r = { ...run(5), [field]: bad };
          const res = assess(check, [r], jobsOf(check, 5));
          assert.equal(res.status, 'fail', `${field}=${String(bad)}`);
          assert.match(res.detail, /duración no verificable/);
        }
      });
      test(`${check}: success sin ${field} → fail`, () => {
        const r = run(5);
        delete r[field];
        assert.equal(assess(check, [r], jobsOf(check, 5)).status, 'fail');
      });
    }
    test(`${check}: updated_at en el futuro (> ${FUTURE_SKEW_MIN} min) → fail`, () => {
      const r = { ...run(5), updated_at: iso(NOW.getTime() + 3 * HOUR) };
      assert.equal(assess(check, [r], jobsOf(check, 5)).status, 'fail');
    });
    test(`${check}: updated_at anterior a run_started_at → fail`, () => {
      const r = run(5);
      r.updated_at = iso(Date.parse(r.run_started_at) - MIN);
      assert.equal(assess(check, [r], jobsOf(check, 5)).status, 'fail');
    });
    test(`${check}: duración máxima exacta ok; +1 s falla`, () => {
      const max = rule(check).maxDurationMin;
      const r = run(5);
      r.updated_at = iso(Date.parse(r.run_started_at) + max * MIN);
      assert.equal(assess(check, [r], jobsOf(check, 5)).status, 'ok');
      r.updated_at = iso(Date.parse(r.run_started_at) + max * MIN + 1000);
      assert.equal(assess(check, [r], jobsOf(check, 5)).status, 'fail');
    });
  }

  test('borde del reloj: updated_at a FUTURE_SKEW_MIN en el futuro se acepta; 1 s más → fail', () => {
    const edge = NOW.getTime() + FUTURE_SKEW_MIN * MIN;
    const ok = { ...run(5, { ageH: 0 }), run_started_at: iso(edge - 2 * MIN), updated_at: iso(edge) };
    assert.equal(assess('ritmo-diario', [ok], jobsOf('ritmo-diario', 5)).status, 'ok');
    const beyond = { ...ok, updated_at: iso(edge + 1000) };
    assert.equal(assess('ritmo-diario', [beyond], jobsOf('ritmo-diario', 5)).status, 'fail');
  });

  test('solo cuentan las fechas del candidato: un run anterior con updated_at ilegible no da fail', () => {
    const old = { ...run(4, { ageH: 20 }), updated_at: 'nope', run_started_at: null };
    assert.equal(assess('ritmo-diario', [old, run(5)], jobsOf('ritmo-diario', 5)).status, 'ok');
  });

  test('reglas sin duración máxima (seguridad-semanal, ci-main) no se ven afectadas', () => {
    for (const check of ['seguridad-semanal', 'ci-main']) {
      const r = { ...run(5, { event: EVENT[check] }), updated_at: 'nope', run_started_at: undefined };
      assert.equal(assess(check, [r]).status, 'ok', check);
    }
  });

  test('producción inactiva: ritmo-diario se omite aunque las fechas sean ilegibles', () => {
    const r = { ...run(5), updated_at: 'nope' };
    assert.equal(assess('ritmo-diario', [r], [], false).status, 'skip');
  });
});

// ---------------------------------------------------------------------------------------------
// (2) Jobs del candidato y paso requerido
// ---------------------------------------------------------------------------------------------
describe('QA-F19 (2): assessWorkflow exige el paso requerido en los jobs del candidato', () => {
  for (const check of ['ritmo-diario', 'evaluacion-mensual', 'correo-alertas']) {
    test(`${check}: jobs vacíos con producción activa → fail`, () => {
      const res = assess(check, [run(5)], []);
      assert.equal(res.status, 'fail');
      assert.match(res.detail, /sin jobs/);
    });
    test(`${check}: paso requerido ausente (renombrado) → fail`, () => {
      const jobs = [{ id: 50, run_id: 5, steps: [{ name: 'Otro paso', conclusion: 'success' }] }];
      assert.equal(assess(check, [run(5)], jobs).status, 'fail');
    });
    test(`${check}: paso requerido omitido (skipped) → fail`, () => {
      assert.equal(assess(check, [run(5)], jobsOf(check, 5, 'skipped')).status, 'fail');
    });
    test(`${check}: jobs de otro run → fail`, () => {
      assert.equal(assess(check, [run(5)], jobsOf(check, 4)).status, 'fail');
    });
    test(`${check}: job sin steps o null no lanza y falla`, () => {
      assert.equal(assess(check, [run(5)], [{ id: 1, run_id: 5 }, null]).status, 'fail');
    });
  }

  test('correo-alertas con el paso de otra regla («Evaluar») → fail', () => {
    assert.equal(assess('correo-alertas', [run(5)], jobsOf('ritmo-diario', 5)).status, 'fail');
  });

  test('ritmo-diario con el paso de correo-alertas («Enviar correos») → fail', () => {
    assert.equal(assess('ritmo-diario', [run(5)], jobsOf('correo-alertas', 5)).status, 'fail');
  });

  test('producción inactiva: sin jobs no hay fallo por paso (las reglas se omiten)', () => {
    for (const check of ['ritmo-diario', 'evaluacion-mensual', 'correo-alertas']) assert.equal(assess(check, [run(5)], [], false).status, 'skip', check);
  });
});

/** Cliente simulado: runs por archivo en el orden dado y jobs por run_id. */
function fakeGitHub({ runsByFile, jobsByRun = {}, calls = [], failJobs = false }) {
  return {
    getWorkflow: async (file) => (file in runsByFile ? WF : null),
    listRuns: async (file, { event } = {}) => (runsByFile[file] ?? []).filter((r) => !event || r.event === event),
    listJobs: async (id) => {
      calls.push(id);
      if (failJobs) throw new Error('GitHub GET /actions/runs/x/jobs: HTTP 502');
      return jobsByRun[id] ?? [];
    },
  };
}
const byCheck = (results) => Object.fromEntries(results.map((r) => [r.check, r]));
const only = (check) => [rule(check)];

describe('QA-F19 (2): checkWorkflows pide los jobs del candidato elegido', () => {
  test('API desordenada: success viejo primero, success nuevo después → jobs del nuevo', async () => {
    const calls = [];
    const runs = [run(1, { ageH: 20 }), run(2, { ageH: 2 })];
    const github = fakeGitHub({ runsByFile: { 'ritmo-diario.yml': runs }, jobsByRun: { 1: jobsOf('ritmo-diario', 1), 2: jobsOf('ritmo-diario', 2) }, calls });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('ritmo-diario') });
    assert.deepEqual(calls, [2]);
    assert.equal(r.status, 'ok');
  });

  test('el nuevo omitió «Evaluar» y el viejo no: falla (antes se miraba el primer success de la API)', async () => {
    const runs = [run(1, { ageH: 20 }), run(2, { ageH: 2 })];
    const github = fakeGitHub({ runsByFile: { 'ritmo-diario.yml': runs }, jobsByRun: { 1: jobsOf('ritmo-diario', 1), 2: jobsOf('ritmo-diario', 2, 'skipped') } });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('ritmo-diario') });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /omitido/);
  });

  test('candidato en failure: no se piden jobs de un success anterior y el check falla', async () => {
    const calls = [];
    const runs = [run(1, { ageH: 20 }), run(2, { ageH: 2, conclusion: 'failure' })];
    const github = fakeGitHub({ runsByFile: { 'ritmo-diario.yml': runs }, jobsByRun: { 1: jobsOf('ritmo-diario', 1) }, calls });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('ritmo-diario') });
    assert.deepEqual(calls, []);
    assert.equal(r.status, 'fail');
  });

  test('un cancelado más reciente no es el candidato: jobs del success anterior', async () => {
    const calls = [];
    const runs = [run(3, { ageH: 1, conclusion: 'cancelled' }), run(2, { ageH: 3 })];
    const github = fakeGitHub({ runsByFile: { 'correo-alertas.yml': runs }, jobsByRun: { 2: jobsOf('correo-alertas', 2) }, calls });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('correo-alertas') });
    assert.deepEqual(calls, [2]);
    assert.equal(r.status, 'ok');
  });

  test('mensual: jobs del cierre del mes en curso, no de uno del mes anterior listado antes', async () => {
    const calls = [];
    const prev = { ...run(8), created_at: '2027-02-01T05:10:00Z', run_started_at: '2027-02-01T05:10:00Z', updated_at: '2027-02-01T05:11:00Z' };
    const cur = { ...run(9), created_at: '2027-03-01T05:10:00Z', run_started_at: '2027-03-01T05:10:00Z', updated_at: '2027-03-01T05:11:00Z' };
    const github = fakeGitHub({ runsByFile: { 'evaluacion-mensual.yml': [prev, cur] }, jobsByRun: { 8: jobsOf('evaluacion-mensual', 8), 9: jobsOf('evaluacion-mensual', 9) }, calls });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('evaluacion-mensual') });
    assert.deepEqual(calls, [9]);
    assert.equal(r.status, 'ok');
  });

  test('la API devuelve jobs vacíos para el candidato → fail', async () => {
    const github = fakeGitHub({ runsByFile: { 'correo-alertas.yml': [run(2)] } });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('correo-alertas') });
    assert.equal(r.status, 'fail');
  });

  test('candidato sin id entero: no se piden jobs y el check falla (fail-closed)', async () => {
    const calls = [];
    const github = fakeGitHub({ runsByFile: { 'ritmo-diario.yml': [{ ...run(2), id: '2' }] }, jobsByRun: { 2: jobsOf('ritmo-diario', 2) }, calls });
    const [r] = await checkWorkflows({ env: PROD, github, now: NOW, rules: only('ritmo-diario') });
    assert.deepEqual(calls, []);
    assert.equal(r.status, 'fail');
  });

  test('error al pedir jobs: falla ese check sin romper los demás', async () => {
    const github = fakeGitHub({
      runsByFile: { 'ritmo-diario.yml': [run(2)], 'seguridad.yml': [run(3, { ageH: 24 })] },
      failJobs: true,
    });
    const r = byCheck(await checkWorkflows({ env: PROD, github, now: NOW, rules: [rule('ritmo-diario'), rule('seguridad-semanal')] }));
    assert.equal(r['ritmo-diario'].status, 'fail');
    assert.match(r['ritmo-diario'].detail, /HTTP 502/);
    assert.equal(r['seguridad-semanal'].status, 'ok');
  });

  test('producción inactiva: no se piden jobs', async () => {
    const calls = [];
    const github = fakeGitHub({ runsByFile: { 'ritmo-diario.yml': [run(2)], 'correo-alertas.yml': [run(3)] }, calls });
    const r = byCheck(await checkWorkflows({ env: {}, github, now: NOW, rules: [rule('ritmo-diario'), rule('correo-alertas')] }));
    assert.deepEqual(calls, []);
    assert.equal(r['ritmo-diario'].status, 'skip');
    assert.equal(r['correo-alertas'].status, 'skip');
  });
});

// ---------------------------------------------------------------------------------------------
// (3) Datos realistas: las 5 reglas en ok
// ---------------------------------------------------------------------------------------------
test('QA-F19 (3): historial realista → ok en las 5 reglas (con producción) y jobs pedidos al run correcto', async () => {
  let id = 12_000_000_000;
  const hist = (event, hours, durMin = 1) => hours.map((h) => run(id++, { ageH: h, event, durMin })).reverse(); // API: más nuevo primero
  const daily = hist('schedule', [48, 24, 2], 2);
  const mail = [...hist('schedule', [27, 24, 3], 4)];
  const monthlyCur = { ...run(id++), created_at: '2027-03-01T05:10:00Z', run_started_at: '2027-03-01T05:10:00Z', updated_at: '2027-03-01T05:13:30Z' };
  const monthlyPrev = { ...run(id++), created_at: '2027-02-01T05:10:00Z', run_started_at: '2027-02-01T05:10:00Z', updated_at: '2027-02-01T05:12:00Z' };
  const runsByFile = {
    'ritmo-diario.yml': daily,
    'evaluacion-mensual.yml': [monthlyCur, monthlyPrev],
    'seguridad.yml': hist('schedule', [24 * 14, 24 * 7, 24], 12),
    'ci.yml': [run(id++, { ageH: 0.1, event: 'push', status: 'in_progress' }), ...hist('push', [5, 3, 1], 8)],
    'correo-alertas.yml': mail,
  };
  // Un job por run real, y uno con 2 jobs (la API lista varios cuando el workflow los tiene).
  const jobsByRun = {
    [daily[0].id]: jobsOf('ritmo-diario', daily[0].id),
    [monthlyCur.id]: jobsOf('evaluacion-mensual', monthlyCur.id),
    [mail[0].id]: [{ id: 1, run_id: mail[0].id, steps: [{ name: 'Set up job', conclusion: 'success' }] }, ...jobsOf('correo-alertas', mail[0].id)],
  };
  const calls = [];
  const results = await checkWorkflows({ env: PROD, github: fakeGitHub({ runsByFile, jobsByRun, calls }), now: NOW });
  assert.deepEqual(
    results.map((r) => [r.check, r.status]),
    WORKFLOW_RULES.map((r) => [r.check, 'ok']),
    JSON.stringify(results),
  );
  assert.deepEqual(calls.sort(), [daily[0].id, monthlyCur.id, mail[0].id].sort());
});

// ---------------------------------------------------------------------------------------------
// listJobs: per_page=100 y paginación
// ---------------------------------------------------------------------------------------------
describe('QA-F19: createGitHubClient.listJobs pagina con per_page=100', () => {
  const job = (n, step) => ({ id: n, run_id: 77, steps: step ? [{ name: step, conclusion: 'success' }] : [] });
  function client(pages, calls) {
    const fetchImpl = async (url) => {
      const u = new URL(url);
      calls.push(u);
      const page = Number(u.searchParams.get('page'));
      const body = pages[page - 1] ?? { total_count: 0, jobs: [] };
      return { status: 200, ok: true, json: async () => body };
    };
    return createGitHubClient({ token: 't', repo: 'apivasa/practica_agente', fetchImpl });
  }

  test('paso requerido en la 2.ª página (150 jobs): se lee y la regla da ok', async () => {
    const calls = [];
    const p1 = { total_count: 150, jobs: Array.from({ length: 100 }, (_, i) => job(i)) };
    const p2 = { total_count: 150, jobs: [...Array.from({ length: 49 }, (_, i) => job(100 + i)), job(999, 'Evaluar')] };
    const jobs = await client([p1, p2], calls).listJobs(77);
    assert.equal(jobs.length, 150);
    assert.deepEqual(calls.map((u) => [u.pathname, u.searchParams.get('per_page'), u.searchParams.get('page')]), [
      ['/repos/apivasa/practica_agente/actions/runs/77/jobs', '100', '1'],
      ['/repos/apivasa/practica_agente/actions/runs/77/jobs', '100', '2'],
    ]);
    assert.equal(assess('ritmo-diario', [run(77)], jobs).status, 'ok');
  });

  test('una sola página corta: una sola llamada', async () => {
    const calls = [];
    const jobs = await client([{ total_count: 2, jobs: [job(1), job(2, 'Evaluar')] }], calls).listJobs(77);
    assert.equal(jobs.length, 2);
    assert.equal(calls.length, 1);
  });

  test('exactamente 100 jobs con total_count=100: no pide una página vacía extra', async () => {
    const calls = [];
    await client([{ total_count: 100, jobs: Array.from({ length: 100 }, (_, i) => job(i)) }], calls).listJobs(77);
    assert.equal(calls.length, 1);
  });

  test('total_count desmesurado: se detiene en un número acotado de páginas', async () => {
    const calls = [];
    const full = { total_count: 1_000_000, jobs: Array.from({ length: 100 }, (_, i) => job(i)) };
    await client(Array(50).fill(full), calls).listJobs(77);
    assert.ok(calls.length >= 2 && calls.length <= 10, `páginas pedidas: ${calls.length}`);
  });

  test('runId no numérico no inyecta ruta', async () => {
    const calls = [];
    await client([], calls).listJobs('../../secrets');
    assert.doesNotMatch(calls[0].pathname, /secrets/);
  });
});

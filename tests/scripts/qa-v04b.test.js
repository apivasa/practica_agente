// V-04b — Pruebas QA independientes (tester). Cada caso traza a una frase del ítem o su criterio:
//   [A] "salud.yml vigila el último run de `Despliegue` (deploy.yml) en main"
//   [B] "último completado failure → falla con enlace"
//   [C] "(o >60 min queued/in_progress) → falla con enlace"
//   [D] "sin runs o success → pasa"
//   [E] "cancelled solo → warning sin fallar"
//   [F] Decisiones del desarrollador: cancelado tras fallo falla; `waiting` >60 min falla; 20 runs
//   [G] CLAUDE.md §4 / V-04: mensajes sin secretos (acaban en un issue público)
//   F-13 criterio 2: failure + run más nuevo pendiente en la ventana → warn (H-ARQ-F12-02)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_RULE, assessDeploy, checkDeploy, createGitHubClient, runAll } from '../../scripts/health/lib.js';
import { main } from '../../scripts/health/check.js';

const NOW = new Date('2027-05-04T12:00:00Z');
const WF = { state: 'active', created_at: '2026-01-01T00:00:00Z' };
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const link = (id) => `https://github.com/apivasa/practica_agente/actions/runs/${id}`;

function r(id, { ageMs = 3 * 60 * MIN, status = 'completed', conclusion = 'success', event = 'workflow_dispatch', started = 'same', url = true } = {}) {
  const created = ago(ageMs);
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: created,
    run_started_at: started === 'same' ? created : started,
    updated_at: created,
    ...(url ? { html_url: link(id) } : {}),
  };
}
const assess = (runs, workflow = WF) => assessDeploy(DEPLOY_RULE, { workflow, runs, now: NOW });

describe('QA V-04b assessDeploy: bordes del umbral de 90 min [C][F]', () => {
  test('exactamente 90 min en in_progress: pasa (el criterio dice "más de 90")', () => {
    assert.equal(assess([r(1, { status: 'in_progress', ageMs: 90 * MIN })]).status, 'ok');
  });
  test('90 min y 1 s en queued: falla con enlace', () => {
    const res = assess([r(1, { status: 'queued', ageMs: 90 * MIN + 1000 })]);
    assert.equal(res.status, 'fail');
    assert.ok(res.detail.includes(link(1)));
  });
  test('waiting más de 90 min: falla (decisión del desarrollador)', () => {
    assert.equal(assess([r(1, { status: 'waiting', ageMs: 120 * MIN })]).status, 'fail');
  });
  test('run_started_at ausente: usa created_at', () => {
    assert.equal(assess([r(1, { status: 'queued', ageMs: 91 * MIN, started: undefined })]).status, 'fail');
    assert.equal(assess([r(2, { status: 'queued', ageMs: 89 * MIN, started: null })]).status, 'ok');
  });
  test('run_started_at reciente prevalece sobre created_at viejo (re-ejecución)', () => {
    assert.equal(assess([r(1, { status: 'in_progress', ageMs: 5 * 60 * MIN, started: ago(10 * MIN) })]).status, 'ok');
  });
  test('sin fechas válidas: no se considera atascado ni lanza', () => {
    const bad = { ...r(1, { status: 'queued' }), created_at: 'no-fecha', run_started_at: null };
    assert.equal(assess([bad]).status, 'ok');
  });
  test('atascado sin html_url: falla igual', () => {
    assert.equal(assess([r(1, { status: 'in_progress', ageMs: 2 * 60 * MIN, url: false })]).status, 'fail');
  });
  // F-13 (H-ARQ-F12-02, criterio 2): un failure seguido de un run más nuevo pendiente dentro
  // de maxPendingMin es el rojo esperado (H-F11-06): aviso, no fallo. Si el pendiente es más
  // viejo que el failure, el failure sigue fallando.
  test('pendiente reciente + último completado success: pasa; + failure: aviso (F-13); pendiente más viejo que el failure: falla', () => {
    assert.equal(assess([r(1), r(2, { status: 'queued', ageMs: 5 * MIN })]).status, 'ok');
    const covered = assess([r(1, { conclusion: 'failure' }), r(2, { status: 'queued', ageMs: 5 * MIN })]);
    assert.equal(covered.status, 'warn');
    assert.ok(covered.detail.includes(link(1)) && covered.detail.includes(link(2)), covered.detail);
    assert.equal(assess([r(1, { conclusion: 'failure', ageMs: 5 * MIN }), r(2, { status: 'queued', ageMs: 10 * MIN })]).status, 'fail');
  });
});

describe('QA V-04b assessDeploy: eventos y orden [A]', () => {
  test('schedule, pull_request y workflow_run se ignoran (también atascados)', () => {
    for (const event of ['schedule', 'pull_request', 'workflow_run']) {
      assert.equal(assess([r(1, { event, conclusion: 'failure', ageMs: MIN })]).status, 'ok', event);
      assert.equal(assess([r(2, { event, status: 'in_progress', ageMs: 5 * 60 * MIN })]).status, 'ok', event);
    }
  });
  test('push y workflow_dispatch cuentan', () => {
    assert.equal(assess([r(1, { event: 'push', conclusion: 'failure' })]).status, 'fail');
    assert.equal(assess([r(1, { event: 'workflow_dispatch', conclusion: 'failure' })]).status, 'fail');
  });
  test('el más reciente se decide por created_at, no por el orden del arreglo', () => {
    const okRecent = assess([r(1, { conclusion: 'failure', ageMs: 10 * 60 * MIN }), r(2, { ageMs: 60 * MIN })]);
    assert.equal(okRecent.status, 'ok');
    const failRecent = assess([r(2, { ageMs: 10 * 60 * MIN }), r(1, { conclusion: 'failure', ageMs: 60 * MIN })]);
    assert.equal(failRecent.status, 'fail');
    assert.ok(failRecent.detail.includes(link(1)));
  });
  test('un fallo de pull_request más reciente no tapa un success de push', () => {
    assert.equal(assess([r(1, { event: 'push' }), r(2, { event: 'pull_request', conclusion: 'failure', ageMs: MIN })]).status, 'ok');
  });
});

describe('QA V-04b assessDeploy: conclusiones [B][D][E][F]', () => {
  test('sin runs, runs undefined y solo eventos ajenos: pasa', () => {
    assert.equal(assess([]).status, 'ok');
    assert.equal(assess(undefined).status, 'ok');
    assert.equal(assess([r(1, { event: 'schedule' })]).status, 'ok');
  });
  test('failure seguido de success posterior: se recupera y pasa', () => {
    assert.equal(assess([r(1, { conclusion: 'failure', ageMs: 5 * 60 * MIN }), r(2, { ageMs: 60 * MIN })]).status, 'ok');
  });
  test('varios cancelados seguidos tras success: aviso con enlace al último cancelado', () => {
    const res = assess([r(1, { ageMs: 9 * 60 * MIN }), r(2, { conclusion: 'cancelled', ageMs: 5 * 60 * MIN }), r(3, { conclusion: 'cancelled', ageMs: 60 * MIN })]);
    assert.equal(res.status, 'warn');
    assert.ok(res.detail.includes(link(3)));
  });
  test('varios cancelados tras un failure: falla con enlace al failure', () => {
    const res = assess([r(1, { conclusion: 'failure', ageMs: 9 * 60 * MIN }), r(2, { conclusion: 'cancelled', ageMs: 5 * 60 * MIN }), r(3, { conclusion: 'cancelled', ageMs: 60 * MIN })]);
    assert.equal(res.status, 'fail');
    assert.ok(res.detail.includes(link(1)));
  });
  test('solo cancelados (sin historial): aviso, no falla', () => {
    assert.equal(assess([r(1, { conclusion: 'cancelled' }), r(2, { conclusion: 'cancelled', ageMs: MIN })]).status, 'warn');
  });
  test('action_required (no success) falla', () => {
    assert.equal(assess([r(1, { conclusion: 'action_required' })]).status, 'fail');
  });
  test('workflow deshabilitado o ausente: falla aunque los runs estén en success', () => {
    assert.equal(assess([r(1)], { ...WF, state: 'disabled_inactivity' }).status, 'fail');
    assert.equal(assess([r(1)], null).status, 'fail');
  });
  test('el check se llama deploy-main en todos los casos', () => {
    for (const runs of [[], [r(1)], [r(1, { conclusion: 'failure' })], [r(1, { conclusion: 'cancelled' })]]) {
      assert.equal(assess(runs).check, 'deploy-main');
    }
  });
});

/** API de GitHub simulada para todos los workflows vigilados. */
function fakeApi({ deployRuns = [], deployWorkflow = WF, fail = null, calls = [] } = {}) {
  const runsFor = {
    'seguridad.yml': [r(13, { event: 'schedule', ageMs: 24 * 60 * MIN })],
    'ci.yml': [r(14, { event: 'push', ageMs: 60 * MIN })],
    'ritmo-diario.yml': [],
    'evaluacion-mensual.yml': [],
  };
  return async (u, init = {}) => {
    calls.push({ url: String(u), headers: init.headers });
    const json = (s, body) => ({ status: s, ok: s >= 200 && s < 300, json: async () => body });
    const p = new URL(u).pathname;
    const m = p.match(/\/actions\/workflows\/([\w.-]+)(\/runs)?$/);
    if (!m) throw new Error(`ruta no simulada ${p}`);
    const [, file, isRuns] = m;
    if (file === 'deploy.yml') {
      if (fail === 'network') throw new TypeError('fetch failed');
      if (typeof fail === 'number') return json(fail, {});
      if (!isRuns) return deployWorkflow ? json(200, deployWorkflow) : json(404, {});
      return json(200, { workflow_runs: deployRuns });
    }
    return isRuns ? json(200, { workflow_runs: runsFor[file] ?? [] }) : json(200, WF);
  };
}
const TOKEN = 'ghs_tokenficticioqa';
const client = (fetchImpl) => createGitHubClient({ token: TOKEN, repo: 'apivasa/practica_agente', fetchImpl });

describe('QA V-04b checkDeploy y API [A][F][G]', () => {
  test('pide deploy.yml en main, per_page=20, sin filtro de evento', async () => {
    const calls = [];
    await checkDeploy({ env: {}, github: client(fakeApi({ calls })), now: NOW });
    const q = new URL(calls.find((c) => c.url.includes('deploy.yml/runs')).url).searchParams;
    assert.equal(q.get('branch'), 'main');
    assert.equal(q.get('per_page'), '20');
    assert.equal(q.get('event'), null);
  });
  test('respeta DEFAULT_BRANCH', async () => {
    const calls = [];
    await checkDeploy({ env: { DEFAULT_BRANCH: 'trunk' }, github: client(fakeApi({ calls })), now: NOW });
    assert.equal(new URL(calls.find((c) => c.url.includes('deploy.yml/runs')).url).searchParams.get('branch'), 'trunk');
  });
  test('error de red: deploy-main falla sin lanzar y sin filtrar el token', async () => {
    const [res] = await checkDeploy({ env: {}, github: client(fakeApi({ fail: 'network' })), now: NOW });
    assert.equal(res.check, 'deploy-main');
    assert.equal(res.status, 'fail');
    assert.match(res.detail, /no se pudo consultar/);
    assert.ok(!res.detail.includes(TOKEN));
  });
  test('HTTP 403 y 500: falla con el código', async () => {
    for (const code of [403, 500]) {
      const [res] = await checkDeploy({ env: {}, github: client(fakeApi({ fail: code })), now: NOW });
      assert.equal(res.status, 'fail');
      assert.match(res.detail, new RegExp(`HTTP ${code}`));
    }
  });
  test('404 de deploy.yml: falla "no existe"', async () => {
    const [res] = await checkDeploy({ env: {}, github: client(fakeApi({ deployWorkflow: null })), now: NOW });
    assert.equal(res.status, 'fail');
    assert.match(res.detail, /no existe/);
  });
  test('runAll incluye deploy-main una sola vez', async () => {
    const results = await runAll({ env: { EVALUATION_ENABLED: 'false' }, fetchImpl: async () => ({ status: 200 }), github: client(fakeApi()), now: NOW });
    assert.equal(results.filter((x) => x.check === 'deploy-main').length, 1);
  });
});

describe('QA V-04b check.js: código de salida [B][E]', () => {
  const baseEnv = { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: 'apivasa/practica_agente', EVALUATION_ENABLED: 'false' };
  async function runMain(deployRuns, extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'qa-v04b-'));
    const env = { ...baseEnv, GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'sum'), ...extra };
    const lines = [];
    const out = await main({ argv: ['--only=workflows'], env, fetchImpl: fakeApi({ deployRuns }), now: NOW, log: (s) => lines.push(s) });
    return { ...out, lines, output: readFileSync(env.GITHUB_OUTPUT, 'utf8'), summary: readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') };
  }

  test('todo sano + despliegue success: código 0', async () => {
    const o = await runMain([r(1)]);
    assert.equal(o.code, 0, o.lines.join('\n'));
    assert.equal(o.output, 'failures=\n');
  });
  test('despliegue cancelado: warning, código 0 y failures vacío', async () => {
    const o = await runMain([r(1, { conclusion: 'cancelled' })]);
    assert.equal(o.code, 0, o.lines.join('\n'));
    assert.equal(o.output, 'failures=\n');
    assert.ok(o.lines.some((l) => l.startsWith('::warning::aviso deploy-main') && l.includes(link(1))));
    assert.match(o.summary, /\| deploy-main \| warn \|/);
  });
  test('cancelado con HEALTH_PLAIN_LOG=1: sin anotación ::warning::', async () => {
    const o = await runMain([r(1, { conclusion: 'cancelled' })], { HEALTH_PLAIN_LOG: '1' });
    assert.ok(o.lines.some((l) => l.startsWith('aviso deploy-main')));
  });
  test('despliegue atascado: código 1, failures=deploy-main, enlace en el log', async () => {
    const o = await runMain([r(1), r(2, { status: 'in_progress', ageMs: 2 * 60 * MIN })]);
    assert.equal(o.code, 1);
    assert.equal(o.output, 'failures=deploy-main\n');
    assert.ok(o.lines.some((l) => l.startsWith('::error::FALLA deploy-main') && l.includes(link(2))));
  });
  test('sin runs de despliegue: código 0', async () => {
    assert.equal((await runMain([])).code, 0);
  });
  test('ningún log contiene el token', async () => {
    const o = await runMain([r(1, { conclusion: 'failure' })]);
    assert.ok(!o.lines.join('\n').includes(TOKEN) && !o.summary.includes(TOKEN));
  });
  // F-13 criterio 2 (ver describe QA F-13 más abajo): «no abre issue» = código 0 y failures vacío.
  test('check.js: failure cubierto → código 0, failures vacío (no abre issue) y ::warning::', async () => {
    const o = await runMain([r(1, { conclusion: 'failure', ageMs: 2 * 60 * MIN }), r(2, { status: 'queued', ageMs: 5 * MIN })]);
    assert.equal(o.code, 0, o.lines.join('\n'));
    assert.equal(o.output, 'failures=\n');
    assert.ok(o.lines.some((l) => l.startsWith('::warning::aviso deploy-main') && l.includes(link(1))), o.lines.join('\n'));
    assert.match(o.summary, /\| deploy-main \| warn \|/);
  });
  test('check.js: el pendiente fuera de la ventana → código 1 y failures=deploy-main (abre issue)', async () => {
    const o = await runMain([r(1, { conclusion: 'failure', ageMs: 2 * 60 * MIN }), r(2, { status: 'queued', ageMs: (DEPLOY_RULE.maxPendingMin + 1) * MIN })]);
    assert.equal(o.code, 1);
    assert.equal(o.output, 'failures=deploy-main\n');
  });
});

// F-13 (H-ARQ-F12-02), criterio 2: "un failure de deploy.yml en main seguido de un run más
// nuevo pendiente dentro de maxPendingMin da warn (no abre issue); fuera de la ventana, o si
// el nuevo falla, o es más viejo, sí falla". salud.yml abre el issue solo si `failures` no
// está vacío, así que «no abre issue» = código 0 y failures vacío.
describe('QA F-13 deploy-main: failure cubierto por un run más nuevo pendiente', () => {
  const max = DEPLOY_RULE.maxPendingMin;
  const fail1 = (extra = {}) => r(1, { conclusion: 'failure', ageMs: 2 * 60 * MIN, ...extra });

  test('dentro de la ventana (queued, in_progress, waiting): warn con ambos enlaces', () => {
    for (const status of ['queued', 'in_progress', 'waiting']) {
      const res = assess([fail1(), r(2, { status, ageMs: 10 * MIN })]);
      assert.equal(res.status, 'warn', status);
      assert.ok(res.detail.includes(link(1)) && res.detail.includes(link(2)), res.detail);
    }
  });
  test('borde: exactamente maxPendingMin todavía es warn; maxPendingMin + 1 s falla', () => {
    assert.equal(assess([fail1(), r(2, { status: 'in_progress', ageMs: max * MIN })]).status, 'warn');
    const out = assess([fail1(), r(2, { status: 'in_progress', ageMs: max * MIN + 1000 })]);
    assert.equal(out.status, 'fail');
    assert.ok(out.detail.includes(link(1)), 'el fallo original sigue en el detalle');
  });
  test('si el nuevo terminó en failure (sin otro pendiente), falla con su enlace', () => {
    const res = assess([fail1(), r(2, { conclusion: 'failure', ageMs: 10 * MIN })]);
    assert.equal(res.status, 'fail');
    assert.ok(res.detail.includes(link(2)));
  });
  test('pendiente más viejo que el failure, o con el mismo created_at: falla', () => {
    assert.equal(assess([fail1({ ageMs: 10 * MIN }), r(2, { status: 'queued', ageMs: 20 * MIN })]).status, 'fail');
    assert.equal(assess([fail1({ ageMs: 10 * MIN }), r(2, { status: 'queued', ageMs: 10 * MIN })]).status, 'fail');
  });
  test('un pendiente de pull_request no cubre el failure de push', () => {
    assert.equal(assess([fail1({ event: 'push' }), r(2, { status: 'queued', event: 'pull_request', ageMs: 5 * MIN })]).status, 'fail');
  });
});

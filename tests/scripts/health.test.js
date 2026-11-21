// V-04 — Pruebas del workflow de salud (scripts/health) con fetch y API de GitHub simulados.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORKFLOW_RULES,
  assessWorkflow,
  checkAvailability,
  checkHttp,
  checkWorkflows,
  issueBody,
  parseFailures,
  safeUrl,
  upsertHealthIssue,
} from '../../scripts/health/lib.js';
import { main } from '../../scripts/health/check.js';
import { main as issueMain } from '../../scripts/health/issue.js';

const NOW = new Date('2027-03-10T15:00:00Z'); // 10:00 Guayaquil, día 10
const PUB = 'sb_publishable_ficticia';
const SUPA = 'https://ficticio.supabase.co';
const PAGES = 'https://apivasa.github.io/practica_agente/';
// Compara por origen exacto (esquema + host + puerto), no por subcadena de la URL.
const isSupabase = (u) => new URL(String(u)).origin === new URL(SUPA).origin;
const noSleep = async () => {};
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const PROD_ENV = {
  EVALUATION_ENABLED: 'true',
  SUPABASE_URL: SUPA,
  SUPABASE_PUBLISHABLE_KEY: PUB,
  GITHUB_TOKEN: 'token-ficticio',
  GITHUB_REPOSITORY: 'apivasa/practica_agente',
};

function run(id, { hours = 2, conclusion = 'success', event = 'schedule', minutes = 1 } = {}) {
  const created = hoursAgo(hours);
  return {
    id,
    status: 'completed',
    conclusion,
    event,
    created_at: created,
    run_started_at: created,
    updated_at: new Date(Date.parse(created) + minutes * 60_000).toISOString(),
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  };
}

/** Estado sano de los cinco workflows vigilados y del despliegue (V-04b). */
function healthyActions() {
  return {
    'ritmo-diario.yml': { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs: [run(11, { hours: 5 })] },
    'evaluacion-mensual.yml': { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs: [run(12, { hours: 8 * 24 })] },
    'seguridad.yml': { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs: [run(13, { hours: 2 * 24 })] },
    'ci.yml': { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs: [run(14, { hours: 1, event: 'push' })] },
    'correo-alertas.yml': { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs: [run(16, { hours: 4 })] },
    'deploy.yml': { workflow: { state: 'active', created_at: '2026-11-19T00:00:00Z' }, runs: [run(15, { hours: 3, event: 'push' })] },
  };
}

// F-20 (QA): forma real de GET /actions/runs/{id}/jobs: cada job trae id, run_id del run y sus pasos.
const evalJobs = (stepConclusion = 'success', runId = 1) => [{
  id: runId * 100, run_id: runId, status: 'completed', conclusion: 'success',
  steps: [{ name: 'Verificar configuración', conclusion: 'success' }, { name: 'Evaluar', conclusion: stepConclusion }],
}];

/**
 * F-19 (QA): jobs como los devuelve la API para el run `runId`: run_id del propio run y el paso
 * requerido de la regla de su workflow (p. ej. «Enviar correos» en correo-alertas), en success.
 */
function realJobs(actions, runId) {
  const file = Object.keys(actions).find((f) => (actions[f].runs ?? []).some((r) => r.id === runId));
  const step = WORKFLOW_RULES.find((r) => r.file === file)?.requiredStep;
  const steps = [{ name: 'Verificar configuración', conclusion: 'success' }];
  if (step) steps.push({ name: step, conclusion: 'success' });
  return file ? [{ id: runId * 100, run_id: runId, status: 'completed', conclusion: 'success', steps }] : [];
}

/** fetch simulado: Pages, Supabase y la API REST de GitHub. */
function fakeFetch({ pages = 200, supabase = 200, actions = healthyActions(), jobs, issues = [], calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body });
    const u = new URL(url);
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (u.href === PAGES) {
      if (pages === 'down') throw Object.assign(new Error(`fetch failed ${url}`), { name: 'TypeError' });
      return json(pages, {});
    }
    if (u.origin === SUPA) {
      assert.equal(u.pathname, '/auth/v1/health');
      assert.equal(init.headers.apikey, PUB);
      return json(supabase, {});
    }
    assert.equal(u.origin, 'https://api.github.com');
    assert.equal(init.headers.authorization, 'Bearer token-ficticio');
    const m = u.pathname.match(/^\/repos\/apivasa\/practica_agente\/(.*)$/);
    const p = m[1];
    let w;
    if ((w = p.match(/^actions\/workflows\/([\w.-]+)$/))) return actions[w[1]] ? json(200, actions[w[1]].workflow) : json(404, {});
    if ((w = p.match(/^actions\/workflows\/([\w.-]+)\/runs$/))) {
      assert.equal(u.searchParams.get('branch'), 'main');
      const ev = u.searchParams.get('event');
      return json(200, { workflow_runs: (actions[w[1]]?.runs ?? []).filter((r) => !ev || r.event === ev) });
    }
    if ((w = p.match(/^actions\/runs\/(\d+)\/jobs$/))) {
      const list = jobs ?? realJobs(actions, Number(w[1]));
      return json(200, { total_count: list.length, jobs: list });
    }
    if (p === 'issues' && (init.method ?? 'GET') === 'GET') return json(200, issues);
    if (p === 'labels') return json(422, {});
    if (p === 'issues') return json(201, { number: 77 });
    if (/^issues\/\d+\/comments$/.test(p)) return json(201, {});
    throw new Error(`ruta no simulada: ${p}`);
  };
}

const byCheck = (results) => Object.fromEntries(results.map((r) => [r.check, r]));

describe('check.js de punta a punta (fetch simulado)', () => {
  test('todo bien: código 0, sin fallos y sin secretos en el log', async () => {
    const lines = [];
    const dir = mkdtempSync(join(tmpdir(), 'salud-'));
    const env = { ...PROD_ENV, GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'sum') };
    const { code, results } = await main({ argv: [], env, fetchImpl: fakeFetch(), now: NOW, log: (s) => lines.push(s), sleep: noSleep });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(results.map((r) => r.status), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'failures=\n');
    assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /\| pages \| ok \|/);
    const log = lines.join('\n');
    assert.doesNotMatch(log, /sb_publishable_|token-ficticio|ficticio\.supabase/);
  });

  test('Pages caído (simulación de caída): falla, código 1 y failures=pages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salud-'));
    const env = { ...PROD_ENV, GITHUB_OUTPUT: join(dir, 'out') };
    const lines = [];
    const { code, results } = await main({ argv: [], env, fetchImpl: fakeFetch({ pages: 503 }), now: NOW, log: (s) => lines.push(s), sleep: noSleep });
    assert.equal(code, 1);
    assert.equal(byCheck(results).pages.status, 'fail');
    assert.match(byCheck(results).pages.detail, /HTTP 503 tras 2 intentos/);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'failures=pages\n');
    assert.ok(lines.some((l) => l.startsWith('::error::FALLA pages')));
  });

  test('Pages sin red: el detalle no filtra la URL ni el mensaje del error', async () => {
    const { code, results } = await main({ argv: ['--only=availability'], env: PROD_ENV, fetchImpl: fakeFetch({ pages: 'down' }), now: NOW, log: () => {}, sleep: noSleep });
    assert.equal(code, 1);
    assert.equal(byCheck(results).pages.detail, 'sin respuesta (error de red) tras 2 intentos');
  });

  test('Supabase caído: falla supabase', async () => {
    const { code, results } = await main({ argv: ['--only=availability'], env: PROD_ENV, fetchImpl: fakeFetch({ supabase: 502 }), now: NOW, log: () => {}, sleep: noSleep });
    assert.equal(code, 1);
    assert.equal(byCheck(results).supabase.status, 'fail');
    assert.equal(byCheck(results).pages.status, 'ok');
  });

  test('producción inactiva: disponibilidad y evaluaciones se omiten, sin fallos', async () => {
    const calls = [];
    const env = { ...PROD_ENV, EVALUATION_ENABLED: '' };
    const actions = healthyActions();
    actions['ritmo-diario.yml'].runs = []; // sin runs: no importa sin producción
    const { code, results } = await main({ argv: [], env, fetchImpl: fakeFetch({ pages: 'down', actions, calls }), now: NOW, log: () => {}, sleep: noSleep });
    assert.equal(code, 0);
    const r = byCheck(results);
    assert.equal(r.pages.status, 'skip');
    assert.equal(r.supabase.status, 'skip');
    assert.equal(r['ritmo-diario'].status, 'skip');
    assert.equal(r['evaluacion-mensual'].status, 'skip');
    assert.ok(!calls.some((c) => c.url === PAGES || isSupabase(c.url)), 'no debe llamar a Pages ni Supabase');
  });

  test('ritmo-diario sin correr en 30 h: falla', async () => {
    const actions = healthyActions();
    actions['ritmo-diario.yml'].runs = [run(21, { hours: 31 })];
    const { code, results } = await main({ argv: ['--only=workflows'], env: PROD_ENV, fetchImpl: fakeFetch({ actions }), now: NOW, log: () => {} });
    assert.equal(code, 1);
    assert.match(byCheck(results)['ritmo-diario'].detail, /hace 31 h \(máximo 30 h\)/);
  });

  test('workflow deshabilitado por inactividad: falla aunque producción esté inactiva', async () => {
    const actions = healthyActions();
    actions['ritmo-diario.yml'].workflow.state = 'disabled_inactivity';
    const env = { ...PROD_ENV, EVALUATION_ENABLED: 'false' };
    const { code, results } = await main({ argv: ['--only=workflows'], env, fetchImpl: fakeFetch({ actions }), now: NOW, log: () => {} });
    assert.equal(code, 1);
    assert.match(byCheck(results)['ritmo-diario'].detail, /deshabilitado \(disabled_inactivity\)/);
  });

  test('sin token de GitHub: falla actions-api', async () => {
    const env = { ...PROD_ENV, GITHUB_TOKEN: '' };
    const { code, results } = await main({ argv: ['--only=workflows'], env, fetchImpl: fakeFetch(), now: NOW, log: () => {} });
    assert.equal(code, 1);
    assert.equal(results[0].check, 'actions-api');
  });

  test('--only inválido: código 2', async () => {
    const { code } = await main({ argv: ['--only=x'], env: PROD_ENV, fetchImpl: fakeFetch(), now: NOW, log: () => {} });
    assert.equal(code, 2);
  });

  test('error de la API de Actions: falla el check sin romper el resto', async () => {
    const f = fakeFetch();
    const fetchImpl = async (url, init) => (String(url).includes('seguridad.yml') ? { status: 500, ok: false, json: async () => ({}) } : f(url, init));
    const { code, results } = await main({ argv: ['--only=workflows'], env: PROD_ENV, fetchImpl, now: NOW, log: () => {} });
    assert.equal(code, 1);
    const r = byCheck(results);
    assert.match(r['seguridad-semanal'].detail, /HTTP 500/);
    assert.equal(r['ci-main'].status, 'ok');
  });
});

describe('assessWorkflow (pura)', () => {
  const [daily, monthly, weekly, ci] = WORKFLOW_RULES;
  const wf = { state: 'active', created_at: '2026-11-19T00:00:00Z' };
  const base = { workflow: wf, now: NOW, productionEnabled: true };

  test('último run en failure: falla', () => {
    const r = assessWorkflow(daily, { ...base, runs: [run(1, { conclusion: 'failure' }), run(2, { hours: 20 })] });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /terminó en failure/);
  });
  test('runs cancelados no cuentan', () => {
    const r = assessWorkflow(daily, { ...base, runs: [run(1, { conclusion: 'cancelled' }), run(2, { hours: 3 })], jobs: evalJobs('success', 2) });
    assert.equal(r.status, 'ok');
  });
  test('duración mayor a 5 min: falla', () => {
    const r = assessWorkflow(daily, { ...base, runs: [run(1, { minutes: 7 })] });
    assert.match(r.detail, /duró 7 min/);
  });
  test('paso Evaluar omitido con producción activa: falla', () => {
    const r = assessWorkflow(daily, { ...base, runs: [run(1)], jobs: evalJobs('skipped') });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /"Evaluar" omitido/);
  });
  test('mensual: día ≥ 2 sin run del mes → falla; día 1 → ok', () => {
    const runs = [run(1, { hours: 40 * 24 })];
    assert.equal(assessWorkflow(monthly, { ...base, runs }).status, 'fail');
    const day1 = new Date('2027-03-01T20:00:00Z');
    assert.equal(assessWorkflow(monthly, { ...base, now: day1, runs }).status, 'ok');
  });
  test('mensual: el run del mes se juzga en hora de Guayaquil', () => {
    // 2027-03-01T03:00Z es todavía 28 de febrero en Guayaquil: no cuenta para marzo.
    const r = { ...run(1), created_at: '2027-03-01T03:00:00Z', run_started_at: '2027-03-01T03:00:00Z', updated_at: '2027-03-01T03:01:00Z' };
    assert.equal(assessWorkflow(monthly, { ...base, runs: [r] }).status, 'fail');
  });
  test('seguridad semanal: más de 8 días → falla; workflow nuevo sin runs → ok', () => {
    assert.equal(assessWorkflow(weekly, { ...base, runs: [run(1, { hours: 9 * 24 })] }).status, 'fail');
    const fresh = { state: 'active', created_at: hoursAgo(24) };
    assert.equal(assessWorkflow(weekly, { ...base, workflow: fresh, runs: [] }).status, 'ok');
    assert.equal(assessWorkflow(weekly, { ...base, runs: [] }).status, 'fail');
  });
  test('ci-main: sin runs se omite; en failure falla; no exige antigüedad', () => {
    assert.equal(assessWorkflow(ci, { ...base, runs: [] }).status, 'skip');
    assert.equal(assessWorkflow(ci, { ...base, runs: [run(1, { event: 'push', conclusion: 'failure' })] }).status, 'fail');
    assert.equal(assessWorkflow(ci, { ...base, runs: [run(1, { event: 'push', hours: 500 })] }).status, 'ok');
  });
  test('workflow inexistente: falla', () => {
    assert.equal(assessWorkflow(daily, { ...base, workflow: null, runs: [] }).status, 'fail');
  });
});

describe('disponibilidad y URLs', () => {
  test('safeUrl: https o http solo a loopback', () => {
    assert.ok(safeUrl('https://x.supabase.co'));
    assert.ok(safeUrl('http://127.0.0.1:54321'));
    assert.equal(safeUrl('http://x.supabase.co'), null);
    assert.equal(safeUrl('file:///etc/passwd'), null);
    assert.equal(safeUrl(''), null);
  });
  test('clave no publicable (p. ej. secreta): falla sin enviarla', async () => {
    const calls = [];
    const env = { ...PROD_ENV, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_ficticia' };
    const r = byCheck(await checkAvailability({ env, fetchImpl: fakeFetch({ calls }), sleep: noSleep }));
    assert.equal(r.supabase.status, 'fail');
    assert.ok(!calls.some((c) => isSupabase(c.url)));
  });
  test('checkHttp reintenta y se recupera', async () => {
    let n = 0;
    const fetchImpl = async () => ({ status: ++n === 1 ? 500 : 200 });
    const r = await checkHttp({ check: 'pages', url: PAGES, fetchImpl, sleep: noSleep });
    assert.equal(r.status, 'ok');
    assert.match(r.detail, /intento 2/);
  });
  test('URL de Supabase con barra final', async () => {
    const env = { ...PROD_ENV, SUPABASE_URL: `${SUPA}/` };
    const r = byCheck(await checkAvailability({ env, fetchImpl: fakeFetch(), sleep: noSleep }));
    assert.equal(r.supabase.status, 'ok');
  });
});

describe('issue de salud', () => {
  const RUN = 'https://github.com/apivasa/practica_agente/actions/runs/123';
  test('sin issue abierto: crea uno con la etiqueta salud', async () => {
    const calls = [];
    const out = await issueMain({ env: { ...PROD_ENV, FAILURES: 'pages,ritmo-diario', RUN_URL: RUN }, fetchImpl: fakeFetch({ calls }), now: NOW, log: () => {} });
    assert.deepEqual(out, { action: 'created', number: 77 });
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues'));
    const body = JSON.parse(create.body);
    assert.deepEqual(body.labels, ['salud']);
    assert.match(body.body, /- `pages`\n- `ritmo-diario`/);
    assert.match(body.body, /10:00 \(America\/Guayaquil\)/);
    assert.match(body.body, /actions\/runs\/123/);
  });
  test('con issue abierto: comenta, no duplica', async () => {
    const calls = [];
    const issues = [{ number: 5, pull_request: {} }, { number: 9 }];
    const out = await issueMain({ env: { ...PROD_ENV, FAILURES: 'pages', RUN_URL: RUN }, fetchImpl: fakeFetch({ calls, issues }), now: NOW, log: () => {} });
    assert.deepEqual(out, { action: 'commented', number: 9 });
    assert.ok(!calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues')));
    assert.ok(calls.some((c) => c.url.endsWith('/issues/9/comments')));
  });
  test('el cuerpo descarta nombres no válidos y enlaces ajenos', () => {
    assert.deepEqual(parseFailures('pages, <img src=x>,ok-1,'), ['pages', 'ok-1']);
    const body = issueBody({ failures: [], runUrl: 'https://evil.example/x', now: NOW });
    assert.match(body, /enlace no disponible/);
    assert.match(body, /falló sin resumen/);
  });
  test('upsertHealthIssue con cliente simulado', async () => {
    const made = [];
    const github = { findOpenIssue: async () => null, ensureLabel: async () => null, createIssue: async (...a) => (made.push(a), { number: 1 }), commentIssue: async () => {} };
    await upsertHealthIssue({ github, failures: ['supabase'], runUrl: RUN, now: NOW });
    assert.equal(made[0][0], 'Salud del sistema: comprobación fallida');
  });
});

test('checkWorkflows consulta los jobs solo con producción activa', async () => {
  const calls = [];
  const github = {
    getWorkflow: async () => ({ state: 'active', created_at: '2026-11-19T00:00:00Z' }),
    listRuns: async () => [run(1, { hours: 1 })],
    listJobs: async (id) => (calls.push(id), evalJobs('success', id)),
  };
  await checkWorkflows({ env: { EVALUATION_ENABLED: 'false' }, github, now: NOW });
  assert.equal(calls.length, 0);
  await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW });
  assert.equal(calls.length, 3); // ritmo-diario, evaluacion-mensual y correo-alertas (C-06)
});

// C-06 (H-ARQ-C05-01): correo-alertas.yml entra en la vigilancia de salud (ADR 0017, punto 10).
describe('C-06 regla de correo-alertas', () => {
  const rule = WORKFLOW_RULES.find((r) => r.file === 'correo-alertas.yml');
  const wf = { state: 'active', created_at: '2026-11-19T00:00:00Z' };
  const base = { workflow: wf, now: NOW, productionEnabled: true };
  const mailJobs = (c = 'success', runId = 1) => [{
    id: runId * 100, run_id: runId, status: 'completed', conclusion: 'success',
    steps: [{ name: 'Verificar configuración', conclusion: 'success' }, { name: 'Enviar correos', conclusion: c }],
  }];

  test('fila: exige producción, 30 h, paso "Enviar correos" y 10 min; el archivo y el paso existen', () => {
    assert.ok(rule);
    assert.equal(rule.check, 'correo-alertas');
    assert.equal(rule.requiresProduction, true);
    assert.equal(rule.event, null);
    assert.equal(rule.maxAgeHours, 30);
    assert.equal(rule.requiredStep, 'Enviar correos');
    assert.equal(rule.maxDurationMin, 10);
    const yml = readFileSync(new URL('../../.github/workflows/correo-alertas.yml', import.meta.url), 'utf8');
    assert.match(yml, /- name: Enviar correos\n/);
    // Coherente con el cron: corre dos veces al día, así que 30 h cubren un día entero perdido.
    assert.match(yml, /cron: '53 11 \* \* \*'/);
    assert.match(yml, /cron: '53 14 \* \* \*'/);
    assert.match(yml, /timeout-minutes: 15/);
  });
  test('run reciente y sano: ok', () => {
    assert.equal(assessWorkflow(rule, { ...base, runs: [run(1, { hours: 3 })], jobs: mailJobs() }).status, 'ok');
  });
  test('sin correr en 31 h: falla', () => {
    const r = assessWorkflow(rule, { ...base, runs: [run(1, { hours: 31 })] });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /hace 31 h \(máximo 30 h\)/);
  });
  test('último run en failure (p. ej. exit 1 por 401/403 de Resend): falla', () => {
    const r = assessWorkflow(rule, { ...base, runs: [run(1, { conclusion: 'failure' })] });
    assert.match(r.detail, /terminó en failure/);
  });
  test('paso "Enviar correos" omitido con producción activa: falla', () => {
    const r = assessWorkflow(rule, { ...base, runs: [run(1)], jobs: mailJobs('skipped') });
    assert.match(r.detail, /paso "Enviar correos" omitido/);
  });
  test('duró más de 10 min: falla', () => {
    assert.match(assessWorkflow(rule, { ...base, runs: [run(1, { minutes: 12 })] }).detail, /duró 12 min \(máximo 10\)/);
  });
  test('producción inactiva: se omite, pero un workflow deshabilitado falla igual', () => {
    assert.equal(assessWorkflow(rule, { ...base, productionEnabled: false, runs: [] }).status, 'skip');
    const r = assessWorkflow(rule, { ...base, productionEnabled: false, workflow: { ...wf, state: 'disabled_inactivity' }, runs: [] });
    assert.equal(r.status, 'fail');
  });
});

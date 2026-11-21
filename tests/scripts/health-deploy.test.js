// V-04b — Check `deploy-main` de salud.yml: último run de `Despliegue` (deploy.yml) en main.
// Sin red: runs construidos a mano y fetch simulado de la API de GitHub.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, WORKFLOW_RULES, assessDeploy, checkDeploy, createGitHubClient } from '../../scripts/health/lib.js';
import { main } from '../../scripts/health/check.js';

const NOW = new Date('2027-03-10T15:00:00Z');
const WF = { state: 'active', created_at: '2026-11-19T00:00:00Z' };
const minAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const url = (id) => `https://github.com/apivasa/practica_agente/actions/runs/${id}`;

function run(id, { min = 120, status = 'completed', conclusion = 'success', event = 'push' } = {}) {
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: minAgo(min),
    run_started_at: minAgo(min),
    updated_at: minAgo(Math.max(0, min - 5)),
    html_url: url(id),
  };
}
const assess = (runs, workflow = WF) => assessDeploy(DEPLOY_RULE, { workflow, runs, now: NOW });

describe('assessDeploy (pura)', () => {
  test('regla: deploy.yml, check deploy-main, push y workflow_dispatch, 90 min; fuera de WORKFLOW_RULES', () => {
    assert.equal(DEPLOY_RULE.file, 'deploy.yml');
    assert.equal(DEPLOY_RULE.check, 'deploy-main');
    assert.deepEqual([...DEPLOY_RULE.events], ['push', 'workflow_dispatch']);
    assert.equal(DEPLOY_RULE.maxPendingMin, 90);
    assert.ok(!WORKFLOW_RULES.some((r) => r.file === 'deploy.yml'));
  });

  test('sin runs: pasa', () => {
    const r = assess([]);
    assert.equal(r.status, 'ok');
    assert.match(r.detail, /sin despliegues completados/);
  });

  test('último en success: pasa con enlace', () => {
    const r = assess([run(2), run(1, { min: 600, conclusion: 'failure' })]);
    assert.equal(r.status, 'ok');
    assert.ok(r.detail.includes(url(2)));
  });

  test('último en failure: falla con mensaje y enlace al run', () => {
    const r = assess([run(1, { min: 600 }), run(2, { conclusion: 'failure' })]);
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /último despliegue terminó en failure/);
    assert.ok(r.detail.includes(url(2)));
  });

  test('timed_out y startup_failure también fallan', () => {
    assert.equal(assess([run(1, { conclusion: 'timed_out' })]).status, 'fail');
    assert.equal(assess([run(1, { conclusion: 'startup_failure' })]).status, 'fail');
  });

  test('workflow_dispatch cuenta; otros eventos no', () => {
    assert.equal(assess([run(1, { event: 'workflow_dispatch', conclusion: 'failure' })]).status, 'fail');
    assert.equal(assess([run(1, { event: 'pull_request', conclusion: 'failure' })]).status, 'ok');
  });

  test('cancelado seguido de success: pasa', () => {
    const r = assess([run(1, { min: 300, conclusion: 'cancelled' }), run(2, { min: 100 })]);
    assert.equal(r.status, 'ok');
  });

  test('cancelado solo (o tras un success): aviso, no falla', () => {
    const only = assess([run(1, { conclusion: 'cancelled' })]);
    assert.equal(only.status, 'warn');
    assert.ok(only.detail.includes(url(1)));
    assert.equal(assess([run(1, { min: 300 }), run(2, { conclusion: 'cancelled' })]).status, 'warn');
  });

  test('cancelado tras un failure: sigue fallando (la cancelación no corrige el fallo)', () => {
    const r = assess([run(1, { min: 300, conclusion: 'failure' }), run(2, { conclusion: 'cancelled' })]);
    assert.equal(r.status, 'fail');
    assert.ok(r.detail.includes(url(1)));
  });

  test('skipped no cuenta como último despliegue', () => {
    assert.equal(assess([run(1, { min: 300, conclusion: 'failure' }), run(2, { conclusion: 'skipped' })]).status, 'fail');
  });

  test('in_progress, queued o waiting más de 90 min: falla con enlace; menos: pasa', () => {
    for (const status of ['in_progress', 'queued', 'waiting']) {
      const r = assess([run(1, { min: 600 }), run(2, { status, min: 91 })]);
      assert.equal(r.status, 'fail', status);
      assert.match(r.detail, new RegExp(`91 min en ${status} \\(máximo 90\\)`));
      assert.ok(r.detail.includes(url(2)));
      assert.equal(assess([run(1, { min: 600 }), run(2, { status, min: 89 })]).status, 'ok', status);
    }
  });

  test('atascado y último cancelado: falla (no se degrada a aviso)', () => {
    assert.equal(assess([run(1, { conclusion: 'cancelled' }), run(2, { status: 'queued', min: 120 })]).status, 'fail');
  });

  test('atascado y último failure: ambos problemas en el detalle', () => {
    const r = assess([run(1, { conclusion: 'failure' }), run(2, { status: 'in_progress', min: 120 })]);
    assert.equal(r.status, 'fail');
    assert.ok(r.detail.includes(url(1)) && r.detail.includes(url(2)));
  });

  test('deploy.yml inexistente o deshabilitado: falla', () => {
    assert.equal(assess([], null).status, 'fail');
    const r = assess([run(1)], { ...WF, state: 'disabled_manually' });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /deshabilitado \(disabled_manually\)/);
  });
});

/** fetch simulado de la API de GitHub (solo Actions; deploy.yml con runs configurables). */
function fakeGitHub({ workflow = WF, runs = [], status = 200, calls = [] } = {}) {
  return async (u, init = {}) => {
    calls.push(String(u));
    const json = (s, body) => ({ status: s, ok: s >= 200 && s < 300, json: async () => body });
    const p = new URL(u).pathname;
    if (status !== 200) return json(status, {});
    if (p.endsWith('/actions/workflows/deploy.yml')) return workflow ? json(200, workflow) : json(404, {});
    if (p.endsWith('/actions/workflows/deploy.yml/runs')) return json(200, { workflow_runs: runs });
    if (/\/actions\/workflows\/[\w.-]+$/.test(p)) return json(200, WF);
    if (/\/actions\/workflows\/[\w.-]+\/runs$/.test(p)) return json(200, { workflow_runs: [] });
    throw new Error(`ruta no simulada: ${p} ${init.method ?? 'GET'}`);
  };
}

const client = (fetchImpl) => createGitHubClient({ token: 't', repo: 'apivasa/practica_agente', fetchImpl });

describe('checkDeploy (API simulada)', () => {
  test('consulta runs de deploy.yml en main sin filtro de evento', async () => {
    const calls = [];
    const [r] = await checkDeploy({ env: {}, github: client(fakeGitHub({ runs: [run(1)], calls })), now: NOW });
    assert.equal(r.status, 'ok');
    const runsCall = new URL(calls.find((c) => c.includes('/runs')));
    assert.equal(runsCall.searchParams.get('branch'), 'main');
    assert.equal(runsCall.searchParams.get('event'), null);
  });

  test('error de la API: falla deploy-main sin lanzar', async () => {
    const [r] = await checkDeploy({ env: {}, github: client(fakeGitHub({ status: 500 })), now: NOW });
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /HTTP 500/);
  });
});

describe('check.js con deploy-main', () => {
  const env = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'apivasa/practica_agente', EVALUATION_ENABLED: 'false' };

  test('despliegue en failure: código 1, deploy-main en failures y ::error:: con enlace', async () => {
    const lines = [];
    const fetchImpl = fakeGitHub({ runs: [run(9, { conclusion: 'failure' })] });
    const { code, results } = await main({ argv: ['--only=workflows'], env, fetchImpl, now: NOW, log: (s) => lines.push(s) });
    assert.equal(code, 1);
    assert.equal(results.find((r) => r.check === 'deploy-main').status, 'fail');
    assert.ok(lines.some((l) => l.startsWith('::error::FALLA deploy-main') && l.includes(url(9))));
    assert.ok(JSON.parse(lines.at(-1)).failures.includes('deploy-main'));
  });

  test('despliegue cancelado: ::warning:: aviso y deploy-main fuera de failures', async () => {
    const lines = [];
    const fetchImpl = fakeGitHub({ runs: [run(9, { conclusion: 'cancelled' })] });
    const { results } = await main({ argv: ['--only=workflows'], env, fetchImpl, now: NOW, log: (s) => lines.push(s) });
    assert.equal(results.find((r) => r.check === 'deploy-main').status, 'warn');
    assert.ok(lines.some((l) => l.startsWith('::warning::aviso deploy-main')));
    assert.ok(!JSON.parse(lines.at(-1)).failures.includes('deploy-main'));
  });

  test('--only=availability no consulta deploy-main', async () => {
    const { results } = await main({ argv: ['--only=availability'], env, fetchImpl: fakeGitHub(), now: NOW, log: () => {} });
    assert.ok(!results.some((r) => r.check === 'deploy-main'));
  });
});

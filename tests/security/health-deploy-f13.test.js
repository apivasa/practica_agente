// F-13 — Seguridad del `warn` de deploy-main por un run más nuevo pendiente
// (scripts/health/lib.js: assessDeploy + newerPendingRun). Categoría 5 (automatizaciones):
// el aviso no puede ocultar un despliegue fallido real. Solo cubre un run de push o
// workflow_dispatch, creado después del fallo, sin terminar y dentro de maxPendingMin;
// timestamps ilegibles fallan cerrado; un run atascado sigue fallando; el aviso no lleva el
// token ni campos controlables. Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_RULE, assessDeploy, newerPendingRun } from '../../scripts/health/lib.js';
import { main } from '../../scripts/health/check.js';

const NOW = new Date('2027-03-10T15:00:00Z');
const WF = { state: 'active', created_at: '2026-11-19T00:00:00Z' };
// Token ficticio armado en ejecución (no es un literal con forma de secreto).
const TOKEN = ['ghs', 'f13ficticioseguridad'].join('_');
const minAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const PAYLOAD = 'x\n::error::INYECTADO <img src=x onerror=alert(1)>';

function run(id, { min = 120, started, status = 'completed', conclusion = 'success', event = 'push', created } = {}) {
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: created ?? minAgo(min),
    run_started_at: started === undefined ? (created ?? minAgo(min)) : started,
    html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
    display_title: PAYLOAD,
    head_branch: `main${PAYLOAD}`,
    head_commit: { message: PAYLOAD },
    actor: { login: PAYLOAD },
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });
const failed = (id = 1, min = 60) => run(id, { min, conclusion: 'failure' });
const pending = (id = 2, min = 10, extra = {}) => run(id, { min, status: 'queued', ...extra });

describe('F-13 seg · cat. 5 el warn solo cubre un run legítimo y vigente', () => {
  test('control: fallo + run más nuevo en cola dentro del límite → warn', () => {
    const r = assess([pending(), failed()]);
    assert.equal(r.status, 'warn');
  });

  for (const status of ['in_progress', 'waiting', 'pending', 'requested']) {
    test(`run más nuevo en ${status} dentro del límite → warn`, () => {
      assert.equal(assess([pending(2, 10, { status }), failed()]).status, 'warn');
    });
  }

  test('sin run más nuevo → fail', () => {
    assert.equal(assess([failed()]).status, 'fail');
  });

  for (const event of ['pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'repository_dispatch', undefined]) {
    test(`run pendiente de evento ${event} no cubre el fallo → fail`, () => {
      const p = { ...pending(2, 10), event };
      assert.equal(assess([p, failed()]).status, 'fail');
    });
  }

  test('run pendiente creado antes del fallo no lo cubre → fail', () => {
    assert.equal(assess([failed(1, 30), pending(2, 40)]).status, 'fail');
  });

  test('run pendiente con el mismo created_at que el fallo no lo cubre → fail', () => {
    const t = minAgo(30);
    assert.equal(assess([pending(2, 0, { created: t }), run(1, { created: t, conclusion: 'failure' })]).status, 'fail');
  });

  test('run más nuevo atascado (> maxPendingMin) → fail con el detalle del atasco', () => {
    const r = assess([pending(2, DEPLOY_RULE.maxPendingMin + 5, { started: minAgo(DEPLOY_RULE.maxPendingMin + 5) }), failed(1, DEPLOY_RULE.maxPendingMin + 30)]);
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /lleva \d+ min en queued/);
  });

  test('run creado después del fallo pero con run_started_at viejo (> límite) → fail', () => {
    const r = assess([pending(2, 10, { started: minAgo(DEPLOY_RULE.maxPendingMin + 60) }), failed()]);
    assert.equal(r.status, 'fail');
  });

  test('un run atascado más viejo impide el warn aunque haya otro run nuevo vigente → fail', () => {
    const stuckOld = run(3, { min: 200, status: 'waiting' });
    const r = assess([pending(2, 5), failed(1, 30), stuckOld]);
    assert.equal(r.status, 'fail');
  });

  test('el run que cubre termina en failure: la siguiente evaluación falla', () => {
    const r = assess([run(2, { min: 5, conclusion: 'failure' }), failed(1, 60)]);
    assert.equal(r.status, 'fail');
  });

  test('último completado cancelado con fallo previo y un pendiente nuevo → sigue fail (no lo cubre)', () => {
    const r = assess([pending(3, 5), run(2, { min: 20, conclusion: 'cancelled' }), failed(1, 60)]);
    assert.equal(r.status, 'fail');
  });
});

describe('F-13 seg · cat. 5 timestamps ilegibles fallan cerrado', () => {
  // Nota: Date.parse convierte no-strings (12 → año 2001); la API de GitHub siempre da ISO 8601,
  // así que solo se prueban valores que Date.parse rechaza (ver H-F13-02).
  for (const bad of ['', 'no-es-fecha', null, undefined, '2027-13-45T99:99:99Z', {}, []]) {
    test(`created_at del pendiente = ${JSON.stringify(bad)} → no cubre (fail)`, () => {
      const p = { ...pending(), created_at: bad, run_started_at: minAgo(5) };
      assert.equal(assess([p, failed()]).status, 'fail');
    });
    // Si run_started_at es falsy se usa created_at (válido): caso legítimo, solo se prueban los truthy.
    if (bad) {
      test(`run_started_at del pendiente = ${JSON.stringify(bad)} ilegible → no cubre (fail)`, () => {
        const p = { ...pending(), run_started_at: bad };
        assert.equal(assess([p, failed()]).status, 'fail');
      });
    }
    test(`created_at del fallo = ${JSON.stringify(bad)} → newerPendingRun devuelve null`, () => {
      assert.equal(newerPendingRun([pending()], { ...failed(), created_at: bad }, NOW.getTime(), DEPLOY_RULE.maxPendingMin), null);
    });
  }

  test('newerPendingRun tolera entradas basura sin lanzar y sin cubrir', () => {
    const junk = [null, undefined, 1, 'x', {}, { status: 'queued' }, { status: 'queued', created_at: 'x' }];
    assert.equal(newerPendingRun(junk, failed(), NOW.getTime(), DEPLOY_RULE.maxPendingMin), null);
    assert.equal(newerPendingRun(null, failed(), NOW.getTime(), DEPLOY_RULE.maxPendingMin), null);
    assert.equal(newerPendingRun([pending()], null, NOW.getTime(), DEPLOY_RULE.maxPendingMin), null);
  });
});

describe('F-13 seg · cat. 5/6 el aviso no filtra token ni campos controlables', () => {
  function fakeGitHub(runs) {
    const json = (s, body) => ({ ok: true, status: s, json: async () => body });
    return async (u) => {
      const p = new URL(u).pathname;
      if (p.endsWith('/actions/workflows/deploy.yml')) return json(200, WF);
      if (p.endsWith('/actions/workflows/deploy.yml/runs')) return json(200, { workflow_runs: runs });
      if (/\/actions\/workflows\/[\w.-]+$/.test(p)) return json(200, WF);
      if (/\/actions\/workflows\/[\w.-]+\/runs$/.test(p)) return json(200, { workflow_runs: [] });
      throw new Error(`ruta no simulada: ${p}`);
    };
  }

  test('detalle del warn: solo status, conclusion y html_url', () => {
    const r = assess([pending(), failed()]);
    assert.equal(r.status, 'warn');
    for (const s of ['INYECTADO', 'onerror', TOKEN]) assert.ok(!r.detail.includes(s), `el detalle contiene ${s.slice(0, 8)}`);
    assert.match(
      r.detail,
      /^último despliegue terminó en failure — https:\/\/github\.com\/apivasa\/practica_agente\/actions\/runs\/1; hay uno más nuevo en queued que lo cubre \(rojo esperado H-F11-06\) — https:\/\/github\.com\/apivasa\/practica_agente\/actions\/runs\/2$/,
    );
  });

  test('check.js: warn → ::warning:: aviso, código 0, failures vacío, sin token en log/output/summary', async () => {
    const lines = [];
    const dir = mkdtempSync(join(tmpdir(), 'salud-f13-'));
    const env = {
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'apivasa/practica_agente',
      EVALUATION_ENABLED: 'false',
      GITHUB_OUTPUT: join(dir, 'out'),
      GITHUB_STEP_SUMMARY: join(dir, 'sum'),
    };
    const out = await main({ argv: ['--only=workflows'], env, fetchImpl: fakeGitHub([pending(), failed()]), now: NOW, log: (s) => lines.push(s) });
    const output = readFileSync(env.GITHUB_OUTPUT, 'utf8');
    const summary = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
    const all = [...lines, output, summary].join('\n');
    assert.ok(lines.some((l) => l.startsWith('::warning::aviso deploy-main:')), 'debe quedar un ::warning:: visible');
    assert.ok(!output.includes('deploy-main'), 'un warn no debe abrir issue (no va a failures)');
    for (const s of [TOKEN, 'INYECTADO', 'onerror']) assert.ok(!all.includes(s), `la salida contiene ${s.slice(0, 8)}`);
    assert.equal(out.results.find((r) => r.check === 'deploy-main').status, 'warn');
  });

  test('check.js: run pendiente de pull_request no convierte el fallo en warn (va a failures)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salud-f13-'));
    const env = {
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'apivasa/practica_agente',
      EVALUATION_ENABLED: 'false',
      GITHUB_OUTPUT: join(dir, 'out'),
      GITHUB_STEP_SUMMARY: join(dir, 'sum'),
    };
    const out = await main({ argv: ['--only=workflows'], env, fetchImpl: fakeGitHub([pending(2, 5, { event: 'pull_request' }), failed()]), now: NOW, log: () => {} });
    assert.equal(out.code, 1);
    assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /failures=.*deploy-main/);
  });
});

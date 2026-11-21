// F-18 — Seguridad de assessWorkflow y assessDeploy tras H-F17-01 y H-F17-02.
// Categoría 5 (automatizaciones): con datos manipulados de la API de Actions el check de salud
// no puede dar un `ok` falso.
// - H-F17-01: mismo created_at y mismo id entero → el no-success va primero (ambos órdenes,
//   assessWorkflow y assessDeploy).
// - H-F17-02: un run completado con created_at futuro o ilegible hace fallar assessWorkflow en
//   todas las reglas (no puede ser candidato con edad negativa o NaN).
// - Empates: todas las permutaciones de un grupo hostil dan el mismo resultado y nunca ok si
//   hay un no-success que el id no permite descartar.
// - Fuzz determinista con un oráculo independiente del comparador.
// - checkWorkflows: respuesta de runs con forma rara → fail, no excepción ni ok.
// Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOY_RULE,
  FUTURE_SKEW_MIN,
  WORKFLOW_RULES,
  assessDeploy,
  assessWorkflow,
  checkWorkflows,
} from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const at = (offsetMin) => new Date(NOW_MS + offsetMin * MIN).toISOString();
const T = at(-60);
const RULE = Object.fromEntries(WORKFLOW_RULES.map((r) => [r.check, r]));
const NON_MONTHLY = WORKFLOW_RULES.filter((r) => !r.monthly);

const runFor = (rule, id, conclusion, extra = {}) => ({
  id,
  event: rule.event ?? 'push',
  status: 'completed',
  conclusion,
  created_at: T,
  run_started_at: T,
  updated_at: T,
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${String(id)}`,
  ...extra,
});
const wf = (rule, runs, extra = {}) =>
  assessWorkflow(rule, { workflow: WF, runs, jobs: [], now: NOW, productionEnabled: true, ...extra }).status;
const dep = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW }).status;

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('H-F17-01: mismo created_at y mismo id entero', () => {
  for (const rule of NON_MONTHLY) {
    test(`${rule.check}: success y failure con id 5 dan fail en ambos órdenes`, () => {
      const s = runFor(rule, 5, 'success');
      const f = runFor(rule, 5, 'failure');
      assert.equal(wf(rule, [s, f]), 'fail');
      assert.equal(wf(rule, [f, s]), 'fail');
    });
  }
  test('evaluacion-mensual: id repetido dentro del mes da fail en ambos órdenes', () => {
    const rule = RULE['evaluacion-mensual'];
    const s = runFor(rule, 7, 'success', { created_at: at(-60) });
    const f = runFor(rule, 7, 'timed_out', { created_at: at(-60) });
    assert.equal(wf(rule, [s, f]), 'fail');
    assert.equal(wf(rule, [f, s]), 'fail');
  });
  test('assessDeploy: id repetido con success y failure da fail en ambos órdenes', () => {
    const s = runFor({ event: 'push' }, 5, 'success');
    const f = runFor({ event: 'push' }, 5, 'failure');
    assert.equal(dep([s, f]), 'fail');
    assert.equal(dep([f, s]), 'fail');
  });
  test('id mayor sigue decidiendo: success id 6 sobre failure id 5 da ok (sin falsos rojos)', () => {
    const rule = RULE['ci-main'];
    assert.equal(wf(rule, [runFor(rule, 5, 'failure'), runFor(rule, 6, 'success')]), 'ok');
    assert.equal(dep([runFor({ event: 'push' }, 5, 'failure'), runFor({ event: 'push' }, 6, 'success')]), 'ok');
  });
});

const BAD_TIMES = [
  ['año 2099', '2099-01-01T00:00:00Z'],
  ['futuro justo fuera del margen', at(FUTURE_SKEW_MIN + 1)],
  ['vacío', ''],
  ['null', null],
  ['ausente', undefined],
  ['número', 12],
  ['objeto', { toString: () => T }],
  ['texto libre', 'March 1 2027'],
  ['solo fecha', '2027-05-10'],
  ['sin zona', '2027-05-10T14:00:00'],
  ['offset ilegible', '2027-05-10T14:00:00+99:99'],
  ['mes 13', '2027-13-01T00:00:00Z'],
  ['hora 24 de hoy (cae en el futuro)', '2027-05-10T24:00:00Z'],
];

describe('H-F17-02: created_at de los runs validado en assessWorkflow', () => {
  for (const rule of WORKFLOW_RULES) {
    for (const [name, value] of BAD_TIMES) {
      test(`${rule.check}: success con created_at ${name} y failure válido anterior → fail`, () => {
        const extra = value === undefined ? {} : { created_at: value };
        const bad = runFor(rule, 100, 'success', extra);
        if (value === undefined) delete bad.created_at;
        const older = runFor(rule, 1, 'failure', { created_at: at(-120) });
        assert.equal(wf(rule, [bad, older]), 'fail');
        assert.equal(wf(rule, [older, bad]), 'fail');
      });
      test(`${rule.check}: único completado con created_at ${name} → fail`, () => {
        const bad = runFor(rule, 100, 'success', { created_at: value });
        assert.equal(wf(rule, [bad]), 'fail');
      });
    }
  }
  test('seguridad-semanal: success en 2099 no tapa la antigüedad de un success viejo', () => {
    const rule = RULE['seguridad-semanal'];
    const old = runFor(rule, 1, 'success', { created_at: at(-9 * 24 * 60) });
    const fut = runFor(rule, 2, 'success', { created_at: '2099-01-01T00:00:00Z' });
    assert.equal(wf(rule, [fut, old]), 'fail');
    assert.equal(wf(rule, [old]), 'fail');
  });
  test('dentro del margen de reloj (FUTURE_SKEW_MIN) un success es aceptado', () => {
    const rule = RULE['seguridad-semanal'];
    assert.equal(wf(rule, [runFor(rule, 1, 'success', { created_at: at(FUTURE_SKEW_MIN - 1) })]), 'ok');
  });
  test('la fecha inválida en un run no completado, cancelado u omitido no da ok si el válido falló', () => {
    const rule = RULE['ci-main'];
    const failed = runFor(rule, 1, 'failure', { created_at: at(-120) });
    for (const noise of [
      runFor(rule, 9, null, { status: 'in_progress', created_at: '2099-01-01T00:00:00Z' }),
      runFor(rule, 9, 'cancelled', { created_at: 'basura' }),
      runFor(rule, 9, 'skipped', { created_at: 12 }),
      runFor(rule, 9, 'success', { event: 'pull_request', created_at: '2099-01-01T00:00:00Z' }),
    ]) {
      assert.equal(wf(rule, [noise, failed]), 'fail');
      assert.equal(wf(rule, [failed, noise]), 'fail');
    }
  });
});

describe('empates: permutaciones de un grupo hostil', () => {
  const groups = [
    ['id repetido + id texto', (r) => [runFor(r, 5, 'success'), runFor(r, 5, 'failure'), runFor(r, 'x', 'success'), runFor(r, 2 ** 60, 'success')]],
    ['id no entero no-success', (r) => [runFor(r, 9, 'success'), runFor(r, '10', 'failure'), runFor(r, 1.5, 'success')]],
    ['NaN e Infinity', (r) => [runFor(r, NaN, 'failure'), runFor(r, Infinity, 'success'), runFor(r, 3, 'success')]],
    ['tres iguales', (r) => [runFor(r, 4, 'success'), runFor(r, 4, 'success'), runFor(r, 4, 'startup_failure')]],
  ];
  for (const [name, make] of groups) {
    for (const rule of [RULE['ci-main'], RULE['seguridad-semanal']]) {
      test(`${rule.check}: ${name} → siempre fail en todos los órdenes`, () => {
        const seen = new Set(permutations(make(rule)).map((p) => wf(rule, p, { productionEnabled: false })));
        assert.deepEqual([...seen], ['fail']);
      });
    }
    test(`assessDeploy: ${name} → siempre fail en todos los órdenes`, () => {
      const seen = new Set(permutations(make({ event: 'push' })).map((p) => dep(p)));
      assert.deepEqual([...seen], ['fail']);
    });
  }
});

describe('fuzz determinista (oráculo independiente)', () => {
  const IDS = [1, 2, 3, 3, 7, '3', 'a', 1.5, NaN, null, 2 ** 60, -1];
  const CONC = ['success', 'success', 'failure', 'timed_out', 'cancelled', 'skipped', 'action_required'];
  const TIMES = [at(-30), at(-30), at(-90), at(-9 * 24 * 60), at(10), 'basura', null, '2027-05-10T14:00:00'];
  const okTime = (v) => typeof v === 'string' && /Z$/.test(v) && Date.parse(v) <= NOW_MS + FUTURE_SKEW_MIN * MIN;

  for (const rule of [RULE['ci-main'], RULE['seguridad-semanal']]) {
    test(`${rule.check}: ok ⇒ fechas válidas, el más reciente success y dentro de antigüedad`, () => {
      const rand = rng(0xf18 + rule.check.length);
      const pick = (a) => a[Math.floor(rand() * a.length)];
      for (let i = 0; i < 3000; i++) {
        const n = 1 + Math.floor(rand() * 5);
        const runs = Array.from({ length: n }, () =>
          runFor(rule, pick(IDS), pick(CONC), { created_at: pick(TIMES), status: rand() < 0.1 ? 'in_progress' : 'completed' }),
        );
        if (wf(rule, runs, { productionEnabled: false }) !== 'ok') continue;
        const done = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
        assert.ok(done.length > 0, 'ok sin completados');
        assert.ok(done.every((r) => okTime(r.created_at)), `ok con fecha inválida: ${JSON.stringify(runs)}`);
        const max = Math.max(...done.map((r) => Date.parse(r.created_at)));
        const group = done.filter((r) => Date.parse(r.created_at) === max);
        assert.ok(
          group.every((r) => Number.isSafeInteger(r.id) || r.conclusion === 'success'),
          `ok con no-success empatado sin id comparable: ${JSON.stringify(group)}`,
        );
        const safe = group.filter((r) => Number.isSafeInteger(r.id));
        if (safe.length > 0) {
          const top = Math.max(...safe.map((r) => r.id));
          assert.ok(safe.filter((r) => r.id === top).every((r) => r.conclusion === 'success'), `ok con id máximo no-success: ${JSON.stringify(group)}`);
        }
        if (rule.maxAgeHours) assert.ok((NOW_MS - max) / 3_600_000 <= rule.maxAgeHours, 'ok con run demasiado viejo');
      }
    });
  }
});

describe('checkWorkflows con respuestas de forma rara', () => {
  for (const [name, runs] of [
    ['objeto', {}],
    ['texto', 'x'],
    ['número', 1],
  ]) {
    test(`listRuns devuelve ${name} → fail en cada regla, sin excepción ni ok`, async () => {
      const github = {
        getWorkflow: async () => WF,
        listRuns: async () => runs,
        listJobs: async () => [],
      };
      const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW });
      assert.equal(out.length, WORKFLOW_RULES.length);
      for (const r of out) assert.notEqual(r.status, 'ok', `${r.check}: ${r.detail}`);
    });
  }
});

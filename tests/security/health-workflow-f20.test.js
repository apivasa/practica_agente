// F-20 — Seguridad de requiredStepProblem (vía assessWorkflow / checkWorkflows) tras H-F19-01/02.
// Categoría 5 (automatizaciones): con datos manipulados de la API de Actions el check de salud
// no puede dar un `ok` falso ni romperse sin fallar.
// - run_id: debe ser entero seguro e igual a candidate.id en TODOS los jobs (texto, float, null,
//   ausente, booleano, objeto, array, BigInt → fail).
// - candidate.id no entero (aunque coincida con run_id en texto) → fail.
// - steps: no array, entradas null o primitivas, nombre con caracteres de control, espacios,
//   mayúsculas o invisibles → no cuentan como el paso requerido → fail.
// - conclusion: cualquier cosa distinta de 'success' exacto en cualquier aparición → fail;
//   valores hostiles que no se pueden convertir a texto → excepción capturada → fail.
// - __proto__ en JSON: no contamina el prototipo ni aporta run_id/steps heredados.
// Sin red: el cliente de GitHub es un doble.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_RULES, assessWorkflow, checkWorkflows } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active', created_at: '2025-01-01T00:00:00Z' };
const at = (offsetMin) => new Date(NOW_MS + offsetMin * MIN).toISOString();
const STEP_RULES = WORKFLOW_RULES.filter((r) => r.requiredStep);

const runFor = (rule, id, extra = {}) => ({
  id,
  event: rule.event ?? 'schedule',
  status: 'completed',
  conclusion: 'success',
  created_at: at(-60),
  run_started_at: at(-60),
  updated_at: at(-59),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${String(id)}`,
  ...extra,
});
const job = (rule, runId, conclusion = 'success', extra = {}) => ({
  id: 9000 + Math.floor(Math.random() * 1000),
  run_id: runId,
  steps: [
    { name: 'Checkout', conclusion: 'success' },
    { name: rule.requiredStep, conclusion },
  ],
  ...extra,
});
const assess = (rule, run, jobs) =>
  assessWorkflow(rule, { workflow: WF, runs: [run], jobs, now: NOW, productionEnabled: true });

assert.ok(STEP_RULES.length > 0, 'debe haber reglas con requiredStep');

describe('F-20 control positivo', () => {
  for (const rule of STEP_RULES) {
    test(`${rule.check}: jobs con run_id del candidato y paso en success → ok`, () => {
      assert.equal(assess(rule, runFor(rule, 101), [job(rule, 101), job(rule, 101)]).status, 'ok');
    });
  }
});

describe('F-20 run_id manipulado → fail', () => {
  const hostile = [
    ['texto "101"', '101'],
    ['float 101.0000001', 101.0000001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['ausente', undefined],
    ['booleano true', true],
    ['array [101]', [101]],
    ['objeto con valueOf', { valueOf: () => 101 }],
    ['BigInt', 101n],
    ['entero no seguro', 2 ** 53 + 1],
    ['otro run', 102],
  ];
  for (const rule of STEP_RULES) {
    for (const [name, runId] of hostile) {
      test(`${rule.check}: un job con run_id ${name} (otro correcto) → fail`, () => {
        const bad = job(rule, 101);
        if (runId === undefined) delete bad.run_id;
        else bad.run_id = runId;
        assert.equal(assess(rule, runFor(rule, 101), [job(rule, 101), bad]).status, 'fail');
      });
    }
    test(`${rule.check}: candidate.id y run_id ambos texto "101" → fail`, () => {
      assert.equal(assess(rule, runFor(rule, '101'), [job(rule, '101')]).status, 'fail');
    });
    // Un run_id heredado por prototipo no puede llegar desde la API: res.json() solo crea
    // propiedades propias; el caso real (__proto__ en el JSON) se cubre a continuación.
    test(`${rule.check}: __proto__ en JSON no aporta run_id ni steps → fail`, () => {
      const parsed = JSON.parse(
        `{"__proto__": {"run_id": 101, "steps": [{"name": ${JSON.stringify(rule.requiredStep)}, "conclusion": "success"}]}}`,
      );
      assert.equal(assess(rule, runFor(rule, 101), [parsed]).status, 'fail');
      assert.equal({}.run_id, undefined, 'no debe contaminar Object.prototype');
    });
    test(`${rule.check}: jobs con entradas null o primitivas → fail`, () => {
      assert.equal(assess(rule, runFor(rule, 101), [job(rule, 101), null]).status, 'fail');
      assert.equal(assess(rule, runFor(rule, 101), [job(rule, 101), 'x']).status, 'fail');
    });
    test(`${rule.check}: jobs no array (objeto con length) → fail`, () => {
      assert.equal(assess(rule, runFor(rule, 101), { length: 1, 0: job(rule, 101) }).status, 'fail');
    });
  }
});

describe('F-20 steps y nombres manipulados → fail', () => {
  for (const rule of STEP_RULES) {
    const variants = [
      ['con salto de línea', `${rule.requiredStep}\n`],
      ['con carácter de control', `${rule.requiredStep}\u0000`],
      ['con espacio final', `${rule.requiredStep} `],
      ['con ancho cero', `${rule.requiredStep}​`],
      ['en mayúsculas', rule.requiredStep.toUpperCase()],
      ['con comando ::', `::error::${rule.requiredStep}`],
    ];
    for (const [name, stepName] of variants) {
      test(`${rule.check}: paso ${name} no cuenta como el requerido → fail`, () => {
        const j = { run_id: 101, steps: [{ name: stepName, conclusion: 'success' }] };
        assert.equal(assess(rule, runFor(rule, 101), [j]).status, 'fail');
      });
    }
    const badSteps = [
      ['steps objeto', { 0: { name: rule.requiredStep, conclusion: 'success' }, length: 1 }],
      ['steps texto', rule.requiredStep],
      ['steps null', null],
      ['steps con entradas null', [null, 1, 'x']],
    ];
    for (const [name, steps] of badSteps) {
      test(`${rule.check}: ${name} → fail`, () => {
        assert.equal(assess(rule, runFor(rule, 101), [{ run_id: 101, steps }]).status, 'fail');
      });
    }
    test(`${rule.check}: paso success en un job y ausente en otro (job sin steps) sigue ok solo si hay success`, () => {
      // Un job sin el paso no lo invalida (matrices con jobs auxiliares), pero sin ninguna aparición falla.
      assert.equal(assess(rule, runFor(rule, 101), [job(rule, 101), { run_id: 101, steps: [] }]).status, 'ok');
      assert.equal(assess(rule, runFor(rule, 101), [{ run_id: 101, steps: [] }]).status, 'fail');
    });
  }
});

describe('F-20 conclusion manipulada en cualquier aparición → fail', () => {
  const hostile = [
    ['null', null],
    ['ausente', undefined],
    ['SUCCESS en mayúsculas', 'SUCCESS'],
    ['" success" con espacio', ' success'],
    ['success con salto de línea', 'success\n'],
    ['booleano true', true],
    ['objeto con toString', { toString: () => 'success' }],
    ['array ["success"]', ['success']],
    ['failure', 'failure'],
    ['cancelled', 'cancelled'],
    ['neutral', 'neutral'],
    ['skipped en una pata de la matriz', 'skipped'],
  ];
  for (const rule of STEP_RULES) {
    for (const [name, conclusion] of hostile) {
      test(`${rule.check}: ${name} en una aparición (otra success) → fail`, () => {
        const bad = job(rule, 101);
        if (conclusion === undefined) delete bad.steps[1].conclusion;
        else bad.steps[1].conclusion = conclusion;
        assert.equal(assess(rule, runFor(rule, 101), [job(rule, 101), bad]).status, 'fail');
      });
    }
    test(`${rule.check}: conclusion no convertible a texto → check en fail, nunca ok`, async () => {
      const hostileConclusion = JSON.parse('{"toString": 1, "valueOf": 1}');
      const run = runFor(rule, 101);
      const github = {
        getWorkflow: async () => WF,
        listRuns: async () => [run],
        listJobs: async () => [job(rule, 101), job(rule, 101, hostileConclusion)],
      };
      const out = await checkWorkflows({ env: { EVALUATION_ENABLED: 'true' }, github, now: NOW, rules: [rule] });
      assert.equal(out.length, 1);
      assert.equal(out[0].status, 'fail');
    });
  }
});

describe('F-20 mensajes sin secretos', () => {
  for (const rule of STEP_RULES) {
    test(`${rule.check}: el detalle no incluye campos ajenos del job (token, headers)`, () => {
      const j = job(rule, 101, 'failure', { token: 'ghs_EXAMPLEFAKE', headers: { authorization: 'Bearer ghs_EXAMPLEFAKE' } });
      const r = assess(rule, runFor(rule, 101), [j]);
      assert.equal(r.status, 'fail');
      assert.ok(!r.detail.includes('ghs_'), r.detail);
    });
  }
});

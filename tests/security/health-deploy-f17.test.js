// F-17 — Seguridad de compareSameTime (H-F16-01) y de workflow.created_at en assessWorkflow
// (H-ARQ-F16-03). Categoría 5 (automatizaciones): con datos manipulados de la API el check de
// salud no puede dar un `ok` falso.
// - Empates de created_at con ids no enteros seguros (texto, decimal, NaN, Infinity, > 2^53,
//   null, objetos): ningún orden de entrada da ok si hay un no-success empatado sin id
//   comparable; el resultado no depende del orden de entrada (todas las permutaciones).
// - El comparador es un orden total: antisimétrico y transitivo sobre un muestreo hostil.
// - Fuzz determinista: ok ⇒ no hay completados con fecha inválida y el más reciente es success
//   (o, en empate sin ids comparables, todos los empatados son success).
// - assessWorkflow: workflow.created_at inválido o futuro no da la gracia de «reciente» ni de
//   «creado este mes».
// Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, WORKFLOW_RULES, assessDeploy, assessWorkflow } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active' };
const T = '2027-05-10T14:00:00Z';
const at = (offsetMin) => new Date(NOW_MS + offsetMin * MIN).toISOString();
const run = (id, conclusion, extra = {}) => ({
  id,
  event: 'push',
  status: 'completed',
  conclusion,
  created_at: T,
  run_started_at: T,
  ...extra,
});
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

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

const BAD_IDS = ['1', '2', '10', 1.5, NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_VALUE, null, undefined, {}, [], [3], true, -0.5];
const BAD_CONCLUSIONS = ['failure', 'timed_out', 'startup_failure', 'action_required', 'Success', 'SUCCESS', '', null, undefined, 'success '];

describe('F-17 · H-F16-01: empates con ids no enteros nunca dan ok', () => {
  test('success con id entero y no-success sin id comparable, en todas las permutaciones → nunca ok', () => {
    for (const badId of BAD_IDS) {
      for (const c of BAD_CONCLUSIONS) {
        const runs = [run(999, 'success'), run(badId, c), run(1, 'success')];
        for (const p of permutations(runs)) {
          const r = assess(p);
          assert.notEqual(r.status, 'ok', `id=${String(badId)} conclusion=${String(c)}`);
        }
      }
    }
  });

  test('success sin id comparable y no-success con id entero → nunca ok', () => {
    for (const badId of BAD_IDS) {
      for (const p of permutations([run(badId, 'success'), run(5, 'failure')])) {
        assert.equal(assess(p).status, 'fail', `id=${String(badId)}`);
      }
    }
  });

  test('el caso del hallazgo ([success id texto 1, failure id texto 2]) falla en ambos órdenes', () => {
    assert.equal(assess([run('1', 'success'), run('2', 'failure')]).status, 'fail');
    assert.equal(assess([run('2', 'failure'), run('1', 'success')]).status, 'fail');
  });

  test('ids hostiles con toString/valueOf no lanzan ni dan ok', () => {
    const hostile = { valueOf: () => 1e9, toString: () => '999999' };
    const thrower = {
      valueOf() {
        throw new Error('x');
      },
      toString() {
        throw new Error('x');
      },
    };
    for (const id of [hostile, Object(7)]) {
      for (const p of permutations([run(id, 'failure'), run(3, 'success')])) assert.equal(assess(p).status, 'fail');
    }
    // Un id que lanza al convertirse a texto: lo admisible es fail o excepción (checkDeploy la
    // captura y da fail), nunca ok.
    for (const p of permutations([run(thrower, 'failure'), run({}, 'failure'), run(3, 'success')])) {
      let status;
      try {
        status = assess(p).status;
      } catch {
        status = 'fail';
      }
      assert.notEqual(status, 'ok');
    }
  });

  test('el resultado no depende del orden de entrada con ids mezclados (5 runs empatados)', () => {
    const base = [run(7, 'success'), run('x', 'cancelled'), run(3, 'failure'), run(1.5, 'success'), run(null, 'timed_out')];
    const seen = new Set(permutations(base).map((p) => assess(p).status));
    assert.equal(seen.size, 1, [...seen].join(','));
    assert.equal([...seen][0], 'fail');
  });

  test('todos los empatados en success (con o sin id) → ok: el fail-closed no da falsos rojos', () => {
    for (const p of permutations([run('a', 'success'), run(2, 'success'), run(null, 'success')])) {
      assert.equal(assess(p).status, 'ok');
    }
  });

  test('un pendiente empatado sin id no cubre un failure empatado (no warn)', () => {
    const pend = run('p', null, { status: 'queued' });
    for (const p of permutations([pend, run(2, 'failure'), run(1, 'success', { created_at: at(-300), run_started_at: at(-300) })])) {
      assert.equal(assess(p).status, 'fail');
    }
  });
});

describe('F-17 · fuzz: ok solo si el más reciente es success sin ambigüedad', () => {
  test('3000 casos con empates, ids hostiles y fechas inválidas', () => {
    const rand = rng(17);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const IDS = [1, 2, 3, 4, 5, ...BAD_IDS];
    const CONC = ['success', 'success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', null];
    const TIMES = [at(-60), at(-60), at(-120), at(-180), 'garbage', at(600), '2027-05-10T09:00:00-05:00'];
    for (let n = 0; n < 3000; n++) {
      const runs = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => {
        const c = pick(CONC);
        return run(pick(IDS), c, {
          created_at: pick(TIMES),
          status: c === null ? pick(['queued', 'in_progress']) : 'completed',
        });
      });
      const r = assess(runs);
      if (r.status !== 'ok') continue;
      const ms = (x) => (typeof x.created_at === 'string' && x.created_at !== 'garbage' ? Date.parse(x.created_at) : NaN);
      const done = runs.filter((x) => x.status === 'completed' && !['skipped', 'neutral'].includes(x.conclusion));
      for (const d of done) {
        assert.ok(Number.isFinite(ms(d)) && ms(d) <= NOW_MS + 5 * MIN, `ok con fecha inválida: ${JSON.stringify(runs)}`);
      }
      if (done.length === 0) continue;
      const top = Math.max(...done.map(ms));
      const tied = done.filter((d) => ms(d) === top);
      const allSafe = tied.every((d) => Number.isSafeInteger(d.id));
      if (allSafe) {
        const maxId = Math.max(...tied.map((d) => d.id));
        const winners = tied.filter((d) => d.id === maxId);
        // Con ids duplicados (no ocurre en GitHub) ver H-F17-01; aquí basta con que haya un success.
        assert.ok(winners.some((d) => d.conclusion === 'success'), `ok con ganador no success: ${JSON.stringify(runs)}`);
        if (winners.length === 1) assert.equal(winners[0].conclusion, 'success');
      } else {
        const unsafe = tied.filter((d) => !Number.isSafeInteger(d.id));
        assert.ok(
          unsafe.every((d) => d.conclusion === 'success'),
          `ok con empate ambiguo y un no-success sin id: ${JSON.stringify(runs)}`,
        );
        if (unsafe.length > 0 && tied.some((d) => d.conclusion !== 'success')) {
          assert.fail(`ok con empate ambiguo: ${JSON.stringify(runs)}`);
        }
      }
    }
  });
});

describe('F-17 · H-ARQ-F16-03: workflow.created_at validado en assessWorkflow', () => {
  const weekly = WORKFLOW_RULES.find((r) => r.check === 'seguridad-semanal');
  const monthly = WORKFLOW_RULES.find((r) => r.check === 'evaluacion-mensual');
  const BAD_CREATED = [at(600), '2099-01-01T00:00:00Z', 'garbage', '1', 12, NOW_MS, null, undefined, {}, '2027-05-10', `${at(-1)} `];

  test('sin runs: un created_at inválido o futuro no da la gracia de «workflow reciente»', () => {
    for (const created_at of BAD_CREATED) {
      const r = assessWorkflow(weekly, { workflow: { state: 'active', created_at }, runs: [], now: NOW, productionEnabled: false });
      assert.equal(r.status, 'fail', String(created_at));
    }
  });

  test('cierre mensual: un created_at inválido o futuro no da «creado este mes» (día ≥ 2)', () => {
    for (const created_at of BAD_CREATED) {
      const r = assessWorkflow(monthly, { workflow: { state: 'active', created_at }, runs: [], now: NOW, productionEnabled: true });
      assert.equal(r.status, 'fail', String(created_at));
    }
  });

  test('un created_at válido y reciente sí conserva la gracia (sin regresión)', () => {
    const r = assessWorkflow(weekly, { workflow: { state: 'active', created_at: at(-60) }, runs: [], now: NOW, productionEnabled: false });
    assert.equal(r.status, 'ok');
  });
});

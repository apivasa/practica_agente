// F-15 — Seguridad de assessDeploy tras H-F14-01 (scripts/health/lib.js).
// Categoría 5 (automatizaciones): con runs manipulados (fechas futuras, nulas, de tipo raro,
// orden de entrada arbitrario) el check deploy-main no puede dar un falso `ok` ni `warn`.
// - Un completado (no omitido) con created_at inválido o futuro → fail, en cualquier posición.
// - El orden de la entrada no cambia el resultado.
// - Un pendiente con fecha inválida no cubre un fallo, no da ok por sí solo y no cuenta como
//   atascado (decisión de F-15 para respetar qa-v04b).
// - Invariante (fuzz determinista): si el resultado es ok, el completado más reciente con
//   fecha válida es success y no hay ningún completado con fecha inválida.
// Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, FUTURE_SKEW_MIN, assessDeploy } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const WF = { state: 'active' };
const at = (offsetMin) => new Date(NOW_MS + offsetMin * MIN).toISOString();
const run = (id, minAgo, extra = {}) => ({
  id,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  created_at: at(-minAgo),
  run_started_at: at(-minAgo),
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/${id}`,
  ...extra,
});
const pending = (id, minAgo, extra = {}) => run(id, minAgo, { status: 'queued', conclusion: null, ...extra });
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

// PRNG determinista (mulberry32) para permutaciones y fuzz reproducibles.
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
function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const INVALID_TIMES = [null, undefined, '', '   ', 12, NOW_MS, {}, [], 'no-fecha', 'NaN'];
const FUTURE_TIMES = [at(FUTURE_SKEW_MIN + 1), at(600), at(60 * 24 * 365)];

describe('F-15 · H-F14-01: completado con fecha inválida o futura → fail', () => {
  test('reproducción: success futuro sobre una cadena de failure → fail en cualquier orden', () => {
    const base = [run(3, 0, { created_at: at(600) }), run(2, 60, { conclusion: 'failure' }), run(1, 300, { conclusion: 'failure' })];
    const rand = rng(15);
    for (let i = 0; i < 30; i++) {
      const r = assess(shuffle(base, rand));
      assert.equal(r.status, 'fail');
      assert.match(r.detail, /runs\/3/);
    }
  });

  for (const conclusion of ['success', 'failure', 'cancelled', 'timed_out', null]) {
    test(`completado ${conclusion} con fecha inválida/futura sobre historial sano → fail`, () => {
      for (const bad of [...INVALID_TIMES, ...FUTURE_TIMES]) {
        const b = run(9, 0, { conclusion, created_at: bad });
        assert.equal(assess([b, run(1, 30)]).status, 'fail', `inicio ${JSON.stringify(bad)}`);
        assert.equal(assess([run(1, 30), b]).status, 'fail', `final ${JSON.stringify(bad)}`);
        assert.equal(assess([run(2, 10), b, run(1, 30)]).status, 'fail', `medio ${JSON.stringify(bad)}`);
      }
    });
  }

  test('el completado inválido no se oculta tras un pendiente reciente que cubriría un fallo aislado', () => {
    const r = assess([pending(4, 2), run(3, 10, { conclusion: 'failure' }), run(2, 0, { created_at: at(600) }), run(1, 60)]);
    assert.equal(r.status, 'fail');
  });

  test('el completado inválido no se oculta tras un último cancelado (sería warn)', () => {
    const r = assess([run(3, 5, { conclusion: 'cancelled' }), run(2, 0, { created_at: null }), run(1, 60)]);
    assert.equal(r.status, 'fail');
  });

  test('justo dentro del margen de reloj se acepta; justo fuera, no', () => {
    assert.equal(assess([run(2, -(FUTURE_SKEW_MIN - 1)), run(1, 60)]).status, 'ok');
    assert.equal(assess([run(2, -(FUTURE_SKEW_MIN + 1)), run(1, 60)]).status, 'fail');
  });

  test('omitidos (skipped/neutral) con fecha inválida no deciden: un failure real sigue fallando', () => {
    for (const conclusion of ['skipped', 'neutral']) {
      const r = assess([run(3, 0, { conclusion, created_at: at(600) }), run(2, 30, { conclusion: 'failure' }), run(1, 90)]);
      assert.equal(r.status, 'fail', conclusion);
    }
  });

  test('runs de otro evento con fecha inválida no afectan', () => {
    assert.equal(assess([run(2, 0, { event: 'pull_request', created_at: at(600) }), run(1, 30)]).status, 'ok');
  });
});

describe('F-15 · pendientes con fecha inválida', () => {
  test('no cubren un fallo aislado (fail, no warn)', () => {
    for (const bad of [...INVALID_TIMES, ...FUTURE_TIMES]) {
      const p1 = pending(5, 2, { created_at: bad });
      assert.equal(assess([p1, run(2, 10, { conclusion: 'failure' }), run(1, 60)]).status, 'fail', `created ${JSON.stringify(bad)}`);
      if (bad === null || bad === undefined || bad === '') continue; // vacío → usa created_at (válido)
      const p2 = pending(6, 2, { run_started_at: bad });
      assert.equal(assess([p2, run(2, 10, { conclusion: 'failure' }), run(1, 60)]).status, 'fail', `started ${JSON.stringify(bad)}`);
    }
  });

  test('no convierten en ok una cadena de fallos ni lanzan', () => {
    for (const bad of [...INVALID_TIMES, ...FUTURE_TIMES]) {
      const r = assess([pending(5, 2, { created_at: bad }), run(2, 10, { conclusion: 'failure' }), run(1, 60, { conclusion: 'failure' })]);
      assert.equal(r.status, 'fail');
    }
  });

  test('un atascado con fechas válidas sigue detectándose aunque haya pendientes inválidos', () => {
    const r = assess([pending(7, 2, { created_at: at(600) }), pending(6, DEPLOY_RULE.maxPendingMin + 30), run(1, 300)]);
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /runs\/6/);
  });
});

describe('F-15 · orden de entrada y fuzz', () => {
  test('el resultado no depende del orden de entrada (fechas distintas)', () => {
    const sets = [
      [run(4, 0, { created_at: at(600) }), run(3, 20, { conclusion: 'failure' }), run(2, 40), pending(5, 1)],
      [run(3, 5, { conclusion: 'cancelled' }), run(2, 20, { conclusion: 'failure' }), run(1, 60)],
      [pending(4, 2), run(3, 10, { conclusion: 'failure' }), run(2, 30), run(1, 60, { conclusion: 'failure' })],
      [run(3, 10), run(2, 20, { conclusion: 'failure', created_at: null }), run(1, 30)],
    ];
    const rand = rng(1515);
    for (const s of sets) {
      const expected = assess(s).status;
      for (let i = 0; i < 25; i++) assert.equal(assess(shuffle(s, rand)).status, expected);
    }
  });

  test('fuzz: ok ⇒ sin completados inválidos y el completado válido más reciente es success', () => {
    const rand = rng(20270510);
    const conclusions = ['success', 'success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', null];
    const statuses = ['completed', 'completed', 'completed', 'queued', 'in_progress', 'waiting'];
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const okTime = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Date.parse(v) <= NOW_MS + FUTURE_SKEW_MIN * MIN;
    let oks = 0;
    for (let n = 0; n < 3000; n++) {
      const len = 1 + Math.floor(rand() * 6);
      const runs = [];
      for (let i = 0; i < len; i++) {
        const status = pick(statuses);
        const minAgo = Math.floor(rand() * 400);
        const created = rand() < 0.2 ? pick([...INVALID_TIMES, ...FUTURE_TIMES]) : at(-minAgo);
        runs.push(run(i + 1, minAgo, { status, conclusion: status === 'completed' ? pick(conclusions) : null, created_at: created }));
      }
      const r = assess(runs);
      if (r.status !== 'ok') continue;
      oks++;
      const done = runs.filter((x) => x.status === 'completed' && !['skipped', 'neutral'].includes(x.conclusion));
      assert.ok(done.every((x) => okTime(x.created_at)), `ok con completado inválido: ${JSON.stringify(runs)}`);
      const newest = done.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (newest) assert.equal(newest.conclusion, 'success', `ok con último ${newest.conclusion}: ${JSON.stringify(runs)}`);
    }
    assert.ok(oks > 50, `el fuzz debe ejercitar casos ok (${oks})`);
  });
});

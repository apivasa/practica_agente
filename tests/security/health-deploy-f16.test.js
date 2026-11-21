// F-16 — Seguridad de parseApiTime / assessDeploy tras H-F15-01..03 (scripts/health/lib.js).
// Categoría 5 (automatizaciones): con runs manipulados el check deploy-main no puede dar un
// falso `ok` ni `warn`.
// - API_TIME_RE: solo ISO 8601 con fecha, hora y zona; formatos límite rechazados; sin ReDoS.
// - Empates de created_at con ids enteros: el resultado no depende del orden de entrada.
// - Instantes iguales escritos con offsets distintos cuentan como empate (deciden los ids).
// - Pendiente con run_started_at ilegible o futuro: el atasco se mide con created_at y no
//   cubre un fallo.
// - Fuzz determinista con empates: ok ⇒ el completado más reciente por (created_at, id) es
//   success y no hay completados con fecha inválida.
// Sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { API_TIME_RE, DEPLOY_RULE, FUTURE_SKEW_MIN, assessDeploy, newerPendingRun, parseApiTime } from '../../scripts/health/lib.js';

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
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('F-16 · H-F15-01: API_TIME_RE y parseApiTime', () => {
  const VALID = at(-60);
  const BAD = [
    '1',
    '2001',
    'March 1 2001',
    '2027-05-10',
    '2027-05-10T14:00:00',
    '2027-05-10T14:00Z',
    '2027-05-10 14:00:00Z',
    '2027-05-10t14:00:00Z',
    '2027-05-10T14:00:00z',
    '2027-05-10T14:00:00+0500',
    '2027-05-10T14:00:00+05',
    '2027-05-10T14:00:00 GMT',
    '2027-05-10T14:00:00.Z',
    '2027-05-10T14:00:00.1234567890Z',
    '+02027-05-10T14:00:00Z',
    '-002027-05-10T14:00:00Z',
    '27-05-10T14:00:00Z',
    '2027-5-10T14:00:00Z',
    `${VALID}\n`,
    `\n${VALID}`,
    ` ${VALID}`,
    `${VALID} `,
    `${VALID}\u0000`,
    `${VALID}x`,
    '２０２７-05-10T14:00:00Z', // dígitos de ancho completo
    '٢٠٢٧-05-10T14:00:00Z', // dígitos arábigo-índicos
    '2027-13-01T00:00:00Z',
    '2027-05-10T25:00:00Z',
    '2027-05-10T14:60:00Z',
    '2027-05-10T14:00:60Z',
    '2027-05-10T14:00:00+24:00',
    '2027-05-10T14:00:00+99:99',
    'Mon, 10 May 2027 14:00:00 GMT',
  ];

  test('formatos límite → NaN', () => {
    for (const bad of BAD) assert.ok(Number.isNaN(parseApiTime(bad, NOW_MS)), JSON.stringify(bad));
  });

  test('tipos no string → NaN (incluidos objetos con toString/valueOf hostiles)', () => {
    const hostile = { toString: () => VALID, valueOf: () => NOW_MS - 60 * MIN };
    const boxed = Object(VALID);
    for (const bad of [null, undefined, 12, NOW_MS, NaN, true, {}, [], [VALID], hostile, boxed, new Date(NOW_MS)]) {
      assert.ok(Number.isNaN(parseApiTime(bad, NOW_MS)), String(bad));
    }
  });

  test('forma de la API de GitHub y offsets equivalentes → mismo instante', () => {
    assert.equal(parseApiTime('2027-05-10T14:00:00Z', NOW_MS), NOW_MS - 60 * MIN);
    assert.equal(parseApiTime('2027-05-10T09:00:00-05:00', NOW_MS), NOW_MS - 60 * MIN);
    assert.equal(parseApiTime('2027-05-10T19:00:00+05:00', NOW_MS), NOW_MS - 60 * MIN);
    assert.equal(parseApiTime('2027-05-10T14:00:00.5Z', NOW_MS), NOW_MS - 60 * MIN + 500);
  });

  test('un futuro escrito con offset no esquiva el margen de reloj', () => {
    // 15:06Z escrito como 10:06-05:00 y como 20:06+05:00.
    for (const s of ['2027-05-10T15:06:00Z', '2027-05-10T10:06:00-05:00', '2027-05-10T20:06:00+05:00']) {
      assert.ok(Number.isNaN(parseApiTime(s, NOW_MS)), s);
    }
    assert.ok(Number.isFinite(parseApiTime(at(FUTURE_SKEW_MIN - 1), NOW_MS)));
  });

  test('sin ReDoS: entradas de 1 MB se evalúan en tiempo lineal', () => {
    const inputs = [
      '9'.repeat(1 << 20),
      `2027-05-10T14:00:00.${'1'.repeat(1 << 20)}Z`,
      `2027-05-10T14:00:00${'+00:00'.repeat(1 << 17)}`,
      `${'2027-05-10T14:00:00Z'.repeat(1 << 15)}`,
    ];
    const t0 = process.hrtime.bigint();
    for (const s of inputs) assert.equal(API_TIME_RE.test(s), false);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 500, `regex lenta: ${ms} ms`);
  });

  test('el regex no tiene estado (sin flag g/y): llamadas repetidas dan lo mismo', () => {
    assert.equal(API_TIME_RE.global || API_TIME_RE.sticky, false);
    for (let i = 0; i < 5; i++) assert.equal(API_TIME_RE.test(VALID), true);
  });

  test('un failure con fecha no ISO no queda detrás de un success viejo (fail, no ok)', () => {
    for (const bad of BAD) {
      const r = assess([run(2, 0, { conclusion: 'failure', created_at: bad }), run(1, 300)]);
      assert.equal(r.status, 'fail', JSON.stringify(bad));
    }
  });

  test('newerPendingRun: un pendiente con fecha no ISO no cubre; un failed no ISO no es cubrible', () => {
    const failed = run(1, 60, { conclusion: 'failure' });
    for (const bad of BAD) {
      assert.equal(newerPendingRun([pending(2, 5, { created_at: bad, run_started_at: bad })], failed, NOW_MS, 90), null, JSON.stringify(bad));
      assert.equal(newerPendingRun([pending(2, 5)], { ...failed, created_at: bad }, NOW_MS, 90), null, JSON.stringify(bad));
      assert.equal(assess([pending(3, 2, { created_at: bad }), failed, run(0, 300)]).status, 'fail', JSON.stringify(bad));
    }
  });
});

describe('F-16 · H-F15-02: empates de created_at', () => {
  const T = at(-60);

  test('reproducción: [success, failure] con el mismo created_at → fail en cualquier orden', () => {
    const s = run(10, 0, { created_at: T });
    const f = run(11, 0, { created_at: T, conclusion: 'failure' });
    for (const p of permutations([s, f, run(1, 300)])) assert.equal(assess(p).status, 'fail');
  });

  test('empate de 4 completados: decide el id mayor, sin depender del orden (24 permutaciones)', () => {
    const cases = [
      { set: [['success', 1], ['success', 2], ['failure', 4], ['success', 3]], expected: 'fail' },
      { set: [['failure', 1], ['failure', 2], ['success', 4], ['timed_out', 3]], expected: 'ok' },
      { set: [['success', 1], ['failure', 2], ['cancelled', 4], ['success', 3]], expected: 'warn' },
      { set: [['failure', 1], ['failure', 2], ['cancelled', 4], ['success', 3]], expected: 'warn' },
      { set: [['success', 1], ['failure', 2], ['cancelled', 4], ['failure', 3]], expected: 'fail' },
    ];
    for (const { set, expected } of cases) {
      const runs = set.map(([conclusion, id]) => run(id, 0, { created_at: T, conclusion }));
      for (const p of permutations(runs)) assert.equal(assess(p).status, expected, JSON.stringify(set));
    }
  });

  test('el mismo instante escrito con offsets distintos es empate y lo decide el id', () => {
    const s = run(20, 0, { created_at: '2027-05-10T09:00:00-05:00' });
    const f = run(21, 0, { created_at: '2027-05-10T14:00:00Z', conclusion: 'failure' });
    for (const p of permutations([s, f])) assert.equal(assess(p).status, 'fail');
    const f2 = run(20, 0, { created_at: '2027-05-10T19:00:00+05:00', conclusion: 'failure' });
    const s2 = run(21, 0, { created_at: '2027-05-10T14:00:00Z' });
    for (const p of permutations([s2, f2])) assert.equal(assess(p).status, 'ok');
  });

  test('un pendiente empatado con el failure no lo cubre (created_at debe ser estrictamente mayor)', () => {
    const f = run(30, 10, { conclusion: 'failure' });
    const p = pending(31, 10);
    for (const perm of permutations([p, f, run(1, 300)])) assert.equal(assess(perm).status, 'fail');
  });

  test('ids muy grandes pero seguros (> 2^31) ordenan bien', () => {
    const big = 2 ** 40;
    const s = run(big, 0, { created_at: T });
    const f = run(big + 1, 0, { created_at: T, conclusion: 'failure' });
    for (const p of permutations([s, f])) assert.equal(assess(p).status, 'fail');
  });
});

describe('F-16 · H-F15-03: run_started_at ilegible o futuro', () => {
  const BAD_STARTED = ['x', 12, {}, [], 'March 1 2001', '2027-05-10T14:00:00', at(600), at(FUTURE_SKEW_MIN + 1)];

  test('pendiente viejo con run_started_at malo → atascado (fail), medido con created_at', () => {
    for (const bad of BAD_STARTED) {
      const r = assess([pending(2, DEPLOY_RULE.maxPendingMin + 40, { run_started_at: bad }), run(1, 600)]);
      assert.equal(r.status, 'fail', JSON.stringify(bad));
      assert.match(r.detail, new RegExp(`${DEPLOY_RULE.maxPendingMin + 40} min en queued`));
    }
  });

  test('pendiente reciente con run_started_at malo: no atascado y no cubre un fallo aislado', () => {
    for (const bad of BAD_STARTED) {
      assert.equal(assess([pending(3, 5, { run_started_at: bad }), run(1, 600)]).status, 'ok', JSON.stringify(bad));
      assert.equal(
        assess([pending(3, 5, { run_started_at: bad }), run(2, 30, { conclusion: 'failure' }), run(1, 600)]).status,
        'fail',
        JSON.stringify(bad),
      );
    }
  });

  test('un run_started_at muy antiguo no esconde nada (sigue midiendo con él)', () => {
    const r = assess([pending(2, 5, { run_started_at: at(-(DEPLOY_RULE.maxPendingMin + 10)) }), run(1, 600)]);
    assert.equal(r.status, 'fail');
  });
});

describe('F-16 · fuzz con empates', () => {
  test('ok ⇒ sin completados inválidos y el más reciente por (created_at, id) es success', () => {
    const rand = rng(16_2027);
    const conclusions = ['success', 'success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral'];
    const statuses = ['completed', 'completed', 'completed', 'queued', 'in_progress'];
    const slots = [0, 0, 10, 10, 30, 120, 400]; // minutos: muchos empates
    const bad = ['1', 'March 1 2001', '2027-05-10', at(600), null, 12, `${at(-5)} `];
    const pick = (list) => list[Math.floor(rand() * list.length)];
    let oks = 0;
    for (let n = 0; n < 4000; n++) {
      const len = 1 + Math.floor(rand() * 6);
      const runs = [];
      for (let i = 0; i < len; i++) {
        const status = pick(statuses);
        const minAgo = pick(slots);
        const created = rand() < 0.15 ? pick(bad) : at(-minAgo);
        const started = rand() < 0.15 ? pick(bad) : created;
        runs.push(run(n * 10 + i + 1, minAgo, { status, conclusion: status === 'completed' ? pick(conclusions) : null, created_at: created, run_started_at: started }));
      }
      // Orden de entrada aleatorio.
      for (let i = runs.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [runs[i], runs[j]] = [runs[j], runs[i]];
      }
      const r = assess(runs);
      if (r.status !== 'ok') continue;
      oks++;
      const done = runs.filter((x) => x.status === 'completed' && !['skipped', 'neutral'].includes(x.conclusion));
      assert.ok(done.every((x) => Number.isFinite(parseApiTime(x.created_at, NOW_MS))), `ok con completado inválido: ${JSON.stringify(runs)}`);
      const newest = done.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
      if (newest) assert.equal(newest.conclusion, 'success', `ok con último ${newest.conclusion}: ${JSON.stringify(runs)}`);
    }
    assert.ok(oks > 100, `el fuzz debe ejercitar casos ok (${oks})`);
  });
});

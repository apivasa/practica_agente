// QA F-17 — pruebas adversariales del tester (no escribió el código).
// Trazan a docs/plan-maestro.md fila F-17:
//  (1) H-F16-01/QA-F16-02: empate de created_at con algún id no entero seguro nunca da ok
//      (el no-success va primero), independiente del orden de entrada; comparador transitivo.
//  (2) H-ARQ-F16-03: assessWorkflow lee workflow.created_at con parseApiTime (fail-closed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, WORKFLOW_RULES, FUTURE_SKEW_MIN, assessDeploy, assessWorkflow } from '../../scripts/health/lib.js';

const NOW = new Date('2027-03-20T12:00:00Z');
const MIN = 60_000;
const WF = { state: 'active', created_at: '2026-11-01T00:00:00Z' };
const T = new Date(NOW.getTime() - 30 * MIN).toISOString();
const OLDER = new Date(NOW.getTime() - 120 * MIN).toISOString();
let seq = 0;
const run = (id, conclusion = 'success', created = T, status = 'completed') => ({
  id,
  status,
  conclusion: status === 'completed' ? conclusion : null,
  event: 'push',
  created_at: created,
  run_started_at: created,
  html_url: `https://github.com/apivasa/practica_agente/actions/runs/q${++seq}`,
});
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

// PRNG determinista (mulberry32) para que un fallo sea reproducible.
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
const pick = (r, list) => list[Math.floor(r() * list.length)];
function shuffle(r, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const UNSAFE_IDS = [1.5, -0.5, 2 ** 53, 2 ** 53 + 2, Number.NaN, Infinity, -Infinity, undefined, null, '', '1', '99', 'abc', 10n, {}, [], true];
const SAFE_IDS = [0, 1, 2, 3, 7, 42, -1, Number.MAX_SAFE_INTEGER];
const CONCLUSIONS = ['success', 'success', 'failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'skipped', 'neutral'];

test('QA-F17 (1): empate failure sin id seguro vs success con id seguro → fail, en ambos órdenes', () => {
  for (const bad of UNSAFE_IDS) {
    for (const good of SAFE_IDS) {
      const f = run(bad, 'failure');
      const s = run(good, 'success');
      assert.equal(assess([s, f]).status, 'fail', `failure id=${String(bad)} vs success id=${good}`);
      assert.equal(assess([f, s]).status, 'fail', `failure id=${String(bad)} vs success id=${good} (invertido)`);
    }
  }
});

test('QA-F17 (1): empate success sin id seguro vs failure con id seguro → fail, en ambos órdenes', () => {
  for (const bad of UNSAFE_IDS) {
    for (const good of SAFE_IDS) {
      const s = run(bad, 'success');
      const f = run(good, 'failure');
      assert.equal(assess([s, f]).status, 'fail', `success id=${String(bad)} vs failure id=${good}`);
      assert.equal(assess([f, s]).status, 'fail', `invertido id=${String(bad)}/${good}`);
    }
  }
});

test('QA-F17 (1): conclusiones no-success distintas de failure (timed_out, startup_failure, action_required) también ganan el empate', () => {
  for (const c of ['timed_out', 'startup_failure', 'action_required']) {
    for (const ids of [[undefined, 5], [5, undefined], ['x', 'y']]) {
      const bad = run(ids[0], c);
      const s = run(ids[1], 'success');
      assert.equal(assess([s, bad]).status, 'fail', `${c} ${String(ids)}`);
      assert.equal(assess([bad, s]).status, 'fail', `${c} ${String(ids)} invertido`);
    }
  }
});

test('QA-F17 (1): cancelado sin id empatado con success → no ok (warn); con failure detrás → fail', () => {
  const c = run(undefined, 'cancelled');
  const s = run(9, 'success');
  for (const runs of [[c, s], [s, c]]) assert.equal(assess(runs).status, 'warn');
  const f = run(8, 'failure', OLDER);
  for (const runs of [[c, s, f], [f, s, c], [s, f, c]]) assert.notEqual(assess(runs).status, 'ok');
});

test('QA-F17 (1): un fallo empatado sin id no queda oculto por un run más viejo en success ni por el resto de la página', () => {
  const runs = [run(100, 'success', OLDER), run(101, 'success', OLDER), run('z', 'failure'), run(200, 'success'), run(201, 'success')];
  const r = rng(7);
  for (let i = 0; i < 50; i++) assert.equal(assess(shuffle(r, runs)).status, 'fail');
});

test('QA-F17 (1): propiedad — 3000 páginas aleatorias: estado invariante al orden y nunca ok si el posible más reciente es no-success', () => {
  const r = rng(20261121);
  for (let iter = 0; iter < 3000; iter++) {
    const n = 2 + Math.floor(r() * 5);
    const runs = [];
    // La API da ids únicos: en esta propiedad no se repiten los enteros seguros dentro de
    // una página (el id repetido es QA-F17-01, prueba aparte).
    const freeSafe = shuffle(r, SAFE_IDS);
    for (let k = 0; k < n; k++) {
      const id = r() < 0.5 ? pick(r, UNSAFE_IDS) : freeSafe.pop();
      const created = r() < 0.75 ? T : OLDER;
      runs.push(run(id, pick(r, CONCLUSIONS), created));
    }
    const base = assess(runs).status;
    for (let p = 0; p < 6; p++) {
      assert.equal(assess(shuffle(r, runs)).status, base, `iter ${iter}: el estado depende del orden de entrada: ${JSON.stringify(runs.map((x) => [String(x.id), typeof x.id, x.conclusion, x.created_at === T ? "T" : "OLD"]))}`);
    }
    // Oráculo: grupo más reciente de completados relevantes (sin skipped/neutral).
    const done = runs.filter((x) => !['skipped', 'neutral'].includes(x.conclusion));
    if (done.length === 0) continue;
    const top = done.some((x) => x.created_at === T) ? T : OLDER;
    const group = done.filter((x) => x.created_at === top);
    if (group.length < 2) continue;
    const safe = group.filter((x) => Number.isSafeInteger(x.id));
    const maxSafe = safe.length ? safe.reduce((a, b) => (b.id > a.id ? b : a)) : null;
    const maybeNewest = group.filter((x) => !Number.isSafeInteger(x.id));
    if (maxSafe) maybeNewest.push(...safe.filter((x) => x.id === maxSafe.id));
    if (maybeNewest.length > 1 && maybeNewest.some((x) => x.conclusion !== 'success')) {
      assert.notEqual(base, 'ok', `iter ${iter}: empate ambiguo con no-success dio ok: ${JSON.stringify(group.map((x) => [String(x.id), x.conclusion]))}`);
    }
  }
});

// QA-F17-01 (Baja, fuera del criterio literal): mismo created_at y mismo id entero seguro
// con distinta conclusión (p. ej. la página trae dos veces el run por re-ejecución entre
// páginas). compareSameTime devuelve 0 y decide el orden de entrada: ok o fail según llegue.
// Se deja como todo para no bloquear; el fail-closed pediría no-success primero.
test('QA-F17-01: id entero seguro repetido con distinta conclusión → no depende del orden', { todo: 'QA-F17-01' }, () => {
  const s = run(42, 'success');
  const f = run(42, 'startup_failure');
  assert.equal(assess([s, f]).status, assess([f, s]).status);
  assert.equal(assess([s, f]).status, 'fail');
});

test('QA-F17 (1): ids enteros seguros sin ambigüedad siguen desempatando por id mayor (no regresión F-16)', () => {
  assert.equal(assess([run(Number.MAX_SAFE_INTEGER - 1, 'failure'), run(Number.MAX_SAFE_INTEGER)]).status, 'ok');
  assert.equal(assess([run(Number.MAX_SAFE_INTEGER), run(Number.MAX_SAFE_INTEGER - 1, 'failure')]).status, 'ok');
  assert.equal(assess([run(-1), run(0, 'failure')]).status, 'fail');
  // Todos success, aunque sin id: no hay ambigüedad sobre el color → ok es correcto.
  assert.equal(assess([run('a'), run(undefined), run(3)]).status, 'ok');
});

test('QA-F17 (1): ids que no son números (BigInt, objeto, símbolo-like) no lanzan', () => {
  assert.doesNotThrow(() => assess([run(10n, 'failure'), run({}, 'success'), run([], 'cancelled'), run(true)]));
  assert.equal(assess([run(10n, 'failure'), run({}, 'success')]).status, 'fail');
});

test('QA-F17 (1): pendiente empatado sin id no cubre un fallo empatado ni convierte en ok', () => {
  const p = run(undefined, null, T, 'in_progress');
  const f = run(5, 'failure');
  for (const runs of [[p, f], [f, p]]) assert.equal(assess(runs).status, 'fail');
});

const SEG = WORKFLOW_RULES.find((x) => x.check === 'seguridad-semanal');
const MON = WORKFLOW_RULES.find((x) => x.check === 'evaluacion-mensual');
const wf = (rule, created_at, productionEnabled = false) =>
  assessWorkflow(rule, { workflow: { state: 'active', created_at }, runs: [], now: NOW, productionEnabled }).status;

test('QA-F17 (2): workflow.created_at — borde exacto de FUTURE_SKEW_MIN aceptado; 1 s más allá → fail-closed', () => {
  const edge = new Date(NOW.getTime() + FUTURE_SKEW_MIN * MIN).toISOString();
  const beyond = new Date(NOW.getTime() + FUTURE_SKEW_MIN * MIN + 1000).toISOString();
  assert.equal(wf(SEG, edge), 'ok');
  assert.equal(wf(SEG, beyond), 'fail');
});

test('QA-F17 (2): workflow.created_at con formatos que Date.parse acepta pero la API no da → fail', () => {
  for (const bad of ['2027-03-20', '2027-03-20 11:00:00Z', '2027-03-20T11:00Z', 'Sat, 20 Mar 2027 11:00:00 GMT', ' 2027-03-20T11:00:00Z', '2027-03-20T11:00:00Z\n', {}, [], NOW, NOW.getTime() - MIN]) {
    assert.equal(wf(SEG, bad), 'fail', String(bad));
  }
});

test('QA-F17 (2): workflow.created_at con offset (+/-hh:mm) válido sigue aceptado', () => {
  assert.equal(wf(SEG, '2027-03-20T06:00:00-05:00'), 'ok');
  assert.equal(wf(SEG, '2027-03-20T13:00:00.123+02:00'), 'ok');
});

test('QA-F17 (2): mensual — created_at futuro de este mes no salva el cierre; válido de este mes sí', () => {
  // Día 20 en Guayaquil, sin runs del mes.
  assert.equal(wf(MON, '2027-03-25T00:00:00Z', true), 'fail');
  assert.equal(wf(MON, '2027-03-02T05:00:00Z', true), 'ok');
  assert.equal(wf(MON, '2027-02-27T00:00:00Z', true), 'fail');
});

test('QA-F17 (2): sin created_at y sin runs: ci-main (latestOnly) sigue en skip, no ok', () => {
  const ci = WORKFLOW_RULES.find((x) => x.check === 'ci-main');
  assert.equal(wf(ci, undefined), 'skip');
});

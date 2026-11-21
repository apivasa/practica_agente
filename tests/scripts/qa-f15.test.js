// QA F-15 (H-F14-01): assessDeploy ordena y detecta atascos con parseApiTime. Criterio: un
// `success` con fecha futura no tapa fallos; runs con timestamp inválido o futuro se tratan
// como fail (completados) o se descartan (pendientes: ni cubren, ni atascan, ni dan ok).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_RULE, FUTURE_SKEW_MIN, assessDeploy } from '../../scripts/health/lib.js';

const NOW = new Date('2027-05-10T15:00:00Z');
const MIN = 60_000;
const WF = { state: 'active' };
const iso = (offMs) => new Date(NOW.getTime() + offMs).toISOString();
const ago = (m) => iso(-m * MIN);
const url = (id) => `https://github.com/apivasa/practica_agente/actions/runs/${id}`;
function r(id, created, { status = 'completed', conclusion = 'success', started, event = 'push' } = {}) {
  return {
    id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event,
    created_at: created,
    run_started_at: started === undefined ? created : started,
    html_url: url(id),
  };
}
const assess = (runs) => assessDeploy(DEPLOY_RULE, { workflow: WF, runs, now: NOW });

describe('QA F-15: completado con fecha futura o inválida', () => {
  test('borde exacto: +FUTURE_SKEW_MIN se acepta; +FUTURE_SKEW_MIN + 1 s ya es fail', () => {
    const fail = r(1, ago(30), { conclusion: 'failure' });
    const edge = assess([fail, r(2, iso(FUTURE_SKEW_MIN * MIN))]);
    assert.equal(edge.status, 'ok', edge.detail);
    assert.ok(edge.detail.includes(url(2)));
    const over = assess([fail, r(2, iso(FUTURE_SKEW_MIN * MIN + 1000))]);
    assert.equal(over.status, 'fail');
    assert.ok(over.detail.includes(url(2)), over.detail);
    // el fallo real sigue apareciendo en el mensaje: no queda tapado
    assert.ok(over.detail.includes(url(1)) && /failure/.test(over.detail), over.detail);
  });

  test('success futuro + failure real + pendiente reciente: no hay warn de cobertura, es fail', () => {
    const res = assess([r(3, iso(600 * MIN)), r(2, ago(10), { conclusion: 'failure' }), r(1, ago(100)), r(4, ago(2), { status: 'queued' })]);
    assert.equal(res.status, 'fail', res.detail);
  });

  test('cuenta todos los completados inválidos y enlaza el primero', () => {
    const res = assess([r(1, ago(60)), r(2, 'basura', { conclusion: 'failure' }), r(3, iso(999 * MIN))]);
    assert.equal(res.status, 'fail');
    assert.match(res.detail, /^2 despliegue\(s\) completado\(s\) con fecha inválida/);
    assert.ok(res.detail.includes(url(2)));
  });

  test('solo completados inválidos (sin ninguno válido): fail, no «sin despliegues completados»', () => {
    const res = assess([r(1, 'no-fecha')]);
    assert.equal(res.status, 'fail');
    assert.doesNotMatch(res.detail, /sin despliegues completados/);
  });

  test('completado con created_at válido y run_started_at inválido: sigue válido (solo created_at ordena)', () => {
    assert.equal(assess([r(1, ago(10), { started: 'x' })]).status, 'ok');
  });

  test('neutral con fecha inválida se ignora; timed_out con fecha inválida falla', () => {
    assert.equal(assess([r(2, 'x', { conclusion: 'neutral' }), r(1, ago(60))]).status, 'ok');
    assert.equal(assess([r(2, 'x', { conclusion: 'timed_out' }), r(1, ago(60))]).status, 'fail');
  });

  test('eventos no relevantes (schedule, pull_request) con fecha inválida no afectan', () => {
    const res = assess([
      r(2, iso(600 * MIN), { event: 'schedule', conclusion: 'failure' }),
      r(3, 'x', { event: 'pull_request' }),
      r(1, ago(60)),
    ]);
    assert.equal(res.status, 'ok', res.detail);
  });

  test('entradas null o sin event en la lista no lanzan', () => {
    assert.equal(assess([null, undefined, {}, r(1, ago(60))]).status, 'ok');
  });

  test('orden por fecha validada con offsets de zona distintos', () => {
    // 09:59-05:00 = 14:59Z (más nuevo) frente a 14:30Z
    const res = assess([r(1, '2027-05-10T14:30:00Z'), r(2, '2027-05-10T09:59:00-05:00', { conclusion: 'failure' })]);
    assert.equal(res.status, 'fail');
    assert.ok(res.detail.includes(url(2)), res.detail);
  });
});

describe('QA F-15: pendientes y stuck con parseApiTime', () => {
  test('stuck en el umbral: 90 min exactos no; 91 min sí (run_started_at válido)', () => {
    assert.equal(assess([r(2, ago(200), { status: 'in_progress', started: ago(90) }), r(1, ago(300))]).status, 'ok');
    const res = assess([r(2, ago(200), { status: 'in_progress', started: ago(91) }), r(1, ago(300))]);
    assert.equal(res.status, 'fail');
    assert.match(res.detail, /91 min en in_progress \(máximo 90\)/);
  });

  test('run_started_at vacío o null usa created_at para stuck', () => {
    assert.equal(assess([r(2, ago(120), { status: 'queued', started: '' }), r(1, ago(300))]).status, 'fail');
    assert.equal(assess([r(2, ago(120), { status: 'queued', started: null }), r(1, ago(300))]).status, 'fail');
  });

  test('pendiente con fecha futura: no cuenta como atascado ni cubre un failure', () => {
    assert.equal(assess([r(2, iso(600 * MIN), { status: 'waiting' }), r(1, ago(60))]).status, 'ok');
    assert.equal(assess([r(2, iso(600 * MIN), { status: 'waiting' }), r(1, ago(60), { conclusion: 'failure' })]).status, 'fail');
  });

  test('pendiente con fecha inválida no convierte en ok un último cancelado (sigue warn)', () => {
    assert.equal(assess([r(2, 'x', { status: 'queued' }), r(1, ago(10), { conclusion: 'cancelled' })]).status, 'warn');
  });

  test('completado inválido + cancelado válido: fail, no warn', () => {
    assert.equal(assess([r(2, 'x'), r(1, ago(10), { conclusion: 'cancelled' })]).status, 'fail');
  });

  test('pendiente válido sigue cubriendo un failure aislado (regresión F-13)', () => {
    const res = assess([r(3, ago(2), { status: 'queued' }), r(2, ago(10), { conclusion: 'failure' }), r(1, ago(100))]);
    assert.equal(res.status, 'warn', res.detail);
  });
});

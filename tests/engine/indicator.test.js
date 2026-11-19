import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIndicator, normalizeIndicator, DEFAULTS } from '../../engine/index.js';

const base = {
  measurementType: 'window_average',
  direction: 'higher_is_better',
  thresholds: { green: 99, yellow: 95 },
};

test('configuración mínima válida', () => {
  assert.deepEqual(validateIndicator(base), { ok: true, errors: [] });
});

test('normalize aplica defaults', () => {
  const n = normalizeIndicator(base);
  assert.equal(n.windowDays, 30);
  assert.equal(n.frequency, 'monthly');
  assert.equal(n.minSample, 0);
  assert.equal(n.source, 'manual');
  assert.deepEqual({ ...n.thresholdsByCategory }, {});
  assert.equal(Object.getPrototypeOf(n.thresholdsByCategory), null);
  assert.deepEqual(DEFAULTS, { windowDays: 30, frequency: 'monthly', minSample: 0, source: 'manual' });
});

test('normalize respeta valores dados y copia (no muta)', () => {
  const cfg = {
    ...base,
    windowDays: 7,
    frequency: 'weekly',
    minSample: 5,
    source: 'automatic',
    thresholdsByCategory: { P0: { green: 100, yellow: 96 } },
  };
  const n = normalizeIndicator(cfg);
  assert.equal(n.windowDays, 7);
  assert.equal(n.frequency, 'weekly');
  assert.equal(n.minSample, 5);
  assert.equal(n.source, 'automatic');
  assert.deepEqual({ ...n.thresholdsByCategory }, { P0: { green: 100, yellow: 96 } });
  n.thresholds.green = 0;
  n.thresholdsByCategory.P0.green = 0;
  assert.equal(cfg.thresholds.green, 99);
  assert.equal(cfg.thresholdsByCategory.P0.green, 100);
});

test('normalize lanza con config inválida', () => {
  assert.throws(() => normalizeIndicator({}), /Indicador inválido/);
});

test('no objeto', () => {
  for (const v of [null, undefined, 3, 'x', []]) {
    const r = validateIndicator(v);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
  }
});

test('tipo y sentido inválidos', () => {
  const r = validateIndicator({ ...base, measurementType: 'sum', direction: 'up' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('measurementType')));
  assert.ok(r.errors.some((e) => e.startsWith('direction')));
});

test('los tres tipos son válidos', () => {
  for (const t of ['cumulative_target', 'window_average', 'coverage']) {
    assert.equal(validateIndicator({ ...base, measurementType: t }).ok, true);
  }
});

test('windowDays inválido', () => {
  for (const w of [0, -1, 1.5, '30', null]) {
    const r = validateIndicator({ ...base, windowDays: w });
    assert.equal(r.ok, false, `windowDays=${w}`);
    assert.match(r.errors[0], /windowDays/);
  }
  assert.equal(validateIndicator({ ...base, windowDays: 1 }).ok, true);
});

test('umbrales ausentes o no numéricos', () => {
  assert.match(validateIndicator({ ...base, thresholds: undefined }).errors[0], /thresholds: debe ser un objeto/);
  const r = validateIndicator({ ...base, thresholds: { green: 'a', yellow: NaN } });
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /thresholds.green/);
  assert.match(r.errors[1], /thresholds.yellow/);
  assert.equal(validateIndicator({ ...base, thresholds: { green: Infinity, yellow: 1 } }).ok, false);
});

test('orden de umbrales según sentido', () => {
  const hib = validateIndicator({ ...base, thresholds: { green: 90, yellow: 95 } });
  assert.equal(hib.ok, false);
  assert.match(hib.errors[0], /más es mejor/);
  const lib = validateIndicator({ ...base, direction: 'lower_is_better', thresholds: { green: 8, yellow: 4 } });
  assert.equal(lib.ok, false);
  assert.match(lib.errors[0], /menos es mejor/);
  // Iguales: válido en ambos sentidos.
  assert.equal(validateIndicator({ ...base, thresholds: { green: 5, yellow: 5 } }).ok, true);
  assert.equal(
    validateIndicator({ ...base, direction: 'lower_is_better', thresholds: { green: 5, yellow: 5 } }).ok,
    true,
  );
});

test('sin sentido válido no se valida el orden de umbrales', () => {
  const r = validateIndicator({ ...base, direction: 'x', thresholds: { green: 1, yellow: 9 } });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /direction/);
});

test('thresholdsByCategory', () => {
  assert.match(validateIndicator({ ...base, thresholdsByCategory: [] }).errors[0], /thresholdsByCategory: debe ser/);
  const r = validateIndicator({
    ...base,
    thresholdsByCategory: { P0: { green: 90, yellow: 96 }, P2: 'x', P3: { green: 85, yellow: 80 } },
  });
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /thresholdsByCategory.P0/);
  assert.match(r.errors[1], /thresholdsByCategory.P2/);
});

test('frequency, minSample y source', () => {
  for (const f of ['monthly', 'weekly', 'quarterly']) assert.equal(validateIndicator({ ...base, frequency: f }).ok, true);
  assert.match(validateIndicator({ ...base, frequency: 'daily' }).errors[0], /frequency/);
  assert.equal(validateIndicator({ ...base, minSample: 0 }).ok, true);
  for (const m of [-1, 1.2, '3']) assert.match(validateIndicator({ ...base, minSample: m }).errors[0], /minSample/);
  for (const s of ['manual', 'automatic']) assert.equal(validateIndicator({ ...base, source: s }).ok, true);
  assert.match(validateIndicator({ ...base, source: 'jira' }).errors[0], /source/);
});

test('normalize: __proto__ se descarta, constructor queda como categoría propia', () => {
  const cfg = JSON.parse(
    '{"measurementType":"coverage","direction":"higher_is_better","thresholds":{"green":9,"yellow":5},' +
      '"thresholdsByCategory":{"__proto__":{"green":1,"yellow":0},"constructor":{"green":2,"yellow":1}}}',
  );
  const n = normalizeIndicator(cfg);
  assert.deepEqual(Object.keys(n.thresholdsByCategory), ['constructor']);
  assert.deepEqual(n.thresholdsByCategory.constructor, { green: 2, yellow: 1 });
  assert.equal(({}).green, undefined);
});

// QA M-12 — lo que arma el front cabe en los CHECK nuevos de la BD.
// Trazas:
//  - migración M-12: "Es la forma que produce el formulario (src/lib/indicator-form.js:
//    `{ [cat]: { green, yellow } }`, ambos obligatorios)" -> cada categoría sale con exactamente
//    green y yellow numéricos, con nombres libres; sin categorías sale {}.
//  - migración M-12: "cada valor es entero >= 0, como ya valida el front (commitment-form.js)" y
//    "NO se restringen las claves: el formulario usa las categorías del indicador ... y `total`"
//    -> el formulario rechaza negativos y fracciones y deja pasar claves libres y "total".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndicatorRow } from '../../src/lib/indicator-form.js';
import { buildCommitmentFields } from '../../src/lib/commitment-form.js';

const base = {
  code: 'QA-M12', name: 'QA M12', description: '', measurement_type: 'cumulative_target',
  direction: 'higher_is_better', window_days: '90', green: '96', yellow: '90', categories: [],
  frequency: 'monthly', min_sample: '0', source: 'manual', active: true,
};

/** Réplica en JS del CHECK indicators_thresholds_by_category_safe (forma, no el tope). */
function hasDbShape(t) {
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return false;
  return Object.values(t).every((c) => c !== null && typeof c === 'object' && !Array.isArray(c)
    && Object.keys(c).sort().join(',') === 'green,yellow'
    && typeof c.green === 'number' && typeof c.yellow === 'number');
}

test('M-12 front: umbrales por categoría del formulario tienen la forma { green, yellow } numérica', () => {
  const r = buildIndicatorRow({
    ...base,
    categories: [
      { name: 'Critica / alta-1', green: '96,5', yellow: '90' },
      { name: '', green: '', yellow: '' }, // fila vacía del editor: se ignora
      { name: 'P2P3', green: '85', yellow: '75.25' },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(hasDbShape(r.row.thresholds_by_category), true);
  assert.deepEqual(r.row.thresholds_by_category, {
    'Critica / alta-1': { green: 96.5, yellow: 90 },
    P2P3: { green: 85, yellow: 75.25 },
  });
});

test('M-12 front: sin categorías el formulario envía {} (aceptado por el CHECK)', () => {
  const r = buildIndicatorRow({ ...base, measurement_type: 'window_average', window_days: '30' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.row.thresholds_by_category, {});
});

test('M-12 front: una categoría con un umbral vacío no llega a la BD (el formulario la rechaza)', () => {
  const r = buildIndicatorRow({ ...base, categories: [{ name: 'P0P1', green: '96', yellow: '' }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' | '), /amarillo: obligatorio/);
});

const vuln = { measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 } };

test('M-12 front: el paquete rechaza negativos y fracciones (lo mismo que commitments_package_by_category_whole)', () => {
  for (const bad of ['-1', '1.5', '0,5', '-0.5']) {
    const r = buildCommitmentFields(vuln, { period: '2034-Q1', packages: { P0P1: bad } });
    assert.equal(r.ok, false, `debió rechazar ${bad}`);
    assert.match(r.errors[0], /entero mayor o igual que 0/);
  }
});

test('M-12 front: el paquete acepta 0, claves libres y "total" (claves no restringidas a P0P1/P2P3)', () => {
  const r = buildCommitmentFields(vuln, { period: '2034-Q1', packages: { 'Critica / alta-1': '0', total: '30' } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.fields.package_by_category, { 'Critica / alta-1': 0, total: 30 });
  for (const n of Object.values(r.fields.package_by_category)) assert.ok(Number.isInteger(n) && n >= 0);
});

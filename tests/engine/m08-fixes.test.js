// M-08 (pruebas del desarrollador): A4 (meta acumulada + "menos es mejor" se rechaza) y A7
// (el descarte de filas malformadas vive en buildPackageInput y lo comparten la evaluación
// mensual, el ritmo diario y el ritmo del front).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateIndicator, normalizeIndicator, buildPackageInput, evaluateCategoryMonth, discardedNote } from '../../engine/index.js';
import { packagePace } from '../../src/lib/dashboard.js';
import { buildIndicatorRow } from '../../src/lib/indicator-form.js';
import { runDaily } from '../../scripts/lib/run.js';
import { createFakeDb, seedScenario, IDS } from '../scripts/fake-db.js';

describe('A4: cumulative_target solo con higher_is_better', () => {
  const cum = { measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 96, yellow: 90 } };

  test('higher_is_better se acepta', () => {
    assert.deepEqual(validateIndicator(cum), { ok: true, errors: [] });
  });

  test('lower_is_better se rechaza con un error de "direction"', () => {
    const r = validateIndicator({ ...cum, direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 } });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^direction: .*meta acumulada/);
    assert.throws(() => normalizeIndicator({ ...cum, direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 } }), /Indicador inválido/);
  });

  test('los demás tipos siguen admitiendo lower_is_better', () => {
    for (const measurementType of ['window_average', 'coverage']) {
      assert.equal(validateIndicator({ measurementType, direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 } }).ok, true);
    }
  });

  test('el formulario muestra el error del motor con la etiqueta "Sentido"', () => {
    const r = buildIndicatorRow({
      code: 'X1', name: 'n', measurement_type: 'cumulative_target', direction: 'lower_is_better',
      window_days: '90', green: '4', yellow: '8', categories: [], frequency: 'monthly', min_sample: '0', source: 'manual',
    });
    assert.equal(r.ok, false);
    assert.ok(JSON.stringify(r).includes('Sentido: una meta acumulada'), JSON.stringify(r));
  });
});

describe('A7: buildPackageInput descarta y cuenta las filas malformadas', () => {
  const VULN = {
    id: 'v', code: 'VULN', measurement_type: 'cumulative_target', direction: 'higher_is_better', window_days: 90,
    green_threshold: 96, yellow_threshold: 90,
    thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
    frequency: 'monthly', min_sample: 0, source: 'manual', active: true,
  };
  const Q = { unit_id: 'u', indicator_id: 'v', period: '2027-Q1', package_by_category: { P0P1: 300, P2P3: 300 } };
  const row = (measured_on, category, value, kind = 'resolved') => ({ unit_id: 'u', indicator_id: 'v', measured_on, category, value, kind });
  const good = [row('2027-01-20', 'P0P1', 100), row('2027-01-20', 'P2P3', 100), row('2027-02-05', 'P0P1', 5, 'detected')];
  const bad = [
    row('2027-02-01', 'P0P1', 0.5),
    row('2027-02-01', null, 5),
    row('2027-02-01', 'p0p1', 5),
    row('2027-02-01', 'P2P3', -3),
    row('2027-02-01', 'P0P1', 1.5, 'detected'),
  ];

  test('sin malformadas: discarded 0', () => {
    const r = buildPackageInput({ indicator: VULN, commitment: Q, measurements: good, asOf: '2027-02-10' });
    assert.equal(r.ok, true);
    assert.equal(r.discarded, 0);
    assert.equal(r.input.resolved.length, 2);
    assert.equal(r.input.newCritical.length, 1);
  });

  test('las malformadas no llegan al motor y se cuentan', () => {
    const r = buildPackageInput({ indicator: VULN, commitment: Q, measurements: [...good, ...bad], asOf: '2027-02-10' });
    assert.equal(r.ok, true);
    assert.equal(r.discarded, bad.length);
    assert.deepEqual(r.input, buildPackageInput({ indicator: VULN, commitment: Q, measurements: good, asOf: '2027-02-10' }).input);
  });

  test('las malformadas fuera del trimestre o posteriores a asOf no cuentan', () => {
    const r = buildPackageInput({
      indicator: VULN, commitment: Q, asOf: '2027-02-10',
      measurements: [...good, row('2026-12-31', null, 1), row('2027-02-11', 'P0P1', 0.5)],
    });
    assert.equal(r.discarded, 0);
  });

  test('las detectadas P2P3 y las resueltas sin valor no se descartan', () => {
    const r = buildPackageInput({
      indicator: VULN, commitment: Q, asOf: '2027-02-10',
      measurements: [...good, row('2027-02-01', 'P2P3', 2.5, 'detected'), row('2027-02-01', null, null)],
    });
    assert.equal(r.discarded, 0);
  });

  test('packagePace (front) calcula el ritmo y anota el descarte', () => {
    const clean = packagePace({ indicator: VULN, commitment: Q, measurements: good, asOf: '2027-02-10' });
    const dirty = packagePace({ indicator: VULN, commitment: Q, measurements: [...good, ...bad], asOf: '2027-02-10' });
    assert.equal(dirty.ok, true, dirty.reason);
    assert.equal(dirty.discarded, bad.length);
    assert.equal(dirty.reason, `${clean.reason}; ${discardedNote(bad.length)}`);
    assert.equal(clean.discarded, undefined);
    const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'discarded' && k !== 'reason'));
    assert.deepEqual(strip(dirty), strip(clean));
  });

  test('la evaluación mensual usa el mismo conteo', () => {
    const r = evaluateCategoryMonth({ indicator: VULN, commitment: Q, measurements: [...good, ...bad], month: '2027-02' });
    assert.equal(r.discarded, bad.length);
    assert.match(r.reason, new RegExp(`${bad.length} medición\\(es\\) descartada\\(s\\)`));
  });

  test('runDaily con una fila malformada termina sin errores y el motivo cuenta el descarte', async () => {
    const { U, I } = IDS;
    const data = seedScenario();
    const vulnRow = data.measurements.find((r) => r.unit_id === U.alfa && r.indicator_id === I.vuln);
    data.measurements.push({ ...vulnRow, measured_on: '2027-02-08', value: 0.5, category: 'P0P1', kind: 'resolved' });
    const lines = [];
    const r = await runDaily(createFakeDb(data), { asOf: '2027-02-10', log: (l) => lines.push(l) });
    assert.deepEqual(r.errors, []);
    assert.equal(r.snapshots, 3);
    const alfa = lines.filter((l) => l.startsWith('Unidad Alfa/VULN'));
    assert.equal(alfa.length, 1);
    assert.match(alfa[0], /; 1 medición\(es\) descartada\(s\) por categoría o valor inválido$/);
    assert.ok(lines.filter((l) => /\/VULN/.test(l) && !l.startsWith('Unidad Alfa')).every((l) => !/descartada/.test(l)));
  });
});

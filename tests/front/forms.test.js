// M-02..M-04 — lógica pura de formularios del front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndicatorRow, formValuesFromRow, toEngineIndicator, custodianCandidates, incoherentCustodians,
  custodianAssignmentPlan, humanizeEngineError, parseNumberField,
} from '../../src/lib/indicator-form.js';
import { buildCommitmentFields } from '../../src/lib/commitment-form.js';
import { fieldsForType, toMeasurementRow, describeMeasurement } from '../../src/lib/measurement-form.js';
import { todayInBusinessTz } from '../../src/lib/dates.js';
import { validateIndicator, effectiveThresholds } from '../../engine/index.js';

const base = {
  code: 'CHG-FAIL', name: 'Cambios fallidos', description: '', measurement_type: 'window_average',
  direction: 'lower_is_better', window_days: '30', green: '5', yellow: '10', categories: [],
  frequency: 'monthly', min_sample: '0', source: 'manual', active: true,
};

test('buildIndicatorRow: indicador nuevo no previsto queda evaluable por el motor', () => {
  const r = buildIndicatorRow(base);
  assert.equal(r.ok, true);
  assert.equal(r.row.green_threshold, 5);
  assert.equal(r.row.window_days, 30);
  assert.equal(r.row.description, null);
  assert.ok(validateIndicator(toEngineIndicator(r.row)).ok);
});

test('buildIndicatorRow: mensajes en español con etiquetas de la pantalla', () => {
  const r = buildIndicatorRow({ ...base, code: 'con espacio', name: ' ', green: '20', yellow: '10' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /^Código/);
  assert.match(r.errors[1], /^Nombre/);
  const coh = buildIndicatorRow({ ...base, green: '20', yellow: '10' });
  assert.match(coh.errors[0], /^Umbrales: con "menos es mejor"/);
  const ints = buildIndicatorRow({ ...base, window_days: '1.5', min_sample: 'x', green: 'abc' });
  assert.deepEqual(ints.errors, ['Ventana (días): debe ser un número entero', 'Mínimo de muestra: debe ser un número entero', 'Umbral verde: debe ser un número']);
  const zero = buildIndicatorRow({ ...base, window_days: '0' });
  assert.match(zero.errors[0], /^Ventana \(días\): debe ser un entero mayor que 0/);
  assert.equal(buildIndicatorRow({ ...base, measurement_type: 'otro' }).errors[0].startsWith('Tipo de medición'), true);
});

test('buildIndicatorRow: umbrales por categoría (editor clave/valores)', () => {
  const r = buildIndicatorRow({ ...base, direction: 'higher_is_better', green: '85', yellow: '70', measurement_type: 'cumulative_target',
    categories: [{ name: 'P0P1', green: '96', yellow: '90' }, { name: '', green: '', yellow: '' }, { name: 'P2P3', green: '85', yellow: '75' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.row.thresholds_by_category, { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } });
  const bad = buildIndicatorRow({ ...base, categories: [{ name: '__proto__', green: '1', yellow: '2' }, { name: 'A', green: '1', yellow: '' }, { name: 'a', green: '1', yellow: '2' }, { name: 'A', green: '1', yellow: '2' }] });
  assert.match(bad.errors[0], /Categoría 1: nombre/);
  assert.match(bad.errors[1], /Categoría A, amarillo: obligatorio/);
  assert.match(bad.errors[2], /Categoría a: repetida/);
  assert.match(bad.errors[3], /Categoría A: repetida/);
  const incoh = buildIndicatorRow({ ...base, categories: [{ name: 'X', green: '9', yellow: '2' }] });
  assert.match(incoh.errors[0], /^Umbral de la categoría X/);
});

test('formValuesFromRow / toEngineIndicator: ida y vuelta', () => {
  const r = buildIndicatorRow({ ...base, categories: [{ name: 'A', green: '1', yellow: '2' }] });
  const v = formValuesFromRow({ ...r.row, custodian_user_id: 'u1' });
  assert.equal(v.custodian_user_id, 'u1');
  assert.deepEqual(v.categories, [{ name: 'A', green: '1', yellow: '2' }]);
  assert.equal(buildIndicatorRow(v).ok, true);
  assert.equal(formValuesFromRow(null).active, true);
  assert.deepEqual(toEngineIndicator({ thresholds_by_category: JSON.parse('{"__proto__":{"green":1}}') }).thresholdsByCategory, {});
});

test('humanizeEngineError y parseNumberField', () => {
  assert.equal(humanizeEngineError('minSample: x'), 'Mínimo de muestra: x');
  assert.equal(humanizeEngineError('otra cosa'), 'otra cosa');
  assert.equal(parseNumberField(' 99,5 '), 99.5);
  assert.equal(parseNumberField(''), null);
  assert.ok(Number.isNaN(parseNumberField('1e3')));
});

const roles = [
  { id: 'r1', user_id: 'aaaaaaaa-0000-0000-0000-000000000001', role: 'custodian', indicator_id: 'i1' },
  { id: 'r2', user_id: 'aaaaaaaa-0000-0000-0000-000000000002', role: 'custodian', indicator_id: 'i2' },
  { id: 'r3', user_id: 'aaaaaaaa-0000-0000-0000-000000000002', role: 'custodian', indicator_id: 'i3' },
  { id: 'r4', user_id: 'bbbbbbbb-0000-0000-0000-000000000009', role: 'unit_leader', indicator_id: null },
];
const inds = [
  { id: 'i1', code: 'VULN', custodian_user_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
  { id: 'i2', code: 'AVAIL', custodian_user_id: 'aaaaaaaa-0000-0000-0000-000000000002' },
  { id: 'i3', code: 'MTTR', custodian_user_id: 'aaaaaaaa-0000-0000-0000-000000000001' },
  { id: 'i4', code: 'NEW', custodian_user_id: null },
];

test('custodianCandidates: solo usuarios con rol custodian, etiquetados por sus KPI', () => {
  const c = custodianCandidates(roles, inds);
  assert.equal(c.length, 2);
  assert.match(c[0].label, /^AVAIL, MTTR · usuario aaaaaaaa…0002$/);
  assert.match(c[1].label, /^VULN/);
});

test('incoherentCustodians: la columna informativa debe coincidir con user_roles (ADR 0005)', () => {
  assert.deepEqual(incoherentCustodians(inds, roles), ['i3']);
  assert.deepEqual(incoherentCustodians([{ id: 'i9', custodian_user_id: null }], [{ role: 'custodian', indicator_id: 'i9', user_id: 'x' }]), ['i9']);
});

test('custodianAssignmentPlan: quita a los demás, agrega al nuevo, columna al final', () => {
  assert.deepEqual(custodianAssignmentPlan('i3', 'aaaaaaaa-0000-0000-0000-000000000001', roles),
    { removeRoleIds: ['r3'], addRole: true, setColumn: 'aaaaaaaa-0000-0000-0000-000000000001' });
  assert.deepEqual(custodianAssignmentPlan('i2', 'aaaaaaaa-0000-0000-0000-000000000002', roles), { removeRoleIds: [], addRole: false, setColumn: 'aaaaaaaa-0000-0000-0000-000000000002' });
  assert.deepEqual(custodianAssignmentPlan('i1', '', roles), { removeRoleIds: ['r1'], addRole: false, setColumn: null });
});

test('buildCommitmentFields: umbral negociado que sobrescribe el general', () => {
  const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
  const r = buildCommitmentFields(avail, { period: '2027-q1', green: '99.5', yellow: '99', notes: ' ok ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { period: '2027-Q1', green_override: 99.5, yellow_override: 99, package_by_category: null, package_total: null, notes: 'ok' });
  assert.deepEqual(effectiveThresholds(avail, r.fields), { green: 99.5, yellow: 99, overridden: true });
  assert.match(buildCommitmentFields(avail, { period: '2027-Q1', green: '98', yellow: '99' }).errors[0], /más es mejor/);
  assert.match(buildCommitmentFields(avail, { period: 'x' }).errors[0], /Periodo/);
  assert.match(buildCommitmentFields(avail, { period: '2027-Q1', green: 'a' }).errors[0], /número/);
});

test('buildCommitmentFields: paquete por categoría en meta acumulada', () => {
  const vuln = { measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 } };
  const r = buildCommitmentFields(vuln, { period: '2027-Q2', packages: { P0P1: '1500', P2P3: '500' } });
  assert.deepEqual([r.fields.package_by_category, r.fields.package_total], [{ P0P1: 1500, P2P3: 500 }, 2000]);
  assert.match(buildCommitmentFields(vuln, { period: '2027-Q2', packages: { P0P1: '1.5' } }).errors[0], /entero/);
  assert.equal(buildCommitmentFields(vuln, { period: '2027-Q2', packages: { P0P1: ' ' } }).fields.package_by_category, null);
});

test('measurement-form: campos por tipo, fila de BD y descripción', () => {
  assert.deepEqual(fieldsForType('coverage'), ['fecha', 'unidad', 'app_id', 'cumple']);
  assert.deepEqual(fieldsForType('cumulative_target'), ['fecha', 'unidad', 'valor', 'categoria', 'tipo']);
  assert.deepEqual(fieldsForType('window_average'), ['fecha', 'unidad', 'valor']);
  const row = toMeasurementRow('i1', { date: '2027-01-01', unitId: 'u', value: 3, appId: null, compliant: null, category: 'P0P1', kind: 'resolved', line: 2 });
  assert.deepEqual(row, { indicator_id: 'i1', unit_id: 'u', measured_on: '2027-01-01', value: 3, app_id: null, compliant: null, category: 'P0P1', kind: 'resolved', source: 'manual' });
  assert.equal(describeMeasurement({ app_id: 'a', compliant: false }), 'a: no cumple');
  assert.equal(describeMeasurement({ value: 3, category: 'P0P1', kind: 'detected' }), '3 · P0P1 · detectada');
});

test('todayInBusinessTz usa America/Guayaquil (UTC-5)', () => {
  assert.equal(todayInBusinessTz(new Date('2027-01-01T03:00:00Z')), '2026-12-31');
  assert.equal(todayInBusinessTz(new Date('2027-01-01T06:00:00Z')), '2027-01-01');
});

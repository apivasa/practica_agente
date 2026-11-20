// QA M-08: descarte compartido en buildPackageInput (A7) y su efecto en el ritmo diario.
// Trazas:
//  - plan-maestro M-08: "descarte movido a buildPackageInput (H-M06-01, H-M06-QA-02, A4, A7)".
//  - M-06-arquitectura A7: "que ritmo-diario, packagePace y la evaluación mensual compartan
//    el filtro"; criterio: "runDaily con una fila malformada termina sin errores y el motivo
//    cuenta el descarte".
//  - M-06-seguridad H-M06-01: "Que falle cerrado por fila": una fila inválida no suma ni anula.
//  - M-06-qa H-M06-QA-02: una P0/P1 detectada malformada no debe subir la meta.
//  - docs/diseno.md: "Ritmo esperado ... recalculado cada vez que entra algo"; los errores
//    reales de una unidad siguen visibles (no se ocultan, CLAUDE.md 4).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runDaily } from '../../scripts/lib/run.js';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';
import { buildPackageInput, evaluateCategoryMonth, validateIndicator } from '../../engine/index.js';
import { packagePace } from '../../src/lib/dashboard.js';

const { U, I } = IDS;
const ASOF = '2027-02-10';
const row = (unit, extra) => ({ unit_id: unit, indicator_id: I.vuln, measured_on: '2027-02-05', created_at: 'z', ...extra });
const snapshotOf = (db, unit) =>
  db.tables.audit_log.find((a) => a.action === 'pace_snapshot' && a.entity_id === `${unit}:${I.vuln}`);

async function daily(data) {
  const db = createFakeDb(data);
  const logs = [];
  const r = await runDaily(db, { asOf: ASOF, log: (l) => logs.push(l) });
  return { db, r, logs };
}

describe('QA M-08 · runDaily con filas malformadas (A7)', () => {
  const BAD = [
    { value: 1.5, category: 'P0P1', kind: 'resolved' },
    { value: 5, category: null, kind: 'resolved' },
    { value: 5, category: 'p0p1', kind: 'resolved' },
    { value: -3, category: 'P2P3', kind: 'resolved' },
    { value: 'x', category: 'P0P1', kind: 'resolved' },
    { value: 30.5, category: 'P0P1', kind: 'detected' },
  ];

  test('el estado del paquete es el mismo que sin la fila: no suma ni sube la meta', async () => {
    const clean = await daily(seedScenario());
    for (const bad of BAD) {
      const data = seedScenario();
      data.measurements.push(row(U.alfa, bad));
      const dirty = await daily(data);
      assert.deepEqual(dirty.r.errors, [], JSON.stringify(bad));
      assert.deepEqual(snapshotOf(dirty.db, U.alfa).details.status, snapshotOf(clean.db, U.alfa).details.status, JSON.stringify(bad));
      assert.equal(snapshotOf(dirty.db, U.alfa).details.discarded, 1, JSON.stringify(bad));
      assert.equal(snapshotOf(clean.db, U.alfa).details.discarded, undefined, 'sin descarte no se anota');
    }
  });

  test('H-M06-QA-02: una P0/P1 detectada malformada no dispara la alerta de ingreso', async () => {
    const data = seedScenario();
    data.measurements = data.measurements.filter((m) => m.kind !== 'detected');
    data.measurements.push(row(U.beta, { value: 30.5, category: 'P0P1', kind: 'detected' }));
    const { db, r, logs } = await daily(data);
    assert.deepEqual(r.errors, []);
    assert.equal(db.tables.alerts.filter((a) => a.kind === 'critical_intake').length, 0);
    assert.ok(logs.some((l) => l.startsWith('Unidad Beta/VULN') && /1 medición\(es\) descartada\(s\)/.test(l)));
  });

  test('una fila malformada fuera del trimestre o posterior a asOf no se cuenta como descartada', async () => {
    const data = seedScenario();
    data.measurements.push(
      row(U.alfa, { measured_on: '2026-12-31', value: 1.5, category: 'P0P1', kind: 'resolved' }),
      row(U.alfa, { measured_on: '2027-02-11', value: 1.5, category: 'P0P1', kind: 'resolved' }),
    );
    const { db, r, logs } = await daily(data);
    assert.deepEqual(r.errors, []);
    assert.equal(snapshotOf(db, U.alfa).details.discarded, undefined);
    assert.ok(logs.filter((l) => l.startsWith('Unidad Alfa/VULN')).every((l) => !/descartada/.test(l)));
  });

  test('repetir el diario el mismo día no duplica la foto por el descarte (idempotente)', async () => {
    const data = seedScenario();
    data.measurements.push(row(U.alfa, { value: 1.5, category: 'P0P1', kind: 'resolved' }));
    const db = createFakeDb(data);
    await runDaily(db, { asOf: ASOF });
    const first = db.tables.audit_log.filter((a) => a.action === 'pace_snapshot').length;
    await runDaily(db, { asOf: ASOF });
    assert.equal(db.tables.audit_log.filter((a) => a.action === 'pace_snapshot').length, first);
  });

  test('un error real de una unidad (paquete negativo) se sigue informando y no detiene a las demás', async () => {
    const data = seedScenario();
    data.commitments = data.commitments.map((c) =>
      c.unit_id === U.beta && c.indicator_id === I.vuln ? { ...c, package_by_category: { P0P1: -5, P2P3: 500 } } : c,
    );
    const { db, r } = await daily(data);
    assert.equal(r.errors.length, 1, r.errors.join('\n'));
    assert.match(r.errors[0], /^Unidad Beta\/VULN: /);
    assert.ok(snapshotOf(db, U.alfa), 'Alfa se procesa');
    assert.ok(snapshotOf(db, U.gamma), 'Gamma se procesa');
  });
});

describe('QA M-08 · un solo conteo en mensual, diario y front (A7)', () => {
  test('evaluateCategoryMonth, packagePace y runDaily dan el mismo número de descartadas', async () => {
    const data = seedScenario();
    data.measurements.push(
      row(U.alfa, { value: 1.5, category: 'P0P1', kind: 'resolved' }),
      row(U.alfa, { value: 2, category: 'X', kind: 'resolved' }),
      row(U.alfa, { value: 0.5, category: 'P0P1', kind: 'detected' }),
    );
    const indicator = data.indicators.find((i) => i.id === I.vuln);
    const commitment = data.commitments.find((c) => c.unit_id === U.alfa && c.indicator_id === I.vuln);
    const rows = data.measurements.filter((m) => m.unit_id === U.alfa && m.indicator_id === I.vuln);
    const built = buildPackageInput({ indicator, commitment, measurements: rows, asOf: ASOF });
    const monthly = evaluateCategoryMonth({ indicator, commitment, measurements: rows, month: '2027-02' });
    const front = packagePace({ indicator, commitment, measurements: rows, asOf: ASOF });
    const { db } = await daily(data);
    assert.equal(built.discarded, 3);
    assert.equal(monthly.discarded, 3);
    assert.equal(front.discarded, 3);
    assert.equal(snapshotOf(db, U.alfa).details.discarded, 3);
  });
});

describe('QA M-08 · A4 en el motor', () => {
  test('cumulative_target + lower_is_better se rechaza aunque los umbrales sean coherentes con el sentido', () => {
    const v = validateIndicator({
      measurementType: 'cumulative_target', direction: 'lower_is_better', windowDays: 90, thresholds: { green: 4, yellow: 8 },
    });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /^direction:/.test(e)), v.errors.join('; '));
  });
});

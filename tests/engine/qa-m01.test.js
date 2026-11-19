// QA M-01 — pruebas independientes del motor de color.
// Cada bloque traza a una frase de docs/diseno.md ("Modelo genérico de indicador",
// "Caso: vulnerabilidades") o al criterio de aceptación de M-01 en docs/plan-maestro.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  measure,
  evaluateColor,
  validateIndicator,
  normalizeIndicator,
  MEASUREMENT_TYPES,
  DIRECTIONS,
} from '../../engine/index.js';

const color = (cfg, ms, opts, catOpt) => evaluateColor(cfg, measure(cfg, ms, opts), catOpt).color;

// Diseño 1: "Tipo de medición: meta acumulada; promedio en ventana; cobertura"
describe('Diseño 1 — tres tipos de medición', () => {
  test('el motor expone exactamente los tres tipos del diseño', () => {
    assert.deepEqual([...MEASUREMENT_TYPES].sort(), ['coverage', 'cumulative_target', 'window_average']);
  });

  test('meta acumulada: resueltos / paquete (2.000) en %', () => {
    const cfg = { measurementType: 'cumulative_target', direction: 'higher_is_better', windowDays: 90, thresholds: { green: 96, yellow: 85 } };
    const ms = [
      { date: '2026-01-15', value: 700 },
      { date: '2026-02-15', value: 700 },
      { date: '2026-03-15', value: 520 },
    ];
    const m = measure(cfg, ms, { asOf: '2026-03-31', target: 2000 });
    assert.equal(m.value, 96);
    assert.equal(m.sampleSize, 3);
    assert.equal(evaluateColor(cfg, m).color, 'green');
  });

  test('meta acumulada: paquete que sube a 2.200 por P0/P1 nuevas baja el % de avance', () => {
    const cfg = { measurementType: 'cumulative_target', direction: 'higher_is_better', windowDays: 90, thresholds: { green: 96, yellow: 85 } };
    const ms = [{ date: '2026-03-01', value: 1920 }];
    assert.equal(measure(cfg, ms, { asOf: '2026-03-31', target: 2000 }).value, 96);
    const m = measure(cfg, ms, { asOf: '2026-03-31', target: 2200 });
    assert.ok(Math.abs(m.value - (1920 / 2200) * 100) < 1e-9);
    assert.equal(evaluateColor(cfg, m).color, 'yellow'); // 87,27 %
  });

  test('promedio en ventana: disponibilidad = media de valores en la ventana', () => {
    const cfg = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.5, yellow: 99 } };
    const ms = [
      { date: '2026-11-01', value: 99 },
      { date: '2026-11-10', value: 100 },
    ];
    const m = measure(cfg, ms, { asOf: '2026-11-30' });
    assert.equal(m.value, 99.5);
    assert.equal(m.sampleSize, 2);
  });

  test('cobertura: % de aplicaciones que cumplen, cada app cuenta una vez con su último dato', () => {
    const cfg = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 80, yellow: 60 } };
    const ms = [
      { date: '2026-11-01', appId: 'app-a', compliant: false },
      { date: '2026-11-20', appId: 'app-a', compliant: true }, // último: cumple
      { date: '2026-11-05', appId: 'app-b', compliant: true },
      { date: '2026-11-25', appId: 'app-b', compliant: false }, // último: no cumple
      { date: '2026-11-10', appId: 'app-c', compliant: true },
      { date: '2026-11-11', appId: 'app-d', compliant: true },
    ];
    const m = measure(cfg, ms, { asOf: '2026-11-30' });
    assert.equal(m.sampleSize, 4);
    assert.equal(m.value, 75);
    assert.equal(evaluateColor(cfg, m).color, 'yellow');
  });

  test('cobertura: dato sin "compliant" explícito no cuenta como cumplimiento', () => {
    const cfg = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 80, yellow: 60 } };
    const m = measure(cfg, [
      { date: '2026-11-10', appId: 'x' },
      { date: '2026-11-10', appId: 'y', compliant: true },
    ], { asOf: '2026-11-30' });
    assert.equal(m.value, 50);
  });
});

// Diseño 2: "Sentido: más es mejor (disponibilidad) o menos es mejor (MTTR, tiempo de ciclo)"
describe('Diseño 2 — sentido', () => {
  test('solo existen los dos sentidos del diseño', () => {
    assert.deepEqual([...DIRECTIONS].sort(), ['higher_is_better', 'lower_is_better']);
  });

  const up = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99 } };
  const down = { measurementType: 'window_average', direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 } };

  for (const [v, expected] of [[100, 'green'], [99.5, 'yellow'], [98, 'red']]) {
    test(`más es mejor: ${v} → ${expected}`, () => {
      assert.equal(evaluateColor(up, { value: v, sampleSize: 1 }).color, expected);
    });
  }
  for (const [v, expected] of [[2, 'green'], [6, 'yellow'], [10, 'red']]) {
    test(`menos es mejor (MTTR h): ${v} → ${expected}`, () => {
      assert.equal(evaluateColor(down, { value: v, sampleSize: 1 }).color, expected);
    });
  }

  test('sentido inverso: el mismo valor da colores opuestos', () => {
    const a = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 10, yellow: 5 } };
    const b = { measurementType: 'window_average', direction: 'lower_is_better', thresholds: { green: 5, yellow: 10 } };
    assert.equal(evaluateColor(a, { value: 12, sampleSize: 1 }).color, 'green');
    assert.equal(evaluateColor(b, { value: 12, sampleSize: 1 }).color, 'red');
    assert.equal(evaluateColor(a, { value: 2, sampleSize: 1 }).color, 'red');
    assert.equal(evaluateColor(b, { value: 2, sampleSize: 1 }).color, 'green');
  });

  test('umbrales incoherentes con el sentido se rechazan', () => {
    assert.equal(validateIndicator({ ...up, thresholds: { green: 90, yellow: 99 } }).ok, false);
    assert.equal(validateIndicator({ ...down, thresholds: { green: 8, yellow: 4 } }).ok, false);
    assert.throws(() => normalizeIndicator({ ...down, direction: 'sideways' }));
  });
});

// Diseño 3: "Ventana de cálculo: ej. últimos 30 días" + criterio "ventana vacía"
describe('Diseño 3 — ventana de cálculo', () => {
  const cfg = { measurementType: 'window_average', direction: 'lower_is_better', windowDays: 30, thresholds: { green: 4, yellow: 8 } };

  test('últimos 30 días: incluye asOf y asOf-29, excluye asOf-30 y fechas futuras', () => {
    const ms = [
      { date: '2026-11-30', value: 2 }, // asOf
      { date: '2026-11-01', value: 4 }, // asOf - 29
      { date: '2026-10-31', value: 100 }, // asOf - 30 → fuera
      { date: '2026-12-01', value: 100 }, // futuro → fuera
    ];
    const m = measure(cfg, ms, { asOf: '2026-11-30' });
    assert.deepEqual(m, { value: 3, sampleSize: 2 });
  });

  test('ventana cruza fin de año y febrero bisiesto', () => {
    const c = { ...cfg, windowDays: 2 };
    assert.equal(measure(c, [{ date: '2025-12-31', value: 1 }, { date: '2026-01-01', value: 3 }], { asOf: '2026-01-01' }).value, 2);
    assert.equal(measure(c, [{ date: '2028-02-29', value: 5 }], { asOf: '2028-03-01' }).value, 5);
  });

  test('ventana vacía (sin datos) → sin evaluar', () => {
    const m = measure(cfg, [], { asOf: '2026-11-30' });
    assert.deepEqual(m, { value: null, sampleSize: 0 });
    assert.equal(evaluateColor(cfg, m).color, 'not_evaluated');
  });

  test('ventana vacía (datos solo fuera de ventana) → sin evaluar, en los tres tipos', () => {
    const old = [{ date: '2026-01-01', value: 5, appId: 'a', compliant: true }];
    for (const measurementType of MEASUREMENT_TYPES) {
      const c = { ...cfg, measurementType, direction: 'higher_is_better', thresholds: { green: 90, yellow: 80 } };
      assert.equal(color(c, old, { asOf: '2026-11-30', target: 10 }), 'not_evaluated', measurementType);
    }
  });

  test('fecha de corte inválida es un error, no un color', () => {
    assert.throws(() => measure(cfg, [], { asOf: '2026-02-30' }));
    assert.throws(() => measure(cfg, [], { asOf: '30/11/2026' }));
  });

  test('el cálculo no muta las mediciones de entrada (función pura)', () => {
    const ms = [{ date: '2026-11-10', value: 5 }];
    const copy = structuredClone(ms);
    measure(cfg, ms, { asOf: '2026-11-30' });
    assert.deepEqual(ms, copy);
  });
});

// Diseño 4 + criterio: "Umbrales verde, amarillo, rojo" y "empates en umbral"
describe('Diseño 4 — umbrales exactos y empates', () => {
  const up = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 96, yellow: 85 } };
  const down = { measurementType: 'window_average', direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 } };

  test('más es mejor: empate exacto en verde → verde; en amarillo → amarillo', () => {
    assert.equal(evaluateColor(up, { value: 96, sampleSize: 1 }).color, 'green');
    assert.equal(evaluateColor(up, { value: 85, sampleSize: 1 }).color, 'yellow');
    assert.equal(evaluateColor(up, { value: 84.999, sampleSize: 1 }).color, 'red');
    assert.equal(evaluateColor(up, { value: 95.999, sampleSize: 1 }).color, 'yellow');
  });

  test('menos es mejor: empate exacto en verde → verde; en amarillo → amarillo', () => {
    assert.equal(evaluateColor(down, { value: 4, sampleSize: 1 }).color, 'green');
    assert.equal(evaluateColor(down, { value: 8, sampleSize: 1 }).color, 'yellow');
    assert.equal(evaluateColor(down, { value: 8.001, sampleSize: 1 }).color, 'red');
  });

  test('verde == amarillo: no hay banda amarilla', () => {
    const c = { ...up, thresholds: { green: 90, yellow: 90 } };
    assert.equal(evaluateColor(c, { value: 90, sampleSize: 1 }).color, 'green');
    assert.equal(evaluateColor(c, { value: 89.9, sampleSize: 1 }).color, 'red');
  });

  // Empates calculados (no literales): el valor medido es matemáticamente igual al umbral.
  test('empate calculado por cobertura: 57 de 100 apps con verde 57 % → verde', () => {
    const c = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 57, yellow: 40 } };
    const ms = Array.from({ length: 100 }, (_, i) => ({ date: '2026-11-10', appId: `app-${i}`, compliant: i < 57 }));
    assert.equal(color(c, ms, { asOf: '2026-11-30' }), 'green');
  });

  test('empate calculado por promedio: disponibilidad media (99,9 + 99,8 + 100)/3 = 99,9 con verde 99,9 → verde', () => {
    const c = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99 } };
    const ms = [
      { date: '2026-11-10', value: 99.9 },
      { date: '2026-11-11', value: 99.8 },
      { date: '2026-11-12', value: 100 },
    ];
    assert.equal(color(c, ms, { asOf: '2026-11-30' }), 'green');
  });

  test('empate calculado por promedio, menos es mejor: MTTR (2,2 + 2,3 + 2,4)/3 = 2,3 h con verde 2,3 → verde', () => {
    const c = { measurementType: 'window_average', direction: 'lower_is_better', thresholds: { green: 2.3, yellow: 5 } };
    const ms = [
      { date: '2026-11-10', value: 2.2 },
      { date: '2026-11-11', value: 2.3 },
      { date: '2026-11-12', value: 2.4 },
    ];
    assert.equal(color(c, ms, { asOf: '2026-11-30' }), 'green');
  });
});

// Caso vulnerabilidades: "Cumplimiento por criticidad: 96 % de P0/P1 y 85 % de P2/P3" + "opcionalmente por categoría"
describe('Caso vulnerabilidades — umbrales por categoría', () => {
  const vuln = {
    measurementType: 'cumulative_target',
    direction: 'higher_is_better',
    windowDays: 90,
    thresholds: { green: 85, yellow: 70 },
    thresholdsByCategory: {
      'P0/P1': { green: 96, yellow: 90 },
      'P2/P3': { green: 85, yellow: 70 },
    },
  };
  const ms = [
    { date: '2026-01-20', value: 100, category: 'P0/P1' },
    { date: '2026-02-20', value: 80, category: 'P0/P1' },
    { date: '2026-01-20', value: 900, category: 'P2/P3' },
    { date: '2026-03-10', value: 800, category: 'P2/P3' },
  ];
  const asOf = '2026-03-31';

  test('P0/P1: 192 de 200 = 96 % → verde (empate exacto)', () => {
    const m = measure(vuln, [...ms, { date: '2026-03-01', value: 12, category: 'P0/P1' }], { asOf, target: 200, category: 'P0/P1' });
    assert.equal(m.value, 96);
    assert.equal(evaluateColor(vuln, m, { category: 'P0/P1' }).color, 'green');
  });

  test('P0/P1: 180 de 200 = 90 % → amarillo; mismo 90 % en P2/P3 sería verde', () => {
    const m = measure(vuln, ms, { asOf, target: 200, category: 'P0/P1' });
    assert.equal(m.value, 90);
    assert.equal(evaluateColor(vuln, m, { category: 'P0/P1' }).color, 'yellow');
    assert.equal(evaluateColor(vuln, m, { category: 'P2/P3' }).color, 'green');
  });

  test('P2/P3: 1.700 de 2.000 = 85 % → verde (empate exacto); 84 % → amarillo', () => {
    const m = measure(vuln, ms, { asOf, target: 2000, category: 'P2/P3' });
    assert.equal(m.value, 85);
    assert.equal(evaluateColor(vuln, m, { category: 'P2/P3' }).color, 'green');
    assert.equal(evaluateColor(vuln, { value: 84, sampleSize: 2 }, { category: 'P2/P3' }).color, 'yellow');
  });

  test('el filtro de categoría no mezcla criticidades', () => {
    const m = measure(vuln, ms, { asOf, target: 200, category: 'P0/P1' });
    assert.equal(m.sampleSize, 2);
  });

  test('categoría sin umbrales propios usa los generales', () => {
    assert.equal(evaluateColor(vuln, { value: 80, sampleSize: 1 }, { category: 'P4' }).color, 'yellow');
    assert.equal(evaluateColor(vuln, { value: 80, sampleSize: 1 }).color, 'yellow');
  });

  test('umbrales por categoría incoherentes con el sentido se rechazan', () => {
    const bad = { ...vuln, thresholdsByCategory: { 'P0/P1': { green: 80, yellow: 96 } } };
    assert.equal(validateIndicator(bad).ok, false);
  });
});

// Diseño 6: "Mínimo de muestra: ej. MTTR solo se evalúa con un número mínimo de incidentes" + criterio "sin muestra suficiente → sin evaluar"
describe('Diseño 6 — mínimo de muestra', () => {
  const mttr = { measurementType: 'window_average', direction: 'lower_is_better', windowDays: 30, minSample: 3, thresholds: { green: 4, yellow: 8 } };
  const inc = (n, v) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(10 + i).padStart(2, '0')}`, value: v }));

  test('MTTR con 2 incidentes (mínimo 3) → sin evaluar, aunque el valor sea rojo', () => {
    const r = evaluateColor(mttr, measure(mttr, inc(2, 50), { asOf: '2026-11-30' }));
    assert.equal(r.color, 'not_evaluated');
    assert.match(r.reason, /2 de 3/);
  });

  test('MTTR con exactamente 3 incidentes (mínimo 3) → se evalúa', () => {
    assert.equal(color(mttr, inc(3, 50), { asOf: '2026-11-30' }), 'red');
    assert.equal(color(mttr, inc(3, 2), { asOf: '2026-11-30' }), 'green');
  });

  test('incidentes fuera de la ventana no cuentan para el mínimo', () => {
    const ms = [...inc(2, 2), { date: '2026-09-01', value: 2 }];
    assert.equal(color(mttr, ms, { asOf: '2026-11-30' }), 'not_evaluated');
  });

  test('cobertura: mínimo de muestra se mide en aplicaciones distintas, no en filas', () => {
    const c = { measurementType: 'coverage', direction: 'higher_is_better', minSample: 2, thresholds: { green: 80, yellow: 50 } };
    const ms = [
      { date: '2026-11-10', appId: 'a', compliant: true },
      { date: '2026-11-11', appId: 'a', compliant: true },
    ];
    assert.equal(color(c, ms, { asOf: '2026-11-30' }), 'not_evaluated');
  });

  test('mínimo de muestra inválido se rechaza', () => {
    assert.equal(validateIndicator({ ...mttr, minSample: -1 }).ok, false);
    assert.equal(validateIndicator({ ...mttr, minSample: 1.5 }).ok, false);
  });
});

// Objetivo: "Configurar indicadores de forma genérica (no solo los actuales)" + 7 atributos
describe('Indicador nuevo no previsto, configurado solo por datos', () => {
  // "Tasa de changes fallidos" — no está en la lista del diseño. Menos es mejor, ventana 14 días.
  const failedChanges = {
    measurementType: 'window_average',
    direction: 'lower_is_better',
    windowDays: 14,
    thresholds: { green: 5, yellow: 15 },
    frequency: 'weekly',
    minSample: 2,
    source: 'automatic',
  };

  test('se valida y se normaliza conservando los 7 atributos', () => {
    assert.deepEqual(validateIndicator(failedChanges), { ok: true, errors: [] });
    const n = normalizeIndicator(failedChanges);
    assert.equal(n.windowDays, 14);
    assert.equal(n.frequency, 'weekly');
    assert.equal(n.minSample, 2);
    assert.equal(n.source, 'automatic');
  });

  test('se evalúa sin código específico', () => {
    const ms = [
      { date: '2026-11-10', value: 10 },
      { date: '2026-11-15', value: 20 },
      { date: '2026-11-01', value: 0 }, // fuera de 14 días
    ];
    assert.equal(color(failedChanges, ms, { asOf: '2026-11-20' }), 'yellow');
  });

  test('cobertura nueva ("apps con SBOM") por categoría de criticidad de la app', () => {
    const sbom = {
      measurementType: 'coverage',
      direction: 'higher_is_better',
      windowDays: 60,
      thresholds: { green: 70, yellow: 50 },
      thresholdsByCategory: { critica: { green: 100, yellow: 90 } },
    };
    const ms = [
      { date: '2026-11-01', appId: 'c1', compliant: true, category: 'critica' },
      { date: '2026-11-01', appId: 'c2', compliant: false, category: 'critica' },
      { date: '2026-11-01', appId: 'n1', compliant: true, category: 'normal' },
    ];
    const m = measure(sbom, ms, { asOf: '2026-11-30', category: 'critica' });
    assert.equal(m.value, 50);
    assert.equal(evaluateColor(sbom, m, { category: 'critica' }).color, 'red');
    assert.equal(color(sbom, ms, { asOf: '2026-11-30' }), 'yellow'); // 2/3 global = 66,7 %
  });

  test('configuración sin tipo, sentido o umbrales se rechaza con mensajes', () => {
    const r = validateIndicator({});
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 3);
  });
});

// M-02 + M-03 + M-04 — Pruebas de seguridad del front y del motor de captura
// (categorías 1, 3, 4 y 8). Sin dependencias: node:test y un document falso.
//
// - Asignación de custodio (M-02): el plan y el orden de escritura "fallan
//   cerrado" (un corte a medias nunca deja más permisos que antes + el elegido).
// - CSV de mediciones (M-04): inyección de fórmulas, tipos, tamaños,
//   codificaciones, cabeceras hostiles y filas de otra unidad.
// - XSS (M-02..M-04): los datos de la BD (nombres, categorías, notas, mensajes
//   de error con el texto de la celda) solo llegan al DOM como texto.
// - Capa de datos (src/data/**): solo operaciones que RLS permite al rol; la
//   autorización real la prueba tests/security/api/* contra Supabase local.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import {
  parseMeasurementsCsv, validateMeasurementInput, isFormulaLike, tokenizeCsv,
  CSV_MAX_BYTES, CSV_MAX_ROWS,
} from '../../engine/measurements-input.js';
import {
  custodianAssignmentPlan, incoherentCustodians, buildIndicatorRow, toEngineIndicator,
} from '../../src/lib/indicator-form.js';
import { toMeasurementRow } from '../../src/lib/measurement-form.js';
import { buildCommitmentFields } from '../../src/lib/commitment-form.js';
import { resolveRoute, ROUTES } from '../../src/lib/route-logic.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.js$/.test(p) ? [p] : [];
  });
};

const UNITS = [
  { id: '22222222-2222-4222-8222-000000000001', name: 'Unidad Alfa' },
  { id: '22222222-2222-4222-8222-000000000002', name: 'Unidad Beta' },
];
const CTX = { units: UNITS, today: '2026-11-19' };
const WA = { measurementType: 'window_average', thresholdsByCategory: {} };
const COV = { measurementType: 'coverage', thresholdsByCategory: {} };
const CUM = { measurementType: 'cumulative_target', thresholdsByCategory: { P0P1: { green: 0, yellow: 1 }, P2: { green: 5, yellow: 10 } } };
const CUM_FREE = { measurementType: 'cumulative_target', thresholdsByCategory: {} };

// ---------------------------------------------------------------------------
// 1 · Asignación de custodio (user_roles) — falla cerrado
// ---------------------------------------------------------------------------
describe('1 · asignación de custodio (M-02)', () => {
  const IND = 'ind-1';
  const OTHER = 'ind-2';
  const roles = [
    { id: 'r1', user_id: 'uA', role: 'custodian', indicator_id: IND },
    { id: 'r2', user_id: 'uB', role: 'custodian', indicator_id: IND }, // incoherente: dos custodios
    { id: 'r3', user_id: 'uA', role: 'custodian', indicator_id: OTHER },
    { id: 'r4', user_id: 'uC', role: 'kpi_manager', indicator_id: IND }, // fila rara: no es custodio
  ];

  // Simula la secuencia de assignCustodian (borrar -> insertar -> columna) y
  // corta en cada paso. Devuelve los custodios del indicador tras el corte.
  function simulate(state, indicatorId, userId, failAt) {
    let rows = state.map((r) => ({ ...r }));
    const plan = custodianAssignmentPlan(indicatorId, userId, rows);
    const steps = [
      () => { rows = rows.filter((r) => !(plan.removeRoleIds.includes(r.id) && r.role === 'custodian')); },
      () => { if (plan.addRole) rows.push({ id: 'new', user_id: plan.setColumn, role: 'custodian', indicator_id: indicatorId }); },
      () => {},
    ];
    for (let i = 0; i < steps.length; i++) {
      if (i === failAt) break;
      steps[i]();
    }
    return new Set(rows.filter((r) => r.role === 'custodian' && r.indicator_id === indicatorId).map((r) => r.user_id));
  }

  test('el plan solo toca filas custodian del indicador pedido', () => {
    const p = custodianAssignmentPlan(IND, 'uD', roles);
    assert.deepEqual(p.removeRoleIds.sort(), ['r1', 'r2']);
    assert.equal(p.addRole, true);
    assert.equal(p.setColumn, 'uD');
    assert.ok(!p.removeRoleIds.includes('r3'), 'quita el rol de otro indicador');
    assert.ok(!p.removeRoleIds.includes('r4'), 'quita una fila que no es custodian');
  });

  test('quitar el custodio (vacío/null) borra todos y no concede nada', () => {
    for (const u of ['', null, undefined]) {
      const p = custodianAssignmentPlan(IND, u, roles);
      assert.equal(p.addRole, false);
      assert.equal(p.setColumn, null);
      assert.deepEqual(p.removeRoleIds.sort(), ['r1', 'r2']);
    }
  });

  test('reasignar al mismo custodio no inserta y elimina al sobrante', () => {
    const p = custodianAssignmentPlan(IND, 'uA', roles);
    assert.equal(p.addRole, false);
    assert.deepEqual(p.removeRoleIds, ['r2']);
  });

  test('corte en cualquier paso: custodios ⊆ (antes ∪ {elegido}) y nunca más de max(antes, 1)', () => {
    const before = new Set(['uA', 'uB']);
    for (const target of ['uA', 'uD', '']) {
      for (let failAt = 0; failAt <= 3; failAt++) {
        const after = simulate(roles, IND, target, failAt);
        for (const u of after) assert.ok(before.has(u) || u === target, `paso ${failAt}: ${u} ganó permisos`);
        // Tras borrar (paso 1 hecho) solo puede quedar el elegido.
        if (failAt >= 1) for (const u of after) assert.equal(u, target, `paso ${failAt}: ${u} conserva permisos`);
        if (failAt >= 2 && target) assert.deepEqual([...after], [target]);
      }
    }
  });

  test('carrera de dos pestañas con la lista vieja deja dos custodios, y la pantalla lo detecta (H-M02-01)', () => {
    let rows = [{ id: 'r1', user_id: 'uA', role: 'custodian', indicator_id: IND }];
    const p1 = custodianAssignmentPlan(IND, 'uX', rows);
    const p2 = custodianAssignmentPlan(IND, 'uY', rows);
    rows = rows.filter((r) => !p1.removeRoleIds.includes(r.id) && !p2.removeRoleIds.includes(r.id));
    rows.push({ id: 'n1', user_id: 'uX', role: 'custodian', indicator_id: IND });
    rows.push({ id: 'n2', user_id: 'uY', role: 'custodian', indicator_id: IND });
    const ind = { id: IND, custodian_user_id: 'uY' };
    assert.deepEqual(incoherentCustodians([ind], rows), [IND], 'la incoherencia no se señala');
  });

  test('src/data/indicators.js: orden borrar -> conceder -> columna informativa', () => {
    const src = read('src/data/indicators.js');
    const body = src.slice(src.indexOf('export async function assignCustodian'));
    const iDel = body.indexOf('deleteRoles(');
    const iAdd = body.indexOf('addCustodianRole(');
    const iCol = body.indexOf('custodian_user_id: plan.setColumn');
    assert.ok(iDel > 0 && iAdd > iDel && iCol > iAdd, 'el orden ya no falla cerrado');
  });

  test('src/data/roles.js: el borrado está acotado a role=custodian y el alta es role=custodian sin unidad', () => {
    const src = read('src/data/roles.js');
    assert.match(src, /\.delete\(\)\.in\('id', ids\)\.eq\('role', 'custodian'\)/);
    assert.match(src, /insert\(\{ user_id: userId, role: 'custodian', unit_id: null, indicator_id: indicatorId \}\)/);
    assert.doesNotMatch(src, /\.update\(/, 'roles.js no debe actualizar filas de user_roles');
  });
});

// ---------------------------------------------------------------------------
// 1/5 · Capa de datos: solo lo que RLS concede al rol
// ---------------------------------------------------------------------------
describe('1 · capa de datos src/data/**', () => {
  const files = walk('src/data');
  const all = files.map((f) => [f, read(f)]);

  test('hay archivos de datos', () => assert.ok(files.length >= 5));

  test('ningún .rpc(), .upsert() ni clave privilegiada en src/data', () => {
    for (const [f, s] of all) {
      assert.doesNotMatch(s, /\.rpc\s*\(/, `${f}: rpc`);
      assert.doesNotMatch(s, /\.upsert\s*\(/, `${f}: upsert (unit_id/indicator_id no son actualizables, H-F03-01)`);
      assert.doesNotMatch(s, new RegExp('sb_' + 'secret_|service' + '_role'), `${f}: clave privilegiada`);
    }
  });

  test('DELETE solo sobre user_roles (measurements y commitments no tienen DELETE por diseño)', () => {
    for (const [f, s] of all) {
      if (!/\.delete\s*\(/.test(s)) continue;
      assert.equal(f.replace(/\\/g, '/'), 'src/data/roles.js', `${f} borra filas`);
    }
  });

  test('el front no fija columnas que pone el servidor (created_by, created_at, source automatic)', () => {
    for (const [f, s] of all) {
      assert.doesNotMatch(s, /created_by\s*:/, `${f}: created_by`);
      assert.doesNotMatch(s, /created_at\s*:/, `${f}: created_at`);
      assert.doesNotMatch(s, /source\s*:\s*['"]automatic/, `${f}: source automatic`);
    }
    const row = toMeasurementRow('ind', { unitId: 'u', date: '2026-01-01', value: 1 });
    assert.equal(row.source, 'manual');
    assert.ok(!('created_by' in row) && !('created_at' in row) && !('id' in row));
  });

  test('los errores al usuario no exponen el error crudo de PostgREST', () => {
    const s = read('src/data/client.js');
    assert.doesNotMatch(s, /error\.(message|details|hint)/);
  });

  test('las rutas nuevas exigen el rol: custodio no entra a /gestora/indicadores, gestora no a /custodio/*', () => {
    const r1 = resolveRoute('/gestora/indicadores', { authenticated: true, roles: ['custodian'] });
    assert.notEqual(r1.view, 'kpi-indicators');
    for (const p of ['/custodio/compromisos', '/custodio/mediciones']) {
      const r = resolveRoute(p, { authenticated: true, roles: ['kpi_manager'] });
      assert.ok(!r.view.startsWith('custodian-'), p);
      const anon = resolveRoute(p, { authenticated: false, roles: ['custodian'] });
      assert.equal(anon.view, 'login');
    }
    for (const r of ROUTES) assert.ok(['kpi_manager', 'custodian', 'committee', 'unit_leader'].includes(r.role));
  });
});

// ---------------------------------------------------------------------------
// 3 · CSV de mediciones: fórmulas, tipos, tamaños, codificaciones, otra unidad
// ---------------------------------------------------------------------------
describe('3 · importación CSV (M-04)', () => {
  const FORMULAS = ['=1+1', '+1', '-1', '@SUM(A1)', '=HYPERLINK("http://x","y")', '=cmd|\'/c calc\'!A1', '\t=1', '\r=1'];

  test('isFormulaLike detecta = + - @ tab y CR al inicio', () => {
    for (const f of ['=1', '+1', '-1', '@x', '\tx', '\rx']) assert.ok(isFormulaLike(f), JSON.stringify(f));
    for (const f of ['1', 'a=1', 'Unidad Alfa', '']) assert.ok(!isFormulaLike(f), JSON.stringify(f));
  });

  test('fórmula en cada columna y cada tipo: la fila se rechaza y no se guarda nada', () => {
    const cases = [
      [WA, 'fecha,unidad,valor', (f) => [`${f},Unidad Alfa,1`, `2026-01-01,${f},1`, `2026-01-01,Unidad Alfa,${f}`]],
      [COV, 'fecha,unidad,app_id,cumple', (f) => [`2026-01-01,Unidad Alfa,${f},si`, `2026-01-01,Unidad Alfa,app1,${f}`]],
      [CUM, 'fecha,unidad,valor,categoria,tipo', (f) => [`2026-01-01,Unidad Alfa,1,${f},resuelta`, `2026-01-01,Unidad Alfa,1,P2,${f}`]],
      [CUM_FREE, 'fecha,unidad,valor,categoria', (f) => [`2026-01-01,Unidad Alfa,1,${f}`]],
    ];
    for (const [ind, header, lines] of cases) {
      for (const f of FORMULAS) {
        for (const line of lines(f.replace(/[\t\r]/g, ''))) {
          const quoted = line; // sin comillas
          const r = parseMeasurementsCsv(`${header}\n${quoted}\n`, ind, CTX);
          assert.equal(r.rows.length, 0, `${ind.measurementType}: ${JSON.stringify(line)} se aceptó`);
          assert.ok(r.errors.length > 0);
        }
      }
    }
  });

  test('fórmula entre comillas, con espacios o NBSP delante, también se rechaza', () => {
    for (const cell of ['"=1+1"', '"  =1"', ' =1', '" @x"', '"\t=1"']) {
      const r = parseMeasurementsCsv(`fecha,unidad,valor,categoria\n2026-01-01,Unidad Alfa,1,${cell}\n`, CUM_FREE, CTX);
      assert.equal(r.rows.length, 0, JSON.stringify(cell));
    }
  });

  test('ninguna celda aceptada empieza con un carácter de fórmula (lote mixto)', () => {
    const csv = ['fecha,unidad,valor,categoria,tipo', '2026-01-01,Unidad Alfa,3,P2,resuelta', '2026-01-02,unidad beta,0,p0p1,detectada'].join('\r\n');
    const r = parseMeasurementsCsv(csv, CUM, CTX);
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    for (const row of r.rows) for (const v of Object.values(row)) if (typeof v === 'string') assert.ok(!isFormulaLike(v), v);
  });

  test('tipos inválidos: negativos, NaN, Infinity, exponentes, hex, enteros enormes', () => {
    for (const v of ['abc', 'NaN', 'Infinity', '1e3', '0x10', '1,000.5', '', ' ', '1 2']) {
      assert.equal(validateMeasurementInput(WA, { fecha: '2026-01-01', unidad: 'Unidad Alfa', valor: v }, CTX).ok, false, v);
    }
    for (const v of ['1.5', '99999999999999999999', '-0']) {
      assert.equal(validateMeasurementInput(CUM_FREE, { fecha: '2026-01-01', unidad: 'Unidad Alfa', valor: v, categoria: 'x' }, CTX).ok, false, v);
    }
    assert.equal(validateMeasurementInput(COV, { fecha: '2026-01-01', unidad: 'Unidad Alfa', app_id: 'a', cumple: 'quizá' }, CTX).ok, false);
  });

  test('fechas: no reales, futuras o antiguas se rechazan', () => {
    for (const d of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '1999-12-31', '2026-11-20', "2026-01-01' or '1'='1"]) {
      assert.equal(validateMeasurementInput(WA, { fecha: d, unidad: 'Unidad Alfa', valor: '1' }, CTX).ok, false, d);
    }
  });

  test('filas que apuntan a otra unidad o a una unidad inexistente se rechazan', () => {
    for (const u of ['Unidad Gamma', '22222222-2222-4222-8222-000000000003', 'Unidad Alfa\' OR 1=1--', '*', '%']) {
      const r = parseMeasurementsCsv(`fecha,unidad,valor\n2026-01-01,${u},1\n`, WA, CTX);
      assert.equal(r.rows.length, 0, u);
    }
    // Si una fila es mala no se guarda ninguna (todo o nada).
    const mixed = parseMeasurementsCsv('fecha,unidad,valor\n2026-01-01,Unidad Alfa,1\n2026-01-01,Unidad Gamma,1\n', WA, CTX);
    assert.equal(mixed.rows.length, 0);
    assert.equal(mixed.errors[0].row, 3);
  });

  test('app_id: solo caracteres seguros (sin HTML, espacios ni comillas) y máx. 100', () => {
    for (const a of ['<script>', 'a b', 'a"b', "a'b", 'x'.repeat(101), '../../etc', '/abs']) {
      const ok = validateMeasurementInput(COV, { fecha: '2026-01-01', unidad: 'Unidad Alfa', app_id: a, cumple: 'si' }, CTX).ok;
      if (a === '../../etc' || a === '/abs') continue; // empieza por . o /: lo cubre el regex (primer carácter alfanumérico)
      assert.equal(ok, false, a);
    }
    assert.equal(validateMeasurementInput(COV, { fecha: '2026-01-01', unidad: 'Unidad Alfa', app_id: '/abs', cumple: 'si' }, CTX).ok, false);
  });

  test('categoría: con lista se exige una de ellas; libre, máximo 50', () => {
    assert.equal(validateMeasurementInput(CUM, { fecha: '2026-01-01', unidad: 'Unidad Alfa', valor: '1', categoria: 'P9' }, CTX).ok, false);
    assert.equal(validateMeasurementInput(CUM, { fecha: '2026-01-01', unidad: 'Unidad Alfa', valor: '1', categoria: '__proto__' }, CTX).ok, false);
    assert.equal(validateMeasurementInput(CUM_FREE, { fecha: '2026-01-01', unidad: 'Unidad Alfa', valor: '1', categoria: 'x'.repeat(51) }, CTX).ok, false);
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal(validateMeasurementInput(CUM, { fecha: '2026-01-01', unidad: 'Unidad Alfa', valor: '1', categoria: 'P2', tipo: k }, CTX).ok, false, k);
    }
  });

  test('cabeceras hostiles: __proto__, constructor, columnas repetidas o desconocidas', () => {
    for (const h of ['fecha,unidad,valor,__proto__', 'fecha,unidad,valor,constructor', 'fecha,unidad,valor,valor', 'fecha,unidad,valor,source', 'fecha,unidad,valor,unit_id']) {
      const extra = h.split(',').length - 3;
      const r = parseMeasurementsCsv(`${h}\n2026-01-01,Unidad Alfa,1${',x'.repeat(extra)}\n`, WA, CTX);
      assert.equal(r.rows.length, 0, h);
      assert.equal(r.errors[0].row, 1, h);
    }
    assert.equal(Object.prototype.polluted, undefined);
  });

  test('una fila no puede inyectar columnas de la BD (source, created_by, indicator_id)', () => {
    const r = parseMeasurementsCsv('fecha,unidad,valor\n2026-01-01,Unidad Alfa,1\n', WA, CTX);
    assert.equal(r.errors.length, 0);
    const row = toMeasurementRow('IND', r.rows[0]);
    assert.deepEqual(Object.keys(row).sort(), ['app_id', 'category', 'compliant', 'indicator_id', 'kind', 'measured_on', 'source', 'unit_id', 'value']);
    assert.equal(row.indicator_id, 'IND');
    assert.equal(row.source, 'manual');
  });

  test('tamaño: > 1 MB y > máximo de filas se rechazan sin procesar filas', () => {
    const big = `fecha,unidad,valor\n${'2026-01-01,Unidad Alfa,1\n'.repeat(Math.ceil(CSV_MAX_BYTES / 25) + 10)}`;
    const r1 = parseMeasurementsCsv(big, WA, CTX);
    assert.equal(r1.rows.length, 0);
    assert.match(r1.errors[0].message, /1 MB/);
    // Bytes UTF-8, no caracteres: 'ñ' ocupa 2 bytes.
    const multi = `fecha,unidad,valor\n${'ñ'.repeat(CSV_MAX_BYTES / 2 + 1)}`;
    assert.match(parseMeasurementsCsv(multi, WA, CTX).errors[0].message, /1 MB/);
    const many = `fecha,unidad,valor\n${'2026-01-01,Unidad Alfa,1\n'.repeat(CSV_MAX_ROWS + 1)}`;
    const r2 = parseMeasurementsCsv(many, WA, CTX);
    assert.equal(r2.rows.length, 0);
    assert.match(r2.errors[0].message, /máximo/);
  });

  test('archivo patológico: una celda enorme entre comillas o miles de separadores no cuelga el parser', () => {
    const t0 = Date.now();
    parseMeasurementsCsv(`fecha,unidad,valor\n"${'a'.repeat(900_000)}`, WA, CTX);
    parseMeasurementsCsv(`fecha,unidad,valor\n${','.repeat(900_000)}\n`, WA, CTX);
    parseMeasurementsCsv(`fecha,unidad,valor\n${'"",'.repeat(300_000)}\n`, WA, CTX);
    assert.ok(Date.now() - t0 < 5000, 'el parser tarda demasiado');
  });

  test('codificaciones raras: BOM, UTF-16 leído como texto, bytes nulos, separador ;', () => {
    assert.equal(parseMeasurementsCsv('﻿fecha,unidad,valor\n2026-01-01,Unidad Alfa,1\n', WA, CTX).errors.length, 0);
    assert.equal(parseMeasurementsCsv('fecha;unidad;valor\n2026-01-01;Unidad Alfa;1,5\n', WA, CTX).errors.length, 0);
    const utf16 = 'f\u0000e\u0000c\u0000h\u0000a\u0000,\u0000u\u0000n\u0000i\u0000d\u0000a\u0000d\u0000';
    assert.equal(parseMeasurementsCsv(`${utf16}\n`, WA, CTX).rows.length, 0);
    assert.equal(parseMeasurementsCsv('fecha,unidad,valor\n2026-01-01,Unidad\u0000Alfa,1\n', WA, CTX).rows.length, 0);
    assert.equal(parseMeasurementsCsv('fecha,unidad,valor\n2026-01-01,Unidad Alfa,1�\n', WA, CTX).rows.length, 0);
    assert.equal(parseMeasurementsCsv(42, WA, CTX).rows.length, 0);
  });

  test('comillas mal formadas se rechazan', () => {
    assert.ok(tokenizeCsv('a,b"c').error);
    assert.ok(tokenizeCsv('"abc').error);
    assert.equal(parseMeasurementsCsv('fecha,unidad,valor\n2026-01-01,"Unidad Alfa,1\n', WA, CTX).rows.length, 0);
  });

  test('el texto de los errores reproduce la celda: se muestra solo como texto (ver bloque XSS)', () => {
    const r = parseMeasurementsCsv('fecha,unidad,valor\n2026-01-01,<img src=x onerror=alert(1)>,1\n', WA, CTX);
    assert.match(r.errors[0].message, /<img src=x onerror=alert\(1\)>/);
  });
});

// ---------------------------------------------------------------------------
// 3 · Formularios de indicador y compromiso
// ---------------------------------------------------------------------------
describe('3 · formularios M-02 y M-03', () => {
  const base = {
    code: 'X1', name: 'n', measurement_type: 'window_average', direction: 'higher_is_better',
    window_days: '30', green: '90', yellow: '80', categories: [], frequency: 'monthly', min_sample: '0', source: 'manual',
  };

  test('código restringido y categorías sin __proto__ ni caracteres de marcado', () => {
    for (const code of ['<b>', "x' or 1=1", 'a b', '', 'x'.repeat(41)]) {
      assert.equal(buildIndicatorRow({ ...base, code }).ok, false, code);
    }
    for (const name of ['__proto__', '<img>', '=1', 'a"b']) {
      const r = buildIndicatorRow({ ...base, measurement_type: 'cumulative_target', direction: 'lower_is_better', categories: [{ name, green: '0', yellow: '1' }] });
      assert.equal(r.ok, false, name);
    }
  });

  test('el nombre admite cualquier texto (se guarda y se muestra como texto) pero con límite', () => {
    assert.equal(buildIndicatorRow({ ...base, name: '<script>alert(1)</script>' }).ok, true);
    assert.equal(buildIndicatorRow({ ...base, name: 'x'.repeat(121) }).ok, false);
    assert.equal(buildIndicatorRow({ ...base, description: 'x'.repeat(501) }).ok, false);
  });

  test('toEngineIndicator ignora __proto__ en thresholds_by_category de la BD', () => {
    const row = JSON.parse('{"measurement_type":"cumulative_target","thresholds_by_category":{"__proto__":{"green":1},"P2":{"green":1,"yellow":2}}}');
    const cfg = toEngineIndicator(row);
    assert.deepEqual(Object.keys(cfg.thresholdsByCategory), ['P2']);
    assert.equal({}.green, undefined);
  });

  test('compromiso: notas con límite, números estrictos', () => {
    const ind = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 90, yellow: 80 }, thresholdsByCategory: {} };
    assert.equal(buildCommitmentFields(ind, { period: '2027-Q1', notes: 'x'.repeat(501) }).ok, false);
    assert.equal(buildCommitmentFields(ind, { period: '2027-Q1', green: '1e3' }).ok, false);
    assert.equal(buildCommitmentFields(ind, { period: '2027-Q1', green: '=1' }).ok, false);
  });
});

// ---------------------------------------------------------------------------
// 4 · XSS en las tres pantallas: los datos solo llegan como texto
// ---------------------------------------------------------------------------
describe('4 · XSS (dom.js endurecido, H-F05-02)', async () => {
  // document falso mínimo: registra atributos, listeners y nodos de texto.
  const created = [];
  globalThis.document = {
    createElement(tag) {
      const n = {
        tag, attrs: {}, listeners: {}, children: [], _text: '', selected: false,
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(k, fn) { this.listeners[k] = fn; },
        append(...c) { this.children.push(...c); },
        replaceChildren(...c) { this.children = c; },
        set textContent(v) { this._text = String(v); this.children = []; },
        get textContent() { return this._text; },
      };
      created.push(n);
      return n;
    },
    createTextNode: (t) => ({ text: t }),
  };
  const { el, checkProp } = await import('../../src/views/dom.js');
  const { table, select, messages, field } = await import('../../src/views/form.js');

  const PAYLOADS = [
    '<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "javascript:alert('x')",
    '<svg/onload=alert(1)>', '{{constructor.constructor("alert(1)")()}}',
  ];

  test('table(): celdas con datos de la BD van como nodo de texto', () => {
    created.length = 0;
    for (const p of PAYLOADS) table(p, [p], [[p, p]]);
    const tds = created.filter((n) => n.tag === 'td');
    assert.ok(tds.length > 0);
    for (const td of tds) for (const c of td.children) assert.ok('text' in c, 'celda no es texto');
    for (const n of created) {
      for (const [k, v] of Object.entries(n.attrs)) assert.ok(!PAYLOADS.includes(v), `payload en atributo ${k}`);
      assert.deepEqual(Object.keys(n.listeners), []);
    }
  });

  test('select(): etiquetas (código · nombre, unidad) como texto; valor solo en el atributo value', () => {
    created.length = 0;
    select('x', PAYLOADS.map((p) => ({ value: p, label: p })));
    for (const o of created.filter((n) => n.tag === 'option')) {
      assert.ok(PAYLOADS.includes(o.textContent));
      assert.deepEqual(Object.keys(o.attrs), ['value']);
    }
  });

  test('messages().fail/ok: errores del CSV (con la celda) y del servidor como texto', () => {
    const m = messages();
    m.fail(PAYLOADS);
    const lis = m.error.children[0].children;
    for (const li of lis) assert.ok(PAYLOADS.includes(li.textContent));
    m.ok(PAYLOADS[0]);
    assert.equal(m.status.textContent, PAYLOADS[0]);
    assert.equal(m.status.children.length, 0);
  });

  test('field(): la pista y la etiqueta van como texto', () => {
    const c = el('input', { id: 'i1' });
    const f = field(PAYLOADS[0], c, PAYLOADS[1]);
    const [label, , hint] = f.children;
    assert.equal(label.textContent, PAYLOADS[0]);
    assert.equal(hint.textContent, PAYLOADS[1]);
  });

  test('el(): un dato no puede convertirse en manejador ni en URL javascript (H-F05-02 corregido)', () => {
    assert.throws(() => el('a', { href: PAYLOADS[2] }));
    assert.throws(() => el('div', { onclick: PAYLOADS[0] }));
    assert.throws(() => el('div', { [PAYLOADS[1]]: 'x' }));
    assert.equal(checkProp('value', PAYLOADS[0]), 'attr');
  });

  test('las vistas M-02..M-04 no usan sumideros HTML ni atributos peligrosos con datos', () => {
    const views = ['src/views/kpi_manager/indicators.js', 'src/views/custodian/commitments.js', 'src/views/custodian/measurements.js', 'src/views/form.js', 'src/views/role-shell.js'];
    const SINKS = new RegExp(['\\.inner' + 'HTML', '\\.outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document\\.wr' + 'ite', 'srcdoc', 'srcset', "el\\('(script|iframe|object|embed|frame|base|meta|link|style)'", 'set' + 'Attribute\\([\'"]on', "href:\\s*[^\\s`'\"#]", "href:\\s*`[^#]"].join('|'));
    for (const v of views) {
      const s = read(v);
      assert.doesNotMatch(s, SINKS, `${v} usa un sumidero o atributo peligroso`);
    }
  });
});

// ---------------------------------------------------------------------------
// 8 · Semilla nueva: ficticia
// ---------------------------------------------------------------------------
describe('8 · semilla (M-02..M-04)', () => {
  const seed = read('supabase/seed.sql');

  test('todos los correos son @example.test y los nombres dicen (ficticio)', () => {
    const emails = seed.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    assert.ok(emails.length >= 10);
    for (const e of emails) assert.match(e, /@example\.test$/, e);
    for (const m of seed.matchAll(/'[^']+@example\.test',\s*'([^']+)'/g)) assert.match(m[1], /\(fictici[oa]\)/, m[1]);
  });

  test('sin teléfonos, cédulas ni contraseñas distintas a la de prueba local', () => {
    assert.doesNotMatch(seed, /\b09\d{8}\b|\+593/);
    assert.doesNotMatch(seed, /\b\d{10}\b(?!-)/);
    assert.doesNotMatch(seed, new RegExp('sb_' + 'secret_|ey' + 'J[A-Za-z0-9_-]{10,}\\.'));
  });

  test('los indicadores nuevos de e2e están inactivos (no entran a la evaluación programada)', () => {
    for (const code of ['CHG', 'LAT']) {
      const i = seed.indexOf(`'${code}'`);
      assert.ok(i > 0, code);
      const tail = seed.slice(i, seed.indexOf(')', seed.indexOf("'manual'", i)) + 1);
      assert.match(tail, /false\)$/, `${code} activo`);
    }
  });

  test('el usuario sin rol no tiene filas en user_roles', () => {
    const roles = seed.slice(seed.indexOf('insert into public.user_roles'));
    assert.doesNotMatch(roles.slice(0, roles.indexOf(';')), /11111111-1111-4111-8111-000000000010/);
  });
});

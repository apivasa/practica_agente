// M-14 — Revisión estática de la migración que estrecha el borde de los CHECK `_safe`
// (categorías 1, 3 y 6): solo reemplaza restricciones, de forma atómica (DROP + ADD del mismo
// nombre dentro de un único ALTER TABLE por tabla), sin NOT VALID, sin funciones, grants,
// policies ni DML, con el mismo borde 9007199254740991.5 en todas y sin secretos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL('../../supabase/migrations/20261128120000_safe_cap_js_rounding_m14.sql', import.meta.url);
const sqlText = readFileSync(file, 'utf8');
const code = sqlText.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stmts = code.split(';').map((s) => s.trim()).filter(Boolean);

const EXPECTED = {
  indicators: ['indicators_green_threshold_safe', 'indicators_yellow_threshold_safe', 'indicators_thresholds_by_category_safe'],
  commitments: ['commitments_green_override_safe', 'commitments_yellow_override_safe',
    'commitments_package_total_safe', 'commitments_package_by_category_safe'],
  targets: ['targets_target_value_safe'],
  measurements: ['measurements_value_safe'],
};

test('M-14: no crea funciones, grants, policies, DML ni desactiva RLS', () => {
  assert.doesNotMatch(code, /create\s+(or\s+replace\s+)?function|security\s+definer/i);
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|\bpolicy\b/i);
  assert.doesNotMatch(code, /disable\s+row\s+level\s+security|no\s+force\s+row/i);
  assert.doesNotMatch(code, /\b(insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(code, /drop\s+(table|column|function|trigger|policy)/i);
  assert.doesNotMatch(code, /not\s+valid/i, 'los CHECK nuevos validan las filas existentes');
  assert.doesNotMatch(code, /if\s+exists/i, 'un DROP silencioso podría dejar la tabla sin CHECK');
  assert.doesNotMatch(sqlText, /sb_secret_|sb_publishable_|service_role|eyJhbGci|-----BEGIN/);
});

test('M-14: un único ALTER TABLE por tabla; cada DROP va seguido del ADD del mismo nombre', () => {
  assert.equal(stmts.length, Object.keys(EXPECTED).length, `sentencias: ${stmts.length}`);
  for (const [table, names] of Object.entries(EXPECTED)) {
    const own = stmts.filter((s) => new RegExp(`^alter\\s+table\\s+public\\.${table}\\b`, 'i').test(s));
    assert.equal(own.length, 1, `${table}: una sola sentencia (atómica)`);
    const st = own[0];
    const dropped = [...st.matchAll(/drop\s+constraint\s+(\w+)/gi)].map((m) => m[1]);
    const added = [...st.matchAll(/add\s+constraint\s+(\w+)/gi)].map((m) => m[1]);
    assert.deepEqual([...dropped].sort(), [...names].sort(), `${table}: DROP exactamente de sus CHECK _safe`);
    assert.deepEqual([...added].sort(), [...names].sort(), `${table}: ADD de los mismos nombres`);
    for (const n of names) {
      assert.ok(st.search(new RegExp(`drop\\s+constraint\\s+${n}\\b`, 'i'))
        < st.search(new RegExp(`add\\s+constraint\\s+${n}\\b`, 'i')), `${n}: ADD después del DROP`);
    }
  }
});

test('M-14: todos los topes son exactamente 9007199254740991.5 con comparación estricta', () => {
  const caps = code.match(/\d{12,}(\.\d+)?/g) ?? [];
  assert.ok(caps.length >= 9, `topes: ${caps.join(',')}`);
  assert.ok(caps.every((c) => c === '9007199254740991.5'), `topes: ${caps.join(',')}`);
  assert.doesNotMatch(code, /<=\s*9007199254740991\.5/, 'no admite el propio borde');
  const lt = code.match(/<\s*9007199254740991\.5/g) ?? [];
  const ge = code.match(/>=\s*9007199254740991\.5/g) ?? [];
  assert.equal(lt.length, 7, 'siete CHECK escalares con abs(x) < borde');
  assert.equal(ge.length, 2, 'dos jsonpath que buscan valores con abs() >= borde');
  for (const m of code.matchAll(/'(strict|lax)[^']*'/g)) {
    if (m[0].includes('abs()')) assert.match(m[0], /^'strict /, `jsonpath de tope en modo strict: ${m[0]}`);
  }
});

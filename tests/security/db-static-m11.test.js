// M-11 — Revisión estática de la migración del tope 2^53 (categorías 1 y 3):
// aditiva, sin funciones ni grants nuevos (sin superficie RPC), sin NOT VALID, con el mismo
// tope en todos los CHECK y cubriendo cada columna que H-M10-01 dejó abierta en scalar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL('../../supabase/migrations/20261126120000_numeric_safe_cap_m11.sql', import.meta.url);
const sqlText = readFileSync(file, 'utf8');
// Solo el código: fuera los comentarios de línea (las consultas de verificación van comentadas).
const code = sqlText.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test('M-11: no crea funciones, grants, policies ni desactiva RLS', () => {
  assert.doesNotMatch(code, /create\s+(or\s+replace\s+)?function/i);
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b/i);
  assert.doesNotMatch(code, /\bpolicy\b/i);
  assert.doesNotMatch(code, /disable\s+row\s+level\s+security|no\s+force\s+row/i);
  assert.doesNotMatch(code, /security\s+definer/i);
});

test('M-11: aditiva y validada (sin drop, sin NOT VALID)', () => {
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /not\s+valid/i);
  assert.doesNotMatch(code, /\b(delete|truncate|update)\b/i);
});

test('M-11: cada columna numeric configurable tiene su CHECK con tope 2^53 exacto', () => {
  const expected = {
    indicators_green_threshold_safe: 'green_threshold',
    indicators_yellow_threshold_safe: 'yellow_threshold',
    commitments_green_override_safe: 'green_override',
    commitments_yellow_override_safe: 'yellow_override',
    commitments_package_total_safe: 'package_total',
    targets_target_value_safe: 'target_value',
  };
  for (const [name, col] of Object.entries(expected)) {
    const m = code.match(new RegExp(`constraint\\s+${name}\\s+check\\s*\\(([^;]*?)\\)\\s*[,;]`, 'i'));
    assert.ok(m, `falta ${name}`);
    assert.match(m[1], new RegExp(`abs\\(${col}\\)\\s*<\\s*9007199254740992\\b`), `${name}: tope distinto de 2^53`);
  }
  // Ningún literal de tope distinto (p. ej. un 9007199254740993 o un <= que deje pasar 2^53).
  const caps = code.match(/\d{12,}/g) ?? [];
  assert.ok(caps.length >= 7 && caps.every((c) => c === '9007199254740992'), `topes: ${caps.join(',')}`);
  assert.doesNotMatch(code, /<=\s*9007199254740992/);
});

test('M-11: package_by_category se valida con jsonpath strict sobre todas las claves', () => {
  const m = code.match(/constraint\s+commitments_package_by_category_safe\s+check\s*\(([\s\S]*?)\)\);/i);
  assert.ok(m, 'falta commitments_package_by_category_safe');
  assert.match(m[1], /jsonb_path_exists\(/);
  assert.match(m[1], /'strict \$\.\* \? \(@\.type\(\) != "number" \|\| @\.abs\(\) >= 9007199254740992\)'/);
  assert.match(m[1], /not\s+jsonb_path_exists/);
});

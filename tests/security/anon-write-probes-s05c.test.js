// S-05c (H-QA-S05b-01/02) — Prueba estática (sin red ni BD) de las sondas de
// escritura anónima de la fase B (tests/security/prod/fase-b.test.js).
// Garantiza que cada sonda usa columnas que existen en el esquema de
// supabase/migrations y valores de enum válidos: si no, PostgREST respondería
// 400 PGRST204/22P02 antes del chequeo de privilegios y la sonda no probaría
// nada. También fija el veredicto estricto (solo 401/403 + 42501).
// Categorías 1 (RLS/privilegios) y 2 (enumeración en el login).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANON_WRITE_PROBES, PROBE_ENUMS, MISSING_UNIT, MISSING_USER, privilegeDenialProblem,
} from './prod/anon-write-probes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MIG_DIR = 'supabase/migrations';
const sql = readdirSync(join(ROOT, MIG_DIR)).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => read(join(MIG_DIR, f)))
  .join('\n')
  .replace(/--[^\n]*/g, '');

// Columnas por tabla: create table + alter table add/drop/rename column, en orden.
function schemaColumns() {
  const cols = {};
  const events = [];
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(/gi)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i += 1) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') depth -= 1;
    }
    events.push({ at: m.index, kind: 'create', table: m[1].toLowerCase(), body: sql.slice(start, i - 1) });
  }
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.(\w+)([^;]*);/gi)) {
    events.push({ at: m.index, kind: 'alter', table: m[1].toLowerCase(), body: m[2] });
  }
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    if (e.kind === 'create') {
      const parts = [];
      let depth = 0;
      let cur = '';
      for (const ch of e.body) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      cols[e.table] = new Set(parts
        .map((p) => p.trim().split(/\s+/)[0]?.toLowerCase())
        .filter((w) => w && !['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude', 'like'].includes(w))
        .map((w) => w.replace(/"/g, '')));
    } else {
      const set = cols[e.table] ?? (cols[e.table] = new Set());
      for (const a of e.body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) set.add(a[1].toLowerCase());
      for (const d of e.body.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi)) set.delete(d[1].toLowerCase());
      for (const r of e.body.matchAll(/rename\s+column\s+"?(\w+)"?\s+to\s+"?(\w+)"?/gi)) {
        set.delete(r[1].toLowerCase());
        set.add(r[2].toLowerCase());
      }
    }
  }
  return cols;
}
const COLS = schemaColumns();

function enumValues(type) {
  const m = sql.match(new RegExp(`create\\s+type\\s+public\\.${type}\\s+as\\s+enum\\s*\\(([^)]*)\\)`, 'i'));
  if (!m) return null;
  const vals = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  for (const a of sql.matchAll(new RegExp(`alter\\s+type\\s+public\\.${type}\\s+add\\s+value\\s+(?:if\\s+not\\s+exists\\s+)?'([^']*)'`, 'gi'))) vals.push(a[1]);
  return vals;
}

test('el parser de esquema reconoce columnas conocidas (control del propio parser)', () => {
  assert.ok(COLS.units?.has('name') && COLS.units.has('leader_user_id'));
  assert.ok(COLS.exceptions?.has('change_ref') && COLS.exceptions.has('revoked_at'), 'add column de C-02');
  assert.ok(!COLS.exceptions.has('name') && !COLS.audit_log.has('name') && !COLS.user_roles.has('name'),
    'la sonda antigua {name} no existe en estas tablas (H-QA-S05b-01)');
});

test('las sondas cubren las 4 tablas sensibles de la fase B', () => {
  assert.deepEqual(Object.keys(ANON_WRITE_PROBES).sort(), ['audit_log', 'exceptions', 'units', 'user_roles']);
});

for (const [table, body] of Object.entries(ANON_WRITE_PROBES)) {
  test(`sonda anon POST ${table}: solo columnas existentes en el esquema`, () => {
    assert.ok(COLS[table], `tabla public.${table} no encontrada en las migraciones`);
    const keys = Object.keys(body);
    assert.ok(keys.length > 0);
    const missing = keys.filter((k) => !COLS[table].has(k));
    assert.deepEqual(missing, [], `columnas inexistentes en public.${table}: PostgREST daría PGRST204`);
  });

  test(`sonda anon POST ${table}: incluye todas las columnas NOT NULL sin default`, () => {
    // No es imprescindible para el privilegio (42501 va antes que 23502), pero
    // deja la sonda bien formada: si anon tuviera INSERT, el error sería de FK
    // o la fila marcada, nunca un rechazo ambiguo por forma.
    const m = sql.match(new RegExp(`create\\s+table\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
    assert.ok(m);
    const required = m[1].split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\w+\s/.test(l) && /not null/i.test(l) && !/default|primary key|bigserial/i.test(l))
      .map((l) => l.split(/\s+/)[0].toLowerCase())
      .filter((c) => COLS[table].has(c)); // descarta líneas de CHECK/CASE (when …)
    const absent = required.filter((c) => !(c in body));
    assert.deepEqual(absent, [], `faltan columnas obligatorias en la sonda de ${table}`);
  });
}

for (const [col, [type, value]] of Object.entries(PROBE_ENUMS)) {
  test(`sonda ${col}: '${value}' es un valor válido de ${type}`, () => {
    const [table, column] = col.split('.');
    assert.equal(ANON_WRITE_PROBES[table][column], value);
    const vals = enumValues(type);
    assert.ok(vals, `enum ${type} no encontrado`);
    assert.ok(vals.includes(value), `${value} ∉ ${type} (${vals.join(', ')}): daría 22P02`);
  });
}

test('sondas no destructivas: FK a ids que no existen en la semilla; marcas reconocibles', () => {
  const seed = read('supabase/seed.sql');
  for (const id of [MISSING_UNIT, MISSING_USER]) assert.ok(!seed.includes(id), `${id} existe en la semilla`);
  assert.equal(ANON_WRITE_PROBES.exceptions.unit_id, MISSING_UNIT);
  assert.equal(ANON_WRITE_PROBES.user_roles.user_id, MISSING_USER);
  assert.equal(ANON_WRITE_PROBES.units.name, 's05-fase-b');
  assert.equal(ANON_WRITE_PROBES.audit_log.action, 's05-fase-b');
});

test('veredicto estricto: solo 401/403 con 42501 cuenta como denegación por privilegio', () => {
  const perm = { code: '42501', message: 'permission denied for table units' };
  assert.equal(privilegeDenialProblem(401, perm), null);
  assert.equal(privilegeDenialProblem(403, perm), null);
  // Lo que antes pasaba y ya no:
  assert.notEqual(privilegeDenialProblem(400, { code: 'PGRST204', message: "Could not find the 'name' column" }), null);
  assert.notEqual(privilegeDenialProblem(400, { code: '22P02' }), null);
  assert.notEqual(privilegeDenialProblem(400, null), null);
  assert.notEqual(privilegeDenialProblem(401, null), null, '401 del gateway sin 42501 no prueba el privilegio');
  assert.notEqual(privilegeDenialProblem(409, { code: '23503' }), null);
  assert.notEqual(privilegeDenialProblem(400, { code: '23502' }), null);
  assert.notEqual(privilegeDenialProblem(201, null), null);
  assert.notEqual(privilegeDenialProblem(400, perm), null);
});

test('fase-b.test.js usa las sondas compartidas y no acepta 400 genérico', () => {
  const src = read('tests/security/prod/fase-b.test.js');
  assert.match(src, /from '\.\/anon-write-probes\.js'/);
  assert.match(src, /Object\.entries\(ANON_WRITE_PROBES\)/);
  assert.match(src, /privilegeDenialProblem\(r\.status, r\.json\)/);
  assert.doesNotMatch(src, /body:\s*\{\s*name:\s*'s05-fase-b'\s*\}/, 'sonda antigua con columna inexistente');
  assert.doesNotMatch(src, /\[400,\s*401,\s*403\]/, 'acepta 400 genérico en una sonda de privilegio');
});

test('fase-b.test.js (roles): compara cuenta existente con clave errónea frente a correo inexistente', () => {
  const src = read('tests/security/prod/fase-b.test.js');
  const roles = src.slice(src.indexOf("describe('API REST con los 4 roles"));
  assert.ok(roles.length > 0 && src.includes("describe('API REST con los 4 roles"));
  assert.match(roles, /login\(users\.gestora\.email, wrong\)/);
  assert.match(roles, /login\('s05-no-existe@example\.invalid', wrong\)/);
  assert.match(roles, /assert\.deepEqual\(shape\(existing\), shape\(missing\)/);
  // Sin skip fijo ni .only: la suite roles solo se salta por S05_MODE.
  assert.doesNotMatch(src, /\btest\.(skip|only|todo)\b|\{\s*skip:\s*true/);
});

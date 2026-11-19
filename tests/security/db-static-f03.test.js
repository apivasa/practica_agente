// F-03+F-04+F-06 — Pruebas estáticas de seguridad sobre migraciones, semilla y workflows.
// Categoría 1 (RLS/grants por migración), 6 (secretos) y 8 (datos ficticios).
// Corren con `npm run test:unit` (node:test) sin base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MIG_DIR = 'supabase/migrations';
const migrations = existsSync(join(ROOT, MIG_DIR))
  ? readdirSync(join(ROOT, MIG_DIR)).filter((f) => f.endsWith('.sql')).sort()
  : [];
const allSql = migrations.map((f) => read(join(MIG_DIR, f))).join('\n');
const WF_DIR = '.github/workflows';
const workflows = existsSync(join(ROOT, WF_DIR))
  ? readdirSync(join(ROOT, WF_DIR)).filter((f) => /\.ya?ml$/.test(f))
  : [];

// --- 8 · La semilla nunca llega a producción --------------------------------
// `supabase db push` no aplica seed.sql salvo con --include-seed; `db reset`
// contra un proyecto remoto (--linked / --db-url) sí lo aplica y además borra datos.
for (const wf of workflows) {
  const body = read(join(WF_DIR, wf));
  test(`workflow ${wf}: no aplica la semilla ni resetea una BD remota`, () => {
    assert.doesNotMatch(body, /--include-seed/, 'db push --include-seed subiría usuarios con contraseña conocida');
    assert.doesNotMatch(body, /db\s+reset[^\n]*(--linked|--db-url)/, 'db reset remoto aplica seed.sql y es destructivo');
    assert.doesNotMatch(body, /psql[^\n]*seed\.sql/, 'seed.sql aplicado a mano');
  });
}

test('config.toml: si existe [db.seed], no apunta a archivos fuera de supabase/', () => {
  const cfg = existsSync(join(ROOT, 'supabase/config.toml')) ? read('supabase/config.toml') : '';
  const m = cfg.match(/\[db\.seed\][^[]*sql_paths\s*=\s*\[([^\]]*)\]/);
  if (m) assert.doesNotMatch(m[1], /\.\.\//);
});

// --- 8 · Semilla ficticia ----------------------------------------------------
test('seed.sql: todos los correos usan el dominio reservado example.test', () => {
  const seed = read('supabase/seed.sql');
  const emails = seed.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  assert.ok(emails.length > 0);
  for (const e of emails) assert.match(e, /@example\.test$/, `correo no ficticio: ${e}`);
});

test('seed.sql: sin teléfonos, cédulas ni claves de Supabase', () => {
  const seed = read('supabase/seed.sql');
  assert.doesNotMatch(seed, /sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(seed, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT en la semilla');
  assert.doesNotMatch(seed, /\+?\b593\s?\d{8,9}\b|\b09\d{8}\b/, 'número de teléfono');
  assert.doesNotMatch(seed, /\b\d{10}\b/, 'número de 10 dígitos (posible cédula)');
});

test('seed.sql: la contraseña de prueba se declara solo local', () => {
  const seed = read('supabase/seed.sql');
  assert.match(seed, /solo local/i);
});

// --- 1 · Cada tabla creada en migraciones activa RLS ------------------------
const created = [...allSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(public\.)?"?(\w+)"?/gi)]
  .map((m) => m[2]);
test('migraciones: hay tablas', () => assert.ok(created.length >= 10));
for (const t of created) {
  test(`migraciones: ${t} tiene enable row level security`, () => {
    const re = new RegExp(`alter\\s+table\\s+(public\\.)?"?${t}"?\\s+enable\\s+row\\s+level\\s+security`, 'i');
    assert.match(allSql, re);
  });
}

// --- 1 · Funciones security definer con search_path fijado -------------------
test('migraciones: toda función security definer fija search_path', () => {
  const fns = allSql.split(/create\s+(?:or\s+replace\s+)?function/i).slice(1);
  for (const f of fns) {
    const head = f.split('$$')[0];
    if (/security\s+definer/i.test(head)) {
      assert.match(head, /set\s+search_path\s*=\s*''/i, `sin search_path vacío: ${head.slice(0, 60)}`);
    }
  }
});

test('migraciones: ninguna concede privilegios a anon', () => {
  assert.doesNotMatch(allSql, /grant\s+[^;]*\bto\s+[^;]*\banon\b/i);
});

test('migraciones: nunca conceden TRUNCATE, REFERENCES, TRIGGER ni ALL a authenticated', () => {
  for (const m of allSql.matchAll(/grant\s+([^;]*?)\s+on\s+[^;]*?\bto\s+([^;]*)/gi)) {
    if (/\bauthenticated\b/i.test(m[2]) && !/^(usage|execute)/i.test(m[1].trim())) {
      assert.doesNotMatch(m[1], /\b(truncate|references|trigger|all)\b/i, m[0]);
    }
  }
});

test('migraciones: no exponen el esquema private ni crean security definer en public', () => {
  assert.doesNotMatch(allSql, /grant\s+usage\s+on\s+schema\s+private\s+to\s+[^;]*\b(anon|public)\b/i);
  const fns = [...allSql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(public\.)?(\w+)\s*\(([\s\S]*?)\$\$/gi)];
  for (const m of fns) {
    if (m[1] || !/\./.test(m[2])) {
      // función sin esquema o en public
      if (/security\s+definer/i.test(m[3])) assert.fail(`security definer en public: ${m[2]}`);
    }
  }
});

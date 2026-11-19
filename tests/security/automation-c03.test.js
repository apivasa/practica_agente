// C-03/C-04 — Seguridad de las automatizaciones programadas (categorías 5 y 8).
// Estáticas sobre evaluacion-mensual.yml y ritmo-diario.yml, y unitarias sobre
// scripts/lib (validación de entradas, fuga de la clave, auditoría, datos manipulados).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from '../../scripts/lib/dates.js';
import { readConfig } from '../../scripts/lib/config.js';
import { createDb } from '../../scripts/lib/db.js';
import { runMonthly, runDaily, ACTOR } from '../../scripts/lib/run.js';
import { buildPackageInput } from '../../scripts/lib/build.js';
import { createFakeDb, seedScenario, IDS } from '../scripts/fake-db.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCHEDULED = ['evaluacion-mensual.yml', 'ritmo-diario.yml'];
const wfText = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
const FAKE_KEY = 'sb_secret_SECURITYTEST_do_not_leak_0123456789abcdef';

// ---------------------------------------------------------------------------
// Categoría 5: workflows programados
// ---------------------------------------------------------------------------
for (const name of SCHEDULED) {
  describe(`${name}`, () => {
    const text = wfText(name);
    const header = text.split(/^jobs:/m)[0];
    const lines = text.split('\n');

    test('solo schedule y workflow_dispatch (nunca push/pull_request con la clave secreta)', () => {
      assert.match(header, /^\s{2}schedule:/m);
      assert.match(header, /^\s{2}workflow_dispatch:/m);
      assert.doesNotMatch(header, /^\s{2}(push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch|issue_comment):/m);
    });

    test('permissions: contents: read y nada más; sin permisos por job', () => {
      assert.match(header, /^permissions:\n {2}contents: read\n(?! {2}\S)/m);
      assert.doesNotMatch(text.split(/^jobs:/m)[1], /^\s+permissions:/m);
    });

    test('concurrency compartida y sin cancelar ejecuciones en curso', () => {
      assert.match(header, /group:\s*evaluacion-produccion/);
      assert.match(header, /cancel-in-progress:\s*false/);
      assert.match(text, /timeout-minutes:\s*\d+/);
    });

    test('secretos solo vía secrets.* mapeados a env, nunca en run:', () => {
      const secretLines = lines.filter((l) => /secrets\./.test(l));
      assert.ok(secretLines.length > 0);
      for (const l of secretLines) {
        assert.match(l, /^\s+[A-Z_]+:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}\s*$/, `uso de secreto fuera de env: ${l.trim()}`);
      }
      // Solo los dos secretos del backend.
      const used = new Set([...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
      assert.deepEqual([...used].sort(), ['SUPABASE_SECRET_KEY', 'SUPABASE_URL']);
      assert.doesNotMatch(text, /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{10,}/, 'clave literal o legada en el workflow');
    });

    test('input as_of solo por env (sin interpolación en run:) y entrecomillado', () => {
      for (const [i, l] of lines.entries()) {
        if (!/\$\{\{[^}]*(inputs\.|github\.event\.inputs)/.test(l)) continue;
        assert.match(l, /^\s+AS_OF:\s*\$\{\{\s*inputs\.as_of\s*\}\}\s*$/, `${name}:${i + 1} interpola un input fuera de env`);
      }
      const runEval = lines.find((l) => /node scripts\/evaluate\.js/.test(l));
      assert.ok(runEval);
      assert.match(runEval, /--as-of="\$\{AS_OF\}"\s*$/, 'AS_OF debe ir entrecomillado');
      assert.doesNotMatch(runEval, /\$\{\{/);
    });

    test('guarda EVALUATION_ENABLED y secretos: todo paso posterior depende del check', () => {
      assert.match(text, /EVALUATION_ENABLED:\s*\$\{\{\s*vars\.EVALUATION_ENABLED\s*\}\}/);
      assert.match(text, /"\$EVALUATION_ENABLED" != "true"/);
      assert.match(text, /-z "\$SUPABASE_URL" \] \|\| \[ -z "\$SUPABASE_SECRET_KEY"/);
      const steps = text.split(/^\s{6}- /m).slice(1);
      assert.ok(steps[0].includes('id: check'), 'el primer paso debe ser el check');
      for (const s of steps.slice(1)) {
        assert.match(s, /if:\s*steps\.check\.outputs\.ready == 'true'/, `paso sin guarda: ${s.split('\n')[0]}`);
      }
    });

    test('los ::warning:: no imprimen variables con secretos', () => {
      for (const l of lines.filter((x) => /echo|printf/.test(x))) {
        assert.doesNotMatch(l, /\$\{?(SUPABASE_SECRET_KEY|SUPABASE_URL)\b/, `imprime un secreto: ${l.trim()}`);
      }
    });

    test('instala solo dependencias de producción sin scripts', () => {
      assert.match(text, /npm ci --ignore-scripts --omit=dev/);
    });
  });
}

test('integration.sh: solo contra Supabase local y enmascara la clave', () => {
  const sh = readFileSync(join(ROOT, 'scripts', 'ci', 'integration.sh'), 'utf8');
  assert.match(sh, /http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*\) ;;/);
  assert.match(sh, /::add-mask::\$\{SUPABASE_SECRET_KEY\}/);
  assert.doesNotMatch(sh, /set -x|secrets\./);
  // Si falta algo, lista solo los nombres de las variables, no sus valores.
  assert.match(sh, /cut -d= -f1/);
});

// ---------------------------------------------------------------------------
// Categoría 3/5: validación de --as-of y argumentos
// ---------------------------------------------------------------------------
describe('parseArgs rechaza entradas manipuladas', () => {
  const bad = [
    '2027-02-01; rm -rf /',
    '$(id)',
    '`id`',
    '2027-02-01 --mode=daily',
    '2027-02-01\n--mode=daily',
    '2027-02-31',
    '2027-2-1',
    '27-02-01',
    '2027-02-01T00:00:00Z',
    '../../etc/passwd',
    ' 2027-02-01',
  ];
  for (const v of bad) {
    test(`--as-of=${JSON.stringify(v)}`, () => {
      assert.throws(() => parseArgs(['--mode=monthly', `--as-of=${v}`]), TypeError);
    });
  }
  test('modo y argumentos desconocidos', () => {
    assert.throws(() => parseArgs(['--mode=delete']), TypeError);
    assert.throws(() => parseArgs(['--mode=monthly', '--url=https://attacker.invalid']), TypeError);
    assert.throws(() => parseArgs(['--mode=monthly', '--key=x']), TypeError);
    assert.throws(() => parseArgs([]), TypeError);
  });
  test('vacío = hoy en America/Guayaquil', () => {
    // 2027-02-01 03:00 UTC = 2027-01-31 22:00 en Guayaquil.
    assert.equal(parseArgs(['--mode=daily', '--as-of='], new Date('2027-02-01T03:00:00Z')).asOf, '2027-01-31');
  });
});

// ---------------------------------------------------------------------------
// Categoría 2/5: la clave secreta nunca sale en errores ni en logs
// ---------------------------------------------------------------------------
describe('readConfig no filtra la clave', () => {
  const cases = [
    { SUPABASE_URL: 'no es url', SUPABASE_SECRET_KEY: FAKE_KEY },
    { SUPABASE_URL: 'http://prod.example.invalid', SUPABASE_SECRET_KEY: FAKE_KEY },
    { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: `eyJhbGciOiJIUzI1NiJ9.${FAKE_KEY}` },
    { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: `sb_publishable_${FAKE_KEY}` },
    { SUPABASE_URL: '', SUPABASE_SECRET_KEY: FAKE_KEY },
  ];
  for (const env of cases) {
    test(`rechaza ${JSON.stringify(env.SUPABASE_URL)} / ${env.SUPABASE_SECRET_KEY.slice(0, 8)}…`, () => {
      assert.throws(
        () => readConfig(env),
        (err) => !err.message.includes('SECURITYTEST') && !err.message.includes(env.SUPABASE_SECRET_KEY),
      );
    });
  }
  test('acepta solo https o http local con clave sb_secret_', () => {
    assert.equal(readConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: FAKE_KEY }).secretKey, FAKE_KEY);
    assert.doesNotThrow(() => readConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: FAKE_KEY }));
    // Un host que solo empieza como local no pasa por local.
    assert.throws(() => readConfig({ SUPABASE_URL: 'http://localhost.attacker.invalid', SUPABASE_SECRET_KEY: FAKE_KEY }));
    assert.throws(() => readConfig({ SUPABASE_URL: 'http://127.0.0.1.nip.io', SUPABASE_SECRET_KEY: FAKE_KEY }));
  });
});

describe('scripts/evaluate.js no imprime la clave', () => {
  const run = (args, env) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'evaluate.js'), ...args], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    });
  const noLeak = (r) => {
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(!out.includes(FAKE_KEY) && !out.includes('SECURITYTEST'), `la salida contiene la clave:\n${out}`);
  };

  test('argumento inválido: sale 2 sin la clave', () => {
    const r = run(['--mode=monthly', '--as-of=$(id)'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: FAKE_KEY });
    assert.equal(r.status, 2);
    noLeak(r);
  });
  test('clave legada: sale 2 sin la clave', () => {
    const r = run(['--mode=daily'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: `eyJ${FAKE_KEY}` });
    assert.equal(r.status, 2);
    noLeak(r);
  });
  test('backend inalcanzable (o sin dependencias): falla sin la clave', () => {
    // Puerto 9 local: conexión rechazada al instante. Nunca sale de la máquina.
    const r = run(['--mode=daily', '--as-of=2027-02-10'], { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SECRET_KEY: FAKE_KEY });
    assert.notEqual(r.status, 0);
    noLeak(r);
  });
});

/** Cliente supabase-js falso: registra la cadena de llamadas y devuelve `result`. */
function recordingClient(result) {
  const calls = [];
  const builder = (table) => {
    const chain = [];
    calls.push({ table, chain });
    const p = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') return (res, rej) => Promise.resolve(result()).then(res, rej);
          return (...args) => {
            chain.push([prop, ...args]);
            return p;
          };
        },
      },
    );
    return p;
  };
  return { calls, sb: { from: builder } };
}

describe('scripts/lib/db.js', () => {
  test('los errores de PostgREST no llevan la clave ni cabeceras', async () => {
    const { sb } = recordingClient(() => ({ data: null, error: { message: 'permission denied for table units', hint: FAKE_KEY } }));
    const db = createDb(sb);
    await assert.rejects(db.units(), (err) => /^units: permission denied/.test(err.message) && !err.message.includes(FAKE_KEY));
  });

  test('los snapshots del ritmo solo se leen si los escribió system:evaluate', async () => {
    const { sb, calls } = recordingClient(() => ({ data: [], error: null }));
    await createDb(sb).paceSnapshots(['u:i'], '2027-Q1');
    const chain = calls.find((c) => c.table === 'audit_log').chain;
    assert.ok(chain.some(([m, col, v]) => m === 'eq' && col === 'actor' && v === ACTOR), 'falta filtro por actor');
    assert.ok(chain.some(([m, col, v]) => m === 'eq' && col === 'action' && v === 'pace_snapshot'));
  });

  test('las alertas se insertan sin sobrescribir existentes (ignoreDuplicates por dedupe_key)', async () => {
    const { sb, calls } = recordingClient(() => ({ data: [], error: null }));
    await createDb(sb).insertAlerts([{ kind: 'pace_behind', dedupe_key: 'k' }]);
    const up = calls.find((c) => c.table === 'alerts').chain.find(([m]) => m === 'upsert');
    assert.deepEqual(up[2], { onConflict: 'dedupe_key', ignoreDuplicates: true });
  });
});

// ---------------------------------------------------------------------------
// Categoría 8: auditoría de cada efecto
// ---------------------------------------------------------------------------
describe('auditoría de efectos con actor system:evaluate', () => {
  test('mensual: cada evaluación escrita y cada alerta enviada quedan auditadas', async () => {
    const db = createFakeDb(seedScenario());
    const r = await runMonthly(db, { asOf: '2027-02-01' });
    assert.deepEqual(r.errors, []);
    const audit = db.tables.audit_log;
    assert.ok(audit.every((a) => a.actor === ACTOR));
    const audited = new Set(audit.map((a) => a.entity_id));
    for (const e of db.tables.evaluations) assert.ok(audited.has(e.id), `evaluación sin auditoría ${e.id}`);
    for (const a of db.tables.alerts) {
      assert.ok(audit.some((x) => x.action === 'alert_sent' && x.entity_id === a.id), `alerta sin auditoría ${a.id}`);
    }
    // Candados aplicados auditados como escalation_applied.
    const unitEvals = db.tables.evaluations.filter((e) => e.indicator_id === null);
    assert.equal(audit.filter((a) => a.action === 'escalation_applied').length, unitEvals.length);
  });

  test('diario: excepción vencida auditada una sola vez aunque se corra dos veces', async () => {
    const db = createFakeDb(seedScenario());
    await runDaily(db, { asOf: '2027-02-11' });
    await runDaily(db, { asOf: '2027-02-11' });
    const exp = db.tables.audit_log.filter((a) => a.action === 'exception_expired');
    assert.deepEqual(exp.map((a) => a.entity_id).sort(), ['ex-beta', 'ex-gamma']);
    assert.ok(exp.every((a) => a.actor === ACTOR));
    for (const a of db.tables.alerts) {
      assert.equal(db.tables.audit_log.filter((x) => x.action === 'alert_sent' && x.entity_id === a.id).length, 1);
    }
  });

  test('la auditoría no incluye la clave ni la URL del backend', async () => {
    const db = createFakeDb(seedScenario());
    await runMonthly(db, { asOf: '2027-02-01' });
    await runDaily(db, { asOf: '2027-02-10' });
    const dump = JSON.stringify([db.tables.audit_log, db.tables.alerts]);
    assert.doesNotMatch(dump, /sb_secret_|supabase\.co|SUPABASE_/);
  });
});

// ---------------------------------------------------------------------------
// Datos manipulados por un custodio no quitan candados ni silencian alertas
// ---------------------------------------------------------------------------
describe('datos manipulados', () => {
  const vuln = seedScenario().indicators.find((i) => i.id === IDS.I.vuln);
  const commitment = { package_by_category: { P0P1: 1500, P2P3: 500 } };
  const mrow = (measured_on, value, category, kind) => ({ measured_on, value, category, kind, created_at: `${measured_on}T00:00:00Z` });

  test('mediciones futuras, de otro trimestre o "detected" no cuentan como resueltas', () => {
    const built = buildPackageInput({
      indicator: vuln,
      commitment,
      asOf: '2027-02-10',
      measurements: [
        mrow('2027-02-28', 5000, 'P0P1', 'resolved'), // futura
        mrow('2026-12-31', 5000, 'P0P1', 'resolved'), // trimestre anterior
        mrow('2027-02-01', 5000, 'P0P1', 'detected'), // ingreso, no resolución
      ],
    });
    assert.ok(built.ok);
    assert.deepEqual(built.input.resolved, []);
  });

  test('valores no finitos se neutralizan (no hay "al día" por desborde)', () => {
    const built = buildPackageInput({
      indicator: vuln,
      commitment,
      asOf: '2027-02-10',
      measurements: [mrow('2027-02-01', '1e400', 'P0P1', 'resolved'), mrow('2027-02-01', 'NaN', 'P0P1', 'resolved')],
    });
    assert.ok(built.input.resolved.every((r) => r.count === null));
  });

  test('una medición nueva no reescribe el color guardado del mes anterior (candado vigente)', async () => {
    const data = seedScenario();
    const db = createFakeDb(data);
    await runMonthly(db, { asOf: '2027-02-01' });
    const beforeJan = db.tables.evaluations.filter((e) => e.month === '2027-01').map((e) => ({ ...e }));
    // El custodio carga después del cierre un dato de enero que lo volvería verde.
    db.tables.measurements.push({ ...data.measurements[2], value: 5000 });
    await runMonthly(db, { asOf: '2027-03-01' });
    const afterJan = db.tables.evaluations.filter((e) => e.month === '2027-01');
    assert.deepEqual(
      afterJan.map((e) => [e.id, e.color, e.escalation_level]),
      beforeJan.map((e) => [e.id, e.color, e.escalation_level]),
      'el cierre de febrero no recalcula enero',
    );
  });

  test('una alerta leída por el usuario no impide alertas nuevas de otro disparador', async () => {
    const db = createFakeDb(seedScenario());
    await runDaily(db, { asOf: '2027-02-10' });
    for (const a of db.tables.alerts) a.read_at = '2027-02-10T12:00:00Z';
    const n = db.tables.alerts.length;
    await runDaily(db, { asOf: '2027-02-11' });
    assert.ok(db.tables.alerts.length > n, 'el vencimiento del 11 debe alertar aunque lo anterior esté leído');
  });
});

// ---------------------------------------------------------------------------
// Migración de dedupe y semilla
// ---------------------------------------------------------------------------
test('migración alerts_dedupe: aditiva y sin privilegios nuevos', () => {
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '20261120120000_alerts_dedupe.sql'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
  assert.doesNotMatch(sql, /\bgrant\b|\bpolicy\b|disable row level security|security definer|\bdrop\b/i);
  assert.match(sql, /add constraint alerts_dedupe_key_unique unique \(dedupe_key\)/);
});

test('seed: excepciones y compromisos nuevos ficticios, sin correos reales ni claves', () => {
  const seed = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8');
  assert.doesNotMatch(seed, /sb_secret_|sb_publishable_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}/);
  const emails = [...seed.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((m) => m[0]);
  for (const e of emails) assert.match(e, /@(example\.(com|org|net|test)|[\w-]+\.(test|example|invalid|local))$/i, `correo no ficticio: ${e}`);
  const block = seed.slice(seed.indexOf('insert into public.exceptions')).split(';')[0];
  const rows = block.match(/\('4444[^)]*\)/g) ?? [];
  assert.ok(rows.length > 0, 'se esperaban excepciones en la semilla');
  for (const r of rows) assert.match(r, /ficti/i, `motivo de excepción no marcado como ficticio: ${r}`);
});

#!/usr/bin/env node
// C-03/C-04: evaluación programada (GitHub Actions).
//   node scripts/evaluate.js --mode=monthly|daily [--as-of=YYYY-MM-DD] [--reprocess]
// --as-of no puede ser posterior a hoy (America/Guayaquil); --reprocess vuelve a cerrar un
// mes ya evaluado y queda auditado. EVALUATE_ALLOW_FUTURE=1 solo vale contra Supabase local.
// Lee SUPABASE_URL y SUPABASE_SECRET_KEY del entorno (nunca se imprimen).
import { parseArgs, assertNotFuture, allowFutureFromEnv } from './lib/dates.js';
import { runMonthly, runDaily, MonthClosedError } from './lib/run.js';
import { readConfig } from './lib/config.js';

async function main() {
  let args;
  let config;
  try {
    args = parseArgs(process.argv.slice(2));
    config = readConfig(process.env);
    assertNotFuture(args.asOf, { allowFuture: allowFutureFromEnv(process.env, config.url) });
  } catch (err) {
    console.error(`Error de configuración: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const { createDb } = await import('./lib/db.js');
  const sb = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const db = createDb(sb);
  console.log(`Evaluación ${args.mode} con fecha ${args.asOf} (America/Guayaquil)`);
  const log = (m) => console.log(`  ${m}`);
  let result;
  try {
    result =
      args.mode === 'monthly'
        ? await runMonthly(db, { asOf: args.asOf, reprocess: args.reprocess, guardReclose: true, log })
        : await runDaily(db, { asOf: args.asOf, log });
  } catch (err) {
    if (err instanceof MonthClosedError) {
      console.error(`Error: ${err.message}`);
      return 3;
    }
    throw err;
  }
  console.log(JSON.stringify({ ...result, errors: result.errors.length }));
  for (const e of result.errors) console.error(`Error: ${e}`);
  return result.errors.length > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`Fallo de la evaluación: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);

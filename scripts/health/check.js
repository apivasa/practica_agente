#!/usr/bin/env node
// V-04 — Comprobación de salud. Uso:
//   node scripts/health/check.js [--only=availability|workflows]
// Variables: EVALUATION_ENABLED, PAGES_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
//   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, DEFAULT_BRANCH.
// Escribe `failures=<check,...>` en $GITHUB_OUTPUT y una tabla en $GITHUB_STEP_SUMMARY.
// Sale con 1 si algún check falla. Nunca imprime claves ni la URL de Supabase.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkAvailability, checkWorkflows, createGitHubClient, failedChecks } from './lib.js';

/**
 * @param {{ argv: string[], env: Record<string,string|undefined>, fetchImpl: typeof fetch,
 *   now?: Date, log?: (s:string)=>void, sleep?: (ms:number)=>Promise<void>, delayMs?: number }} o
 * @returns {Promise<{ code: number, results: import('./lib.js').Result[] }>}
 */
export async function main({ argv, env, fetchImpl, now = new Date(), log = console.log, sleep, delayMs }) {
  const only = argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'all';
  if (!['all', 'availability', 'workflows'].includes(only)) {
    log(`::error::--only inválido: ${only}`);
    return { code: 2, results: [] };
  }
  const results = [];
  if (only !== 'workflows') results.push(...(await checkAvailability({ env, fetchImpl, sleep, delayMs })));
  if (only !== 'availability') {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
      results.push({ check: 'actions-api', status: 'fail', detail: 'faltan GITHUB_TOKEN o GITHUB_REPOSITORY' });
    } else {
      const github = createGitHubClient({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL || undefined, fetchImpl });
      results.push(...(await checkWorkflows({ env, github, now })));
    }
  }
  for (const r of results) {
    // HEALTH_PLAIN_LOG=1 (simulación de caída en CI): sin anotaciones ::error:: en un job que pasa.
    const plain = env.HEALTH_PLAIN_LOG === '1';
    const tag = r.status === 'fail' ? `${plain ? '' : '::error::'}FALLA` : r.status === 'skip' ? `${plain ? '' : '::warning::'}omitido` : 'ok';
    log(`${tag} ${r.check}: ${r.detail}`);
  }
  const failures = failedChecks(results);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `failures=${failures.join(',')}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.check} | ${r.status} | ${r.detail.replace(/\|/g, '/')} |`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, ['| Check | Estado | Detalle |', '|---|---|---|', ...rows, ''].join('\n'));
  }
  log(JSON.stringify({ checks: results.length, failures }));
  return { code: failures.length > 0 ? 1 : 0, results };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main({ argv: process.argv.slice(2), env: process.env, fetchImpl: fetch }).then(
    ({ code }) => process.exit(code),
    (e) => {
      console.error(`::error::salud: ${e?.message ?? e}`);
      process.exit(2);
    },
  );
}

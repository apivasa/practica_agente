#!/usr/bin/env node
// V-04 — Abre o actualiza el issue con la etiqueta `salud`.
// Variables: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, FAILURES (checks separados por coma), RUN_URL.
// El cuerpo solo lleva nombres de check, hora y enlace al run (repositorio público).
import { pathToFileURL } from 'node:url';
import { createGitHubClient, parseFailures, sanitizeLogValue, upsertHealthIssue } from './lib.js';

export async function main({ env, fetchImpl, now = new Date(), log = console.log }) {
  const github = createGitHubClient({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL || undefined, fetchImpl });
  const out = await upsertHealthIssue({ github, failures: parseFailures(env.FAILURES), runUrl: env.RUN_URL, now });
  log(`issue #${sanitizeLogValue(out.number)}: ${out.action === 'created' ? 'creado' : 'comentado'}`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main({ env: process.env, fetchImpl: fetch }).catch((e) => {
    console.error(`::error::issue de salud: ${sanitizeLogValue(e?.message ?? e)}`);
    process.exit(1);
  });
}

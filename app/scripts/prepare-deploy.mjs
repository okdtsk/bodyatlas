import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../dist/bodyatlas/wrangler.json', import.meta.url);
const config = JSON.parse(readFileSync(path, 'utf8'));
// Older Vite plugin output retains this removed field. Its default was true.
if (config.legacy_env === false) throw new Error('Service environments are not supported');
delete config.legacy_env;
if (config.observability?.redact_query_string !== true) {
  throw new Error('Query-string redaction must be enabled before deployment');
}
writeFileSync(path, JSON.stringify(config, null, 2));

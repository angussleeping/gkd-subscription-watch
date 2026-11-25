import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { checkSubscription } from '@gkd-kit/tools';
import { PATHS } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = [PATHS.uniqueRules, PATHS.merged, PATHS.preciseRules];
let failed = false;

for (const file of outputs) {
  try {
    const subscription = JSON5.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    checkSubscription(subscription);
    const groups = subscription.apps.reduce((count, app) => count + (app.groups?.length || 0), 0);
    console.log(`PASS ${file}: ${subscription.apps.length} apps, ${groups} groups`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${file}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;

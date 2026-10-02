// Installs the UI's dependencies (static/app) after the root `npm install`.
//
// This used to be `npm --prefix static/app install`, which on Windows could
// end up re-running the root install inside itself until it failed. Running
// npm from inside the folder, with npm's prefix settings cleared and a guard
// variable, keeps it to exactly one nested install on every platform.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.SPECPAGE_UI_INSTALL) process.exit(0);

const env = { ...process.env, SPECPAGE_UI_INSTALL: '1' };
for (const key of Object.keys(env)) {
  if (/^npm_config_(local_)?prefix$/i.test(key)) delete env[key];
}

const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: fileURLToPath(new URL('../static/app/', import.meta.url)),
  stdio: 'inherit',
  env,
  // npm is npm.cmd on Windows, which needs a shell to run.
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`Couldn't install the UI dependencies: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

// Finds which part of the app makes `forge install` fail.
//
// Atlassian's installer can fail with a bare "An unexpected error occurred"
// (HTTP 500) and no reason. This script narrows it down on your demo site:
//   1. deploys a stripped-down app (every suspect feature removed) and installs it
//   2. adds the features back one at a time, redeploying and upgrading each time
//   3. reports which feature(s) make the install fail
// manifest.yml is always restored afterwards, even if you press Ctrl+C.
//
// Usage:   node scripts/diagnose-install.mjs            (needs a demo site: forge site provision)
//          node scripts/diagnose-install.mjs --dry-run  (show the plan, change nothing)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

const MANIFEST = 'manifest.yml';
const dryRun = process.argv.includes('--dry-run');
const original = readFileSync(MANIFEST, 'utf8');
const base = parse(original);

const macro = (m) => m.modules.macro[0];
// Each suspect knows how to remove itself from a manifest object.
const SUSPECTS = [
  ['Link autoconvert patterns', (m) => delete macro(m).autoConvert],
  ['Admin-approved outside hosts (customer-managed egress)', (m) => delete m.permissions.external],
  ['Paid licensing', (m) => delete m.app.licensing],
  ['Space "API docs" page', (m) => delete m.modules['confluence:spacePage']],
  ['Admin settings page', (m) => delete m.modules['confluence:globalSettings']],
  ['Guest/anonymous access to the macro', (m) => delete macro(m).unlicensedAccess],
  ['PDF/Word export', (m) => delete macro(m).adfExport],
  ['Macro config parameters (attachment + search text)', (m) => delete macro(m).config.parameters],
  ['Function memory settings', (m) => {
    delete m.app.runtime.memoryMB;
    for (const f of m.modules.function) delete f.runtime;
  }],
  ['ARM64 runtime architecture', (m) => delete m.app.runtime.architecture],
];

function manifestWithout(removed) {
  const m = structuredClone(base);
  for (const [name, remove] of SUSPECTS) if (removed.has(name)) remove(m);
  return stringify(m);
}

function forge(args) {
  console.log(`\n$ forge ${args.join(' ')}`);
  if (dryRun) return { ok: true, output: '' };
  const res = spawnSync('forge', args, { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  process.stdout.write(output);
  return { ok: res.status === 0, output };
}

let installed = false;
function deployAndInstall() {
  const deploy = forge(['deploy', '--non-interactive', '-e', 'development']);
  if (!deploy.ok) return { ok: false, deployFailed: true };
  const common = ['--non-interactive', '--demo-site', '--product', 'confluence', '--confirm-scopes', '-e', 'development'];
  let result = forge(['install', ...(installed ? ['--upgrade'] : []), ...common]);
  // A previous run may have left it installed: switch to an upgrade.
  if (!result.ok && !installed && /already installed/i.test(result.output)) {
    result = forge(['install', '--upgrade', ...common]);
  }
  if (result.ok) installed = true;
  return { ok: result.ok };
}

function restore() {
  writeFileSync(MANIFEST, original);
}
process.on('SIGINT', () => {
  restore();
  console.log('\nStopped. manifest.yml restored.');
  process.exit(130);
});

const results = [];
try {
  const removed = new Set(SUSPECTS.map(([name]) => name));
  console.log('Step 1: stripped-down app (all suspects removed)');
  writeFileSync(MANIFEST, manifestWithout(removed));
  const first = deployAndInstall();
  if (first.deployFailed) throw new Error('The stripped-down app failed to deploy; see the output above.');
  if (!first.ok) {
    results.push('Even the stripped-down app fails to install, so the cause is not one of the listed features.');
    results.push('That points at the Atlassian account or app registration. Contact Atlassian support with the request ID above.');
  } else {
    results.push('Stripped-down app: installed OK.');
    for (const [name] of SUSPECTS) {
      console.log(`\nAdding back: ${name}`);
      removed.delete(name);
      writeFileSync(MANIFEST, manifestWithout(removed));
      const attempt = deployAndInstall();
      if (attempt.ok) {
        results.push(`OK      ${name}`);
      } else {
        results.push(`FAILS   ${name}${attempt.deployFailed ? ' (deploy failed)' : ''}`);
        // Leave the culprit out and keep checking the rest.
        removed.add(name);
      }
    }
  }
} catch (err) {
  results.push(`Stopped early: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  restore();
}

const report = ['', '==== Install diagnosis ====', ...results, '', 'manifest.yml has been restored.', ''].join('\n');
console.log(report);
if (!dryRun) writeFileSync('install-diagnosis.txt', report);

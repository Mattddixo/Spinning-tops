#!/usr/bin/env node
// Maintenance check: outdated packages, known vulnerabilities, the Forge
// runtime in manifest.yml, and (with --full) the full test suite. Writes
// maintenance-report.md and prints it.
//
//   npm run maintenance           quick check (a minute or so)
//   npm run maintenance -- --full also runs typecheck, lint, tests and build
//
// Exit code 1 when something needs attention soon: a high or critical
// vulnerability, or a failing check with --full.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const full = process.argv.includes('--full');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function json(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return undefined;
  }
}

const major = (v) => Number(String(v ?? '').replace(/^[^\d]*/, '').split('.')[0]);

// The Node version Forge runs the backend on, e.g. nodejs24.x -> 24.
const manifest = readFileSync(join(root, 'manifest.yml'), 'utf8');
const runtimeName = /runtime:\s*\n\s*name:\s*(\S+)/.exec(manifest)?.[1] ?? 'unknown';
const runtimeMajor = major(runtimeName.replace('nodejs', ''));

const projects = [
  { name: 'backend (root)', dir: root },
  { name: 'UI (static/app)', dir: join(root, 'static/app') },
];

let urgent = false;
const lines = [`# SpecPage maintenance report`, '', `Generated ${new Date().toISOString()}`, '', `Forge runtime in manifest.yml: \`${runtimeName}\``, ''];

for (const project of projects) {
  lines.push(`## ${project.name}`, '');

  // npm outdated exits 1 when anything is outdated; that's not a failure here.
  const outdated = json(run(npm, ['outdated', '--json'], project.dir).stdout);
  if (!outdated) {
    lines.push('- Could not check for outdated packages (is the npm registry reachable?)', '');
  } else {
    const rows = Object.entries(outdated).map(([name, info]) => {
      const current = info.current ?? '(not installed)';
      let note;
      if (name === '@types/node' && major(info.latest) > runtimeMajor) {
        note = `keep on ${runtimeMajor}.x to match the Forge runtime`;
      } else if (major(info.latest) > major(current)) {
        note = 'major version: check the changelog before upgrading';
      } else if (info.wanted !== current) {
        note = 'safe update within the allowed range (npm update)';
      } else {
        note = 'pinned; newer minor/patch available';
      }
      return `| ${name} | ${current} | ${info.wanted ?? ''} | ${info.latest ?? ''} | ${note} |`;
    });
    if (rows.length) lines.push('| Package | Installed | Wanted | Latest | Note |', '| --- | --- | --- | --- | --- |', ...rows, '');
    else lines.push('- All packages up to date', '');
  }

  const audit = json(run(npm, ['audit', '--json'], project.dir).stdout);
  const counts = audit?.metadata?.vulnerabilities;
  if (!counts) {
    lines.push('- Could not run npm audit', '');
  } else {
    const summary = ['critical', 'high', 'moderate', 'low'].map((k) => `${counts[k] ?? 0} ${k}`).join(', ');
    lines.push(`- Vulnerabilities: ${summary}`);
    if ((counts.critical ?? 0) + (counts.high ?? 0) > 0) {
      urgent = true;
      for (const [name, v] of Object.entries(audit.vulnerabilities ?? {})) {
        if (v.severity === 'high' || v.severity === 'critical') {
          lines.push(`  - **${name}** (${v.severity})${v.fixAvailable ? ', fix available: `npm audit fix`' : ', no fix yet'}`);
        }
      }
    }
    lines.push('');
  }
}

lines.push('## Node.js', '');
const nodeMajor = major(process.versions.node);
lines.push(`- This machine: Node ${process.versions.node}${nodeMajor < runtimeMajor ? ` (older than the Forge runtime, Node ${runtimeMajor}; upgrade before deploying)` : ''}`, '');

if (full) {
  lines.push('## Checks', '');
  for (const [label, args] of [
    ['Typecheck', ['run', 'typecheck']],
    ['Lint', ['run', 'lint']],
    ['Unit tests', ['test']],
    ['Build', ['run', 'build']],
  ]) {
    const res = run(npm, args);
    if (res.status !== 0) urgent = true;
    lines.push(`- ${label}: ${res.status === 0 ? 'passed' : 'FAILED'}`);
    if (res.status !== 0) lines.push('', '```', (res.stdout + res.stderr).trim().split('\n').slice(-25).join('\n'), '```', '');
  }
  lines.push('');
}

lines.push(
  '## Not covered by this script',
  '',
  '- Forge platform changes (deprecations, runtime end-of-life, manifest changes): see https://developer.atlassian.com/platform/forge/changelog/',
  '- `forge lint` needs a logged-in Forge CLI: run it before each deploy.',
  '',
);

const report = lines.join('\n');
writeFileSync(join(root, 'maintenance-report.md'), report);
console.log(report);
process.exit(urgent ? 1 : 0);

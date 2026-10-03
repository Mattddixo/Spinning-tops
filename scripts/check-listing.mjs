// Checks docs/marketplace-listing.md against Atlassian's listing field limits.
// Each field sits between <!-- field: name, max N --> and <!-- /field -->.
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../docs/marketplace-listing.md', import.meta.url), 'utf8');
const fields = [...text.matchAll(/<!-- field: ([\w.]+), max (\d+) -->\n([\s\S]*?)\n<!-- \/field -->/g)];
// The app name can't contain these words (Atlassian listing guidelines).
const BANNED_IN_NAME = /\b(atlassian|plugin|beta|add-on|app)\b/i;

let failed = false;
for (const [, name, max, value] of fields) {
  const length = [...value].length;
  const over = length > Number(max);
  const banned = name === 'name' && BANNED_IN_NAME.test(value);
  if (over || banned) failed = true;
  console.log(`${over || banned ? 'FAIL' : 'ok  '} ${name.padEnd(20)} ${String(length).padStart(4)} / ${max}${banned ? '  (uses a word the name can\'t contain)' : ''}`);
}
if (fields.length !== 10) {
  console.log(`Expected 10 fields, found ${fields.length}`);
  failed = true;
}
process.exit(failed ? 1 : 0);

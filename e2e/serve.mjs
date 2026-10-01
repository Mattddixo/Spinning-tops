// Static server for the UI harness build. Sends a strict Content-Security-Policy
// (no inline scripts or styles, no eval, no external hosts) to prove the UI runs
// under Forge's Custom UI defaults without extra `permissions.content` entries.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = new URL('../static/app/dist-harness/', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4173);
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': csp });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`harness on http://localhost:${port}`));

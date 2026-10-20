// Minimal static file server for local play and E2E tests.
// Usage: node tests/server.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function startServer(port = 8123) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';

      const target = normalize(join(ROOT, pathname));
      if (!target.startsWith(ROOT + sep) && target !== ROOT) {
        res.writeHead(403).end('forbidden');
        return;
      }

      const info = await stat(target);
      if (!info.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }

      const body = await readFile(target);
      res.writeHead(200, {
        'content-type': MIME[extname(target)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'content-length': body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || process.env.PORT || 8123);
  await startServer(port);
  console.log(`skyline-runner on http://127.0.0.1:${port}`);
}

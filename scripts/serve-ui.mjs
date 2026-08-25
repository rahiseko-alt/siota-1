/**
 * serve-ui.mjs — dist/ をそのまま配る静的サーバ
 *
 * UI だけを見るための最小の器。**API も認証も無い。**
 * バックエンドを呼ばない UI であることを、サーバ側からも担保する
 * （繋がる先が存在しないので、繋いでいたら即座に壊れて分かる）。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

export function startUiServer(port = 8800) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      base: `http://127.0.0.1:${port}`,
      stop: () => new Promise((done) => server.close(done)),
    }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { base } = await startUiServer(Number(process.env.UI_PORT || 8800));
  process.stdout.write(`${base}\n`);
}

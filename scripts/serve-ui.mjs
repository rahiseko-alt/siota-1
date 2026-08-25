/**
 * serve-ui.mjs — dist/ をそのまま配る静的サーバ
 *
 * UI だけを見るための最小の器。**API も認証も無い。**
 * バックエンドを呼ばない UI であることを、サーバ側からも担保する
 * （繋がる先が存在しないので、繋いでいたら即座に壊れて分かる）。
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    /* 既定は自分のパソコンからだけ（127.0.0.1）。
       スマホの実機で見たいときだけ `UI_HOST=0.0.0.0` を付ける——同じ Wi-Fi の
       他の端末からも見えるようになるので、既定にはしない。 */
    const host = process.env.UI_HOST || '127.0.0.1';
    server.listen(port, host, () => resolve({
      base: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
      host,
      stop: () => new Promise((done) => server.close(done)),
    }));
  });
}

/* Windows では `process.argv[1]` が `C:\...` 形式なので、`file://` を前置しても
   `import.meta.url`（`file:///C:/...`）と一致しない＝直接実行しても何も起きない。
   `pathToFileURL()` は Node 標準で、どの OS でも同じ形にそろえる。 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.UI_PORT || 8800);
  const { base, host } = await startUiServer(port);
  process.stdout.write(`\n  画面を配っています（Ctrl+C で止める）\n\n`);
  process.stdout.write(`    このパソコンで見る : ${base}\n`);
  if (host === '0.0.0.0') {
    const nets = Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal);
    for (const n of nets) {
      process.stdout.write(`    スマホで見る       : http://${n.address}:${port}  （同じ Wi-Fi から）\n`);
    }
  } else {
    process.stdout.write(`    スマホでも見るなら : UI_HOST=0.0.0.0 を付けて起動し直す\n`);
  }
  process.stdout.write('\n');
}

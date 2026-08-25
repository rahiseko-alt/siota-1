/**
 * build-dist.mjs — src/ を dist/ へそのまま写す
 *
 * いまは **UI だけを仮データで完成させる段** なので、やることは複写だけ。
 * バンドルも置換もしない——バックエンドを一切呼ばない UI に、変換する理由が無い。
 * 実データへ繋ぐ段（第3段）で必要になったら、そのとき足す。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** src からの相対パスで、dist に置くもの。ここに無いものは配信されない。 */
const ENTRIES = ['index.html', 'manifest.json', 'js', 'assets'];

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    let n = 0;
    for (const name of fs.readdirSync(from)) n += copy(path.join(from, name), path.join(to, name));
    return n;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return 1;
}

fs.rmSync(DIST, { recursive: true, force: true });

let total = 0;
for (const entry of ENTRIES) {
  const from = path.join(SRC, entry);
  if (!fs.existsSync(from)) {
    console.error(`[build] ${entry} が src/ に無い`);
    process.exit(1);
  }
  const n = copy(from, path.join(DIST, entry));
  total += n;
  console.log(`[build] ${entry}  ${n}件`);
}

/* 自己点検: 画面が1枚も無い dist を「成功」と言わない。 */
const html = path.join(DIST, 'index.html');
if (!fs.existsSync(html) || fs.statSync(html).size < 1000) {
  console.error('[build] self-check NG: dist/index.html が無いか小さすぎる');
  process.exit(1);
}

console.log(`[build] 完了  ${total}件`);

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
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** src からの相対パスで、dist に置くもの。ここに無いものは配信されない。 */
/* 入口は3つ: index.html（トリマー）/ my.html（飼い主）/ admin.html（管理者）。 */
const ENTRIES = ['index.html', 'my.html', 'admin.html', 'manifest.json', 'js', 'assets'];

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
/* ──────────────────────────────────────────────
   backend/js を配る（飼い主のマイページ `my.html` が読む）

   `6685df5`「古いUIをはがし…」が、UI と一緒に**この生成手順ごと**消していた。
   `esbuild` が devDependency に宣言されたまま `scripts/` から未使用だったのは、
   そのため（`docs/ops/bad-scenarios-F3.md` #7）。`6685df5^:scripts/build-dist.mjs`
   から戻したもので、置き場所だけ `src/js/` → `backend/js/` に読み替えている。

   `supabase-vendor.js` は `@supabase/supabase-js` と `qrcode` を1つにまとめた塊。
   `iife` + `globalName` で **`globalThis.TrimmerSupabaseVendor` に載る**——
   古典スクリプトで読み込めるのはそのため（`#10` の橋と同じ仕組み）。
   ────────────────────────────────────────────── */
const BACKEND = path.join(ROOT, 'backend', 'js');
const VENDOR_ENTRY_FILE = 'supabase-vendor-entry.mjs';

if (fs.existsSync(path.join(SRC, 'my.html'))) {
  if (!fs.existsSync(BACKEND)) {
    console.error(`[build] backend/js/ が見つかりません: ${BACKEND}`);
    process.exit(1);
  }
  const destDir = path.join(DIST, 'backend', 'js');
  fs.mkdirSync(destDir, { recursive: true });

  let copied = 0;
  for (const name of fs.readdirSync(BACKEND)) {
    if (!name.endsWith('.js') || name === VENDOR_ENTRY_FILE) continue;
    fs.copyFileSync(path.join(BACKEND, name), path.join(destDir, name));
    copied += 1;
  }
  console.log(`[build] backend/js  ${copied}件`);

  const vendorEntry = path.join(BACKEND, VENDOR_ENTRY_FILE);
  const vendorDest = path.join(destDir, 'supabase-vendor.js');
  if (!fs.existsSync(vendorEntry)) {
    console.error(`[build] Supabase vendor entry が見つかりません: ${vendorEntry}`);
    process.exit(1);
  }
  buildSync({
    entryPoints: [vendorEntry],
    outfile: vendorDest,
    bundle: true,
    format: 'iife',
    globalName: 'TrimmerSupabaseVendor',
    platform: 'browser',
    minify: true,
    sourcemap: false,
    logLevel: 'silent',
  });
  /* 生成できたことを、その場で確かめる。無いまま「完了」と言わない。 */
  if (!fs.existsSync(vendorDest)) {
    console.error('[build] self-check NG: dist/backend/js/supabase-vendor.js が無い');
    process.exit(1);
  }
  console.log('[build] backend/js  supabase-vendor.js（bundle）');
}

const html = path.join(DIST, 'index.html');
if (!fs.existsSync(html) || fs.statSync(html).size < 1000) {
  console.error('[build] self-check NG: dist/index.html が無いか小さすぎる');
  process.exit(1);
}

console.log(`[build] 完了  ${total}件`);

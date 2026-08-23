/**
 * src → dist ビルドスクリプト
 * 手動コピー禁止。`npm run build` または `node scripts/build-dist.mjs` で実行。
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { buildSync } from 'esbuild';

// スクリプト自身のディレクトリから product root を解決
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SRC  = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// ──────────────────────────────────────────────
// ディレクトリ準備（clean wipe はしない・上書きのみ）
// ──────────────────────────────────────────────
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'js'),     { recursive: true });

// ──────────────────────────────────────────────
// 1. HTML: ../assets/ → /assets/、../js/ → /js/ の文字列置換
// ──────────────────────────────────────────────
const htmlSrc  = path.join(SRC, 'design-samples', 'ponchi-v2.html');
const htmlDest = path.join(DIST, 'ponchi-v2.html');

if (!fs.existsSync(htmlSrc)) {
  console.error(`[build] HTML が見つかりません: ${htmlSrc}`);
  process.exit(1);
}

const htmlContent = fs.readFileSync(htmlSrc, 'utf8')
  .replaceAll('../assets/', '/assets/')
  /* dist では design-samples/*.html がルート直下に置かれるので、../manifest.json は
     ルートの外を指してしまう。PWA が結線されていなかった原因のひとつ（F-08）。 */
  .replaceAll('../manifest.json', '/manifest.json')
  .replaceAll('../js/',      '/js/');

fs.writeFileSync(htmlDest, htmlContent, 'utf8');
console.log(`[build] HTML 置換完了: ponchi-v2.html`);

// ──────────────────────────────────────────────
// 1b. ログイン(index.html) / 顧客(my.html) を dist 直下へ配置
// search.html は F2 で撤去した（動線に無い層だったため）。
// ──────────────────────────────────────────────
const indexSrc  = path.join(SRC, 'index.html');
const indexDest = path.join(DIST, 'index.html');
if (!fs.existsSync(indexSrc)) {
  console.error(`[build] index.html が見つかりません: ${indexSrc}`);
  process.exit(1);
}
fs.copyFileSync(indexSrc, indexDest);
console.log(`[build] HTML コピー: index.html`);

const mySrc = path.join(SRC, 'my.html');
const myDest = path.join(DIST, 'my.html');
if (!fs.existsSync(mySrc)) {
  console.error(`[build] my.html が見つかりません: ${mySrc}`);
  process.exit(1);
}
fs.copyFileSync(mySrc, myDest);
console.log('[build] HTML コピー: my.html');

// ──────────────────────────────────────────────
// 2. JS: src/js/*.js を自動列挙して無変換コピー
// ──────────────────────────────────────────────
const jsSrcDir = path.join(SRC, 'js');
if (!fs.existsSync(jsSrcDir)) {
  console.error(`[build] src/js/ が見つかりません: ${jsSrcDir}`);
  process.exit(1);
}
const vendorEntryFile = 'supabase-vendor-entry.mjs';
const jsFiles = fs.readdirSync(jsSrcDir)
  .filter(f => f.endsWith('.js') && f !== vendorEntryFile);

for (const jsFile of jsFiles) {
  const jsSrc  = path.join(SRC, 'js', jsFile);
  const jsDest = path.join(DIST, 'js', jsFile);
  fs.copyFileSync(jsSrc, jsDest);
  console.log(`[build] JS コピー: js/${jsFile}`);
}

const vendorEntry = path.join(jsSrcDir, vendorEntryFile);
const vendorDest = path.join(DIST, 'js', 'supabase-vendor.js');
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
if (!fs.existsSync(vendorDest)) {
  console.error('[build] self-check NG: dist/js/supabase-vendor.js が無い');
  process.exit(1);
}
console.log('[build] JS bundle: js/supabase-vendor.js');

// ──────────────────────────────────────────────
// 3. assets: src/assets/ を自動列挙して無変換コピー
// ──────────────────────────────────────────────
const srcAssetsDir = path.join(SRC, 'assets');

/* 再帰で拾う。同梱フォントが assets/fonts/ 配下にあり、直下だけを列挙していた頃の
   実装では dist に入らなかった。1件でも落ちると本番で読めないので、
   ディレクトリを掘って全部コピーする。 */
function listAssets(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listAssets(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const assetFiles = listAssets(srcAssetsDir);

/* 同梱フォントは 18 件ある。1件ずつ出すとログが埋まるので、まとめて1行にする。 */
let assetCount = 0;
let fontCount = 0;
for (const assetFile of assetFiles) {
  const assetSrc  = path.join(SRC, 'assets', assetFile);
  const assetDest = path.join(DIST, 'assets', assetFile);
  fs.mkdirSync(path.dirname(assetDest), { recursive: true });
  fs.copyFileSync(assetSrc, assetDest);
  assetCount++;
  if (assetFile.startsWith('fonts/')) { fontCount++; continue; }
  console.log(`[build] asset コピー: assets/${assetFile}`);
}
if (fontCount) console.log(`[build] asset コピー: assets/fonts/ (${fontCount} 件)`);

// ──────────────────────────────────────────────
// 4. manifest: 無変換コピー
// ──────────────────────────────────────────────
const manifestSrc  = path.join(SRC, 'manifest.json');
const manifestDest = path.join(DIST, 'manifest.json');

if (!fs.existsSync(manifestSrc)) {
  console.error(`[build] manifest が見つかりません: ${manifestSrc}`);
  process.exit(1);
}
fs.copyFileSync(manifestSrc, manifestDest);
console.log(`[build] manifest コピー: manifest.json`);

// ──────────────────────────────────────────────
// 5. 末尾 self-check: dist/ponchi-v2.html の相対パス残存検証
// ──────────────────────────────────────────────
const distHtml = fs.readFileSync(htmlDest, 'utf8');

const relativeAssetsCount = (distHtml.match(/\.\.\/assets\//g) || []).length;
const relativeJsCount     = (distHtml.match(/\.\.\/js\//g)     || []).length;

if (relativeAssetsCount > 0 || relativeJsCount > 0) {
  console.error(
    `[build] relative path残存: ../assets/ ${relativeAssetsCount}件, ../js/ ${relativeJsCount}件`
  );
  process.exit(1);
}

const absAssetsCount = (distHtml.match(/\/assets\//g) || []).length;
const absJsCount     = (distHtml.match(/\/js\//g)     || []).length;

if (absAssetsCount < 1) {
  console.error(`[build] self-check NG: /assets/ が dist/ponchi-v2.html に 0 件`);
  process.exit(1);
}
if (absJsCount < 1) {
  console.error(`[build] self-check NG: /js/ が dist/ponchi-v2.html に 0 件`);
  process.exit(1);
}

// ──────────────────────────────────────────────
// 6. HTML completeness guard
// ──────────────────────────────────────────────
{
  const rootHtmlFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.html'));
  const handledRootHtml = new Set(['index.html', 'my.html']);
  const unhandledRoot = rootHtmlFiles.filter(f => !handledRootHtml.has(f));
  if (unhandledRoot.length > 0) {
    console.error(`[build] ⚠ 未処理 src/*.html: ${unhandledRoot.join(', ')}`);
    process.exit(1);
  }

  const designSamplesDir = path.join(SRC, 'design-samples');
  const designHtmlFiles = fs.readdirSync(designSamplesDir).filter(f => f.endsWith('.html'));
  const handledDesign = new Set(['ponchi-v2.html']);
  const unhandledDesign = designHtmlFiles.filter(f => !handledDesign.has(f));
  if (unhandledDesign.length > 0) {
    console.error(`[build] ⚠ 未処理 src/design-samples/*.html: ${unhandledDesign.join(', ')}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// 完了報告
// ──────────────────────────────────────────────
const totalFiles = 4 + jsFiles.length + 1 + assetCount + 1;
console.log('');
console.log('='.repeat(60));
console.log(`[build] 完了`);
console.log(`  コピーしたファイル数 : ${totalFiles} 件`);
console.log(`  assets コピー数      : ${assetCount} 件`);
console.log(`  HTML 置換            : ../assets/ → /assets/ (${absAssetsCount}箇所), ../js/ → /js/ (${absJsCount}箇所)`);
console.log(`  relative path 残存   : 0 件 ✓`);
console.log('='.repeat(60));

process.exit(0);

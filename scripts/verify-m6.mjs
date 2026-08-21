/**
 * verify-m6.mjs — 移設 plan (docs/ops/plans/2026-08-21-migration.md) M6「動作証明」の自動実行
 *
 * 使い方:
 *   端末1: npm run preview            # wrangler dev (KV local) を 8787 で起動
 *   端末2: npm run verify:m6
 *
 * ブラウザ:
 *   既定は playwright が管理する chromium。別の実体を使う場合は
 *   M6_CHROMIUM=/path/to/chrome を渡す。
 *
 * EXIT 0 = 9項目すべて合格 / EXIT 1 = 1つでも落ちた
 *
 * 検証するもの（plan「動作の受入基準」と 1:1）:
 *   1 ログイン画面が出る
 *   2 検索画面に一覧が出る
 *   3 飼い主・犬の新規登録が 200
 *   4 肉球画面に中央パッド1 + 指4
 *   5 犬体図に Konva で描ける（ペン / 色変更 / undo）
 *   6 写真を1枚アップロードすると img[data-photo] に反映される
 *   7 カルテ保存で POST /api/reports が 200
 *   8 公開 URL /p/{slug} に保存内容が閲覧モードで再現される
 *   9 コンソールエラーが出ない
 *
 * 9 について: 外部ホスト（fonts.googleapis.com / images.unsplash.com）への接続失敗は
 * アプリの不具合ではなく実行環境の egress 制限なので、集計から分けて報告する。
 * それ以外（アプリ自身が出した 4xx / 例外）は 1 件でも失格とする。
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.M6_BASE || 'http://localhost:8787';
const EXTERNAL = /fonts\.googleapis\.com|fonts\.gstatic\.com|images\.unsplash\.com/;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}\n`);
}

async function api(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── 3. 飼い主と犬の新規登録（ブラウザを開く前に済ませる。以降の導線がこれを使う）──
const stamp = Date.now().toString(36).slice(-5);
const owner = await api('/api/owners', { ownerName: `M6検証 ${stamp}` });
const pet = await api('/api/customers', { petName: `検証犬${stamp}`, ownerSlug: owner.body.ownerSlug });
record('3 register owner + pet',
  owner.status === 200 && !!owner.body.ownerSlug && pet.status === 200 && !!pet.body.slug,
  `POST /api/owners ${owner.status} / POST /api/customers ${pet.status}`);

const OWNER_SLUG = owner.body.ownerSlug;
const PET_SLUG = pet.body.slug;

const launchOpts = process.env.M6_CHROMIUM ? { executablePath: process.env.M6_CHROMIUM } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
const posts = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location()?.url || '' }); });
page.on('pageerror', (e) => consoleErrors.push({ text: 'pageerror: ' + e.message, url: '' }));
page.on('requestfailed', (r) => consoleErrors.push({ text: `requestfailed ${r.failure()?.errorText}`, url: r.url() }));
page.on('response', (r) => {
  if (r.status() >= 400) consoleErrors.push({ text: `HTTP ${r.status()}`, url: r.url() });
  if (r.request().method() === 'POST' && r.url().includes('/api/')) posts.push({ status: r.status(), url: r.url() });
});
page.on('dialog', (d) => d.accept());

// ── 1. ログイン画面 ──
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
record('1 login screen', (await page.locator('[data-entry-login]').count()) === 1, await page.title());

// ── 2. 検索画面 ──
await page.goto(BASE + '/search', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const rows = await page.locator('.boxbutton').count();
record('2 search screen', rows > 0, `${rows} entries`);

// ── 4. 肉球画面 ──
await page.goto(`${BASE}/edit/o/${OWNER_SLUG}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('button.owner-pet-item').first().click();
await page.waitForTimeout(2500);
const paw = await page.evaluate(() => ({
  visible: document.getElementById('screen-paw')?.offsetParent !== null,
  pad: document.querySelectorAll('#screen-paw .pad').length,
  toes: document.querySelectorAll('#screen-paw .toe').length,
}));
record('4 paw screen', paw.visible && paw.pad === 1 && paw.toes === 4,
  `pad=${paw.pad} toes=${paw.toes}`);

await page.locator('#screen-paw .pad').first().click();
await page.waitForTimeout(2500);
const onReport = await page.evaluate(() => document.getElementById('screen-report')?.offsetParent !== null);
if (!onReport) {
  record('   report screen', false, 'カルテ画面に到達できなかったので以降は実行しない');
  await finish();
}

// ── 5. Konva 描画（ペン / 色変更 / undo）──
await page.evaluate(() => {
  const sec = document.getElementById('bm-section');
  const det = sec?.closest('details');
  if (det) det.open = true;
  sec?.scrollIntoView();
});
await page.waitForTimeout(600);
await page.locator('#bm-canvas-wrap').click();
await page.waitForTimeout(1200);

const konva = await page.evaluate(() => ({
  loaded: typeof window.Konva === 'object',
  drawing: document.getElementById('bm-section')?.classList.contains('is-drawing'),
}));
// Konva の layer に載っている node 数を数える。exportImage の画素比較より壊れにくい。
const shapeCount = () => page.evaluate(() => {
  const stage = window.Konva?.stages?.find((s) => s.container()?.id === 'bm-konva');
  return stage ? stage.getLayers()[0].getChildren().length : -1;
});

const box = await page.locator('#bm-konva').boundingBox();
async function stroke(offsetY) {
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4 + offsetY);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(box.x + box.width * (0.35 + i * 0.04), box.y + box.height * 0.4 + offsetY + i * 3);
  }
  await page.mouse.up();
  await page.waitForTimeout(350);
}

const before = await shapeCount();
await stroke(0);
const afterPen = await shapeCount();
await page.locator('#bm-toolbar .bm-color-swatch[data-color="#4a90e2"]').click();
await page.waitForTimeout(250);
const active = await page.evaluate(() => document.querySelector('#bm-toolbar .bm-color-swatch.active')?.dataset.color);
await stroke(40);
const afterColour = await shapeCount();
await page.locator('#bm-toolbar .bm-tool-btn[data-tool="undo"]').click();
await page.waitForTimeout(400);
const afterUndo = await shapeCount();

record('5 Konva pen', konva.loaded && konva.drawing && afterPen > before, `shapes ${before} -> ${afterPen}`);
record('5 Konva colour', active === '#4a90e2' && afterColour > afterPen, `active=${active} shapes ${afterPen} -> ${afterColour}`);
record('5 Konva undo', afterUndo === afterColour - 1, `shapes ${afterColour} -> ${afterUndo}`);

await page.locator('#bm-done-btn').click();
await page.waitForTimeout(800);

// ── 6. 写真アップロード ──
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAI0lEQVQoU2NkYGD4z0AEYBxVSFJ4jCo'
  + 'kKTxGFZIUHqMKSQoPAGa2Awtc4h1sAAAAAElFTkSuQmCC', 'base64');
const pngPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm6-')), 'probe.png');
fs.writeFileSync(pngPath, png);

// 耳の写真枠は <details> の中に畳まれている。開かないと click が届かない。
await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('img[data-photo="ear"]')?.scrollIntoView());
await page.waitForTimeout(400);
await page.locator('img[data-photo="ear"]').click();
await page.waitForTimeout(400);
await page.locator('input[type=file]').first().setInputFiles(pngPath);
await page.waitForTimeout(1500);
const photo = await page.evaluate(() => {
  const img = document.querySelector('img[data-photo="ear"]');
  return { isData: (img?.src || '').startsWith('data:image'), empty: img?.getAttribute('data-empty') };
});
record('6 photo upload', photo.isData && photo.empty === null, `data-empty=${photo.empty}`);

// ── 7. 保存（確定 → プレビューを確認 → 確定（公開）の3手）──
posts.length = 0;
await page.evaluate(() => document.getElementById('ponchi-commit-ok')?.scrollIntoView());
await page.waitForTimeout(300);
await page.locator('#ponchi-commit-ok').click();
await page.waitForTimeout(2000);
await page.locator('.ponchi-btn-pub').first().click();
await page.waitForTimeout(3000);
await page.locator('.ponchi-btn-pub').first().click();
await page.waitForTimeout(9000);
const reportPost = posts.find((p) => p.url.includes('/api/reports'));
record('7 save POST /api/reports', reportPost?.status === 200,
  reportPost ? `${reportPost.status}` : `POST が飛んでいない (${JSON.stringify(posts)})`);

// ── 8. 公開ページ ──
await page.goto(`${BASE}/p/${PET_SLUG}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.locator('#screen-paw .pad').first().click();
await page.waitForTimeout(4000);
const pub = await page.evaluate(() => ({
  onReport: document.getElementById('screen-report')?.offsetParent !== null,
  readonly: document.body.classList.contains('is-readonly'),
  editable: document.querySelectorAll('[contenteditable="true"]').length,
  // アップロードした写真が戻っているか
  photoBack: (document.querySelector('img[data-photo="ear"]')?.src || '').startsWith('data:image'),
  // 描いた線が静止画として戻っているか（閲覧側は Konva ではなく書き出し画像）
  drawingBack: (document.querySelector('#bm-canvas-wrap .bm-single')?.src || '').startsWith('data:image'),
}));
record('8 public /p/{slug}',
  pub.onReport && pub.readonly && pub.editable === 0 && pub.photoBack && pub.drawingBack,
  `readonly=${pub.readonly} editable=${pub.editable} photo=${pub.photoBack} drawing=${pub.drawingBack}`);

await finish();

async function finish() {
  const seen = new Set();
  const unique = consoleErrors.filter((e) => {
    const k = e.text + '|' + e.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const external = unique.filter((e) => EXTERNAL.test(e.url));
  const internal = unique.filter((e) => !EXTERNAL.test(e.url));

  record('9 no console errors', internal.length === 0,
    `internal=${internal.length} external(egress-blocked)=${external.length}`);

  if (internal.length) {
    process.stdout.write('\n--- アプリ由来のエラー ---\n');
    internal.forEach((e) => process.stdout.write(`  ${e.text}  ${e.url}\n`));
  }
  if (external.length) {
    process.stdout.write('\n--- 外部ホスト（実行環境の egress 制限。アプリの不具合ではない）---\n');
    external.forEach((e) => process.stdout.write(`  ${e.text}  ${e.url}\n`));
  }

  const failed = results.filter((r) => !r.pass);
  process.stdout.write(`\n===== M6: ${results.length - failed.length}/${results.length} =====\n`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}

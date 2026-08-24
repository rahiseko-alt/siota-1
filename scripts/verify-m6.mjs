/**
 * verify-m6.mjs — 動作の受入基準を一気通貫で確かめる（Supabaseモード）
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:m6
 *
 * マスター指定の動線（①URLを開く→②ログイン→③犬を選ぶ→④カルテ作成→⑤確認→⑥顧客ページ）
 * に沿って、KV版 M6 が確かめていた「画面が出る・操作できる」を Supabase 版へ引き継ぐ。
 * データが実際に同じ値で届くかは verify:roundtrip、危険なデータが実行されないかは
 * verify:xss、空状態は verify:empty が別に担当する。ここは導線とインタラクションが
 * 生きているかの検査。
 *
 * EXIT 0 = 全項目合格 / EXIT 1 = 1つでも落ちた
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalWorker, passwordLogin, injectSession, openStaffPage, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8787) });
let browser;
try {
  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors = [];
  const posts = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location()?.url || '' }); });
  page.on('pageerror', (e) => consoleErrors.push({ text: 'pageerror: ' + e.message, url: '' }));
  page.on('requestfailed', (r) => {
    // ERR_ABORTED は「ページ遷移でブラウザが読み込み中のリソースを打ち切った」だけの
    // 正常系で、アプリの不具合ではない（フォント/画像の先読みがページ遷移と競合する等）。
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    consoleErrors.push({ text: `requestfailed ${r.failure()?.errorText}`, url: r.url() });
  });
  page.on('response', (r) => {
    if (r.status() >= 400) consoleErrors.push({ text: `HTTP ${r.status()}`, url: r.url() });
    if (r.request().method() === 'POST' && r.url().includes('/api/')) posts.push({ status: r.status(), url: r.url() });
  });
  page.on('dialog', (d) => d.accept());

  // ── ① URLを開く／② ログイン画面 ──
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  record('1 ログイン導線が出る（①②）', (await page.locator('[data-entry-login]').count()) === 1, await page.title());

  // ── ② ログイン（テスト専用の password grant で自動化）── ③ 犬を選ぶ画面 ──
  await openStaffPage(page, BASE, '/edit', FIXTURE.staffEmail);
  await page.waitForSelector('.owner-pet-item, .owner-error', { timeout: 15000 });
  const petRows = await page.locator('.owner-pet-item').count();
  record('2 ログイン後に犬の一覧が直接出る（③・飼い主選択層が無い）', petRows > 0, `${petRows} rows`);

  // ── 新規の飼い主・犬の登録（画面のインライン新規作成フォーム）──
  const stamp = Date.now().toString(36).slice(-5);
  const PET_NAME = `M6検証${stamp}`;
  posts.length = 0;
  await page.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=0', PET_NAME);
  await page.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=1', `M6飼い主${stamp}`);
  await Promise.all([
    page.waitForURL(/\/edit\/p\//, { timeout: 10000 }),
    page.click('.ponchi-new-karte-form .ponchi-add-btn'),
  ]);
  const registerOk = posts.some((p) => p.url.includes('/api/owners') && p.status === 201)
    && posts.some((p) => p.url.includes('/pets') && p.status === 201);
  record('3 飼い主・犬の新規登録（画面から）', registerOk, JSON.stringify(posts));

  // ── ④ カルテ作成画面 ──
  await page.waitForSelector('.archive-new-btn', { timeout: 15000 });
  await page.click('.archive-new-btn');
  await page.waitForSelector('#heroDateInput', { timeout: 15000 });
  const onReport = await page.evaluate(() => document.getElementById('screen-report')?.style.display !== 'none');
  record('4 カルテ作成画面に到達する（④）', onReport);
  if (!onReport) throw new Error('report screen unreachable');

  // ── 5. Konva 描画（ペン / 色変更 / undo）──
  await page.evaluate(() => {
    document.querySelectorAll('#screen-report details').forEach((d) => { d.open = true; });
    document.getElementById('bm-section')?.scrollIntoView();
  });
  await page.waitForTimeout(400);
  await page.locator('#bm-canvas-wrap').click();
  await page.waitForTimeout(800);

  const konva = await page.evaluate(() => ({
    loaded: typeof window.Konva === 'object',
    drawing: document.getElementById('bm-section')?.classList.contains('is-drawing'),
  }));
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
    await page.waitForTimeout(250);
  }
  const before = await shapeCount();
  await stroke(0);
  const afterPen = await shapeCount();
  await page.locator('#bm-toolbar .bm-color-swatch[data-color="#4a90e2"]').click();
  await page.waitForTimeout(200);
  const active = await page.evaluate(() => document.querySelector('#bm-toolbar .bm-color-swatch.active')?.dataset.color);
  await stroke(40);
  const afterColour = await shapeCount();
  await page.locator('#bm-toolbar .bm-tool-btn[data-tool="undo"]').click();
  await page.waitForTimeout(300);
  const afterUndo = await shapeCount();
  record('5 犬体図にKonvaで描ける（ペン）', konva.loaded && konva.drawing && afterPen > before, `shapes ${before}->${afterPen}`);
  record('5 犬体図にKonvaで描ける（色変更）', active === '#4a90e2' && afterColour > afterPen, `active=${active}`);
  record('5 犬体図にKonvaで描ける（undo）', afterUndo === afterColour - 1, `shapes ${afterColour}->${afterUndo}`);
  await page.locator('#bm-done-btn').click();
  await page.waitForTimeout(500);

  // ── 6. 写真アップロード ──
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAI0lEQVQoU2NkYGD4z0AEYBxVSFJ4jCo'
    + 'kKTxGFZIUHqMKSQoPAGa2Awtc4h1sAAAAAElFTkSuQmCC', 'base64');
  const pngPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm6-')), 'probe.png');
  fs.writeFileSync(pngPath, png);
  await page.evaluate(() => document.querySelector('img[data-photo="ear"]')?.scrollIntoView());
  await page.waitForTimeout(300);
  await page.locator('img[data-photo="ear"]').click();
  await page.waitForTimeout(300);
  await page.locator('input[type=file]').first().setInputFiles(pngPath);
  await page.waitForTimeout(1000);
  const photo = await page.evaluate(() => {
    const img = document.querySelector('img[data-photo="ear"]');
    return { isData: (img?.src || '').startsWith('data:image'), empty: img?.getAttribute('data-empty') };
  });
  record('6 写真アップロードが反映される', photo.isData && photo.empty === null, `data-empty=${photo.empty}`);

  // ── 6a. 大きい写真は取り込む時点で縮む（D-20260824-30 の 4）──
  /* iPhone の原寸をそのまま持つと1カルテ十数MBになり、削除しても Storage からは
     減らないので積み上がる。ここでは 3000x2000 を入れて、長辺 1600px 以下に
     収まること・元より小さくなることを見る。小さい画像は拡大しないことも見る
     （8x8 の PNG が引き伸ばされて汚れるのは、直すつもりの無い副作用）。 */
  const bigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm6-big-')), 'big.png');
  fs.writeFileSync(bigPath, png);   /* 実体は後で差し替える（下の evaluate で生成） */
  const bigDataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const ctx = c.getContext('2d');
    /* のっぺりした画像は JPEG で潰れすぎるので、ノイズを入れて実写に近づける。 */
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) % 255; img.data[i + 1] = (i * 13) % 255;
      img.data[i + 2] = (i * 29) % 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(bigPath, Buffer.from(bigDataUrl.split(',')[1], 'base64'));
  await page.evaluate(() => document.querySelector('img[data-photo="teeth-real"]')?.scrollIntoView());
  await page.waitForTimeout(300);
  await page.locator('img[data-photo="teeth-real"]').click();
  await page.waitForTimeout(300);
  await page.locator('input[type=file]').first().setInputFiles(bigPath);
  await page.waitForFunction(
    () => document.querySelector('img[data-photo="teeth-real"]')?.getAttribute('data-empty') === null,
    { timeout: 20000 },
  ).catch(() => {});
  const shrunk = await page.evaluate(async () => {
    const el = document.querySelector('img[data-photo="teeth-real"]');
    const src = el?.getAttribute('src') || '';
    const probe = new Image();
    await new Promise((resolve) => { probe.onload = resolve; probe.onerror = resolve; probe.src = src; });
    return { w: probe.naturalWidth, h: probe.naturalHeight, len: src.length };
  });
  record('6a 大きい写真は取り込む時点で縮む',
    shrunk.w > 0 && Math.max(shrunk.w, shrunk.h) <= 1600 && shrunk.len < bigDataUrl.length,
    `${shrunk.w}x${shrunk.h} / ${(bigDataUrl.length / 1024 / 1024).toFixed(1)}MB→${(shrunk.len / 1024).toFixed(0)}KB`);
  const small = await page.evaluate(async () => {
    const el = document.querySelector('img[data-photo="ear"]');
    const probe = new Image();
    await new Promise((resolve) => { probe.onload = resolve; probe.onerror = resolve; probe.src = el?.getAttribute('src') || ''; });
    return { w: probe.naturalWidth, h: probe.naturalHeight };
  });
  record('6a 小さい写真は引き伸ばさない', small.w === 8 && small.h === 8, `${small.w}x${small.h}`);

  // ── 6b. 体重の新規登録（旧 test/e2e/e2e-ponchi.spec.cjs E2E-4 の引き継ぎ）──
  await page.evaluate(() => document.getElementById('weightCard')?.scrollIntoView());
  const wcOpen = await page.evaluate(() => document.getElementById('weightCard')?.open);
  if (!wcOpen) await page.locator('#weightCard summary').click();
  await page.click('#wcNew');
  await page.waitForSelector('#wcInputRow', { timeout: 5000 });
  await page.fill('#wcKg', '3.5');
  const wcCountBefore = await page.locator('#wcList').evaluate((el) => el.children.length);
  await page.click('#wcAdd');
  await page.waitForTimeout(500);
  const wcCountAfter = await page.locator('#wcList').evaluate((el) => el.children.length);
  record('6b 体重を新規登録できる', wcCountAfter > wcCountBefore, `wcList件数 ${wcCountBefore}->${wcCountAfter}`);

  // ── 6c. 使用オプションのトグル（旧 test/e2e/e2e-ponchi.spec.cjs E2E-4 の引き継ぎ）──
  const firstOpt = page.locator('.opt').first();
  await firstOpt.scrollIntoViewIfNeeded();
  const optOnBefore = await firstOpt.evaluate((el) => el.classList.contains('on'));
  await firstOpt.click();
  const optOnAfter = await firstOpt.evaluate((el) => el.classList.contains('on'));
  record('6c 使用オプションのオン/オフが切り替わる', optOnAfter === !optOnBefore, `on: ${optOnBefore}->${optOnAfter}`);

  // ── 7. 保存（確定 → プレビューを確認 → 確定（公開））──
  await page.evaluate(() => document.getElementById('ponchi-commit-ok')?.scrollIntoView());
  await page.click('#ponchi-commit-ok');
  await page.waitForSelector('.ponchi-btn-pub', { timeout: 10000 });
  await page.click('.ponchi-btn-pub');
  await page.waitForSelector('#screen-magazine .magazine-container', { timeout: 15000 });
  record('7a 確認画面（マガジン意匠・F4）に到達する（⑤）', true);
  await page.click('#screen-magazine .ponchi-btn-pub');
  await page.waitForSelector('.ponchi-publish-notice', { timeout: 30000 });
  const reportPost = posts.find((p) => p.url.includes('/reports') && (p.status === 201 || p.status === 200));
  record('7b 保存POSTが成功する', !!reportPost, reportPost ? `${reportPost.status}` : JSON.stringify(posts));

  // ── 8. 公開ページ（⑥・別ブラウザコンテキストで飼い主として）──
  const pubHref = await page.evaluate(() => document.querySelector('.ponchi-pub-link')?.getAttribute('href') || '');
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}${pubHref}`);
  // このパブリックURLは今作った孤児オーナーの犬なので、飼い主として直接は見られない。
  // 導線の生死だけ見る: ログイン画面に正しく落ちること。roundtrip の方で fixture の
  // owner-a による実閲覧を別途確認済み。
  await ownerPage.waitForTimeout(1500);
  const deepLinkState = await ownerPage.evaluate(() => ({
    loginVisible: !document.querySelector('[data-login-panel]')?.hidden,
    path: location.pathname,
  }));
  record('8 公開URLで飼い主ログイン導線に落ちる（⑥）', deepLinkState.loginVisible, `path=${deepLinkState.path}`);
  await ownerContext.close();

  // ── 9. コンソールエラー ──
  const seen = new Set();
  const unique = consoleErrors.filter((e) => {
    const k = e.text + '|' + e.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  record('9 アプリ由来のコンソールエラーが無い', unique.length === 0, `${unique.length}件`);
  if (unique.length) {
    process.stdout.write('\n--- エラー ---\n');
    unique.forEach((e) => process.stdout.write(`  ${e.text}  ${e.url}\n`));
  }
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== M6: ${results.length - failed.length}/${results.length} =====\n`);
process.exit(failed.length ? 1 : 0);

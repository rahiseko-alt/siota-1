/**
 * verify-portal.mjs — 飼い主のマイページ `/my` が実際に起動するか
 *
 * 使い方:
 *   npm run verify:portal
 *   ブラウザを指定する場合は M6_CHROMIUM=/path/to/chrome
 *
 * EXIT 0 = ポータルが起動し、未ログインの飼い主にログイン導線が出る
 * EXIT 1 = 起動していない（＝飼い主は何も見られない）
 *
 * 他の verify:* と違い、この検査は自分で Worker を立てる。`/my` は
 * Supabase モードでしか配信されず（KV モードでは 404）、`npm run preview` は
 * KV モードだからである。SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY には
 * **本物ではないダミー**を渡す。ログインしていない状態の判定は
 * `supabase.auth.getSession()` が localStorage を読むだけで完結し、
 * Supabase への通信が発生しないため、これで未ログイン分岐は実証できる。
 *
 * この検査が証明しないこと（Supabase 有効化後に別途要る）:
 *   Google OAuth の1往復 / ログイン後の犬一覧・カルテ表示 / RLS の効き方 / 招待の消化。
 *   つまり「ログインしていない飼い主に、ログインする手段が出る」までしか言えない。
 *
 * なぜこの検査が要るか:
 *   `src/my.html` から `data-portal="customer"` が消えていた期間があり、
 *   `supabase-auth.js` の起動分岐が永久に false のまま、ポータルは一度も
 *   立ち上がっていなかった。そのあいだ `/my` に出ていたのは、架空の犬・架空の
 *   来店日・他所の犬の写真で作られた静的モックである（D-10 違反）。
 *   フックは目視では消えたことに気づけないので、機械で押さえる。
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORTAL_PORT || 8788);
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 5_000;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

/** ポートが空いているか。塞がっていると wrangler は kj::Exception を吐いて読み解きにくい。 */
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

if (!await portIsFree(PORT)) {
  process.stderr.write(
    `ポート ${PORT} が塞がっている。前回の wrangler が残っているか、他のサーバが使っている。\n`
    + `PORTAL_PORT=<別のポート> で逃がすこともできる。\n`,
  );
  process.exit(1);
}

/* ダミーであることが読んで分かる値にする。実在の値をここへ書かない。
   detached: true はプロセスグループを作るため。`npx` を kill しても、その下の
   wrangler(node) と workerd は生き残ってポートを掴んだままになり、次の実行が
   「Address already in use」で落ちる。グループごと止める。 */
const worker = spawn('npx', [
  'wrangler', 'dev',
  '--config', 'worker/wrangler.supabase.toml',
  '--port', String(PORT),
  '--var', 'SUPABASE_URL:https://portal-verify.supabase.co',
  '--var', 'SUPABASE_PUBLISHABLE_KEY:sb_publishable_verifyonly',
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });

/** プロセスグループごと止めて、実際に終わるまで待つ（待たないとポートが解放されない）。 */
async function stopWorker() {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  const exited = new Promise((resolve) => worker.once('exit', resolve));
  try {
    process.kill(-worker.pid, 'SIGTERM');
  } catch {
    return; // もう居ない
  }
  const hammer = setTimeout(() => {
    try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* もう居ない */ }
  }, STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(hammer);
}

/* 途中で Ctrl-C されても居残らせない。 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopWorker().finally(() => process.exit(130)); });
}

let workerLog = '';
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Worker が ${READY_TIMEOUT_MS / 1000}s で起動しなかった`)), READY_TIMEOUT_MS);
  const watch = (chunk) => {
    workerLog += chunk;
    if (workerLog.includes(`Ready on http://localhost:${PORT}`)) {
      clearTimeout(timer);
      resolve();
    }
  };
  worker.stdout.on('data', (c) => watch(String(c)));
  worker.stderr.on('data', (c) => watch(String(c)));
  worker.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`Worker が起動前に終了した (exit ${code})\n${workerLog}`));
  });
});

let browser = null;
try {
  await ready;

  const launchOpts = process.env.M6_CHROMIUM ? { executablePath: process.env.M6_CHROMIUM } : {};
  browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const response = await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  check('1. /my が配信される', response?.status() === 200, `status=${response?.status()}`);

  /* bootProtectedPortal() は DOMContentLoaded 後に非同期で走る。 */
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const q = (selector) => document.querySelector(selector);
    return {
      flavor: document.body.dataset.portal,
      status: q('[data-portal-status]')?.textContent?.trim() ?? null,
      loginVisible: q('[data-login-panel]') ? !q('[data-login-panel]').hidden : null,
      contentVisible: q('[data-portal-content]') ? !q('[data-portal-content]').hidden : null,
      signOutVisible: q('[data-sign-out]') ? !q('[data-sign-out]').hidden : null,
      loginHandled: typeof q('[data-google-login]')?.onclick === 'function',
      vendorReady: typeof globalThis.TrimmerSupabaseVendor?.createClient === 'function',
      portalBooted: typeof globalThis.TrimmerAuth?.client === 'object' && globalThis.TrimmerAuth.client !== null,
      images: document.querySelectorAll('img').length,
    };
  });

  check('2. 起動分岐が立っている', state.flavor === 'customer', `data-portal=${state.flavor}`);
  check('3. Supabase vendor が読めている', state.vendorReady === true);
  check('4. ポータルが起動している', state.portalBooted === true, 'window.TrimmerAuth.client');
  check('5. 未ログインでログイン導線が出る', state.loginVisible === true && state.status === 'Googleでログインしてください', `status=${JSON.stringify(state.status)}`);
  check('6. ログインボタンが押せる', state.loginHandled === true);
  check('7. 未ログインで中身とログアウトは隠れている', state.contentVisible === false && state.signOutVisible === false);
  check('8. 見本画像を出していない', state.images === 0, `img=${state.images}`);

  /* 犬やカルテを直接指す URL でも、未ログインなら同じログイン導線に落ちること。
     ここで /my へ飛ばしてしまうと、ログイン後に元の URL へ戻れなくなる。 */
  await page.goto(`${BASE}/my/pets/40000000-0000-0000-0000-0000000000a1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const deep = await page.evaluate(() => ({
    path: location.pathname,
    loginVisible: !document.querySelector('[data-login-panel]').hidden,
  }));
  check(
    '9. 犬を直接指す URL でもログイン導線が出る',
    deep.loginVisible === true && deep.path === '/my/pets/40000000-0000-0000-0000-0000000000a1',
    `path=${deep.path}`,
  );

  check('10. アプリ由来のコンソールエラーが無い', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stopWorker();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('この検査はログイン前までしか見ていない。ログイン後の表示は Supabase 有効化後に別途要る。\n');
process.exit(passed === results.length ? 0 : 1);

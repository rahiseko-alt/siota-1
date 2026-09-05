/**
 * verify-portal.mjs — 飼い主のマイページ `/my` が実際に起動し、ログイン後も正しく動くか
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run build && npm run verify:portal
 *   ブラウザは自動で探す。指定するなら WALK_CHROMIUM=/path/to/chrome
 *
 * **CI（.github/workflows/ci.yml）から自動で走る。** 復元にあたって変えたのは
 * ブラウザの選び方だけで、見ている中身は `6685df5^` のまま（`plan.md` 4-0-d）。
 *
 * EXIT 0 = 全項目合格 / EXIT 1 = 1つでも落ちた
 *
 * 前半（1〜10）はログイン前の起動確認。`/my` は Supabase モードでしか配信されず
 * KV モードでは 404 になるため、この検査だけは自分でローカル Worker を立てる。
 *
 * 後半（11〜）はログイン後の確認（F5で追加）。`supabase/seed.sql` のローカル専用
 * テストアカウントで実ログインし、①飼い主は自分の犬だけが見えること、②他人の犬は
 * 見えないこと（RLS）、③サインアウトでログイン画面に戻ることを確かめる。
 * データ項目の往復・空状態・XSS はそれぞれ verify:roundtrip / verify:empty / verify:xss
 * が別に担当するので、ここでは重複させない。
 *
 * なぜこの検査が要るか:
 *   `src/my.html` から `data-portal="customer"` が消えていた期間があり、
 *   `supabase-auth.js` の起動分岐が永久に false のまま、ポータルは一度も
 *   立ち上がっていなかった。そのあいだ `/my` に出ていたのは、架空の犬・架空の
 *   来店日・他所の犬の写真で作られた静的モックである（D-10 違反）。
 *   フックは目視では消えたことに気づけないので、機械で押さえる。
 */

import { startLocalWorker, injectSession, FIXTURE } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  /* `★` で始まる detail は**落ちたときに何が起きたか**を書いたもの。合格した行に
     出すと「PASS なのに ★ 文例が出ている」のように読めてしまい、緑と赤が見分け
     られなくなる。出力を読んで判断する運用なので、ここは正確に出す。 */
  const note = detail && !(pass && String(detail).startsWith('★')) ? detail : '';
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8788) });
let browser = null;
try {
  /* ブラウザは「在るものを探して使う」共通部品に任せる（`#8` / `scripts/lib/chromium.mjs`）。
     以前は `M6_CHROMIUM` を渡したときだけ動く形で、**渡し方を知っている人の机の上でしか
     走らなかった**。CI では何も渡さずに動く必要がある。 */
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const response = await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  check('1. /my が配信される', response?.status() === 200, `status=${response?.status()}`);

  /* bootProtectedPortal() は DOMContentLoaded 後に非同期で走り、
     **未ログインなら入口（`/`）へ出ていく**（`D-20260905-67`「入口を1つにしろ」）。
     ここは長く「`/my` でログインパネルが出る」を見ていたが、そのパネルは
     **押せば本当にログインが始まる2つ目の入口**だったので器ごと外した。 */
  await page.waitForURL(/\/$/, { timeout: 20_000 }).catch(() => { /* 下の check が落とす */ });
  await page.waitForTimeout(1_200);

  const state = await page.evaluate(() => {
    const q = (selector) => document.querySelector(selector);
    const vis = (el) => !!el && el.getClientRects().length > 0;
    return {
      path: location.pathname,
      entryLogin: vis(q('[data-entry-login]')),
      back: sessionStorage.getItem('post_auth_return'),
      images: document.querySelectorAll('img').length,
    };
  });

  check('5. 未ログインの `/my` は入口へ送られ、そこに押せるログインが在る',
    state.path === '/' && state.entryLogin === true,
    `path=${state.path} ログイン=${state.entryLogin}`);
  check('6. そのとき、開こうとした URL を覚えている（ログイン後に戻れる）',
    state.back === '/my', `覚えた先=${state.back}`);
  /* **`/my` に配られた HTML そのものを見る。** ここは長く「いま見えている画像の数」を
     数えていたが、未ログインの `/my` は入口へ出ていくようになり、数えていたのは
     入口の画像（14枚）だった。見たい性質は「**飼い主の器に見本が埋まっていない**」
     （`D-10`）なので、器を直接見る。`mutate-run` の `portal-sample-image` は
     `src/my.html` に `<img>` を注ぐので、この形でも捕まる。 */
  const myHtml = await (await fetch(`${BASE}/my`)).text();
  const myImages = (myHtml.match(/<img\b/g) || []).length;
  check('8. 見本画像を出していない', myImages === 0, `img=${myImages}`);

  /* 犬やカルテを直接指す URL でも、未ログインなら同じ入口に落ちること。
     **その URL を覚えていなければブックマークが死ぬ**——ここが生命線。 */
  await page.goto(`${BASE}/my/pets/${FIXTURE.petX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/$/, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1_200);
  const deep = await page.evaluate(() => ({
    path: location.pathname,
    back: sessionStorage.getItem('post_auth_return'),
  }));
  check(
    '9. 犬を直接指す URL でも入口へ送られ、その URL を覚えている',
    deep.path === '/' && deep.back === `/my/pets/${FIXTURE.petX}`,
    `path=${deep.path} 覚えた先=${deep.back}`,
  );

  check('10. アプリ由来のコンソールエラーが無い（ログイン前）', consoleErrors.length === 0, consoleErrors.join(' | '));

  // ── 11〜: ログイン後（F5で追加）──
  /* **注入は入口で行われる**（`injectSession` が自分で `/` へ移る）。
     戻ってくるので `reload()` ではなく、行きたい画面を名指しで開く。 */
  await injectSession(page, FIXTURE.ownerAEmail);
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.pet-card', { timeout: 15000 });
  // 繰り返し実行で犬が増えていく前提（DBは検査間で毎回リセットしない）なので、
  // 「自分の犬(X/Y/Z)は出る」「他人の犬(Q)は出ない」だけを見る。件数固定では見ない。
  const petCards = await page.evaluate(() => [...document.querySelectorAll('.pet-card')].map((el) => el.textContent.trim()));
  check('11. ログイン後、自分の犬（X/Y/Z）が一覧に出て、他人の犬（Q）は出ない',
    ['X', 'Y', 'Z'].every((n) => petCards.includes(n)) && !petCards.includes('Q'),
    JSON.stringify(petCards));

  const signOutVisibleAfterLogin = await page.evaluate(() => !document.querySelector('[data-sign-out]').hidden);
  check('12. ログイン後はログアウトボタンが出る', signOutVisibleAfterLogin);

  /* **測る位置をログイン後へ移した**（文言は変えていない）。未ログインの `/my` は
     入口へ出ていくようになったので、そこでは器の起動を測れない。
     見る性質は同じ——この画面が正しく起動しているか。 */
  const booted = await page.evaluate(() => ({
    flavor: document.body.dataset.portal,
    vendorReady: typeof globalThis.TrimmerSupabaseVendor?.createClient === 'function',
    portalBooted: typeof globalThis.TrimmerAuth?.client === 'object' && globalThis.TrimmerAuth.client !== null,
  }));
  check('2. 起動分岐が立っている', booted.flavor === 'customer', `data-portal=${booted.flavor}`);
  check('3. Supabase vendor が読めている', booted.vendorReady === true);
  check('4. ポータルが起動している', booted.portalBooted === true, 'window.TrimmerAuth.client');

  // 他人の犬（Q）を直接指すURLは見えない（全体受け入れ条件3の前倒し確認）
  await page.goto(`${BASE}/my/pets/${FIXTURE.petQ}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const strangerBlocked = await page.evaluate(() => {
    const status = document.querySelector('[data-portal-status]')?.textContent?.trim() || '';
    const content = document.querySelector('[data-portal-content]');
    return status !== '' && (!content || content.hidden || content.textContent.trim() === '');
  });
  check('13. 他人の犬（Q）は見えない（RLS）', strangerBlocked);

  // サインアウトでログイン画面に戻る
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-sign-out]:not([hidden])', { timeout: 15000 });
  await page.click('[data-sign-out]');
  await page.waitForTimeout(1000);
  /* **サインアウトの行き先は入口（`/`）**（マスター指示 2026-09-04
     「そもそも管理者と顧客の入り口を分けるな。認証で振り分ける経路にしろ」）。
     ここは長く「`/my` に留まってログイン画面が出る」を要求していたが、それだと
     飼い主の画面がもう1つの入口になる。3画面（`/edit` `/my` `/admin`）とも
     入口へ返すように揃えた。**着いた先で、実際にログインし直せるところまで見る。** */
  await page.waitForTimeout(1_500);
  const signedOutState = await page.evaluate(() => {
    const vis = (el) => !!el && el.getClientRects().length > 0;
    return {
      path: location.pathname,
      loginVisible: vis(document.querySelector('[data-entry-login]')),
      /* 出て行ったあと、鍵が残っていないこと。 */
      tokenLeft: Object.keys(localStorage).some((k) => k.includes('auth-token')),
    };
  });
  check('14. サインアウトすると入口に戻り、そこでログインし直せる',
    signedOutState.path === '/' && signedOutState.loginVisible === true
    && signedOutState.tokenLeft === false, JSON.stringify(signedOutState));

  /* ── 15: **詰まないこと。**
     セッションは残っているのに `/api/session` が 401 を返す状況
     （スタッフが飼い主リンクを外した直後／トークン失効）を作る。
     1回目は自動で signOut → 再読込して回復するので、**2回目**を再現するために
     `auth_reload_once` を立てておく。以前はこの分岐でログインパネルを**隠して**
     「Googleでログインしてください」だけ出していた——**押すものが無い**。 */
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await injectSession(page, FIXTURE.ownerAEmail);
  await page.route('**/api/session', (route) => route.fulfill({
    status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}',
  }));
  await page.evaluate(() => sessionStorage.setItem('auth_reload_once', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  /* **入口へ返って、そこで入り直せること。**
     **鍵を捨ててから返す**のが要点——捨てずに返すと、入口は「セッションが在る」と
     見て `/my` へ送り返し、`/my` は 401 でまた入口へ返す（往復して詰む）。 */
  await page.waitForURL(/\/$/, { timeout: 20_000 }).catch(() => { /* 下の check が落とす */ });
  await page.waitForTimeout(1_500);
  const stuck = await page.evaluate(() => {
    const button = document.querySelector('[data-entry-login]');
    return {
      path: location.pathname,
      buttonVisible: !!button && button.getClientRects().length > 0,
      buttonEnabled: !!button && !button.disabled,
      tokenLeft: Object.keys(localStorage).some((k) => k.includes('auth-token')),
    };
  });
  await page.unroute('**/api/session');
  check('15. 失効・リンク解除のあとでも、ログインボタンが出て押せる（詰まない）',
    stuck.path === '/' && stuck.buttonVisible && stuck.buttonEnabled && stuck.tokenLeft === false,
    JSON.stringify(stuck));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

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
  await page.goto(`${BASE}/my/pets/${FIXTURE.petX}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const deep = await page.evaluate(() => ({
    path: location.pathname,
    loginVisible: !document.querySelector('[data-login-panel]').hidden,
  }));
  check(
    '9. 犬を直接指す URL でもログイン導線が出る',
    deep.loginVisible === true && deep.path === `/my/pets/${FIXTURE.petX}`,
    `path=${deep.path}`,
  );

  check('10. アプリ由来のコンソールエラーが無い（ログイン前）', consoleErrors.length === 0, consoleErrors.join(' | '));

  // ── 11〜: ログイン後（F5で追加）──
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await injectSession(page, FIXTURE.ownerAEmail);
  await page.reload();
  await page.waitForSelector('.pet-card', { timeout: 15000 });
  // 繰り返し実行で犬が増えていく前提（DBは検査間で毎回リセットしない）なので、
  // 「自分の犬(X/Y/Z)は出る」「他人の犬(Q)は出ない」だけを見る。件数固定では見ない。
  const petCards = await page.evaluate(() => [...document.querySelectorAll('.pet-card')].map((el) => el.textContent.trim()));
  check('11. ログイン後、自分の犬（X/Y/Z）が一覧に出て、他人の犬（Q）は出ない',
    ['X', 'Y', 'Z'].every((n) => petCards.includes(n)) && !petCards.includes('Q'),
    JSON.stringify(petCards));

  const signOutVisibleAfterLogin = await page.evaluate(() => !document.querySelector('[data-sign-out]').hidden);
  check('12. ログイン後はログアウトボタンが出る', signOutVisibleAfterLogin);

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
  const signedOutState = await page.evaluate(() => ({
    loginVisible: !document.querySelector('[data-login-panel]').hidden,
    path: location.pathname,
  }));
  check('14. サインアウトでログイン画面に戻る', signedOutState.loginVisible === true && signedOutState.path === '/my', JSON.stringify(signedOutState));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

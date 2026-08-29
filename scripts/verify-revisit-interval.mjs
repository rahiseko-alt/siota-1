/**
 * verify-revisit-interval.mjs — 「次回のおすすめご来店時期」が正しく出る・直せること
 *
 * マスター指示（2026-08-29・D-20260829-58）:
 *   「デフォルトは30日後、別途修正できるようにする。修正はデフォルト自体の修正も
 *     犬ごとの修正も可能とする。」
 *
 * 見るもの:
 *   0. 一般スタッフは店舗の既定日数を変えられない（RLS `shops_admin_update`）
 *   1. 管理者は店舗の既定日数を変えられる（PATCH /api/shop）
 *   3. 上書きが無い犬は、来店日 + 店舗の既定日数がそのまま⑤に出る
 *   4. 編集欄（この犬だけの上書き）は⑤（スタッフ）側にだけ出る
 *   5〜6. ⑤で上書きを保存すると、その場で・読み直しても新しい日付が出る
 *   7. 上書き後の日付が⑥（飼い主）にも同じ値で届く
 *   8. ⑥には編集欄が出ない（編集はスタッフ限定）
 *
 *   npm run verify:revisit
 */

import { startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, actual, expected) {
  const pass = String(actual) === String(expected);
  results.push({ name, pass });
  process.stdout.write(
    `${pass ? 'PASS' : 'FAIL'}  ${name}`
    + (pass ? `  "${String(actual).slice(0, 30)}"` : `\n        期待: "${expected}"\n        実際: "${actual}"`)
    + '\n',
  );
}

/** `magazine-view.js: addDaysToIsoLike` と同じ計算・同じ表記（UTC・`YYYY.MM.DD`）。
    ここで別実装にするのは、実装のコピーではなく「期待値を独立に計算する」ため
    （同じ関数の中身を読み返すだけの検査は、壊れても赤にならない）。 */
function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.REVISIT_PORT || 8793) });
let browser = null;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const staffHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const adminSession = await passwordLogin(FIXTURE.adminEmail, LOCAL_PASSWORD);
  const adminHeaders = { Authorization: `Bearer ${adminSession.access_token}`, 'Content-Type': 'application/json' };

  /* 0. 一般スタッフは店舗の既定日数を変えられない（RLS が UPDATE を0行に絞り、
        店の側は `one()` が 404 として扱う）。 */
  const staffPatch = await fetch(`${BASE}/api/shop`, {
    method: 'PATCH', headers: staffHeaders, body: JSON.stringify({ defaultRevisitDays: 99 }),
  });
  check('0. 一般スタッフは店舗の既定日数を変えられない', staffPatch.status, 404);

  /* 1. 管理者は変えられる。 */
  const DEFAULT_DAYS = 45;
  const adminPatch = await fetch(`${BASE}/api/shop`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ defaultRevisitDays: DEFAULT_DAYS }),
  });
  check('1. 管理者は店舗の既定日数を変えられる', adminPatch.status, 200);
  const shopAfter = adminPatch.ok ? (await adminPatch.json()).shop : null;
  check('1b. 変えた値が読み返せる', shopAfter && shopAfter.default_revisit_days, DEFAULT_DAYS);

  /* 2. 検査用の犬を作り、来店日つきでカルテを1枚作って確定する。 */
  const PET_NAME = `RV${Math.random().toString(36).slice(2, 7)}`;
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: staffHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: PET_NAME, template: 'ponchi' }),
  });
  check('2. 検査用の犬を登録できた', petRes.status, 201);
  const pet = (await petRes.json()).pet;
  const VISIT_DATE = '2026-07-20';

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 15_000 });
  await page.evaluate((visitDate) => {
    const dateEl = document.getElementById('input-visit-date');
    dateEl.value = visitDate;
    dateEl.dispatchEvent(new Event('input', { bubbles: true }));
  }, VISIT_DATE);
  await page.fill('[data-field="staff-note"]', '次回のおすすめ日を確かめる回。');
  await page.selectOption('[data-field="course"]', 'トリミングコース');
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  await page.waitForSelector('#screen-4 .magazine-container', { timeout: 20_000 });
  const reportId = new URL(page.url()).pathname.split('/').pop();

  const revisitDate = (target) => target.evaluate(() => {
    const el = document.querySelector('[data-view="revisit-date"]');
    return el ? el.textContent.trim() : '(器が無い)';
  });
  const editIsVisible = (target) => target.evaluate(() => {
    const el = document.querySelector('[data-view="revisit-edit"]');
    return !!el && !el.hidden;
  });

  /* 3. 上書きが無い犬 → 来店日 + 店舗の既定日数。 */
  check('3. 確認: 次回日（上書き無し・店舗の既定日数）', await revisitDate(page), addDays(VISIT_DATE, DEFAULT_DAYS));

  /* 4. 編集欄はスタッフ側にだけ出る。 */
  check('4. 確認: 編集欄がスタッフ側に出ている', await editIsVisible(page) ? 'ok' : '出ていない', 'ok');

  /* 5. ⑤でこの犬だけの上書きを保存する。 */
  const OVERRIDE_DAYS = 10;
  await page.fill('[data-view="revisit-days-input"]', String(OVERRIDE_DAYS));
  await page.click('[data-view="revisit-save-btn"]');
  await page.waitForFunction(
    () => (document.querySelector('[data-view="revisit-save-status"]') || {}).textContent === '保存しました。',
    { timeout: 10_000 },
  );
  check('5. 確認: 保存直後にその場で日付が変わる', await revisitDate(page), addDays(VISIT_DATE, OVERRIDE_DAYS));

  /* 6. 読み直しても（サーバに実際に残っている）。 */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-4 .magazine-container', { timeout: 20_000 });
  check('6. 確認: 読み直しても上書きが残っている', await revisitDate(page), addDays(VISIT_DATE, OVERRIDE_DAYS));

  /* 7〜8. 飼い主側（⑥）。 */
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}/reports/${reportId}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('.magazine-container', { timeout: 20_000 });
  check('7. 飼い主: 上書き後の次回日が同じ値で届く', await revisitDate(ownerPage), addDays(VISIT_DATE, OVERRIDE_DAYS));
  check('8. 飼い主画面に編集欄が出ない（編集はスタッフ限定）', await editIsVisible(ownerPage) ? '出た' : 'ok', 'ok');
  await ownerContext.close();

  check('9. アプリ由来の確認ダイアログが余計に出ていない', dialogs.length, 0);
} catch (error) {
  check('検査を最後まで実行できた', error.message, 'ok');
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n===== 次回のおすすめご来店時期: ${passed}/${results.length} =====\n`);
if (passed !== results.length) {
  process.stdout.write('\n「次回のおすすめご来店時期」の表示・修正のどこかが期待どおりでない。\n');
}
process.exit(passed === results.length ? 0 : 1);

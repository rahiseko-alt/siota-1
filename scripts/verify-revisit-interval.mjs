/**
 * verify-revisit-interval.mjs — 「次回のおすすめご来店時期」が正しく出る・直せること
 *
 * マスター指示（2026-08-29・D-20260829-58）:
 *   「デフォルトは30日後、別途修正できるようにする。修正はデフォルト自体の修正も
 *     犬ごとの修正も可能とする。」
 *
 * 見るもの:
 *   0. 飼い主は店舗の既定日数を変えられない（いまの境界は「お店の人か、飼い主か」）
 *   1. お店の人は店舗の既定日数を変えられる（PATCH /api/shop）
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

  /* 0. **飼い主**は店舗の既定日数を変えられない。

     ここは以前「**一般スタッフ**は変えられない」を見ていた。`admin` と `staff` の
     2権限を前提にした検査で、その2権限は **2026-09-06 にマスターの判断で廃止**された
     （`D-20260906-68`・`supabase/migrations/202609060012_single_staff_role.sql`——
     「管理者とスタッフは同一で良い」）。同じ migration が `shops_admin_update` を落として
     `shops_staff_update`（その店のメンバーなら誰でも）に置き換えている。
     **つまりスタッフが変えられるのは、決めたとおりの挙動。** 検査のほうが古かった。

     5日間そのままだったのは、**この検査が CI に入っていなかった**から
     （`F-20260910-82`）。いま在る境界は「お店の人か、飼い主か」なので、そこを見る。

     **結果で見る。** 応答コード（404 / 403 / 500 のどれになるか）は判定に使わない
     ——実際に返ったコードは下に出すので、変わったら次の人が見て決められる。
     **「変わっていない」だけを見ない**（読めていなくても等しくなってしまう・`偽-5`）。
     土台として「そもそも読めたか」を同じ条件に置く。 */
  const ownerSession = await passwordLogin(FIXTURE.ownerAEmail, LOCAL_PASSWORD);
  const readDays = async () => {
    const res = await fetch(`${BASE}/api/shop`, { headers: staffHeaders });
    return res.ok ? (await res.json()).shop.default_revisit_days : `読めない(${res.status})`;
  };
  const daysBefore = await readDays();
  const ownerPatch = await fetch(`${BASE}/api/shop`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ownerSession.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultRevisitDays: 99 }),
  });
  const daysAfterOwner = await readDays();
  process.stdout.write(`      （飼い主の PATCH /api/shop は ${ownerPatch.status} を返した）\n`);
  check('0. 飼い主は店舗の既定日数を変えられない',
    `読めた=${Number.isFinite(Number(daysBefore))} 変わっていない=${String(daysAfterOwner) === String(daysBefore)}`,
    '読めた=true 変わっていない=true');

  /* 1. お店の人は変えられる（権限は1つ。「管理者」という区分はもう無い）。 */
  const DEFAULT_DAYS = 45;
  const shopPatch = await fetch(`${BASE}/api/shop`, {
    method: 'PATCH', headers: staffHeaders, body: JSON.stringify({ defaultRevisitDays: DEFAULT_DAYS }),
  });
  check('1. お店の人は店舗の既定日数を変えられる', shopPatch.status, 200);
  const shopAfter = shopPatch.ok ? (await shopPatch.json()).shop : null;
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

  /* 3. 上書きが無い犬 → 来店日 + 店舗の既定日数。 */
  check('3. 確認: 次回日（上書き無し・店舗の既定日数）', await revisitDate(page), addDays(VISIT_DATE, DEFAULT_DAYS));

  /* **犬ごとに日数を直す欄は消えた**（マスター指示 2026-09-10「日後も保存も不要だから
     削除しろ」）。それを見ていた4項（編集欄がスタッフ側に出る／保存直後に日付が変わる／
     読み直しても残る／飼い主側には出ない）は、**見る対象そのものが無くなった**ので畳んだ。
     残したのは「店舗の既定日数で計算した日付が、店にも飼い主にも同じ値で届くか」——
     機能の本体はこちらで、こちらは消えていない。 */

  /* 4. 飼い主側（⑥）にも同じ日付が届く。 */
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}/reports/${reportId}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('.magazine-container', { timeout: 20_000 });
  check('4. 飼い主: 次回日が同じ値で届く', await revisitDate(ownerPage), addDays(VISIT_DATE, DEFAULT_DAYS));

  /* 4b. 「予約はこちら」の入口（マスター指示 2026-09-10「予約はこちらボタンをつけろ。
     押すと指定のURLに飛ぶ仕組みにしろ」）。**日付の下に在るだけでは足りない**——
     行き先が空でも文字は出るので、`href` に中身が在ることまで見る。
     行き先そのもの（いまは Wikipedia の仮置き）は本番が決まれば変わるので**値では縛らない**。
     ⑤と⑥は同一レンダラなので、両方で見る。 */
  const bookLink = (target) => target.evaluate(() => {
    const el = document.querySelector('[data-view="revisit-book"]');
    if (!el) return { ある: false };
    return { ある: true, 文字: el.textContent.trim(), 行き先: el.getAttribute('href') || '', 別タブ: el.getAttribute('target') };
  });
  const ownerBook = await bookLink(ownerPage);
  check('4b. 飼い主: 次回日の下に「予約はこちら」が在り、行き先が入っている',
    ownerBook.ある && ownerBook.文字 === '予約はこちら' && /^https?:\/\/.+/.test(ownerBook.行き先)
      && ownerBook.別タブ === '_blank' ? 'ok' : JSON.stringify(ownerBook), 'ok');
  await ownerContext.close();

  const staffBook = await bookLink(page);
  check('4c. 確認: 店の画面にも同じ入口が在る（同一レンダラ）',
    staffBook.ある && staffBook.行き先 === ownerBook.行き先 ? 'ok' : JSON.stringify(staffBook), 'ok');

  /* 5. 直す欄が、どちらの画面にも無い（消したものが残っていない）。 */
  const editGone = (target) => target.evaluate(() => !document.querySelector('[data-view="revisit-days-input"]')
    && !document.querySelector('[data-view="revisit-save-btn"]'));
  check('5. 犬ごとに日数を直す欄が、店の画面に無い', await editGone(page) ? 'ok' : '残っている', 'ok');

  check('6. アプリ由来の確認ダイアログが余計に出ていない', dialogs.length, 0);
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

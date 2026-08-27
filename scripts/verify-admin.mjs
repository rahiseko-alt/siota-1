/**
 * verify-admin.mjs — 管理者画面（マスター指示 2026-08-26）
 *
 * 見るもの:
 *   ① 管理者は Google 認証すると**毎回**管理者画面に入る
 *   ② 管理者ページに ①リピーター ②新規 ③削除 が在る
 *   ③ リピーター → カルテ作成 / カルテ修正
 *   ④ 新規 → 顧客アカウント作成・ペットアカウント作成が**実際に効く**
 *   ⑤ 削除3種が**実際に消す**（写真の実体まで。`service_role` で数える）
 *   ⑥ カルテ修正が**確定済みを上書きする**（2枚目を作らない・飼い主に届く中身が変わる）
 *   ⑦ 管理者でない人はこの画面を使えず、かつ行き止まりにならない
 *
 * **「押せた」で合格にしない**（`D-12`）。作った/消した/直したものを、
 * 作用の出た先（一覧・Storage の実体・飼い主の画面）で数え直す。
 *
 *   npm run verify:admin
 */

import {
  startLocalWorker, injectSession, passwordLogin, localServiceRoleKey,
  FIXTURE, LOCAL_PASSWORD, LOCAL_SUPABASE_URL,
} from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  const note = detail && !(pass && String(detail).startsWith('★')) ? detail : '';
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.ADMIN_PORT || 8797) });
let browser = null;

/** 画面の文字でボタンを選ぶ（人と同じ探し方）。日本語はセレクタに連結しない（`D-9`）。 */
const tapByText = (page, text) => page.evaluate((needle) => {
  const button = [...document.querySelectorAll('.admin-menu__item, .boxbutton, .admin-back')]
    .find((el) => (el.textContent || '').includes(needle));
  if (!button) return false;
  button.click();
  return true;
}, text);

const menuTitles = (page) => page.evaluate(
  () => [...document.querySelectorAll('.admin-menu__item strong')].map((el) => el.textContent.trim()),
);

try {
  const staffSession = await passwordLogin(FIXTURE.adminEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const serviceKey = await localServiceRoleKey();

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  /* **アプリが人に見せた理由を、検査も読む。** `commitReport()` は保存に失敗すると
     `alert()` で理由を出して画面を移さない。listener を置かないと Playwright が
     黙って閉じるので、**保存できなかったのに「押せた」だけが残る**。 */
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  /* ── ① 管理者は毎回この画面に入る ── */
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(page, FIXTURE.adminEmail);
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/admin$/, { timeout: 20_000 }).catch(() => {});
  check('1. 管理者が /my を開くと管理者画面へ送られる',
    new URL(page.url()).pathname === '/admin', `path=${new URL(page.url()).pathname}`);

  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });

  /* ── ② 管理者ページの3つ ── */
  const top = await menuTitles(page);
  check('2. 管理者ページに リピーター / 新規 / 削除 が在る',
    top.length === 3
    && top[0].includes('リピーター') && top[1].includes('新規') && top[2].includes('削除'),
    `出た項目=${JSON.stringify(top)}`);

  /* ── ③ リピーター ── */
  await tapByText(page, 'リピーター');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const repeat = await menuTitles(page);
  check('3. リピーターに カルテ作成 / カルテ修正 が在る',
    repeat.length === 2 && repeat[0].includes('カルテ作成') && repeat[1].includes('カルテ修正'),
    `出た項目=${JSON.stringify(repeat)}`);
  await tapByText(page, '◀ もどる');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });

  /* ── ④ 新規: 顧客を作る ── */
  const stamp = Math.random().toString(36).slice(2, 7);
  const ownerName = `新規飼い主${stamp}`;
  await tapByText(page, '新規');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const news = await menuTitles(page);
  check('4. 新規に 顧客アカウント作成 / ペットアカウント作成 が在る',
    news.length === 2 && news[0].includes('顧客アカウント') && news[1].includes('ペットアカウント'),
    `出た項目=${JSON.stringify(news)}`);

  await tapByText(page, '顧客アカウントの新規作成');
  await page.waitForSelector('[data-admin-field="owner-name"]', { timeout: 10_000 });
  await page.fill('[data-admin-field="owner-name"]', ownerName);
  await page.click('[data-admin-action="create-owner"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});

  /* **画面の文字で合格にしない。** サーバに在るかを数え直す（`D-12`）。 */
  const ownersAfter = await (await fetch(`${BASE}/api/owners`, { headers: authHeaders })).json();
  const createdOwner = (ownersAfter.owners || []).find((o) => o.name === ownerName);
  check('5. 顧客アカウントが実際に作られた', !!createdOwner, `name=${ownerName}`);
  if (!createdOwner) throw new Error('顧客が作られていないので先へ進めない');

  /* ── ④ 新規: ペットを作る ── */
  const petName = `新規犬${stamp}`;
  await tapByText(page, '◀ もどる');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  await tapByText(page, 'ペットアカウントの新規作成');
  await page.waitForSelector('[data-admin-field="pet-name"]', { timeout: 20_000 });
  await page.selectOption('[data-admin-field="owner-select"]', createdOwner.id);
  await page.fill('[data-admin-field="pet-name"]', petName);
  await page.click('[data-admin-action="create-pet"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});

  const petsAfter = await (await fetch(`${BASE}/api/pets`, { headers: authHeaders })).json();
  const createdPet = (petsAfter.pets || []).find((p) => p.name === petName);
  check('6. ペットアカウントが実際に作られた', !!createdPet, `name=${petName}`);
  if (!createdPet) throw new Error('犬が作られていないので先へ進めない');

  /* ── ⑥ カルテ修正 — 確定済みを上書きする ──
     まず1枚確定させる（製品の道で作る。検査用の別経路を書かない）。 */
  const FIRST = '最初に書いた一言。';
  const FIXED = '直したあとの一言。';
  await page.goto(`${BASE}/edit/p/${createdPet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForTimeout(2000);
  await page.fill('[data-field="staff-note"]', FIRST);
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const reportId = new URL(page.url()).pathname.split('/').pop();
  check('7. 直す対象のカルテを1枚確定できた', /^[0-9a-f-]{36}$/.test(reportId), `id=${reportId}`);

  /* 管理者画面の「カルテ修正」が開く URL と同じ形で入る。 */
  await page.goto(`${BASE}/edit/p/${createdPet.id}/${reportId}?revise=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  const carried = await page.inputValue('[data-field="staff-note"]');
  check('8. 修正で開くと、前に書いた中身が入っている', carried === FIRST, `"${carried}"`);

  await page.fill('[data-field="staff-note"]', FIXED);
  /* **URL の形だけで待ってはいけない。** いま居るのは `/edit/p/{犬}/{カルテ}?revise=1` で、
     `waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/)` は**押す前から合っている**。
     だから押した瞬間に返り、保存を1ミリ秒も待たないまま次の行へ進んでいた
     （CI の実測で 8→9 が 51ms。本当に保存した 7 は約3.6秒かかっている）。
     結果、下の「2枚目を作らない」「1枚のまま」は**何も起きていなくても PASS** する
     恒真になり、中身を見る1件だけが落ちていた——`F-20260825-40` と同じ型。
     保存が終わって開き直したこと＝**`?revise=1` が落ちたこと**を待つ。 */
  const [reopened] = await Promise.all([
    page.waitForURL(
      (u) => /^\/edit\/p\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(u.pathname) && u.search === '',
      { timeout: 30_000 },
    ).then(() => true, () => false),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  check('9. 直す操作が最後まで進んだ（保存されて開き直した）', reopened,
    dialogs.length ? `画面に出た理由="${dialogs[dialogs.length - 1]}"` : `url=${page.url()}`);
  const afterRevise = new URL(page.url()).pathname.split('/').pop();
  /* **2枚目を作っていないこと。** ここが増えると飼い主に2通届く。 */
  check('10. 直しても同じカルテのまま（2枚目を作らない）', afterRevise === reportId,
    `直す前=${reportId} 直した後=${afterRevise}`);

  const reportsNow = await (await fetch(
    `${BASE}/api/pets/${createdPet.id}/reports`, { headers: authHeaders },
  )).json();
  const finals = (reportsNow.reports || []).filter((r) => r.status === 'final');
  check('11. 確定済みのカルテは1枚のまま', finals.length === 1, `${finals.length}枚`);
  check('12. 中身が直っている（確定済みが上書きされた）',
    finals[0] && finals[0].data && finals[0].data.staffNote === FIXED,
    `staffNote="${finals[0] && finals[0].data && finals[0].data.staffNote}"`);

  /* ── ⑤ 削除: カルテ1枚 ── */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const del = await menuTitles(page);
  check('13. 削除に 顧客 / ペット / カルテ の3つが在る',
    del.length === 3
    && del[0].includes('顧客アカウント全データ削除')
    && del[1].includes('ペットアカウント全データ削除')
    && del[2].includes('カルテ1枚単位削除'),
    `出た項目=${JSON.stringify(del)}`);

  await tapByText(page, 'カルテ1枚単位削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, petName);
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, finals[0].report_date);
  await page.waitForSelector('[data-admin-field="confirm-name"]', { timeout: 20_000 });
  /* **名前を打つまで押せない。** 取り返しがつかない操作なので確認を1枚挟んでいる。 */
  const disabledBefore = await page.isDisabled('[data-admin-action="confirm-delete"]');
  check('14. 名前を打つまで削除ボタンは押せない', disabledBefore === true);
  await page.fill('[data-admin-field="confirm-name"]', petName);
  await page.click('[data-admin-action="confirm-delete"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('削除しました'),
    { timeout: 30_000 },
  ).catch(() => {});

  const reportsAfterDelete = await (await fetch(
    `${BASE}/api/pets/${createdPet.id}/reports`, { headers: authHeaders },
  )).json();
  const finalsLeft = (reportsAfterDelete.reports || []).filter((r) => r.status === 'final');
  check('15. カルテ1枚が実際に消えた', finalsLeft.length === 0, `${finalsLeft.length}枚残っている`);

  /* ── ⑤ 削除: ペット全データ ── */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  await tapByText(page, 'ペットアカウント全データ削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, petName);
  await page.waitForSelector('[data-admin-field="confirm-name"]', { timeout: 20_000 });
  await page.fill('[data-admin-field="confirm-name"]', petName);
  await page.click('[data-admin-action="confirm-delete"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('削除しました'),
    { timeout: 30_000 },
  ).catch(() => {});

  const petsLeft = await (await fetch(`${BASE}/api/pets`, { headers: authHeaders })).json();
  check('16. ペットが実際に消えた',
    !(petsLeft.pets || []).some((p) => p.id === createdPet.id));

  /* ── ⑤ 削除: 顧客全データ ── */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  await tapByText(page, '顧客アカウント全データ削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, ownerName);
  await page.waitForSelector('[data-admin-field="confirm-name"]', { timeout: 20_000 });
  await page.fill('[data-admin-field="confirm-name"]', ownerName);
  await page.click('[data-admin-action="confirm-delete"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('削除しました'),
    { timeout: 30_000 },
  ).catch(() => {});

  const ownersLeft = await (await fetch(`${BASE}/api/owners`, { headers: authHeaders })).json();
  check('17. 顧客が実際に消えた',
    !(ownersLeft.owners || []).some((o) => o.id === createdOwner.id));

  /* **写真の実体まで消えたか。** RLS 越しに見ると、行が消えた時点で「見えない」に
     なるので必ず合格してしまう。`service_role` で数える（`verify:delete` と同じ理由）。 */
  const listed = await fetch(
    `${LOCAL_SUPABASE_URL}/storage/v1/object/list/report-assets`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${FIXTURE.shopId}/${createdPet.id}`, limit: 100 }),
    },
  );
  const objects = listed.ok ? await listed.json() : [];
  check('18. 消した犬の写真が Storage に残っていない',
    Array.isArray(objects) && objects.length === 0, `${(objects || []).length}件`);

  /* ── ⑦ 管理者でない人 ── */
  const staffPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staffPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(staffPage, FIXTURE.staffEmail);
  await staffPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await staffPage.waitForSelector('[data-admin-action="not-admin"]', { timeout: 20_000 }).catch(() => {});
  const staffSees = await staffPage.evaluate(() => ({
    denied: !!document.querySelector('[data-admin-action="not-admin"]'),
    menus: document.querySelectorAll('[data-admin-action="delete"]').length,
    status: (document.querySelector('[data-portal-status]') || {}).textContent || '',
  }));
  check('19. 管理者でないスタッフに管理者の操作を出していない',
    staffSees.denied === true && staffSees.menus === 0,
    `denied=${staffSees.denied} 削除メニュー=${staffSees.menus}`);
  check('20. 行き止まりにせず、その人が使える画面への入口を出している',
    staffSees.denied === true && staffSees.status.includes('管理者のアカウントではありません'),
    `status="${staffSees.status.trim()}"`);

  check('21. アプリ由来のエラーが無い', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('管理者の動線（リピーター/新規/削除）と、削除3種・カルテ修正が実際に効くか。\n');
process.exit(passed === results.length ? 0 : 1);

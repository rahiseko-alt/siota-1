/**
 * verify-m6.mjs — マスター指定の動線を、実データで一気通貫に通す
 *
 * `bad-scenarios-F3.md` #18。F3 の完了条件そのもの——
 * **F2 の2問（①最後まで到達できるか ②間違えても2タッチ以内に戻れるか）が、
 * 実データでも同じように通るか。**
 *
 * 動線（意匠モックが正・自分の発案を混ぜない）:
 *   ① URLを開く → ② ログイン → ③ 犬の名前を選ぶ → ④ カルテ作成 → ⑤ 確認 → ⑥ 顧客ページ
 *
 * ほかの検査との住み分け:
 *   ・値が同じで届くか        … `verify:roundtrip`
 *   ・画面に何が乗っているか  … `verify:screens`
 *   ・空の状態               … `verify:empty`
 *   ・ここは**通しで進めるか／戻れるか**だけを見る。1画面でも行き止まったら落ちる。
 *
 * **合否の最終判定は絵で行う**（`D-14`・`npm run walk`）。この検査は、その絵を撮る前に
 * 「そもそも通しで進めるか」を機械で確かめるためのもの。**人が使えるかの判定ではない。**
 *
 *   npm run verify:m6
 */

import { startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

/** ④で書く一言。**戻ってから書く**——書いてすぐ戻ると `#15` の担当と混ざる。 */
const NOTE = '一気通貫の検査で書いた一言。';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  /* `★` で始まる detail は**落ちたときに何が起きたか**を書いたもの。合格した行に
     出すと「PASS なのに ★ 文例が出ている」のように読めてしまい、緑と赤が見分け
     られなくなる。出力を読んで判断する運用なので、ここは正確に出す。 */
  const note = detail && !(pass && String(detail).startsWith('★')) ? detail : '';
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.M6_PORT || 8797) });
let browser = null;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const stamp = Math.random().toString(36).slice(2, 7);
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: `動線${stamp}`, template: 'ponchi' }),
  });
  const pet = (await petRes.json()).pet;

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  /* ── ① URLを開く ── */
  const first = await page.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });
  check('①. URL を開ける', first?.status() === 200, `status=${first?.status()}`);
  /* 未ログインなら `/my` のログイン画面へ落ちる。**行き止まりにならない**こと。 */
  await page.waitForTimeout(1_500);
  check('②a. 未ログインならログインの画面に導かれる',
    new URL(page.url()).pathname === '/my', `path=${new URL(page.url()).pathname}`);

  /* ── ② ログイン ── */
  await injectSession(page, FIXTURE.staffEmail);
  await page.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.karte-card', { timeout: 20_000 });
  check('②b. ログインすると作業画面に入れる', true, new URL(page.url()).pathname);

  /* ── ③ 犬の名前を選ぶ ── */
  const picked = await page.evaluate((name) => {
    const card = [...document.querySelectorAll('.karte-card')]
      .find((el) => (el.querySelector('.karte-card__dog-name') || {}).textContent === name);
    if (!card) return false;
    card.click();
    return true;
  }, `動線${stamp}`);
  check('③. 名前で犬を選べる', picked === true);
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });

  /* ── ④ カルテ作成 ──
     **ここではまだ書かない。** 先に「戻れるか」を見て、戻ってから書いて確定する。
     書いてすぐ戻ると、書いたものが下書きに残るかどうか（`#15` の担当）に
     この検査の結果が左右されてしまう。担当を混ぜない。 */
  const editable = await page.evaluate(() => ({
    canvas: !!document.getElementById('marking-canvas'),
    commit: !!document.querySelector('.dock-action-wrap .boxbutton'),
  }));
  check('④. カルテを書く画面に、書く場所と確定の入口が在る', editable.canvas && editable.commit);

  /* ── 間違えたときに2タッチ以内で戻れるか（D-14 の2問目の機械版） ──
     ③に居るとき、段のタブ（01〜04）で1タッチで②へ戻れること。 */
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.btn-step')].find((el) => el.dataset.step === '2');
    if (tab) tab.click();
  });
  /* **「画面が移った」で合格にしない。** `/edit/p/{petId}` で開いた画面は、その犬の分しか
     読んでいない。タブを押すと screen-2 に移りはするが**中身が空**で、犬を選び直せない
     ——押せただけで戻れていない（`D-14` の2問目）。ここで一度落ちて見つけた。
     **戻り先で犬が並んでいること**まで見る。 */
  await page.waitForSelector('.karte-card', { timeout: 20_000 }).catch(() => {});
  const back = await page.evaluate(() => ({
    active: (document.querySelector('.screen-panel.is-active') || {}).id,
    cards: document.querySelectorAll('.karte-card').length,
  }));
  check('★. 間違えても1タッチで一覧へ戻れる', back.active === 'screen-2', `active=${back.active}`);
  check('★b. 戻った先に犬が並んでいる（空の一覧に置き去りにしない）',
    back.cards > 0, `card=${back.cards}`);

  /* もう一度同じ犬へ入り直せること（＝戻り先が行き止まりでない）。 */
  const reentered = await page.evaluate((name) => {
    const card = [...document.querySelectorAll('.karte-card')]
      .find((el) => (el.querySelector('.karte-card__dog-name') || {}).textContent === name);
    if (!card) return false;
    card.click();
    return true;
  }, `動線${stamp}`);
  check('★c. 戻ってから、もう一度同じ犬に入れる', reentered === true);
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });

  /* ── 書いて確定する ── */
  await page.evaluate((note) => {
    const el = document.querySelector('[data-field="staff-note"]');
    el.value = note;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, NOTE);

  /* ── ⑤ 確認 ── */
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  await page.waitForSelector('#screen-4 .magazine-container', { timeout: 20_000 });
  const reportId = new URL(page.url()).pathname.split('/').pop();
  check('⑤. 確定すると確認の画面に着く', /^[0-9a-f-]{36}$/.test(reportId), `id=${reportId}`);

  /* ── ⑥ 顧客ページ ── */
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('.pet-card', { timeout: 20_000 });
  /* 飼い主が**自分で辿り着けるか**。URL を手打ちさせない。 */
  const reached = await ownerPage.evaluate((name) => {
    const card = [...document.querySelectorAll('.pet-card')].find((el) => el.textContent.includes(name));
    if (!card) return false;
    const link = card.tagName === 'A' ? card : card.querySelector('a');
    (link || card).click();
    return true;
  }, `動線${stamp}`);
  check('⑥a. 飼い主は一覧から自分の犬に入れる', reached === true);
  await ownerPage.waitForSelector('.report-list a', { timeout: 20_000 });
  await ownerPage.click('.report-list a');
  await ownerPage.waitForSelector('.magazine-container', { timeout: 20_000 });
  const ownerSees = await ownerPage.evaluate(() => document.body.textContent);
  check('⑥b. 飼い主はカルテを開ける', ownerSees.includes(NOTE), '★ 中身が出ていない');
  await ownerContext.close();
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('**人が使えるかの判定ではない**（それは D-14・npm run walk の絵だけで決める）。\n');
process.exit(passed === results.length ? 0 : 1);

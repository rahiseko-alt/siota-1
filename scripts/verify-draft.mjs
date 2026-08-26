/**
 * verify-draft.mjs — 記入したものが、黙って消えないこと
 *
 * `bad-scenarios-F3.md` #15。**記録から漏れていた4本の1つ。**
 *
 * トリマーの記入は DOM とメモリにしか無く、サーバに残るのは「確定」を押した後だけ
 * だった。カルテ画面の「戻る」は確認なしで遷移するので、**誤タップ1回で数十分の記入が
 * 消える**。施術中のスリープ・着信・引っぱって更新でも同じで、しかも消えたことに
 * 気づけない（画面もコンソールも何も言わない・`D-20260824-30` の 1 と 7）。
 *
 * 見るのは4つ、すべて「こうなっていれば合格」の形で書く:
 *   1. 記入すると下書きとして**サーバに**残る
 *   2. 画面を離れて戻ると、続きから書ける
 *   3. 確定できたら下書きは消える（次に開いたとき古い記入が蘇らない）
 *   4. 下書きは飼い主に見えない（見えたら「存在しない履歴」・`#16` と同じ穴）
 *
 *   npm run verify:draft
 */

import { startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const NOTE = '施術の途中で書いたメモ。これが消えたら数十分が失われる。';
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  /* `★` で始まる detail は**落ちたときに何が起きたか**を書いたもの。合格した行に
     出すと「PASS なのに ★ 文例が出ている」のように読めてしまい、緑と赤が見分け
     られなくなる。出力を読んで判断する運用なので、ここは正確に出す。 */
  const note = detail && !(pass && String(detail).startsWith('★')) ? detail : '';
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.DRAFT_PORT || 8795) });
let browser = null;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const stamp = Math.random().toString(36).slice(2, 7);
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: `下書${stamp}`, template: 'ponchi' }),
  });
  check('0. 検査用の犬を登録できた', petRes.status === 201, `status=${petRes.status}`);
  const pet = (await petRes.json()).pet;

  const listDrafts = async () => {
    const res = await fetch(`${BASE}/api/pets/${pet.id}/reports`, { headers: authHeaders });
    const body = await res.json();
    return (body.reports || []).filter((report) => report.status === 'draft');
  };

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);

  /* ── 1. 記入すると下書きがサーバに残る ── */
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.evaluate((note) => {
    const el = document.querySelector('[data-field="staff-note"]');
    el.value = note;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, NOTE);
  /* 1秒まとめてから送る作りなので、待ってから数える。 */
  await page.waitForTimeout(3_000);
  const afterTyping = await listDrafts();
  check('1. 記入が下書きとしてサーバに残った', afterTyping.length === 1, `${afterTyping.length}件`);

  /* ── 2. 離れて戻ると続きから書ける（＝誤タップで消えない） ── */
  await page.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.karte-card', { timeout: 20_000 });
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForFunction(
    (note) => (document.querySelector('[data-field="staff-note"]') || {}).value === note,
    NOTE, { timeout: 20_000 },
  ).catch(() => {});
  const resumed = await page.evaluate(() => (document.querySelector('[data-field="staff-note"]') || {}).value || '');
  check('2. 離れて戻ると、続きから書ける', resumed === NOTE, `"${resumed.slice(0, 24)}"`);

  /* ── 4. 下書きは飼い主に見えない（確定の前に見る） ── */
  const ownerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('[data-testid="pet-name"]', { timeout: 20_000 });
  const ownerView = await ownerPage.evaluate(() => ({
    links: document.querySelectorAll('[data-portal-content] .report-list a').length,
    text: document.body.textContent,
  }));
  check('3. 下書きは飼い主に見えない', ownerView.links === 0, `link=${ownerView.links}`);
  check('4. 下書きの中身が漏れていない', !ownerView.text.includes(NOTE), '★ 下書きが見えている');
  await ownerPage.close();

  /* ── 3. 確定すると下書きは消える（古い記入が蘇らない） ── */
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const afterCommit = await listDrafts();
  check('5. 確定すると下書きは残らない', afterCommit.length === 0, `${afterCommit.length}件`);

  /* もう一度開いたとき、真っさらから始まること。 */
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  const reopened = await page.evaluate(() => (document.querySelector('[data-field="staff-note"]') || {}).value || '');
  check('6. 次に開くと、確定済みの記入は蘇らない', reopened !== NOTE, `"${reopened.slice(0, 24)}"`);
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

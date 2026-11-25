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
 *   7〜9. 応答だけが途中で切れても、下書きは2枚にならず、押し直した確定は成功になる
 *         （レビュー 2026-11-25 R2・R3・R5。`/my` から押して進む・`D-27`）
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
  /* コースは必須（マスター指示 2026-08-29・C-9）。選ばないと確定できない。 */
  await page.selectOption('[data-field="course"]', 'トリミングコース');
  /* **本日の体重と一言も入れる**（マスター指示 2026-09-13・放置リスト `#55`）。
     空のままだと確定の手前で「このまま確定しますか？」と一度訊くようにしたため、
     ここを空で通していた台本は止まる。実際の業務でも空で確定することはまず無いので、
     **本物に近い形に直す**（検査を弱めるのではなく、台本を現実に合わせる）。 */
  await page.fill('#input-weight', '4.2');
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

  /* ── 7〜9. 応答だけが切れたとき（レビュー 2026-11-25 R2・R3・R5） ──
     サーバには届いて処理されたのに、返事だけが途中で消える（電波の切れ目）。
     `route.fetch()` で本物のサーバに送り、その返事を画面に渡さずに切る。
     画面には `/my` から入り、カードを押して進む（`D-27`・途中へ飛ばない）。 */
  const lostPetRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: `途切${stamp}`, template: 'ponchi' }),
  });
  const lostPet = (await lostPetRes.json()).pet;
  const reportsOf = async (status) => {
    const res = await fetch(`${BASE}/api/pets/${lostPet.id}/reports`, { headers: authHeaders });
    return ((await res.json()).reports || []).filter((report) => report.status === status);
  };
  const lostPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const lostDialogs = [];
  lostPage.on('dialog', (d) => { lostDialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await lostPage.goto(`${BASE}/my`);
  await injectSession(lostPage, FIXTURE.staffEmail);
  await lostPage.goto(`${BASE}/my`);
  await lostPage.waitForURL(/\/edit$/, { timeout: 20_000 });
  await lostPage.waitForSelector('.karte-card', { timeout: 20_000 });
  await lostPage.locator('.karte-card').filter({ hasText: lostPet.name }).first().click();
  await lostPage.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await lostPage.waitForTimeout(1_500);

  /** 次の1回だけ、サーバに届けたうえで返事を切る。 */
  const loseNextResponse = async (pattern, method) => {
    let lost = false;
    const handler = async (route) => {
      if (lost || route.request().method() !== method) return route.continue();
      lost = true;
      await route.fetch().catch(() => {});
      return route.abort('failed');
    };
    await lostPage.route(pattern, handler);
    return { done: () => lost, off: () => lostPage.unroute(pattern, handler) };
  };
  const typeNote = (text) => lostPage.evaluate((value) => {
    const el = document.querySelector('[data-field="staff-note"]');
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);

  const createCut = await loseNextResponse(`**/api/pets/${lostPet.id}/reports`, 'POST');
  await typeNote('書き始め。作った返事が届かない。');
  await lostPage.waitForTimeout(2_000);
  await createCut.off();
  await typeNote('書き始め。作った返事が届かない。続きを書いた。');
  await lostPage.waitForTimeout(3_000);
  const draftsAfterLoss = await reportsOf('draft');
  check('7. 下書きを作った返事が切れても、次の保存で2枚目の下書きを作らない',
    createCut.done() && draftsAfterLoss.length === 1, `切った=${createCut.done()} 下書き${draftsAfterLoss.length}件`);

  await lostPage.selectOption('[data-field="course"]', 'トリミングコース');
  await lostPage.fill('#input-weight', '4.2');

  /* 写真の片付け待ち（3分）で断られたときは、待てと言う。サーバの 409 をそのまま返す。 */
  let refusedOnce = false;
  const refuse = (route) => {
    if (refusedOnce || route.request().method() !== 'POST') return route.continue();
    refusedOnce = true;
    return route.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'report assets are incomplete' }),
    });
  };
  await lostPage.route('**/finalize', refuse);
  lostDialogs.length = 0;
  await lostPage.click('.dock-action-wrap .boxbutton');
  await lostPage.waitForFunction(() => !document.querySelector('.dock-action-wrap .boxbutton').disabled, null, { timeout: 30_000 })
    .catch(() => {});
  await lostPage.unroute('**/finalize', refuse);
  check('8. 写真の登録待ちで断られたら、「3分ほど待ってから」と言う',
    refusedOnce && lostDialogs.some((m) => m.includes('3分ほど待ってから')), JSON.stringify(lostDialogs));

  const finalizeCut = await loseNextResponse('**/finalize', 'POST');
  await lostPage.click('.dock-action-wrap .boxbutton');
  await lostPage.waitForFunction(() => !document.querySelector('.dock-action-wrap .boxbutton').disabled, null, { timeout: 30_000 })
    .catch(() => {});
  await finalizeCut.off();
  lostDialogs.length = 0;
  const reached = await Promise.all([
    lostPage.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }).then(() => true).catch(() => false),
    lostPage.click('.dock-action-wrap .boxbutton'),
  ]).then(([ok]) => ok);
  const finals = await reportsOf('final');
  const draftsLeft = await reportsOf('draft');
  check('9. 確定の返事が切れても、押し直すと「保存できませんでした」にならず確認へ進み、カルテは1枚',
    finalizeCut.done() && reached && lostDialogs.length === 0 && finals.length === 1 && draftsLeft.length === 0,
    `切った=${finalizeCut.done()} 着いた=${reached} 知らせ=${JSON.stringify(lostDialogs)} 確定${finals.length}枚 下書き${draftsLeft.length}件`);
  await lostPage.close();
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

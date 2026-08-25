/**
 * verify-empty-pet.mjs — カルテ0件の犬に、存在しない履歴を見せていないか
 *
 * `AGENTS.md` D-10 の機械強制。`bad-scenarios-F3.md` #16。
 *
 * 書いていないことは空で出す。カルテを1件も作っていない犬のページに、他の犬の写真や
 * 見本で埋まった画面が出るのは納品物として成立しない——お客さんはそれを**本当のこと**
 * だと読む（`F-14`・`F-15`）。実店舗の初日は、どの犬もカルテ0件から始まる。
 *
 * `6685df5^` の版から**書き直した**（復元ではない）。見るものは引き継ぎ、掴む場所を
 * 正UI に合わせた。あわせて「まだ確定していないカルテ（draft）が飼い主に見えないこと」
 * を足した——**確定前のものが見えるのも「存在しない履歴」**である。
 *
 * 見るのは4つ、すべて「こうなっていれば合格」の形で書く（`F-20260825-35`/`-36`）:
 *   1. 飼い主のページに、正直な空の状態が出ている
 *   2. 写真が1枚も出ていない（見本の写真が紛れ込んでいない）
 *   3. 確定していないカルテ（draft）が飼い主に見えない
 *   4. トリマー側は、その犬の1件目を作る画面に入れる（行き止まりでない）
 *
 *   npm run verify:empty
 */

import { startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
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

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.EMPTY_PORT || 8792) });
let browser = null;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };

  /* カルテを1件も持たない犬を、既存の飼い主（owner-a）の下に作る。 */
  const stamp = Math.random().toString(36).slice(2, 7);
  const EMPTY_PET = `空${stamp}`;
  const emptyRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: EMPTY_PET, template: 'ponchi' }),
  });
  check('0. カルテ0件の犬を用意できた', emptyRes.status === 201, `status=${emptyRes.status}`);
  const emptyPet = (await emptyRes.json()).pet;

  /* もう1頭。こちらは **draft のカルテだけ**を持つ。確定していないので飼い主には
     見えてはならない。「まだ書き終えていないもの」が届くのも、存在しない履歴である。 */
  const DRAFT_PET = `下書${stamp}`;
  const draftPetRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: DRAFT_PET, template: 'ponchi' }),
  });
  const draftPet = (await draftPetRes.json()).pet;
  const draftRes = await fetch(`${BASE}/api/pets/${draftPet.id}/reports`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      petId: draftPet.id, reportDate: '2026-08-25',
      data: { template: 'ponchi', pet: DRAFT_PET, staffNote: '書きかけの下書きです。' },
    }),
  });
  check('0b. 下書きのカルテを用意できた', draftRes.status === 201, `status=${draftRes.status}`);

  browser = await launchChromium();

  /* ── 飼い主側 ── */
  const ownerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${emptyPet.id}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('[data-testid="pet-name"]', { timeout: 20_000 });

  const empty = await ownerPage.evaluate(() => ({
    petName: (document.querySelector('[data-testid="pet-name"]') || {}).textContent || '',
    text: document.body.textContent,
    images: document.querySelectorAll('[data-portal-content] img').length,
    reportLinks: document.querySelectorAll('[data-portal-content] .report-list a').length,
  }));

  check('1. 犬の名前は出ている（ページ自体は開けている）', empty.petName === EMPTY_PET, `"${empty.petName}"`);
  check('2. 正直な空の状態が出ている', empty.text.includes('まだカルテがありません。'), '★ 空の知らせが無い');
  check('3. 写真が1枚も出ていない', empty.images === 0, `img=${empty.images}`);
  check('4. 履歴の行が1つも出ていない', empty.reportLinks === 0, `link=${empty.reportLinks}`);
  /* 意匠モックの文例が紛れ込んでいないこと。ここに出たら `#1` が飼い主側で再発している。 */
  check('5. 見本の文章が出ていない', !empty.text.includes('今月もとってもお利口に'), '★ 文例が出ている');

  /* ── 確定していないカルテは見えない ── */
  await ownerPage.goto(`${BASE}/my/pets/${draftPet.id}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('[data-testid="pet-name"]', { timeout: 20_000 });
  const draftView = await ownerPage.evaluate(() => ({
    text: document.body.textContent,
    reportLinks: document.querySelectorAll('[data-portal-content] .report-list a').length,
  }));
  check('6. 確定していないカルテは飼い主に見えない',
    draftView.reportLinks === 0 && draftView.text.includes('まだカルテがありません。'),
    `link=${draftView.reportLinks}`);
  check('7. 下書きの中身が漏れていない', !draftView.text.includes('書きかけの下書きです。'), '★ 下書きが見えている');

  /* ── トリマー側: 1件目を作る画面に入れるか（行き止まりでないこと） ── */
  const staffPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staffPage.goto(`${BASE}/my`);
  await injectSession(staffPage, FIXTURE.staffEmail);
  await staffPage.goto(`${BASE}/edit/p/${emptyPet.id}`, { waitUntil: 'networkidle' });
  await staffPage.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  const staffView = await staffPage.evaluate(() => ({
    activeScreen: (document.querySelector('.screen-panel.is-active') || {}).id,
    canCommit: !!document.querySelector('.dock-action-wrap .boxbutton'),
  }));
  check('8. トリマーは1件目を作る画面に入れる', staffView.activeScreen === 'screen-3', `active=${staffView.activeScreen}`);
  check('9. 確定のボタンが在る（行き止まりでない）', staffView.canCommit === true);
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

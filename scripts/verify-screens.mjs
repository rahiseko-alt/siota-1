/**
 * verify-screens.mjs — 各画面に「そこに在るべきものが在る」か
 *
 * `bad-scenarios-F3.md` #19。ほかの `verify:*` は「この操作をするとこの結果になる」を
 * 見る。決め打ちの手順をなぞるので、**手順の外にあるもの——画面に何が乗っているか、
 * そこから他のどこへ行けるか——は一切見ていない。** 実際それで2回やられた:
 *
 *   1. 招待QRのボタンが F2 で画面から消えた。機能は生きていたが、どこからも押せなかった
 *      （`D-20260824-29`）。検査は fixture で招待を迂回していたので気づけなかった
 *   2. **スタッフかつ飼い主**のアカウントが `/my` に留まるのに、`/` にも `/my` にも
 *      `/edit` へのリンクが1つも無く、トリマーが自分の作業画面へ行けなかった。
 *      しかも fixture にその組み合わせが無かったので、検査5本が揃って素通りした
 *      （`D-20260823-06`）
 *
 * どちらも「押すべきボタンが画面に無い」。1画面ずつ開いて数えれば見つかる。
 *
 * `6685df5^` の版から**書き直した**（復元ではない）。見るものは引き継ぎ、
 * 掴む場所を正UI に合わせた。
 *
 *   npm run verify:screens
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

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.SCREENS_PORT || 8793) });
let browser = null;
try {
  browser = await launchChromium();

  /* ── ① 入口（`/`）。F2 の動線が乗っている静的な正UI ── */
  const top = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const topRes = await top.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const topView = await top.evaluate(() => ({
    screens: document.querySelectorAll('[id^="screen-"]').length,
    /* **段のタブだけを数える。** ここは長らく `.btn-step` の個数を数えていたが、
       同じ見た目を流用した別のもの（管理者にだけ出る「管理」・2026-09-02）を
       足した瞬間に 5 になって落ちた。数えたいのは「01〜04 の段のタブ」であって
       「その見た目を使っている要素」ではない。段であることの印は `data-step`。
       判定を緩めたのではなく、**数える対象を正した**。 */
    steps: document.querySelectorAll('.btn-step[data-step]').length,
    active: (document.querySelector('.screen-panel.is-active') || {}).id,
  }));
  check('1. `/` が配信される', topRes?.status() === 200, `status=${topRes?.status()}`);
  check('2. `/` に4画面が乗っている', topView.screens === 4, `screen=${topView.screens}`);
  check('3. `/` に段のタブが4つ在る', topView.steps === 4, `tab=${topView.steps}`);
  check('4. `/` はログイン画面から始まる', topView.active === 'screen-1', `active=${topView.active}`);
  await top.close();

  /* ── ② スタッフかつ飼い主（本番のマスター自身と同じ形）が `/my` に留まったとき、
        自分の作業画面へ行けること。**過去に行き止まりになっていた場所。** ── */
  const both = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await both.goto(`${BASE}/my`);
  await injectSession(both, FIXTURE.staffOwnerEmail);
  await both.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await both.waitForSelector('[data-sign-out]:not([hidden])', { timeout: 20_000 });
  const bothView = await both.evaluate(() => {
    const link = document.querySelector('[data-staff-link]');
    return {
      path: location.pathname,
      staffLinkVisible: !!link && !link.hidden,
      staffLinkHref: link ? link.getAttribute('href') : null,
      signOutVisible: !!document.querySelector('[data-sign-out]:not([hidden])'),
    };
  });
  check('5. スタッフ兼飼い主は `/my` に留まる', bothView.path === '/my', `path=${bothView.path}`);
  check('6. その人に作業画面（`/edit`）への入口が出ている',
    bothView.staffLinkVisible === true && bothView.staffLinkHref === '/edit',
    `visible=${bothView.staffLinkVisible} href=${bothView.staffLinkHref}`);
  check('7. サインアウトの入口も出ている', bothView.signOutVisible === true);

  /* 押したら本当に着くか。**在るだけでは足りない。** */
  await Promise.all([
    both.waitForURL(/\/edit\/?$/, { timeout: 20_000 }),
    both.click('[data-staff-link]'),
  ]);
  await both.waitForSelector('.karte-card', { timeout: 20_000 });
  check('8. その入口を押すと、犬の一覧に着く', true, `url=${new URL(both.url()).pathname}`);
  await both.close();

  /* ── ③ 飼い主だけの人に、作業画面の入口を出していないこと ── */
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await owner.goto(`${BASE}/my`);
  await injectSession(owner, FIXTURE.ownerAEmail);
  await owner.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await owner.waitForSelector('[data-sign-out]:not([hidden])', { timeout: 20_000 });
  const ownerView = await owner.evaluate(() => {
    const link = document.querySelector('[data-staff-link]');
    return { staffLinkVisible: !!link && !link.hidden, pets: document.querySelectorAll('.pet-card').length };
  });
  check('9. 飼い主だけの人に作業画面の入口を出していない', ownerView.staffLinkVisible === false);
  check('10. 飼い主には自分の犬が並んでいる', ownerView.pets > 0, `pet=${ownerView.pets}`);
  await owner.close();

  /* ── ④ トリマーの `/edit`。②一覧 → ③カルテ作成 → ④確定 の導線が繋がっているか ── */
  const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staff.goto(`${BASE}/my`);
  await injectSession(staff, FIXTURE.staffEmail);
  await staff.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });
  await staff.waitForSelector('.karte-card', { timeout: 20_000 });
  const listView = await staff.evaluate(() => ({
    cards: document.querySelectorAll('.karte-card').length,
    /* 招待（QR）の入口。**数える**——「押すべきボタンが画面に無い」を見るのが
       この検査の役目なので、在るふりも無いふりもしない（`#17`・`D-20260824-29`）。 */
    invites: document.querySelectorAll('.btn-invite:not([hidden])').length,
    search: !!document.getElementById('dir-search-input'),
    newKarte: [...document.querySelectorAll('[onclick]')]
      .some((el) => (el.getAttribute('onclick') || '').includes('createNewKarte')),
  }));
  check('11. ②一覧に犬のカードが並んでいる', listView.cards > 0, `card=${listView.cards}`);
  check('12. ②一覧に探す手段が在る', listView.search === true);
  check('13. ②一覧から新規カルテを作れる入口が在る', listView.newKarte === true);
  check('13c. ②一覧に初回登録（QR）の入口が在る', listView.invites > 0, `${listView.invites}件`);

  /* **犬の名前を押す。** カードそのものの中心を押すと、`.karte-card__actions` に並ぶ
     ボタン（前回を複製／初回登録QR／選択）に当たることがある。初回登録QR は
     `stopPropagation()` するので画面は移らない——実際それで一度落ちた。
     人が犬を選ぶときに押すのは名前なので、そこを押す。 */
  const beforePick = new URL(staff.url()).pathname;
  await Promise.all([
    staff.waitForURL(/\/edit\/p\/[0-9a-f-]+$/, { timeout: 20_000 }),
    staff.click('.karte-card .karte-card__dog-name'),
  ]);
  check('13b. 犬の名前を押すと画面が移る', new URL(staff.url()).pathname !== beforePick,
    `${beforePick} → ${new URL(staff.url()).pathname}`);
  await staff.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  const editView = await staff.evaluate(() => ({
    active: (document.querySelector('.screen-panel.is-active') || {}).id,
    commit: !!document.querySelector('.dock-action-wrap .boxbutton'),
    canvas: !!document.getElementById('marking-canvas'),
  }));
  check('14. 犬を選ぶと③カルテ作成に着く', editView.active === 'screen-3', `active=${editView.active}`);
  check('15. ③に確定の入口が在る（行き止まりでない）', editView.commit === true);
  check('16. ③に犬体図が在る', editView.canvas === true);

  /* 招待の入口は**カードの中に在って、犬の選択とぶつかっていない**こと。
     押すと画面が移ってしまうなら、犬を選べなくなっている。 */
  await staff.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });
  await staff.waitForSelector('.btn-invite:not([hidden])', { timeout: 20_000 });
  const beforeInvite = new URL(staff.url()).pathname;
  await staff.click('.btn-invite');
  await staff.waitForTimeout(1_500);
  check('17. 招待の入口を押しても、犬の選択には移らない',
    new URL(staff.url()).pathname === beforeInvite, `path=${new URL(staff.url()).pathname}`);
  check('18. 招待の入口を押すと、その場で出る',
    (await staff.locator('dialog.supabase-dialog[open]').count()) === 1);

  /* 19: **飼い主の画面で拡大を禁止していないこと。**
     見るのは皮膚の所見・歯・犬体図で、二本指で寄れないと読めない（WCAG 1.4.4）。
     以前 `my.html` に `user-scalable=no, maximum-scale=1.0` が付いていた。
     **配られている実物**の HTML を読む（手元のソースではなく、器が返したもの）。 */
  const myHtml = await (await fetch(`${BASE}/my`)).text();
  const viewport = (myHtml.match(/<meta\s+name="viewport"[^>]*content="([^"]*)"/i) || [])[1] || '';
  check('19. 飼い主の画面で拡大を禁止していない',
    viewport !== '' && !/user-scalable\s*=\s*no/i.test(viewport) && !/maximum-scale/i.test(viewport),
    `viewport="${viewport}"`);

  process.stdout.write(
    `\n【画面に在る入口】犬の選択・新規カルテ・初回登録QR（${listView.invites}件）・`
    + '確定 ／ **削除は管理者画面（③削除）に在る**（正UI 側の導線は docs/deferred.md #25）\n',
  );
  await staff.close();
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

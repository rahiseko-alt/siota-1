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

  /* 4b: **`/` が「本物の入口」として配られていること。**
     `1.`〜`4.` は**素の静的HTML でも全部通る**——4画面あって、段のタブが4つあって、
     最初がログイン画面、というのは器の話でしかない。実際それで抜けた:
     `handleSupabaseMode` に入口（`renderLoginPage`）を足したのに、上位の振り分けが
     `/` を先に横取りしていて**一度も呼ばれず**、本番の `/` はバックエンドの script が
     0本のまま——「Google でログイン」を押してもログインしない画面が配られ続けた
     （`F-20260902-66`）。器ではなく**中身が載っているか**を見る。
     `__ENTRY__` は worker が入口として配ったときにだけ立てる印。 */
  const entry = await top.evaluate(() => ({
    marker: '__ENTRY__' in globalThis,
    auth: [...document.querySelectorAll('script[src]')]
      .some((s) => s.getAttribute('src').includes('supabase-auth.js')),
  }));
  check('4b. `/` が本物の入口として配られている（ログインが繋がっている）',
    entry.marker === true && entry.auth === true,
    `__ENTRY__=${entry.marker} supabase-auth.js=${entry.auth}`);
  await top.close();
  /* ── ①b **入口は1つ**（マスター指示「そもそも管理者と顧客の入り口を分けるな。
        指示は１つ。入り口を1つにしろ」・`D-20260905-67`）──

     以前はログインを始められる画面が3つあった（`/` `/my` `/admin`）。
     `/edit` にも押しても何も起きない4つ目が乗っていた。
     **人が「ここから入る」と分かる場所は1つでなければならない。**
     実機の転送と、配られた HTML の中身の**両面**から見る——片面だけだと
     「転送は正しいが器にログインが載っている」（スクリプトが落ちた日に
     第2の入口が出る）を見逃す（`docs/watch.md` W-1 の型）。 */
  const doors = ['/my', `/my/pets/${FIXTURE.petX}`, '/admin', '/edit', `/edit/p/${FIXTURE.petX}`];
  const landed = [];
  for (const door of doors) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE}${door}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/$/, { timeout: 20_000 }).catch(() => { /* 下の check が落とす */ });
    await page.waitForTimeout(1_200);
    landed.push({ door, path: await page.evaluate(() => location.pathname).catch(() => '(読めず)') });
    await page.close();
  }
  /* **`landed.length === doors.length` を錨に置く。** これが無いと、5枚とも
     開けなかったとき空の配列が `every` を素通りして緑になる（`empty-pass` の型）。 */
  check('4c. 未ログインでどの画面を開いても、入口（`/`）に集まる',
    landed.length === doors.length && landed.every((s) => s.path === '/'),
    JSON.stringify(landed.filter((s) => s.path !== '/')));

  /* **配られた HTML そのものを見る。** `/edit` は `index.html` を `/` と使い回すので
     HTML には `data-entry-login` が載っている——そちらは起動時に外していることを
     `8.` が見るので、ここでは数えない（同じことを二重に判定しない）。 */
  const served = {};
  for (const door of ['/', '/my', '/admin']) {
    const html = await (await fetch(`${BASE}${door}`)).text();
    /* **コメントは数えない。** 「なぜここに在るか」を書いた注記まで数えると、
       説明を書き足しただけで赤くなる（実測: `/` が 2 件になった）。
       数えたいのは**実際に押せる口**だけ。 */
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    served[door] = (markup.match(/data-(?:entry-login|google-login)/g) || []).length;
  }
  /* **`/` が 1 であることを同じ条件に入れる。** 入れないと、取得に失敗して
     全部 0 になったときに緑になる。 */
  check('4d. 配られた HTML でログインを始められるのは入口だけ',
    served['/'] === 1 && served['/my'] === 0 && served['/admin'] === 0, JSON.stringify(served));



  /* ── ② スタッフ権限を持つ人は、どの入口から来ても作業画面に着くこと ──

     **前はここが「スタッフ兼飼い主は `/my` に留まる」だった。**
     マスター判断（2026-09-04・`D-20260904-66`）で **1ログインアカウント＝1役割**に
     決まったので、兼務者を `/my` に留めて `[data-staff-link]` を出す救済は無くした。
     振り分けは「スタッフ権限を持つか / 持たないか」の1本。

     見るのは**着く先**と、**そこから出られること**。着いたきり
     ログアウトも切り替えもできなかったのが、マスターの「ログインできない」の
     正体だった（2026-09-04・実機で再現）。 */
  const both = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await both.goto(`${BASE}/my`);
  await injectSession(both, FIXTURE.staffOwnerEmail);
  await both.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await both.waitForURL(/\/edit\/?$/, { timeout: 20_000 }).catch(() => { /* 下の check が落とす */ });
  await both.waitForSelector('.karte-card', { timeout: 20_000 }).catch(() => {});
  const bothView = await both.evaluate(() => {
    const vis = (el) => !!el && el.getClientRects().length > 0;
    return {
      path: location.pathname,
      cards: document.querySelectorAll('.karte-card').length,
      signOutVisible: vis(document.querySelector('[data-sign-out]')),
      /* 入口の道具が、作業画面に残っていないこと。押しても何も起きない
         「01 ログイン」→「Google でログイン」がここに在った。 */
      loginTab: vis(document.querySelector('[data-entry-only]')),
      loginButton: vis(document.querySelector('[data-entry-login]')),
      entryPanel: !!document.getElementById('screen-1'),
    };
  });
  check('5. スタッフ権限を持つ人は `/` から作業画面に着く',
    bothView.path === '/edit', `path=${bothView.path}`);
  check('6. 着いた作業画面に、犬の一覧が出ている（器だけ運ばない）',
    bothView.cards > 0, `card=${bothView.cards}`);
  check('7. 作業画面にログアウトが出ている（別のアカウントに切り替えられる）',
    bothView.signOutVisible === true);
  check('8. 作業画面に、押しても何も起きないログインの入口が残っていない',
    bothView.loginTab === false && bothView.loginButton === false && bothView.entryPanel === false,
    `タブ=${bothView.loginTab} ボタン=${bothView.loginButton} 画面=${bothView.entryPanel}`);

  /* **左上の HOME を押しても、画面が白紙にならないこと。**
     `screen-1` を作業画面から外したとき、HOME だけ `goToStep(1)` を呼んだままで、
     押すと**ナビ帯以外が全部消えた**（2026-09-04・サブ検証の実機で再現）。
     直す前は「押しても何も起きない死んだログイン画面」が出ていた同じボタンで、
     `01 ログイン` タブだけ塞いで**こちらを見落としていた**。 */
  const homeBtn = both.locator('.btn-home');
  const homeVisible = await homeBtn.first().isVisible().catch(() => false);
  check('8c. 作業画面に、白紙へ連れて行く HOME を出していない', homeVisible === false);
  /* 見えていなくても、呼ばれたら壊れないこと（入口を消すたびに同じ穴が開くので、
     受け皿そのものを見る）。 */
  const afterHome = await both.evaluate(() => {
    /* `App` は古典スクリプトの `const` 宣言なので `globalThis` には載らない。
       素の名前で呼ぶ（画面の `onclick` と同じ届き方）。 */
    App.goToStep(1);
    const active = document.querySelector('.screen-panel.is-active');
    return { active: active ? active.id : null,
      text: (document.querySelector('.main-wrapper') || {}).textContent?.trim().length || 0 };
  });
  check('8d. `goToStep(1)` を呼んでも、いまの画面が消えない',
    afterHome.active !== null && afterHome.text > 0, JSON.stringify(afterHome));

  /* 押したら本当に入口へ戻るか。**在るだけでは足りない。** */
  await Promise.all([
    both.waitForURL(/\/$/, { timeout: 20_000 }).catch(() => {}),
    both.click('[data-sign-out]'),
  ]);
  await both.waitForTimeout(2_000);
  check('8b. ログアウトを押すと入口（`/`）に戻る',
    new URL(both.url()).pathname === '/', `url=${new URL(both.url()).pathname}`);
  await both.close();

  /* ── ②b 未ログインでスタッフの深い URL を開いたとき、ログイン後にそこへ戻れること ──

     ブックマークや共有リンクで `/edit/p/{petId}` を直に開く人が居る。
     未ログインなら入口（`/`）へ送るが、**戻り先を覚えていないと、ログインしても
     一覧に落ちるだけ**でその犬に戻れない。
     実際そうなっていた: 送る側は戻り先を積んでいたのに、入口の
     「Google でログイン」が `post_auth_return` を `/my` で**上書きして潰していた**
     （2026-09-04・サブ検証の実機で再現）。押す前後の両方を見る。 */
  const deep = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const deepPath = `/edit/p/${FIXTURE.petX}`;
  await deep.goto(`${BASE}${deepPath}`, { waitUntil: 'domcontentloaded' });
  await deep.waitForURL(/\/$/, { timeout: 20_000 }).catch(() => {});
  await deep.waitForTimeout(2_000);
  const beforeClick = await deep.evaluate(() => ({
    path: location.pathname,
    ret: sessionStorage.getItem('post_auth_return'),
    login: !!document.querySelector('[data-entry-login]'),
  }));
  check('8e. 未ログインでスタッフの深い URL を開くと、入口へ送られる',
    beforeClick.path === '/', `path=${beforeClick.path}`);
  check('8f. そのとき、開こうとした URL を覚えている',
    beforeClick.ret === deepPath, `覚えた先=${beforeClick.ret}`);
  /* **押したあとも覚えていること。** ここが潰れていた。
     **認可画面へは行かせない**——出て行くと別のドメインになり、`sessionStorage` は
     もう読めない（実測: `null` が返る）。見たいのは「押した瞬間に消えないか」なので、
     Google へ出る所で止めて、この画面のまま中身を読む。 */
  await deep.route('**/auth/v1/authorize**', (route) => route.abort());
  await deep.locator('[data-entry-login]').click({ timeout: 10_000 }).catch(() => {});
  /* 中断した先はドメインの無い頁になり、そこでは `sessionStorage` を読むと
     `SecurityError` になる（実測）。**同じ入口へ戻ってから読む**——
     `sessionStorage` はタブとドメインの組に残っているので、これで読める。 */
  await deep.waitForTimeout(1_500);
  await deep.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await deep.waitForTimeout(1_500);
  const afterClick = await deep.evaluate(() => sessionStorage.getItem('post_auth_return'))
    .catch(() => '(読めず)');
  check('8g. ログインを押しても、戻り先が入口の既定で上書きされない',
    afterClick === deepPath, `押した後=${afterClick}`);
  await deep.close();

  /* ── ③ 飼い主だけの人に、作業画面の入口を出していないこと ── */
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await owner.goto(`${BASE}/my`);
  await injectSession(owner, FIXTURE.ownerAEmail);
  await owner.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await owner.waitForSelector('[data-sign-out]:not([hidden])', { timeout: 20_000 });
  const ownerView = await owner.evaluate(() => ({
    path: location.pathname,
    /* **もう `[data-staff-link]` は見ない。** その属性は消したので、
       「無いこと」を見ても**再導入されたときしか捕まらない**——
       いま危ないのは属性の有無ではなく、**振り分けが飼い主を `/edit` へ
       送ってしまうこと**（サブ検証 2026-09-04 の指摘）。行き先そのものを見る。 */
    editLinks: [...document.querySelectorAll('a[href^="/edit"]')]
      .filter((a) => a.getClientRects().length > 0).length,
    pets: document.querySelectorAll('.pet-card').length,
  }));
  check('9. 飼い主だけの人は、飼い主の画面に留まる', ownerView.path === '/my', `path=${ownerView.path}`);
  check('9b. 飼い主だけの人に、作業画面への入口を1つも出していない',
    ownerView.editLinks === 0, `入口=${ownerView.editLinks}件`);
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
    /* **押しても何もしないボタンが残っていないこと。**
       `＋新規カルテを作成する`（`createNewKarte`）は案内を出すだけで、
       犬を登録できるのは管理画面だけだった。マスター指示（2026-09-04）で外した。 */
    newKarte: [...document.querySelectorAll('[onclick]')]
      .some((el) => (el.getAttribute('onclick') || '').includes('createNewKarte')),
  }));
  check('11. ②一覧に犬のカードが並んでいる', listView.cards > 0, `card=${listView.cards}`);
  check('12. ②一覧に探す手段が在る', listView.search === true);
  check('13. ②一覧に、押しても何もしない「新規カルテ」ボタンが残っていない',
    listView.newKarte === false, `残っている=${listView.newKarte}`);
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
    /* **合格させた内容と食い違うことを書かない。** ここは長く「新規カルテ」を
       在るものとして並べていたが、`13.` は同じ実行で「無い」と合格させている
       ——人が読む要約が検査と正反対だった（サブ検証 2026-09-04 の指摘・`D-10`）。 */
    `\n【画面に在る入口】犬の選択・初回登録QR（${listView.invites}件）・確定`
    + ' ／ **新しい犬の登録と削除は管理者画面（② 新規／③ 削除）に在る**'
    + '（正UI 側の導線は docs/ops/plan.md #25）\n',
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

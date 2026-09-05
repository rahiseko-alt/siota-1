/**
 * verify-edit.mjs — トリマーの画面 `/edit` が、正UI を配れているか
 *
 * `docs/ops/plan.md` 4-1 の1本目。`bad-scenarios-F3` #6 の9本のうち **8本が `/edit` を開く**ので、
 * ここが通らない限りその8本は戻せない。
 *
 * なぜ塞がっていたか（`docs/deferred.md` #20）:
 *   `renderAppPage` は `/ponchi-v2.html` を読んでいたが、そのテンプレートは
 *   `6685df5`「古いUIをはがし…」で**削除されていた**。テンプレートが無ければ
 *   `502 Template Not Found` を返す実装なので、`/edit` は壊れたまま放置されていた。
 *   注入するスクリプトの置き場所も `/js/` のままで、実体は `backend/js/` へ移っていた。
 *
 * **1〜7 は「配れているか」まで。8〜 は結線（`plan.md` 4-1）を見る。**
 * `App.show(screen, data)` を正UI 側に用意し、`TrimmerSupabaseStaff.boot(App)` へ渡した。
 * ここで見るのは②一覧と⑤確認——**実データの犬が出ること**と、
 * **仮データ（`window.DUMMY`）も意匠モックの既定文も出ていないこと**（`D-10`・`#1`）。
 *
 *   npm run verify:edit
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

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.EDIT_PORT || 8789) });
let browser = null;
try {
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  /* ログインしてから開く。未ログインだと supabase-staff.js が入口（`/`）へ
     飛ばすため、「配れているか」を見る前に画面が入れ替わってしまう
     （飛ばし先は 2026-09-04 に `/my` から `/` へ変えた・`D-20260904-66`）。 */
  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);

  const res = await page.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });

  /* 1. そもそも 200 か。**ここが 502 だった。** */
  check('1. /edit が配信される', res?.status() === 200, `status=${res?.status()}`);

  const seen = await page.evaluate(() => ({
    screens: document.querySelectorAll('[id^="screen-"]').length,
    /* **どの画面が在るかを名前で見る。** 数だけだと、`/edit` から入口の
       ログイン画面（`screen-1`）を外したときに「正UI が配られていない」と
       読み違える（実際そうなった）。仕事に使う②③④が揃っているかが要件。 */
    workScreens: ['screen-2', 'screen-3', 'screen-4'].filter((id) => document.getElementById(id)).length,
    entryScreen: !!document.getElementById('screen-1'),
    /* **`globalThis.App` では見ない。** `src/js/ui.js` は古典スクリプトの
       トップレベル `const App` で、これは**グローバル字句環境**に入る——
       インライン `onclick` からは名前で届くが、`globalThis` にはぶら下がらない。
       最初ここを `globalThis.App` で見て落ち、**製品ではなく検査のほうが
       間違っていた**（`F-20260825-35` と同じ型）。裸の識別子で見る。 */
    hasApp: (() => { try { return typeof App === 'object' && App !== null; } catch { return false; } })(),
    /* 名前で届くだけでなく、**実際に呼べる**ことまで見る。 */
    appCallable: (() => { try { return typeof App.goToStep === 'function'; } catch { return false; } })(),
    onclicks: document.querySelectorAll('[onclick^="App."]').length,
    vendor: typeof globalThis.TrimmerSupabaseVendor?.createClient,
    staff: typeof globalThis.TrimmerSupabaseStaff?.boot,
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
  }));

  /* 2. 配られたのが**正UI** か。古いテンプレートには screen-N は無い。

     **数ではなく名前で見る。** ここは長く「4枚在ること」を見ていたが、
     `/edit` からは入口のログイン画面（`screen-1`）を外した——押しても何も起きない
     ログイン画面がスタッフの画面に乗っていて、押すと白紙になっていたため
     （2026-09-04・`D-20260904-66` まわりの直し）。
     要件は「仕事に使う②③④が配られていること」であって、枚数ではない。
     **判定を緩めたのではなく、見る対象を正した**——下の `2b.` で
     「入口の画面が紛れ込んでいないこと」も併せて見るので、守備範囲はむしろ広い。 */
  check('2. 正UI が配られている（仕事に使う②③④が在る）',
    seen.workScreens === 3, `作業画面=${seen.workScreens} 全体=${seen.screens}`);
  check('2b. スタッフの画面に、入口のログイン画面が紛れ込んでいない',
    seen.entryScreen === false, `screen-1=${seen.entryScreen}`);

  /* 3. 古典スクリプトの App がグローバルに居るか（`#10` で固定した繋ぎ方）。
        ここが false なら onclick 63件が死んでいる。 */
  check('3. App が名前で届く（インライン onclick の解決先）', seen.hasApp === true);
  check('3b. App のメソッドが実際に呼べる', seen.appCallable === true);
  check('3c. onclick="App.…" が実在する', seen.onclicks > 0, `${seen.onclicks}件`);

  /* 4. backend が**モジュールとして**載っているか。置き場所の読み替えができていないと落ちる。 */
  check('4. Supabase vendor が載っている', seen.vendor === 'function');
  check('5. staff モジュールが載っている（boot を持つ）', seen.staff === 'function');

  /* 6. 注入されたスクリプトが新しい置き場所を指しているか。 */
  const backendScripts = seen.scripts.filter((s) => s.startsWith('/backend/js/'));
  const oldScripts = seen.scripts.filter((s) => /^\/js\/supabase-/.test(s));
  check('6. 注入先が backend/js/ に直っている', backendScripts.length === 3 && oldScripts.length === 0,
    `backend=${backendScripts.length} / 旧=${oldScripts.length}`);

  /* 7. 読み込みで落ちていないか。`#10` の壊れ方（App が消える）はここに出る。 */
  check('7. アプリ由来のエラーが無い', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ── ここから結線（4-1）────────────────────────────────────────
     `boot(App)` → `App.show('owner', { petListFlat })` → `renderDogs()` の往復が
     実データで成立しているかを見る。**「カードが在る」では足りない**——仮データでも
     カードは出る。出ている**名前が seed の犬と一致すること**まで見る
     （`F-20260825-35`/`-36`: 期待する成功の形を直接書く）。 */
  await page.waitForSelector('.karte-card', { timeout: 15_000 });
  const list = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.karte-card__dog-name')].map((el) => el.textContent.trim()),
    breeds: [...document.querySelectorAll('.karte-card__breed')].map((el) => el.textContent.trim()),
    staff: [...document.querySelectorAll('.karte-card .js-staff')].map((el) => el.textContent.trim()),
    total: (document.getElementById('karte-total-count') || {}).textContent,
    activeScreen: (document.querySelector('.screen-panel.is-active') || {}).id,
    body: document.body.textContent,
  }));

  const seeded = ['Q', 'X', 'Y', 'Z'];
  check('8. ②一覧が実データの犬になっている',
    JSON.stringify([...list.names].sort()) === JSON.stringify(seeded),
    `出た名前=${JSON.stringify(list.names)}`);

  /* 仮データが混ざっていないこと。`window.DUMMY` の犬が1頭でも出ているなら、
     `renderDogs()` が backend の結果ではなく仮データを描いている。 */
  const dummyDogs = ['ポンチ', 'レオ', 'モカ', 'モモ'];
  const leaked = dummyDogs.filter((name) => list.names.includes(name));
  check('9. 仮データ（window.DUMMY）の犬が出ていない', leaked.length === 0, `混入=${JSON.stringify(leaked)}`);

  /* `pets` テーブルは犬種も担当も持っていない。**持っていないものは空で出す**
     ——意匠モックの「トイプードル」「塩田」が残っていたら D-10 違反。 */
  check('10. 持っていない項目（犬種・担当）が空で出ている',
    list.breeds.every((v) => v === '') && list.staff.every((v) => v === ''),
    `犬種=${JSON.stringify(list.breeds)} 担当=${JSON.stringify(list.staff)}`);

  check('11. 件数が実データと合っている', list.total === '4件', `total=${list.total}`);
  check('12. 一覧の画面（screen-2）が開いている', list.activeScreen === 'screen-2', `active=${list.activeScreen}`);

  /* ⑤確認 — 実カルテを開き、**意匠モックの既定文が消えていること**を見る。
     `renderMagazine` は器ごと差し替えるので、残っていたら結線できていない。
     残ったままだと「誰も書いていない手紙」が担当トリマーの名前で出る（`#1`）。 */
  const REPORT_URL = `${BASE}/edit/p/${FIXTURE.petX}/50000000-0000-0000-0000-0000000000a1`;
  await page.goto(REPORT_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-4 .magazine-container', { timeout: 15_000 });
  const MOCK_LETTER = '今月もとってもお利口に';
  const report = await page.evaluate((mock) => ({
    activeScreen: (document.querySelector('.screen-panel.is-active') || {}).id,
    /* **器を名指しで見る。** 最初はここを `document.body` にしていたが、それだと
       2つの別物を同時に測っていた——⑤確認の器（screen-4）に文例が残っているか、と、
       ④カルテ作成の入力欄（screen-3 の `#editor-trimmer-letter`）に文例が
       最初から入っているか。落ちたのは**後者**で、これは結線とは別の欠陥として
       `docs/deferred.md` #13 に登録した。範囲を狭めて緑にしたのではなく、
       **別々の主張に分けた**。後者はマスター指示で既定文を消したので、いまは
       17 が合否で見ている（判断待ちではない）。 */
    screen4: (document.getElementById('screen-4') || {}).textContent || '',
    letterInputExists: !!document.getElementById('editor-trimmer-letter'),
    letterInputValue: ((document.getElementById('editor-trimmer-letter') || {}).value || ''),
    /* カルテに担当メッセージが無いとき、⑤確認が**文例で埋まっていない**こと。
       `renderMagazine` は空なら手紙の節ごと隠す。 */
    letterHidden: !!(document.querySelector('#screen-4 [data-view="letter-section"]') || {}).hidden,
    letterText: ((document.querySelector('#screen-4 [data-view="staff-note"]') || {}).textContent || '').trim(),
    /* 空の写真スロットが**ページURL**を指していないか（`docs/deferred.md` #16）。 */
    pageUrlImgs: [...document.querySelectorAll('#screen-4 img')]
      .map((el) => el.getAttribute('src'))
      .filter((src) => src && /^https?:\/\/[^/]+\/(edit|my)\//.test(src)),
  }), MOCK_LETTER);
  check('13. ⑤確認の画面（screen-4）が開いている', report.activeScreen === 'screen-4', `active=${report.activeScreen}`);
  check('14. ⑤確認の器から意匠モックの既定文が消えている',
    !report.screen4.includes(MOCK_LETTER), '★ 文例が残っている（renderMagazine が器を差し替えていない）');
  check('15. 空の写真スロットがページURLを指していない',
    report.pageUrlImgs.length === 0, `混入=${JSON.stringify(report.pageUrlImgs.slice(0, 2))}`);
  /* 書かれていないものは、書かれていないと出す（`D-10`）。fixture のカルテに
     担当メッセージは無いので、手紙の節は隠れていて中身も空でなければならない。 */
  check('16. 担当メッセージが無いカルテで、文例が出ていない',
    report.letterHidden === true && report.letterText === '',
    `hidden=${report.letterHidden} text=${JSON.stringify(report.letterText)}`);

  /* **④の入力欄が空で始まること。** かつては「今月もとってもお利口に…」が最初から
     入っており、消し忘れると**誰も書いていない手紙が担当トリマーの名前で飼い主に届いた**
     （`F-20260821-14`・`docs/deferred.md` #13）。マスター指示で消したので、**合否で見る**。
     出力するだけにしておくと、また静かに戻っても誰も止められない。 */
  /* **入力欄が在ることも一緒に見る。** `|| {}` で受けたまま中身だけ比べていると、
     欄の名前が変わった日に「空だから合格」になる（偽-2）。 */
  check('17. ④の入力欄が空で始まる（見本の文が入っていない）',
    report.letterInputExists === true && report.letterInputValue === '',
    report.letterInputExists
      ? `★ 既定文が入っている: ${JSON.stringify(report.letterInputValue.slice(0, 30))}`
      : '★ #editor-trimmer-letter が無い（欄ごと消えた・名前が変わった）');
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('1〜7 は /edit が配れているか。8〜17 は結線（②一覧・⑤確認）と、見本の文が無いこと。④保存・確定はまだ見ていない。\n');
process.exit(passed === results.length ? 0 : 1);

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

  /* ログインしてから開く。未ログインだと supabase-auth.js が /my へ飛ばすため、
     「配れているか」を見る前に画面が入れ替わってしまう。 */
  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);

  const res = await page.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });

  /* 1. そもそも 200 か。**ここが 502 だった。** */
  check('1. /edit が配信される', res?.status() === 200, `status=${res?.status()}`);

  const seen = await page.evaluate(() => ({
    screens: document.querySelectorAll('[id^="screen-"]').length,
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

  /* 2. 配られたのが**正UI** か。古いテンプレートには screen-N は無い。 */
  check('2. 正UI が配られている（screen-N が在る）', seen.screens === 4, `screen=${seen.screens}`);

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
       `docs/deferred.md` #13 に登録済み・**マスター判断待ち**である
       （`src/index.html:1953` と `:2076` の既定文2か所）。
       範囲を狭めて緑にしたのではなく、**別々の主張に分けた**。残っているほうは
       下の `letterInput` で件数を出し、隠さない。 */
    screen4: (document.getElementById('screen-4') || {}).textContent || '',
    letterInput: ((document.getElementById('editor-trimmer-letter') || {}).value || '').includes(mock),
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

  /* **隠さない。** ④カルテ作成の入力欄には、まだ文例が最初から入っている。
     結線とは別の欠陥で `docs/deferred.md` #13（マスター判断待ち）。
     ④保存・確定を結線すると、この文が**そのまま飼い主に届く**——`F-20260821-14` の再来。 */
  process.stdout.write(
    `\n【残っているもの・${report.letterInput ? 1 : 0}件】④の入力欄 #editor-trimmer-letter の既定文: `
    + `${report.letterInput ? '在る（docs/deferred.md #13・マスター判断待ち）' : '無い'}\n`
    + '  ④保存・確定を結線する前に、マスターの判断が要る。\n',
  );
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('1〜7 は /edit が配れているか。8〜16 は結線（②一覧・⑤確認）。④保存・確定はまだ見ていない。\n');
process.exit(passed === results.length ? 0 : 1);

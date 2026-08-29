/**
 * walk-human.mjs — AGENTS.md の D-14 を実行するための道具
 *
 * 見るのは2つだけ:
 *   1. 正解の手順で最後まで到達できるか
 *   2. 操作を間違えたとき、2タッチ以内にやりたかった操作を完了できるか
 *
 * **このスクリプトは判定しない。** iPhone と同じ大きさ・指のタッチで画面を操作し、
 * 1タッチごとにスクリーンショットを撮って番号を振るだけ。合否は絵を見て人間が決める。
 * コードを読んで判定してはいけない（D-14）。
 *
 * ── 2026-08-26 の変更（`plan.md` 4-2）─────────────────────────────
 * **以前ここは仮データを撮っていた。** 配る器が `serve-ui.mjs`（静的配信のみ）で、
 * バックエンドを呼ばなかったため、写っていた犬は `window.DUMMY` の4頭だった。
 * つまり **D-14 の2問に「実データで」答えた絵は、いままで1枚も無かった**
 * ——結線（4-1）が終わったあとも、絵だけは F2 のままだった。
 *
 * いまは `startLocalWorker()` で**実際の Worker + ローカル Supabase**に向ける。
 * **仮データへ黙って落ちない**: Supabase が起動していなければ
 * `ensureLocalSupabaseRunning()` がその場で投げて止まる。撮れなかったことを
 * 「撮れた」と見せないためで、これは `#6`（見る検査が1本も無い）と同じ型の穴を塞ぐもの。
 *
 * **ログインだけは注入する。** Google OAuth は自動化できないので、実データの
 * セッションを入れて「ログインした直後」の状態を作る。ログインを省いたのではなく、
 * **人の指では押せない1枚だけを機械が代わりに押している**。写真の見出しにもそう書く。
 *
 * 対象は結線後の実データ。ローカル Supabase（`npx supabase start`）が要る。
 * **手元に Docker が無い環境では撮れない**ので、CI が撮って成果物として上げる
 * （`.github/workflows/ci.yml` の「人が使えるかの写真を撮る」）。
 *
 * 使い方:
 *   npm run walk            正解の手順
 *   npm run walk mistakes   操作を間違えたとき
 *   スクショは .human/{correct,mistakes}/ に出る（git 追跡しない）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices } from 'playwright';
import { startLocalWorker, injectSession, FIXTURE } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] === 'mistakes' ? 'mistakes' : 'correct';
const SHOTS = path.join(ROOT, '.human', MODE);
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

/* 撮るのは `FIXTURE.petX`（owner-a の犬・一覧での表示名は `X`）。**どの犬を撮ったか
   決まっていないと、⑥で「その犬の飼い主」を開けない**——飼い主が違えば、届いた
   ものを見ているのか他人のカルテを見ているのか、絵からは区別がつかない。 */
const DOG = 'X';

const PORT = Number(process.env.WALK_PORT || (MODE === 'mistakes' ? 8802 : 8801));
const { base: BASE, stop } = await startLocalWorker({ port: PORT });

let n = 0;
const log = [];
let browser;
try {
  /* playwright が同梱を期待するビルド番号と、環境に在るブラウザが食い違うことがある
     （`Executable doesn't exist at .../chromium_headless_shell-1217/...`）。
     マスターの PC では一致していても、**新しいコンテナでは一致しない**——
     そして D-14 の合否はこのスクリプトが撮る絵だけで決まるので、
     ここで落ちると「合格とも不合格とも言えない」状態になる（F-20260825-33 の型）。

     だから: ①明示の指定があればそれ ②既定で起動できればそれ
             ③駄目なら**在るものを探して**使う ④無ければ、何をすればよいかを言って落ちる。
     ③で使ったときは必ず声に出す。黙って別のブラウザを使わない。 */
  browser = await launchChromium();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { await d.accept(); });

  /** 1コマ撮る。what = 直前にした操作を人間の言葉で。 */
  async function shot(target, what) {
    n += 1;
    await target.waitForTimeout(900);
    const safe = what.replace(/[^\wぁ-んァ-ヶ一-龠ー]/g, '_').slice(0, 44);
    await target.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, '0')}-${safe}.png`), fullPage: true });
    log.push(`${String(n).padStart(2, '0')}  ${what}`);
    process.stdout.write(`${String(n).padStart(2, '0')}  ${what}\n`);
  }

  /** カルテに実際に書く。**書けたことを確かめてから先へ進む。**
      以前はここが `[contenteditable="true"]`（現 UI に 0 件）を探し、失敗を
      `.catch(() => {})` で握りつぶしていた。そのため「カルテを書いた」の写真は
      **何も書かれていない画面**だった（F1後のF2実測で発覚・`docs/failures.md` F-20260825-32）。
      握りつぶさず、入った値を読み返して照合する——入らなければここで止める。 */
  async function writeKarte(text) {
    const note = page.locator('#editor-trimmer-letter');
    await note.waitFor({ state: 'visible', timeout: 30000 });
    await note.scrollIntoViewIfNeeded();
    await note.fill(text);
    const got = await note.inputValue();
    if (got !== text) {
      throw new Error(`カルテに書けていない: 入れた「${text}」/ 実際「${got}」`);
    }
  }

  /** 新しい欄（マスター指示 2026-08-29・C-1〜C-12）を記入する。**書けたことを確かめて
      から先へ進む**——`writeKarte` と同じ理由。空のまま撮ると、絵にその項目が
      写らず、絵だけで判定するマスターにはその項目が存在しないのと同じになる
      （受入条件 #7）。コースは確定の必須条件でもある（C-9）。 */
  async function fillNewFields() {
    const result = await page.evaluate(() => {
      const missing = [];
      const course = document.querySelector('[data-field="course"]');
      if (!course) missing.push('course');
      else { course.value = 'トリミングコース'; course.dispatchEvent(new Event('change', { bubbles: true })); }

      const date = document.getElementById('input-visit-date');
      if (!date) missing.push('visit-date');
      else { date.value = '2026-08-29'; date.dispatchEvent(new Event('input', { bubbles: true })); }

      const bestWeight = document.getElementById('input-best-weight');
      if (!bestWeight) missing.push('best-weight');
      else { bestWeight.value = '3.2'; bestWeight.dispatchEvent(new Event('input', { bubbles: true })); }

      const bcsBtn = [...document.querySelectorAll('#bcs-stepper-wrap .stepper-btn')]
        .find((el) => (el.getAttribute('onclick') || '').includes("'bcs', 3"));
      if (!bcsBtn) missing.push('bcs'); else bcsBtn.click();

      for (const [side, value] of [['front', 2], ['rear', 3]]) {
        const group = document.querySelector(`[data-group="nail"][data-side="${side}"]`);
        const btn = group && [...group.querySelectorAll('.stepper-btn')]
          .find((el) => (el.querySelector('.val') || {}).textContent === String(value));
        if (!btn) missing.push(`nail-${side}`); else btn.click();
      }

      for (const [side, value] of [['right', 5], ['left', 2]]) {
        const btn = document.querySelector(`[data-ear="${side}"] .teeth-pill-btn[data-level="${value}"]`);
        if (!btn) missing.push(`ear-${side}`); else btn.click();
      }

      return { missing };
    });
    if (result.missing.length > 0) {
      throw new Error(`新しい欄が画面に無い: ${JSON.stringify(result.missing)}`);
    }
  }

  /** 見えている文字をタップする（人間と同じ探し方）。
      同じ文字のボタンが複数あるときは、見えているものを選ぶ。 */
  async function tapText(text) {
    const all = page.locator(`button:has-text("${text}"), a:has-text("${text}")`);
    await all.first().waitFor({ state: 'attached', timeout: 30000 });
    const count = await all.count();
    for (let i = 0; i < count; i += 1) {
      const el = all.nth(i);
      if (!(await el.isVisible())) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.tap();
      return;
    }
    throw new Error(`「${text}」が見えていない（${count}個ある）`);
  }

  /** 一覧に**仮データが混ざっていない**ことを、撮る前に確かめる。
      ここが `plan.md` 4-2 の要そのもの——絵が実データでなければ、D-14 の2問に
      答えたことにならない。器を静的配信に戻せばこの検査が落ちるので、
      「いつのまにか仮データを撮っていた」に戻れない。 */
  async function assertRealData() {
    const cards = page.locator('.karte-card__dog-name');
    try {
      await cards.first().waitFor({ state: 'visible', timeout: 30000 });
    } catch (error) {
      /* **待ちきれなかったときに、何が起きたかを言う。** ここは1度落ちている
         （run `32937484313`）。そのときの出力は「`.karte-card__dog-name` が
         見えない」だけで、**ログイン画面に跳ね返されたのか、単に遅かったのか**が
         分からなかった。同じジョブの `mistakes` は同じ手順で成功していたので
         一過性だが、原因を言えない出力のままにすると次に同じことが起きたときも
         また分からない。いま居る URL と画面の見出しを出す。 */
      const where = page.url();
      const heading = await page.evaluate(
        () => ((document.querySelector('h1, h2') || {}).textContent || '').trim(),
      ).catch(() => '(読めない)');
      throw new Error(
        `②一覧が出なかった。いま居るのは ${where}（見出し: "${heading}"）。`
        + 'ログイン画面へ跳ね返されているなら、セッションの注入が効いていない。'
        + `\n${error.message}`,
      );
    }
    const names = (await cards.allTextContents()).map((t) => t.trim());
    const dummies = ['ポンチ', 'レオ', 'モカ', 'モモ'].filter((d) => names.includes(d));
    if (dummies.length > 0) {
      throw new Error(`仮データを撮ろうとしている: ${JSON.stringify(dummies)} が一覧に居る`);
    }
    process.stdout.write(`実データの犬 ${names.length}頭を確認: ${JSON.stringify(names)}\n`);
  }

  /** 一覧から犬を名前で選ぶ。**日本語をセレクタに連結しない**（D-9）ので、
      名札を全部読んで中身で選ぶ。見つからなければ止める——一覧に居ない犬を
      選んだつもりで先へ進むと、以降の絵が全部別の犬のものになる。 */
  async function tapDog(name) {
    const cards = page.locator('.karte-card__dog-name');
    await cards.first().waitFor({ state: 'visible', timeout: 30000 });
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      const el = cards.nth(i);
      if ((await el.textContent() || '').trim() !== name) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      /* **名札が描かれている座標を指で叩く。** `el.tap()` だと Playwright が
         「その要素が最前面か」を確かめに行き、名札は行の中の `<span>` なので
         親（`.karte-card__avatar` や grid）に阻まれて永久に再試行する。
         人の指は要素の同一性など見ておらず、**見えている場所に落ちるだけ**で、
         押されたことはカードへ伝わる。D-14 が見たいのはその挙動なので、
         名札の中心へ実際のタッチを落とす。 */
      const box = await el.boundingBox();
      if (!box) throw new Error(`「${name}」の位置が取れない`);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      /* **押した結果、本当に移ったことを確かめる。** 移っていない画面を
         「選んだ」の写真として残すと、絵だけで判定する D-14 が嘘を掴む
         （`F-20260825-32` と同じ型）。 */
      await page.waitForSelector('#screen-3.is-active', { timeout: 15000 });
      return;
    }
    const seen = await cards.allTextContents();
    throw new Error(`一覧に「${name}」が居ない: ${JSON.stringify(seen)}`);
  }

  if (MODE === 'correct') {
    /* ── ①〜⑥ を、指定の順に ── */
    await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
    await shot(page, '01 URLを開いた（まだログインしていない）');

    await injectSession(page, FIXTURE.staffEmail);
    await page.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
    await assertRealData();
    await shot(page, '02 ログインした（Google の画面だけは機械が代行）');

    await tapDog(DOG);
    await shot(page, `03 犬の名前を選んだ（${DOG}）`);

    await fillNewFields();
    await shot(page, '03b コース・ベスト体重・BCS・爪（前足/後ろ足）・耳（6段階）を記入した');

    await writeKarte('今日はおとなしくしていました。');
    await shot(page, '04 カルテを書いた');

    await tapText('確定してお客様カルテ');
    await shot(page, '05 確定した（トリマーの確認）');

    /* ⑥は**飼い主が自分の端末で開いたもの**。以前は⑤と同じ画面を1枚で兼ねていたが、
       結線後は別物である——⑤はトリマーの画面、⑥は飼い主に**実際に届いたもの**。
       ここが同じ絵で済むなら `D-12` を絵で確かめる意味が無い。 */
    const ownerCtx = await browser.newContext({ ...devices['iPhone 13'] });
    const ownerPage = await ownerCtx.newPage();
    ownerPage.on('dialog', async (d) => { await d.accept(); });
    await ownerPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
    await injectSession(ownerPage, FIXTURE.ownerAEmail);
    await ownerPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
    await shot(ownerPage, '06 飼い主が自分の端末で開いた（一覧）');

    const ownerCards = ownerPage.locator('[data-testid="pet-card"]');
    await ownerCards.first().waitFor({ state: 'visible', timeout: 30000 });
    const ownerNames = (await ownerCards.allTextContents()).map((t) => t.trim());
    const idx = ownerNames.indexOf(DOG);
    if (idx < 0) throw new Error(`飼い主の一覧に「${DOG}」が居ない: ${JSON.stringify(ownerNames)}`);
    /* **先に画面内へ送ってから座標を取る。** 送らずに取ると、一覧が長いときに
       箱の座標が画面の外を指し、指はどこか別の場所に落ちる。最初これを忘れて、
       **一覧のままの絵を「カルテを開いた」として残していた**。 */
    await ownerCards.nth(idx).scrollIntoViewIfNeeded().catch(() => {});
    const ownerBox = await ownerCards.nth(idx).boundingBox();
    if (!ownerBox) throw new Error(`飼い主の一覧の「${DOG}」の位置が取れない`);
    /* 名札と同じ理由で、見えている場所へ実際のタッチを落とす（上の `tapDog` 参照）。 */
    await ownerPage.touchscreen.tap(ownerBox.x + ownerBox.width / 2, ownerBox.y + ownerBox.height / 2);
    await ownerPage.waitForURL(/\/my\/pets\/[^/]+$/, { timeout: 15000 });
    await shot(ownerPage, `07 飼い主が自分の犬（${DOG}）を開いた`);

    /* 犬の頁はカルテの**一覧**。届いたカルテそのものは、もう1タッチ先に在る。
       ここまで撮らないと「届いたか」を絵で見たことにならない（`D-12`）。 */
    const reportLinks = ownerPage.locator('.report-list a');
    await reportLinks.first().waitFor({ state: 'visible', timeout: 15000 });
    await reportLinks.first().scrollIntoViewIfNeeded().catch(() => {});
    const repBox = await reportLinks.first().boundingBox();
    if (!repBox) throw new Error('カルテの行の位置が取れない');
    await ownerPage.touchscreen.tap(repBox.x + repBox.width / 2, repBox.y + repBox.height / 2);
    await ownerPage.waitForURL(/\/my\/pets\/[^/]+\/reports\/[^/]+$/, { timeout: 15000 });
    await shot(ownerPage, '08 飼い主に届いたカルテ');
  } else {
    /* ── 間違えたとき、何タッチで戻れるか ── */
    await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
    await injectSession(page, FIXTURE.staffEmail);
    await page.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });

    await assertRealData();

    /* 間違い1: 違う犬を選んでしまった → 正しい犬に着くまで */
    await tapDog('Y');
    await shot(page, 'M1-0 違う犬（Y）を選んでしまった');
    /* 画面の中に一覧へ戻るボタンが無いので、上のタブを使う。 */
    await tapText('02 カルテ検索');
    await shot(page, 'M1-1 タッチ1 一覧へ');
    await tapDog(DOG);
    await shot(page, `M1-2 タッチ2 正しい犬（${DOG}）`);

    /* 間違い2: 記入中に一覧へ戻ってしまった → 書きかけは残るか */
    await writeKarte('書きかけの所見です');
    await shot(page, 'M2-0 記入中');
    await tapText('02 カルテ検索');
    await shot(page, 'M2-1 一覧へ戻ってしまった');
    await tapDog(DOG);
    await shot(page, 'M2-2 タッチ1 同じ犬に戻った 書きかけは残っているか');

    /* 間違い3: 顧客ページまで進んだが直したい → 記入に戻るまで */
    /* コース未選択のままだと確定が `alert()` で止まる（マスター指示 2026-08-29・C-9）。
       ここで見たいのは「進んでから戻る」動線であって新しい欄の絵ではないので、
       画面には残さず確定を通すためだけに選ぶ。 */
    await page.evaluate(() => {
      const course = document.querySelector('[data-field="course"]');
      if (course) { course.value = 'トリミングコース'; course.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await tapText('確定してお客様カルテ');
    await shot(page, 'M3-0 顧客ページまで進んだ');
    await tapText('03 カルテ作成');
    await shot(page, 'M3-1 タッチ1 カルテ作成へ戻った');
  }
} finally {
  fs.writeFileSync(path.join(SHOTS, '_操作ログ.txt'), log.join('\n'));
  if (browser) await browser.close();
  await stop();
}

process.stdout.write(`\nスクショ: ${SHOTS}\n`);

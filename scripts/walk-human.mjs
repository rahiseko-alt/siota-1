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
 * 対象は **UI だけ**。バックエンドは呼ばない（配る器は `serve-ui.mjs`＝静的配信のみ）。
 *
 * 使い方:
 *   npm run walk            正解の手順
 *   npm run walk mistakes   操作を間違えたとき
 *   スクショは .human/{correct,mistakes}/ に出る（git 追跡しない）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startUiServer } from './serve-ui.mjs';


/** playwright が入っているブラウザ置き場から、使える chromium の実行ファイルを探す。
    複数あるときはビルド番号の大きいものを選ぶ。見つからなければ null。 */
function findInstalledChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),          /* Linux 既定 */
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), /* macOS 既定 */
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),  /* Windows 既定 */
  ].filter((r) => r && fs.existsSync(r));

  /* 実行ファイルの置き場所は OS で違う。chrome より headless_shell を先に見ない
     ——絵を撮るのが目的なので、通常のブラウザが在るならそちらを使う。 */
  const CANDIDATES = [
    ['chrome-linux', 'chrome'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-linux', 'headless_shell'],
  ];

  const found = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^chromium(_headless_shell)?-(\d+)$/.test(entry.name)) continue;
      const rev = Number(entry.name.match(/-(\d+)$/)[1]);
      for (const parts of CANDIDATES) {
        const exe = path.join(root, entry.name, ...parts);
        if (fs.existsSync(exe)) { found.push({ rev, exe }); break; }
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found.length > 0 ? found[0].exe : null;
}

/** 絵を撮るためのブラウザを起動する。どれを使ったかは必ず出力する。 */
async function launchChromium() {
  if (process.env.WALK_CHROMIUM) {
    process.stdout.write(`[walk] WALK_CHROMIUM の指定を使う: ${process.env.WALK_CHROMIUM}\n`);
    return chromium.launch({ executablePath: process.env.WALK_CHROMIUM });
  }
  try {
    return await chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist/.test(String(e))) throw e;
    const exe = findInstalledChromium();
    if (!exe) {
      process.stderr.write(
        `\n[walk] 絵を撮るブラウザが見つかりません。**アプリの不具合ではありません。**\n`
        + `  playwright が期待する版が、この環境に入っていません。次のどちらかで直せます:\n`
        + `    1. npx playwright install chromium\n`
        + `    2. WALK_CHROMIUM=/実行ファイルへのパス npm run walk\n`
        + `  探した場所: ${[process.env.PLAYWRIGHT_BROWSERS_PATH, '~/.cache/ms-playwright'].filter(Boolean).join(' / ')}\n\n`,
      );
      throw e;
    }
    /* 黙って別のブラウザに差し替えない。使ったものを必ず言う。 */
    process.stdout.write(
      `[walk] playwright が期待する版が無いので、この環境に在るものを使う: ${exe}\n`
      + `       （絵の判定には十分だが、マスターの PC とビルド番号が違うことは意識すること）\n`,
    );
    return chromium.launch({ executablePath: exe });
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] === 'mistakes' ? 'mistakes' : 'correct';
const SHOTS = path.join(ROOT, '.human', MODE);
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const PORT = Number(process.env.UI_PORT || (MODE === 'mistakes' ? 8802 : 8801));
const { base: BASE, stop } = await startUiServer(PORT);

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
  async function shot(what) {
    n += 1;
    await page.waitForTimeout(900);
    const safe = what.replace(/[^\wぁ-んァ-ヶ一-龠ー]/g, '_').slice(0, 44);
    await page.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, '0')}-${safe}.png`), fullPage: true });
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

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  if (MODE === 'correct') {
    /* ── ①〜⑥ を、指定の順に ── */
    await shot('01 URLを開いた');

    await tapText('Google でログイン');
    await shot('02 ログインした');

    await page.locator('.karte-card').first().tap();
    await shot('03 犬の名前を選んだ');

    await writeKarte('今日はおとなしくしていました。');
    await shot('04 カルテを書いた');

    await tapText('確定してお客様カルテ');
    /* ⑤確認 と ⑥顧客ページ は**同じ screen-4**（画面は4枚しかない・意匠モックどおり）。
       別々に着いたように見せないため、1コマで「同一画面」と明記する。
       絵だけで合否を決めるので、終点の呼び方が曖昧だと判定できない（F2 バッドシナリオ #5）。 */
    await shot('05-06 確認と顧客ページ（同一画面・screen-4）');
  } else {
    /* ── 間違えたとき、何タッチで戻れるか ── */
    await tapText('Google でログイン');

    /* 間違い1: 違う犬を選んでしまった → 正しい犬に着くまで */
    await page.locator('.karte-card').nth(1).tap();
    await shot('M1-0 違う犬を選んでしまった');
    /* 画面の中に一覧へ戻るボタンが無いので、上のタブを使う。 */
    await tapText('02 カルテ検索');
    await shot('M1-1 タッチ1 一覧へ');
    await page.locator('.karte-card').first().tap();
    await shot('M1-2 タッチ2 正しい犬');

    /* 間違い2: 記入中に一覧へ戻ってしまった → 書きかけは残るか */
    await writeKarte('書きかけの所見です');
    await shot('M2-0 記入中');
    await tapText('02 カルテ検索');
    await shot('M2-1 一覧へ戻ってしまった');
    await page.locator('.karte-card').first().tap();
    await shot('M2-2 タッチ1 同じ犬に戻った 書きかけは残っているか');

    /* 間違い3: 顧客ページまで進んだが直したい → 記入に戻るまで */
    await tapText('確定してお客様カルテ');
    await shot('M3-0 顧客ページまで進んだ');
    await tapText('03 カルテ作成');
    await shot('M3-1 タッチ1 カルテ作成へ戻った');
  }
} finally {
  fs.writeFileSync(path.join(SHOTS, '_操作ログ.txt'), log.join('\n'));
  if (browser) await browser.close();
  await stop();
}

process.stdout.write(`\nスクショ: ${SHOTS}\n`);

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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startUiServer } from './serve-ui.mjs';

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
  browser = await chromium.launch();
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

    const note = page.locator('[contenteditable="true"]').first();
    await note.scrollIntoViewIfNeeded().catch(() => {});
    await note.tap().catch(() => {});
    await page.keyboard.type('今日はおとなしくしていました。');
    await shot('04 カルテを書いた');

    await tapText('確定してお客様カルテ');
    await shot('05 確認・顧客ページ');
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
    const note = page.locator('[contenteditable="true"]').first();
    await note.scrollIntoViewIfNeeded().catch(() => {});
    await note.tap().catch(() => {});
    await page.keyboard.type('書きかけの所見です');
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

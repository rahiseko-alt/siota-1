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
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run walk           # 正解の手順
 *          npm run walk mistakes  # 操作を間違えたとき
 *   スクショは .human/{correct,mistakes}/ に出る（git 追跡しない）
 *
 * ログイン（Google 認証）だけは機械では踏めないので、セッションを注入して先へ進む。
 * ログイン画面そのものの確認は人間が実機でやること。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startLocalWorker, injectSession, FIXTURE } from './lib/local-stack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] === 'mistakes' ? 'mistakes' : 'correct';
const SHOTS = path.join(ROOT, '.human', MODE);
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

/* スタッフかつ飼い主。本番のマスター自身と同じ形（D-20260823-06）。 */
const WHO = FIXTURE.staffOwnerEmail;

let n = 0;
const log = [];

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8796) });
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { await d.accept(); });

  /** 1コマ撮る。what = 直前にした操作を人間の言葉で。 */
  async function shot(what) {
    n += 1;
    await page.waitForTimeout(1500);
    const safe = what.replace(/[^\wぁ-んァ-ヶ一-龠ー]/g, '_').slice(0, 44);
    await page.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, '0')}-${safe}.png`), fullPage: true });
    log.push(`${String(n).padStart(2, '0')}  ${what}`);
    process.stdout.write(`${String(n).padStart(2, '0')}  ${what}\n`);
  }
  /** 見えている文字をタップする（人間と同じ探し方）。 */
  async function tapText(text, nth = 0) {
    const el = page.getByText(text, { exact: false }).nth(nth);
    await el.waitFor({ state: 'visible', timeout: 60000 });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.tap();
  }
  /** 画面が出来上がるまで待つ。 */
  async function settle(sel, timeout = 60000) {
    await page.waitForSelector(sel, { state: 'visible', timeout }).catch(() => {});
  }
  async function login() {
    await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
    await injectSession(page, WHO);
    /* 保存が済んでから起動をやり直させる。goto ではなく reload
       （verify-screens.mjs と同じ形。goto だと注入前の状態で描き直すことがある）。 */
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle('.pet-card');
  }

  if (MODE === 'correct') {
    /* ── 正解の手順を、最初から最後まで ── */
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await shot('01 URLを開いた');

    await login();
    await shot('02 ログインが済んだ直後');

    await tapText('カルテを書く');
    await settle('.owner-pet-item');
    await shot('03 カルテを書く を押した');

    await page.locator('.owner-pet-item').first().tap();
    await settle('.archive-new-btn');
    await shot('04 犬を選んだ');

    await tapText('新規カルテ作成');
    await settle('#heroDateInput');
    await shot('05 新規カルテ作成 を押した');

    const note = page.locator('[data-field="staff-note"]');
    await note.scrollIntoViewIfNeeded();
    await note.tap();
    await page.keyboard.type('今日はおとなしくしていました。');
    await shot('06 担当からの一言を書いた');

    /* 提出は3段（確定 → プレビューを確認 → 確定（公開））。
       そのたびに一番下まで降りることになるので、降りた状態も撮る。 */
    const commit = page.locator('#ponchi-commit-ok');
    await commit.scrollIntoViewIfNeeded();
    await shot('07 確定ボタンまでスクロールした');
    await commit.tap();
    await shot('08 確定 を押した');

    await tapText('プレビューを確認');
    await settle('#screen-magazine .magazine-container');
    await shot('09 プレビューを確認 を押した');

    const pub = page.locator('#screen-magazine button').filter({ hasText: /公開/ }).first();
    await pub.waitFor({ state: 'visible', timeout: 60000 });
    await pub.scrollIntoViewIfNeeded().catch(() => {});
    await shot('10 公開ボタンまでスクロールした');
    await pub.tap();
    await page.waitForTimeout(8000);
    await shot('11 公開した');
  } else {
    /* ── 操作を間違えたとき、何タッチで戻れるか ── */
    await login();
    await page.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
    await settle('.owner-pet-item');

    /* 間違い1: 違う犬を開いてしまった */
    await page.locator('.owner-pet-item').nth(1).tap();
    await settle('.archive-new-btn');
    await shot('M1-0 違う犬を開いてしまった');
    await tapText('戻る');
    await settle('.owner-pet-item');
    await shot('M1-1 タッチ1 戻る');
    await page.locator('.owner-pet-item').nth(0).tap();
    await settle('.archive-new-btn');
    await shot('M1-2 タッチ2 正しい犬に着いた');

    /* 間違い2: 記入中に「戻る」を押してしまった → 書きかけは戻るか */
    await tapText('新規カルテ作成');
    await settle('#heroDateInput');
    const note = page.locator('[data-field="staff-note"]');
    await note.scrollIntoViewIfNeeded();
    await note.tap();
    await page.keyboard.type('書きかけの所見です');
    await page.waitForTimeout(2500);   /* 下書きの自動保存を待つ（1.2秒の間引き） */
    await shot('M2-0 記入中');
    await page.locator('#reportBackBtn').scrollIntoViewIfNeeded();
    await page.locator('#reportBackBtn').tap();
    await settle('.archive-new-btn');
    await shot('M2-1 戻るを押してしまった');
    await tapText('新規カルテ作成');
    await settle('#heroDateInput');
    await shot('M2-2 タッチ1 新規カルテ作成 書きかけは戻ったか');

    /* 間違い3: 確定まで行ったが直したい */
    const commit = page.locator('#ponchi-commit-ok');
    await commit.scrollIntoViewIfNeeded();
    await commit.tap();
    await shot('M3-0 確定を押した');
    await tapText('やり直す');
    await shot('M3-1 タッチ1 やり直す');

    /* 間違い4: 公開してしまった後に直したい ← ここが一番怖い。
       公開まで通してから、確定済みカルテを開く。 */
    await commit.scrollIntoViewIfNeeded().catch(() => {});
    await commit.tap().catch(() => {});
    await tapText('プレビューを確認');
    await settle('#screen-magazine .magazine-container');
    const pub = page.locator('#screen-magazine button').filter({ hasText: /公開/ }).first();
    await pub.scrollIntoViewIfNeeded().catch(() => {});
    await pub.tap();
    await page.waitForTimeout(8000);
    await shot('M4-0 公開してしまった');
    await page.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
    await settle('.owner-pet-item');
    await page.locator('.owner-pet-item').nth(0).tap();
    await settle('.archive-new-btn');
    await shot('M4-1 犬のカルテ一覧');
    const karte = page.locator('.archive-list button').filter({ hasText: /20\d\d/ }).first();
    await karte.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    await karte.tap().catch(() => {});
    await page.waitForTimeout(5000);
    await shot('M4-2 タッチ1 公開済みカルテを開いた 直せるか');
  }
} finally {
  fs.writeFileSync(path.join(SHOTS, '_操作ログ.txt'), log.join('\n'));
  if (browser) await browser.close();
  await stop();
}

process.stdout.write(`\nスクショ: ${SHOTS}\n`);
process.stdout.write('絵を見て、この2点だけを判定すること（D-14）:\n');
process.stdout.write('  1. 正解の手順で最後まで到達できるか\n');
process.stdout.write('  2. 操作を間違えたとき、2タッチ以内にやりたかった操作を完了できるか\n');

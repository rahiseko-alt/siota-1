/**
 * verify-screens.mjs — 全画面を実際に開いて、「そこに在るべきものが在るか」を見る
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:screens
 *   スクショは scripts/../.screens/ に残る（--shots で保存先を変えられる）
 *
 * EXIT 0 = どの画面からも次へ進める / EXIT 1 = どこかで行き止まる
 *
 * **なぜこの検査が要るか**
 *   他の verify:* は「この操作をすると、この結果になる」を見る。決め打ちの手順を
 *   なぞるので、**手順の外にあるもの——画面に何が乗っているか、そこから他のどこへ
 *   行けるか——は一切見ていない**。実際それで2回やられた:
 *
 *     1. 招待QRボタンが F2 で画面から消えた。機能は生きていたが、どこからも押せなかった
 *        （D-20260824-29）。検査は fixture を使って招待を迂回していたので気づけなかった
 *     2. スタッフかつ飼い主のアカウントが `/my` に留まるのに、`/` にも `/my` にも
 *        `/edit` へのリンクが1つも無く、**トリマーが自分の作業画面へ行けなかった**。
 *        しかも fixture にその組み合わせのアカウントが無かったので、検査5本が素通りした
 *
 *   どちらも「押すべきボタンが画面に無い」。それは1画面ずつ開いて中身を数えれば
 *   分かることで、実際マスターに「全ページのスクショを撮ればわかる事だろう」と
 *   指摘されて初めて見つかった。この検査はそれを機械にやらせる。
 *
 *   見るのは**在るか無いか**だけ。値が正しいかは verify:roundtrip の領分。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  startLocalWorker, injectSession, openStaffPage, FIXTURE,
} from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SCREEN_SHOTS || path.join(ROOT, '.screens');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

/** その画面に「実際に見えているもの」を数え、スクショを残す。 */
async function survey(page, name) {
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const label = (el) => (el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 30);
    return {
      pathname: location.pathname,
      buttons: [...document.querySelectorAll('button, a[href], [role="button"]')].filter(visible).map(label),
      inputs: [...document.querySelectorAll('input, textarea, select')].filter(visible)
        .map((el) => el.placeholder || el.getAttribute('aria-label') || el.type || ''),
      editables: [...document.querySelectorAll('[contenteditable="true"]')].filter(visible).length,
    };
  });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  process.stdout.write(`\n--- ${name} (${info.pathname}) ---\n`);
  process.stdout.write(`  押せる: ${info.buttons.join(' / ') || '(なし)'}\n`);
  process.stdout.write(`  入力欄: ${info.inputs.join(' / ') || '(なし)'}\n`);
  return info;
}

/** 画面に、指定した文字を含む押せるものが在るか。 */
function has(info, text) {
  return info.buttons.some((b) => b.includes(text));
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8793) });
let browser;
try {
  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

  // ── ① 未ログインのトップ ──
  const anon = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await anon.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const top = await survey(anon, '01-top-未ログイン');
  check('① トップ: ログインへ進める', has(top, 'ログイン'));

  await anon.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  const myAnon = await survey(anon, '02-my-未ログイン');
  check('② マイカルテ(未ログイン): ログインボタンが在る', has(myAnon, 'ログイン'));
  check('② マイカルテ(未ログイン): 中身が漏れていない', myAnon.editables === 0);
  await anon.close();

  // ── ③ スタッフかつ飼い主（＝本番のマスター自身の形）でログイン ──
  /* この組み合わせだけが `/my` に留まる。スタッフ「だけ」の人は /edit へ自動で
     飛ばされるので、導線の穴はここでしか出ない。 */
  const both = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await both.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(both, FIXTURE.staffOwnerEmail);
  await both.reload({ waitUntil: 'domcontentloaded' });
  await both.waitForSelector('.pet-card', { timeout: 25000 }).catch(() => {});
  const myStaff = await survey(both, '03-my-スタッフかつ飼い主');
  check('③ マイカルテ: 自分の犬が並ぶ', myStaff.buttons.some((b) => ['X', 'Y', 'Z'].includes(b)),
    JSON.stringify(myStaff.buttons));
  check('③ マイカルテ: ログアウトできる', has(myStaff, 'ログアウト'));
  /* ここが今回の本題。無いとトリマーは URL を手打ちしないと仕事を始められない。 */
  check('③ マイカルテ: トリマー画面への入口が在る（スタッフのとき）', has(myStaff, 'カルテを書く'),
    JSON.stringify(myStaff.buttons));

  const staffLinkWorks = await both.evaluate(() => {
    const el = document.querySelector('[data-staff-link]');
    return !!el && !el.hidden && el.getAttribute('href') === '/edit';
  });
  check('③ その入口は /edit を指している', staffLinkWorks);
  await both.close();

  // ── ③' 飼い主だけの人には、その入口を出さない ──
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await owner.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(owner, FIXTURE.ownerAEmail);
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('.pet-card', { timeout: 25000 }).catch(() => {});
  const myOwner = await survey(owner, '04-my-飼い主だけ');
  check("③' 飼い主だけの人にトリマー画面の入口を見せない", !has(myOwner, 'カルテを書く'),
    JSON.stringify(myOwner.buttons));
  await owner.close();

  // ── ④ トリマー: 犬の一覧 ──
  const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openStaffPage(staff, BASE, '/edit', FIXTURE.staffEmail);
  await staff.waitForSelector('.owner-pet-item, .ponchi-new-karte-form', { timeout: 25000 });
  const list = await survey(staff, '05-edit-犬の一覧');
  check('④ 犬の一覧: 新しい犬を登録する入力欄が在る',
    list.inputs.some((i) => i.includes('犬')) && list.inputs.some((i) => i.includes('飼い主')),
    JSON.stringify(list.inputs));
  check('④ 犬の一覧: 登録ボタンが在る', has(list, '新規カルテを作成'));
  check('④ 犬の一覧: 各行に初回登録QRが在る（新規客を紐付ける唯一の手段）',
    list.buttons.filter((b) => b === 'QR').length > 0);
  check('④ 犬の一覧: 各行に削除が在る', list.buttons.filter((b) => b === '🗑').length > 0);
  /* スタッフ管理は管理者だけの機能。`staff@local.test` は role='staff' なので
     出ないのが正しい。出したら権限の穴なので、両方向で確かめる。 */
  check("④ 犬の一覧: 一般スタッフにスタッフ管理を見せない", !has(list, 'スタッフ管理'));

  // ── ④' 管理者には、スタッフ管理が出ること ──
  const admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openStaffPage(admin, BASE, '/edit', FIXTURE.adminEmail);
  await admin.waitForSelector('.owner-pet-item, .ponchi-new-karte-form', { timeout: 25000 });
  const adminList = await survey(admin, '05b-edit-管理者');
  check("④' 管理者にはスタッフ管理が出る（退職者を止める唯一の手段）", has(adminList, 'スタッフ管理'),
    JSON.stringify(adminList.buttons.slice(-3)));
  await admin.close();

  // ── ⑤ トリマー: 犬のカルテ一覧 ──
  await staff.locator('.owner-pet-item').first().click();
  await staff.waitForSelector('.archive-new-btn', { timeout: 25000 });
  const archive = await survey(staff, '06-edit-カルテ一覧');
  check('⑤ カルテ一覧: 新規カルテへ進める', has(archive, '新規カルテ作成'));
  check('⑤ カルテ一覧: 犬の一覧へ戻れる', has(archive, '戻る'));

  // ── ⑥ トリマー: カルテ作成 ──
  await staff.locator('.archive-new-btn').click();
  await staff.waitForSelector('#heroDateInput', { timeout: 25000 });
  const editor = await survey(staff, '07-カルテ作成');
  check('⑥ カルテ作成: 日付を選べる', editor.inputs.some((i) => i.includes('日付')), JSON.stringify(editor.inputs));
  check('⑥ カルテ作成: 打ち込める場所が在る', editor.editables > 10, `contenteditable=${editor.editables}`);
  check('⑥ カルテ作成: 体重を登録できる', has(editor, '体重'));
  check('⑥ カルテ作成: 確定へ進める', has(editor, '確定'));
  check('⑥ カルテ作成: 前の画面へ戻れる', has(editor, '戻る'));

  // ── ⑦ トリマー: 確認画面（お客様に見えるのと同じ画面）──
  await staff.click('#ponchi-commit-ok');
  await staff.waitForSelector('.ponchi-btn-pub', { timeout: 20000 });
  await staff.click('.ponchi-btn-pub');
  await staff.waitForSelector('#screen-magazine .magazine-container', { timeout: 25000 });
  const preview = await survey(staff, '08-確認画面');
  check('⑦ 確認画面: 公開へ進める', has(preview, '公開') || has(preview, '確定'), JSON.stringify(preview.buttons));
  check('⑦ 確認画面: 書き直しに戻れる', has(preview, '戻る') || has(preview, 'やり直'),
    JSON.stringify(preview.buttons));
  await staff.close();
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 画面点検: ${results.length - failed.length}/${results.length} =====\n`);
process.stdout.write(`スクショ: ${SHOTS}\n`);
if (failed.length) {
  process.stdout.write('\nどこかの画面で行き止まる。機能が在っても、押せなければ無いのと同じ。\n');
}
process.exit(failed.length ? 1 : 0);

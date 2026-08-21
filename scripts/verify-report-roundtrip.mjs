/**
 * verify-report-roundtrip.mjs — 「トリマーが書いたものが、飼い主にそのまま届くか」
 *
 * このアプリの存在理由そのものを検査する。画面が出る・ボタンが押せるではなく、
 * 記入 → 保存 → 飼い主が開く公開ページ、の往復で1項目でも欠けたら失格とする。
 *
 * 使い方:
 *   端末1: npm run preview
 *   端末2: npm run verify:roundtrip
 *   ブラウザを指定する場合は M6_CHROMIUM=/path/to/chrome
 *
 * EXIT 0 = 全項目が往復した / EXIT 1 = 1項目でも消えた
 *
 * なぜこの検査が要るか:
 *   画面の見た目とコンソールだけを見ていると、この種の欠落は完全に無症状になる。
 *   実際、皮膚の種類・変化と歯の状態は「保存はされるが復元で静かに落ちる」状態で
 *   移設されてきた（cssAttrSafe が日本語の値を空文字にしていた）。耳・爪・歯の
 *   コメントは data-field が振られておらず抽出対象ですらなく、「担当からの一言」は
 *   HTML にあるのに抽出側が読んでいなかった。どれもエラーを出さない。
 *   出ないからこそ、機械で往復を確かめるしかない。
 */

import { chromium } from 'playwright';

const BASE = process.env.M6_BASE || 'http://localhost:8787';

/** トリマーが1回の施術で書き込む内容。すべて飼い主に届かなければならない。 */
const INPUT = {
  skinLoc: '右前肢の内側',
  skinSize: '5mm',
  skinType: '湿疹',        // 日本語。cssAttrSafe を通すと空になる値
  skinChange: '治療中',    // 同上
  teeth: '歯石',           // 同上
  earRight: '3',
  earLeft: '2',
  nail: '2',
  earComment: '左耳に軽い赤みがあります。様子を見てください。',
  nailComment: '深爪を避けて短めに整えました。',
  teethComment: '奥歯に歯石。歯みがきガムの併用をおすすめします。',
  staffNote: '今日はシャンプー中もおとなしくしていました。また来月お待ちしています。',
};

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass, actual, expected });
  process.stdout.write(
    `${pass ? 'PASS' : 'FAIL'}  ${name}`
    + (pass ? `  "${String(actual).slice(0, 28)}"` : `\n        期待: "${expected}"\n        実際: "${actual}"`)
    + '\n',
  );
}

async function post(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${pathname} → ${res.status}`);
  return res.json();
}

const stamp = Date.now().toString(36).slice(-5);
const PET_NAME = `往復${stamp}`;
const owner = await post('/api/owners', { ownerName: `往復検証 ${stamp}` });
const pet = await post('/api/customers', { petName: PET_NAME, ownerSlug: owner.ownerSlug });

const launchOpts = process.env.M6_CHROMIUM ? { executablePath: process.env.M6_CHROMIUM } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => process.stdout.write(`  [pageerror] ${e.message}\n`));

// ── トリマー側: カルテを1件書いて保存する ──
await page.goto(`${BASE}/edit/o/${owner.ownerSlug}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('button.owner-pet-item').first().click();
await page.waitForTimeout(2500);

// 肉球画面に登録した犬の名前が出ているか（既定値「まるちゃん」のままでないか）
const pawName = await page.evaluate(() =>
  document.querySelector('#screen-paw [data-field="pet"]')?.textContent?.trim());
check('肉球画面に犬の名前が出る', pawName, PET_NAME);

await page.locator('#screen-paw .pad').first().click();
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
await page.waitForTimeout(800);

const filled = await page.evaluate((input) => {
  const missing = [];
  const setText = (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) { missing.push(sel); return; }
    el.textContent = val;
  };
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) { missing.push(sel); return; }
    el.click();
  };
  setText('[data-field="skin-loc-1"]', input.skinLoc);
  setText('[data-field="skin-size-1"]', input.skinSize);
  pick(`.sk-pick[data-skin-type="1"][data-val="${input.skinType}"]`);
  pick(`.sk-pick[data-skin-change="1"][data-val="${input.skinChange}"]`);
  pick(`.tt-pick[data-teeth="${input.teeth}"]`);
  pick(`.ear-cell[data-ear="right"][data-val="${input.earRight}"]`);
  pick(`.ear-cell[data-ear="left"][data-val="${input.earLeft}"]`);
  pick(`.nail-lv[data-nail="${input.nail}"]`);
  setText('[data-field="ear-comment"]', input.earComment);
  setText('[data-field="nail-comment"]', input.nailComment);
  setText('[data-field="teeth-comment"]', input.teethComment);
  setText('[data-field="staff-note"]', input.staffNote);
  return missing;
}, INPUT);

if (filled.length) {
  process.stdout.write('\n❌ 記入先の要素が見つからない（UI と保存契約が食い違っている）:\n');
  filled.forEach((m) => process.stdout.write(`  - ${m}\n`));
  await browser.close();
  process.exit(1);
}

// 確定 → プレビューを確認 → 確定（公開）
let saveStatus = 0;
page.on('response', (r) => {
  if (r.request().method() === 'POST' && r.url().endsWith('/api/reports')) saveStatus = r.status();
});
await page.evaluate(() => document.getElementById('ponchi-commit-ok')?.scrollIntoView());
await page.locator('#ponchi-commit-ok').click();
await page.waitForTimeout(2000);
await page.locator('.ponchi-btn-pub').first().click();
await page.waitForTimeout(3000);
await page.locator('.ponchi-btn-pub').first().click();
await page.waitForTimeout(9000);
check('保存が 200 で返る', saveStatus, 200);

// ── 飼い主側: 公開ページを開いて、書いたものが全部あるか ──
await page.goto(`${BASE}/p/${pet.slug}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.locator('#screen-paw .pad').first().click();
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
await page.waitForTimeout(800);

const seen = await page.evaluate(() => {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const picked = (sel, attr) => {
    const el = document.querySelector(sel);
    return el ? (el.dataset[attr] ?? null) : null;
  };
  return {
    pet: text('[data-field="pet"]'),
    skinLoc: text('[data-field="skin-loc-1"]'),
    skinSize: text('[data-field="skin-size-1"]'),
    skinType: picked('.sk-pick.is-picked[data-skin-type="1"]', 'val'),
    skinChange: picked('.sk-pick.is-picked[data-skin-change="1"]', 'val'),
    teeth: picked('.tt-pick.is-picked', 'teeth'),
    earRight: picked('.ear-cell.is-picked[data-ear="right"]', 'val'),
    earLeft: picked('.ear-cell.is-picked[data-ear="left"]', 'val'),
    nail: picked('.nail-lv.is-picked', 'nail'),
    earComment: text('[data-field="ear-comment"]'),
    nailComment: text('[data-field="nail-comment"]'),
    teethComment: text('[data-field="teeth-comment"]'),
    staffNote: text('[data-field="staff-note"]'),
  };
});

process.stdout.write('\n── 飼い主が公開ページで見るもの ──\n');
check('犬の名前', seen.pet, PET_NAME);
check('皮膚1 部位', seen.skinLoc, INPUT.skinLoc);
check('皮膚1 大きさ', seen.skinSize, INPUT.skinSize);
check('皮膚1 種類', seen.skinType, INPUT.skinType);
check('皮膚1 変化', seen.skinChange, INPUT.skinChange);
check('歯の状態', seen.teeth, INPUT.teeth);
check('耳（右）', seen.earRight, INPUT.earRight);
check('耳（左）', seen.earLeft, INPUT.earLeft);
check('爪のレベル', seen.nail, INPUT.nail);
check('耳のコメント', seen.earComment, INPUT.earComment);
check('爪のコメント', seen.nailComment, INPUT.nailComment);
check('歯のコメント', seen.teethComment, INPUT.teethComment);
check('担当からの一言', seen.staffNote, INPUT.staffNote);

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 往復: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\nトリマーが書いたのに飼い主に届いていない項目がある。\n');
}
await browser.close();
process.exit(failed.length ? 1 : 0);

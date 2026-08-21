/**
 * verify-empty-pet.mjs — カルテ0件の犬に、存在しない履歴を見せていないか
 *
 * 使い方:
 *   端末1: npm run preview
 *   端末2: npm run verify:empty
 *   ブラウザを指定する場合は M6_CHROMIUM=/path/to/chrome
 *
 * EXIT 0 = 空は空として出ている / EXIT 1 = 架空の履歴が出ている
 *
 * なぜこの検査が要るか:
 *   既定の HTML には見本用の月ラベル（11月・10月・9月…）と Unsplash の犬写真が
 *   埋め込まれている。カルテが1件も無いとき、以前はそれが飼い主にそのまま見えて
 *   いた。しかも肉球をタップすると、他の犬の体重・所見・担当コメントで埋まった
 *   デモカルテが、その犬の名前で開いた。施術を一度もしていない犬に5ヶ月分の
 *   履歴があるように見える状態で、納品物としては成立しない。
 *
 *   トリマー側は別で、1件目を作る導線が要る。中央パッドだけ「＋ 新規カルテ」として
 *   残してあり、この検査はそれが生きていることも確かめる（消すと登録した犬に
 *   カルテを作れなくなる）。
 */

import { chromium } from 'playwright';

const BASE = process.env.M6_BASE || 'http://localhost:8787';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
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
const PET_NAME = `空${stamp}`;
const owner = await post('/api/owners', { ownerName: `空状態 ${stamp}` });
const pet = await post('/api/customers', { petName: PET_NAME, ownerSlug: owner.ownerSlug });

const launchOpts = process.env.M6_CHROMIUM ? { executablePath: process.env.M6_CHROMIUM } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

/** 肉球画面の実際の見え方を読む。 */
const readPaw = () => page.evaluate(() => {
  const label = (sel) => {
    const el = document.querySelector(`#screen-paw ${sel}`);
    if (!el) return null;
    const arc = el.querySelector('.toe-arc-label');
    const span = el.querySelector('.toe-label');
    const badge = el.querySelector('.pad-badge');
    return (badge || arc || span)?.textContent?.trim() ?? '';
  };
  return {
    labels: ['.pad', '.toe-1', '.toe-2', '.toe-3', '.toe-4'].map(label),
    tappable: ['.pad', '.toe-1', '.toe-2', '.toe-3', '.toe-4']
      .filter((s) => document.querySelector(`#screen-paw ${s}`)?.getAttribute('role') === 'button'),
    photos: [...document.querySelectorAll('#screen-paw .paw img')]
      .map((i) => i.getAttribute('src')).filter(Boolean),
    emptyNotice: document.querySelector('#screen-paw .paw-empty')?.hidden === false
      ? document.querySelector('#screen-paw .paw-empty').textContent.trim() : null,
  };
});

// ── 飼い主側: 公開ページ ──
await page.goto(`${BASE}/p/${pet.slug}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const ownerPaw = await readPaw();

const MONTH = /\d+\s*月/;
check('飼い主: 架空の月ラベルが無い',
  !ownerPaw.labels.some((l) => l && MONTH.test(l)),
  `labels=${JSON.stringify(ownerPaw.labels)}`);
check('飼い主: 見本写真が残っていない',
  ownerPaw.photos.length === 0,
  `photos=${ownerPaw.photos.length}`);
check('飼い主: タップできる肉球が無い',
  ownerPaw.tappable.length === 0,
  `tappable=${JSON.stringify(ownerPaw.tappable)}`);
check('飼い主: 「まだカルテがありません」が出る',
  !!ownerPaw.emptyNotice, ownerPaw.emptyNotice ?? '(出ていない)');

// 肉球を無理に押してもデモカルテへ遷移しないこと
await page.locator('#screen-paw .pad').click({ force: true }).catch(() => {});
await page.waitForTimeout(1500);
const stillPaw = await page.evaluate(() => {
  const vis = (id) => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none';
  };
  return { paw: vis('screen-paw'), report: vis('screen-report') };
});
check('飼い主: 押してもデモカルテが開かない',
  stillPaw.paw && !stillPaw.report,
  `paw=${stillPaw.paw} report=${stillPaw.report}`);

// ── トリマー側: 1件目を作る導線が残っていること ──
await page.goto(`${BASE}/edit/o/${owner.ownerSlug}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('button.owner-pet-item').first().click();
await page.waitForTimeout(2500);
const trimmerPaw = await readPaw();

check('トリマー: 架空の月ラベルが無い',
  !trimmerPaw.labels.some((l) => l && MONTH.test(l)),
  `labels=${JSON.stringify(trimmerPaw.labels)}`);
check('トリマー: 中央パッドが新規作成の入口になっている',
  trimmerPaw.labels[0] === '＋ 新規カルテ' && trimmerPaw.tappable.includes('.pad'),
  `pad="${trimmerPaw.labels[0]}"`);

await page.locator('#screen-paw .pad').click();
await page.waitForTimeout(3000);
const opened = await page.evaluate(() => {
  const el = document.getElementById('screen-report');
  return !!el && getComputedStyle(el).display !== 'none';
});
check('トリマー: 中央パッドから1件目を作れる', opened, `report画面=${opened}`);

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 空状態: ${results.length - failed.length}/${results.length} =====\n`);
await browser.close();
process.exit(failed.length ? 1 : 0);

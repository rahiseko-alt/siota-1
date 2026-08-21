/**
 * verify-xss.mjs — 保存されたカルテのデータが、飼い主のブラウザで実行されないこと
 *
 * 使い方:
 *   端末1: npm run preview
 *   端末2: npm run verify:xss
 *   ブラウザを指定する場合は M6_CHROMIUM=/path/to/chrome
 *
 * EXIT 0 = 実行されない / EXIT 1 = 実行された（Critical）
 *
 * 背景:
 *   `/api/*` に認証が無いのは既知かつ意図された前提（LEVEL D-3）。ここで塞ぐのは
 *   認証ではなく、**保存済みデータが飼い主の画面でコードとして走ってしまうこと**。
 *   前者は「誰でも書ける」、後者は「書かれたものが実行される」で、別の問題。
 *
 *   実際に F-20260821-17 として成立していた。weights[].ym は heroDateVal() が
 *   YYYY-MM-DD しか作らないので安全だと見なされ、ymShort() の戻り値が buildSVG() と
 *   renderList() の innerHTML へ素通しで連結されていた。POST /api/reports に
 *   細工した ym を入れるだけで、公開ページ /p/{slug} で任意の JS が動いた。
 *
 *   移設 plan はこの種の欠陥を「ponchi-v2.html:1590 の innerHTML 連結」として
 *   risk#1 に挙げていたが、行番号は現在のファイルに対応しない。行を追うのをやめて
 *   注入口を全部洗い、実際に撃ち込んで確かめた結果がこの検査になっている。
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

const FIRE = 'window.__XSS_FIRED=1';

/* 仕掛ける場所と、そこに入れる細工。いずれも「保存されたカルテ」を経由して
   飼い主の公開ページに届く値。増やすときはここに1行足す。 */
const PAYLOADS = [
  {
    name: 'weights[].ym（グラフと一覧の両方へ流れる）',
    build: (p) => ({ ...p, weights: [{ ym: `2026-<img src=x onerror="${FIRE}">`, kg: 3.2 }] }),
  },
  {
    name: 'weights[].ym の閉じタグ挿入',
    build: (p) => ({ ...p, weights: [{ ym: `2026-</text><script>${FIRE}<\/script>`, kg: 3.2 }] }),
  },
  {
    name: 'pet（見出しへ入る）',
    build: (p) => ({ ...p, pet: `<img src=x onerror="${FIRE}">` }),
  },
  {
    name: 'staffNote（担当からの一言）',
    build: (p) => ({ ...p, staffNote: `<img src=x onerror="${FIRE}">` }),
  },
  {
    name: 'ear.comment（耳のコメント）',
    build: (p) => ({ ...p, ear: { right: 1, left: 1, comment: `<img src=x onerror="${FIRE}">` } }),
  },
  {
    name: 'skin[].loc（皮膚の部位）',
    build: (p) => ({
      ...p,
      skin: [{ loc: `<img src=x onerror="${FIRE}">`, size: '5mm', type: '', change: '' }],
    }),
  },
];

const launchOpts = process.env.M6_CHROMIUM ? { executablePath: process.env.M6_CHROMIUM } : {};
const browser = await chromium.launch(launchOpts);

for (const [i, payload] of PAYLOADS.entries()) {
  const stamp = `${Date.now().toString(36).slice(-4)}${i}`;
  const owner = await post('/api/owners', { ownerName: `XSS ${stamp}` });
  const pet = await post('/api/customers', { petName: `検証${stamp}`, ownerSlug: owner.ownerSlug });

  const base = {
    template: 'ponchi', pet: `検証${stamp}`, date: '2026/08/21', year: '2026', day: '金',
    weights: [], skin: [], options: [], teeth: {}, ear: {}, nail: {},
  };
  await post('/api/reports', { slug: pet.slug, report: payload.build(base) });

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/p/${pet.slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.locator('#screen-paw .pad').click({ force: true }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(600);

  const fired = await page.evaluate(() => !!window.__XSS_FIRED);
  check(payload.name, !fired, fired ? '★ 実行された' : '実行されない');
  await page.close();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== XSS: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\n保存されたデータが飼い主のブラウザで実行されている。Critical。\n');
}
await browser.close();
process.exit(failed.length ? 1 : 0);

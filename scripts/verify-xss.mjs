/**
 * verify-xss.mjs — 保存されたカルテのデータが、飼い主のブラウザで実行されないこと（Supabaseモード）
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:xss
 *
 * EXIT 0 = 実行されない / EXIT 1 = 実行された（Critical）
 *
 * KV版と同じ脅威モデルを引き継ぐ: 「誰でも書ける」（LEVEL D-3・意図された前提）ではなく、
 * 「書かれたものが飼い主のブラウザでコードとして実行される」ことだけを塞ぐ。
 * ここでは data カラムへ直接（スタッフAPI経由・DOM/extractReportの無害化を迂回して）
 * 細工した値を書き込み、renderMagazine() の描画結果が実行されないことを確かめる。
 * これは「入り口を塞ぐ」検査ではなく「出口（描画）が安全か」の検査で、DOM経由の
 * サニタイズに問題があっても最後の砦として効く必要がある。
 */

import { chromium } from 'playwright';
import { startLocalWorker, passwordLogin, injectSession, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;
const FIRE = 'window.__XSS_FIRED=1';

/* 仕掛ける場所と、そこに入れる細工。renderMagazine() が描画する箇所を一通り洗う。
   増やすときはここに1行足す。 */
const PAYLOADS = [
  {
    name: 'pet（犬名見出しへ入る）',
    build: (p) => ({ ...p, pet: `<img src=x onerror="${FIRE}">` }),
  },
  {
    name: 'staffNote（担当からの一言）',
    build: (p) => ({ ...p, staffNote: `<img src=x onerror="${FIRE}">` }),
  },
  {
    name: 'skin[].loc（皮膚の部位）',
    build: (p) => ({ ...p, skin: [{ loc: `<img src=x onerror="${FIRE}">`, size: '5mm', type: '', change: '' }] }),
  },
  {
    name: 'ear.comment（耳のコメント）',
    build: (p) => ({ ...p, ear: { right: 1, left: 1, comment: `<img src=x onerror="${FIRE}">` } }),
  },
  {
    name: 'nail.comment（爪のコメント）',
    build: (p) => ({ ...p, nail: { level: 1, comment: `<img src=x onerror="${FIRE}">` } }),
  },
  {
    name: 'teeth.comment / teeth.status（歯のコメント・状態）',
    build: (p) => ({ ...p, teeth: { status: `<img src=x onerror="${FIRE}">`, comment: `<img src=x onerror="${FIRE}2">` } }),
  },
  {
    name: 'weights[].ym（体重グラフのラベル）',
    build: (p) => ({ ...p, weights: [{ ym: `<img src=x onerror="${FIRE}">`, kg: 3.2 }] }),
  },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8787) });
let browser;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };

  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

  for (const [i, payload] of PAYLOADS.entries()) {
    const stamp = `${Date.now().toString(36).slice(-4)}${i}`;
    const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: `XSS${stamp}`, template: 'ponchi' }),
    });
    const pet = (await petRes.json()).pet;

    const base = { template: 'ponchi', pet: `XSS${stamp}`, weights: [], skin: [], options: [], teeth: {}, ear: {}, nail: {} };
    const reportRes = await fetch(`${BASE}/api/pets/${pet.id}/reports`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ petId: pet.id, reportDate: '2026-08-23', data: payload.build(base) }),
    });
    const report = (await reportRes.json()).report;
    // 作成直後は status='draft'。飼い主には見えないので finalize して確定させる。
    const finalizeRes = await fetch(`${BASE}/api/pets/${pet.id}/reports/${report.id}/finalize`, {
      method: 'POST', headers: authHeaders,
    });
    if (!finalizeRes.ok) {
      check(payload.name, false, `確定に失敗 (${finalizeRes.status})。細工データを飼い主画面まで届けられなかった`);
      continue;
    }

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE}/my/pets/${pet.id}/reports/${report.id}`);
    await injectSession(page, FIXTURE.ownerAEmail);
    await page.reload();
    await page.waitForTimeout(2500);

    const fired = await page.evaluate(() => !!window.__XSS_FIRED);
    check(payload.name, !fired, fired ? '★ 実行された' : '実行されない');
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== XSS: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\n保存されたデータが飼い主のブラウザで実行されている。Critical。\n');
}
process.exit(failed.length ? 1 : 0);

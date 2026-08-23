/**
 * verify-report-roundtrip.mjs — 「トリマーが書いたものが、飼い主にそのまま届くか」（Supabaseモード）
 *
 * このアプリの存在理由そのものを検査する。画面が出る・ボタンが押せるではなく、
 * 記入 → 確定 → 公開 → 飼い主が /my で開く、の往復で1項目でも欠けたら失格とする。
 *
 * 使い方:
 *   端末1: npx supabase start   （ローカル実 Postgres/Auth/PostgREST/Storage）
 *   端末2: npm run verify:roundtrip
 *
 * EXIT 0 = 全項目が往復した / EXIT 1 = 1項目でも消えた
 *
 * KV版（廃止）からの引き継ぎ: この検査はこのリポジトリで一番重要な検査という位置づけを
 * そのまま引き継ぐ。画面の見た目とコンソールだけを見ていると、この種の欠落は
 * 完全に無症状になる（F-20260823-26/27等）。入力欄を足したら必ずここにも足すこと。
 */

import { chromium } from 'playwright';
import { startLocalWorker, injectSession, passwordLogin, openStaffPage, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;

/** トリマーが1回の施術で書き込む内容。すべて飼い主に届かなければならない（13項目）。 */
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

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8787) });
let browser;
try {
  const stamp = Date.now().toString(36).slice(-5);
  const PET_NAME = `往復${stamp}`;

  // ── スタッフとして、既存の飼い主(owner-a)の下に新しい犬を作る（API直接）。
  //    新規の飼い主を作ると auth ユーザーに紐付いていない孤児owner になり、
  //    誰も飼い主として閲覧できなくなる（RLS: owner_users 経由でしか通らない）ため、
  //    fixture の owner-a（owner_users 済み）を使う ──
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: PET_NAME, template: 'ponchi' }),
  });
  check('スタッフAPIで犬を新規登録できる', petRes.status, 201);

  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => process.stdout.write(`  [pageerror] ${e.message}\n`));

  // ── トリマー側: ブラウザで実ログインし、カルテを1件書いて保存する ──
  await openStaffPage(page, BASE, '/edit', FIXTURE.staffEmail);
  await page.waitForSelector('.owner-pet-item', { timeout: 15000 });

  await Promise.all([
    page.waitForURL(/\/edit\/p\//, { timeout: 10000 }),
    page.locator('.owner-pet-item', { hasText: `${PET_NAME}（` }).first().click(),
  ]);
  await page.waitForSelector('.archive-new-btn', { timeout: 15000 });
  await page.click('.archive-new-btn');
  await page.waitForSelector('#heroDateInput', { timeout: 15000 });
  await page.waitForSelector('#skin-body .sk-card', { state: 'attached', timeout: 15000 });
  await page.evaluate(() => { document.querySelectorAll('#screen-report details').forEach((d) => { d.open = true; }); });

  const filled = await page.evaluate((input) => {
    const missing = [];
    const setText = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) { missing.push(sel); return; }
      el.textContent = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setText('[data-field="skin-loc-1"]', input.skinLoc);
    setText('[data-field="skin-size-1"]', input.skinSize);
    setText('[data-field="ear-comment"]', input.earComment);
    setText('[data-field="nail-comment"]', input.nailComment);
    setText('[data-field="teeth-comment"]', input.teethComment);
    setText('[data-field="staff-note"]', input.staffNote);
    return missing;
  }, INPUT);
  if (filled.length) {
    process.stdout.write('\n❌ 記入先の要素が見つからない（UI と保存契約が食い違っている）:\n');
    filled.forEach((m) => process.stdout.write(`  - ${m}\n`));
    throw new Error('missing DOM targets');
  }

  async function pick(selector) {
    await page.click(selector);
  }
  await pick(`.sk-pick[data-skin-type="1"][data-val="${INPUT.skinType}"]`);
  await pick(`.sk-pick[data-skin-change="1"][data-val="${INPUT.skinChange}"]`);
  await pick(`.tt-pick[data-teeth="${INPUT.teeth}"]`);
  await pick(`.ear-cell[data-ear="right"][data-val="${INPUT.earRight}"]`);
  await pick(`.ear-cell[data-ear="left"][data-val="${INPUT.earLeft}"]`);
  await pick(`.nail-lv[data-nail="${INPUT.nail}"]`);

  // 確定 → プレビューを確認(showMagazinePreview) → 確定（公開）
  await page.click('#ponchi-commit-ok');
  await page.waitForSelector('.ponchi-btn-pub', { timeout: 10000 });
  await page.click('.ponchi-btn-pub');
  await page.waitForSelector('#screen-magazine .magazine-container', { timeout: 15000 });

  process.stdout.write('\n── トリマーの確認画面（#screen-magazine）に出ている値 ──\n');
  const previewText = await page.evaluate(() => document.querySelector('#screen-magazine').textContent);
  check('確認画面: 皮膚1 部位', previewText.includes(INPUT.skinLoc) ? INPUT.skinLoc : '(欠落)', INPUT.skinLoc);
  check('確認画面: 担当からの一言', previewText.includes(INPUT.staffNote) ? INPUT.staffNote : '(欠落)', INPUT.staffNote);

  await page.click('#screen-magazine .ponchi-btn-pub');
  await page.waitForSelector('.ponchi-publish-notice', { timeout: 30000 });
  const pubHref = await page.evaluate(() => document.querySelector('.ponchi-pub-link')?.getAttribute('href') || '');
  check('保存・公開のURL通知が出る', /\/my\/pets\/.+\/reports\/.+/.test(pubHref) ? 'ok' : pubHref, 'ok');

  // ── 飼い主側: 別ブラウザコンテキストでログインし直し、公開ページを開いて全項目を確認 ──
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}${pubHref}`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.reload();
  await ownerPage.waitForSelector('.magazine-container', { timeout: 20000 });

  const seenText = await ownerPage.evaluate(() => document.body.textContent);
  process.stdout.write('\n── 飼い主が /my で見るもの ──\n');
  check('犬の名前', seenText.includes(PET_NAME) ? PET_NAME : '(欠落)', PET_NAME);
  check('皮膚1 部位', seenText.includes(INPUT.skinLoc) ? INPUT.skinLoc : '(欠落)', INPUT.skinLoc);
  check('皮膚1 大きさ', seenText.includes(INPUT.skinSize) ? INPUT.skinSize : '(欠落)', INPUT.skinSize);
  check('皮膚1 種類', seenText.includes(INPUT.skinType) ? INPUT.skinType : '(欠落)', INPUT.skinType);
  check('皮膚1 変化', seenText.includes(INPUT.skinChange) ? INPUT.skinChange : '(欠落)', INPUT.skinChange);
  check('歯の状態', seenText.includes(INPUT.teeth) ? INPUT.teeth : '(欠落)', INPUT.teeth);
  check('耳（右）', seenText.includes(`右 Lv.${INPUT.earRight}`) ? `右 Lv.${INPUT.earRight}` : '(欠落)', `右 Lv.${INPUT.earRight}`);
  check('耳（左）', seenText.includes(`左 Lv.${INPUT.earLeft}`) ? `左 Lv.${INPUT.earLeft}` : '(欠落)', `左 Lv.${INPUT.earLeft}`);
  check('爪のレベル', seenText.includes(`Lv.${INPUT.nail}`) ? `Lv.${INPUT.nail}` : '(欠落)', `Lv.${INPUT.nail}`);
  check('耳のコメント', seenText.includes(INPUT.earComment) ? INPUT.earComment : '(欠落)', INPUT.earComment);
  check('爪のコメント', seenText.includes(INPUT.nailComment) ? INPUT.nailComment : '(欠落)', INPUT.nailComment);
  check('歯のコメント', seenText.includes(INPUT.teethComment) ? INPUT.teethComment : '(欠落)', INPUT.teethComment);
  check('担当からの一言', seenText.includes(INPUT.staffNote) ? INPUT.staffNote : '(欠落)', INPUT.staffNote);

  const noEditHooks = await ownerPage.evaluate(() => document.querySelectorAll('[data-field]').length === 0);
  check('飼い主画面に編集用フック(data-field)が無い', noEditHooks ? 'ok' : 'あり', 'ok');

  // ── RLS実証: 他人（owner-b）はこのカルテを見られない（全体受け入れ条件3）──
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(`${BASE}${pubHref}`);
  await injectSession(strangerPage, FIXTURE.ownerBEmail);
  await strangerPage.reload();
  await strangerPage.waitForTimeout(2000);
  const strangerSeesIt = await strangerPage.evaluate(
    (note) => document.body.textContent.includes(note),
    INPUT.staffNote,
  );
  check('他人には見えない（RLS）', strangerSeesIt ? '見えた(NG)' : 'ok', 'ok');
  await ownerContext.close();
  await strangerContext.close();
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 往復: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\nトリマーが書いたのに飼い主に届いていない項目がある。\n');
}
process.exit(failed.length ? 1 : 0);

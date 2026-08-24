/**
 * verify-draft.mjs — 記入したものが黙って消えないこと（Supabaseモード）
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:draft
 *
 * EXIT 0 = 記入が守られる / EXIT 1 = 守られない
 *
 * **なぜこの検査が要るか**
 *   トリマーの記入は DOM とメモリにしか無く、サーバに残るのは「確定」を押した後だけ
 *   だった。カルテ画面の「戻る」は確認なしで遷移するので、**誤タップ1回で数十分の記入が
 *   消える**。施術中のスリープ・着信・引っぱって更新でも同じで、しかも消えたことに
 *   気づけない（画面もコンソールも何も言わない）。D-20260824-30 の 1 と 7。
 *
 *   ここで見るのは4つ——(1)入力が下書きとして残る、(2)離れて戻ると続きから書ける、
 *   (3)確定できたら下書きは消える（次回に古い内容が蘇らない）、
 *   (4)確定済みのカルテは書けない状態になる（書けるのに保存できない、をやめる）。
 */

import { chromium } from 'playwright';
import {
  startLocalWorker, openStaffPage, FIXTURE,
} from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8791) });
let browser;
try {
  const stamp = Date.now().toString(36).slice(-5);
  const PET_NAME = `下書きの犬${stamp}`;
  const OWNER_NAME = `下書き${stamp}`;
  const NOTE = `途中まで書いた担当コメント ${stamp}`;
  const SKIN_LOC = `左耳のうしろ ${stamp}`;

  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });

  /* confirm / beforeunload の応答を、検査の場面ごとに切り替える。 */
  let acceptDialogs = true;
  const dialogLog = [];
  staff.on('dialog', async (d) => {
    dialogLog.push({ type: d.type(), message: d.message() });
    if (acceptDialogs) await d.accept();
    else await d.dismiss();
  });

  // ── 犬を1頭作る ──
  await openStaffPage(staff, BASE, '/edit', FIXTURE.staffEmail);
  await staff.waitForSelector('.owner-pet-item, .ponchi-new-karte-form', { timeout: 20000 });
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=0', PET_NAME);
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=1', OWNER_NAME);
  await Promise.all([
    staff.waitForURL(/\/edit\/p\//, { timeout: 20000 }),
    staff.click('.ponchi-new-karte-form .ponchi-add-btn'),
  ]);
  const petUrl = staff.url();
  const petId = petUrl.match(/\/edit\/p\/([0-9a-f-]{36})/)?.[1];
  check('検査用の犬を作れる', !!petId, `petId=${petId}`);

  /** 新規カルテ画面を開いて、担当コメントと皮膚1の部位に書き込む。 */
  async function typeIntoNewKarte() {
    await staff.waitForSelector('.archive-new-btn', { timeout: 20000 });
    await staff.click('.archive-new-btn');
    await staff.waitForSelector('#heroDateInput', { timeout: 20000 });
    await staff.evaluate(([note, loc]) => {
      const set = (sel, value) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('[data-field="staff-note"]', note);
      set('[data-field="skin-loc-1"]', loc);
    }, [NOTE, SKIN_LOC]);
    /* 自動保存の間引きは1.2秒。余裕を見て待つ。 */
    await staff.waitForTimeout(2200);
  }

  await typeIntoNewKarte();

  // ── 1. 入力が下書きとして残る ──
  const stored = await staff.evaluate((id) => window.localStorage.getItem('saltydog:draft:' + id), petId);
  check('入力が下書きとして残る', !!stored && stored.includes(NOTE), stored ? `${stored.length}文字` : 'なし');

  // ── 2. 下書きに写真が混ざらない（localStorage の枠に収まる大きさ） ──
  const noDataUrls = !!stored && !stored.includes('data:image');
  check('下書きに写真の実体が混ざらない（容量で保存が失敗しない）', noDataUrls,
    stored ? `${(stored.length / 1024).toFixed(1)}KB` : '');

  // ── 3. 未確定のまま離れようとしたら確認が出る ──
  dialogLog.length = 0;
  await staff.goto(petUrl, { waitUntil: 'domcontentloaded' });
  const askedBeforeLeaving = dialogLog.some((d) => d.type === 'beforeunload');
  check('未確定のまま離れようとしたら確認が出る（戻るの誤タップで消えない）', askedBeforeLeaving,
    JSON.stringify(dialogLog.map((d) => d.type)));

  // ── 4. 戻ってくると続きから書ける ──
  acceptDialogs = true;   /* 「続きから書きますか？」に「はい」 */
  dialogLog.length = 0;
  await staff.waitForSelector('.archive-new-btn', { timeout: 20000 });
  await staff.click('.archive-new-btn');
  await staff.waitForSelector('#heroDateInput', { timeout: 20000 });
  await staff.waitForTimeout(800);
  const restored = await staff.evaluate(() => ({
    note: document.querySelector('[data-field="staff-note"]')?.textContent || '',
    loc: document.querySelector('[data-field="skin-loc-1"]')?.textContent || '',
  }));
  check('復元するか尋ねられる', dialogLog.some((d) => d.message.includes('書きかけ')),
    JSON.stringify(dialogLog.map((d) => d.message.slice(0, 24))));
  check('担当コメントが続きから書ける', restored.note === NOTE, restored.note.slice(0, 30));
  check('皮膚1の部位も戻る', restored.loc === SKIN_LOC, restored.loc.slice(0, 30));

  // ── 5. 確定できたら下書きは消える ──
  await staff.click('#ponchi-commit-ok');
  await staff.waitForSelector('.ponchi-btn-pub', { timeout: 15000 });
  await staff.click('.ponchi-btn-pub');
  await staff.waitForSelector('#screen-magazine .magazine-container', { timeout: 20000 });
  await staff.click('#screen-magazine .ponchi-btn-pub');
  await staff.waitForSelector('.ponchi-publish-notice', { timeout: 40000 });
  const afterPublish = await staff.evaluate((id) => window.localStorage.getItem('saltydog:draft:' + id), petId);
  check('確定できたら下書きは消える（次回に古い内容が蘇らない）', afterPublish === null,
    afterPublish === null ? '' : `${afterPublish.length}文字 残っている`);
  const reportUrl = await staff.evaluate(() => document.querySelector('.ponchi-pub-link')?.getAttribute('href') || '');
  const reportId = reportUrl.match(/\/reports\/([0-9a-f-]{36})/)?.[1];
  check('カルテを公開できる', !!reportId, reportUrl);

  // ── 6. 確定済みのカルテは書けない ──
  await staff.goto(`${BASE}/edit/p/${petId}/${reportId}`, { waitUntil: 'domcontentloaded' });
  await staff.waitForSelector('#ponchi-finalized-note', { timeout: 25000 }).catch(() => {});
  const locked = await staff.evaluate(() => {
    const sec = document.getElementById('screen-report');
    const editable = [...(sec?.querySelectorAll('[contenteditable]') || [])]
      .filter((el) => el.getAttribute('contenteditable') !== 'false').length;
    const enabledInputs = [...(sec?.querySelectorAll('input, textarea, select') || [])]
      .filter((el) => !el.disabled).length;
    return {
      readonly: document.body.classList.contains('is-readonly'),
      notice: document.getElementById('ponchi-finalized-note')?.textContent || '',
      editable,
      enabledInputs,
      canDelete: !!document.getElementById('supabase-delete-report'),
      /* is-readonly は編集UIを広く隠す。戻る導線まで隠すと、確定済みカルテを開いた
         時点で行き止まりになる（ブラウザの戻るしか残らない）。 */
      canGoBack: (() => {
        const el = document.getElementById('reportBackBtn');
        return !!el && window.getComputedStyle(el).display !== 'none';
      })(),
    };
  });
  check('確定済みカルテ: 打ち込める場所が残っていない', locked.editable === 0, `編集可能=${locked.editable}`);
  check('確定済みカルテ: 入力欄も無効になっている', locked.enabledInputs === 0, `有効な入力=${locked.enabledInputs}`);
  check('確定済みカルテ: 変更できないと画面に出ている', locked.notice.includes('変更できません'), locked.notice.slice(0, 30));
  check('確定済みカルテ: 削除して作り直す手段は残っている', locked.canDelete);
  check('確定済みカルテ: 戻る導線が消えていない（行き止まりにならない）', locked.canGoBack);
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 下書き: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\nトリマーの記入が失われる。実店舗では毎日この経路を通る。\n');
}
process.exit(failed.length ? 1 : 0);

/**
 * report-commit-guard.test.mjs — **確定は「番号が入っている」ところまで確かめる**
 *
 * `F-20260828-59`。`D-2`（保存できていないのに「保存しました」と出す）を塞いだ
 * つもりの場所に、すり抜ける道が残っていた。
 *
 * 塞いであったのは「返事が**空**だったとき」だけで、**「返事は来たが、中身の
 * カルテ番号が抜けているとき」は素通り**だった。番号が抜けたまま URL を組むと
 * `encodeURIComponent(null)` が**文字列 `"null"`** を作るので、例外も警告も出ず、
 * `/edit/p/{petId}/null` へ進む。トリマーは確定できたと思い、飼い主には届かない。
 *
 * ここで見るのは2つ。**どちらも「番号が無いなら、進まない」**:
 *   1. `saveReport` / `reviseReport` が、番号の無いカルテを**返さずに投げる**
 *   2. `commitReport` が、番号が無いときに**画面を移さず、理由を出す**
 *
 * 二重にしてあるのは、片方だけだと**片方が壊れた日に誰も気づかない**ため
 * （`F-20260828-52` で同じことを学んだ——結果だけを見る項が1本だと、層が
 * 1枚剥がれても緑のままになる）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 1. backend 側 ────────────────────────────────────────────── */

/** `api()` の応答を差し替えられる形で backend を読む。 */
async function loadStaff({ finalizeReport, reviseReport }) {
  globalThis.document = {
    querySelector: () => null,
    addEventListener() {},
    createElement: () => ({
      style: {}, dataset: {}, classList: { add() {}, remove() {} }, append() {},
    }),
  };
  globalThis.window = { addEventListener() {} };
  await import('../backend/js/supabase-staff.js');

  const calls = [];
  globalThis.TrimmerAuth = { client: {} };
  globalThis.TrimmerStaffApi = {
    request: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/finalize')) return { report: finalizeReport };
      /* **直しは `/revise` へ POST する**（`PATCH` ではない——`reports_staff_update_draft`
         が draft しか許さないので `revise_report` RPC を通す）。ここを取り違えていて、
         直しの検査だけが「投げない」に見えていた。 */
      if (url.endsWith('/revise')) return { report: reviseReport };
      /* 作る段は正しく番号を返す——**確定段だけ**が欠けている状況を作る。 */
      return { report: { id: 'report-1' } };
    },
  };
  return { staff: globalThis.TrimmerSupabaseStaff, calls };
}

test('確定が「番号の無いカルテ」を返したら、saveReport は投げる（返さない）', async () => {
  const { staff } = await loadStaff({ finalizeReport: { date: '2026-08-28' } });
  await assert.rejects(
    () => staff.saveReport('pet-1', { template: 'ponchi' }, '2026-08-28', null),
    /確定できませんでした/,
    '番号の無いカルテを、確定できたものとして返している',
  );
});

test('番号が null でも投げる（「空」だけを見ていては足りない）', async () => {
  const { staff } = await loadStaff({ finalizeReport: { id: null } });
  await assert.rejects(
    () => staff.saveReport('pet-1', { template: 'ponchi' }, '2026-08-28', null),
    /確定できませんでした/,
    'id: null を通している',
  );
});

test('直し（reviseReport）でも、番号の無いカルテは投げる', async () => {
  const { staff } = await loadStaff({ finalizeReport: { id: 'r1' }, reviseReport: { id: null } });
  await assert.rejects(
    () => staff.reviseReport('pet-1', 'report-1', { template: 'ponchi' }),
    /直せませんでした/,
    '直しの側だけ素通りしている',
  );
});

/* ── 2. 画面側 ────────────────────────────────────────────────── */

const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

/** 確定ボタンだけが在る、最小限の画面。`saved` に何が返るかを差し替えられる。 */
function loadApp(saved) {
  const button = { disabled: false };
  const navigated = [];
  const alerts = [];
  const location = {
    search: '',
    get href() { return 'http://localhost/edit/p/pet-1'; },
    set href(value) { navigated.push(value); },
  };
  const sandbox = {
    document: {
      getElementById: () => null,
      querySelector: (sel) => (sel === '.dock-action-wrap .boxbutton' ? button : null),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({
        style: {}, dataset: {}, classList: { add() {}, remove() {} }, append() {},
      }),
    },
    window: { addEventListener() {}, DUMMY: { dogs: [] } },
    location,
    setTimeout: () => {},
    clearTimeout: () => {},
    alert: (message) => alerts.push(message),
    console,
    __REPORT_CONTEXT__: { petId: 'pet-1' },
    TrimmerSupabaseStaff: {
      saveReport: async () => saved,
      reviseReport: async () => saved,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  const App = sandbox.__App;
  /* 記入欄を組み立てるのは、この検査の対象ではない。 */
  App.extractReport = () => ({ template: 'ponchi' });
  App.today = () => '2026-08-28';
  return { App, navigated, alerts, button };
}

test('番号の無いカルテが返ったら、画面を移さない（/null へ進まない）', async () => {
  const { App, navigated } = loadApp({ date: '2026-08-28' });
  await App.commitReport();
  assert.deepEqual(navigated, [], `画面を移している: ${navigated.join(', ')}`);
});

test('番号が null のとき、URL に文字列 "null" を埋めて進まない', async () => {
  const { App, navigated } = loadApp({ id: null });
  await App.commitReport();
  assert.ok(
    !navigated.some((url) => url.endsWith('/null')),
    `"null" を埋めた URL へ進んでいる: ${navigated.join(', ')}`,
  );
});

test('進まなかったとき、理由を出してボタンを押せる状態に戻す（行き止まりにしない）', async () => {
  const { App, alerts, button } = loadApp({ id: null });
  await App.commitReport();
  assert.equal(alerts.length, 1, '黙って止まっている（何が起きたか分からない）');
  assert.match(alerts[0], /保存できませんでした/);
  assert.equal(button.disabled, false, 'ボタンを押せないままにしている（やり直せない）');
});

test('番号が在るときは、これまでどおり進む（直しで機能を殺していない）', async () => {
  const { App, navigated } = loadApp({ id: 'report-9' });
  await App.commitReport();
  assert.deepEqual(navigated, ['/edit/p/pet-1/report-9']);
});

/* ── 3. 確定と下書きが噛み合わない（`F-20260910-79`） ──────────────

   下書きは写真を `data:image/…` のまま置く（実体化するのは確定の側）。
   サーバの確定（`finalize_report`）は「下書きに `data:image/` が残っていたら
   1件も返さない」と決めているので、**確定が中身を差し替えた後に下書きが
   着地すると、生の `data:image/` が書き戻されて確定が落ちる**
   （409 `report assets are incomplete`）。マスターが本番で
   「全項目入力した後でも保存できない」と踏んだのがこれ。

   `clearTimeout(this.draftTimer)` が止められるのは「これから出る」下書きだけで、
   **もう出てしまったもの**は止まらない。写真を選んだ直後や犬体図を閉じた直後は
   下書きが直に出ているので、そこが穴だった。 */

/** 下書きと確定の**順番**を記録できる画面。下書きは合図があるまで着地しない。 */
function loadAppWithDraft(saved = { id: 'report-9' }) {
  const order = [];
  let releaseDraft = () => {};
  const gate = new Promise((resolve) => { releaseDraft = resolve; });
  const sandbox = {
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({
        style: {}, dataset: {}, classList: { add() {}, remove() {} }, append() {},
      }),
    },
    window: { addEventListener() {}, DUMMY: { dogs: [] } },
    location: { search: '', get href() { return '/edit/p/pet-1'; }, set href(v) { order.push(`go:${v}`); } },
    setTimeout: () => {},
    clearTimeout: () => {},
    alert: () => {},
    console,
    __REPORT_CONTEXT__: { petId: 'pet-1' },
    TrimmerSupabaseStaff: {
      saveDraft: async () => { order.push('下書き:出た'); await gate; order.push('下書き:着地'); return 'draft-1'; },
      saveReport: async () => { order.push('確定:中身を差し替えた'); return saved; },
      reviseReport: async () => saved,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  const App = sandbox.__App;
  App.extractReport = () => ({ template: 'ponchi' });
  App.today = () => '2026-09-10';
  App.draftPetId = 'pet-1';
  return { App, order, releaseDraft };
}

test('飛んでいる下書きが着地してから確定する（確定の後に生の data:image を書き戻さない）', async () => {
  const { App, order, releaseDraft } = loadAppWithDraft();
  App.saveDraft();                 // 写真を選んだ直後・犬体図を閉じた直後にこれが直に出る
  const committing = App.commitReport();
  await new Promise((r) => setTimeout(r, 10));   // 確定を先に走らせてみる
  releaseDraft();
  await committing;
  assert.deepEqual(
    order,
    ['下書き:出た', '下書き:着地', '確定:中身を差し替えた', 'go:/edit/p/pet-1/report-9'],
    `下書きが確定より後に着地している: ${order.join(' → ')}`,
  );
});

test('確定を始めたら、新しい下書きは書かない', async () => {
  const { App, order, releaseDraft } = loadAppWithDraft();
  const committing = App.commitReport();
  App.saveDraft();                 // 確定の最中に入力が動いても、ここは書かせない
  releaseDraft();
  await committing;
  assert.ok(!order.includes('下書き:出た'), `確定の最中に下書きを書いている: ${order.join(' → ')}`);
});

test('確定に失敗したら、下書きをまた書ける状態に戻す（行き止まりにしない）', async () => {
  const { App, order, releaseDraft } = loadAppWithDraft({ id: null });
  releaseDraft();
  await App.commitReport();
  assert.equal(App.committing, false, '確定の印が立ったままで、以後どれだけ直しても下書きが1件も残らない');
  App.saveDraft();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(order.includes('下書き:出た'), `失敗の後に下書きを書けていない: ${order.join(' → ')}`);
});

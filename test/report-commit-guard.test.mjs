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

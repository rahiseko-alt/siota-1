/**
 * ui-draft-resume.test.mjs — 下書きの読み込みが、打った文字を上書きしないこと
 *
 * `docs/deferred.md` #27。`resumeDraft()` はサーバへ `findDraft` を投げ、戻ってきた
 * 中身を `applyReport()` で画面に書き戻す。**その往復の間、④の入力欄は打てる。**
 * 打ったかどうかを見ていなかったので、書いた文字が下書きの内容で**黙って上書き**
 * された（`D-20260824-30` の 1 と同じ型——消えたことに気づけない）。
 *
 * ここで見るのは3つ:
 *   1. 誰も触っていなければ、これまでどおり書き戻す（直しで機能を殺していないこと）
 *   2. 往復の**最中**に打たれたら、書き戻さない
 *   3. 書き戻さなかったときも、**下書きの id は引き継ぐ**
 *      —— 引き継がないと、同じ犬の下書きが2枚残る
 *   4. 書き戻さなかったことを**黙らない**（`D-12`）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

const DRAFT = { id: 'draft-1', data: { staffNote: '前回の続きです' } };

/**
 * `screen-3` と `dock-status-text` だけが在る最小限の画面。
 *
 * `panel.addEventListener('input', …)` を実際に拾って、**任意のタイミングで
 * 発火できる**ようにしてある。往復の最中に打つ状況は、これでしか作れない。
 */
function loadApp() {
  const listeners = [];
  const panel = {
    addEventListener: (type, fn) => { listeners.push({ type, fn }); },
    querySelectorAll: () => [],
  };
  const status = { textContent: '' };
  const applied = [];

  const document = {
    getElementById: (id) => {
      if (id === 'screen-3') return panel;
      if (id === 'dock-status-text') return status;
      return null;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {} }),
  };

  let resolveDraft;
  const pending = new Promise((resolve) => { resolveDraft = resolve; });

  const sandbox = {
    document,
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    setTimeout: () => {},
    clearTimeout: () => {},
    console,
    TrimmerSupabaseStaff: { findDraft: () => pending },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);

  const App = sandbox.__App;
  /* 書き戻しが起きたかどうかだけを見る。中身の当て方は `applyReport` の担当。 */
  App.applyReport = (data) => { applied.push(data); };
  /* 下書きの見張りは、この検査の対象ではない。 */
  App.watchDraft = () => {};

  const type = () => {
    for (const l of listeners) if (l.type === 'input') l.fn();
  };
  return { App, applied, status, type, deliver: () => { resolveDraft(DRAFT); return pending; } };
}

test('誰も触っていなければ、これまでどおり書き戻す', async () => {
  const { App, applied, deliver } = loadApp();
  App.resumeDraft('pet-1');
  await deliver();
  await new Promise((r) => setImmediate(r));

  assert.equal(applied.length, 1, '下書きを書き戻していない');
  assert.deepEqual(applied[0].staffNote, DRAFT.data.staffNote);
});

test('読み込みの最中に打たれたら、書き戻さない', async () => {
  const { App, applied, type, deliver } = loadApp();
  App.resumeDraft('pet-1');
  type();                       /* ← 往復の最中に人が打つ */
  await deliver();
  await new Promise((r) => setImmediate(r));

  assert.equal(applied.length, 0, '打った文字を下書きで上書きしている');
});

test('書き戻さなくても、下書きの id は引き継ぐ（下書きが2枚にならない）', async () => {
  const { App, type, deliver } = loadApp();
  App.resumeDraft('pet-1');
  type();
  await deliver();
  await new Promise((r) => setImmediate(r));

  assert.equal(App.draftReportId, DRAFT.id, '続きを書いたつもりが新しい下書きになる');
});

test('読み込まなかったことを、黙らずに伝える', async () => {
  const { App, status, type, deliver } = loadApp();
  App.resumeDraft('pet-1');
  type();
  await deliver();
  await new Promise((r) => setImmediate(r));

  assert.match(status.textContent, /読み込みませんでした/, '黙って捨てている');
});

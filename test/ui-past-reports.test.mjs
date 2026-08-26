/**
 * ui-past-reports.test.mjs — その犬の過去カルテが、同じ画面に出ること
 *
 * `docs/deferred.md` #23（マスター指定 2026-08-26「③で犬を選んだら過去一覧を出す」）。
 * `mapPet()` は `months`（過去カルテ）を持って来ているのに受け皿が無く、
 * 犬を選ぶと過去を一度も見られないまま新規作成に入っていた。
 *
 * ここで押さえるのは4つ:
 *   1. 確定済み（`final`）だけが出る —— 下書きは飼い主に届いていない
 *   2. 新しい順に並ぶ
 *   3. **1件も無ければ帯ごと出さない**（`D-10`「未記入は空で出す」——
 *      空の一覧は「まだ無い」と「読み込めていない」の区別を消す）
 *   4. 行き先が `/edit/p/{petId}/{reportId}` になっている
 *
 * `src/js/ui.js` は古典スクリプトなので import できない。`vm` に最小限の
 * `document` を置いて読み込む（`ui-extract-report.test.mjs` と同じ形）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

/** `past-reports` と `past-reports-list` だけが在る、最小限の画面。 */
function loadApp() {
  const made = [];
  const wrap = { hidden: false };
  const list = {
    textContent: 'まだ消していない何か',
    children: [],
    append(node) { this.children.push(node); },
  };
  const document = {
    getElementById: (id) => {
      if (id === 'past-reports') return wrap;
      if (id === 'past-reports-list') return list;
      return null;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => {
      const node = { style: {}, classList: { add() {}, remove() {} }, append() {} };
      made.push(node);
      return node;
    },
  };
  const sandbox = {
    document,
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    setTimeout: () => {},
    clearTimeout: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  /* `ui.js` は `const App = {…}` で、外へ出していない（古典スクリプトなので
     それでよい）。`ui-extract-report.test.mjs` と同じく、末尾で拾い上げる。 */
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  return { App: sandbox.__App, wrap, list };
}

const PET = {
  id: 'pet-1',
  months: [
    { reportId: 'r-old', date: '2026-06-05', status: 'final' },
    { reportId: 'r-draft', date: '2026-08-26', status: 'draft' },
    { reportId: 'r-new', date: '2026-08-15', status: 'final' },
    { reportId: 'r-arch', date: '2026-07-01', status: 'archived' },
  ],
};

test('確定済みだけが、新しい順に出る', () => {
  const { App, wrap, list } = loadApp();
  App.renderPastReports(PET);

  assert.equal(wrap.hidden, false, '過去カルテが在るのに帯が隠れている');
  assert.equal(list.children.length, 2, '下書き・archived まで出している');
  assert.deepEqual(
    list.children.map((c) => c.textContent),
    ['2026.08.15', '2026.06.05'],
    '新しい順になっていない',
  );
});

test('行き先が /edit/p/{petId}/{reportId} になっている', () => {
  const { App, list } = loadApp();
  App.renderPastReports(PET);
  assert.deepEqual(
    list.children.map((c) => c.href),
    ['/edit/p/pet-1/r-new', '/edit/p/pet-1/r-old'],
  );
});

test('1件も無ければ、帯ごと出さない（D-10）', () => {
  for (const pet of [
    { id: 'pet-1', months: [] },
    { id: 'pet-1', months: [{ reportId: 'r-draft', date: '2026-08-26', status: 'draft' }] },
    { id: 'pet-1' },
    {},
  ]) {
    const { App, wrap, list } = loadApp();
    App.renderPastReports(pet);
    assert.equal(wrap.hidden, true, `空の一覧を出している: ${JSON.stringify(pet)}`);
    assert.equal(list.children.length, 0);
    /* 前に出していたものが残らないこと——犬を選び直したとき、
       前の子の過去カルテが残ると**別の子の履歴を見せる**ことになる。 */
    assert.equal(list.textContent, '', '前の中身が残っている');
  }
});

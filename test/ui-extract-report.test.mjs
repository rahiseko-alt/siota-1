/**
 * ui-extract-report.test.mjs — ④が出すものが、⑥が読む形になっていること
 *
 * `docs/ops/key-parity-F3.md` の突き合わせを、値の側から押さえる。
 * `scripts/guard/key-parity.mjs` は**キーの名前**を見るが、ここは
 * **触っていない項目がキーごと出ないこと**を見る——空の器を出すと、
 * ⑥側で「記録なし」と「入力欄が無い」を区別できなくなる（`D-10`）。
 *
 * `src/js/ui.js` は古典スクリプトなので import できない。`vm` に最小限の
 * `document` を置いて読み込む（`ui-body-marking.test.mjs` と同じ形）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

/** `vm` の中で作られた object は、こちらの realm とは `Object.prototype` が違う。
    `deepStrictEqual` は prototype も見るので、中身が同じでも落ちる
    （`Values have same structure but are not reference-equal`）。
    形だけを比べたいので、素の値に均してから比べる。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** `[data-field="…"]` と `#marking-canvas` だけが在る、最小限の画面。 */
function loadApp({ fields = {}, petName = null } = {}) {
  const document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: (selector) => {
      const m = selector.match(/^\[data-field="([a-z-]+)"\]$/);
      if (m && Object.prototype.hasOwnProperty.call(fields, m[1])) return { value: fields[m[1]] };
      return null;
    },
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {} }),
  };
  const sandbox = {
    document,
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    setTimeout: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  if (petName) sandbox.__REPORT_CONTEXT__ = { petName };
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  return sandbox.__App;
}

test('何も触っていないカルテは、キーを1つも出さない', () => {
  const App = loadApp();
  App.marks = [];
  assert.deepEqual(plain(App.extractReport()), {});
});

test('触った項目だけがキーになる（触っていない項目は器ごと出さない）', () => {
  const App = loadApp({ fields: { 'staff-note': '耳の裏を丁寧に洗いました。' } });
  App.marks = [];
  App.form.nail.front = 2;
  const out = App.extractReport();
  assert.deepEqual(plain(out), { staffNote: '耳の裏を丁寧に洗いました。', nail: { front: 2, rear: 0 } });
  assert.ok(!('ear' in out), '触っていない耳が出ている');
  assert.ok(!('teeth' in out), '触っていない歯が出ている');
  assert.ok(!('weights' in out), '触っていない体重が出ている');
});

test('犬の名前は backend が置いた文脈から取る（画面の見出しから読まない）', () => {
  const App = loadApp({ petName: 'X' });
  App.marks = [];
  assert.equal(App.extractReport().pet, 'X');
});

test('耳は左右そろって1つのキーになる（片方だけ触っても両方出る）', () => {
  const App = loadApp();
  App.marks = [];
  App.form.ear.right = 3;
  assert.deepEqual(plain(App.extractReport().ear), { right: 3, left: 0 });
});

test('空白だけの一言は、書かれていないものとして扱う', () => {
  const App = loadApp({ fields: { 'staff-note': '   \n  ' } });
  App.marks = [];
  assert.ok(!('staffNote' in App.extractReport()));
});

test('⑥が読むキーの外は出さない（届かないキーを作らない）', () => {
  const READ_BY_MAGAZINE = new Set(
    [...fs.readFileSync(path.join(ROOT, 'backend/js/magazine-view.js'), 'utf8')
      .matchAll(/\bdata\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
  const App = loadApp({
    petName: 'X',
    fields: { 'staff-note': 'a', course: 'トリミングコース' },
  });
  App.marks = [];
  App.form = {
    nail: { front: 1, rear: 1 }, ear: { right: 1, left: 2 }, teeth: 'ピカピカ✨', weight: 2.8,
    bcs: 3, bestWeight: 3.5, options: ['アメージング'],
  };
  App.photos = { trimming: [], ear: '', teeth: [] };
  for (const key of Object.keys(App.extractReport())) {
    assert.ok(READ_BY_MAGAZINE.has(key), `⑥が読まないキーを出している: ${key}`);
  }
});

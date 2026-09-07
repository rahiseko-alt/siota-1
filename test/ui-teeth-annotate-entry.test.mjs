/**
 * ui-teeth-annotate-entry.test.mjs — 歯の写真に「書き込む」入口が**見える形で**在ること
 *
 * マスター指示（2026-09-07）:「歯の添付写真にペンで書き込めるようにしろ」。
 *
 * 書き込みの機能自体は 2026-08-29（`C-10`）から在った。だが入口は
 * **画像を直接タップする**だけで、案内は `title`（マウスを乗せたときだけ出る吹き出し）
 * しか無かった。**スマホには `title` が出ない**——押せると分からないものは、
 * 使えないのと同じ（`D-12`「押せた ではなく 届いた で見る」の手前の問題）。
 *
 * ここが見るのは2つだけ:
 *   ①歯の写真1枚につき、押せる入口が1つ出ること
 *   ②その入口を押すと、書き込みが開くこと
 *
 * **この検査が保証しないこと**: 入口が指で届く大きさか・読める文字かは見ていない
 * （それは `npm run walk` の写真で人が見る・`D-14`）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

/** 写真の一覧だけが本物らしく振る舞う画面の替え玉。 */
function loadThumbsScreen(kind) {
  const made = [];
  const box = { textContent: '', children: [], appendChild(el) { this.children.push(el); } };
  const createElement = (tag) => {
    const el = {
      tag,
      className: '',
      type: '',
      textContent: '',
      title: '',
      style: {},
      dataset: {},
      onclick: null,
      children: [],
      appendChild(child) { this.children.push(child); },
    };
    made.push(el);
    return el;
  };
  const document = {
    querySelector: (selector) => (selector === `[data-photo-thumbs="${kind}"]` ? box : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement,
    addEventListener: () => {},
    body: { appendChild: () => {} },
  };
  const sandbox = {
    document,
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    setTimeout: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);

  const App = sandbox.__App;
  App.photos = { trimming: [], ear: '', teeth: [DATA_URL] };
  App.saveDraft = () => {};
  return { App, box };
}

const annotateButtons = (box) => box.children
  .flatMap((cell) => cell.children)
  .filter((el) => el.dataset && el.dataset.annotate === 'teeth');

test('歯の写真1枚につき、押せる「書き込む」入口が1つ出る', () => {
  const { App, box } = loadThumbsScreen('teeth');
  App.renderPhotoThumbs('teeth');
  const buttons = annotateButtons(box);
  assert.equal(buttons.length, 1, '書き込みの入口が見える形で置かれていない');
  assert.equal(buttons[0].tag, 'button', '押せるもの（button）になっていない');
  assert.ok(buttons[0].textContent.includes('書き込む'), `何をする入口か読めない: "${buttons[0].textContent}"`);
});

test('その入口を押すと、書き込みが開く', () => {
  const { App, box } = loadThumbsScreen('teeth');
  App.renderPhotoThumbs('teeth');
  let opened = null;
  App.openAnnotate = (kind, index) => { opened = [kind, index]; };
  annotateButtons(box)[0].onclick();
  assert.deepEqual(opened, ['teeth', 0], '押しても書き込みが開かない');
});

test('保存済み（asset://）の写真には、書き込みの入口を出さない', () => {
  /* 実体は認証つきでしか取れず、絵にできない。**開けないものを押させない**。 */
  const { App, box } = loadThumbsScreen('teeth');
  App.photos.teeth = ['asset://11111111-1111-1111-1111-111111111111'];
  App.renderPhotoThumbs('teeth');
  assert.equal(annotateButtons(box).length, 0, '開けない写真に入口を出している');
});

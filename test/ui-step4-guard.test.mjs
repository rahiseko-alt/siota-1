/**
 * ui-step4-guard.test.mjs — 「04 顧客カルテ」を、中身が無いまま開かないこと
 *
 * 段のタブ（`01/02/03/04`）は**本番の動線として使う**——マスター回答 2026-08-27
 * （`docs/deferred.md` #2 の決着）。使うと決まった以上、押したときに何が出るかが
 * 本番の品質になる。
 *
 * `screen-4` の中身は `renderMagazine` が `innerHTML` ごと差し替えるまで**意匠の器**。
 * 確定前に「04」を押すと、見出しだけその犬の名前で**空の雑誌**が出ていた。
 * `D-12`「押せた ではなく 届いた」で見れば、これは届いていない——
 * ②の穴（`verify:m6` が見つけたもの）とまったく同じ形。
 *
 * ここで見るのは3つ:
 *   1. 描く前に「04」を押したら、**器の中身が案内に置き換わる**（空の雑誌を出さない）
 *   2. 描いたあとは**素通し**——直しで機能を殺していないこと
 *   3. Supabase を積んでいない静的配信（`walk` の経路）では**何もしない**
 *      ——あちらは意匠を見るための経路で、器を消すと絵の意味が変わる（`watch.md` W-2）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

/** `screen-4` だけが中身を持つ、最小限の画面。 */
function loadApp({ withStaff = true } = {}) {
  const made = [];
  const panel = {
    textContent: '意匠の器（体重グラフや見出しが並んでいる想定）',
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    append(node) { this.children.push(node); },
  };
  const document = {
    getElementById: (id) => (id === 'screen-4' ? panel : null),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => {
      const node = { style: {}, dataset: {}, classList: { add() {}, remove() {} }, append() {} };
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
  if (withStaff) sandbox.TrimmerSupabaseStaff = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  const App = sandbox.__App;
  /* 画面の上端へ運ぶのは、この検査の対象ではない。 */
  sandbox.window.scrollTo = () => {};
  return { App, panel };
}

test('描く前に「04」を押すと、空の雑誌ではなく案内が出る', () => {
  const { App, panel } = loadApp();
  App.goToStep(4);

  assert.equal(panel.textContent, '', '意匠の器がそのまま残っている');
  assert.equal(panel.children.length, 1, '案内を出していない');
  assert.match(panel.children[0].textContent, /まだ確定していません/);
  assert.match(panel.children[0].textContent, /03 カルテ作成/, '次にどうすればよいか書いていない');
});

test('描いたあとは素通し（器を消さない）', () => {
  const { App, panel } = loadApp();
  App.magazineReady = true;
  App.goToStep(4);

  assert.notEqual(panel.textContent, '', '描いたあとの中身を消している');
  assert.equal(panel.children.length, 0, '描いたあとに案内を足している');
});

test('ほかの段（03）は、この判定に巻き込まれない', () => {
  const { App, panel } = loadApp();
  App.goToStep(3);

  assert.notEqual(panel.textContent, '', '④以外でも器を消している');
});

test('静的配信（Supabase を積んでいない）では何もしない — walk の絵が変わらないように', () => {
  const { App, panel } = loadApp({ withStaff: false });
  App.goToStep(4);

  assert.notEqual(panel.textContent, '', '意匠を見る経路で器を消している');
  assert.equal(panel.children.length, 0);
});

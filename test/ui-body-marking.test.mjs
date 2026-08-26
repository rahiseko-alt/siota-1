/**
 * ui-body-marking.test.mjs — 犬体図に付けた印が、消えずに取り出せること
 *
 * `docs/ops/bad-scenarios-F3.md` #3 の再発防止。
 * トリマーが「🔴 赤み」「🟡 しこり/イボ」「🔵 毛玉」と付けた印は `App.marks` に
 * 載っているだけで、保存する道が無かった。受け手（`magazine-view.js` の
 * `data.bodyMarkingImage`）だけが在る状態で、**見つけた所見が飼い主にも記録にも
 * 残らず消えて**いた。
 *
 * `src/js/ui.js` は古典スクリプト（`type="module"` ではない）なので import できない。
 * ここでは `vm` に最小限の `document` / `window` を置いて読み込む。
 * **これは #10（画面側と裏側で部品の作りが違う）が未解決であることの現れでもある。**
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

/** 画面の最小限の替え玉。`marking-canvas` だけが本物らしく振る舞う。 */
function loadApp({ withCanvas = true, width = 300, height = 200 } = {}) {
  const drawn = [];
  const canvas = {
    width,
    height,
    getContext: () => new Proxy({}, {
      get: (_, key) => (key === 'canvas' ? canvas : (...args) => drawn.push([key, ...args])),
    }),
    toDataURL: (type) => { drawn.push(['toDataURL', type]); return DATA_URL; },
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
  };
  const document = {
    getElementById: (id) => {
      if (id === 'marking-canvas') return withCanvas ? canvas : null;
      return null;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
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
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  return { App: sandbox.__App, drawn };
}

test('印が1つも無いときは null（白紙の絵を「所見あり」として残さない）', () => {
  const { App } = loadApp();
  App.marks = [];
  assert.equal(App.exportBodyMarking(), null);
});

test('印を付けたら、カルテに残せる形で取り出せる', () => {
  const { App, drawn } = loadApp();
  App.marks = [{ x: 0.5, y: 0.5, type: 'しこり/イボ' }];
  const out = App.exportBodyMarking();
  assert.equal(out, DATA_URL);
  /* 取り出す前に描き直していること（印を載せずに空の絵を出さない）。 */
  assert.ok(drawn.some(([op]) => op === 'arc'), '印が描かれていない');
  assert.ok(drawn.some(([op]) => op === 'toDataURL'));
});

test('印の種類が変わっても、消えずに残る', () => {
  for (const type of ['赤み', 'しこり/イボ', '毛玉']) {
    const { App } = loadApp();
    App.marks = [{ x: 0.2, y: 0.3, type }];
    assert.equal(App.exportBodyMarking(), DATA_URL, `${type} が取り出せない`);
  }
});

test('印が在るのに描き先が無いときは、黙って null を返さず投げる', () => {
  const { App } = loadApp({ withCanvas: false });
  App.marks = [{ x: 0.5, y: 0.5, type: 'しこり/イボ' }];
  assert.throws(() => App.exportBodyMarking(), /印を保存できません/);
});

test('⑥の受け手が読むキーは bodyMarkingImage である（出す側と受ける側の突き合わせ）', () => {
  const view = fs.readFileSync(path.join(ROOT, 'backend/js/magazine-view.js'), 'utf8');
  assert.ok(
    view.includes('data.bodyMarkingImage'),
    '受け手が data.bodyMarkingImage を読まなくなった。出す側（exportBodyMarking）の行き先が消えている',
  );
});

/* `verify:roundtrip` の 8 と 15 が実際に落ちて見つかった欠陥の再発防止。

   `screen-3` は読み込み直後 `is-active` ではないので、そのときに器を測ると
   `clientWidth === 0` になり、描画面が 0×0 のまま固定される。その状態で
   `toDataURL()` を呼ぶと `data:,`——**中身の無い画像**が返る。
   それを保存すると「印を残した」ことになり、飼い主には空が届く（`#3` そのもの）。 */
test('描画面の大きさが取れないときは、空の画像を返さずに投げる', () => {
  const { App } = loadApp({ width: 0, height: 0 });
  App.marks = [{ x: 0.5, y: 0.5, type: '赤み' }];
  assert.throws(() => App.exportBodyMarking(), /大きさを取れない/);
});

test('印が無ければ、大きさが取れなくても null（投げない）', () => {
  const { App } = loadApp({ width: 0, height: 0 });
  App.marks = [];
  assert.equal(App.exportBodyMarking(), null);
});

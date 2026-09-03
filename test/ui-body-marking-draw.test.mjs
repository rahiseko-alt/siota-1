/**
 * ui-body-marking-draw.test.mjs — 犬体4面図は「なぞって描ける」こと
 *
 * マスター指示（2026-09-02）:
 *   「現状はスタンプ押すだけ。本来は描画機能がある。描画機能の一部にスタンプ機能がある」
 *
 * スタンプは点しか置けないので「ここからここまで赤い」という**範囲**が書けない。
 * トリマーが体を触って見つけたものを、見つけたままの形で残せないという欠けで、
 * `docs/ops/bad-scenarios-F3.md` #3（見つけた所見が消える）と同じ側の問題である。
 *
 * `src/js/ui.js` は古典スクリプト（`type="module"` ではない）なので import できない。
 * `ui-body-marking.test.mjs` と同じく `vm` に最小限の画面を置いて読み込む。
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

/** 犬体4面図だけが本物らしく振る舞う画面の替え玉。指は `fire()` で送る。 */
function loadCanvasScreen() {
  const drawn = [];
  const handlers = new Map();
  const canvas = {
    width: 400,
    height: 275,
    getContext: () => new Proxy({}, {
      get: (_, key) => (key === 'canvas' ? canvas : (...args) => drawn.push([key, ...args])),
      set: (_, key, value) => { drawn.push(['set:' + String(key), value]); return true; },
    }),
    toDataURL: () => DATA_URL,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 275 }),
    addEventListener: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
    },
  };
  const document = {
    getElementById: (id) => (id === 'marking-canvas' ? canvas : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {} }),
    addEventListener: () => {},
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
  App.marks = [];
  App.initCanvas();

  const fire = (type, pointerId, clientX, clientY) => {
    for (const handler of handlers.get(type) || []) handler({ pointerId, clientX, clientY });
  };
  return { App, fire, drawn };
}

test('指でなぞると、線が1本残る（点ではなく範囲が書ける）', () => {
  const { App, fire } = loadCanvasScreen();
  fire('pointerdown', 1, 40, 40);
  fire('pointermove', 1, 80, 60);
  fire('pointermove', 1, 120, 90);
  fire('pointerup', 1, 120, 90);
  assert.equal(App.marks.length, 1);
  assert.ok(Array.isArray(App.marks[0].points), 'なぞった線として残っていない');
  assert.equal(App.marks[0].points.length, 3);
  assert.equal(App.marks[0].type, '赤み');
});

test('なぞった線は、実際に引かれる（lineTo が出る）', () => {
  const { fire, drawn } = loadCanvasScreen();
  fire('pointerdown', 1, 40, 40);
  const mark = drawn.length;
  fire('pointermove', 1, 200, 120);
  assert.ok(drawn.slice(mark).some(([op]) => op === 'lineTo'), '線が引かれていない');
});

test('なぞらずに触れただけなら、印は残らない（見えないものを送らない）', () => {
  const { App, fire } = loadCanvasScreen();
  fire('pointerdown', 1, 40, 40);
  fire('pointerup', 1, 40, 40);
  assert.equal(App.marks.length, 0);
});

test('スタンプに切り替えれば、タップで丸が1つ置ける', () => {
  const { App, fire, drawn } = loadCanvasScreen();
  App.setMarkMode('スタンプ', null);
  const mark = drawn.length;
  fire('pointerdown', 1, 40, 40);
  fire('pointerup', 1, 40, 40);
  assert.equal(App.marks.length, 1);
  assert.equal(App.marks[0].points, undefined);
  assert.ok(drawn.slice(mark).some(([op]) => op === 'arc'), 'スタンプが描かれていない');
});

test('2本目の指は無視する（線が混ざって暴れない）', () => {
  const { App, fire } = loadCanvasScreen();
  fire('pointerdown', 1, 40, 40);
  fire('pointerdown', 2, 300, 200);
  fire('pointermove', 2, 320, 210);
  fire('pointermove', 1, 60, 50);
  assert.equal(App.marks.length, 1, '2本目の指で線が増えている');
  assert.equal(App.marks[0].points.length, 2, '2本目の指の座標が線に混ざっている');
});

test('1つ戻すは、直前の1件だけ消す', () => {
  const { App, fire } = loadCanvasScreen();
  App.setMarkMode('スタンプ', null);
  fire('pointerdown', 1, 40, 40);
  fire('pointerup', 1, 40, 40);
  App.setMarkMode('なぞる', null);
  fire('pointerdown', 2, 100, 100);
  fire('pointermove', 2, 160, 140);
  fire('pointerup', 2, 160, 140);
  assert.equal(App.marks.length, 2);
  App.undoMark();
  assert.equal(App.marks.length, 1);
  assert.equal(App.marks[0].points, undefined, '消えたのが線ではなくスタンプになっている');
});

test('線とスタンプは、同じ種類なら同じ色', () => {
  const { App } = loadCanvasScreen();
  for (const type of ['赤み', 'しこり/イボ', '毛玉', 'フケ']) {
    assert.match(App.markColor(type), /^#[0-9a-f]{6}$/);
  }
  assert.notEqual(App.markColor('赤み'), App.markColor('毛玉'));
});

test('線しか無くても、カルテに残せる形で取り出せる', () => {
  const { App, fire } = loadCanvasScreen();
  fire('pointerdown', 1, 40, 40);
  fire('pointermove', 1, 90, 70);
  fire('pointerup', 1, 90, 70);
  assert.equal(App.exportBodyMarking(), DATA_URL);
});

test('古い下書きのスタンプだけの印も、そのまま描ける', () => {
  const { App, drawn } = loadCanvasScreen();
  App.marks = [{ x: 0.5, y: 0.5, type: 'しこり/イボ' }];
  const mark = drawn.length;
  App.drawCanvas();
  assert.ok(drawn.slice(mark).some(([op]) => op === 'arc'), '古い形の印が描かれない');
});

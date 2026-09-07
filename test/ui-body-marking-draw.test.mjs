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
/** `typed` は「文字」の道具で打つ内容（`''` なら何も打たずに閉じたのと同じ）。 */
function loadCanvasScreen(typed = '要観察') {
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
    /* 「文字」の道具が何を打たれたか（マスター指示 2026-09-07）。 */
    prompt: () => typed,
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

test('ペンでなぞると、線が1本残る（点ではなく範囲が書ける）', () => {
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
  App.setMarkMode('ペン', null);
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

/* ── ペンの色と太さ（マスター指示 2026-09-07「ペンは全て、色と太さを調整できるようにしろ」） ── */

test('選んだ色と太さで描かれる（線ごとに覚える）', () => {
  const { App, fire, drawn } = loadCanvasScreen();
  App.setPenColor('#00a3ff');
  App.setPenWidth(12);
  const mark = drawn.length;
  fire('pointerdown', 1, 40, 40);
  fire('pointermove', 1, 120, 90);
  fire('pointerup', 1, 120, 90);
  assert.equal(App.marks[0].color, '#00a3ff', '線が色を覚えていない');
  assert.equal(App.marks[0].width, 12, '線が太さを覚えていない');
  const after = drawn.slice(mark);
  assert.ok(after.some(([op, value]) => op === 'set:strokeStyle' && value === '#00a3ff'),
    '選んだ色で引かれていない');
  assert.ok(after.some(([op, value]) => op === 'set:lineWidth' && value === 12),
    '選んだ太さで引かれていない');
});

test('色や太さを変えても、先に引いた線は変わらない', () => {
  const { App, fire } = loadCanvasScreen();
  App.setPenColor('#00a3ff');
  App.setPenWidth(2);
  fire('pointerdown', 1, 40, 40);
  fire('pointermove', 1, 90, 70);
  fire('pointerup', 1, 90, 70);
  App.setPenColor('#123456');
  App.setPenWidth(18);
  fire('pointerdown', 2, 200, 100);
  fire('pointermove', 2, 260, 150);
  fire('pointerup', 2, 260, 150);
  assert.deepEqual(
    App.marks.map((m) => [m.color, m.width]),
    [['#00a3ff', 2], ['#123456', 18]],
    '後から変えた道具が、前に引いた線まで塗り替えている',
  );
});

test('所見の種類を選び直すと、色はその所見の色に戻る', () => {
  const { App } = loadCanvasScreen();
  App.setPenColor('#00a3ff');
  App.setStamp('毛玉', null);
  assert.equal(App.penColor, App.markColor('毛玉'), '種類を選び直しても色が戻らない');
});

test('太さは1〜20の外へ出さない（0や巨大な値で描かない）', () => {
  const { App } = loadCanvasScreen();
  App.setPenWidth(0);
  assert.equal(App.penWidth, 1);
  App.setPenWidth(999);
  assert.equal(App.penWidth, 20);
  App.setPenWidth('よくわからない値');
  assert.equal(App.penWidth, 4, '数でないものを渡されたら既定に戻す');
});

test('色と太さを持たない古い印も、これまでどおり描ける（下書きや確定済みが壊れない）', () => {
  const { App, drawn } = loadCanvasScreen();
  App.marks = [{ type: '赤み', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] }];
  const mark = drawn.length;
  App.drawCanvas();
  const after = drawn.slice(mark);
  assert.ok(after.some(([op, value]) => op === 'set:strokeStyle' && value === App.markColor('赤み')),
    '古い印が所見の色で描かれていない');
  assert.ok(after.some(([op, value]) => op === 'set:lineWidth' && value === 4),
    '古い印がこれまでの太さで描かれていない');
});

/* ── 透過度・消しゴム・文字（マスター指示 2026-09-07） ── */

test('透過度を下げると、その薄さで描かれる', () => {
  const { App, fire, drawn } = loadCanvasScreen();
  App.setPenAlpha(0.4);
  const mark = drawn.length;
  fire('pointerdown', 1, 40, 40);
  fire('pointermove', 1, 120, 90);
  assert.equal(App.marks[0].alpha, 0.4, '線が薄さを覚えていない');
  assert.ok(drawn.slice(mark).some(([op, value]) => op === 'set:globalAlpha' && value === 0.4),
    '選んだ薄さで描かれていない');
});

test('透過度は0.1〜1の外へ出さない', () => {
  const { App } = loadCanvasScreen();
  App.setPenAlpha(0);
  assert.equal(App.penAlpha, 0.1, '完全に透明（＝見えない印）にできてしまう');
  App.setPenAlpha(5);
  assert.equal(App.penAlpha, 1);
});

test('消しゴムは、触れた線を1本だけ取り除く（下絵は消さない）', () => {
  const { App, fire } = loadCanvasScreen();
  fire('pointerdown', 1, 40, 40);
  fire('pointermove', 1, 120, 40);
  fire('pointerup', 1, 120, 40);
  fire('pointerdown', 2, 40, 200);
  fire('pointermove', 2, 120, 200);
  fire('pointerup', 2, 120, 200);
  assert.equal(App.marks.length, 2);
  App.setMarkMode('消しゴム', null);
  fire('pointerdown', 3, 80, 40);
  fire('pointerup', 3, 80, 40);
  assert.equal(App.marks.length, 1, '触れた線が消えていないか、2本とも消えている');
  assert.equal(App.marks[0].points[0].y > 0.5, true, '残ったのが別の線になっている');
});

test('消しゴムは、線の途中を触っても消せる（点と点の間も線）', () => {
  const { App, fire } = loadCanvasScreen();
  fire('pointerdown', 1, 20, 40);
  fire('pointermove', 1, 380, 40);
  fire('pointerup', 1, 380, 40);
  App.setMarkMode('消しゴム', null);
  fire('pointerdown', 2, 200, 40);
  assert.equal(App.marks.length, 0, '点が飛んでいる線の真ん中を触っても消えない');
});

test('文字は、押した所に置かれる', () => {
  const { App, fire, drawn } = loadCanvasScreen();
  App.setMarkMode('文字', null);
  const mark = drawn.length;
  fire('pointerdown', 1, 100, 80);
  assert.equal(App.marks.length, 1);
  assert.equal(App.marks[0].text, '要観察');
  assert.ok(drawn.slice(mark).some(([op, value]) => op === 'fillText' && value === '要観察'),
    '打った文字が描かれていない');
});

test('文字は、何も打たなければ何も置かない', () => {
  const { App, fire } = loadCanvasScreen('   ');
  App.setMarkMode('文字', null);
  fire('pointerdown', 1, 100, 80);
  assert.equal(App.marks.length, 0, '空の印が残っている（見えないものを送らない）');
});

test('文字の大きさは太さに連れて変わる（道具を増やさない）', () => {
  const { App, fire } = loadCanvasScreen();
  App.setPenWidth(10);
  App.setMarkMode('文字', null);
  fire('pointerdown', 1, 100, 80);
  assert.equal(App.marks[0].size, 40);
});

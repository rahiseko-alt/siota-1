/**
 * ui-annotate-pinch.test.mjs — 写真の書き込み画面で、2本指が「拡大」になること
 *
 * この1点は2度こわれている。
 *   1度目: `pointerId` を区別せず、2本の指の座標が1本の線に混ざった
 *          （マスター報告「写真にピンチすると線がバーってなる」）。
 *   2度目: 2本目の指を**無視**したので線は落ち着いたが、拡大を誰も実装して
 *          いないため**ピンチしても何も起きない**（マスター報告「ピンチできない」）。
 * どちらの型でも赤くなるように、次の3つを機械で見る。
 *   - 2本指を置いたら、1本目が引きかけた線が**消える**（線が増えない）
 *   - 2本指を広げたら、表示が**拡大される**（`transform` の scale が 1 を超える）
 *   - ピンチの最中に**線が引かれない**
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

/** 書き込み画面の最小限の替え玉。指の出し入れは `fire()` で送る。 */
function openAnnotateInFakeScreen() {
  const drawn = [];
  const handlers = new Map();

  const canvas = {
    width: 0,
    height: 0,
    style: {},
    offsetWidth: 300,
    offsetHeight: 200,
    getContext: () => new Proxy({}, {
      get: (_, key) => (key === 'canvas' ? canvas : (...args) => drawn.push([key, ...args])),
      /* 代入も残す。色と太さは呼び出しではなく**代入**で決まるので、
         `set` を捨てていると「何色で引いたか」を誰も見られない。 */
      set: (_, key, value) => { drawn.push([`set:${String(key)}`, value]); return true; },
    }),
    toDataURL: () => DATA_URL,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
    addEventListener: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
    },
  };
  const wrap = {
    clientWidth: 300,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
  };
  const button = () => ({ onclick: null });
  /* ペンの道具（マスター指示 2026-09-07）。本物と同じく `oninput` で受ける。 */
  const field = (value) => ({ value, oninput: null });
  const parts = {
    '.annotate-canvas': canvas,
    '.annotate-canvas-wrap': wrap,
    '.annotate-clear': button(),
    '.annotate-cancel': button(),
    '.annotate-save': button(),
    '.annotate-color': field('#d32f2f'),
    '.annotate-width': field('4'),
    '.annotate-width-value': { textContent: '' },
  };
  const overlay = {
    className: '',
    innerHTML: '',
    querySelector: (selector) => parts[selector] || null,
    remove: () => {},
  };

  const document = {
    body: { appendChild: () => {} },
    createElement: () => overlay,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  /* 画像の読み込みは即座に終わったことにする。書き込み面の画素数はここで決まる。 */
  class FakeImage {
    constructor() {
      this.onload = null;
      this.naturalWidth = 600;
      this.naturalHeight = 400;
    }

    set src(_value) {
      if (this.onload) this.onload();
    }
  }
  const sandbox = {
    document,
    Image: FakeImage,
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    innerHeight: 640,
    setTimeout: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);

  const App = sandbox.__App;
  App.photos = { trimming: [], ear: '', teeth: [DATA_URL] };
  App.renderPhotoThumbs = () => {};
  App.saveDraft = () => {};
  App.openAnnotate('teeth', 0);

  const fire = (type, pointerId, clientX, clientY) => {
    for (const handler of handlers.get(type) || []) handler({ pointerId, clientX, clientY });
  };
  const strokesDrawnSince = (mark) => drawn.slice(mark).filter(([key]) => key === 'stroke').length;
  return { App, canvas, fire, drawn, strokesDrawnSince, parts };
}

test('1本指では、なぞった線が引かれる', () => {
  const { fire, drawn, strokesDrawnSince } = openAnnotateInFakeScreen();
  const mark = drawn.length;
  fire('pointerdown', 1, 10, 10);
  fire('pointermove', 1, 60, 10);
  assert.equal(strokesDrawnSince(mark), 1);
});

test('2本目の指が触れたら、引きかけの線は消える（線が増えない）', () => {
  const { fire, drawn, strokesDrawnSince } = openAnnotateInFakeScreen();
  fire('pointerdown', 1, 10, 10);
  fire('pointermove', 1, 60, 10);
  const mark = drawn.length;
  fire('pointerdown', 2, 200, 10);
  assert.equal(strokesDrawnSince(mark), 0, '2本指にした時点で、線が残っている');
});

test('2本指を広げると拡大される（ピンチができる）', () => {
  const { canvas, fire } = openAnnotateInFakeScreen();
  fire('pointerdown', 1, 140, 100);
  fire('pointerdown', 2, 160, 100);
  fire('pointermove', 1, 40, 100);
  fire('pointermove', 2, 260, 100);
  const scale = Number((/scale\(([0-9.]+)\)/.exec(canvas.style.transform || '') || [])[1]);
  assert.ok(scale > 1, `ピンチで拡大されていない（transform=${canvas.style.transform}）`);
});

test('ピンチの最中は線が引かれない', () => {
  const { fire, drawn, strokesDrawnSince } = openAnnotateInFakeScreen();
  fire('pointerdown', 1, 140, 100);
  fire('pointerdown', 2, 160, 100);
  const mark = drawn.length;
  fire('pointermove', 1, 40, 180);
  fire('pointermove', 2, 260, 20);
  assert.equal(strokesDrawnSince(mark), 0);
});

test('ピンチの片方だけ離しても、残った指で描き始めない', () => {
  const { fire, drawn, strokesDrawnSince } = openAnnotateInFakeScreen();
  fire('pointerdown', 1, 140, 100);
  fire('pointerdown', 2, 160, 100);
  fire('pointerup', 2, 160, 100);
  const mark = drawn.length;
  fire('pointermove', 1, 40, 180);
  assert.equal(strokesDrawnSince(mark), 0);
});

test('指を全部離せば、次の1本指でまた書ける', () => {
  const { fire, drawn, strokesDrawnSince } = openAnnotateInFakeScreen();
  fire('pointerdown', 1, 140, 100);
  fire('pointerdown', 2, 160, 100);
  fire('pointerup', 2, 160, 100);
  fire('pointerup', 1, 140, 100);
  const mark = drawn.length;
  fire('pointerdown', 3, 10, 10);
  fire('pointermove', 3, 60, 10);
  assert.equal(strokesDrawnSince(mark), 1);
});

/* ── 写真の書き込みにも、色と太さ（マスター指示 2026-09-07） ── */

test('写真の書き込みも、選んだ色で引かれる', () => {
  const { fire, drawn, parts } = openAnnotateInFakeScreen();
  parts['.annotate-color'].value = '#00a3ff';
  parts['.annotate-color'].oninput();
  const mark = drawn.length;
  fire('pointerdown', 1, 10, 10);
  fire('pointermove', 1, 60, 10);
  assert.ok(drawn.slice(mark).some(([op, value]) => op === 'set:strokeStyle' && value === '#00a3ff'),
    '選んだ色で引かれていない');
});

test('写真の書き込みも、太さを変えられる（画面ではなく写真の画素で数える）', () => {
  const { fire, drawn, parts } = openAnnotateInFakeScreen();
  parts['.annotate-width'].value = '10';
  parts['.annotate-width'].oninput();
  const mark = drawn.length;
  fire('pointerdown', 1, 10, 10);
  fire('pointermove', 1, 60, 10);
  /* 器は 300px 幅、写真は 600px 幅なので、画面の 10 は写真の 20 になる。
     **寄って書いても引いて書いても、焼き上がりの太さが同じ**であること。 */
  assert.ok(drawn.slice(mark).some(([op, value]) => op === 'set:lineWidth' && value === 20),
    `写真の画素で太さを数えていない: ${JSON.stringify(drawn.slice(mark).filter(([op]) => op === 'set:lineWidth'))}`);
});

test('色を変えても、先に引いた線は変わらない', () => {
  const { fire, drawn, parts } = openAnnotateInFakeScreen();
  parts['.annotate-color'].value = '#00a3ff';
  parts['.annotate-color'].oninput();
  fire('pointerdown', 1, 10, 10);
  fire('pointermove', 1, 60, 10);
  fire('pointerup', 1, 60, 10);
  parts['.annotate-color'].value = '#123456';
  parts['.annotate-color'].oninput();
  const mark = drawn.length;
  fire('pointerdown', 2, 100, 100);
  fire('pointermove', 2, 160, 100);
  const colors = drawn.slice(mark).filter(([op]) => op === 'set:strokeStyle').map(([, v]) => v);
  assert.ok(colors.includes('#00a3ff'), '前に引いた線が塗り替えられている');
  assert.ok(colors.includes('#123456'), '新しい線が新しい色で引かれていない');
});

test('4面図と写真で、ペンの道具は同じ1組（片方で変えたらもう片方にも効く）', () => {
  const { App, parts } = openAnnotateInFakeScreen();
  parts['.annotate-width'].value = '15';
  parts['.annotate-width'].oninput();
  assert.equal(App.penWidth, 15, '写真で変えた太さが、4面図側に伝わっていない');
});

/**
 * ui-default-state.test.mjs — **選ばれて見えるものは、必ず保存される**
 *
 * 実機で見つけた事故（2026-09-03・徹底調査）:
 *   カルテ0枚の犬で ④ を開くと、画面には
 *     BCS「3 適正」 / 右耳「Lv.1 良好」 / 左耳「Lv.1 良好」 / 歯「ピカピカ✨」
 *   が**選ばれた状態で光っていた**。ところが `App.form` の初期値は
 *   `bcs: 0` / `ear: {right:0,left:0}` / `teeth: ''` で、`extractReport()` は
 *   真の値しか書かない。つまり**トリマーが「もう適正になっている」と信じて
 *   触らないほど、健康の記録が1つも残らない。**
 *
 *   実測（`status=final` のカルテ）:
 *     data のキー = ["pet","date","course","__marks","isoDate","weights"]
 *     bcs=undefined ear=undefined teeth=undefined
 *   同じ画面のドックは「未記入: …BCS・耳のチェック・歯のチェック…」と出ており、
 *   **画面の中だけでも言っていることが食い違っていた。**
 *
 * しかも既定は全部「良好・問題なし」の側なので、消える向きが**最悪**——
 * 犬の健康の記録で「異常なし」に見えるものが、実は「何も見ていない」だった。
 * `D-12`「押せた ではなく 届いた」の型。
 *
 * ここで守る決まりは「点けるな」ではない。**点いているなら、その値が
 * `App.form` の初期値にも入っていること**。どちらに揃えるかは設計の自由だが、
 * **画面とデータが食い違うことだけは許さない。**
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

/** `App.form` の初期値だけを取り出す。画面は要らないので、宣言を読むだけにする。 */
function formDefaults() {
  /* `ui-carry-over.test.mjs` と同じ形。`App` は `var` でも `globalThis` でもなく
     オブジェクト宣言なので、末尾で明示的に取り出す。 */
  const sandbox = {
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {} }),
    },
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    setTimeout: () => {},
    clearTimeout: () => {},
    alert: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${UI}\n;globalThis.__App = App;`, sandbox);
  return sandbox.__App.form;
}

/** ④の入力欄のうち、**光り方で値を表す欄**。増えたらここに足す。 */
const GROUPS = [
  {
    name: 'BCS',
    /* `<button class="stepper-btn …" onclick="App.selectStepper(this, 'bcs', 3)">` */
    litValues: () => [...HTML.matchAll(/<button class="stepper-btn[^"]*\bis-active\b[^"]*"[^>]*App\.selectStepper\(this, 'bcs', (\d+)\)/g)]
      .map((m) => Number(m[1])),
    formValue: (form) => form.bcs,
  },
  {
    name: '右耳',
    litValues: () => litEarLevels('right'),
    formValue: (form) => form.ear.right,
  },
  {
    name: '左耳',
    litValues: () => litEarLevels('left'),
    formValue: (form) => form.ear.left,
  },
  {
    name: '歯',
    litValues: () => [...teethGrid().matchAll(/<button class="teeth-pill-btn[^"]*\bis-active\b[^"]*"[\s\S]*?<span class="name">([^<]*)<\/span>/g)]
      .map((m) => m[1].trim()),
    formValue: (form) => form.teeth,
  },
];

/** `data-ear="right"` の囲みの中だけを見る。左右を取り違えない（`D-9`）。 */
function litEarLevels(side) {
  const open = HTML.indexOf(`data-ear="${side}"`);
  assert.notEqual(open, -1, `data-ear="${side}" の囲みが src/index.html に無い`);
  const block = HTML.slice(open, HTML.indexOf('</div>', open));
  return [...block.matchAll(/<button class="teeth-pill-btn[^"]*\bis-active\b[^"]*"[^>]*data-level="(\d+)"/g)]
    .map((m) => Number(m[1]));
}

function teethGrid() {
  const open = HTML.indexOf('id="teeth-selector-grid"');
  assert.notEqual(open, -1, 'id="teeth-selector-grid" が src/index.html に無い');
  return HTML.slice(open, HTML.indexOf('</div>', open));
}

test('④の入力欄が、選ばれて見えるのに保存されない状態で出荷されていない', () => {
  const form = formDefaults();
  /* **この行が土台。** 取れていなければ以下の比較は何も見ていないことになる
     （`empty-pass` の型）。 */
  assert.ok(form && typeof form === 'object', 'App.form の初期値を読めていない');
  assert.ok('bcs' in form && 'ear' in form && 'teeth' in form, `App.form の形が違う: ${Object.keys(form)}`);

  for (const group of GROUPS) {
    const lit = group.litValues();
    assert.ok(lit.length <= 1, `${group.name}: 既定で光っているボタンが ${lit.length} 個ある`);
    const value = group.formValue(form);
    if (lit.length === 0) {
      /* 光っていないなら、初期値も空でなければならない
         （空でないなら、選んでいないのに値が入っていることになる）。 */
      assert.ok(!value, `${group.name}: 画面は何も選ばれていないのに App.form が ${JSON.stringify(value)}`);
      continue;
    }
    assert.equal(
      value, lit[0],
      `${group.name}: 画面は ${JSON.stringify(lit[0])} が選ばれて見えるのに `
      + `App.form は ${JSON.stringify(value)}。トリマーが触らなければ記録が残らない`,
    );
  }
});

test('④の入力欄の初期値は、ドックの「未記入」の見方と揃っている', () => {
  const form = formDefaults();
  /* `updateCompletionStatus()` は `!!this.form.bcs` で未記入を判定する
     （`src/js/ui.js`）。画面が光っていて form が空なら、**同じ画面の中で
     「選ばれている」と「未記入」が同時に出る**——実機でこれが起きていた。 */
  const litBcs = GROUPS[0].litValues().length > 0;
  assert.equal(
    litBcs, !!form.bcs,
    litBcs
      ? 'BCS が光っているのに「未記入: BCS」と出る（画面の中で食い違う）'
      : 'BCS は光っていないのに未記入扱いにならない',
  );
});

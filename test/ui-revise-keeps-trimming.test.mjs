/**
 * ui-revise-keeps-trimming.test.mjs — 「カルテ修正」でカットの内容が消えないこと
 *
 * `docs/deferred.md` #26。カットの長さとスタイルは、⑥が読む形
 * （`trimming.comment`）に `' / '` でまとめて入れている。**戻す規則が無かった。**
 *
 * 下書き再開だけの話ではなかったのが問題だった:
 *   管理者画面の「② カルテ修正」は `?revise=1` で④に入り、同じ `applyReport()` を
 *   通る（`src/js/ui.js` の `showReport`）。2つの select が初期値のまま戻らないので、
 *   選び直さずに保存すると `extractReport()` が `trimming.comment` を出さず、
 *   **すでに飼い主に届いていたカット内容が黙って消える**。
 *
 * ここで見るのは「押せた」ではなく「**同じ値で戻った**」（`D-12`）。
 * 往復（届いた形 → 画面 → 届く形）が一致するかだけを見る。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

/** 実物と同じ選択肢（`src/index.html` の2つの `<select>`）。 */
const LENGTHS = ['6mm (スッキリ)', '8mm (標準ふんわり)', '10mm (長め)', 'ハサミオールシザー'];
const STYLES = ['テディベアカット', 'アフロ風マッシュ', '足先すっきりブーツ'];

/** `<select>` のふり。**無い値を代入しても変わらない**ところまで真似る。 */
function selectStub(values) {
  return {
    options: values.map((value) => ({ value })),
    /* 実物の `select.value` は、選択肢に無い値を代入しても空になるだけで
       その文字列を持たない。そこを真似ないと、検査だけが通ってしまう。 */
    _value: values[0],
    get value() { return this._value; },
    set value(next) { this._value = values.includes(next) ? next : ''; },
  };
}

function loadApp(fields) {
  const document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: (selector) => {
      const m = selector.match(/^\[data-field="([a-z-]+)"\]$/);
      if (m && Object.prototype.hasOwnProperty.call(fields, m[1])) return fields[m[1]];
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
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  return sandbox.__App;
}

function fresh() {
  const fields = {
    'trim-length': selectStub(LENGTHS),
    'trim-style': selectStub(STYLES),
  };
  const App = loadApp(fields);
  App.marks = [];
  return { App, fields };
}

test('届いていたカット内容は、修正で選び直さなくても同じまま届く', () => {
  const delivered = { trimming: { comment: '10mm (長め) / 足先すっきりブーツ' } };

  const { App } = fresh();
  App.applyReport(delivered);
  const again = App.extractReport();

  assert.equal(
    (again.trimming || {}).comment,
    delivered.trimming.comment,
    '修正で保存し直すと、届いていたカット内容が変わっている',
  );
});

test('2つの select に、届いた値そのものが戻る', () => {
  const { App, fields } = fresh();
  App.applyReport({ trimming: { comment: '6mm (スッキリ) / アフロ風マッシュ' } });

  assert.equal(fields['trim-length'].value, '6mm (スッキリ)');
  assert.equal(fields['trim-style'].value, 'アフロ風マッシュ');
});

test('片方しか入っていなくても、入っているほうだけ戻る', () => {
  const { App, fields } = fresh();
  App.applyReport({ trimming: { comment: 'ハサミオールシザー' } });

  assert.equal(fields['trim-length'].value, 'ハサミオールシザー');
  assert.equal(fields['trim-style'].value, STYLES[0], 'スタイルを勝手に変えている');
});

test('選択肢に無い言葉は入れない（推測で埋めない）', () => {
  const { App, fields } = fresh();
  App.applyReport({ trimming: { comment: '謎のカット / 知らないスタイル' } });

  assert.equal(fields['trim-length'].value, LENGTHS[0], '選択肢に無い値を入れている');
  assert.equal(fields['trim-style'].value, STYLES[0], '選択肢に無い値を入れている');
});

test('カットが入っていないカルテを修正しても、カットは生えてこない', () => {
  const { App, fields } = fresh();
  App.applyReport({ staffNote: '耳を洗いました' });

  assert.equal(fields['trim-length'].value, LENGTHS[0]);
  assert.equal(fields['trim-style'].value, STYLES[0]);
});

test('写真だけのカルテでも、コメントの欄を壊さない', () => {
  const { App } = fresh();
  App.applyReport({ trimming: { photos: ['asset://a'] } });
  const out = App.extractReport();
  assert.ok(!(out.trimming && out.trimming.comment === ''), 'comment を空文字で出している');
});

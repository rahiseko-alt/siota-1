/**
 * ui-carry-over.test.mjs — 6枚目のカルテを「前回の続き」から始められること
 *
 * マスター指示（2026-09-03）:
 *   「カルテを作成するを押すと、自動的に前回のカルテのコピーが表示される。
 *     日時やコースなど毎回必ず変わる項目は空欄で、変わらないであろう項目は
 *     5回目のコピーになっている、という状況から6回目のカルテ作成を始められるようにしろ」
 *
 * **この機能は一度作って消している。** 「前回を複製」（`cloneAndCreate`）は
 * `6fecedc` / PR #55 で削除された。理由は (1) 何も複製していないのに
 * 「読み込みました」と言っていた (2) 正規の初期化を飛ばして⑦使用オプションが
 * 出なくなっていた、の2つ。ここで見るのは (1) の側——**言ったとおりのものが
 * 実際に入っていること**と、**空にすると言ったものが本当に空であること**。
 *
 * 空にする項目が1つでも残ると、トリマーが確認しないまま前回の写真・前回の
 * メッセージが**今回のカルテとして飼い主に届く**。ここは `#3`（見つけた所見が
 * 消える）の裏返しで、**書いていないものが届く**型の事故になる。
 *
 * `src/js/ui.js` は古典スクリプトなので import できない。`ui-extract-report.test.mjs`
 * と同じ形で `vm` に最小限の画面を置いて読み込む。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/js/ui.js'), 'utf8');

const plain = (value) => JSON.parse(JSON.stringify(value));

/** 5枚目（前回）の確定カルテ。**全部の項目が埋まっている**状態を作る。 */
function fifthReport() {
  return {
    pet: 'A',
    date: '2026-08-01',
    isoDate: '2026-08-01',
    course: 'フルコース',
    staffNote: '耳の裏を丁寧に洗いました。',
    bcs: 3,
    bestWeight: 4.2,
    nail: { front: 2, rear: 3 },
    ear: { right: 2, left: 4, photo: 'asset://ear-5' },
    teeth: { status: '軽度の歯石', photos: ['asset://teeth-5a', 'asset://teeth-5b'] },
    weights: [{ ym: '2026-08', date: '2026-08-01', kg: 4.4 }],
    trimming: { photos: ['asset://trim-5a'] },
    options: ['アメージング', '炭酸泉'],
    bodyMarkingImage: 'data:image/png;base64,iVBORw0KGgo=',
    __marks: [{ x: 0.5, y: 0.5, type: 'しこり/イボ' }],
  };
}

/** 最小限の画面で `App` を読み込む。`commitReport()` は `globalThis` から
    backend と文脈を取るので、**その `globalThis`（＝ sandbox）も返す**。 */
function loadSandbox() {
  const document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {} }),
  };
  const sandbox = {
    document,
    window: { addEventListener: () => {}, DUMMY: { dogs: [] } },
    setTimeout: () => {},
    clearTimeout: () => {},
    alert: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}\n;globalThis.__App = App;`, sandbox);
  return sandbox;
}

function loadApp() {
  return loadSandbox().__App;
}

/* ── 空にする項目 ─────────────────────────────────────────────────
   毎回変わるもの。前回の値が残ったまま確定されると、**書いていないものが届く**。 */

const MUST_BE_EMPTY = [
  ['来店日', 'date'],
  ['来店日（ISO）', 'isoDate'],
  ['コース', 'course'],
  ['トリマーからのメッセージ', 'staffNote'],
  ['体重', 'weights'],
  ['使用オプション', 'options'],
  ['トリミング後の写真', 'trimming'],
  ['犬体図の焼いた画像', 'bodyMarkingImage'],
];

for (const [label, key] of MUST_BE_EMPTY) {
  test(`${label}は引き継がない（${key} がキーごと出ない）`, () => {
    const App = loadApp();
    const carried = App.carryOverReport(fifthReport());
    assert.ok(!(key in carried), `${key} が引き継がれている（前回の値が今回のカルテとして届く）`);
  });
}

test('耳の写真は引き継がない（段だけを引き継ぐ）', () => {
  const App = loadApp();
  const carried = App.carryOverReport(fifthReport());
  assert.equal(carried.ear.right, 2);
  assert.equal(carried.ear.left, 4);
  assert.ok(!('photo' in carried.ear), '耳の写真が引き継がれている');
});

test('歯の写真は引き継がない（状態だけを引き継ぐ）', () => {
  const App = loadApp();
  const carried = App.carryOverReport(fifthReport());
  assert.equal(carried.teeth.status, '軽度の歯石');
  assert.ok(!('photos' in carried.teeth), '歯の写真が引き継がれている');
});

/* ── 引き継ぐ項目 ───────────────────────────────────────────────── */

test('爪・耳・歯・BCS・ベスト体重・犬体図の印を引き継ぐ', () => {
  const App = loadApp();
  const carried = plain(App.carryOverReport(fifthReport()));
  assert.deepEqual(carried, {
    nail: { front: 2, rear: 3 },
    ear: { right: 2, left: 4 },
    teeth: { status: '軽度の歯石' },
    bcs: 3,
    bestWeight: 4.2,
    __marks: [{ x: 0.5, y: 0.5, type: 'しこり/イボ' }],
  });
});

test('触っていない項目は、器ごと出さない（空の器を作らない）', () => {
  const App = loadApp();
  const carried = App.carryOverReport({ bcs: 3 });
  assert.deepEqual(plain(carried), { bcs: 3 });
  assert.ok(!('nail' in carried));
  assert.ok(!('ear' in carried));
  assert.ok(!('teeth' in carried));
  assert.ok(!('__marks' in carried));
});

test('前回のカルテが無い・空でも壊れない（初回の犬）', () => {
  const App = loadApp();
  assert.deepEqual(plain(App.carryOverReport(null)), {});
  assert.deepEqual(plain(App.carryOverReport(undefined)), {});
  assert.deepEqual(plain(App.carryOverReport({})), {});
});

test('印が0件なら __marks を引き継がない（白紙を「所見あり」にしない）', () => {
  const App = loadApp();
  const carried = App.carryOverReport({ ...fifthReport(), __marks: [] });
  assert.ok(!('__marks' in carried));
});

/* ── 告知は、引き継いだものだけを名指しする ─────────────────────────
   `cloneAndCreate()` は「過去カルテデータを読み込みました」と言いながら
   何も複製していなかった（`6fecedc`）。同じ嘘をつかせない。 */

test('告知に並ぶのは、実際に引き継いだ項目だけ', () => {
  const App = loadApp();
  const all = App.carryOverLabels(App.carryOverReport(fifthReport()));
  assert.deepEqual(plain(all), ['爪', '耳', '歯', 'BCS', 'ベスト体重', '犬体図の印']);

  const only = App.carryOverLabels(App.carryOverReport({ bcs: 3 }));
  assert.deepEqual(plain(only), ['BCS'], '引き継いでいない項目まで名指ししている');

  assert.deepEqual(plain(App.carryOverLabels(App.carryOverReport({}))), []);
});

/* ── 確定カルテに印そのものを残す ───────────────────────────────────
   `bodyMarkingImage` は焼いた PNG で、そこから印は復元できない。
   確定に `__marks` が載らないと、**次の回で犬体図を引き継げない**。 */

test('確定は __marks を載せて送る（次の回で印を引き継ぐため）', async () => {
  const sandbox = loadSandbox();
  const App = sandbox.__App;
  const sent = [];

  sandbox.__REPORT_CONTEXT__ = { petId: 'pet-a', petName: 'A' };
  sandbox.TrimmerSupabaseStaff = {
    saveReport: (petId, data) => {
      sent.push({ petId, data });
      return Promise.resolve({ id: 'report-6' });
    },
  };
  sandbox.location = { href: '' };

  App.marks = [{ x: 0.25, y: 0.75, type: '赤み' }];
  App.extractReport = () => ({ course: 'フルコース' });
  App.today = () => '2026-09-03';
  App.draftReportId = 'draft-1';
  App.reviseReportId = null;

  await App.commitReport();

  assert.equal(sent.length, 1, '確定が送られていない');
  assert.equal(sent[0].data.course, 'フルコース');
  assert.deepEqual(
    plain(sent[0].data.__marks),
    [{ x: 0.25, y: 0.75, type: '赤み' }],
    '確定に __marks が載っていない。次の回で犬体図の印を引き継げない',
  );
});

test('直し（カルテ修正）でも __marks を載せて送る', async () => {
  const sandbox = loadSandbox();
  const App = sandbox.__App;
  const sent = [];

  sandbox.__REPORT_CONTEXT__ = { petId: 'pet-a', petName: 'A' };
  sandbox.TrimmerSupabaseStaff = {
    saveReport: () => Promise.reject(new Error('新規で送ってはいけない')),
    reviseReport: (petId, reportId, data) => {
      sent.push({ petId, reportId, data });
      return Promise.resolve({ id: reportId });
    },
  };
  sandbox.location = { href: '' };

  App.marks = [{ type: '毛玉', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }];
  App.extractReport = () => ({ course: 'シャンプーコース' });
  App.today = () => '2026-09-03';
  App.reviseReportId = 'report-5';

  await App.commitReport();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].reportId, 'report-5');
  assert.equal(plain(sent[0].data.__marks).length, 1, '直しで印が落ちている');
});

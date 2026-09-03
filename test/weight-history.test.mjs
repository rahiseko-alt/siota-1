/**
 * weight-history.test.mjs — 体重の推移が、確定カルテを横断して1本になること
 *
 * マスター指示（2026-09-03）「納品して問題あるなら直せ」。
 *
 * **⑥飼い主の「体重推移」は、点が1つしか乗っていなかった。**
 * `renderWeightGraph()` はカルテ1枚の `data.weights` を描いていたが、
 * `extractReport()` が作る `weights` は**その回の1件だけ**。`polyline` は2点未満では
 * 線を引けないので、「体重推移 (kg)」と書かれた箱に丸が1つ出るだけで、
 * **推移は一度も飼い主に届いていなかった**。
 *
 * ここで見るのは、確定カルテの行から推移を組み立てる純関数。
 * DB もブラウザも要らない形にしてあるので、1条件ずつ確かめられる。
 * 実際に画面へ届くかは `npm run verify:carry-over` が実 Supabase で見る。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { weightHistoryFromReports } from '../worker/src/data-stores/supabase-data-store.js';
import { pickWeightSeries } from '../backend/js/magazine-view.js';

test('確定カルテの体重が、渡された順に1本の推移になる', () => {
  const rows = [
    { report_date: '2026-05-01', data: { weights: [{ ym: '2026-05', date: '2026-05-01', kg: 4.2 }] } },
    { report_date: '2026-06-01', data: { weights: [{ ym: '2026-06', date: '2026-06-01', kg: 4.4 }] } },
    { report_date: '2026-07-01', data: { weights: [{ ym: '2026-07', date: '2026-07-01', kg: 4.3 }] } },
  ];
  assert.deepEqual(weightHistoryFromReports(rows), [
    { ym: '2026-05', date: '2026-05-01', kg: 4.2 },
    { ym: '2026-06', date: '2026-06-01', kg: 4.4 },
    { ym: '2026-07', date: '2026-07-01', kg: 4.3 },
  ]);
});

test('線が引ける（2点以上になる）', () => {
  const rows = [
    { report_date: '2026-05-01', data: { weights: [{ ym: '2026-05', kg: 4.2 }] } },
    { report_date: '2026-06-01', data: { weights: [{ ym: '2026-06', kg: 4.4 }] } },
  ];
  assert.ok(
    weightHistoryFromReports(rows).length >= 2,
    '点が1つしか出ない。polyline は2点未満では線を引けないので、推移が届かない',
  );
});

/* ── 量らなかった回を、0kg として線に乗せない ─────────────────────
   体重に触らずに確定した回は `weights` を持たない（`D-10`「空の器を出さない」）。
   そこを 0 として描くと、**書いていない体重が飼い主に届く**——グラフが谷まで
   落ちて見え、痩せたと読まれる。 */

test('体重を量っていない回は、推移に乗らない', () => {
  const rows = [
    { report_date: '2026-05-01', data: { weights: [{ ym: '2026-05', kg: 4.2 }] } },
    { report_date: '2026-06-01', data: { course: 'シャンプーのみ' } },
    { report_date: '2026-07-01', data: { weights: [{ ym: '2026-07', kg: 4.4 }] } },
  ];
  const history = weightHistoryFromReports(rows);
  assert.equal(history.length, 2, '量っていない回が線に乗っている');
  assert.deepEqual(history.map((p) => p.kg), [4.2, 4.4]);
});

test('数値でない体重・0以下は落とす', () => {
  const rows = [
    { report_date: '2026-05-01', data: { weights: [{ ym: '2026-05', kg: '' }] } },
    { report_date: '2026-06-01', data: { weights: [{ ym: '2026-06', kg: 0 }] } },
    { report_date: '2026-07-01', data: { weights: [{ ym: '2026-07', kg: null }] } },
    { report_date: '2026-08-01', data: { weights: [{ ym: '2026-08', kg: 'よん' }] } },
    { report_date: '2026-09-01', data: { weights: [{ ym: '2026-09', kg: 4.5 }] } },
  ];
  assert.deepEqual(weightHistoryFromReports(rows), [{ ym: '2026-09', date: '2026-09-01', kg: 4.5 }]);
});

test('ym が欠けている古い記録も、カルテの日付から月を作って乗せる', () => {
  const rows = [{ report_date: '2026-05-01', data: { weights: [{ kg: 4.2 }] } }];
  assert.deepEqual(weightHistoryFromReports(rows), [
    { ym: '2026-05', date: '2026-05-01', kg: 4.2 },
  ]);
});

test('1枚も無い・空・壊れた入力でも壊れない', () => {
  assert.deepEqual(weightHistoryFromReports([]), []);
  assert.deepEqual(weightHistoryFromReports(null), []);
  assert.deepEqual(weightHistoryFromReports(undefined), []);
  assert.deepEqual(weightHistoryFromReports([null, {}, { data: null }, { data: {} }]), []);
});

test('日付も ym も無い記録は乗せない（どこに打つか決められない）', () => {
  assert.deepEqual(weightHistoryFromReports([{ data: { weights: [{ kg: 4.2 }] } }]), []);
});

/* ── 空の履歴を「無い」として扱うこと ──────────────────────────────
   実測で見つけた事故（2026-09-03・脆弱性/見落とし調査）:
   `magazine-view.js` は `report.weightHistory || data.weights` と書いていた。
   **`[]` は真**なので `data.weights` へ落ちてこず、確定カルテがまだ1枚も無い犬
   （初回の子）では**今日量った体重が捨てられて**「記録がありません。」になっていた。
   実測値: `weightHistory=[]` / `data.weights=[{kg:3.3}]` → 渡っていたのは `[]`。 */

test('確定カルテが1枚も無い犬では、今日量った体重が捨てられない', () => {
  const data = { weights: [{ ym: '2026-09', date: '2026-09-01', kg: 3.3 }] };
  assert.deepEqual(pickWeightSeries({ weightHistory: [] }, data), data.weights);
});

test('履歴が取れなかった回（null）も、今日の体重に落ちる', () => {
  const data = { weights: [{ ym: '2026-09', date: '2026-09-01', kg: 3.3 }] };
  assert.deepEqual(pickWeightSeries({ weightHistory: null }, data), data.weights);
  assert.deepEqual(pickWeightSeries({}, data), data.weights);
});

test('履歴があるときは履歴が勝つ（点1つに戻らない）', () => {
  const history = [
    { ym: '2026-08', date: '2026-08-01', kg: 4.4 },
    { ym: '2026-09', date: '2026-09-01', kg: 4.6 },
  ];
  const picked = pickWeightSeries({ weightHistory: history }, { weights: [{ ym: '2026-09', kg: 4.6 }] });
  assert.equal(picked.length, 2, '履歴があるのに今回の1点に落ちている');
  assert.deepEqual(picked, history);
});

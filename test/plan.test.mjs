/**
 * plan.test.mjs — `npm run plan` の進捗表示が嘘をつかないことを見る
 *
 * 実際に起きた事故（`docs/ops/plan.md` 第9章の統合時に発見）:
 *   `STAGES` に `F4` が無く、`docs/ops/phase` が `F4` になった時点で
 *   `STAGES.findIndex()` が `-1` を返し、**完了済みの F1〜F3 まで
 *   全段「未着手（⬜）」と表示していた**。大計画の唯一の進捗表示が
 *   「何も進んでいない」と嘘をついていた。
 *
 * この検査は2つを見る:
 *   ①いまの `phase`（`docs/ops/phase`）が `STAGES` のどこかに実在すること
 *     （`-1` にならないこと＝今回の事故そのもの）
 *   ②`stageIndex` より前の段は必ず `render()` の出力で `✅` になること
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, stageIndex, render, readNextLine, countDeferred } from '../scripts/plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planText = fs.readFileSync(path.join(ROOT, 'docs/ops/plan.md'), 'utf8');
const phase = fs.readFileSync(path.join(ROOT, 'docs/ops/phase'), 'utf8').trim();

test('いまの docs/ops/phase の値が STAGES に実在する（-1 にならない）', () => {
  assert.notEqual(stageIndex(phase), -1,
    `docs/ops/phase の値 "${phase}" が STAGES のどのキーとも一致しない。`
    + '新しいフェーズ札を作ったら、まず STAGES に足すこと。');
});

test('phase=F4 のとき、F1〜F3 はすべて完了（✅）と表示される（今回の事故の再発防止）', () => {
  const out = render('F4', planText);
  const lines = out.split('\n');
  for (const key of ['F1', 'F2', 'F3']) {
    const line = lines.find((l) => l.includes(`${key}　`));
    assert.ok(line, `${key} の行が出力に無い`);
    assert.ok(line.startsWith('  ✅'),
      `${key} が完了として表示されていない: "${line}"`);
  }
});

test('phase=F4 のとき、F4 自身は「作業中（▶）」と表示される', () => {
  const out = render('F4', planText);
  const line = out.split('\n').find((l) => l.includes('F4　'));
  assert.ok(line.startsWith('  ▶'), `F4 が作業中として表示されていない: "${line}"`);
});

test('知らないフェーズ札を渡すと、全段 ⬜ になる（-1 の挙動を明示的に確認）', () => {
  const out = render('存在しない札', planText);
  const lines = out.split('\n').filter((l) => /^  [✅▶⬜]/.test(l));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(l.startsWith('  ⬜'), `-1 のとき全段 ⬜ のはず: "${l}"`);
});

test('「いまやる番」を docs/ops/plan.md から読める', () => {
  const line = readNextLine(planText);
  assert.notEqual(line, '(未設定)', '「いまやる番」の行が docs/ops/plan.md に無い');
  assert.ok(line.length > 0);
});

test('放置リストの件数が数えられる（放置リストが空でも壊れない）', () => {
  const { total, open, done } = countDeferred(planText);
  assert.ok(total >= 0);
  assert.equal(open + done, total);
});

test('放置リストの数え方は、他の章の番号付き表（C-1・1-1 等）を混ぜない', () => {
  const fakeplan = '**いまやる番: x**\n'
    + '| C-1 | 指示 | 状態 | やること | migration |\n'
    + '| 1-1 | やること | 証明 | 実測 |\n'
    + '| 3 | 見つけた日 | 場所 | 何が起きているか | 進めるか | 直した |\n';
  const { total } = countDeferred(fakeplan);
  assert.equal(total, 1, '放置リスト以外の表の行を数えてしまっている');
});

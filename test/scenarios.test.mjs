/**
 * scenarios.test.mjs — 権限ごとの操作シナリオ台帳が、欠けたり重複したりしないことを見る
 *
 * マスター指示（2026-09-09）:「権限ごとの操作シナリオを50ずつ作れ。
 * オーソドックス、致命的な危険操作の2パターン」。
 *
 * **数は人が数えない。** 台帳（`docs/ops/scenarios.md`）は今後も足したり直したりする。
 * そのたびに「50件あるはず」を人が数え直すのは続かないし、**書いた直後からズレる**
 * （大計画で実際に起きた・`docs/ops/roadmap.md` の「件数はここに書かない」）。
 *
 * ここが見るのは4つだけ:
 *   ①4区分（お店の人／飼い主 × ふつう／危険）がそれぞれ **50件**あること
 *   ②番号が 1〜50 で**抜けも重複も無い**こと
 *   ③どの行にも**状態の印**（✅ ⚠️ ❌）が付いていること
 *   ④❌ の行が、末尾の「守りが無い宿題」の表から**辿れる**こと
 *
 * **この検査が保証しないこと**: 書いてある中身が正しいか・実際にその通り動くか。
 * それは人が触って確かめる（`D-23`）。ここは**台帳の形**だけを見る。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = fs.readFileSync(path.join(ROOT, 'docs/ops/scenarios.md'), 'utf8');

/** 4区分。`S`=お店の人のふつう、`SD`=お店の人の危険、`O`=飼い主のふつう、`OD`=飼い主の危険。 */
const GROUPS = [
  { key: 'S', label: 'お店の人 — ふつうの操作' },
  { key: 'SD', label: 'お店の人 — 致命的な危険操作' },
  { key: 'O', label: '飼い主 — ふつうの操作' },
  { key: 'OD', label: '飼い主 — 致命的な危険操作' },
];

/** 台帳の行を取り出す。`| S-12 | … |` の形だけを拾う。 */
function rows(key) {
  const found = [];
  for (const line of TEXT.split('\n')) {
    const match = line.match(new RegExp(`^\\| ${key}-(\\d+) \\|(.*)$`));
    /* `S` は `SD` と頭が同じなので、`SD-1` を `S` として拾わないように分ける。 */
    if (match && !line.startsWith(`| ${key}D-`)) found.push({ n: Number(match[1]), rest: match[2] });
  }
  return found;
}

for (const group of GROUPS) {
  test(`${group.label} が50件ある`, () => {
    assert.equal(rows(group.key).length, 50,
      `${group.key}- の行数が50件でない。減らすなら、なぜ減らしたかを台帳に書くこと`);
  });

  test(`${group.label} の番号に抜けも重複も無い`, () => {
    const numbers = rows(group.key).map((r) => r.n).sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: 50 }, (_, i) => i + 1),
      `${group.key}- の番号が 1〜50 になっていない`);
  });

  test(`${group.label} の全行に状態の印（✅ ⚠️ ❌）が在る`, () => {
    const missing = rows(group.key).filter((r) => !/[✅⚠️❌]/.test(r.rest));
    assert.deepEqual(missing.map((r) => `${group.key}-${r.n}`), [],
      '印が無い行は「調べたのか、調べていないのか」が分からない（D-18）');
  });
}

/* 実行の記録欄（マスター指示 2026-09-09「まずシナリオを記録に残せ」）。
   台帳をそのまま記録簿にするので、**欄が消えたら記録できなくなる**。
   それを機械で見張る。 */
for (const group of GROUPS) {
  test(`${group.label} の全行に「結果」と「実施日」が在る`, () => {
    const bad = rows(group.key).filter((r) => {
      const cells = r.rest.split('|').map((c) => c.trim());
      /* 末尾は空文字（行末の `|` の右）。その手前2つが 実施日・結果。 */
      const date = cells[cells.length - 2];
      const result = cells[cells.length - 3];
      return !['未実施', 'OK', 'NG'].includes(result) || date === '';
    });
    assert.deepEqual(bad.map((r) => `${group.key}-${r.n}`), [],
      '結果は 未実施／OK／NG のどれか、実施日は空にしないこと');
  });
}

test('NG を付けた行は、放置リストの番号か理由が書いてある', () => {
  /* **印を変えるだけで終わらせない**（`偽-8`）。NG なのに何も書いていない行は、
     見つけたことが誰にも引き継がれない。 */
  const bad = [];
  for (const group of GROUPS) {
    for (const row of rows(group.key)) {
      const cells = row.rest.split('|').map((c) => c.trim());
      if (cells[cells.length - 3] !== 'NG') continue;
      if (!/NG:/.test(row.rest)) bad.push(`${group.key}-${row.n}`);
    }
  }
  assert.deepEqual(bad, [], `NG の理由が書かれていない: ${bad.join(' / ')}`);
});

test('❌（守りが無い）の行は、末尾の宿題の表から辿れる', () => {
  /* 台帳の中で ❌ を付けたのに、宿題の表に1度も出てこない番号があってはいけない。
     出てこなければ、**見つけたのに誰も引き取っていない**ことになる（偽-8 の型）。 */
  const flagged = [];
  for (const group of GROUPS) {
    for (const row of rows(group.key)) {
      if (row.rest.includes('❌')) flagged.push(`${group.key}-${row.n}`);
    }
  }
  assert.ok(flagged.length > 0, '❌ が1件も無い（印の付け方が壊れている可能性）');

  const summary = TEXT.slice(TEXT.indexOf('## この台帳から出た「守りが無い」宿題'));
  const orphans = flagged.filter((id) => !summary.includes(id));
  assert.deepEqual(orphans, [],
    `宿題の表に載っていない ❌ がある: ${orphans.join(' / ')}`);
});

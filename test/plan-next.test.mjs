/**
 * plan-next.test.mjs — 「大計画どおりに進める」仕組みが、壊れても気づけることを見る
 *
 * マスター指示（2026-09-06）:「大計画通りに進めろ。毎回そうしろ。毎回そうする仕組みに変えろ」。
 *
 * 実際に起きたこと: 大計画を画面に出す仕組み（`plan-read`）は在ったのに、
 * **読んだ直後のセッションが「どれから着手しますか」とマスターに訊いた**。
 * 読ませただけでは進まない。そこで「次の一手」を機械が割り当て、関所が見る。
 *
 * ここが見るのは4つ:
 *   ①`docs/ops/plan.md` に「次の一手」の節が実在し、未了が読めること
 *   ②印が無ければ関所が赤になること（素通りできない）
 *   ③別セッションの印では赤になること（前回の印で素通りできない・`F-20260906-67` の型）
 *   ④割り当てた一手を `[ ]` のまま残してチェックアウトできないこと
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNextList, topOpen, judgeDoingMark, judgeDoingClosed,
} from '../scripts/guard/next-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planText = fs.readFileSync(path.join(ROOT, 'docs/ops/plan.md'), 'utf8');
const ENV = { AI_SESSION_ID: 'session-A' };
const OTHER = { AI_SESSION_ID: 'session-B' };

test('docs/ops/plan.md に「次の一手」の節が在り、機械で読める', () => {
  const items = parseNextList(planText);
  assert.notEqual(items, null, '「次の一手」の節が無い（節ごと消して緑にしない・偽-2）');
  assert.ok(items.length > 0, '「次の一手」に項目が1件も無い');
  assert.ok(items.every((i) => /^N-\d+$/.test(i.id)), `番号の形が違う: ${items.map((i) => i.id).join(' ')}`);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, '番号が重複している');
});

test('やらないと決めた行（[-]）には、同じ行に理由が要る', () => {
  const items = parseNextList('## 次の一手\n\n- [-] N-9 やらない\n');
  assert.equal(items[0].reason, false);
  const ok = parseNextList('## 次の一手\n\n- [-] N-9 やらない（理由: マスター判断）\n');
  assert.equal(ok[0].reason, true);
});

test('いちばん上の未了を取る（済み・やらないは飛ばす）', () => {
  const items = parseNextList('## 次の一手\n\n- [x] N-1 済\n- [-] N-2 やらない（理由: あ）\n- [ ] N-3 これ\n- [ ] N-4 次\n');
  assert.equal(topOpen(items).id, 'N-3');
});

test('印が無ければ関所は赤（チェックインを踏まずに進めない）', () => {
  const items = parseNextList('## 次の一手\n\n- [ ] N-1 これ\n');
  assert.equal(judgeDoingMark(null, items, { env: ENV }).ok, false);
});

test('別のセッションが残した印では赤（前回の印で素通りできない）', () => {
  const items = parseNextList('## 次の一手\n\n- [ ] N-1 これ\n');
  const mark = { at: new Date().toISOString(), session: 'session-B', id: 'N-1', text: 'これ' };
  assert.equal(judgeDoingMark(mark, items, { env: ENV }).ok, false);
  assert.equal(judgeDoingMark(mark, items, { env: OTHER }).ok, true);
});

test('印が指す番号を消したら赤（番号を書き換えて緑にできない）', () => {
  const items = parseNextList('## 次の一手\n\n- [ ] N-2 別のもの\n');
  const mark = { at: new Date().toISOString(), session: 'session-A', id: 'N-1', text: 'これ' };
  assert.equal(judgeDoingMark(mark, items, { env: ENV }).ok, false);
});

test('チェックアウトは、割り当てた一手が [ ] のままなら赤', () => {
  const mark = { at: new Date().toISOString(), session: 'session-A', id: 'N-1', text: 'これ' };
  assert.equal(judgeDoingClosed(mark, parseNextList('## 次の一手\n\n- [ ] N-1 これ\n')).ok, false);
  assert.equal(judgeDoingClosed(mark, parseNextList('## 次の一手\n\n- [x] N-1 これ\n')).ok, true);
});

test('行ごと消して片づけたことにはできない（偽-9）', () => {
  const mark = { at: new Date().toISOString(), session: 'session-A', id: 'N-1', text: 'これ' };
  assert.equal(judgeDoingClosed(mark, parseNextList('## 次の一手\n\n- [ ] N-2 別\n')).ok, false);
});

test('やらないと決めた一手は、理由が書いてあるときだけ閉じられる', () => {
  const mark = { at: new Date().toISOString(), session: 'session-A', id: 'N-1', text: 'これ' };
  assert.equal(judgeDoingClosed(mark, parseNextList('## 次の一手\n\n- [-] N-1 これ\n')).ok, false);
  assert.equal(judgeDoingClosed(mark, parseNextList('## 次の一手\n\n- [-] N-1 これ（理由: マスター判断）\n')).ok, true);
});

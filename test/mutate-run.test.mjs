/**
 * mutate-run.test.mjs — 壊す機械そのものを見る
 *
 * この機械は**リポジトリを書き換える**ので、間違うと痕跡が残る。
 * いちばん怖いのは「壊したつもりで何も壊れていない」——そのまま走らせると
 * **「赤にならなかった＝検査が壊れている」と逆の結論**を出す（`docs/ops/proof-of-red.md`）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyMutation, MUTATIONS } from '../scripts/mutate-run.mjs';

function sandbox(rel, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-'));
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
  return root;
}

const M = {
  id: 'x', why: 'ためし', file: 'a/b.js',
  find: 'export function f(', replace: 'export function f_MUTATED(',
  extra: 'export function f() { return null; }\n', scripts: [],
};

test('壊して、元どおりに戻せる', () => {
  const body = 'export function f(x) { return x; }\n';
  const root = sandbox(M.file, body);
  const p = path.join(root, M.file);
  const restore = applyMutation(root, M);
  assert.match(fs.readFileSync(p, 'utf8'), /f_MUTATED/);
  restore();
  assert.equal(fs.readFileSync(p, 'utf8'), body, '元の中身に戻っていない');
});

test('目印が0回なら、壊さずに投げる（壊したつもりを作らない）', () => {
  const root = sandbox(M.file, 'export function g(x) { return x; }\n');
  const before = fs.readFileSync(path.join(root, M.file), 'utf8');
  assert.throws(() => applyMutation(root, M), /目印が 0回/);
  assert.equal(fs.readFileSync(path.join(root, M.file), 'utf8'), before, '投げたのに書き換えている');
});

test('目印が2回以上なら、壊さずに投げる（どこを壊したか分からない）', () => {
  const body = 'export function f(a) {}\n// export function f(b) {}\n';
  const root = sandbox(M.file, body);
  assert.throws(() => applyMutation(root, M), /目印が 2回/);
  assert.equal(fs.readFileSync(path.join(root, M.file), 'utf8'), body);
});

test('台帳の壊し方は、いまのリポジトリに1回ずつ現れる', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const m of MUTATIONS) {
    const src = fs.readFileSync(path.join(root, m.file), 'utf8');
    const hits = src.split(m.find).length - 1;
    assert.equal(hits, 1, `${m.id}: ${m.file} に目印が ${hits}回（1回でなければ壊せない）`);
  }
});

test('壊し方には、客に何が起きるかが書いてある', () => {
  for (const m of MUTATIONS) {
    assert.ok(m.why && m.why.length >= 10, `${m.id}: why が無いか短い`);
    assert.ok(m.scripts.length > 0, `${m.id}: どの検査に掛けるか書いていない`);
  }
});

test('壊したあとのファイルが、構文として正しい', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = path.resolve(import.meta.dirname, '..');
  for (const m of MUTATIONS) {
    const target = path.join(root, m.file);
    const before = fs.readFileSync(target, 'utf8');
    let restore = null;
    try {
      restore = applyMutation(root, m);
      const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
      assert.equal(r.status, 0,
        `${m.id}: 壊したあとが構文エラー。**壊し方が下手なだけ**で CI が赤になり、`
        + `「検査が気づかなかった」と読み違える\n${r.stderr}`);
    } finally {
      if (restore) restore();
      assert.equal(fs.readFileSync(target, 'utf8'), before, `${m.id}: 戻せていない`);
    }
  }
});

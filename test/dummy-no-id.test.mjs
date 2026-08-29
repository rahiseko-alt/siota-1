/**
 * dummy-no-id.test.mjs — 仮データ（window.DUMMY）は `id` を持ってはいけない
 *
 * `ui.js: renderDogs()` は「`id` が有れば実データ→URLで開く、無ければ仮データ→
 * 画面内だけで進む」を、データの形だけで判定する契約になっている。仮データが
 * `id` を持つと、バックエンドの読み込みが間に合わなかった一瞬に仮データが描画
 * されたとき、実在しない `/edit/p/{id}` へ実際に遷移して404になる
 * （本番で実際に発生・マスター報告・2026-08-29）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('window.DUMMY.dogs のどの犬も id を持たない', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/dummy.js'), 'utf8');
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox.window);
  const dogs = sandbox.window.DUMMY.dogs;
  assert.ok(dogs.length > 0, '仮データの犬が1頭も無い');
  for (const dog of dogs) {
    assert.equal(dog.id, undefined, `仮データの犬「${dog.name}」が id を持っている（実データと誤認される）`);
  }
});

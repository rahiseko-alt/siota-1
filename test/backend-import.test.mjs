/**
 * backend-import.test.mjs — backend/js/ の全モジュールが import できること（F1 完了条件の一部）
 *
 * 何を保証するか: backend/js/ の各ファイルが、存在しないファイルを import して
 * いない（＝「分けたのではなく、片方を消してしまっている」F1 バッドシナリオ #7 の型）。
 * 何を保証しないか: 関数の中身が正しいこと。ここは import が通るかだけを見る。
 *
 * 対象はディレクトリを列挙して決める（固定リストにしない）。ファイルを足せば
 * 自動で対象になり、対象が減ったら（偽-2「見る範囲を狭める」）件数の下限で止まる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/js');
const modules = fs.readdirSync(backendDir)
  .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  .sort();

test('backend/js/ に import 対象が 4 本以上ある（対象を狭めて緑にしない）', () => {
  assert.ok(modules.length >= 4, `対象が ${modules.length} 本しかない: ${modules.join(', ')}`);
});

for (const file of modules) {
  test(`backend/js/${file} が import できる`, async () => {
    await import(pathToFileURL(path.join(backendDir, file)).href);
  });
}

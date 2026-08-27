/**
 * admin-same-name.test.mjs — 同姓同名の飼い主を、行の上で見分けられること
 *
 * `docs/deferred.md` #36（マスター指摘 2026-08-27「同姓同名はどうする？」）。
 *
 * 中身は取り違えない——`id` は UUID で、削除も登録も id を使う。
 * 取り違えるのは**人**である。田中さんが2人いると、
 *   ① 削除の一覧（`pickOwnerForDelete`）が**同じ文字列の行を2つ**出す
 *   ② 新規ペットの飼い主選び（`formNewPet`）が**同じ名前の `<option>` を2つ**出す
 * ①を間違えれば顧客の全データが消え、②を間違えれば**その子のカルテが別の
 * 飼い主のポータルに出る**（`/my` は `owner_id` で引く）。②は誰も気づかない。
 *
 * **名前の重複は禁止にしない。** 親子・別世帯の同姓は実在する。禁止ではなく区別。
 *
 * ここで見るのは「見分けが出ている」ではなく「**2人の行が違う文字列になる**」。
 * 「note が空でない」だけを見ると、両方に同じ文字を出しても通ってしまう
 * （`docs/watch.md` W-1「検査が別の仕組みを見ている」の型）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ownerNote } from '../backend/js/supabase-admin.js';

const owner = (id, name, createdAt) => ({ id, name, createdAt });
const pet = (id, name, ownerId) => ({ id, name, ownerId, ownerName: '' });

test('同姓同名でも、飼っている子が違えば行が違う', () => {
  const owners = [owner('aaaa1111-x', '田中', '2026-08-01T00:00:00Z'), owner('bbbb2222-y', '田中', '2026-08-01T00:00:00Z')];
  const pets = [pet('p1', 'ポンチ', 'aaaa1111-x'), pet('p2', 'ムギ', 'bbbb2222-y')];

  const a = ownerNote(owners[0], pets, owners);
  const b = ownerNote(owners[1], pets, owners);

  assert.notEqual(a, b, '同姓同名の2人が同じ行になっている');
  assert.match(a, /ポンチ/);
  assert.match(b, /ムギ/);
});

test('同姓同名で登録日も違えば、日付で分かれる', () => {
  const owners = [owner('aaaa1111-x', '田中', '2026-08-01T00:00:00Z'), owner('bbbb2222-y', '田中', '2026-08-27T09:00:00Z')];
  const a = ownerNote(owners[0], [], owners);
  const b = ownerNote(owners[1], [], owners);

  assert.notEqual(a, b);
  assert.match(a, /2026-08-01/);
  assert.match(b, /2026-08-27/);
});

test('名前も登録日も子も全部同じなら、そこだけ ID を足す', () => {
  const owners = [owner('aaaa1111-x', '田中', '2026-08-01T00:00:00Z'), owner('bbbb2222-y', '田中', '2026-08-01T00:00:00Z')];
  const a = ownerNote(owners[0], [], owners);
  const b = ownerNote(owners[1], [], owners);

  assert.notEqual(a, b, '見分けが付かない2人が同じ行のままになっている');
  assert.match(a, /aaaa11/);
  assert.match(b, /bbbb22/);
});

test('同姓同名がいなければ、ID は出さない（意味の無い文字列を読ませない）', () => {
  const owners = [owner('aaaa1111-x', '田中', '2026-08-01T00:00:00Z'), owner('bbbb2222-y', '鈴木', '2026-08-01T00:00:00Z')];
  const a = ownerNote(owners[0], [], owners);

  assert.ok(!a.includes('ID '), `ひとりしかいない名前に ID が出ている: ${a}`);
});

test('子がいない飼い主は「まだ登録なし」と言う（空欄にして黙らない）', () => {
  const owners = [owner('aaaa1111-x', '田中', '2026-08-01T00:00:00Z')];
  const a = ownerNote(owners[0], [], owners);

  assert.ok(a.length > 0, '行が空のまま');
  assert.match(a, /子はまだ登録なし/);
});

test('登録日が取れなくても、行は空にならない', () => {
  const owners = [owner('aaaa1111-x', '田中', '')];
  const pets = [pet('p1', 'ポンチ', 'aaaa1111-x')];
  const a = ownerNote(owners[0], pets, owners);

  assert.match(a, /ポンチ/);
  assert.ok(!a.includes('登録 '), `取れていない日付を出している: ${a}`);
});

test('子が複数いれば全部出す（1頭だけ出して他を隠さない）', () => {
  const owners = [owner('aaaa1111-x', '田中', '2026-08-01T00:00:00Z')];
  const pets = [pet('p1', 'ポンチ', 'aaaa1111-x'), pet('p2', 'ムギ', 'aaaa1111-x')];

  assert.match(ownerNote(owners[0], pets, owners), /ポンチ・ムギ/);
});

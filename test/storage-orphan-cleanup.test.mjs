/**
 * 置き忘れの写真の片付け（放置リスト `#75`・レビュー 2026-11-20 H1 の残り・`F-20261120-95`）。
 *
 * 確定の途中でタブを閉じると、上げただけで登録されていない写真がカルテの置き場に残り、
 * `finalize_report` / `revise_report` がいつまでも断る。`removeUnregisteredAssets` は
 * それを消すが、**登録済みの写真と今回上げる写真は残さなければならない**。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { removeUnregisteredAssets } from '../backend/js/supabase-storage.js';

const ids = {
  shop: '10000000-0000-0000-0000-000000000001',
  pet: '40000000-0000-0000-0000-0000000000a1',
  report: '50000000-0000-0000-0000-0000000000a1',
  registered: '60000000-0000-0000-0000-0000000000a1',
  kept: '60000000-0000-0000-0000-0000000000a2',
  orphan: '60000000-0000-0000-0000-0000000000a3',
};
const report = { id: ids.report, pet_id: ids.pet, shop_id: ids.shop };
const prefix = `${ids.shop}/${ids.pet}/${ids.report}`;

function fakeClient({ listError = null, rowError = null, removeError = null } = {}) {
  const calls = { list: [], removed: [], rows: [] };
  const client = {
    storage: {
      from: () => ({
        list: async (path, options) => {
          calls.list.push({ path, options });
          return {
            data: [
              { name: `${ids.registered}.png` },
              { name: `${ids.kept}.png` },
              { name: `${ids.orphan}.webp` },
            ],
            error: listError,
          };
        },
        remove: async (paths) => {
          calls.removed.push(...paths);
          return { error: removeError };
        },
      }),
    },
    from: (table) => ({
      select: (columns) => ({
        eq: async (column, value) => {
          calls.rows.push({ table, columns, column, value });
          return { data: [{ storage_path: `${prefix}/${ids.registered}.png` }], error: rowError };
        },
      }),
    }),
  };
  return { client, calls };
}

test('登録されておらず今回の写真でもないものだけを消す', async () => {
  const { client, calls } = fakeClient();
  const result = await removeUnregisteredAssets({ client, report, petId: ids.pet, keepIds: [ids.kept] });
  assert.deepEqual(calls.removed, [`${prefix}/${ids.orphan}.webp`]);
  assert.equal(result.removed, 1);
  assert.equal(calls.list[0].path, prefix);
  assert.deepEqual(calls.rows[0], { table: 'report_assets', columns: 'storage_path', column: 'report_id', value: ids.report });
});

test('登録済みの写真と今回の写真しか無ければ、何も消さない', async () => {
  const { client, calls } = fakeClient();
  const result = await removeUnregisteredAssets({
    client, report, petId: ids.pet, keepIds: [ids.kept, ids.orphan],
  });
  assert.deepEqual(calls.removed, []);
  assert.equal(result.removed, 0);
});

test('一覧・登録の読み取り・削除のどれが失敗しても投げる（黙って進まない）', async () => {
  for (const options of [
    { listError: { message: 'x' } },
    { rowError: { message: 'x' } },
    { removeError: { message: 'x' } },
  ]) {
    const { client } = fakeClient(options);
    await assert.rejects(
      () => removeUnregisteredAssets({ client, report, petId: ids.pet, keepIds: [] }),
      Error,
      JSON.stringify(options),
    );
  }
});

test('別の犬のカルテを渡されたら、何も触らずに投げる', async () => {
  const { client, calls } = fakeClient();
  await assert.rejects(
    () => removeUnregisteredAssets({ client, report, petId: '40000000-0000-0000-0000-0000000000ff' }),
    TypeError,
  );
  assert.equal(calls.list.length, 0);
});

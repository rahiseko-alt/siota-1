/**
 * 置き忘れの写真だけをスタッフが消せる、の形（`202611200019`・放置リスト `#75`）。
 *
 * スタッフに許すのは「誰も登録していない写真」だけ。登録済みの写真の削除は管理者だけ
 * （`202611190017`）のままでなければならない。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/202611200019_storage_orphan_cleanup.sql', import.meta.url);

async function functionBody() {
  const sql = await readFile(migrationUrl, 'utf8');
  const match = sql.match(/create or replace function private\.storage_path_staff_orphan\(object_name text\)([\s\S]*?)\$\$;/i);
  assert.ok(match, 'private.storage_path_staff_orphan が定義されていない');
  return { sql, body: match[1] };
}

test('判定関数は security definer で search_path が空', async () => {
  const { body } = await functionBody();
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = ''/i);
});

test('判定は draft/final のカルテ・その店のスタッフ・登録の無い写真に限る', async () => {
  const { body } = await functionBody();
  assert.match(body, /report\.status in \('draft', 'final'\)/i);
  assert.match(body, /private\.is_shop_staff\(report\.shop_id\)/i);
  assert.match(body, /not exists \(\s*select 1 from public\.report_assets asset\s*where asset\.storage_path = object_name/i);
  for (const n of [1, 2, 3]) {
    assert.match(body, new RegExp(`private\\.try_uuid\\(\\(storage\\.foldername\\(object_name\\)\\)\\[${n}\\]\\)`, 'i'));
  }
});

test('実行権は authenticated だけ・削除のポリシーはこの関数を通す', async () => {
  const { sql } = await functionBody();
  assert.match(sql, /revoke all on function private\.storage_path_staff_orphan\(text\) from public, anon;/i);
  assert.match(sql, /grant execute on function private\.storage_path_staff_orphan\(text\) to authenticated;/i);
  assert.match(
    sql,
    /create policy report_assets_storage_staff_orphan_delete on storage\.objects\s+for delete to authenticated\s+using \(bucket_id = 'report-assets' and private\.storage_path_staff_orphan\(name\)\);/i,
  );
  /* 管理者の削除ポリシーには触らない（登録済みの写真は管理者しか消せないまま）。 */
  assert.doesNotMatch(sql, /drop policy[^;]*report_assets_storage_admin_delete/i);
});

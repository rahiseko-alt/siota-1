import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/202607160001_supabase_base.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../supabase/migrations/202607160002_report_archive.sql', import.meta.url);
const invitationMigrationUrl = new URL('../supabase/migrations/202607160003_invitation_management.sql', import.meta.url);
const storageMigrationUrl = new URL('../supabase/migrations/202607160004_private_storage_lifecycle.sql', import.meta.url);
const importMigrationUrl = new URL('../supabase/migrations/202607160005_import_ledger_rpc.sql', import.meta.url);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}

test('Supabase migration defines every tenant and authorization table', async () => {
  const sql = await migrationSql();
  const tables = [
    'shops', 'profiles', 'shop_memberships', 'owners', 'owner_users',
    'pets', 'reports', 'report_assets', 'invitations', 'audit_logs',
    'import_ledger',
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, 'i'), table);
  }
});

test('every exposed application table enables and forces RLS', async () => {
  const sql = await migrationSql();
  const tables = [
    'shops', 'profiles', 'shop_memberships', 'owners', 'owner_users',
    'pets', 'reports', 'report_assets', 'invitations', 'audit_logs',
    'import_ledger',
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} enable`);
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, 'i'), `${table} force`);
  }
});

test('RLS helpers use cached auth uid and locked search paths', async () => {
  const sql = await migrationSql();
  assert.match(sql, /\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /(?<!select )auth\.uid\(\)/i);
  const definerCount = (sql.match(/security definer/gi) || []).length;
  const lockedPathCount = (sql.match(/set search_path = ''/gi) || []).length;
  assert.ok(definerCount >= 10, `security definer functions: ${definerCount}`);
  assert.equal(lockedPathCount, definerCount);
});

test('migration contains required RLS and foreign-key indexes', async () => {
  const sql = await migrationSql();
  const indexes = [
    'shop_memberships_user_shop_active_idx',
    'owner_users_user_owner_idx',
    'owners_shop_created_idx',
    'pets_owner_created_active_idx',
    'pets_shop_created_active_idx',
    'reports_pet_date_id_idx',
    'reports_shop_status_date_idx',
    'report_assets_report_sort_idx',
    'invitations_shop_open_idx',
    'audit_logs_shop_created_idx',
  ];
  for (const index of indexes) assert.match(sql, new RegExp(`create index ${index}\\b`, 'i'), index);
});

test('report assets use a private restricted bucket and no service key', async () => {
  const sql = await migrationSql();
  assert.match(sql, /'report-assets'\s*,\s*'report-assets'\s*,\s*false/i);
  assert.match(sql, /10485760/);
  assert.match(sql, /image\/jpeg/);
  assert.match(sql, /image\/png/);
  assert.match(sql, /image\/webp/);
  assert.doesNotMatch(sql, /service[_ -]?role/i);
});

test('invitation claim is single-use, expiring, and lock-safe', async () => {
  const sql = await migrationSql();
  assert.match(sql, /candidate\.claimed_at is null/i);
  assert.match(sql, /candidate\.revoked_at is null/i);
  assert.match(sql, /candidate\.expires_at > now\(\)/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /extensions\.gen_random_bytes\(32\)/i);
  assert.match(sql, /extensions\.digest\(raw_token, 'sha256'\)/i);
});

test('storage policies derive shop pet and report from the protected path', async () => {
  const sql = await migrationSql();
  assert.match(sql, /storage\.foldername\(object_name\)\)\[1\]/i);
  assert.match(sql, /storage\.foldername\(object_name\)\)\[2\]/i);
  assert.match(sql, /storage\.foldername\(object_name\)\)\[3\]/i);
  assert.match(sql, /report\.status = 'final'/i);
  assert.match(sql, /link\.user_id = \(select auth\.uid\(\)\)/i);
});

test('report lifecycle keeps final rows immutable and archives through an audited RPC', async () => {
  const sql = await readFile(lifecycleMigrationUrl, 'utf8');
  assert.match(sql, /create policy reports_staff_update_draft/i);
  assert.match(sql, /status = 'draft'/i);
  assert.match(sql, /revoke insert, update, delete on public\.reports from authenticated/i);
  assert.match(sql, /grant update \(data\) on public\.reports to authenticated/i);
  assert.match(sql, /create or replace function public\.archive_report/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /'report\.archived'/i);
});

test('invitation management is single-use and prevents removing the last admin', async () => {
  const sql = await readFile(invitationMigrationUrl, 'utf8');
  assert.match(sql, /raw_token !~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /where id = invitation\.id and claimed_at is null/i);
  assert.match(sql, /if active_admins <= 1 then return null/i);
  assert.match(sql, /revoke insert, update, delete on public\.shop_memberships from authenticated/i);
  assert.match(sql, /set search_path = ''/i);
});

test('private storage lifecycle derives paths and keeps incomplete reports non-final', async () => {
  const sql = await readFile(storageMigrationUrl, 'utf8');
  assert.match(sql, /asset_path := draft\.shop_id::text \|\| '\/' \|\| draft\.pet_id::text/i);
  assert.match(sql, /report\.status = 'draft'/i);
  assert.match(sql, /draft\.data::text ~\* 'data:image\/'/i);
  assert.match(sql, /regexp_matches\([\s\S]*asset:\/\/\(\[0-9a-f\]/i);
  assert.match(sql, /object\.metadata ->> 'mimetype' = target_mime/i);
  assert.match(sql, /object\.metadata ->> 'size' = target_size::text/i);
  assert.match(sql, /left join storage\.objects/i);
  assert.match(sql, /not exists \([\s\S]*public\.report_assets asset/i);
  assert.match(sql, /if exists \([\s\S]*storage\.objects[\s\S]*then return false/i);
  assert.match(sql, /revoke insert, update, delete on public\.report_assets from authenticated/i);
  assert.match(sql, /private\.storage_path_staff_upload\(name\)/i);
  assert.match(sql, /set search_path = ''/i);
});

test('migration ledger RPC is admin-scoped and never grants direct table access', async () => {
  const sql = await readFile(importMigrationUrl, 'utf8');
  assert.match(sql, /private\.is_shop_admin\(target_shop\)/i);
  assert.match(sql, /'cloudflare-kv:' \|\| target_shop::text/i);
  assert.match(sql, /on conflict \(source_system, entity_type, legacy_key\) do update/i);
  assert.match(sql, /target_source_hash !~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.write_import_ledger[\s\S]*from public, anon/i);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete).*import_ledger.*authenticated/i);
});

/* ══════════════════════════════════════════════════════════════
   まとめ入力が自店舗のレート制限に当たっていた（D-20260824-30 の 5）

   `consume_rate_limit` は上限表を関数の中に literal で持つので、
   「最後に定義した 1 本」が実際に効く。マイグレーションを足したのに
   古い方が残っている、を防ぐため**両方**を見る。
   ══════════════════════════════════════════════════════════════ */
const rateLimitMigrationUrl = new URL('../supabase/migrations/202607160006_rate_limit_batch_entry.sql', import.meta.url);

test('アセット登録の上限が、まとめ入力に耐える幅になっている', async () => {
  const sql = await readFile(rateLimitMigrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.consume_rate_limit/, '関数を定義し直していない');
  const row = sql.match(/\('asset_metadata',\s*(\d+),\s*(\d+)\)/);
  assert.ok(row, 'asset_metadata の行が無い');
  const [, limit, windowSeconds] = row.map(Number);
  /* 1カルテ最大11アセット。10分で10カルテは書けるだけの幅が要る。 */
  assert.ok(limit >= 11 * 10, `10分あたり ${limit} 回では ${Math.floor(limit / 11)} カルテしか入力できない`);
  assert.equal(windowSeconds, 600);
  /* 無制限にはしない——乗っ取られたスタッフ用アカウントへの歯止めでもある。 */
  assert.ok(limit <= 1000, '上限が実質無くなっている');
});

test('古い上限を持つ定義が後から上書きし返していない', async () => {
  const base = await migrationSql();
  const older = base.match(/\('asset_metadata',\s*(\d+),/);
  assert.ok(older, '基盤マイグレーションの asset_metadata が読めない');
  /* 基盤（0001）→ 追加（0006）の順に適用されるので、後勝ちで 0006 が効く。
     0001 を直接書き換えていないこと（Append-Only）も併せて確かめる。 */
  assert.equal(Number(older[1]), 60, '基盤マイグレーションを書き換えている（適用済みDBと食い違う）');
});

/* ══════════════════════════════════════════════════════════════
   飼い主側のアクセスが、スタッフ側の見え方と一致していなかった
   （D-20260824-30 の 8 と 9）
   ══════════════════════════════════════════════════════════════ */
const ownerAccessMigrationUrl = new URL('../supabase/migrations/202607160007_owner_access_control.sql', import.meta.url);

test('退会扱いの飼い主は、入口4本すべてから締め出される', async () => {
  const sql = await readFile(ownerAccessMigrationUrl, 'utf8');
  /* 1本でも漏らすと、そこだけ見え続ける。
     is_owner_user=owners/pets / can_read_pet=reports /
     can_read_final_report=report_assets / storage_path_customer=Storage。 */
  for (const fn of ['is_owner_user', 'can_read_pet', 'can_read_final_report', 'storage_path_customer']) {
    const start = sql.indexOf(`create or replace function private.${fn}(`);
    assert.ok(start > 0, `${fn} を定義し直していない`);
    const body = sql.slice(start, sql.indexOf('$$;', start));
    assert.match(body, /join public\.owners owner/, `${fn} が owners を見ていない`);
    assert.match(body, /owner\.active/, `${fn} が owners.active を条件にしていない`);
  }
});

test('紐付けを外す手段があり、他店舗には届かない', async () => {
  const sql = await readFile(ownerAccessMigrationUrl, 'utf8');
  const start = sql.indexOf('create or replace function public.revoke_owner_link');
  assert.ok(start > 0, 'revoke_owner_link が無い');
  const body = sql.slice(start);
  assert.match(body, /private\.is_shop_staff\(owner_shop\)/, '自店舗のスタッフか確認していない');
  assert.match(body, /delete from public\.owner_users/, '紐付けを消していない');
  assert.match(body, /audit_logs/, '誰を外したか記録していない');
  assert.match(body, /grant execute on function public\.revoke_owner_link/, 'authenticated に実行権が無い');
  /* owner_users への直接 delete は与えない（他店舗の行に触れないことを関数側で保証する）。 */
  assert.doesNotMatch(sql, /grant\s+delete\s+on\s+public\.owner_users/i, 'テーブルに直接 delete を与えている');
});

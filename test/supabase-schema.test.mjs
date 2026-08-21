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

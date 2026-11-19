import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/202607160001_supabase_base.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../supabase/migrations/202607160002_report_archive.sql', import.meta.url);
const invitationMigrationUrl = new URL('../supabase/migrations/202607160003_invitation_management.sql', import.meta.url);
const storageMigrationUrl = new URL('../supabase/migrations/202607160004_private_storage_lifecycle.sql', import.meta.url);
const importMigrationUrl = new URL('../supabase/migrations/202607160005_import_ledger_rpc.sql', import.meta.url);
/* 取り込み台帳の RPC は `202609060012` で**いまの形**に置き換わっている（権限が1本になった回）。
   古い `202607160005` の定義を読んだままだと、検査が古い形を名指しし続ける（`F-20260910-83`）。 */
const singleStaffRoleMigrationUrl = new URL('../supabase/migrations/202609060012_single_staff_role.sql', import.meta.url);
/* 店舗側を「管理者」と「スタッフ」に分け直した回（マスター指示 2026-11-19・plan.md `N-49`）。
   `202609060012` で消した `is_shop_admin` と `role` 列は、ここで**作り直されている**。 */
const adminStaffRolesMigrationUrl = new URL('../supabase/migrations/202611190017_admin_staff_roles.sql', import.meta.url);

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

test('migration ledger RPC is staff-scoped and never grants direct table access', async () => {
  /* **いまの定義を読む。** 中身（誰が呼べるか・何を弾くか）は `202609060012` が
     `create or replace` で置き換えている。ここは以前 `202607160005` の古い定義を読んでいた
     （`F-20260910-83`）。取り込み台帳は**スタッフにも許す側**のまま（`N-49` は削除・店舗設定・
     スタッフ招待だけを管理者に絞った）なので、`is_shop_admin` で絞っていないことも見る。 */
  const sql = await readFile(singleStaffRoleMigrationUrl, 'utf8');
  assert.match(sql, /private\.is_shop_staff\(target_shop\)/i);
  assert.doesNotMatch(sql, /private\.is_shop_admin\(target_shop\)/i);
  /* **後の回が定義し直していない**こと——していれば、上で読んだのは「いまの形」ではない。 */
  const latest = await readFile(adminStaffRolesMigrationUrl, 'utf8');
  assert.doesNotMatch(latest, /function public\.write_import_ledger/i, 'N-49 の回が取り込み台帳を定義し直している');
  assert.match(sql, /'cloudflare-kv:' \|\| target_shop::text/i);
  assert.match(sql, /on conflict \(source_system, entity_type, legacy_key\) do update/i);
  assert.match(sql, /target_source_hash !~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  /* 権限の revoke/grant は `202607160005` のまま（`create or replace` は権限を戻さない）。 */
  const grants = await readFile(importMigrationUrl, 'utf8');
  assert.match(grants, /revoke all on function public\.write_import_ledger[\s\S]*from public, anon/i);
  assert.doesNotMatch(grants, /grant (?:select|insert|update|delete).*import_ledger.*authenticated/i);
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

/* ══════════════════════════════════════════════════════════════
   店舗側の権限を「管理者」と「スタッフ」に分け直した
   （マスター指示 2026-11-19・plan.md `N-49`・`202611190017`）

   2026-09-06 の判断（`D-20260906-68`・権限は1本）を、マスターが改めて分け直した。
   以前この帳面は「`is_shop_admin` が無いこと」を見ていたが、いまの正は逆で、
   **スタッフにさせないのは 削除・店舗設定・スタッフ招待 の3つだけ**。
   守るのはデータベースなので、その3つが `is_shop_admin` を通ることをここで見る。
   ══════════════════════════════════════════════════════════════ */

/** `create or replace function <name>(` から、その本体の終わり（`$$;`）までを切り出す。 */
function functionBody(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `${name} を定義していない`);
  return sql.slice(start, sql.indexOf('$$;', start));
}

test('N-49: 役割の列と、管理者かどうかの判定を定義している', async () => {
  const sql = await readFile(adminStaffRolesMigrationUrl, 'utf8');
  assert.match(sql, /alter table public\.shop_memberships\s+add column role text not null default 'admin'\s+check \(role in \('admin', 'staff'\)\)/i);
  const isAdmin = functionBody(sql, 'private.is_shop_admin');
  assert.match(isAdmin, /security definer[\s\S]*set search_path = ''/i);
  assert.match(isAdmin, /membership\.user_id = \(select auth\.uid\(\)\)/i, '呼んだ本人で絞っていない');
  assert.match(isAdmin, /membership\.active/i, '無効なメンバーを管理者に数えている');
  assert.match(isAdmin, /membership\.role = 'admin'/i, '役割を見ていない');
  assert.match(sql, /revoke all on function private\.is_shop_admin\(uuid\) from public, anon/i);
});

test('N-49: 顧客・犬の FOR ALL を落とし、削除だけを管理者に絞っている', async () => {
  const sql = await readFile(adminStaffRolesMigrationUrl, 'utf8');
  for (const table of ['owners', 'pets']) {
    /* FOR ALL が残っていると、下の delete 方針を足しても RLS は OR で通してしまう。 */
    assert.match(sql, new RegExp(`drop policy if exists ${table}_staff_all on public\\.${table};`, 'i'),
      `${table}_staff_all を落としていない`);
    assert.match(sql, new RegExp(`create policy ${table}_admin_delete on public\\.${table}\\s+for delete to authenticated using \\(private\\.is_shop_admin\\(shop_id\\)\\)`, 'i'),
      `${table} の削除が管理者に絞られていない`);
    /* スタッフに残すもの（読む・作る・直す）を、落としたまま忘れていないか。 */
    for (const op of ['select', 'insert', 'update']) {
      assert.match(sql, new RegExp(`create policy ${table}_staff_${op} on public\\.${table}\\s+for ${op} to authenticated`, 'i'),
        `${table} の ${op} がスタッフから消えた`);
    }
    assert.doesNotMatch(sql, new RegExp(`create policy \\w+ on public\\.${table}\\s+for all`, 'i'),
      `${table} に FOR ALL を作り直している`);
    assert.match(sql, new RegExp(`create trigger ${table}_guard_deactivate\\s+before update of active on public\\.${table}`, 'i'),
      `${table} の「使わない」にする抜け道が開いている`);
  }
  const guard = functionBody(sql, 'private.guard_deactivate');
  assert.match(guard, /old\.active and not new\.active and not private\.is_shop_admin\(new\.shop_id\)/i);
  assert.match(sql, /drop policy if exists report_assets_storage_staff_delete on storage\.objects/i);
  /* 写真の実体の削除は管理者だけ。判定は security definer の関数に閉じ込める
     （ポリシーから `try_uuid` を直に呼ぶと、ログインした人に実行権が無く管理者まで断られた・実測）。 */
  assert.match(sql, /create policy report_assets_storage_admin_delete on storage\.objects[\s\S]*?private\.storage_path_admin\(name\)/i);
  assert.match(functionBody(sql, 'private.storage_path_admin'), /private\.is_shop_admin\(report\.shop_id\)/i);
});

test('N-49: カルテの削除と隠すことは管理者だけ', async () => {
  const sql = await readFile(adminStaffRolesMigrationUrl, 'utf8');
  for (const fn of ['public.mark_report_deleting', 'public.complete_report_deletion', 'public.archive_report']) {
    const body = functionBody(sql, fn);
    assert.match(body, /private\.is_shop_admin\(report\.shop_id\)/i, `${fn} が管理者で絞っていない`);
    assert.doesNotMatch(body, /private\.is_shop_staff\(/i, `${fn} にスタッフの判定が残っている`);
  }
});

test('N-49: 店舗設定は管理者だけ', async () => {
  const sql = await readFile(adminStaffRolesMigrationUrl, 'utf8');
  assert.match(sql, /drop policy if exists shops_staff_update on public\.shops/i);
  assert.match(sql, /create policy shops_admin_update on public\.shops\s+for update to authenticated\s+using \(private\.is_shop_admin\(id\)\) with check \(private\.is_shop_admin\(id\)\)/i);
});

test('N-49: スタッフ招待を出す・取り消すのは管理者だけ（飼い主の招待はスタッフも）', async () => {
  const sql = await readFile(adminStaffRolesMigrationUrl, 'utf8');
  const create = functionBody(sql, 'public.create_invitation');
  assert.match(create, /not private\.is_shop_staff\(target_shop\)/i, '店の人かどうかを見ていない');
  /* **前の招待を取り消す update より前に断る**——後ろだと、断られたのに管理者の招待が消える。 */
  const adminGuard = create.search(/if target_type = 'staff' and not private\.is_shop_admin\(target_shop\) then/i);
  assert.ok(adminGuard > 0, 'スタッフ招待を管理者で絞っていない');
  assert.ok(adminGuard < create.search(/update public\.invitations/i), '断る前に前の招待を取り消している');
  const revoke = functionBody(sql, 'public.revoke_invitation');
  assert.match(revoke, /invitation\.invitation_type = 'staff' and not private\.is_shop_admin\(invitation\.shop_id\)/i);
  /* スタッフ招待で入った人は staff。既に居る人は降格させない（on conflict で role を書かない）。 */
  const claim = functionBody(sql, 'public.claim_invitation');
  assert.match(claim, /insert into public\.shop_memberships \(shop_id, user_id, active, role\)\s+values \(invitation\.shop_id, actor, true, 'staff'\)/i);
  assert.match(claim, /on conflict \(shop_id, user_id\) do update set active = true;/i);
  for (const op of ['insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`drop policy if exists memberships_staff_${op} on public\\.shop_memberships`, 'i'));
    assert.match(sql, new RegExp(`create policy memberships_admin_${op} on public\\.shop_memberships[\\s\\S]*?private\\.is_shop_admin\\(shop_id\\)`, 'i'));
  }
});

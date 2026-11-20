/**
 * report-revisions.test.mjs — 確定済みカルテを直したとき、直す前の中身が残ること（放置リスト `#77`・レビュー M2）
 *
 * SQL はここでは流せない（実際の PostgreSQL で通すのは `npm run verify:migrations`）。
 * ここで見るのは「書いてある形」だけ:
 *   - 履歴の表が RLS 有効かつ FORCE で、読めるのは管理者だけ
 *   - 画面側（authenticated）に insert/update/delete を渡していない（履歴を改ざんできない）
 *   - `revise_report` は `202609230015` と同じ形のまま、差し替えの直前に履歴を書く1手だけ増えた
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const revisionsSql = await readFile(
  new URL('../supabase/migrations/202611200021_report_revisions.sql', import.meta.url), 'utf8',
);
const previousSql = await readFile(
  new URL('../supabase/migrations/202609230015_revise_report_photo_replace.sql', import.meta.url), 'utf8',
);

/* `--` の行コメントを外す（ヘッダの説明文に出てくる語で誤って合格しないように）。 */
const code = (sql) => sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

function reviseFunction(sql) {
  const match = code(sql).match(/create or replace function public\.revise_report\([\s\S]*?\n\$\$;/);
  assert.ok(match, 'revise_report の定義が見つからない');
  return match[0];
}

/* 履歴の1手（前の空行・コメント・insert 文）。これを取り除いた残りが 202609230015 と一致すること。 */
const HISTORY_STEP = /\n\n *\/\* `#77`:[\s\S]*?\*\/\n *insert into public\.report_revisions[^;]*;\n/;

test('report_revisions は RLS 有効かつ FORCE', () => {
  const sql = code(revisionsSql);
  assert.match(sql, /create table public\.report_revisions \(/);
  assert.match(sql, /alter table public\.report_revisions enable row level security;/);
  assert.match(sql, /alter table public\.report_revisions force row level security;/);
});

test('report_revisions を読めるのは管理者だけ（select のポリシー1本・is_shop_admin）', () => {
  const sql = code(revisionsSql);
  const policies = [...sql.matchAll(/create policy (\w+) on public\.report_revisions\s+for (\w+) to (\w+) using \(([^;]*)\);/g)];
  assert.equal(policies.length, 1, 'ポリシーは1本だけ');
  const [, , command, role, using] = policies[0];
  assert.equal(command, 'select');
  assert.equal(role, 'authenticated');
  assert.match(using, /^private\.is_shop_admin\(shop_id\)\)?$/);
});

test('authenticated に insert/update/delete を渡さない（履歴は関数の中からしか書けない）', () => {
  const sql = code(revisionsSql);
  assert.match(sql, /revoke all on public\.report_revisions from anon, authenticated;/);
  const grants = [...sql.matchAll(/grant ([^;]*?) on (?:table )?public\.report_revisions to ([^;]*);/g)];
  assert.equal(grants.length, 1, 'grant は select の1本だけ');
  assert.equal(grants[0][1].trim(), 'select');
  assert.equal(grants[0][2].trim(), 'authenticated');
  assert.doesNotMatch(sql, /grant[^;]*\b(insert|update|delete|all)\b[^;]*public\.report_revisions/);
});

test('カルテ本体を消すと履歴も消える（他店舗のカルテを指せない複合 FK）', () => {
  assert.match(
    code(revisionsSql),
    /foreign key \(report_id, shop_id\)\s+references public\.reports\(id, shop_id\) on delete cascade/,
  );
});

test('revise_report は 202609230015 と同じ形のまま、履歴を書く1手だけ増えた', () => {
  const current = reviseFunction(revisionsSql);
  const previous = reviseFunction(previousSql);
  assert.match(current, HISTORY_STEP, '履歴を書く1手が無い');
  assert.equal(current.replace(HISTORY_STEP, '\n'), previous, '履歴の1手以外が変わっている');
});

test('履歴は整合性チェックの return null をすべて通ったあと、data の差し替えより前に書く', () => {
  const fn = reviseFunction(revisionsSql);
  const insertAt = fn.indexOf('insert into public.report_revisions');
  const updateAt = fn.indexOf('update public.reports report');
  const lastReturnNull = fn.lastIndexOf('return null');
  const lockAt = fn.indexOf('for update;');
  assert.ok(insertAt > 0 && updateAt > 0 && lockAt > 0);
  assert.ok(lockAt < insertAt, '行のロックより後に書く');
  assert.ok(lastReturnNull < insertAt, '直さない道（return null）では書かない');
  assert.ok(insertAt < updateAt, '差し替える前の中身を書く');
  assert.match(
    fn,
    /insert into public\.report_revisions \(shop_id, report_id, previous_data, revised_by\)\s+values \(target\.shop_id, target\.id, target\.data, actor\);/,
  );
});

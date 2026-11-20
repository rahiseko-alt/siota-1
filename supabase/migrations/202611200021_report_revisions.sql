-- 確定済みカルテを「直す」たびに、直す前の中身を残す（放置リスト `#77`・レビュー M2・CVSS 5.4）
--
-- なぜ要るか:
--   `revise_report`（最新の定義は `202609230015_revise_report_photo_replace.sql`）は、
--   確定済みカルテの `data` を**履歴なしで**丸ごと差し替えていた。店舗のスタッフなら誰でも
--   上書きでき（空にすることもできる）、前の中身はどこにも残らない。`audit_logs` には
--   「誰が・いつ直したか」（`report.revised`）だけが残り、**何が消えたか**は戻せなかった。
--
-- 何を変えたか（これだけ）:
--   1. 表 `public.report_revisions` を足す。1行 = 「直す直前の `data`」1版。
--      読めるのは**その店舗の管理者だけ**（`private.is_shop_admin`）。
--      画面や API から直接 insert/update/delete する道は作らない——書くのは
--      `revise_report`（security definer）だけにして、履歴そのものを改ざんできなくする
--      （`audit_logs` と同じ形: 表は select のみ、書き込みは関数の中だけ）。
--   2. `public.revise_report` に1手だけ足す: 行をロックして3つの整合性チェックを
--      通ったあと、`data` を差し替える**直前に**古い `data` を `report_revisions` へ入れる。
--      チェックに落ちて `return null` する道では書かない（実際に直したときだけ残す）。
--      差し替えが例外で失敗したときは、同じトランザクションなので履歴の行も一緒に取り消される。
--      それ以外（引数・チェック・戻り値・権限）は `202609230015` と変えていない
--      （`create or replace` は既存の grant を保つ）。
--
-- 前の版に戻すには:
--   管理者が、戻したい版の `previous_data` を新しい中身として `revise_report` を呼ぶ
--   （ふつうは管理者画面の「カルテ修正」から。関数は `auth.uid()` を要るので、
--   ログインした管理者として呼ぶ必要がある）。戻す操作そのものも `revise_report` を
--   通るので、「戻す直前の中身」がまた1版として残る。戻しても何も失われない。
--
-- あるカルテの履歴を見る（読むだけ・新しい順）:
--   select id, revised_at, revised_by, previous_data
--   from public.report_revisions
--   where report_id = '<カルテのid>'
--   order by revised_at desc;
--
-- やらなかったこと（意図的）:
--   - 写真の実体（Storage・`report_assets`）の版管理はしない。`previous_data` に残るのは
--     `asset://` の参照までで、直しで外した写真の実体は従来どおり自動では消えない
--     （`202609230015` の「やらなかったこと」と同じ）。
--   - 履歴の保存期間は決めていない。カルテ本体を消すと履歴も一緒に消える（`on delete cascade`）。

begin;

create table public.report_revisions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  report_id uuid not null,
  previous_data jsonb not null,
  revised_by uuid,
  revised_at timestamptz not null default now(),
  constraint report_revisions_report_shop_fkey foreign key (report_id, shop_id)
    references public.reports(id, shop_id) on delete cascade
);

create index report_revisions_report_revised_at_idx
  on public.report_revisions (report_id, revised_at desc);

alter table public.report_revisions enable row level security;
alter table public.report_revisions force row level security;

/* 読めるのは管理者だけ。戻すかどうかを決めるのは管理者で、直した本人（スタッフ）が
   消した中身を辿れる必要は無い。 */
create policy report_revisions_admin_select on public.report_revisions
  for select to authenticated using (private.is_shop_admin(shop_id));

/* Supabase は新しい表に anon/authenticated の権限を既定で付ける。
   まず全部外し、select だけを戻す（insert/update/delete は誰にも渡さない）。 */
revoke all on public.report_revisions from anon, authenticated;
grant select on public.report_revisions to authenticated;

create or replace function public.revise_report(target_report uuid, new_data jsonb)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.reports%rowtype;
  revised public.reports%rowtype;
  report_prefix text;
begin
  if new_data is null then
    raise exception using errcode = '22023', message = 'new_data required';
  end if;

  select report.* into target
  from public.reports report
  where report.id = target_report
    and report.status = 'final'
    and private.is_shop_staff(report.shop_id)
  for update;

  /* 見つからない理由は3つ（存在しない／final でない／その店舗のスタッフでない）。
     どれかを言い分けると、他店舗のカルテの存在を教えてしまう。まとめて弾く。 */
  if not found or actor is null then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  /* ここから3つは `finalize_report` と同じ整合性チェック。写真の貼り替えを
     許した以上、直しでも「参照した実体が本当にあるか」を見ないと、
     壊れた参照のまま確定済みデータを上書きできてしまう。 */
  report_prefix := target.shop_id::text || '/' || target.pet_id::text || '/' || target.id::text || '/';
  if new_data::text ~* 'data:image/' then return null; end if;
  if exists (
    select 1
    from regexp_matches(
      new_data::text,
      'asset://([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      'gi'
    ) as found(marker)
    where not exists (
      select 1 from public.report_assets asset
      where asset.report_id = target.id and asset.id = ((found.marker)[1])::uuid
    )
  ) then return null; end if;
  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'report-assets'
      and object.name like report_prefix || '%'
      and not exists (
        select 1 from public.report_assets asset
        where asset.report_id = target.id and asset.storage_path = object.name
      )
  ) then return null; end if;

  /* `#77`: 差し替える直前の中身を残す。ここより上の `return null` では書かない
     （直していないのに版が増えない）。下の update が例外で落ちれば、この行も取り消される。 */
  insert into public.report_revisions (shop_id, report_id, previous_data, revised_by)
  values (target.shop_id, target.id, target.data, actor);

  update public.reports report
  set data = new_data, updated_at = now()
  where report.id = target.id and report.status = 'final'
  returning report.* into revised;
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (revised.shop_id, actor, 'report.revised', 'report', revised.id);
  return revised;
end;
$$;

commit;

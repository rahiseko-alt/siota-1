/*
 * 202611200019_storage_orphan_cleanup.sql
 *
 * 登録されないまま残った写真（＝置き忘れ）だけは、スタッフも消せるようにする
 * （放置リスト `#75`・`docs/ops/review-2026-11-20.md` H1 の残り・`F-20261120-95`）。
 *
 * **なぜ要るか**: 確定の途中で写真を Storage に上げた直後にタブを閉じると、その写真は
 * `report_assets` に登録されないまま、カルテの置き場 `{shop}/{pet}/{report}/` に残る。
 * `finalize_report`（`202607160004`）と `revise_report`（`202609230015`）は、置き場に
 * 登録されていない写真が1つでもあると `null` を返して断る。再試行の番号引き継ぎ
 * （`replaceDataUrlAssets` の `cache`）は同じ画面の中でしか効かないので、タブを閉じた後は
 * 誰も置き忘れを片付けられず、**そのカルテは二度と確定も修正もできなかった**。
 * `202611190017` で Storage の削除を管理者だけにしたので、スタッフが書いていた場合は
 * 管理者を呼ぶ以外に戻す道が無い。
 *
 * **スタッフに許すのは「誰も登録していない写真」だけ**。登録済みの写真は飼い主に届いている
 * （または確定で届く）ものなので、これまでどおり管理者しか消せない（`report_assets_storage_admin_delete`
 * は触らない）。置き忘れは誰にも見えておらず、確定を止めているだけなので、消しても何も失われない。
 *
 * 判定は `storage_path_staff` / `storage_path_admin` と同じ形の security definer 関数に閉じ込める。
 * `report_assets` の行を本人の権限に関係なく見に行く必要があるため（RLS を経由すると判定が揺れる）。
 * 対象は `draft` と `final` のカルテだけ。`deleting` は管理者の削除の流れ（`deleteReportAssets`）が片付ける。
 *
 * 既存の migration は書き換えない（適用済みの歴史を直すと本番と手元が食い違う）。
 */

begin;

create or replace function private.storage_path_staff_orphan(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports report
    join public.pets pet on pet.id = report.pet_id and pet.shop_id = report.shop_id
    where report.shop_id = private.try_uuid((storage.foldername(object_name))[1])
      and pet.id = private.try_uuid((storage.foldername(object_name))[2])
      and report.id = private.try_uuid((storage.foldername(object_name))[3])
      and report.status in ('draft', 'final')
      and private.is_shop_staff(report.shop_id)
      and not exists (
        select 1 from public.report_assets asset
        where asset.storage_path = object_name
      )
  );
$$;

revoke all on function private.storage_path_staff_orphan(text) from public, anon;
grant execute on function private.storage_path_staff_orphan(text) to authenticated;

drop policy if exists report_assets_storage_staff_orphan_delete on storage.objects;
create policy report_assets_storage_staff_orphan_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'report-assets' and private.storage_path_staff_orphan(name));

commit;

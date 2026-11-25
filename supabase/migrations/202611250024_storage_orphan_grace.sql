/*
 * 202611250024_storage_orphan_grace.sql
 *
 * 置き忘れの写真の片づけで、**上げてから3分たっていない写真は、スタッフには消させない**
 * （基準に照らしたレビュー 2026-11-25・`docs/ops/review-2026-11-25.md` R7）。
 *
 * ── 何が起きていたか ──
 *   `202611200019` でスタッフに「誰も登録していない写真」を消すことを許した。登録の無い写真には
 *   2種類ある——①タブを閉じて置き去りになった本物の置き忘れ、②**いま別の人（別の端末）が
 *   上げた直後で、まだ登録の前**の写真。②を消すと、その人の確定・修正が写真の欠けで失敗する。
 *   画面（`backend/js/supabase-storage.js` の `ORPHAN_GRACE_MS`）は「3分以内の写真は消さない」を
 *   守っていたが、**端末の時計を頼りにした画面側だけの決まり**で、データベースは断らなかった。
 *
 * ── どう直すか ──
 *   スタッフの削除ポリシー `report_assets_storage_staff_orphan_delete` に、
 *   `storage.objects.created_at`（データベースの時計で入る）が3分より前、を足す。
 *   3分は画面の `ORPHAN_GRACE_MS` と同じ数。`created_at` が空の行は断る側に倒れる。
 *   判定関数 `private.storage_path_staff_orphan` は変えていない。
 *
 * ── 変えていないもの（正直に書く）──
 *   管理者の削除ポリシー `report_assets_storage_admin_delete`（`202611190017`）には足していない。
 *   管理者は犬・飼い主・カルテを消す流れ（`purgePetAssets` 等）で、その下の写真を**登録の有無に
 *   関係なく**全部消す必要がある。そこに3分の待ちを入れると、犬を消した直後に写真だけが
 *   誰にも消せない形で残る（犬の行が消えるとポリシーの判定に使う行も消えるため）。
 *   管理者の片づけが他の人の上げた直後の写真を消す場合は、画面側の3分だけが守りのまま。
 */

begin;

drop policy if exists report_assets_storage_staff_orphan_delete on storage.objects;
create policy report_assets_storage_staff_orphan_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'report-assets'
    and created_at <= now() - interval '3 minutes'
    and private.storage_path_staff_orphan(name)
  );

commit;

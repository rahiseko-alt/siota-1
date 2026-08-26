-- 確定済みカルテを直せるようにする（マスター指示 2026-08-26・管理者画面の「カルテ修正」）
--
-- なぜ要るか:
--   `reports_staff_update_draft` は `status = 'draft'` の行しか更新を許していない
--   （using も with check も）。つまり**一度確定したカルテは、書き間違いがあっても
--   誰も直せなかった**。飼い主にはもう届いているので、直せないことがそのまま
--   「間違ったまま届き続ける」になる。
--
--   ポリシーを緩めて `final` も直接 update できるようにはしない。それだと
--   `status` 自体を書き換える道も開いてしまう（grant は data 列だけだが、
--   using を緩めると archived からの復活など想定外の遷移を招く）。
--   `archive_report` と同じく **security definer の RPC を1本足す**——
--   できることを「final の data を差し替える」1つに閉じる。
--
-- 誰ができるか: その店舗のスタッフ（`private.is_shop_staff`）。
--   管理者だけに絞っていない。入口は管理者画面だが、日々カルテを書くのは
--   トリマーで、書き間違いを直すのも同じ人である。`archive_report` と同じ範囲。

begin;

create or replace function public.revise_report(target_report uuid, new_data jsonb)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  revised public.reports%rowtype;
begin
  if new_data is null then
    raise exception using errcode = '22023', message = 'new_data required';
  end if;

  update public.reports report
  set data = new_data, updated_at = now()
  where report.id = target_report
    and report.status = 'final'
    and private.is_shop_staff(report.shop_id)
  returning report.* into revised;

  /* 見つからない理由は3つ（存在しない／final でない／その店舗のスタッフでない）。
     どれかを言い分けると、他店舗のカルテの存在を教えてしまう。まとめて弾く。 */
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (revised.shop_id, actor, 'report.revised', 'report', revised.id);
  return revised;
end;
$$;

revoke all on function public.revise_report(uuid, jsonb) from public, anon;
grant execute on function public.revise_report(uuid, jsonb) to authenticated;

commit;

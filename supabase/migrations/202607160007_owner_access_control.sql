/*
 * 202607160007_owner_access_control.sql
 *
 * 飼い主側のアクセスを、スタッフ側の見え方と一致させる（D-20260824-30 の 8 と 9）。
 *
 * ── 8: `owners.active = false` が飼い主のアクセスを遮断していなかった ──
 *   スタッフ側の一覧は `active=eq.true` で絞るので、退会扱いにした飼い主は画面から
 *   消える。ところが飼い主側の判定は `owner_users` の行だけを見ており、
 *   **その飼い主は `/my` で今まで通り自分の犬もカルテも読めた**。
 *   「退会済みに見えるのに見えている」という食い違いは、店側が「もう見えていない」と
 *   信じて動く場面（引き継ぎ・トラブル対応）で意味を持つ。
 *   飼い主側の判定4本すべてに `owners.active` を足して揃える。
 *
 *   4本に散っているのは、それぞれ別の入口を守っているため:
 *     is_owner_user          … owners / pets の SELECT ポリシー
 *     can_read_pet           … reports の SELECT ポリシー
 *     can_read_final_report  … report_assets の SELECT ポリシー
 *     storage_path_customer  … Storage オブジェクトの SELECT ポリシー
 *   1本でも漏らすと、そこだけ見え続ける。
 *
 * ── 9: 招待リンクを最初にクリックした Google アカウントに恒久的に紐付く ──
 *   `owner_users` に行を入れられるのは `claim_invitation` だけで、**外す手段が
 *   アプリのどこにも無かった**。誤送信・転送で第三者が先にクリックすると、
 *   その人が飼い主のカルテを永久に読める。復旧は `owners` 行ごと削除しかなく、
 *   それは犬とカルテと写真も道連れにする。
 *   スタッフが自店舗の紐付けを外せる RPC を足す。`owner_users` に直接 delete を
 *   与えないのは、他店舗の行に触れないことを RLS ではなく関数側で保証するため
 *   （既存の RPC 群と同じ形）。外した相手が誰だったかは監査ログに残す。
 *
 * 既存データへの影響: `owners.active` の既定は true なので、現に使われている
 * 飼い主の見え方は変わらない。
 */

create or replace function private.is_owner_user(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_users link
    join public.owners owner on owner.id = link.owner_id
    where link.owner_id = target_owner
      and link.user_id = (select auth.uid())
      and owner.active
  );
$$;

create or replace function private.can_read_pet(target_pet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets pet
    join public.owners owner on owner.id = pet.owner_id
    join public.owner_users link on link.owner_id = pet.owner_id
    where pet.id = target_pet
      and pet.active
      and owner.active
      and link.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_read_final_report(target_report uuid)
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
    join public.owners owner on owner.id = pet.owner_id
    join public.owner_users link on link.owner_id = pet.owner_id
    where report.id = target_report
      and report.status = 'final'
      and pet.active
      and owner.active
      and link.user_id = (select auth.uid())
  );
$$;

create or replace function private.storage_path_customer(object_name text)
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
    join public.owners owner on owner.id = pet.owner_id
    join public.owner_users link on link.owner_id = pet.owner_id
    where report.shop_id = private.try_uuid((storage.foldername(object_name))[1])
      and pet.id = private.try_uuid((storage.foldername(object_name))[2])
      and report.id = private.try_uuid((storage.foldername(object_name))[3])
      and report.status = 'final'
      and pet.active
      and owner.active
      and link.user_id = (select auth.uid())
  );
$$;

/*
 * revoke_owner_link(target_owner, target_user)
 *
 * 飼い主とアカウントの紐付けを外す。自店舗の飼い主に対してのみ、スタッフが呼べる。
 * 外れた相手はその瞬間から `/my` で何も見られなくなる（上の4本が全て link を要求する）。
 * 何度呼んでも壊れない（既に無ければ false を返すだけ）。
 */
create or replace function public.revoke_owner_link(target_owner uuid, target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_shop uuid;
  removed integer;
begin
  select owner.shop_id into owner_shop from public.owners owner where owner.id = target_owner;
  if owner_shop is null then return false; end if;
  if not private.is_shop_staff(owner_shop) then return false; end if;

  delete from public.owner_users link
  where link.owner_id = target_owner and link.user_id = target_user;
  get diagnostics removed = row_count;
  if removed = 0 then return false; end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (owner_shop, (select auth.uid()), 'owner_link_revoked', 'owner', target_owner,
          jsonb_build_object('revoked_user_id', target_user));
  return true;
end;
$$;

grant execute on function public.revoke_owner_link(uuid, uuid) to authenticated;

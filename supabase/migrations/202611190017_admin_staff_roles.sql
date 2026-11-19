/* 店舗側の権限を「管理者」と「スタッフ」に分ける（マスター指示 2026-11-19・plan.md `N-49`）。

   > 先に作ってから再度行う

   クライアントは権限が3つ（管理者・スタッフ・顧客）あると思っている。2026-09-06 に
   1つへ揃えた（`202609060012`）が、後から分け直すと「変えたせいで壊れた」と受け取られる
   ので、クライアントに試し直してもらう前に分ける。

   **スタッフにさせないこと（これだけ）**:
     1. 削除 — 顧客（全データ）・犬・カルテ。写真の実体（Storage）の削除も
     2. 店舗設定 — `public.shops` の更新（既定の来店間隔・使用オプション）
     3. スタッフ招待 — 種類 `staff` の招待を出す・取り消す
   それ以外（カルテを書く・直す・写真・顧客と犬の登録・犬の情報を直す・飼い主の招待）は
   これまでどおりスタッフもできる。

   **誰が管理者か**: スタッフ招待で入った人がスタッフ。それ以外（店を作った人）が管理者。
   だから列の既定は `admin` で、`claim_invitation` がスタッフ招待のときだけ `staff` を入れる。

   **既存の人**: スタッフ招待を使って入った記録（`invitations.claimed_by`）がある人を
   `staff`、無い人を `admin` にする。**本番に当てる前に、誰がどちらになるかを一覧で
   マスターに見せる**（`N-49` ④）。

   **守るのはデータベース**。画面で隠すのは補助で、ここが断るので裏から叩いても通らない。

   既存の migration は書き換えない（適用済みの歴史を直すと本番と手元が食い違う）。 */

begin;

/* ------------------------------------------------------------------
   1. 役割の列と、管理者かどうかの判定
   ------------------------------------------------------------------ */

alter table public.shop_memberships
  add column role text not null default 'admin'
  check (role in ('admin', 'staff'));

/* 既存の人の振り分け。スタッフ招待を使って入った人だけ `staff`。 */
update public.shop_memberships membership
set role = 'staff'
where exists (
  select 1 from public.invitations invitation
  where invitation.invitation_type = 'staff'
    and invitation.shop_id = membership.shop_id
    and invitation.claimed_by = membership.user_id
);

create or replace function private.is_shop_admin(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_memberships membership
    where membership.shop_id = target_shop
      and membership.user_id = (select auth.uid())
      and membership.active
      and membership.role = 'admin'
  );
$$;

revoke all on function private.is_shop_admin(uuid) from public, anon;
grant execute on function private.is_shop_admin(uuid) to authenticated;

/* 役割は画面とサーバーが読む（`/api/session`）。書き換えは誰にも許さない
   （`shop_memberships` の insert/update/delete は `202607160003` で revoke 済み）。 */

/* ------------------------------------------------------------------
   2. 削除 — 顧客・犬は「消す」だけ管理者に
   ------------------------------------------------------------------ */

drop policy if exists owners_staff_all on public.owners;
create policy owners_staff_select on public.owners
  for select to authenticated using (private.is_shop_staff(shop_id));
create policy owners_staff_insert on public.owners
  for insert to authenticated with check (private.is_shop_staff(shop_id));
create policy owners_staff_update on public.owners
  for update to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy owners_admin_delete on public.owners
  for delete to authenticated using (private.is_shop_admin(shop_id));

drop policy if exists pets_staff_all on public.pets;
create policy pets_staff_select on public.pets
  for select to authenticated using (private.is_shop_staff(shop_id));
create policy pets_staff_insert on public.pets
  for insert to authenticated with check (private.is_shop_staff(shop_id));
create policy pets_staff_update on public.pets
  for update to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy pets_admin_delete on public.pets
  for delete to authenticated using (private.is_shop_admin(shop_id));

/* **「使わない」にする抜け道も塞ぐ。** `active` はスタッフも更新できる列
   （`202608270009`）なので、`active = false` にすれば消したのと同じに見える。
   有効 → 無効 の切り替えだけを管理者に限る（画面からは使っていない）。 */
create or replace function private.guard_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.active and not new.active and not private.is_shop_admin(new.shop_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_deactivate() from public, anon;

create trigger owners_guard_deactivate
  before update of active on public.owners
  for each row execute function private.guard_deactivate();
create trigger pets_guard_deactivate
  before update of active on public.pets
  for each row execute function private.guard_deactivate();

/* カルテの削除（2段階）と、確定カルテを隠す `archive_report` は管理者だけ。
   判定の1語（`is_shop_staff` → `is_shop_admin`）以外は元の定義のまま。 */
create or replace function public.mark_report_deleting(target_report uuid)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  deleting_report public.reports%rowtype;
begin
  update public.reports report
  set status = 'deleting', updated_at = now()
  where report.id = target_report
    and report.status in ('draft', 'final', 'archived', 'deleting')
    and private.is_shop_admin(report.shop_id)
  returning report.* into deleting_report;
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (deleting_report.shop_id, actor, 'report.deleting', 'report', deleting_report.id);
  return deleting_report;
end;
$$;

create or replace function public.complete_report_deletion(target_report uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  deleting_report public.reports%rowtype;
  report_prefix text;
begin
  select report.* into deleting_report
  from public.reports report
  where report.id = target_report
    and report.status = 'deleting'
    and private.is_shop_admin(report.shop_id)
  for update;
  if not found or actor is null then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  report_prefix := deleting_report.shop_id::text || '/' || deleting_report.pet_id::text || '/'
    || deleting_report.id::text || '/';
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = 'report-assets' and object.name like report_prefix || '%'
  ) then return false; end if;

  delete from public.report_assets asset where asset.report_id = deleting_report.id;
  delete from public.reports report where report.id = deleting_report.id and report.status = 'deleting';
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (deleting_report.shop_id, actor, 'report.deleted', 'report', deleting_report.id);
  return true;
end;
$$;

create or replace function public.archive_report(target_report uuid)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  archived public.reports%rowtype;
begin
  update public.reports report
  set status = 'archived', updated_at = now()
  where report.id = target_report
    and report.status = 'final'
    and private.is_shop_admin(report.shop_id)
  returning report.* into archived;

  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (archived.shop_id, actor, 'report.archived', 'report', archived.id);
  return archived;
end;
$$;

/* 写真の実体の削除は、削除の流れ（カルテ・犬・顧客）でしか使っていない
   （写真の貼り替えは新しく足すだけで、古い実体を消さない・`202609230015`）。 */
/* 判定は `storage_path_staff` と同じ形の security definer 関数に閉じ込める。
   ポリシーから `private.try_uuid` を直に呼ぶと、ログインした人には実行権が無い
   （`202607160001` で revoke 済み）ので**管理者の削除まで断られる**（実測・2026-11-19）。 */
create or replace function private.storage_path_admin(object_name text)
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
      and private.is_shop_admin(report.shop_id)
  );
$$;

revoke all on function private.storage_path_admin(text) from public, anon;
grant execute on function private.storage_path_admin(text) to authenticated;

drop policy if exists report_assets_storage_staff_delete on storage.objects;
create policy report_assets_storage_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'report-assets' and private.storage_path_admin(name));

/* ------------------------------------------------------------------
   3. 店舗設定は管理者だけ
   ------------------------------------------------------------------ */

drop policy if exists shops_staff_update on public.shops;
create policy shops_admin_update on public.shops
  for update to authenticated
  using (private.is_shop_admin(id)) with check (private.is_shop_admin(id));

/* ------------------------------------------------------------------
   4. スタッフ招待は管理者だけ（飼い主の招待はスタッフもできる）
   ------------------------------------------------------------------ */

create or replace function public.create_invitation(
  target_shop uuid,
  target_type text,
  target_owner uuid default null
)
returns table (invitation_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  token text;
  created_invitation public.invitations%rowtype;
begin
  if actor is null or not private.is_shop_staff(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if target_type not in ('owner', 'staff') then
    raise exception using errcode = '22023', message = 'invalid invitation type';
  end if;
  /* **スタッフ招待は管理者だけ**（`N-49`）。 */
  if target_type = 'staff' and not private.is_shop_admin(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if target_type = 'owner' and not exists (
    select 1 from public.owners owner
    where owner.id = target_owner and owner.shop_id = target_shop and owner.active
  ) then
    raise exception using errcode = 'P0002', message = 'target unavailable';
  end if;

  /* 前のQRを使えなくする（`202609140014`・`#61`）。 */
  update public.invitations
  set revoked_at = now()
  where shop_id = target_shop
    and invitation_type = target_type
    and owner_id is not distinct from target_owner
    and claimed_at is null
    and revoked_at is null;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (
    shop_id, invitation_type, owner_id, token_hash, expires_at, created_by
  ) values (
    target_shop, target_type, target_owner,
    encode(extensions.digest(token, 'sha256'), 'hex'),
    now() + interval '24 hours', actor
  ) returning * into created_invitation;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (target_shop, actor, 'invitation.created', 'invitation', created_invitation.id);

  return query select created_invitation.id, token, created_invitation.expires_at;
end;
$$;

create or replace function public.revoke_invitation(target_invitation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  invitation public.invitations%rowtype;
begin
  select candidate.* into invitation
  from public.invitations candidate
  where candidate.id = target_invitation
  for update;
  if not found or actor is null or not private.is_shop_staff(invitation.shop_id) then
    return false;
  end if;
  /* スタッフ招待の取り消しも管理者だけ（`N-49`）。 */
  if invitation.invitation_type = 'staff' and not private.is_shop_admin(invitation.shop_id) then
    return false;
  end if;
  update public.invitations
  set revoked_at = coalesce(revoked_at, now())
  where id = invitation.id and claimed_at is null;
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (invitation.shop_id, actor, 'invitation.revoked', 'invitation', invitation.id);
  return true;
end;
$$;

/* スタッフ招待で入った人は `staff`。**既に店に居る人の役割は変えない**
   （管理者がスタッフ招待を開いても管理者のまま。降格させない）。 */
create or replace function public.claim_invitation(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  invitation public.invitations%rowtype;
begin
  if actor is null or raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  select candidate.* into invitation
  from public.invitations candidate
  where candidate.token_hash = encode(extensions.digest(lower(raw_token), 'sha256'), 'hex')
    and candidate.claimed_at is null
    and candidate.revoked_at is null
    and candidate.expires_at > now()
  for update skip locked;

  if not found then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  update public.invitations
  set claimed_at = now(), claimed_by = actor
  where id = invitation.id and claimed_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  if invitation.invitation_type = 'owner' then
    insert into public.owner_users (owner_id, user_id)
    values (invitation.owner_id, actor)
    on conflict (owner_id, user_id) do nothing;
  else
    insert into public.shop_memberships (shop_id, user_id, active, role)
    values (invitation.shop_id, actor, true, 'staff')
    on conflict (shop_id, user_id) do update set active = true;
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (invitation.shop_id, actor, 'invitation.claimed', 'invitation', invitation.id);

  return jsonb_build_object(
    'type', invitation.invitation_type,
    'shopId', invitation.shop_id,
    'ownerId', invitation.owner_id
  );
end;
$$;

/* 店のメンバー表への直接の書き込みは `202607160003` で revoke 済み。
   多層防御として残してある形（`202609060012`）も管理者に揃える。 */
drop policy if exists memberships_staff_insert on public.shop_memberships;
drop policy if exists memberships_staff_update on public.shop_memberships;
drop policy if exists memberships_staff_delete on public.shop_memberships;
create policy memberships_admin_insert on public.shop_memberships
  for insert to authenticated with check (private.is_shop_admin(shop_id));
create policy memberships_admin_update on public.shop_memberships
  for update to authenticated
  using (private.is_shop_admin(shop_id)) with check (private.is_shop_admin(shop_id));
create policy memberships_admin_delete on public.shop_memberships
  for delete to authenticated using (private.is_shop_admin(shop_id));

commit;

/* 権限を1つにする（マスター判断 2026-09-06・`D-20260906-68`）。

   > 管理者とスタッフは同一で良い
   > 使わないものを先に削除しろ

   これまで店舗側の権限は `admin` と `staff` の2種類あり、`private.is_shop_admin()` が
   `admin` だけを通していた。**画面の名前とも URL とも対応していない**まま
   12ファイル44か所に散っており、配線が合わない原因になっていた。

   権限は **お店の人 / 飼い主** の2つだけにする。店舗側の判定は
   `private.is_shop_staff()` の**1本**に揃え、`is_shop_admin()` と `role` 列、
   招待の `staff_role` 列は**削除する**（死んだ列を残さない）。

   **承知のうえの結果**（マスター承諾済み）: 新人スタッフでも飼い主・犬・カルテを
   完全に削除でき、最後の1人でも自分を消せる（`last_admin` ガードも無くなる）。

   既存の migration は書き換えない（適用済みの歴史を直すと本番と手元が食い違う）。 */

begin;

/* ------------------------------------------------------------------
   1. 店舗側の判定を1本にする
   ------------------------------------------------------------------ */

/* `role` 列を落とすので、参照している定義を先に置き換える。
   **中身は「その店の有効なメンバーか」だけ**になる。 */
create or replace function private.is_shop_staff(target_shop uuid)
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
  );
$$;

/* 「同じ店のメンバーどうしなら相手の氏名を読める」。
   以前は**読む側が admin のときだけ**だったが、権限が1つになったので
   「同じ店の有効なメンバーどうし」に揃える。 */
create or replace function private.can_read_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid())
    or exists (
      select 1
      from public.shop_memberships target_membership
      join public.shop_memberships actor_membership
        on actor_membership.shop_id = target_membership.shop_id
      where target_membership.user_id = target_user
        and actor_membership.user_id = (select auth.uid())
        and actor_membership.active
    );
$$;

/* ------------------------------------------------------------------
   2. `is_shop_admin()` を見ていた RLS を、`is_shop_staff()` に付け替える
   ------------------------------------------------------------------ */

drop policy if exists memberships_authorized_select on public.shop_memberships;
drop policy if exists memberships_admin_insert on public.shop_memberships;
drop policy if exists memberships_admin_update on public.shop_memberships;
drop policy if exists memberships_admin_delete on public.shop_memberships;

create policy memberships_authorized_select on public.shop_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_shop_staff(shop_id));
/* insert/update/delete の権限自体は `202607160003` で authenticated から revoke してある
   （書き換えは `update_staff_membership()` 経由のみ）。多層防御として形は残す。 */
create policy memberships_staff_insert on public.shop_memberships
  for insert to authenticated with check (private.is_shop_staff(shop_id));
create policy memberships_staff_update on public.shop_memberships
  for update to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy memberships_staff_delete on public.shop_memberships
  for delete to authenticated using (private.is_shop_staff(shop_id));

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_staff_select on public.audit_logs
  for select to authenticated using (private.is_shop_staff(shop_id));

/* 「次回のおすすめご来店時期」の既定日数（`202608290010`）。設定画面が書く先。 */
drop policy if exists shops_admin_update on public.shops;
create policy shops_staff_update on public.shops
  for update to authenticated
  using (private.is_shop_staff(id)) with check (private.is_shop_staff(id));

/* ------------------------------------------------------------------
   3. 招待 — `staff_role` を受け取らない・admin かどうかを見ない
   ------------------------------------------------------------------ */

drop function if exists public.create_invitation(uuid, text, uuid, text);

create function public.create_invitation(
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
  if target_type = 'owner' and not exists (
    select 1 from public.owners owner
    where owner.id = target_owner and owner.shop_id = target_shop and owner.active
  ) then
    raise exception using errcode = 'P0002', message = 'target unavailable';
  end if;

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
    /* 役割は無い。お店の人として有効にするだけ。 */
    insert into public.shop_memberships (shop_id, user_id, active)
    values (invitation.shop_id, actor, true)
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
  update public.invitations
  set revoked_at = coalesce(revoked_at, now())
  where id = invitation.id and claimed_at is null;
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (invitation.shop_id, actor, 'invitation.revoked', 'invitation', invitation.id);
  return true;
end;
$$;

/* ------------------------------------------------------------------
   4. スタッフ管理 — 役割を渡さない・「最後の管理者」ガードも無くなる
   ------------------------------------------------------------------ */

drop function if exists public.update_staff_membership(uuid, uuid, text, boolean);

create function public.update_staff_membership(
  target_shop uuid,
  target_user uuid,
  new_active boolean default null
)
returns public.shop_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_membership public.shop_memberships%rowtype;
  updated_membership public.shop_memberships%rowtype;
  effective_active boolean;
begin
  if actor is null or not private.is_shop_staff(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.* into current_membership
  from public.shop_memberships membership
  where membership.shop_id = target_shop and membership.user_id = target_user
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'membership unavailable';
  end if;

  effective_active := coalesce(new_active, current_membership.active);

  update public.shop_memberships membership
  set active = effective_active
  where membership.shop_id = target_shop and membership.user_id = target_user
  returning membership.* into updated_membership;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    target_shop, actor, 'staff.updated', 'profile', target_user,
    jsonb_build_object('active', effective_active)
  );
  return updated_membership;
end;
$$;

/* ------------------------------------------------------------------
   5. 取り込み台帳の RPC（`202607160005`）
   ------------------------------------------------------------------ */

create or replace function public.read_import_ledger(
  target_shop uuid,
  target_entity_type text,
  target_legacy_key text
)
returns public.import_ledger
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found public.import_ledger%rowtype;
begin
  if not private.is_shop_staff(target_shop)
    or target_entity_type not in ('owners', 'pets', 'reports', 'assets')
    or char_length(target_legacy_key) not between 1 and 500 then
    raise exception using errcode = '42501', message = 'migration unavailable';
  end if;
  select ledger.* into found
  from public.import_ledger ledger
  where ledger.source_system = 'cloudflare-kv:' || target_shop::text
    and ledger.entity_type = target_entity_type
    and ledger.legacy_key = target_legacy_key;
  return found;
end;
$$;

create or replace function public.write_import_ledger(
  target_shop uuid,
  target_entity_type text,
  target_legacy_key text,
  target_row uuid,
  target_source_hash text
)
returns public.import_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  written public.import_ledger%rowtype;
begin
  if not private.is_shop_staff(target_shop)
    or target_entity_type not in ('owners', 'pets', 'reports', 'assets')
    or char_length(target_legacy_key) not between 1 and 500
    or target_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'migration unavailable';
  end if;
  insert into public.import_ledger (
    source_system, entity_type, legacy_key, target_id, source_hash, imported_at
  ) values (
    'cloudflare-kv:' || target_shop::text,
    target_entity_type,
    target_legacy_key,
    target_row,
    target_source_hash,
    now()
  )
  on conflict (source_system, entity_type, legacy_key) do update set
    target_id = excluded.target_id,
    source_hash = excluded.source_hash,
    imported_at = excluded.imported_at
  returning * into written;
  return written;
end;
$$;

create or replace function public.count_import_ledger(target_shop uuid)
returns table(entity_type text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select ledger.entity_type, count(*)::bigint
  from public.import_ledger ledger
  where private.is_shop_staff(target_shop)
    and ledger.source_system = 'cloudflare-kv:' || target_shop::text
  group by ledger.entity_type;
$$;

/* ------------------------------------------------------------------
   6. 使わなくなったものを削除する
   ------------------------------------------------------------------ */

drop function if exists private.is_shop_admin(uuid);

alter table public.shop_memberships drop column role;
/* `invitations` の `staff_role` は `invitations_type_fields_check` から参照されている。
   列を落とすと制約も一緒に落ちるので、**招待の種類だけを見る形で作り直す**
   ——作り直さないと、飼い主の招待に犬の紐付けが無い行を作れてしまう。 */
alter table public.invitations drop column staff_role;
alter table public.invitations drop constraint if exists invitations_type_fields_check;
alter table public.invitations
  add constraint invitations_type_fields_check check (
    (invitation_type = 'owner' and owner_id is not null)
    or (invitation_type = 'staff' and owner_id is null)
  );

/* 列を絞った grant は、落とした列を含んでいたので張り直す。 */
grant select (
  id, shop_id, invitation_type, owner_id, expires_at,
  claimed_at, claimed_by, revoked_at, created_by, created_at
) on public.invitations to authenticated;

revoke all on function public.create_invitation(uuid, text, uuid) from public, anon;
grant execute on function public.create_invitation(uuid, text, uuid) to authenticated;
revoke all on function public.update_staff_membership(uuid, uuid, boolean) from public, anon;
grant execute on function public.update_staff_membership(uuid, uuid, boolean) to authenticated;

commit;

/* 辞めたお店の人の利用を止める・再開する（放置リスト `#76`・レビュー M1・CVSS 6.5）。

   スタッフ管理の画面と `update_staff_membership` は `202609060012`／`202609060013` で
   消した。そのとき権限は1つ（お店の人）だけだったので、**止める道が1本も無いまま**
   になっていた——辞めた人の Google アカウントが、店の全データを読み書きし続けられる。

   `202611190017` で「管理者」と「スタッフ」に分け直したので、**管理者だけが止められる**
   形で戻す。消すのではなく `active` を倒すだけ（あとから再開できる・行も監査記録も残る）。

   **守るのはデータベース**（`N-49`）。画面で隠すのは補助で、ここが断る。
     - 管理者でなければ断る（42501）
     - 自分を止めさせない（22023）——押し間違いで店の管理者が誰も入れなくなるのを防ぐ
     - 店の最後の有効な管理者を止めさせない（22023）
     - その店のメンバーでなければ P0002

   既存の migration は書き換えない（適用済みの歴史を直すと本番と手元が食い違う）。 */

begin;

/* ------------------------------------------------------------------
   1. 止める・再開する
   ------------------------------------------------------------------ */

create or replace function public.set_member_active(
  target_shop uuid,
  target_user uuid,
  new_active boolean
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
begin
  if actor is null or new_active is null or not private.is_shop_admin(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if target_user = actor then
    raise exception using errcode = '22023', message = 'cannot change own membership';
  end if;

  /* **店の管理者の行をまとめて押さえる。** 管理者2人が同時に互いを止めると、
     どちらの判定も「もう1人いる」で通り、**有効な管理者が0人**になる。
     押さえたあとの文は新しい見え方で読むので、待たされた側は下の再判定で断られる。 */
  perform 1
  from public.shop_memberships membership
  where membership.shop_id = target_shop and membership.role = 'admin'
  for update;
  if not private.is_shop_admin(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.* into current_membership
  from public.shop_memberships membership
  where membership.shop_id = target_shop and membership.user_id = target_user
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'membership unavailable';
  end if;

  /* 自分は止められない（上）ので、ふつうは呼んだ管理者が残る。それでも判定は
     「呼んだ人」に頼らず数で見る——判定の前提が後で変わっても0人にしない。 */
  if not new_active
    and current_membership.active
    and current_membership.role = 'admin'
    and not exists (
      select 1 from public.shop_memberships other
      where other.shop_id = target_shop
        and other.user_id <> target_user
        and other.role = 'admin'
        and other.active
    )
  then
    raise exception using errcode = '22023', message = 'last active admin';
  end if;

  update public.shop_memberships membership
  set active = new_active
  where membership.shop_id = target_shop and membership.user_id = target_user
  returning membership.* into updated_membership;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    target_shop, actor, 'staff.updated', 'profile', target_user,
    jsonb_build_object('active', new_active)
  );
  return updated_membership;
end;
$$;

revoke all on function public.set_member_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_member_active(uuid, uuid, boolean) to authenticated;

/* ------------------------------------------------------------------
   2. 誰を止めるかを選ぶための一覧
   ------------------------------------------------------------------ */

/* **メールアドレスも返す。** 表示名（`profiles.display_name`）は Google の氏名が
   入らないことがあり、空だと「誰の行か」が分からず**別の人を止めかねない**。
   メールは `auth.users` にしか無く、ログインした人には読めないので、ここで
   security definer で取る。返すのは**その店の有効な管理者にだけ**（下の判定）で、
   相手はもともと自分が招待した同じ店の人——店の外の人のアドレスは出ない。 */
create or replace function public.list_shop_members(target_shop uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_shop_admin(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select membership.user_id, profile.display_name, account.email::text,
      membership.role, membership.active, membership.created_at
    from public.shop_memberships membership
    left join public.profiles profile on profile.user_id = membership.user_id
    left join auth.users account on account.id = membership.user_id
    where membership.shop_id = target_shop
    order by membership.created_at asc, membership.user_id asc;
end;
$$;

revoke all on function public.list_shop_members(uuid) from public, anon;
grant execute on function public.list_shop_members(uuid) to authenticated;

/* ------------------------------------------------------------------
   止めた人が、まだ使われていないスタッフ招待で黙って再開できないようにする
   （独立検証①・CVSS 3.1）。本体は `202611190017` の `claim_invitation` のまま、
   「止められている人なら断る」と「既に居る人の行は書き換えない」の2点だけを変えた。
   ------------------------------------------------------------------ */
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
    /* **止められた人は、招待から入り直しても再開しない**（独立検証①の指摘・2026-11-20）。
       再開は管理者の「⑥ スタッフ管理」（`set_member_active`）だけ。ここで断ると上の
       「使った」印もまとめて取り消される（同じ取引の中）ので、招待は使われないまま残る。 */
    if exists (
      select 1 from public.shop_memberships membership
      where membership.shop_id = invitation.shop_id and membership.user_id = actor and not membership.active
    ) then
      raise exception using errcode = 'P0002', message = 'invitation unavailable';
    end if;
    insert into public.shop_memberships (shop_id, user_id, active, role)
    values (invitation.shop_id, actor, true, 'staff')
    on conflict (shop_id, user_id) do nothing;
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

commit;

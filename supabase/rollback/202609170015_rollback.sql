/*
 * 202609170015_rollback.sql — 取り消し用。マイグレーションではない。
 *
 * `202609170015_session_liveness.sql` を当てたあとログインできなくなったときに、
 * **これを SQL Editor に貼れば当てる前の状態に戻る**（`private.live_uid()` を
 * 通す前の定義とポリシーに戻す。足した関数2本は残るが、誰も呼ばなくなる）。
 *
 * 置き場所が `supabase/migrations/` ではないのは、ここに置くと通常の適用で
 * 一緒に流れてしまい、塞いだ穴がその場で開くため。
 */


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

create or replace function public.consume_rate_limit(target_scope text, ip_hash text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  request_limit integer;
  window_seconds integer;
  user_count integer;
  ip_count integer;
  now_value timestamptz := clock_timestamp();
begin
  if actor is null then return false; end if;
  select limits.request_limit, limits.window_seconds
  into request_limit, window_seconds
  from (values
    ('invitation_claim', 10, 600),
    ('invitation_create', 20, 3600),
    ('report_write', 120, 600),
    ('asset_metadata', 300, 600),
    ('search', 120, 60)
  ) as limits(scope, request_limit, window_seconds)
  where limits.scope = target_scope;
  if not found then return false; end if;

  /* 別名を `window` にすると PostgreSQL の予約語（WINDOW 句）と衝突して
     `syntax error at or near "window"` で落ちる。別名は非予約語にする。 */
  insert into private.rate_limit_windows as limit_window (scope, key_hash, window_started, request_count)
  values (target_scope, encode(extensions.digest(actor::text, 'sha256'), 'hex'), now_value, 1)
  on conflict (scope, key_hash) do update set
    request_count = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then 1
      else limit_window.request_count + 1
    end,
    window_started = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then now_value
      else limit_window.window_started
    end
  returning request_count into user_count;

  if user_count > request_limit then return false; end if;
  if ip_hash is null or ip_hash !~ '^[0-9a-f]{64}$' then return true; end if;

  insert into private.rate_limit_windows as limit_window (scope, key_hash, window_started, request_count)
  values (target_scope || ':ip', ip_hash, now_value, 1)
  on conflict (scope, key_hash) do update set
    request_count = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then 1
      else limit_window.request_count + 1
    end,
    window_started = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then now_value
      else limit_window.window_started
    end
  returning request_count into ip_count;
  return ip_count <= request_limit * 2;
end;
$$;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists memberships_authorized_select on public.shop_memberships;
create policy memberships_authorized_select on public.shop_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_shop_staff(shop_id));

drop policy if exists owner_users_staff_select on public.owner_users;
create policy owner_users_staff_select on public.owner_users
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.owners owner
      where owner.id = owner_id and private.is_shop_staff(owner.shop_id)
    )
  );

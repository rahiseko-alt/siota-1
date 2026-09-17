/*
 * 202609170015_session_liveness.sql
 *
 * ログアウトしたあとも、発行済みの通行証（JWT）が最大1時間通り続ける穴を塞ぐ
 * （安全確認 ASVS v5.0.0-7.4.1 / 経緯は `docs/decisions.md` の D-20260915-76）。
 *
 * ── 何が起きていたか ──
 *   `signOut()` は既定で全端末に効き、`auth.sessions` の行は消える。しかし
 *   **発行済みの通行証そのものは取り消せない**（Supabase 公式が明記。既定の有効期間
 *   1時間）。つまりログアウト直後の最大1時間、その通行証でデータを読めてしまう。
 *   端末の紛失、共用パソコンでの操作、席を外した隙、で意味を持つ。
 *
 *   退職・退会は別の守り（`shop_memberships.active` / `owners.active`）が効いている
 *   ので、残っていたのは**本人がログアウトした直後の1時間**だけである。
 *
 * ── どう塞ぐか ──
 *   Supabase 公式が案内している方法をそのまま使う。
 *   https://supabase.com/docs/guides/auth/sessions
 *   「通行証の中の `session_id` が `auth.sessions` に残っているかを見る。
 *     行が無ければログアウト済みという意味である」
 *
 *   `private.live_uid()` を1本足し、**身元を名乗る箇所すべてをこれ1本に通す**。
 *   ログイン状態の行が消えていれば `null` を返すので、判定はすべて偽に倒れる
 *   （**開く側に倒れない**）。散らばった場所に同じ条件を書き足すより、
 *   1本にまとめたほうが書き漏らしを起こしにくい。
 *
 * ── どこを通したか ──
 *   `(select auth.uid())` を直接読んでいた現行の定義は、次の8本と3つのポリシー。
 *   これ以外は、この8本のどれかを経由して判定している（例: `storage_path_staff`
 *   → `is_shop_staff`、`finalize_report` → `is_shop_staff`）。
 *   書き漏らしを繰り返さないよう、`scripts/guard/live-uid.mjs` が機械で見張る。
 *
 * ── 塞がらないもの（正直に書く）──
 *   **ログインし直しても前のログイン状態が終わらない**（ASVS v5.0.0-7.2.4）は
 *   これでは直らない。ログインのたびに別の行が増えるだけで、古い行は残るため。
 *   「1人につき1つだけ」は Supabase の上位の契約が要る（D-20260915-76 の 2）。
 *
 * ── 既存データへの影響 ──
 *   無い。いま開いている画面は、ログイン状態の行が残っているかぎりそのまま動く。
 *   **ただしこの SQL を当てた直後に、実際にログインして画面が出ることを必ず確かめる。**
 *   万一 `session_id` が通行証に入っていない構成だった場合は全員が締め出される。
 *   そのときは `supabase/rollback/202609170015_rollback.sql` を当てれば元に戻る（PR 本文に手順あり）。
 */

create or replace function private.session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions session
    where session.id = private.try_uuid((select auth.jwt()) ->> 'session_id')
  );
$$;

create or replace function private.live_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.session_is_live() then (select auth.uid()) end;
$$;

revoke all on function private.session_is_live() from public, anon;
revoke all on function private.live_uid() from public, anon;
grant execute on function private.session_is_live() to authenticated;
grant execute on function private.live_uid() to authenticated;

/* ------------------------------------------------------------------
   身元を名乗る箇所を `private.live_uid()` に通す（中身は現行のまま）
   ------------------------------------------------------------------ */

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
      and membership.user_id = (select private.live_uid())
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
      and link.user_id = (select private.live_uid())
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
      and link.user_id = (select private.live_uid())
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
      and link.user_id = (select private.live_uid())
  );
$$;

create or replace function private.can_read_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select private.live_uid())
    or exists (
      select 1
      from public.shop_memberships target_membership
      join public.shop_memberships actor_membership
        on actor_membership.shop_id = target_membership.shop_id
      where target_membership.user_id = target_user
        and actor_membership.user_id = (select private.live_uid())
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
      and link.user_id = (select private.live_uid())
  );
$$;

create or replace function public.claim_invitation(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select private.live_uid());
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
  actor uuid := (select private.live_uid());
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
/* ------------------------------------------------------------------
   ポリシーの中で直接 `auth.uid()` を読んでいた3つ
   ------------------------------------------------------------------ */

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = (select private.live_uid()))
  with check (user_id = (select private.live_uid()));

drop policy if exists memberships_authorized_select on public.shop_memberships;
create policy memberships_authorized_select on public.shop_memberships
  for select to authenticated
  using (user_id = (select private.live_uid()) or private.is_shop_staff(shop_id));

drop policy if exists owner_users_staff_select on public.owner_users;
create policy owner_users_staff_select on public.owner_users
  for select to authenticated using (
    user_id = (select private.live_uid())
    or exists (
      select 1 from public.owners owner
      where owner.id = owner_id and private.is_shop_staff(owner.shop_id)
    )
  );

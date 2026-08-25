begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_memberships (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  legacy_slug text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, shop_id),
  unique (shop_id, legacy_slug)
);

create table public.owner_users (
  owner_id uuid not null references public.owners(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id)
);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  legacy_slug text,
  template text not null check (char_length(template) between 1 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, shop_id),
  unique (shop_id, legacy_slug),
  constraint pets_owner_shop_fkey foreign key (owner_id, shop_id)
    references public.owners(id, shop_id) on delete cascade
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  pet_id uuid not null,
  report_date date not null,
  status text not null default 'draft' check (status in ('draft', 'final', 'archived', 'deleting')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, shop_id),
  constraint reports_pet_shop_fkey foreign key (pet_id, shop_id)
    references public.pets(id, shop_id) on delete cascade
);

create table public.report_assets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  report_id uuid not null,
  kind text not null check (char_length(kind) between 1 and 40),
  storage_path text not null unique check (storage_path !~ '(^|/)\.\.?(/|$)'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint report_assets_report_shop_fkey foreign key (report_id, shop_id)
    references public.reports(id, shop_id) on delete cascade
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  invitation_type text not null check (invitation_type in ('owner', 'staff')),
  owner_id uuid,
  staff_role text check (staff_role in ('admin', 'staff')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint invitations_owner_shop_fkey foreign key (owner_id, shop_id)
    references public.owners(id, shop_id) on delete cascade,
  constraint invitations_type_fields_check check (
    (invitation_type = 'owner' and owner_id is not null and staff_role is null)
    or
    (invitation_type = 'staff' and owner_id is null and staff_role is not null)
  ),
  constraint invitations_claim_fields_check check (
    (claimed_at is null and claimed_by is null)
    or
    (claimed_at is not null and claimed_by is not null)
  )
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.import_ledger (
  source_system text not null,
  entity_type text not null,
  legacy_key text not null,
  target_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz not null default now(),
  primary key (source_system, entity_type, legacy_key)
);

create table private.rate_limit_windows (
  scope text not null,
  key_hash text not null,
  window_started timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (scope, key_hash)
);

create index shop_memberships_user_shop_active_idx
  on public.shop_memberships (user_id, shop_id) where active;
create index owner_users_user_owner_idx
  on public.owner_users (user_id, owner_id);
create index owners_shop_created_idx
  on public.owners (shop_id, created_at desc);
create index pets_owner_created_active_idx
  on public.pets (owner_id, created_at desc) where active;
create index pets_shop_created_active_idx
  on public.pets (shop_id, created_at desc) where active;
create index reports_pet_date_id_idx
  on public.reports (pet_id, report_date desc, id desc);
create index reports_shop_status_date_idx
  on public.reports (shop_id, status, report_date desc);
create index report_assets_report_sort_idx
  on public.report_assets (report_id, sort_order);
create index invitations_shop_open_idx
  on public.invitations (shop_id, expires_at)
  where claimed_at is null and revoked_at is null;
create index audit_logs_shop_created_idx
  on public.audit_logs (shop_id, created_at desc);
create index invitations_claimed_by_idx on public.invitations (claimed_by) where claimed_by is not null;
create index invitations_created_by_idx on public.invitations (created_by);
create index reports_created_by_idx on public.reports (created_by);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id) where actor_user_id is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

create trigger auth_user_profile_created
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

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
      and membership.role in ('admin', 'staff')
  );
$$;

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
    where link.owner_id = target_owner
      and link.user_id = (select auth.uid())
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
    join public.owner_users link on link.owner_id = pet.owner_id
    where pet.id = target_pet
      and pet.active
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
    join public.owner_users link on link.owner_id = pet.owner_id
    where report.id = target_report
      and report.status = 'final'
      and pet.active
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
        and actor_membership.role = 'admin'
    );
$$;

create or replace function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.storage_path_staff(object_name text)
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
      and private.is_shop_staff(report.shop_id)
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
    join public.owner_users link on link.owner_id = pet.owner_id
    where report.shop_id = private.try_uuid((storage.foldername(object_name))[1])
      and pet.id = private.try_uuid((storage.foldername(object_name))[2])
      and report.id = private.try_uuid((storage.foldername(object_name))[3])
      and report.status = 'final'
      and pet.active
      and link.user_id = (select auth.uid())
  );
$$;

create or replace function public.create_invitation(
  target_shop uuid,
  target_type text,
  target_owner uuid default null,
  target_staff_role text default null
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
  if target_type = 'staff' and not private.is_shop_admin(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if target_type = 'owner' and not exists (
    select 1 from public.owners owner
    where owner.id = target_owner and owner.shop_id = target_shop and owner.active
  ) then
    raise exception using errcode = 'P0002', message = 'target unavailable';
  end if;
  if target_type not in ('owner', 'staff') then
    raise exception using errcode = '22023', message = 'invalid invitation type';
  end if;
  if target_type = 'staff' and target_staff_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'invalid staff role';
  end if;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (
    shop_id, invitation_type, owner_id, staff_role, token_hash,
    expires_at, created_by
  ) values (
    target_shop, target_type, target_owner, target_staff_role,
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
  if actor is null or raw_token is null or char_length(raw_token) < 32 then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  select candidate.* into invitation
  from public.invitations candidate
  where candidate.token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
    and candidate.claimed_at is null
    and candidate.revoked_at is null
    and candidate.expires_at > now()
  for update skip locked;

  if not found then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  update public.invitations
  set claimed_at = now(), claimed_by = actor
  where id = invitation.id;

  if invitation.invitation_type = 'owner' then
    insert into public.owner_users (owner_id, user_id)
    values (invitation.owner_id, actor)
    on conflict (owner_id, user_id) do nothing;
  else
    insert into public.shop_memberships (shop_id, user_id, role, active)
    values (invitation.shop_id, actor, invitation.staff_role, true)
    on conflict (shop_id, user_id) do update
      set role = excluded.role, active = true;
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

create or replace function public.finalize_report(target_report uuid)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  finalized public.reports%rowtype;
begin
  update public.reports report
  set status = 'final', updated_at = now()
  where report.id = target_report
    and report.status = 'draft'
    and private.is_shop_staff(report.shop_id)
  returning report.* into finalized;
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (finalized.shop_id, actor, 'report.finalized', 'report', finalized.id);
  return finalized;
end;
$$;

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
    and private.is_shop_staff(report.shop_id)
  returning report.* into deleting_report;
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (deleting_report.shop_id, actor, 'report.deleting', 'report', deleting_report.id);
  return deleting_report;
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
    ('asset_metadata', 60, 600),
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

alter table public.shops enable row level security;
alter table public.shops force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.shop_memberships enable row level security;
alter table public.shop_memberships force row level security;
alter table public.owners enable row level security;
alter table public.owners force row level security;
alter table public.owner_users enable row level security;
alter table public.owner_users force row level security;
alter table public.pets enable row level security;
alter table public.pets force row level security;
alter table public.reports enable row level security;
alter table public.reports force row level security;
alter table public.report_assets enable row level security;
alter table public.report_assets force row level security;
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
alter table public.import_ledger enable row level security;
alter table public.import_ledger force row level security;

create policy shops_staff_select on public.shops
  for select to authenticated using (private.is_shop_staff(id));

create policy profiles_authorized_select on public.profiles
  for select to authenticated using (private.can_read_profile(user_id));
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy memberships_authorized_select on public.shop_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_shop_admin(shop_id));
create policy memberships_admin_insert on public.shop_memberships
  for insert to authenticated with check (private.is_shop_admin(shop_id));
create policy memberships_admin_update on public.shop_memberships
  for update to authenticated
  using (private.is_shop_admin(shop_id)) with check (private.is_shop_admin(shop_id));
create policy memberships_admin_delete on public.shop_memberships
  for delete to authenticated using (private.is_shop_admin(shop_id));

create policy owners_staff_all on public.owners
  for all to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy owners_customer_select on public.owners
  for select to authenticated using (active and private.is_owner_user(id));

create policy owner_users_staff_select on public.owner_users
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.owners owner
      where owner.id = owner_id and private.is_shop_staff(owner.shop_id)
    )
  );

create policy pets_staff_all on public.pets
  for all to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy pets_customer_select on public.pets
  for select to authenticated using (active and private.is_owner_user(owner_id));

create policy reports_staff_all on public.reports
  for all to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy reports_customer_select on public.reports
  for select to authenticated using (status = 'final' and private.can_read_pet(pet_id));

create policy report_assets_staff_all on public.report_assets
  for all to authenticated
  using (private.is_shop_staff(shop_id)) with check (private.is_shop_staff(shop_id));
create policy report_assets_customer_select on public.report_assets
  for select to authenticated using (private.can_read_final_report(report_id));

create policy invitations_staff_select on public.invitations
  for select to authenticated using (private.is_shop_staff(shop_id));

create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated using (private.is_shop_admin(shop_id));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.shops to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.shop_memberships to authenticated;
grant select, insert, update, delete on public.owners to authenticated;
grant select on public.owner_users to authenticated;
grant select, insert, update, delete on public.pets to authenticated;
grant select, insert, update, delete on public.reports to authenticated;
grant select, insert, update, delete on public.report_assets to authenticated;
grant select (
  id, shop_id, invitation_type, owner_id, staff_role, expires_at,
  claimed_at, claimed_by, revoked_at, created_by, created_at
) on public.invitations to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_shop_staff(uuid) from public, anon;
revoke all on function private.is_shop_admin(uuid) from public, anon;
revoke all on function private.is_owner_user(uuid) from public, anon;
revoke all on function private.can_read_pet(uuid) from public, anon;
revoke all on function private.can_read_final_report(uuid) from public, anon;
revoke all on function private.can_read_profile(uuid) from public, anon;
revoke all on function private.try_uuid(text) from public, anon;
revoke all on function private.storage_path_staff(text) from public, anon;
revoke all on function private.storage_path_customer(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_shop_staff(uuid) to authenticated;
grant execute on function private.is_shop_admin(uuid) to authenticated;
grant execute on function private.is_owner_user(uuid) to authenticated;
grant execute on function private.can_read_pet(uuid) to authenticated;
grant execute on function private.can_read_final_report(uuid) to authenticated;
grant execute on function private.can_read_profile(uuid) to authenticated;
grant execute on function private.storage_path_staff(text) to authenticated;
grant execute on function private.storage_path_customer(text) to authenticated;

revoke all on function public.create_invitation(uuid, text, uuid, text) from public, anon;
revoke all on function public.claim_invitation(text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.finalize_report(uuid) from public, anon;
revoke all on function public.mark_report_deleting(uuid) from public, anon;
revoke all on function public.consume_rate_limit(text, text) from public, anon;
grant execute on function public.create_invitation(uuid, text, uuid, text) to authenticated;
grant execute on function public.claim_invitation(text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.finalize_report(uuid) to authenticated;
grant execute on function public.mark_report_deleting(uuid) to authenticated;
grant execute on function public.consume_rate_limit(text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-assets', 'report-assets', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy report_assets_storage_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'report-assets' and private.storage_path_staff(name));
create policy report_assets_storage_customer_select on storage.objects
  for select to authenticated
  using (bucket_id = 'report-assets' and private.storage_path_customer(name));
create policy report_assets_storage_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-assets' and private.storage_path_staff(name));
create policy report_assets_storage_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'report-assets' and private.storage_path_staff(name))
  with check (bucket_id = 'report-assets' and private.storage_path_staff(name));
create policy report_assets_storage_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'report-assets' and private.storage_path_staff(name));

commit;

begin;

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

create or replace function public.update_staff_membership(
  target_shop uuid,
  target_user uuid,
  new_role text default null,
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
  effective_role text;
  effective_active boolean;
  active_admins integer;
begin
  if actor is null or not private.is_shop_admin(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.* into current_membership
  from public.shop_memberships membership
  where membership.shop_id = target_shop and membership.user_id = target_user
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'membership unavailable';
  end if;

  effective_role := coalesce(new_role, current_membership.role);
  effective_active := coalesce(new_active, current_membership.active);
  if effective_role not in ('admin', 'staff') then
    raise exception using errcode = '22023', message = 'invalid role';
  end if;

  if current_membership.role = 'admin' and current_membership.active
    and (effective_role <> 'admin' or not effective_active) then
    select count(*)::integer into active_admins
    from public.shop_memberships membership
    where membership.shop_id = target_shop
      and membership.role = 'admin'
      and membership.active;
    if active_admins <= 1 then return null; end if;
  end if;

  update public.shop_memberships membership
  set role = effective_role, active = effective_active
  where membership.shop_id = target_shop and membership.user_id = target_user
  returning membership.* into updated_membership;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    target_shop, actor, 'staff.updated', 'profile', target_user,
    jsonb_build_object('role', effective_role, 'active', effective_active)
  );
  return updated_membership;
end;
$$;

revoke insert, update, delete on public.shop_memberships from authenticated;
revoke all on function public.update_staff_membership(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.update_staff_membership(uuid, uuid, text, boolean) to authenticated;

commit;

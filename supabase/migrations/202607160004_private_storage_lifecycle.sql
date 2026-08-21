begin;

create or replace function private.storage_path_staff_upload(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports report
    where report.shop_id = private.try_uuid((storage.foldername(object_name))[1])
      and report.pet_id = private.try_uuid((storage.foldername(object_name))[2])
      and report.id = private.try_uuid((storage.foldername(object_name))[3])
      and report.status = 'draft'
      and private.is_shop_staff(report.shop_id)
  );
$$;

create or replace function public.register_report_asset(
  target_report uuid,
  target_asset uuid,
  target_kind text,
  target_mime text,
  target_size bigint,
  target_sort integer
)
returns public.report_assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  draft public.reports%rowtype;
  extension text;
  asset_path text;
  registered public.report_assets%rowtype;
begin
  select report.* into draft
  from public.reports report
  where report.id = target_report
    and report.status = 'draft'
    and private.is_shop_staff(report.shop_id)
  for update;
  if not found or actor is null then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  extension := case target_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if extension is null or target_size <= 0 or target_size > 10485760
    or target_sort < 0 or char_length(target_kind) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'invalid asset';
  end if;

  asset_path := draft.shop_id::text || '/' || draft.pet_id::text || '/' || draft.id::text || '/'
    || target_asset::text || '.' || extension;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'report-assets'
      and object.name = asset_path
      and object.metadata ->> 'mimetype' = target_mime
      and object.metadata ->> 'size' = target_size::text
  ) then
    raise exception using errcode = 'P0002', message = 'asset unavailable';
  end if;

  insert into public.report_assets as existing (
    id, shop_id, report_id, kind, storage_path, mime_type, byte_size, sort_order
  ) values (
    target_asset, draft.shop_id, draft.id, target_kind, asset_path,
    target_mime, target_size, target_sort
  )
  on conflict (id) do update set
    kind = excluded.kind,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    sort_order = excluded.sort_order
  where existing.report_id = target_report
    and existing.storage_path = asset_path
  returning * into registered;
  if not found then
    raise exception using errcode = 'P0002', message = 'asset unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (draft.shop_id, actor, 'asset.registered', 'report_asset', registered.id);
  return registered;
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
  draft public.reports%rowtype;
  finalized public.reports%rowtype;
  report_prefix text;
begin
  select report.* into draft
  from public.reports report
  where report.id = target_report
    and report.status = 'draft'
    and private.is_shop_staff(report.shop_id)
  for update;
  if not found or actor is null then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  report_prefix := draft.shop_id::text || '/' || draft.pet_id::text || '/' || draft.id::text || '/';
  if draft.data::text ~* 'data:image/' then return null; end if;
  if exists (
    select 1
    from regexp_matches(
      draft.data::text,
      'asset://([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      'gi'
    ) as found(marker)
    where not exists (
      select 1 from public.report_assets asset
      where asset.report_id = draft.id and asset.id = ((found.marker)[1])::uuid
    )
  ) then return null; end if;
  if exists (
    select 1
    from public.report_assets asset
    left join storage.objects object
      on object.bucket_id = 'report-assets' and object.name = asset.storage_path
    where asset.report_id = draft.id and object.id is null
  ) then return null; end if;
  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'report-assets'
      and object.name like report_prefix || '%'
      and not exists (
        select 1 from public.report_assets asset
        where asset.report_id = draft.id and asset.storage_path = object.name
      )
  ) then return null; end if;

  update public.reports report
  set status = 'final', updated_at = now()
  where report.id = draft.id and report.status = 'draft'
  returning report.* into finalized;
  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (finalized.shop_id, actor, 'report.finalized', 'report', finalized.id);
  return finalized;
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
    and private.is_shop_staff(report.shop_id)
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

revoke insert, update, delete on public.report_assets from authenticated;
revoke all on function private.storage_path_staff_upload(text) from public, anon;
grant execute on function private.storage_path_staff_upload(text) to authenticated;
revoke all on function public.register_report_asset(uuid, uuid, text, text, bigint, integer) from public, anon;
revoke all on function public.complete_report_deletion(uuid) from public, anon;
grant execute on function public.register_report_asset(uuid, uuid, text, text, bigint, integer) to authenticated;
grant execute on function public.complete_report_deletion(uuid) to authenticated;

drop policy if exists report_assets_storage_staff_insert on storage.objects;
drop policy if exists report_assets_storage_staff_update on storage.objects;
create policy report_assets_storage_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-assets' and private.storage_path_staff_upload(name));

commit;

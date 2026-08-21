begin;

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
  if not private.is_shop_admin(target_shop)
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
  if not private.is_shop_admin(target_shop)
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
  where private.is_shop_admin(target_shop)
    and ledger.source_system = 'cloudflare-kv:' || target_shop::text
  group by ledger.entity_type;
$$;

revoke all on function public.read_import_ledger(uuid, text, text) from public, anon;
revoke all on function public.write_import_ledger(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.count_import_ledger(uuid) from public, anon;
grant execute on function public.read_import_ledger(uuid, text, text) to authenticated;
grant execute on function public.write_import_ledger(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.count_import_ledger(uuid) to authenticated;

commit;

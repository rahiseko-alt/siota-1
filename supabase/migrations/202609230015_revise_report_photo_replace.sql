-- 確定済みカルテの「修正」で、写真を足す・貼り替えられるようにする（マスター指示 2026-09-23）
--
-- なぜ要るか:
--   「貼る画像を間違えてその修正をしたい時に困る」（マスター報告）。いまの守り
--   （`private.storage_path_staff_upload` / `register_report_asset`）は
--   `report.status = 'draft'` の行にしか新規アップロードを許しておらず、
--   確定済み（`final`）カルテへ新しい画像を足す・貼り替える手段が無かった
--   （放置リスト `#60`・`F-20260923-87`）。
--
-- 何を緩めたか（これだけ）:
--   1. `private.storage_path_staff_upload`: `status = 'draft'` → `status in ('draft', 'final')`
--   2. `register_report_asset`: 同上
--   `archived` `deleting` の行には従来どおり触れない。
--
-- 緩めた分の歯止め（`revise_report` 側に追加）:
--   `revise_report` はいままで `data` を無条件で差し替えていた。写真の参照が
--   増える以上、`finalize_report` と同じ3つの整合性チェック（生の `data:image/`
--   を拒む・`asset://` が指す先が実在するかを見る・登録されていない孤児オブジェクトが
--   無いかを見る）をここにも足す。**チェックに落ちたら黙って何もしない**
--   （`finalize_report` と同じく `return null`）。
--
-- やらなかったこと（意図的）:
--   - 「直しで何が置き換わったか」の詳細ログ（旧アセットIDなど）は足していない。
--     `audit_logs` には従来どおり `report.revised`（誰が・いつ・どのカルテを直したか）
--     が残る。中身の差分までは今回のスコープ外——まずは「直せない」を解消するのが
--     マスターの要求そのもの（`docs/decisions.md` D-20260923-81）。
--   - 直しで写真を外したとき、外れた `report_assets` 行・Storageの実体は消さない。
--     これは下書きの段階でも同じ既存の仕様（未参照でも自動では消えない）で、
--     今回の変更で新しく生まれる問題ではない。

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
      and report.status in ('draft', 'final')
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
  target public.reports%rowtype;
  extension text;
  asset_path text;
  registered public.report_assets%rowtype;
begin
  select report.* into target
  from public.reports report
  where report.id = target_report
    and report.status in ('draft', 'final')
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

  asset_path := target.shop_id::text || '/' || target.pet_id::text || '/' || target.id::text || '/'
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
    target_asset, target.shop_id, target.id, target_kind, asset_path,
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
  values (target.shop_id, actor, 'asset.registered', 'report_asset', registered.id);
  return registered;
end;
$$;

create or replace function public.revise_report(target_report uuid, new_data jsonb)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.reports%rowtype;
  revised public.reports%rowtype;
  report_prefix text;
begin
  if new_data is null then
    raise exception using errcode = '22023', message = 'new_data required';
  end if;

  select report.* into target
  from public.reports report
  where report.id = target_report
    and report.status = 'final'
    and private.is_shop_staff(report.shop_id)
  for update;

  /* 見つからない理由は3つ（存在しない／final でない／その店舗のスタッフでない）。
     どれかを言い分けると、他店舗のカルテの存在を教えてしまう。まとめて弾く。 */
  if not found or actor is null then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  /* ここから3つは `finalize_report` と同じ整合性チェック。写真の貼り替えを
     許した以上、直しでも「参照した実体が本当にあるか」を見ないと、
     壊れた参照のまま確定済みデータを上書きできてしまう。 */
  report_prefix := target.shop_id::text || '/' || target.pet_id::text || '/' || target.id::text || '/';
  if new_data::text ~* 'data:image/' then return null; end if;
  if exists (
    select 1
    from regexp_matches(
      new_data::text,
      'asset://([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      'gi'
    ) as found(marker)
    where not exists (
      select 1 from public.report_assets asset
      where asset.report_id = target.id and asset.id = ((found.marker)[1])::uuid
    )
  ) then return null; end if;
  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'report-assets'
      and object.name like report_prefix || '%'
      and not exists (
        select 1 from public.report_assets asset
        where asset.report_id = target.id and asset.storage_path = object.name
      )
  ) then return null; end if;

  update public.reports report
  set data = new_data, updated_at = now()
  where report.id = target.id and report.status = 'final'
  returning report.* into revised;
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (revised.shop_id, actor, 'report.revised', 'report', revised.id);
  return revised;
end;
$$;

commit;

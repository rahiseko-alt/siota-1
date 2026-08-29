-- 次回のおすすめご来店時期（マスター指示・2026-08-29・D-20260829-58）。
-- デフォルトは来店日+30日。店舗ごとのデフォルト自体も、犬ごとの個別上書きも
-- 編集できるようにする。

alter table public.shops
  add column default_revisit_days integer not null default 30
  check (default_revisit_days > 0 and default_revisit_days <= 3650);

alter table public.pets
  add column revisit_days_override integer
  check (revisit_days_override is null or (revisit_days_override > 0 and revisit_days_override <= 3650));

-- デフォルトの編集は店舗の管理者だけ（`shop_memberships` の admin 系ポリシーと同じ形）。
-- 読み取りは既存の `shops_staff_select` がそのまま担う（列を絞っていない）。
create policy shops_admin_update on public.shops
  for update to authenticated
  using (private.is_shop_admin(id)) with check (private.is_shop_admin(id));

/* 列を絞る（`202608270009` と同じ多層防御）。アプリが書くのはこの1列だけ
   （`api-schemas.js` の `updateShopSchema`）。 */
grant update (default_revisit_days) on public.shops to authenticated;

/* `pets` の UPDATE は `202608270009` で列を絞ってある（`name, template, active`）。
   新しい列も同じ理由で明示的に足す——足し忘れると RLS は通っても
   `permission denied for table pets` になる（実測）。 */
grant update (revisit_days_override) on public.pets to authenticated;

-- ⑥飼い主画面は「次回のおすすめご来店時期」の算出に店舗の既定日数（default_revisit_days）
-- を読む必要があるが、`shops_staff_select` はスタッフ限定。`pets_customer_select` と同じ形
-- （`private.is_owner_user`）で、自分の犬が居る店舗に限って読めるようにする（列は絞らない。
-- 店名・スラッグは自分がかかっている店の話なので隠す理由が無い）。
create policy shops_customer_select on public.shops
  for select to authenticated using (
    exists (
      select 1 from public.pets p
      where p.shop_id = shops.id and p.active and private.is_owner_user(p.owner_id)
    )
  );

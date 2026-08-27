-- rls.sql — 誰に何が見えるか／書けるかを、実際の PostgreSQL で確かめる
--
-- **この検査は、2026-08-27 まで一度も実行されていなかった。**
-- pgTAP（`extensions.is` 等）で書かれていたが、走らせる仕組みがどこにも無く、
-- pgTAP 自体も入っていなかった。**在るだけで動かない検査**は、無いのと同じである
-- （`docs/watch.md` が計画に載っているのに存在しなかったのと同じ型）。
--
-- 書き直しの方針:
--   1. **pgTAP を使わない。** 素の SQL で比べ、違ったら例外で止める。
--      どの PostgreSQL でも走る（`npm run verify:migrations` が Docker 無しで回せる）。
--   2. **自分で土台を作る。** `seed.sql` に依存しない——あちらは `walk` が撮る絵の
--      土台でもあり、検査のために足すと絵の意味が変わる（`docs/watch.md` W-2）。
--   3. **最後に必ず巻き戻す。** 検査用の行を残さない。
--
--   npm run verify:migrations が最後に流す

begin;

/* 比べる道具。**違ったら止める**——「notice を出して続ける」は緑を汚す。 */
create or replace function pg_temp.eq(actual integer, expected integer, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'RLS 検査で不一致: % — 期待 % / 実際 %', label, expected, actual;
  end if;
end;
$$;

/* 「権限で弾かれること」を見る。弾かれなければ止める。 */
create or replace function pg_temp.denied(statement text, label text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'RLS 検査: % — 弾かれるはずの操作が通ってしまった', label;
exception
  when insufficient_privilege then return;
end;
$$;

/* ── 土台。2店舗・スタッフ2人・飼い主2人・犬2頭・カルテ2枚 ── */
insert into auth.users (id, email) values
  ('aa000000-0000-0000-0000-000000000001', 'staff-a@rls.test'),
  ('aa000000-0000-0000-0000-000000000002', 'staff-b@rls.test'),
  ('aa000000-0000-0000-0000-00000000000a', 'owner-a@rls.test'),
  ('aa000000-0000-0000-0000-00000000000b', 'owner-b@rls.test')
on conflict (id) do nothing;

insert into public.shops (id, name, slug) values
  ('bb000000-0000-0000-0000-000000000001', 'RLS Shop A', 'rls-shop-a'),
  ('bb000000-0000-0000-0000-000000000002', 'RLS Shop B', 'rls-shop-b');

insert into public.shop_memberships (shop_id, user_id, role) values
  ('bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'admin'),
  ('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000002', 'admin');

insert into public.owners (id, shop_id, name) values
  ('cc000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'RLS Owner A'),
  ('cc000000-0000-0000-0000-00000000000b', 'bb000000-0000-0000-0000-000000000002', 'RLS Owner B');

insert into public.owner_users (owner_id, user_id) values
  ('cc000000-0000-0000-0000-00000000000a', 'aa000000-0000-0000-0000-00000000000a'),
  ('cc000000-0000-0000-0000-00000000000b', 'aa000000-0000-0000-0000-00000000000b');

insert into public.pets (id, shop_id, owner_id, name, template) values
  ('dd000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-00000000000a', 'RLS Pet A', 'ponchi'),
  ('dd000000-0000-0000-0000-00000000000b', 'bb000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-00000000000b', 'RLS Pet B', 'ponchi');

insert into public.reports (id, shop_id, pet_id, report_date, status, data, created_by) values
  ('ee000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a', '2026-08-01', 'final', '{"memo":"A"}', 'aa000000-0000-0000-0000-000000000001'),
  ('ee000000-0000-0000-0000-0000000000a2', 'bb000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a', '2026-08-02', 'draft', '{"memo":"A draft"}', 'aa000000-0000-0000-0000-000000000001'),
  ('ee000000-0000-0000-0000-00000000000b', 'bb000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000000b', '2026-08-01', 'final', '{"memo":"B"}', 'aa000000-0000-0000-0000-000000000002');

set local role authenticated;

/* ── ① 店舗をまたげない（この製品で最も壊れてはいけない面）──
   **「0件見える」は、相手側に実在する行についてだけ意味を持つ。**
   だから id を名指しして「在るのに見えない」を見る。存在しない id を数えて
   0 でも、それは何も言っていない。 */
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000002', true);
select pg_temp.eq((select count(*)::integer from public.owners where id = 'cc000000-0000-0000-0000-00000000000a'), 0, '店舗Bのスタッフに、店舗Aの飼い主は見えない');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 0, '店舗Bのスタッフに、店舗Aの犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 0, '店舗Bのスタッフに、店舗Aのカルテは見えない');
select pg_temp.eq((select count(*)::integer from public.shop_memberships where shop_id = 'bb000000-0000-0000-0000-000000000001'), 0, '店舗Bのスタッフに、店舗Aの名簿は見えない');

/* **上の 0 が「全部見えないだけ」ではないことの裏取り。** 自分の店舗は見える。 */
select pg_temp.eq((select count(*)::integer from public.owners where id = 'cc000000-0000-0000-0000-00000000000b'), 1, '店舗Bのスタッフに、自分の店舗の飼い主は見える');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000b'), 1, '店舗Bのスタッフに、自分の店舗の犬は見える');

/* 読めないだけでは足りない。**書けもしないこと。** */
with attempted as (
  update public.pets set name = 'stolen' where id = 'dd000000-0000-0000-0000-00000000000a' returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 0, '店舗Bのスタッフは、店舗Aの犬の名前を書き換えられない');

with attempted as (
  delete from public.owners where id = 'cc000000-0000-0000-0000-00000000000a' returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 0, '店舗Bのスタッフは、店舗Aの飼い主を消せない');

/* ── ② 逆向き ── */
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-000000000001', true);
select pg_temp.eq((select count(*)::integer from public.owners where id = 'cc000000-0000-0000-0000-00000000000b'), 0, '店舗Aのスタッフに、店舗Bの飼い主は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000b'), 0, '店舗Aのスタッフに、店舗Bのカルテは見えない');

/* ── ③ 犬の付け替えができないこと（列を絞った grant・診断 #11）── */
select pg_temp.denied(
  $$update public.pets set owner_id = 'cc000000-0000-0000-0000-00000000000b' where id = 'dd000000-0000-0000-0000-00000000000a'$$,
  'スタッフでも pets.owner_id は書き換えられない'
);

/* ── ④ 飼い主に見えるもの ── */
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000000a', true);
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 1, '飼い主に、自分の犬は見える');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000b'), 0, '飼い主に、他所の犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 1, '飼い主に、確定したカルテは見える');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-0000000000a2'), 0, '飼い主に、下書きは見えない');

/* ── ⑤ 招かれていない人には何も見えない ── */
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000000b', true);
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 0, '別の飼い主に、他所の犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 0, '別の飼い主に、他所のカルテは見えない');

reset role;
rollback;

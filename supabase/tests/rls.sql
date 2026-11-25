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

/* 「決まった理由で断られること」を見る（R9・2026-11-25）。
   通ってしまったら止める。**別の理由で落ちた**ときも止める——壊れて落ちたのを
   「断られた」と数えると、検査が緑のまま守りが消えうる（`D-18` 偽-5）。 */
create or replace function pg_temp.refused(statement text, expected_state text, label text)
returns void language plpgsql as $$
declare
  got text;
begin
  begin
    execute statement;
  exception when others then
    got := sqlstate;
  end;
  if got is null then
    raise exception 'RLS 検査: % — 断られるはずの操作が通ってしまった', label;
  end if;
  if got <> expected_state then
    raise exception 'RLS 検査: % — 断り方が違う（期待 % / 実際 %）', label, expected_state, got;
  end if;
end;
$$;

/* ── 土台。2店舗・スタッフ2人・飼い主2人・犬2頭・カルテ2枚 ── */
insert into auth.users (id, email) values
  ('aa000000-0000-0000-0000-000000000001', 'staff-a@rls.test'),
  ('aa000000-0000-0000-0000-000000000002', 'staff-b@rls.test'),
  ('aa000000-0000-0000-0000-000000000003', 'admin-b@rls.test'),
  ('aa000000-0000-0000-0000-000000000004', 'staff-b2@rls.test'),
  ('aa000000-0000-0000-0000-00000000000a', 'owner-a@rls.test'),
  ('aa000000-0000-0000-0000-00000000000b', 'owner-b@rls.test')
on conflict (id) do nothing;

insert into public.shops (id, name, slug) values
  ('bb000000-0000-0000-0000-000000000001', 'RLS Shop A', 'rls-shop-a'),
  ('bb000000-0000-0000-0000-000000000002', 'RLS Shop B', 'rls-shop-b');

/* 店舗側は「管理者」と「スタッフ」（`D-26`・`202611190017`）。店舗Aの人は管理者にする
   （ログアウト後に管理者の判定も閉じることを ⑥ で見るため）。 */
insert into public.shop_memberships (shop_id, user_id, role) values
  ('bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'admin'),
  ('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000002', 'staff'),
  /* ⑦⑧ 用: 店舗Bの管理者と、止められる側のスタッフ（R9・2026-11-25）。 */
  ('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000003', 'admin'),
  ('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000004', 'staff');

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

/* 「ログインしている」を作る道具。**通行証だけでなく、ログイン状態の行も要る**
   （`202611210022_session_liveness.sql`）。`auth.sessions` は authenticated から
   触れないので、役を切り替える前に security definer で用意する。
   ログイン状態の行の id は、読みやすさのため利用者の id と同じ値にする。 */
create or replace function pg_temp.login(actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into auth.sessions (id, user_id) values (actor, actor) on conflict (id) do nothing;
  perform pg_catalog.set_config('request.jwt.claim.sub', actor::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', actor, 'session_id', actor)::text,
    true);
end;
$$;

/* 「ログアウトした」を作る道具。通行証はそのまま、ログイン状態の行だけ消す
   ——これが本番で起きていること（`signOut()` は行を消すが通行証は取り消せない）。 */
create or replace function pg_temp.logout(actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions where user_id = actor;
end;
$$;

set local role authenticated;

/* ── ① 店舗をまたげない（この製品で最も壊れてはいけない面）──
   **「0件見える」は、相手側に実在する行についてだけ意味を持つ。**
   だから id を名指しして「在るのに見えない」を見る。存在しない id を数えて
   0 でも、それは何も言っていない。 */
select pg_temp.login('aa000000-0000-0000-0000-000000000002');
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
select pg_temp.login('aa000000-0000-0000-0000-000000000001');
select pg_temp.eq((select count(*)::integer from public.owners where id = 'cc000000-0000-0000-0000-00000000000b'), 0, '店舗Aのスタッフに、店舗Bの飼い主は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000b'), 0, '店舗Aのスタッフに、店舗Bのカルテは見えない');

/* ── ③ 犬の付け替えができないこと（列を絞った grant・診断 #11）── */
select pg_temp.denied(
  $$update public.pets set owner_id = 'cc000000-0000-0000-0000-00000000000b' where id = 'dd000000-0000-0000-0000-00000000000a'$$,
  'スタッフでも pets.owner_id は書き換えられない'
);

/* ── ④ 飼い主に見えるもの ── */
select pg_temp.login('aa000000-0000-0000-0000-00000000000a');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 1, '飼い主に、自分の犬は見える');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000b'), 0, '飼い主に、他所の犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 1, '飼い主に、確定したカルテは見える');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-0000000000a2'), 0, '飼い主に、下書きは見えない');

/* ── ⑤ 招かれていない人には何も見えない ── */
select pg_temp.login('aa000000-0000-0000-0000-00000000000b');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 0, '別の飼い主に、他所の犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 0, '別の飼い主に、他所のカルテは見えない');

/* ── ⑥ ログアウトしたあと、同じ通行証では何も見えないこと ──
   **これがこの検査の新しい柱**（安全確認 ASVS v5.0.0-7.4.1 / D-20260915-76）。
   通行証は取り消せないので、ログアウト後も最大1時間そのまま通ってしまっていた。
   ログイン状態の行が消えたら、通行証が生きていても見えないことを見る。 */
select pg_temp.login('aa000000-0000-0000-0000-000000000001');
select pg_temp.eq((select count(*)::integer from public.owners where id = 'cc000000-0000-0000-0000-00000000000a'), 1, 'ログイン中のスタッフに、自分の店舗の飼い主は見える');
select pg_temp.eq(private.is_shop_admin('bb000000-0000-0000-0000-000000000001')::integer, 1, 'ログイン中の管理者は、管理者として通る');

select pg_temp.logout('aa000000-0000-0000-0000-000000000001');
select pg_temp.eq((select count(*)::integer from public.owners where id = 'cc000000-0000-0000-0000-00000000000a'), 0, 'ログアウト後は、同じ通行証でも飼い主は見えない');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 0, 'ログアウト後は、同じ通行証でも犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 0, 'ログアウト後は、同じ通行証でもカルテは見えない');
select pg_temp.eq((select count(*)::integer from public.shop_memberships where user_id = 'aa000000-0000-0000-0000-000000000001'), 0, 'ログアウト後は、同じ通行証でも自分の名簿の行すら見えない');
select pg_temp.eq(private.is_shop_admin('bb000000-0000-0000-0000-000000000001')::integer, 0, 'ログアウト後は、同じ通行証では管理者の操作（削除・スタッフ管理）も通らない');

/* 飼い主側も同じであること（守りは4本に分かれているため・`202607160007` の注記）。 */
select pg_temp.login('aa000000-0000-0000-0000-00000000000a');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 1, 'ログイン中の飼い主に、確定したカルテは見える');
select pg_temp.logout('aa000000-0000-0000-0000-00000000000a');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000a'), 0, 'ログアウト後は、同じ通行証でも確定したカルテは見えない');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000a'), 0, 'ログアウト後は、同じ通行証でも自分の犬は見えない');

/* ── ⑦ スタッフは、管理者だけの操作ができない（R9・`D-26`・`202611190017`）──
   画面で隠しているだけでなく、**データベースが断る**こと。店舗Bのスタッフで試す。
   それぞれ、同じ操作が管理者には通ることも裏取りする（全部断るだけの壊れ方を見逃さない）。 */
select pg_temp.login('aa000000-0000-0000-0000-000000000002');
with attempted as (
  delete from public.owners where id = 'cc000000-0000-0000-0000-00000000000b' returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 0, 'スタッフは、自分の店舗の飼い主でも消せない');
with attempted as (
  delete from public.pets where id = 'dd000000-0000-0000-0000-00000000000b' returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 0, 'スタッフは、自分の店舗の犬でも消せない');
select pg_temp.refused(
  $$select public.mark_report_deleting('ee000000-0000-0000-0000-00000000000b')$$,
  'P0002', 'スタッフは、自分の店舗のカルテでも消せない（削除の入口）');
select pg_temp.refused(
  $$select public.archive_report('ee000000-0000-0000-0000-00000000000b')$$,
  'P0002', 'スタッフは、自分の店舗のカルテでも片付け（アーカイブ）できない');
with attempted as (
  update public.shops set default_revisit_days = 7 where id = 'bb000000-0000-0000-0000-000000000002' returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 0, 'スタッフは、店舗設定を書き換えられない');
select pg_temp.refused(
  $$select * from public.create_invitation('bb000000-0000-0000-0000-000000000002', 'staff', null)$$,
  '42501', 'スタッフは、スタッフ招待を作れない');
select pg_temp.refused(
  $$select public.set_member_active('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000004', false)$$,
  '42501', 'スタッフは、他のスタッフを止められない');
select pg_temp.refused(
  $$update public.owners set active = false where id = 'cc000000-0000-0000-0000-00000000000b'$$,
  '42501', 'スタッフは、飼い主を無効にできない');
select pg_temp.refused(
  $$update public.pets set active = false where id = 'dd000000-0000-0000-0000-00000000000b'$$,
  '42501', 'スタッフは、犬を無効にできない');

/* 裏取り: 同じ店舗の管理者には通る。 */
select pg_temp.login('aa000000-0000-0000-0000-000000000003');
with attempted as (
  update public.shops set default_revisit_days = 30 where id = 'bb000000-0000-0000-0000-000000000002' returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 1, '管理者は、店舗設定を書き換えられる');

/* ── ⑧ 止められた人は入れない（R9・`202611200020`）──
   止める前は見えていた人が、管理者に止められたあとは同じ通行証で何も見えず、何も書けない。 */
select pg_temp.login('aa000000-0000-0000-0000-000000000004');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000b'), 1, '止める前のスタッフに、自分の店舗の犬は見える');

select pg_temp.login('aa000000-0000-0000-0000-000000000003');
select pg_temp.eq(
  (select (not (public.set_member_active('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000004', false)).active)::integer),
  1, '管理者は、スタッフを止められる');

select pg_temp.login('aa000000-0000-0000-0000-000000000004');
select pg_temp.eq((select count(*)::integer from public.pets where id = 'dd000000-0000-0000-0000-00000000000b'), 0, '止められたスタッフに、犬は見えない');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000b'), 0, '止められたスタッフに、カルテは見えない');
select pg_temp.eq(private.is_shop_staff('bb000000-0000-0000-0000-000000000002')::integer, 0, '止められたスタッフは、スタッフとして通らない');
select pg_temp.refused(
  $$select public.revise_report('ee000000-0000-0000-0000-00000000000b', '{"memo":"stolen"}'::jsonb)$$,
  'P0002', '止められたスタッフは、確定済みカルテを直せない');

/* ── ⑨ カルテの「修正」は、データベースが回数で止め、記録は1枚20版まで（R1・`202611250023`）──
   Worker を通らない直接の呼び出し（`rest/v1/rpc/revise_report`）でも止まること。
   先に古い記録を25版置いておき、上限で古い方から消えることも見る。 */
reset role;
insert into public.report_revisions (shop_id, report_id, previous_data, revised_at)
select 'bb000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-00000000000b',
       '{"memo":"old"}'::jsonb, now() - make_interval(days => 1, secs => n)
from generate_series(1, 25) as n;
set local role authenticated;

select pg_temp.login('aa000000-0000-0000-0000-000000000002');
select pg_temp.eq(
  (select (public.revise_report('ee000000-0000-0000-0000-00000000000b', '{"memo":"B1"}'::jsonb)).id is not null)::integer,
  1, 'スタッフは、確定済みカルテを直せる（1回目）');

reset role;
select pg_temp.eq((select count(*)::integer from public.report_revisions where report_id = 'ee000000-0000-0000-0000-00000000000b'), 20, '記録は1枚につき20版まで（古い版から消える）');
select pg_temp.eq((select count(*)::integer from public.report_revisions where report_id = 'ee000000-0000-0000-0000-00000000000b' and previous_data = '{"memo":"B"}'::jsonb), 1, 'いま直す直前の中身は、上限で消されずに残る');
set local role authenticated;

do $$
begin
  for n in 2..30 loop
    perform public.revise_report('ee000000-0000-0000-0000-00000000000b', jsonb_build_object('memo', 'B' || n));
  end loop;
end;
$$;
select pg_temp.refused(
  $$select public.revise_report('ee000000-0000-0000-0000-00000000000b', '{"memo":"B31"}'::jsonb)$$,
  'PT429', '1時間に31回目の修正は、データベースが断る（PostgREST が 429 を返す番号）');

reset role;
select pg_temp.eq((select count(*)::integer from public.report_revisions where report_id = 'ee000000-0000-0000-0000-00000000000b'), 20, '30回直しても、記録は20版のまま');
select pg_temp.eq((select count(*)::integer from public.report_revisions where report_id = 'ee000000-0000-0000-0000-00000000000b' and previous_data = '{"memo":"old"}'::jsonb), 0, '先に置いた古い記録は、上限で消えている');
select pg_temp.eq((select count(*)::integer from public.reports where id = 'ee000000-0000-0000-0000-00000000000b' and data = '{"memo":"B30"}'::jsonb), 1, '断られた31回目は、中身を書き換えていない');

/* ── ⑩ 置き忘れの写真の片づけは、上げてから3分たったものだけ（R7・`202611250024`）──
   登録の無い写真2枚（上げた直後・10分前）。スタッフが消せるのは10分前の方だけ。
   ここで置く写真は ⑨ の修正を止める（登録の無い写真がある）ので、⑨ より後に置く。 */
insert into storage.buckets (id, name) values ('report-assets', 'report-assets') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, created_at) values
  ('report-assets', 'bb000000-0000-0000-0000-000000000002/dd000000-0000-0000-0000-00000000000b/ee000000-0000-0000-0000-00000000000b/fresh.webp', now()),
  ('report-assets', 'bb000000-0000-0000-0000-000000000002/dd000000-0000-0000-0000-00000000000b/ee000000-0000-0000-0000-00000000000b/stale.webp', now() - interval '10 minutes');
set local role authenticated;

select pg_temp.login('aa000000-0000-0000-0000-000000000002');
with attempted as (
  delete from storage.objects
  where bucket_id = 'report-assets'
    and name = 'bb000000-0000-0000-0000-000000000002/dd000000-0000-0000-0000-00000000000b/ee000000-0000-0000-0000-00000000000b/fresh.webp'
  returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 0, 'スタッフは、上げてから3分たっていない登録の無い写真を消せない');
with attempted as (
  delete from storage.objects
  where bucket_id = 'report-assets'
    and name = 'bb000000-0000-0000-0000-000000000002/dd000000-0000-0000-0000-00000000000b/ee000000-0000-0000-0000-00000000000b/stale.webp'
  returning 1
)
select pg_temp.eq((select count(*)::integer from attempted), 1, 'スタッフは、3分より前の置き忘れの写真は消せる');

reset role;
rollback;

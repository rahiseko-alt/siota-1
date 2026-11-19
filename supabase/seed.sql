-- ローカル／自動テスト専用。実在人物・本番データを含めない。
-- password loginはPlaywright local fixtureだけに使い、製品UIはGoogle Authのみを表示する。

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'staff@local.test', extensions.crypt('LocalOnly-Password-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Local Staff"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'owner-a@local.test', extensions.crypt('LocalOnly-Password-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner A"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'owner-b@local.test', extensions.crypt('LocalOnly-Password-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner B"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'uninvited@local.test', extensions.crypt('LocalOnly-Password-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Uninvited"}', now(), now(), '', '', '', ''),
  -- スタッフかつ飼い主。本番のマスター自身がこの形（D-20260823-06）で、
  -- **この組み合わせだけ**が「/my に留まるのにトリマー画面へ行けない」穴に落ちていた。
  -- fixture がこの形を持っていなかったので、検査5本すべてが素通りしていた。
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'staff-owner@local.test', extensions.crypt('LocalOnly-Password-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Staff And Owner"}', now(), now(), '', '', '', ''),
  -- スタッフ権限（管理者ではない）の口座（`N-49`・2026-11-19）。削除・店舗設定・スタッフ招待を断られる側。
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'limited-staff@local.test', extensions.crypt('LocalOnly-Password-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Limited Staff"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  identity_id,
  user_id,
  user_id::text,
  jsonb_build_object('sub', user_id::text, 'email', email),
  'email', now(), now(), now()
from (values
  ('21000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000002'::uuid, 'staff@local.test'),
  ('21000000-0000-0000-0000-0000000000a1'::uuid, '20000000-0000-0000-0000-0000000000a1'::uuid, 'owner-a@local.test'),
  ('21000000-0000-0000-0000-0000000000b1'::uuid, '20000000-0000-0000-0000-0000000000b1'::uuid, 'owner-b@local.test'),
  ('21000000-0000-0000-0000-0000000000f1'::uuid, '20000000-0000-0000-0000-0000000000f1'::uuid, 'uninvited@local.test'),
  ('21000000-0000-0000-0000-0000000000c1'::uuid, '20000000-0000-0000-0000-0000000000c1'::uuid, 'staff-owner@local.test'),
  ('21000000-0000-0000-0000-000000000003'::uuid, '20000000-0000-0000-0000-000000000003'::uuid, 'limited-staff@local.test')
) fixture(identity_id, user_id, email)
on conflict (provider_id, provider) do nothing;

insert into public.shops (id, name, slug)
values ('10000000-0000-0000-0000-000000000001', 'Local SALTY DOG', 'local-salty-dog')
on conflict (id) do nothing;

/* 店舗側の権限は「管理者」と「スタッフ」（`N-49`・2026-11-19・`202611190017`）。
   `staff@local.test` と `staff-owner@local.test` は**管理者**（列の既定 `admin`）——
   名前は昔のままだが、これまでの検査はこの2つで削除や店舗設定まで通しているので、
   役割を変えずに残す。**スタッフ権限で断られる側**は `limited-staff@local.test` で見る。
   （名前だけ「管理者」で中身が同じ口座を置いて検査が読み違えた `F-20260910-83` とは逆で、
   今回は役割が本当に違う。） */
insert into public.shop_memberships (shop_id, user_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1')
on conflict (shop_id, user_id) do nothing;
insert into public.shop_memberships (shop_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'staff')
on conflict (shop_id, user_id) do nothing;

insert into public.owners (id, shop_id, name, legacy_slug) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Owner A', 'owner-a'),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'Owner B', 'owner-b')
on conflict (id) do nothing;

insert into public.owner_users (owner_id, user_id) values
  ('30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1'),
  -- staff-owner@local.test をスタッフかつ飼い主にする（D-20260823-06 と同じ形）。
  ('30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000c1')
on conflict (owner_id, user_id) do nothing;

insert into public.pets (id, shop_id, owner_id, name, legacy_slug, template) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', 'X', 'pet-x', 'ponchi'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', 'Y', 'pet-y', 'ponchi'),
  ('40000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', 'Z', 'pet-z', 'ponchi'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', 'Q', 'pet-q', 'ponchi')
on conflict (id) do nothing;

insert into public.reports (
  id, shop_id, pet_id, report_date, status, data, created_by
) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '2026-07-15', 'final', '{"memo":"X final fixture"}', '20000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '2026-07-16', 'draft', '{"memo":"X draft fixture"}', '20000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', '2026-07-15', 'final', '{"memo":"Q final fixture"}', '20000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into public.report_assets (
  id, shop_id, report_id, kind, storage_path, mime_type, byte_size, sort_order
) values (
  '60000000-0000-0000-0000-0000000000a1',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-0000000000a1',
  'hero',
  '10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-0000000000a1/50000000-0000-0000-0000-0000000000a1/60000000-0000-0000-0000-0000000000a1.webp',
  'image/webp', 128, 0
)
on conflict (id) do nothing;

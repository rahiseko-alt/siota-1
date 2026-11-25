/* 辞めたお店の人の利用を止める・再開する（放置リスト `#76`・レビュー M1）。

   **断るのはデータベース**（`N-49`）なので、まず migration の文面で「管理者だけ」
   「自分は止められない」「最後の管理者は止められない」が書かれていることを見る。
   そのうえで Worker が、決まった形の本文しか受けず、DB の断りを人に返せる 4xx に
   直していることを、偽の fetch で `worker/src/index.js` を通して見る
   （`test/supabase-store.test.mjs` と同じ作り）。
   本物の DB での拒否は `scripts/verify-admin.mjs` の `23*` が見る。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { setMemberActiveSchema } from '../worker/src/api-schemas.js';
import worker from '../worker/src/index.js';

/* 偽のアクセストークンは JWT の形（`ヘッダ.中身.署名`・中身は {"exp":4102444800}＝2100年）にしてある。
   Worker は Supabase に問い合わせる前に形と期限を見て、崩れたものを弾く（review R6）。 */

const migrationUrl = new URL('../supabase/migrations/202611200020_admin_set_member_active.sql', import.meta.url);

const SHOP = '10000000-0000-0000-0000-000000000001';
const ADMIN = '20000000-0000-0000-0000-000000000001';
const TARGET = '20000000-0000-0000-0000-000000000003';

/** `create or replace function public.<name>(` から、その関数の `$$ … $$` までを切り出す。 */
function functionBody(sql, name) {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  assert.ok(start >= 0, `${name} が無い`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return { header: sql.slice(start, open), body: sql.slice(open, close) };
}

test('set_member_active: security definer・search_path 空・管理者だけ・自分と最後の管理者は断る', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const { header, body } = functionBody(sql, 'set_member_active');
  assert.match(header, /target_shop uuid,\s*target_user uuid,\s*new_active boolean/i);
  assert.match(header, /returns public\.shop_memberships/i);
  assert.match(header, /security definer/i);
  assert.match(header, /set search_path = ''/i);

  assert.match(body, /not private\.is_shop_admin\(target_shop\) then\s+raise exception using errcode = '42501'/i,
    '管理者でない人を断っていない');
  assert.doesNotMatch(body, /private\.is_shop_staff\(/i, 'スタッフでも通る判定が混ざっている');
  assert.match(body, /if target_user = actor then\s+raise exception using errcode = '22023'/i,
    '自分を止めるのを断っていない');
  assert.match(body, /other\.user_id <> target_user\s+and other\.role = 'admin'\s+and other\.active/i,
    '最後の有効な管理者かどうかを数えていない');
  assert.match(body, /errcode = '22023', message = 'last active admin'/i);
  assert.match(body, /errcode = 'P0002', message = 'membership unavailable'/i);
  /* 2人の管理者が同時に互いを止めて0人になる、を塞ぐ行ロック。 */
  assert.match(body, /membership\.role = 'admin'\s+for update/i, '管理者の行を押さえていない');
  /* 変えるのは `active` だけ。役割は書き換えない。 */
  assert.match(body, /set active = new_active/i);
  assert.doesNotMatch(body, /set role\b|role = new_/i, '役割を書き換えている');
  assert.match(body, /'staff\.updated', 'profile', target_user,\s+jsonb_build_object\('active', new_active\)/i,
    '監査記録を残していない');

  assert.match(sql, /revoke all on function public\.set_member_active\(uuid, uuid, boolean\) from public, anon;/i);
  assert.match(sql, /grant execute on function public\.set_member_active\(uuid, uuid, boolean\) to authenticated;/i);
});

test('list_shop_members: security definer・search_path 空・管理者だけ・その店の行だけ', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const { header, body } = functionBody(sql, 'list_shop_members');
  assert.match(header, /security definer/i);
  assert.match(header, /set search_path = ''/i);
  assert.match(header, /user_id uuid,\s*display_name text,\s*email text,\s*role text,\s*active boolean,\s*created_at timestamptz/i);
  assert.match(body, /not private\.is_shop_admin\(target_shop\) then\s+raise exception using errcode = '42501'/i,
    '管理者でない人にも一覧を返す');
  assert.match(body, /where membership\.shop_id = target_shop/i, '店で絞っていない');
  assert.match(sql, /revoke all on function public\.list_shop_members\(uuid\) from public, anon;/i);
  assert.match(sql, /grant execute on function public\.list_shop_members\(uuid\) to authenticated;/i);
});

test('止める・再開するの本文は { active: boolean } だけ（役割などは受けない）', () => {
  assert.equal(setMemberActiveSchema.safeParse({ active: false }).success, true);
  assert.equal(setMemberActiveSchema.safeParse({ active: true }).success, true);
  assert.equal(setMemberActiveSchema.safeParse({}).success, false);
  assert.equal(setMemberActiveSchema.safeParse({ active: 'false' }).success, false);
  assert.equal(setMemberActiveSchema.safeParse({ active: 0 }).success, false);
  assert.equal(setMemberActiveSchema.safeParse({ active: false, role: 'admin' }).success, false);
});

/** 偽の Supabase。`rpc` に、その RPC が返す Response を作る関数を渡す。 */
function fakeEnv(rpc, calls) {
  return {
    DATA_BACKEND: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_REPORT_ASSETS_BUCKET: 'report-assets',
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    FETCH: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: ADMIN, email: 'staff@local.test' });
      if (url.includes('/shop_memberships?')) return Response.json([{ shop_id: SHOP }]);
      const name = (url.match(/\/rest\/v1\/rpc\/([a-z_]+)/) || [])[1];
      if (name && rpc[name]) return rpc[name](init);
      return Response.json({}, { status: 500 });
    },
  };
}

function postActive(userId, body) {
  return new Request(`https://test.local/api/staff/${userId}/active`, {
    method: 'POST',
    headers: { Authorization: 'Bearer e30.eyJleHAiOjQxMDI0NDQ4MDB9.admin-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('GET /api/staff は呼んだ人の店で list_shop_members を呼び、一覧を返す', async () => {
  const calls = [];
  const row = {
    user_id: TARGET, display_name: null, email: 'limited-staff@local.test',
    role: 'staff', active: true, created_at: '2026-11-19T00:00:00Z',
  };
  const response = await worker.fetch(new Request('https://test.local/api/staff', {
    headers: { Authorization: 'Bearer e30.eyJleHAiOjQxMDI0NDQ4MDB9.admin-jwt' },
  }), fakeEnv({ list_shop_members: () => Response.json([row]) }, calls));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { members: [row] });
  const rpcCall = calls.find((call) => call.url.endsWith('/rest/v1/rpc/list_shop_members'));
  assert.ok(rpcCall, 'list_shop_members を呼んでいない');
  assert.deepEqual(JSON.parse(rpcCall.init.body), { target_shop: SHOP });
  assert.equal(rpcCall.init.headers.Authorization, 'Bearer e30.eyJleHAiOjQxMDI0NDQ4MDB9.admin-jwt');
});

test('POST /api/staff/{id}/active は本文を確かめてから set_member_active を呼ぶ', async () => {
  const calls = [];
  const env = fakeEnv({
    set_member_active: () => Response.json({ shop_id: SHOP, user_id: TARGET, role: 'staff', active: false }),
  }, calls);
  const ok = await worker.fetch(postActive(TARGET, { active: false }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { member: { userId: TARGET, role: 'staff', active: false } });
  const rpcCall = calls.find((call) => call.url.endsWith('/rest/v1/rpc/set_member_active'));
  assert.deepEqual(JSON.parse(rpcCall.init.body), { target_shop: SHOP, target_user: TARGET, new_active: false });

  /* 決まった形でない本文は、DB に届く前に 400。 */
  const before = calls.length;
  const bad = await worker.fetch(postActive(TARGET, { active: false, role: 'admin' }), env);
  assert.equal(bad.status, 400);
  const badType = await worker.fetch(postActive(TARGET, { active: 'no' }), env);
  assert.equal(badType.status, 400);
  assert.equal(calls.slice(before).some((call) => call.url.includes('set_member_active')), false);

  /* UUID でない相手は経路に乗らない。 */
  const notUuid = await worker.fetch(postActive('..%2Fother', { active: false }), env);
  assert.equal(notUuid.status, 404);
});

test('DB の断りは 4xx に直り、理由の文面は外に出さない', async () => {
  const refuse = (code, status) => () => Response.json(
    { code, message: 'sensitive SQL details', details: 'secret' }, { status },
  );
  const cases = [
    /* 管理者でない（PostgREST は 42501 を 403 で返す）→ 在るかどうかを教えない 404 */
    { code: '42501', status: 403, expect: 404 },
    /* その店の人ではない（PostgREST は P0002 を 500 で返す）→ 404。502 にしない */
    { code: 'P0002', status: 500, expect: 404 },
    /* 自分を止める・最後の管理者を止める（22023 は 400）→ 409 */
    { code: '22023', status: 400, expect: 409, error: 'member change refused' },
  ];
  for (const item of cases) {
    const calls = [];
    const response = await worker.fetch(
      postActive(TARGET, { active: false }),
      fakeEnv({ set_member_active: refuse(item.code, item.status) }, calls),
    );
    assert.equal(response.status, item.expect, `${item.code} → ${response.status}`);
    const text = await response.text();
    assert.equal(text.includes('sensitive'), false, '理由の文面が漏れた');
    if (item.error) assert.deepEqual(JSON.parse(text), { error: item.error });
  }

  /* 一覧も、管理者でなければ 404。 */
  const list = await worker.fetch(new Request('https://test.local/api/staff', {
    headers: { Authorization: 'Bearer e30.eyJleHAiOjQxMDI0NDQ4MDB9.staff-jwt' },
  }), fakeEnv({ list_shop_members: refuse('42501', 403) }, []));
  assert.equal(list.status, 404);
});

test('消した PATCH /api/staff/{id} と update_staff_membership は戻していない', async () => {
  const calls = [];
  const response = await worker.fetch(new Request(`https://test.local/api/staff/${TARGET}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer e30.eyJleHAiOjQxMDI0NDQ4MDB9.admin-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false }),
  }), fakeEnv({}, calls));
  assert.equal(response.status, 404);
  assert.equal(calls.some((call) => call.url.includes('update_staff_membership')), false);
});

test('止められた人は、スタッフ招待から入り直しても再開しない（独立検証①・2026-11-20）', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/migrations/202611200020_admin_set_member_active.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('create or replace function public.claim_invitation(raw_token text)');
  assert.ok(start > 0, 'claim_invitation をこの migration で定義し直している');
  const body = sql.slice(start, sql.indexOf('$$;', start));
  assert.match(body, /not membership\.active[\s\S]*?raise exception using errcode = 'P0002'/);
  assert.match(body, /on conflict \(shop_id, user_id\) do nothing/);
  assert.doesNotMatch(body, /do update set active = true/);
});

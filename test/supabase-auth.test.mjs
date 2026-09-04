import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  AuthError,
  readBearer,
  resolveAuthContext,
  safeReturnPath,
} from '../worker/src/auth-context.js';
import {
  captureInvitationToken,
  parseProtectedRoute,
  restoreProtectedRoute,
  safeReturnPath as safeBrowserReturnPath,
} from '../backend/js/supabase-auth.js';
import { buildInvitationUrl, mapOwner, parseStaffRoute } from '../backend/js/supabase-staff.js';

test('readBearer accepts only a non-empty Bearer token', () => {
  assert.equal(readBearer(new Request('https://test.local')), null);
  assert.equal(readBearer(new Request('https://test.local', { headers: { Authorization: 'Basic abc' } })), null);
  assert.equal(readBearer(new Request('https://test.local', { headers: { Authorization: 'Bearer   ' } })), null);
  assert.equal(readBearer(new Request('https://test.local', { headers: { Authorization: 'Bearer user-jwt' } })), 'user-jwt');
});

test('safeReturnPath permits only protected internal routes', () => {
  assert.equal(safeReturnPath('/my'), '/my');
  assert.equal(safeReturnPath('/my/pets/40000000-0000-0000-0000-0000000000a1?tab=history'), '/my/pets/40000000-0000-0000-0000-0000000000a1?tab=history');
  assert.equal(safeReturnPath('//evil.example/x'), '/my');
  assert.equal(safeReturnPath('/admin'), '/my');
  assert.equal(safeReturnPath('https://evil.example/my'), '/my');
});

/* スタッフの画面（/edit）も戻り先として保持する。ここを /my だけに戻すと、
   スタッフかつ飼い主のアカウント（D-20260823-06 = マスター自身）が未ログインで
   /edit を開いたとき、ログイン後に飼い主画面へ着いてトリマー画面に戻れなくなる。
   ブラウザ側（supabase-auth.js）と Worker 側（auth-context.js）は同じ契約。 */
test('safeReturnPath keeps the staff route so trimmers land back on /edit', () => {
  for (const fn of [safeReturnPath, safeBrowserReturnPath]) {
    assert.equal(fn('/edit'), '/edit');
    assert.equal(fn('/edit/p/40000000-0000-0000-0000-0000000000a1'), '/edit/p/40000000-0000-0000-0000-0000000000a1');
    assert.equal(fn('/editorial'), '/my', '前方一致で通してはいけない');
    assert.equal(fn('//evil.example/edit'), '/my');
  }
});

test('resolveAuthContext validates the bearer with Supabase Auth', async () => {
  const calls = [];
  const context = await resolveAuthContext(
    new Request('https://test.local/api/session', { headers: { Authorization: 'Bearer user-jwt' } }),
    { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable-key' },
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({ id: '20000000-0000-0000-0000-0000000000a1', email: 'owner-a@local.test' });
    },
  );
  assert.equal(context.userId, '20000000-0000-0000-0000-0000000000a1');
  assert.equal(context.accessToken, 'user-jwt');
  assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/user');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-jwt');
  assert.equal(calls[0].init.headers.apikey, 'publishable-key');
});

test('resolveAuthContext rejects missing and invalid sessions generically', async () => {
  await assert.rejects(
    () => resolveAuthContext(new Request('https://test.local/api/session'), { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' }),
    (error) => error instanceof AuthError && error.status === 401 && error.message === 'authentication required',
  );
  await assert.rejects(
    () => resolveAuthContext(
      new Request('https://test.local/api/session', { headers: { Authorization: 'Bearer invalid' } }),
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' },
      async () => new Response('internal details', { status: 401 }),
    ),
    (error) => error instanceof AuthError && error.status === 401 && !error.message.includes('internal details'),
  );
});

test('browser return path and protected route parser reject external or malformed routes', () => {
  const reportPath = '/my/pets/40000000-0000-0000-0000-0000000000a1/reports/50000000-0000-0000-0000-0000000000a1';
  assert.equal(safeBrowserReturnPath(reportPath), reportPath);
  assert.equal(safeBrowserReturnPath('//evil.example/my'), '/my');
  assert.deepEqual(parseProtectedRoute('/my'), { name: 'pets', petId: null, reportId: null });
  assert.deepEqual(parseProtectedRoute(reportPath), {
    name: 'report',
    petId: '40000000-0000-0000-0000-0000000000a1',
    reportId: '50000000-0000-0000-0000-0000000000a1',
  });
  assert.equal(parseProtectedRoute('/my/pets/not-a-uuid'), null);
});

test('session restoration returns directly to a protected bookmark', async () => {
  const storage = new Map([['post_auth_return', '/my/pets/40000000-0000-0000-0000-0000000000a1']]);
  const result = await restoreProtectedRoute(
    { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } }, error: null }) } },
    {
      pathname: '/my',
      search: '',
      storage: {
        getItem: (key) => storage.get(key) || null,
        removeItem: (key) => storage.delete(key),
      },
    },
  );
  assert.deepEqual(result, {
    state: 'signed-in',
    target: '/my/pets/40000000-0000-0000-0000-0000000000a1',
    accessToken: 'jwt',
  });
  assert.equal(storage.has('post_auth_return'), false);
});

test('signed-out bookmark is preserved for Google login', async () => {
  const result = await restoreProtectedRoute(
    { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
    { pathname: '/my/pets/40000000-0000-0000-0000-0000000000a1', search: '?tab=history', storage: null },
  );
  assert.deepEqual(result, {
    state: 'signed-out',
    returnPath: '/my/pets/40000000-0000-0000-0000-0000000000a1?tab=history',
  });
});

test('staff routes and owner mapping preserve A to X Y Z without adding a selector', () => {
  const owner = mapOwner({
    id: '30000000-0000-0000-0000-0000000000a1',
    name: 'A',
    pets: [
      { id: '40000000-0000-0000-0000-0000000000a1', owner_id: '30000000-0000-0000-0000-0000000000a1', name: 'X', reports: [] },
      { id: '40000000-0000-0000-0000-0000000000a2', owner_id: '30000000-0000-0000-0000-0000000000a1', name: 'Y', reports: [] },
      { id: '40000000-0000-0000-0000-0000000000a3', owner_id: '30000000-0000-0000-0000-0000000000a1', name: 'Z', reports: [] },
    ],
  });
  assert.deepEqual(owner.pets.map((pet) => pet.petName), ['X', 'Y', 'Z']);
  assert.deepEqual(parseStaffRoute('/edit/p/40000000-0000-0000-0000-0000000000a1'), {
    name: 'pet', ownerId: null, petId: '40000000-0000-0000-0000-0000000000a1', reportId: null,
  });
  assert.equal(parseStaffRoute('/edit/p/not-a-pet'), null);
});

test('invitation token moves out of browser history into temporary session storage', () => {
  const stored = new Map();
  let replaced = null;
  const token = 'a'.repeat(64);
  assert.equal(captureInvitationToken(`?invite=${token}&tab=history`, {
    pathname: '/my',
    storage: { setItem: (key, value) => stored.set(key, value) },
    history: { replaceState: (_state, _title, url) => { replaced = url; } },
  }), token);
  assert.equal(stored.get('pending_invitation'), token);
  assert.equal(replaced, '/my?tab=history');

  replaced = null;
  assert.equal(captureInvitationToken('?invite=not-valid', {
    pathname: '/my',
    storage: { setItem: (key, value) => stored.set(key, value) },
    history: { replaceState: (_state, _title, url) => { replaced = url; } },
  }), null);
  assert.equal(replaced, '/my');
});

test('invitation URL is first-registration-only and contains only the raw token', () => {
  const token = 'b'.repeat(64);
  assert.equal(
    buildInvitationUrl('https://dev.example.test/edit', token),
    `https://dev.example.test/my?invite=${token}`,
  );
  assert.throws(() => buildInvitationUrl('https://dev.example.test', 'short'));
});

/* ここから下は src/my.html（飼い主のマイページ）の結線検査。
   フックが1つでも欠けると bootProtectedPortal() は無反応になるか、
   loginButton.onclick で落ちる。実際に data-portal="customer" が消えていて
   ポータルが一度も起動していなかった期間がある（統合 plan のリスク#3）。
   Supabase 未有効化のため実機では確かめられないので、静的に押さえる。 */

const portalHtml = fs.readFileSync(new URL('../src/my.html', import.meta.url), 'utf8');
const authSource = fs.readFileSync(new URL('../backend/js/supabase-auth.js', import.meta.url), 'utf8');
const bootSource = authSource.slice(
  authSource.indexOf('export async function bootProtectedPortal'),
  authSource.indexOf('async function bootLoginPage'),
);

/** 属性名がそのまま出現しているか。`data-portal` が `data-portal-status` に当たらないようにする。 */
function hasAttribute(html, name) {
  return new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(html);
}

test('my.html carries every DOM hook bootProtectedPortal looks up', () => {
  assert.ok(bootSource.length > 0, 'bootProtectedPortal の本文を切り出せていない');
  const hooks = [...bootSource.matchAll(/document\.querySelector\('\[([\w-]+)\]'\)/g)].map((m) => m[1]);
  assert.deepEqual(
    hooks,
    /* `data-staff-link`（スタッフかつ飼い主のときだけ出したトリマー画面への入口）は
       外した。**1ログインアカウント＝1役割**（`D-20260904-66`・マスター判断 2026-09-04)
       なので、スタッフ権限を持つ人はここへ来ない——来ない人に出す入口は嘘になる。 */
    ['data-portal-status', 'data-login-panel', 'data-portal-content', 'data-google-login', 'data-sign-out'],
  );
  for (const hook of hooks) {
    assert.ok(hasAttribute(portalHtml, hook), `src/my.html に ${hook} が無い`);
  }
});

test('my.html declares the portal flavor bootProtectedPortal branches on', () => {
  const [, flavor] = authSource.match(/document\.body\?\.dataset\.portal === '([\w-]+)'/);
  assert.equal(flavor, 'customer');
  assert.match(portalHtml, new RegExp(`<body[^>]*\\sdata-portal="${flavor}"`));
});

/* 置き場所は F1 で `src/js/` → `backend/js/` へ移った（6685df5）。
   見ている中身は移設前と同じ——**vendor が先・portal は type="module"**。
   `createAuthClient` は `vendor?.createClient` を使うので、順序が逆だと必ず落ちる。 */
test('my.html loads the Supabase vendor before the portal module', () => {
  const vendorAt = portalHtml.indexOf('src="/backend/js/supabase-vendor.js"');
  const moduleAt = portalHtml.indexOf('src="/backend/js/supabase-auth.js"');
  assert.ok(vendorAt >= 0, 'vendor を読んでいない。createAuthClient が vendor?.createClient で必ず落ちる');
  assert.ok(moduleAt >= 0, 'supabase-auth.js を読んでいない。ポータルが起動しない');
  assert.ok(vendorAt < moduleAt, 'vendor は supabase-auth.js より前に置くこと');
  assert.match(portalHtml, /<script type="module" src="\/backend\/js\/supabase-auth\.js"><\/script>/);
});

test('my.html hides the login panel, the content and the sign-out until boot decides', () => {
  for (const hook of ['data-login-panel', 'data-portal-content', 'data-sign-out']) {
    assert.match(
      portalHtml,
      new RegExp(`${hook}[^>]*\\shidden`),
      `${hook} が初期表示で出ている。ログイン前の飼い主に中身の枠が見えてしまう`,
    );
  }
});

/* D-10: 飼い主に見せる画面に見本・デモ・既定文を出さない（F-14 / F-15）。
   my.html は 2026-08-21 まで、架空の犬・架空の日付・他所の犬の写真が入った
   静的モックだった。カルテの中身は renderReport() が実データから作る。 */
test('my.html ships no sample report content of its own', () => {
  assert.doesNotMatch(portalHtml, /<img\b/, 'カルテ画像を静的に埋めている');
  assert.doesNotMatch(portalHtml, /\/assets\/(photo|guide)-/, '見本写真を参照している');
  assert.doesNotMatch(portalHtml, /20\d\d[.\-/]\d\d[.\-/]\d\d/, '架空の来店日が埋まっている');
  assert.doesNotMatch(portalHtml, /\d+(\.\d+)?\s*kg/i, '架空の体重が埋まっている');
});

/* ══════════════════════════════════════════════════════════════
   ここに在った 12件を、この復元では**戻していない**（削っていい、ではない）

   `6685df5`「古いUIをはがし、正しいUIだけにする」が、この検査が見張っていた
   実体そのものを消した——`src/js/publish-client-ponchi.js` / `ponchi-app.js` /
   `ponchi-engine.js`。**無いものは検査できない**ので、戻すと即座に ENOENT で落ちる。

   **失われた知見のうち、いま効くもの2つを引き継ぎ先に置いた:**

   1. **`img.src`（プロパティ）を読んではいけない。** `<img src="">` の状態で
      プロパティを読むと、ブラウザは空文字ではなく**現在のページURL**を返す。
      使わなかった写真スロット全部にページURLが入り、飼い主に壊れた画像が届く。
      → いま同じ形が `backend/js/magazine-view.js:322`（`img.src = has ? src : ''`）に
        在る。`docs/deferred.md` #16 に登録済み。**⑥を結線する前に直す。**

   2. **削除の順序**（`beforeDelete()` が `method: 'DELETE'` より**前**にあること・
      その間に `.catch(` を挟まないこと・削除導線3つ全部に片付けが付いていること）。
      → いま `scripts/guard/delete-order.mjs` が引き継いでいる。ただし現状は
        **同じファイルに片付けの呼び出しが在るか**しか見ておらず、**順序までは見ていない**
        （`docs/ops/solved-F3.md` #2 の「限界」に記載）。ここに在った版のほうが強い。
        ④の削除導線を書くときに、順序と `.catch` の検査まで引き上げること。

   残りは、はがした UI の内部仕様（写真の縮小・下書きの離脱確認・deleting の再試行導線）で、
   作り直すときに `git show 6685df5^:test/supabase-auth.test.mjs` から読み直す。
   ══════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════
   スタッフかつ飼い主のアカウントが、トリマー画面へ行けなかった（D-20260824-37）

   `memberships > 0 && ownerLinks === 0` のときだけ /edit へ自動で飛ばす作りで、
   **両方持っている人**（D-20260823-06 でそう決めた本番のマスター自身）は
   /my に留まる。ところが / にも /my にも /edit へのリンクが1つも無く、
   URL を手打ちしない限り仕事を始められなかった。
   ══════════════════════════════════════════════════════════════ */
/* **振り分けは「スタッフ権限を持つか / 持たないか」の1本**
   （マスター判断 2026-09-04・`D-20260904-66`「レアケースだから想定する必要なし。
     別のアカウントを発行するから仕組みとして用意しない」）。

   前はここが「スタッフかつ飼い主なら `/my` に留めて入口を出す」を要求していた。
   その救済が在ったせいで**着く先が人によって変わり**、しかも `/edit` には
   ログアウトが無かったので、そこに着いた人は**別のアカウントに切り替えられなかった**
   （2026-09-04・実機で再現）。条件を1つに減らす。 */
test('ログイン後の振り分けは、スタッフ権限の有無だけで決まる', () => {
  const auto = bootSource.indexOf("location.replace('/edit')");
  assert.ok(auto > 0, 'スタッフを作業画面へ送る分岐が無い');
  const guard = bootSource.slice(bootSource.lastIndexOf('if (', auto), auto);
  assert.match(guard, /memberships \|\| \[\]\)\.length > 0/, 'スタッフ判定になっていない');
  assert.doesNotMatch(guard, /ownerLinks/,
    '飼い主かどうかを条件に混ぜている（着く先が人によって変わる・D-20260904-66）');
});

test('兼務アカウントの救済（/my にトリマー画面への入口）は残っていない', () => {
  /* **土台**: 本文を読めていなければ、以下の「無いこと」は何も見ていない。 */
  assert.ok(bootSource.length > 0, 'bootProtectedPortal の本文を切り出せていない');
  assert.doesNotMatch(bootSource, /data-staff-link/,
    '救済が残っている（`D-20260904-66` で仕組みごと無くした）');
  assert.doesNotMatch(portalHtml, /data-staff-link/, 'src/my.html に器が残っている');
});

/* **作業画面（`/edit`）から出られること。**
   ログアウトが無かったので、`/edit` に着いた人は `/` に戻っても
   `location.replace('/edit')` で送り返され、**ログイン画面に永久に戻れなかった**。
   マスターの「スタッフ用→ログインできない」「Home に戻るとその後ログインできない」の
   両方がこれ（2026-09-04・実機で再現）。 */
test('作業画面にログアウトが在り、押すと入口へ戻す', () => {
  const staffSource = fs.readFileSync(new URL('../backend/js/supabase-staff.js', import.meta.url), 'utf8');
  assert.match(staffSource, /\[data-sign-out\]/, 'スタッフ画面がログアウトを探していない');
  assert.match(staffSource, /signOut\.hidden = false/, 'ログアウトを出していない');
  assert.match(staffSource, /auth\.signOut\(\)/, '押しても実際にサインアウトしない');
  const editHtml = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(editHtml, /data-sign-out/, 'src/index.html にログアウトの器が無い');
});

/* **押しても何も起きない入口を、作業画面に置かない。**
   `/edit` には「01 ログイン」タブと screen-1 が残っており、「Google でログイン」まで
   見えるのに `bootLoginPage()` は `__ENTRY__` が無いと起動しないので**配線されて
   いなかった**（実測: 押す前後で URL が変わらない）。 */
test('作業画面では、入口の道具（01 ログイン・screen-1）を外す', () => {
  const staffSource = fs.readFileSync(new URL('../backend/js/supabase-staff.js', import.meta.url), 'utf8');
  assert.match(staffSource, /\[data-entry-only\]/, '入口専用の印を外していない');
  assert.match(staffSource, /getElementById\('screen-1'\)/, 'ログイン画面を外していない');
  const editHtml = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(editHtml, /data-step="1"[^>]*data-entry-only|data-entry-only[^>]*data-step="1"/,
    '「01 ログイン」タブに入口専用の印が付いていない');
});

test('検査用の fixture に「スタッフかつ飼い主」が居る', async () => {
  const seed = fs.readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
  const stack = fs.readFileSync(new URL('../scripts/lib/local-stack.mjs', import.meta.url), 'utf8');
  /* この組み合わせの fixture が無かったので、検査5本すべてが穴を素通りした。 */
  assert.match(seed, /staff-owner@local\.test/, 'seed にスタッフかつ飼い主のアカウントが無い');
  assert.match(stack, /staffOwnerEmail/, 'FIXTURE から参照できない');
  const userId = '20000000-0000-0000-0000-0000000000c1';
  assert.ok(
    new RegExp(`shop_memberships[\\s\\S]*${userId}`).test(seed),
    'そのアカウントがスタッフになっていない',
  );
  assert.ok(
    new RegExp(`owner_users[\\s\\S]*${userId}`).test(seed),
    'そのアカウントが飼い主になっていない',
  );
});

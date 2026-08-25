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
    ['data-portal-status', 'data-login-panel', 'data-portal-content', 'data-google-login', 'data-sign-out',
      /* スタッフかつ飼い主のときだけ出す、トリマー画面への入口。これが無いと、
         その人は /my に留まったまま自分の作業画面へ行けない（D-20260824-37）。 */
      'data-staff-link'],
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
test('スタッフには /my からトリマー画面への入口を出す', () => {
  const auto = bootSource.indexOf("location.replace('/edit')");
  const link = bootSource.indexOf('[data-staff-link]');
  assert.ok(auto > 0, 'スタッフ専用アカウントの自動遷移が無い');
  assert.ok(link > auto, '自動遷移を外れた人（スタッフかつ飼い主）への入口が無い');
  /* 出す条件は「スタッフであること」だけ。ownerLinks を条件に混ぜると、
     まさに穴に落ちていた組み合わせがまた漏れる。 */
  const guard = bootSource.slice(bootSource.lastIndexOf('if (', link), link);
  assert.match(guard, /memberships \|\| \[\]\)\.length > 0/, 'スタッフ判定になっていない');
  assert.doesNotMatch(guard, /ownerLinks/, '飼い主かどうかを条件に混ぜている（穴が再発する）');
  assert.match(portalHtml, /data-staff-link[^>]*hidden/, '既定で隠れていない（飼い主に見えてしまう）');
  assert.match(portalHtml, /href="\/edit"[^>]*data-staff-link|data-staff-link[^>]*href="\/edit"/, '/edit を指していない');
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

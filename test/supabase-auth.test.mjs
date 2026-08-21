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
} from '../src/js/supabase-auth.js';
import { buildInvitationUrl, mapOwner, parseStaffRoute } from '../src/js/supabase-staff.js';

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
const authSource = fs.readFileSync(new URL('../src/js/supabase-auth.js', import.meta.url), 'utf8');
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

test('my.html loads the Supabase vendor before the portal module', () => {
  const vendorAt = portalHtml.indexOf('src="/js/supabase-vendor.js"');
  const moduleAt = portalHtml.indexOf('src="/js/supabase-auth.js"');
  assert.ok(vendorAt >= 0, 'vendor を読んでいない。createAuthClient が vendor?.createClient で必ず落ちる');
  assert.ok(moduleAt >= 0, 'supabase-auth.js を読んでいない。ポータルが起動しない');
  assert.ok(vendorAt < moduleAt, 'vendor は supabase-auth.js より前に置くこと');
  assert.match(portalHtml, /<script type="module" src="\/js\/supabase-auth\.js"><\/script>/);
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

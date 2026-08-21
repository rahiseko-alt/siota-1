import assert from 'node:assert/strict';
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

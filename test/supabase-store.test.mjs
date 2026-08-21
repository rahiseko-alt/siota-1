import assert from 'node:assert/strict';
import test from 'node:test';

import { createPetSchema, parseJson } from '../worker/src/api-schemas.js';
import { createDataStore } from '../worker/src/data-stores/create-data-store.js';
import { KvDataStore } from '../worker/src/data-stores/kv-data-store.js';
import { StoreError, SupabaseDataStore } from '../worker/src/data-stores/supabase-data-store.js';
import worker from '../worker/src/index.js';

function supabaseEnv(fetchImpl) {
  return {
    DATA_BACKEND: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_REPORT_ASSETS_BUCKET: 'report-assets',
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    FETCH: fetchImpl,
  };
}

test('factory defaults to the legacy KV store', () => {
  const store = createDataStore({ REPORTS: {} }, null);
  assert.ok(store instanceof KvDataStore);
  assert.equal(store.backend, 'kv');
});

test('Zod parser rejects unknown fields and malformed UUIDs', async () => {
  const unknown = await parseJson(new Request('https://test.local', {
    method: 'POST',
    body: JSON.stringify({ ownerId: '30000000-0000-0000-0000-0000000000a1', name: 'X', template: 'ponchi', admin: true }),
  }), createPetSchema);
  assert.deepEqual(unknown, { ok: false, status: 400, error: 'invalid request' });

  const invalid = await parseJson(new Request('https://test.local', {
    method: 'POST', body: JSON.stringify({ ownerId: '../owner-a', name: 'X', template: 'ponchi' }),
  }), createPetSchema);
  assert.equal(invalid.ok, false);
});

test('JSON parser rejects oversized report bodies before parsing', async () => {
  const result = await parseJson(new Request('https://test.local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1048577' },
    body: JSON.stringify({ ownerId: '30000000-0000-0000-0000-0000000000a1', name: 'X', template: 'ponchi' }),
  }), createPetSchema);
  assert.deepEqual(result, { ok: false, status: 413, error: 'request too large' });
});

test('Supabase store forwards the user JWT and never a privileged key', async () => {
  const calls = [];
  const store = new SupabaseDataStore({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'publishable-key',
    accessToken: 'user-jwt',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json([]);
    },
  });
  await store.listPets();
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-jwt');
  assert.equal(calls[0].init.headers.apikey, 'publishable-key');
  assert.equal(JSON.stringify(calls).includes('service_role'), false);
});

test('Supabase store hides PostgREST response details', async () => {
  const store = new SupabaseDataStore({
    supabaseUrl: 'https://project.supabase.co', publishableKey: 'pk', accessToken: 'jwt',
    fetchImpl: async () => Response.json({ message: 'sensitive SQL details' }, { status: 403 }),
  });
  await assert.rejects(
    () => store.listPets(),
    (error) => error instanceof StoreError && error.status === 403 && !error.message.includes('sensitive SQL details'),
  );
});

test('Supabase mode rejects a missing bearer before data access', async () => {
  let fetchCalls = 0;
  const response = await worker.fetch(
    new Request('https://test.local/api/session'),
    supabaseEnv(async () => { fetchCalls += 1; return Response.json({}); }),
  );
  assert.equal(response.status, 401);
  assert.equal(fetchCalls, 0);
});

test('Supabase session route validates Auth before querying RLS-scoped rows', async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request('https://test.local/api/session', { headers: { Authorization: 'Bearer user-jwt' } }),
    supabaseEnv(async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) {
        return Response.json({ id: '20000000-0000-0000-0000-0000000000a1', email: 'owner-a@local.test' });
      }
      return Response.json([]);
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, '20000000-0000-0000-0000-0000000000a1');
  assert.deepEqual(body.memberships, []);
  assert.deepEqual(body.ownerLinks, []);
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every((call) => call.init.headers.Authorization === 'Bearer user-jwt'));
});

test('public config exposes only browser-safe values', async () => {
  const env = {
    ...supabaseEnv(async () => Response.json({})),
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak',
    GOOGLE_CLIENT_SECRET: 'must-not-leak',
  };
  const response = await worker.fetch(new Request('https://test.local/api/config'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    backend: 'supabase',
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'publishable-key',
    assetsBucket: 'report-assets',
  });
});

test('Supabase protected bookmarks always receive the customer portal shell', async () => {
  const assetRequests = [];
  const env = supabaseEnv(async () => Response.json({}));
  env.ASSETS = {
    fetch: async (request) => {
      assetRequests.push(new URL(request.url).pathname);
      return new Response('<body data-portal="customer"></body>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };

  const response = await worker.fetch(new Request(
    'https://test.local/my/pets/30000000-0000-0000-0000-0000000000a1/reports/40000000-0000-0000-0000-0000000000a1',
  ), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<body data-portal="customer"></body>');
  assert.deepEqual(assetRequests, ['/my.html']);
});

test('Supabase mode has no unauthenticated public owner or report HTML routes', async () => {
  const env = supabaseEnv(async () => Response.json({}));
  const [reportPage, ownerPage, customerApi] = await Promise.all([
    worker.fetch(new Request('https://test.local/p/pet-x/report-x'), env),
    worker.fetch(new Request('https://test.local/o/owner-a'), env),
    worker.fetch(new Request('https://test.local/api/my/pets'), env),
  ]);
  assert.equal(reportPage.status, 404);
  assert.equal(ownerPage.status, 404);
  assert.equal(customerApi.status, 401);
});

test('Supabase staff routes inject auth scripts without changing the KV template', async () => {
  const env = supabaseEnv(async () => Response.json({}));
  env.ASSETS = {
    fetch: async () => new Response('<html><head></head><body>staff shell</body></html>'),
  };

  const response = await worker.fetch(new Request(
    'https://test.local/edit/p/40000000-0000-0000-0000-0000000000a1',
  ), env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /window\.__BACKEND__='supabase'/);
  assert.match(html, /\/js\/supabase-staff\.js/);
  assert.equal((html.match(/supabase-staff\.js/g) || []).length, 1);
});

test('report creation rejects a route/body pet mismatch before any database write', async () => {
  const calls = [];
  const response = await worker.fetch(new Request(
    'https://test.local/api/pets/30000000-0000-0000-0000-0000000000a1/reports',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer staff-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        petId: '30000000-0000-0000-0000-0000000000b1',
        reportDate: '2026-07-16',
        data: {},
      }),
    },
  ), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000001', email: 'staff@local.test' });
    }
    return Response.json([], { status: 201 });
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'pet mismatch' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/auth/v1/user'));
});

test('report creation derives shop and pet from the exact route pet context', async () => {
  const petId = '40000000-0000-0000-0000-0000000000a1';
  const calls = [];
  const response = await worker.fetch(new Request(`https://test.local/api/pets/${petId}/reports`, {
    method: 'POST',
    headers: { Authorization: 'Bearer staff-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ petId, reportDate: '2026-07-16', data: { pet: 'X', memo: 'X only' } }),
  }), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000002', email: 'staff@local.test' });
    }
    if (url.includes('/rest/v1/rpc/consume_rate_limit')) return Response.json(true);
    if (init.method === 'POST' && url.includes('/rest/v1/reports?select=')) {
      const body = JSON.parse(init.body);
      return Response.json([{ id: '50000000-0000-0000-0000-0000000000a9', ...body, status: 'draft' }], { status: 201 });
    }
    if (url.includes('/rest/v1/pets?') && url.includes(`id=eq.${petId}`)) {
      return Response.json([{
        id: petId,
        shop_id: '10000000-0000-0000-0000-000000000001',
        owner_id: '30000000-0000-0000-0000-0000000000a1',
        name: 'X',
        template: 'ponchi',
        active: true,
      }]);
    }
    if (url.includes('/rest/v1/reports?')) return Response.json([]);
    return Response.json({}, { status: 500 });
  }));

  assert.equal(response.status, 201);
  const insert = calls.find((call) => call.init.method === 'POST' && call.url.includes('/rest/v1/reports?select='));
  assert.ok(insert);
  assert.deepEqual(JSON.parse(insert.init.body), {
    shop_id: '10000000-0000-0000-0000-000000000001',
    pet_id: petId,
    report_date: '2026-07-16',
    data: { pet: 'X', memo: 'X only' },
    created_by: '20000000-0000-0000-0000-000000000002',
  });
  assert.equal(insert.init.body.includes('0000000000a2'), false);
  assert.equal(insert.init.body.includes('0000000000a3'), false);
});

test('customer report denial is the same generic 404 for hidden and missing rows', async () => {
  const response = await worker.fetch(new Request(
    'https://test.local/api/my/pets/40000000-0000-0000-0000-0000000000a1/reports/50000000-0000-0000-0000-0000000000a1',
    { headers: { Authorization: 'Bearer owner-b-jwt' } },
  ), supabaseEnv(async (url) => {
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-0000000000b1', email: 'owner-b@local.test' });
    }
    return Response.json([]);
  }));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not available' });
});

test('invitation claim rejects malformed tokens before rate-limit or database access', async () => {
  const calls = [];
  const response = await worker.fetch(new Request('https://test.local/api/invitations/claim', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'short-or-not-hex' }),
  }), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-0000000000f1', email: 'new@local.test' });
    }
    return Response.json(true);
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid request' });
  assert.equal(calls.length, 1);
});

test('invitation claim rate limit returns 429 with Retry-After and never claims', async () => {
  const token = 'a'.repeat(64);
  const calls = [];
  const response = await worker.fetch(new Request('https://test.local/api/invitations/claim', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-0000000000f1', email: 'new@local.test' });
    }
    if (url.includes('/rest/v1/rpc/consume_rate_limit')) return Response.json(false);
    return Response.json({ type: 'owner' });
  }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '600');
  assert.deepEqual(await response.json(), { error: 'too many requests' });
  assert.equal(calls.some((call) => call.url.includes('/rpc/claim_invitation')), false);
});

test('owner invitation returns the raw token once without exposing a stored hash', async () => {
  const token = 'b'.repeat(64);
  const calls = [];
  const response = await worker.fetch(new Request('https://test.local/api/invitations', {
    method: 'POST',
    headers: { Authorization: 'Bearer staff-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invitationType: 'owner',
      ownerId: '30000000-0000-0000-0000-0000000000a1',
    }),
  }), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000002', email: 'staff@local.test' });
    }
    if (url.includes('/rpc/consume_rate_limit')) return Response.json(true);
    if (url.includes('/shop_memberships?')) {
      return Response.json([{ shop_id: '10000000-0000-0000-0000-000000000001' }]);
    }
    if (url.includes('/rpc/create_invitation')) {
      return Response.json([{
        invitation_id: '70000000-0000-0000-0000-000000000001',
        raw_token: token,
        expires_at: '2026-07-17T00:00:00Z',
      }]);
    }
    return Response.json({}, { status: 500 });
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    invitation: {
      id: '70000000-0000-0000-0000-000000000001',
      token,
      expiresAt: '2026-07-17T00:00:00Z',
    },
  });
  const rpcCall = calls.find((call) => call.url.includes('/rpc/create_invitation'));
  assert.equal(JSON.stringify(rpcCall).includes('token_hash'), false);
});

test('expired revoked claimed and missing invitation claims share one generic response', async () => {
  const response = await worker.fetch(new Request('https://test.local/api/invitations/claim', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'c'.repeat(64) }),
  }), supabaseEnv(async (url) => {
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-0000000000f1', email: 'new@local.test' });
    }
    if (url.includes('/rpc/consume_rate_limit')) return Response.json(true);
    return Response.json({ message: 'database details must be hidden' }, { status: 404 });
  }));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not available' });
});

test('valid invitation claim hashes the client IP with a server-only pepper', async () => {
  const calls = [];
  const env = supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-0000000000f1', email: 'new@local.test' });
    }
    if (url.includes('/rpc/consume_rate_limit')) return Response.json(true);
    if (url.includes('/rpc/claim_invitation')) return Response.json({ type: 'owner' });
    return Response.json({}, { status: 500 });
  });
  env.RATE_LIMIT_IP_PEPPER = 'server-only-pepper-with-at-least-32-characters';
  const response = await worker.fetch(new Request('https://test.local/api/invitations/claim', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: JSON.stringify({ token: 'd'.repeat(64) }),
  }), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const rateCall = calls.find((call) => call.url.includes('/rpc/consume_rate_limit'));
  const rateBody = JSON.parse(rateCall.init.body);
  assert.match(rateBody.ip_hash, /^[0-9a-f]{64}$/);
  assert.equal(rateCall.init.body.includes('203.0.113.7'), false);
});

test('invitation listing requests only safe columns and never token material', async () => {
  const calls = [];
  const response = await worker.fetch(new Request('https://test.local/api/invitations', {
    headers: { Authorization: 'Bearer staff-jwt' },
  }), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000002', email: 'staff@local.test' });
    }
    if (url.includes('/shop_memberships?')) {
      return Response.json([{ shop_id: '10000000-0000-0000-0000-000000000001' }]);
    }
    if (url.includes('/invitations?')) return Response.json([]);
    return Response.json({}, { status: 500 });
  }));

  assert.equal(response.status, 200);
  const listCall = calls.find((call) => call.url.includes('/rest/v1/invitations?'));
  assert.ok(listCall);
  assert.equal(listCall.url.includes('token_hash'), false);
  assert.equal(listCall.url.includes('raw_token'), false);
});

test('staff role changes use the admin-only RPC and surface last-admin conflicts', async () => {
  const response = await worker.fetch(new Request(
    'https://test.local/api/staff/20000000-0000-0000-0000-000000000001',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    },
  ), supabaseEnv(async (url) => {
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000001', email: 'admin@local.test' });
    }
    if (url.includes('/shop_memberships?')) {
      return Response.json([{ shop_id: '10000000-0000-0000-0000-000000000001' }]);
    }
    if (url.includes('/rpc/update_staff_membership')) return Response.json(null);
    return Response.json({}, { status: 500 });
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'last admin cannot be disabled' });
});

test('asset metadata rejects client storage paths and derives them inside the database RPC', async () => {
  const petId = '40000000-0000-0000-0000-0000000000a1';
  const reportId = '50000000-0000-0000-0000-0000000000a1';
  const assetId = '60000000-0000-0000-0000-0000000000a1';
  const calls = [];
  const response = await worker.fetch(new Request(
    `https://test.local/api/pets/${petId}/reports/${reportId}/assets`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer staff-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: assetId,
        kind: 'heroPhotos.0',
        mimeType: 'image/webp',
        byteSize: 1200,
        sortOrder: 0,
      }),
    },
  ), supabaseEnv(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000002', email: 'staff@local.test' });
    }
    if (url.includes('/rpc/consume_rate_limit')) return Response.json(true);
    if (url.includes('/rest/v1/reports?')) {
      return Response.json([{ id: reportId, pet_id: petId, shop_id: '10000000-0000-0000-0000-000000000001', status: 'draft', data: {} }]);
    }
    if (url.includes('/rest/v1/report_assets?')) return Response.json([]);
    if (url.includes('/rpc/register_report_asset')) {
      return Response.json({ id: assetId, report_id: reportId, storage_path: 'derived/in/sql.webp' });
    }
    return Response.json({}, { status: 500 });
  }));

  assert.equal(response.status, 201);
  const rpcCall = calls.find((call) => call.url.includes('/rpc/register_report_asset'));
  assert.deepEqual(JSON.parse(rpcCall.init.body), {
    target_report: reportId,
    target_asset: assetId,
    target_kind: 'heroPhotos.0',
    target_mime: 'image/webp',
    target_size: 1200,
    target_sort: 0,
  });
  assert.equal(rpcCall.init.body.includes('storage_path'), false);
  assert.equal(rpcCall.init.body.includes(petId), false);
});

test('finalize keeps a report draft when storage metadata or objects are incomplete', async () => {
  const petId = '40000000-0000-0000-0000-0000000000a1';
  const reportId = '50000000-0000-0000-0000-0000000000a1';
  const response = await worker.fetch(new Request(
    `https://test.local/api/pets/${petId}/reports/${reportId}/finalize`,
    { method: 'POST', headers: { Authorization: 'Bearer staff-jwt' } },
  ), supabaseEnv(async (url) => {
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: '20000000-0000-0000-0000-000000000002', email: 'staff@local.test' });
    }
    if (url.includes('/rpc/consume_rate_limit')) return Response.json(true);
    if (url.includes('/rest/v1/reports?')) {
      return Response.json([{ id: reportId, pet_id: petId, shop_id: '10000000-0000-0000-0000-000000000001', status: 'draft', data: {} }]);
    }
    if (url.includes('/rest/v1/report_assets?')) return Response.json([]);
    if (url.includes('/rpc/finalize_report')) return Response.json(null);
    return Response.json({}, { status: 500 });
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'report assets are incomplete' });
});

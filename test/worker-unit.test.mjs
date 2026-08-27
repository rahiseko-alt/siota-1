import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker/src/index.js';

function createTestEnv(initialEntries = []) {
  const store = new Map(initialEntries);

  return {
    store,
    env: {
      REPORTS: {
        async get(key) {
          return store.get(key) ?? null;
        },
        async put(key, value) {
          store.set(key, value);
        },
        async delete(key) {
          store.delete(key);
        },
        async list({ prefix = '', cursor = '' } = {}) {
          const matches = [...store.keys()]
            .filter((key) => key.startsWith(prefix) && (!cursor || key > cursor))
            .sort();
          const names = matches.slice(0, 1000);
          return {
            keys: names.map((name) => ({ name })),
            list_complete: names.length === matches.length,
            cursor: names.at(-1) || cursor,
          };
        },
      },
      ASSETS: {
        async fetch() {
          return new Response('<!doctype html><html><head></head><body></body></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        },
      },
    },
  };
}

function request(env, path, init) {
  return worker.fetch(new Request(`http://local.test${path}`, init), env);
}

function postJson(env, path, body) {
  return request(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('creating a pet updates the owner document and owner index count', async () => {
  const { env } = createTestEnv();
  const ownerResponse = await postJson(env, '/api/owners', { ownerName: 'テスト飼い主' });
  const owner = await ownerResponse.json();

  const petResponse = await postJson(env, '/api/customers', {
    petName: 'ポチ',
    ownerSlug: owner.ownerSlug,
    template: 'ponchi',
  });

  assert.equal(petResponse.status, 200);
  const owners = await (await request(env, '/api/owners')).json();
  assert.equal(owners.owners[0].petCount, 1);

  const ownerDocument = JSON.parse(await env.REPORTS.get(`owners/${owner.ownerSlug}.json`));
  assert.deepEqual(ownerDocument.pets.map((pet) => pet.petName), ['ポチ']);
});

test('creating a pet for a missing owner does not create an orphan customer', async () => {
  const { env } = createTestEnv();

  const response = await postJson(env, '/api/customers', {
    petName: '迷子犬',
    ownerSlug: 'owner-deadbeef',
  });

  assert.equal(response.status, 404);
  const customers = await (await request(env, '/api/customers')).json();
  assert.deepEqual(customers.customers, []);
});

test('invalid and malformed API route segments return controlled client errors', async () => {
  const { env } = createTestEnv();

  const encodedSlash = await request(env, '/api/customers/%2Findex%2Fowners');
  assert.equal(encodedSlash.status, 400);

  const malformedEncoding = await request(env, '/api/customers/%E0%A4%A');
  assert.equal(malformedEncoding.status, 400);

  const invalidReportId = await request(env, '/api/reports/pet-deadbeef/not-a-report');
  assert.equal(invalidReportId.status, 400);
});

test('customer deletion removes every paginated report key', async () => {
  const slug = 'pet-deadbeef';
  const entries = [
    [`customers/${slug}.json`, JSON.stringify({ version: 1, slug, petName: '大量犬', months: {} })],
    ['index/customers.json', JSON.stringify({ version: 1, customers: [{ slug, petName: '大量犬' }] })],
  ];
  for (let index = 0; index < 1001; index += 1) {
    entries.push([
      `reports/${slug}/r-${String(index).padStart(8, '0')}.json`,
      JSON.stringify({ reportId: `r-${String(index).padStart(8, '0')}` }),
    ]);
  }
  const { env, store } = createTestEnv(entries);

  const response = await request(env, `/api/customers/${slug}`, { method: 'DELETE' });

  assert.equal(response.status, 200);
  assert.equal([...store.keys()].filter((key) => key.startsWith(`reports/${slug}/`)).length, 0);
});

test('valid public report route still injects read-only report state', async () => {
  const slug = 'pet-deadbeef';
  const reportId = 'r-1234abcd';
  const report = { pet: 'ポチ', date: '2026/07/16', template: 'ponchi' };
  const { env } = createTestEnv([
    [`customers/${slug}.json`, JSON.stringify({
      version: 1,
      slug,
      petName: 'ポチ',
      months: { '2026-07': [{ reportId, date: '2026/07/16', publishedAt: '2026-07-16T00:00:00.000Z' }] },
    })],
    [`reports/${slug}/${reportId}.json`, JSON.stringify({ reportId, report })],
  ]);

  const response = await request(env, `/p/${slug}/${reportId}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /window\.__REPORT__=/);
  assert.match(html, /<\/head>/);
  /* **読む側の無い注入を戻さない**（`docs/deferred.md` #21・`A-5`）。
     `__VIEW__` `__SCREEN__` `__OWNER__` `__OWNER_LIST__` `__PET__` `__BACKEND__` は
     `6685df5` で消えた `ponchi-app.js` が読んでいたもので、注入だけが残っていた。
     ここは以前「注入されていること」を見ていた——**死んだものが在ることを守る検査**
     だったので、向きを反対にした。 */
  for (const dead of ['__VIEW__', '__SCREEN__', '__OWNER__', '__OWNER_LIST__', '__PET__', '__BACKEND__']) {
    assert.ok(!html.includes(dead), `読む側の無い ${dead} が注入されている`);
  }
});

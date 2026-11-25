/* 全レスポンスにセキュリティヘッダが付くこと（放置リスト #78・review M3/M8）。
   以前はどの応答にも付いておらず、個人情報を返す JSON にも `no-store` が無かった。
   道（`/api/*`・`/`・静的ファイル）ごとに付け忘れが起きないよう、種類の違う道を1本ずつ通す。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { hasLocalOrigin, productionHeaders } from '../scripts/lib/production-headers.mjs';
import worker from '../worker/src/index.js';

const SUPABASE_URL = 'https://project.supabase.co';

function env(assetFetch) {
  return {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_REPORT_ASSETS_BUCKET: 'report-assets',
    ASSETS: { fetch: assetFetch || (async () => new Response('asset', { status: 200 })) },
    FETCH: async () => Response.json({}),
  };
}

function assertSecurityHeaders(response, { https = true } = {}) {
  const csp = response.headers.get('Content-Security-Policy');
  assert.ok(csp, 'CSP が無い');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, new RegExp(`connect-src 'self' ${SUPABASE_URL.replace(/\./g, '\\.')}(;|$)`));
  assert.match(csp, new RegExp(`img-src 'self' data: blob: ${SUPABASE_URL.replace(/\./g, '\\.')}(;|$)`));
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
  assert.equal(
    response.headers.get('Strict-Transport-Security'),
    https ? 'max-age=31536000' : null,
  );
}

test('API の JSON（未ログインの 401）にもセキュリティヘッダが付く。エラーには個人情報が無いので no-store は付けない', async () => {
  const response = await worker.fetch(new Request('https://test.local/api/pets'), env());
  assert.equal(response.status, 401);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  /* 404 等に no-store を付けると、検査の道具が通信を終わらないものと数えた（2026-11-20 実測）。 */
  assert.equal(response.headers.get('Cache-Control'), null);
  assertSecurityHeaders(response);
});

test('成功した API の JSON（個人情報が入る）には no-store が付く', async () => {
  const response = await worker.fetch(new Request('https://test.local/api/ping'), env());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('入口 `/`（Worker が組み立てる HTML）にもセキュリティヘッダが付く', async () => {
  const response = await worker.fetch(new Request('https://test.local/'), env(async () => new Response(
    '<html><head></head><body></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /window\.__ENTRY__=true/);
  assertSecurityHeaders(response);
});

test('ASSETS の応答（ヘッダ書き換え不可）にも付き、元のヘッダは残る', async () => {
  const response = await worker.fetch(new Request('https://test.local/assets/app-icon.png'), env(async () => {
    const asset = new Response('png', { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' } });
    /* 本番の `env.ASSETS.fetch()` の応答は headers が immutable。同じ条件にする。 */
    asset.headers.set = () => { throw new TypeError('immutable'); };
    return asset;
  }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'png');
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
  assertSecurityHeaders(response);
});

test('道が意図して付けたヘッダは上書きしない', async () => {
  const response = await worker.fetch(new Request('https://test.local/my'), env(async () => new Response(
    '<body></body>',
    { headers: { 'Content-Type': 'text/html', 'Referrer-Policy': 'same-origin' } },
  )));
  assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
});

test('http で来たときは HSTS を付けない（ローカル開発）', async () => {
  const response = await worker.fetch(new Request('http://localhost:8851/api/ping'), env());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assertSecurityHeaders(response, { https: false });
});

/* `src/_headers` は Worker を通らない静的配信（`/my`・`/admin`・js・画像）に付く。
   Worker 側と値がずれると、道によって守りが変わる。本番の SUPABASE_URL で比べる。 */
test('src/_headers の値は Worker が本番で付ける値と同じ', async () => {
  const toml = fs.readFileSync(new URL('../worker/wrangler.supabase.toml', import.meta.url), 'utf8');
  const prodUrl = toml.match(/^SUPABASE_URL\s*=\s*"([^"]+)"/m)[1];
  const lines = fs.readFileSync(new URL('../src/_headers', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
  assert.equal(lines[0], '/*');
  const fileHeaders = Object.fromEntries(lines.slice(1).map((line) => {
    const index = line.indexOf(':');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));

  const response = await worker.fetch(
    new Request('https://test.local/api/ping'),
    { ...env(), SUPABASE_URL: prodUrl },
  );
  for (const name of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy']) {
    assert.equal(fileHeaders[name], response.headers.get(name), name);
  }
  /* CSP だけは、ローカル Supabase を足した分だけ違ってよい（理由は `src/_headers` の冒頭）。 */
  const local = ' http://127.0.0.1:54321';
  assert.equal(fileHeaders['Content-Security-Policy'].split(local).join(''), response.headers.get('Content-Security-Policy'));
});

/* ██ review R14 ██ */

/* (a) `SUPABASE_URL` を書き間違えても、入口のログイン画面まで落ちない。API は 503。 */
test('R14: SUPABASE_URL が読めなくても入口は配られ、API は 503 を返す', async () => {
  const broken = {
    ...env(async () => new Response('<html><head></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } })),
    SUPABASE_URL: 'not a url',
  };
  const page = await worker.fetch(new Request('https://test.local/'), broken);
  assert.equal(page.status, 200);
  const csp = page.headers.get('Content-Security-Policy');
  assert.match(csp, /connect-src 'self'; /);
  assert.match(csp, /frame-ancestors 'none'/);
  const api = await worker.fetch(new Request('https://test.local/api/session', {
    headers: { Authorization: 'Bearer e30.eyJleHAiOjQxMDI0NDQ4MDB9.user-jwt' },
  }), broken);
  assert.equal(api.status, 503);
  assert.equal(api.headers.get('X-Frame-Options'), 'DENY');
});

/* (b) localhost への CORS は、`wrangler dev` 専用の設定に印があるときだけ。本番では返さない。 */
test('R14: 本番の設定では localhost からの CORS を許さない（開発用の設定でだけ許す）', async () => {
  const fromLocal = (method = 'GET') => new Request('https://test.local/api/ping', {
    method,
    headers: { Origin: 'http://localhost:8787' },
  });
  for (const method of ['GET', 'OPTIONS']) {
    const prod = await worker.fetch(fromLocal(method), env());
    assert.equal(prod.headers.get('Access-Control-Allow-Origin'), null, method);
    const dev = await worker.fetch(fromLocal(method), { ...env(), ALLOW_LOCALHOST_CORS: 'true' });
    assert.equal(dev.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8787', method);
  }
  const read = (name) => fs.readFileSync(new URL(`../worker/${name}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('wrangler.supabase.toml'), /^ALLOW_LOCALHOST_CORS/m);
  assert.match(read('wrangler.local.toml'), /^ALLOW_LOCALHOST_CORS = "true"$/m);
});

/* (c) 放置リスト #80: 本番に出す `_headers` にローカルの住所（127.0.0.1:54321）を載せない。 */
test('R14 #80: 本番向けの _headers にはローカルの Supabase が無く、CSP は Worker の本番値と同じ', async () => {
  const toml = fs.readFileSync(new URL('../worker/wrangler.supabase.toml', import.meta.url), 'utf8');
  /* 本番の deploy は必ず `--production` で作り直してから配る。 */
  assert.match(toml, /^\[build\]\ncommand = "node \.\.\/scripts\/build-dist\.mjs --production"$/m);
  const prodUrl = toml.match(/^SUPABASE_URL\s*=\s*"([^"]+)"/m)[1];
  const src = fs.readFileSync(new URL('../src/_headers', import.meta.url), 'utf8');
  assert.ok(hasLocalOrigin(src), 'ローカル用（src）にはまだ在る前提');
  const prod = productionHeaders(src);
  assert.equal(hasLocalOrigin(prod), false);
  const csp = prod.split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:'));
  const response = await worker.fetch(new Request('https://test.local/api/ping'), { ...env(), SUPABASE_URL: prodUrl });
  assert.equal(csp.slice(csp.indexOf(':') + 1).trim(), response.headers.get('Content-Security-Policy'));
});

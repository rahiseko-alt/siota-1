// Trimmer System（ponchi-v2.html 専用）公開 Worker
// ルーティング: /api/ping, /api/customers, /api/owners, /api/reports（無認証）,
//              /p/{slug}（閲覧 H2 肉球画面）, /p/{slug}/all（アーカイブ）,
//              /p/{slug}/{reportId}（閲覧 H3）, /o/{ownerSlug}（飼い主 H1）
//              /edit（編集 H1 飼い主一覧）, /edit/o/{ownerSlug}（編集 飼い主の犬一覧）,
//              /edit/p/{slug}（編集 アーカイブ月一覧）, /edit/p/{slug}/{reportId}（編集 レポート）
// データストア: Workers KV（binding: REPORTS）
//   index/customers.json              — 顧客一覧メタ
//   index/owners.json                 — 飼い主一覧メタ [{ownerSlug,ownerName,petCount}]
//   customers/{slug}.json             — 顧客メタ（月別の reportId 一覧・写真なし＝軽量）
//                                       + ownerSlug（逆参照）
//   owners/{ownerSlug}.json           — 飼い主メタ {ownerSlug,ownerName,pets:[{slug,petName}]}
//   reports/{slug}/{reportId}.json    — レポート 1 件の実体（写真込み）

// 全閲覧ページは ponchi-v2.html を注入配信する（A テンプレート分岐なし）。

import { AuthError, resolveAuthContext } from './auth-context.js';
import {
  claimInvitationSchema,
  createInvitationSchema,
  createOwnerSchema,
  createPetSchema,
  createReportAssetSchema,
  createReportSchema,
  parseJson,
  updateOwnerSchema,
  updateMembershipSchema,
  updatePetSchema,
  updateReportSchema,
} from './api-schemas.js';
import { createDataStore } from './data-stores/create-data-store.js';
import { StoreError } from './data-stores/supabase-data-store.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
// HTML は毎回最新を配信（修正が実機に確実に届くようキャッシュさせない）
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const REPORT_ID_PATTERN = /^r-[0-9a-f]{8}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_EDIT_PATH_PATTERN = /^\/edit\/(?:o|p)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\/?$/i;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

// localhost 開発（wrangler dev）時のみ CORS 許可。本番は同一オリジンで preflight 不要
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  }
  return {};
}

// ペット名 → URL 安全な slug（ASCII 残 or 'pet' フォールバック + base36 乱数）
function generateSlug(petName) {
  const safe = String(petName || '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()
    .slice(0, 24) || 'pet';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const rand = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${safe}-${rand}`;
}

// オーナースラグ生成（ownerName から）
function generateOwnerSlug(ownerName) {
  const safe = String(ownerName || '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()
    .slice(0, 24) || 'owner';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const rand = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${safe}-${rand}`;
}

// レポート ID（乱数。時刻は publishedAt で別途 ISO 付与）
function generateReportId() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return 'r-' + Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 'YYYY/MM/DD' → 'YYYY-MM'。不正なら publishedAt（ISO）から導出
function monthKeyFromDate(dateStr, publishedAtISO) {
  const m = String(dateStr || '').match(/^(\d{4})\/(\d{1,2})\//);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  const m2 = String(publishedAtISO || '').match(/^(\d{4})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}`;
  return 'unknown';
}

// KV ヘルパ（get は string を返す）
async function readJSON(env, key) {
  const v = await env.REPORTS.get(key);
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch (error) {
    console.error('[readJSON] invalid stored JSON:', key, error);
    return null;
  }
}

async function writeJSON(env, key, data) {
  await env.REPORTS.put(key, JSON.stringify(data));
}

// JSON 文字列化して </script> をエスケープ（XSS 集約点）
function safeJsonStr(data) {
  return JSON.stringify(data).replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function supabaseError(error, cors = {}) {
  if (error instanceof AuthError) return json({ error: error.message }, error.status, cors);
  if (error instanceof StoreError) {
    const status = error.status === 401 ? 401
      : error.status === 403 || error.status === 404 ? 404
        : error.status === 409 ? 409
          : error.status === 429 ? 429 : 502;
    const message = status === 404 ? 'not available'
      : status === 409 ? (
        error.code === 'last_admin' ? 'last admin cannot be disabled'
          : error.code === 'storage_cleanup_required' ? 'storage cleanup required'
            : error.code === 'storage_incomplete' ? 'report assets are incomplete'
            : 'shop selection required'
      )
        : status === 429 ? 'too many requests' : 'data request failed';
    const retrySeconds = {
      invitation_claim: 600,
      invitation_create: 3600,
      report_write: 600,
      asset_metadata: 600,
      search: 60,
    }[error.code];
    return json(
      { error: message },
      status,
      retrySeconds ? { ...cors, 'Retry-After': String(retrySeconds) } : cors,
    );
  }
  console.error('[supabase] unhandled request error');
  return json({ error: 'request failed' }, 500, cors);
}

async function rateLimitIpHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP');
  const pepper = env.RATE_LIMIT_IP_PEPPER;
  if (!ip || typeof pepper !== 'string' || pepper.length < 32) return null;
  const bytes = new TextEncoder().encode(`${pepper}\0${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function enforceRateLimit(store, scope, request, env) {
  const allowed = await store.consumeRateLimit(scope, await rateLimitIpHash(request, env));
  if (!allowed) throw new StoreError(429, scope);
}

function invalidJsonResult(result, cors) {
  return json({ error: result.error }, result.status, cors);
}

function isUuid(value) {
  return UUID_PATTERN.test(value || '');
}

async function handleSupabaseApi(request, store, path, cors, env) {
  const parts = path.split('/').filter(Boolean);

  if (path === '/api/invitations/claim' && request.method === 'POST') {
    const parsed = await parseJson(request, claimInvitationSchema);
    if (!parsed.ok) return invalidJsonResult(parsed, cors);
    await enforceRateLimit(store, 'invitation_claim', request, env);
    return json(
      { claim: await store.claimInvitation(parsed.data.token) },
      200,
      { ...cors, 'Cache-Control': 'no-store' },
    );
  }
  if (path === '/api/invitations') {
    if (request.method === 'GET') return json({ invitations: await store.listInvitations() }, 200, cors);
    if (request.method === 'POST') {
      const parsed = await parseJson(request, createInvitationSchema);
      if (!parsed.ok) return invalidJsonResult(parsed, cors);
      await enforceRateLimit(store, 'invitation_create', request, env);
      return json(
        { invitation: await store.createInvitation(parsed.data) },
        201,
        { ...cors, 'Cache-Control': 'no-store' },
      );
    }
  }
  if (
    parts.length === 4 && parts[0] === 'api' && parts[1] === 'invitations'
    && isUuid(parts[2]) && parts[3] === 'revoke' && request.method === 'POST'
  ) {
    return json(await store.revokeInvitation(parts[2]), 200, cors);
  }

  if (path === '/api/staff' && request.method === 'GET') {
    return json({ staff: await store.listStaff() }, 200, cors);
  }
  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'staff' && isUuid(parts[2]) && request.method === 'PATCH') {
    const parsed = await parseJson(request, updateMembershipSchema);
    if (!parsed.ok) return invalidJsonResult(parsed, cors);
    return json({ membership: await store.updateStaff(parts[2], parsed.data) }, 200, cors);
  }

  if (path === '/api/my/pets' && request.method === 'GET') {
    return json({ pets: await store.listPets() }, 200, cors);
  }
  if (parts[0] === 'api' && parts[1] === 'my' && parts[2] === 'pets' && isUuid(parts[3])) {
    const petId = parts[3];
    if (parts.length === 4 && request.method === 'GET') {
      return json({ pet: await store.getPet(petId) }, 200, cors);
    }
    if (parts.length === 6 && parts[4] === 'reports' && isUuid(parts[5]) && request.method === 'GET') {
      const [report, pet] = await Promise.all([
        store.getReport(petId, parts[5]),
        store.getPet(petId),
      ]);
      return json({ report: { ...report, pet: { id: pet.id, name: pet.name } } }, 200, cors);
    }
  }

  if (path === '/api/owners') {
    if (request.method === 'GET') return json({ owners: await store.listOwners() }, 200, cors);
    if (request.method === 'POST') {
      const parsed = await parseJson(request, createOwnerSchema);
      if (!parsed.ok) return invalidJsonResult(parsed, cors);
      return json({ owner: await store.createOwner(parsed.data) }, 201, cors);
    }
  }

  if (parts[0] === 'api' && parts[1] === 'owners' && isUuid(parts[2])) {
    const ownerId = parts[2];
    if (parts.length === 3) {
      if (request.method === 'GET') return json({ owner: await store.getOwner(ownerId) }, 200, cors);
      if (request.method === 'PATCH') {
        const parsed = await parseJson(request, updateOwnerSchema);
        if (!parsed.ok) return invalidJsonResult(parsed, cors);
        return json({ owner: await store.updateOwner(ownerId, parsed.data) }, 200, cors);
      }
      if (request.method === 'DELETE') return json(await store.deleteOwner(ownerId), 200, cors);
    }
    if (parts.length === 4 && parts[3] === 'pets') {
      if (request.method === 'GET') return json({ pets: await store.listOwnerPets(ownerId) }, 200, cors);
      if (request.method === 'POST') {
        const parsed = await parseJson(request, createPetSchema);
        if (!parsed.ok) return invalidJsonResult(parsed, cors);
        if (parsed.data.ownerId !== ownerId) return json({ error: 'owner mismatch' }, 400, cors);
        return json({ pet: await store.createPet(ownerId, parsed.data) }, 201, cors);
      }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'pets' && isUuid(parts[2])) {
    const petId = parts[2];
    if (parts.length === 3) {
      if (request.method === 'GET') return json({ pet: await store.getPet(petId) }, 200, cors);
      if (request.method === 'PATCH') {
        const parsed = await parseJson(request, updatePetSchema);
        if (!parsed.ok) return invalidJsonResult(parsed, cors);
        return json({ pet: await store.updatePet(petId, parsed.data) }, 200, cors);
      }
      if (request.method === 'DELETE') return json(await store.deletePet(petId), 200, cors);
    }
    if (parts[3] === 'reports') {
      if (parts.length === 4) {
        if (request.method === 'GET') return json({ reports: await store.listReports(petId) }, 200, cors);
        if (request.method === 'POST') {
          const parsed = await parseJson(request, createReportSchema);
          if (!parsed.ok) return invalidJsonResult(parsed, cors);
          if (parsed.data.petId !== petId) return json({ error: 'pet mismatch' }, 400, cors);
          await enforceRateLimit(store, 'report_write', request, env);
          return json({ report: await store.createReport(petId, parsed.data) }, 201, cors);
        }
      }
      if (parts.length >= 5 && isUuid(parts[4])) {
        const reportId = parts[4];
        if (parts.length === 5) {
          if (request.method === 'GET') return json({ report: await store.getReport(petId, reportId) }, 200, cors);
          if (request.method === 'PATCH') {
            const parsed = await parseJson(request, updateReportSchema);
            if (!parsed.ok) return invalidJsonResult(parsed, cors);
            await enforceRateLimit(store, 'report_write', request, env);
            return json({ report: await store.updateReport(petId, reportId, parsed.data) }, 200, cors);
          }
        }
        if (parts.length === 6 && request.method === 'POST') {
          if (parts[5] === 'assets') {
            const parsed = await parseJson(request, createReportAssetSchema);
            if (!parsed.ok) return invalidJsonResult(parsed, cors);
            await enforceRateLimit(store, 'asset_metadata', request, env);
            return json({ asset: await store.registerReportAsset(petId, reportId, parsed.data) }, 201, cors);
          }
          if (parts[5] === 'finalize') {
            await enforceRateLimit(store, 'report_write', request, env);
            return json({ report: await store.finalizeReport(petId, reportId) }, 200, cors);
          }
          if (parts[5] === 'archive') {
            await enforceRateLimit(store, 'report_write', request, env);
            return json({ report: await store.archiveReport(petId, reportId) }, 200, cors);
          }
          if (parts[5] === 'delete') {
            await enforceRateLimit(store, 'report_write', request, env);
            return json(await store.markReportDeleting(petId, reportId), 200, cors);
          }
        }
        if (
          parts.length === 7 && parts[5] === 'delete' && parts[6] === 'complete'
          && request.method === 'POST'
        ) {
          await enforceRateLimit(store, 'report_write', request, env);
          return json(await store.completeReportDeletion(petId, reportId), 200, cors);
        }
      }
    }
  }

  return json({ error: 'not found' }, 404, cors);
}

async function handleSupabaseMode(request, env, url, cors) {
  const path = url.pathname;
  if (path === '/api/config' && request.method === 'GET') {
    return json({
      backend: 'supabase',
      supabaseUrl: env.SUPABASE_URL,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      assetsBucket: env.SUPABASE_REPORT_ASSETS_BUCKET || 'report-assets',
    }, 200, cors);
  }

  if (path.startsWith('/api/')) {
    try {
      const context = await resolveAuthContext(request, env, env.FETCH || fetch);
      const store = createDataStore(env, context);
      if (path === '/api/session' && request.method === 'GET') {
        const access = await store.getSessionContext(context.userId);
        return json({ user: { id: context.userId, email: context.email }, ...access }, 200, cors);
      }
      return await handleSupabaseApi(request, store, path, cors, env);
    } catch (error) {
      return supabaseError(error, cors);
    }
  }

  if (path.startsWith('/p/') || path.startsWith('/o/')) {
    return new Response('Not Found', { status: 404 });
  }
  if (path === '/edit' || path === '/edit/' || SUPABASE_EDIT_PATH_PATTERN.test(path)) {
    return renderAppPage(env, { screen: 'owner', backend: 'supabase' });
  }
  if (path === '/my' || path === '/my/' || path.startsWith('/my/')) {
    return env.ASSETS.fetch(new Request('http://assets/my.html'));
  }
  return env.ASSETS.fetch(new Request(`http://assets${path}${url.search}`));
}

function isValidSlug(value) {
  return SLUG_PATTERN.test(String(value || ''));
}

function isValidReportId(value) {
  return REPORT_ID_PATTERN.test(String(value || ''));
}

// URL path の percent-encoding を安全に復号する。壊れた入力は例外ではなく null に集約する。
function decodeRouteRest(path, prefix) {
  const encoded = path.slice(prefix.length).replace(/\/+$/, '');
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch (_error) {
    return null;
  }
}

// Workers KV の list は最大 1,000 件/回なので cursor が完了するまで削除する。
async function deleteAllByPrefix(env, prefix) {
  let cursor;
  do {
    const options = cursor ? { prefix, cursor } : { prefix };
    const listed = await env.REPORTS.list(options);
    await Promise.all((listed.keys || []).map((key) => env.REPORTS.delete(key.name)));
    if (listed.list_complete) return;
    if (!listed.cursor || listed.cursor === cursor) {
      throw new Error(`KV list cursor did not advance for prefix: ${prefix}`);
    }
    cursor = listed.cursor;
  } while (true);
}

// GET /api/customers — 顧客一覧
async function handleListCustomers(env) {
  const index = (await readJSON(env, 'index/customers.json')) || { version: 1, customers: [] };
  return json({ customers: index.customers || [] });
}

// POST /api/customers {petName[, ownerSlug, template]} — 新規顧客作成
async function handleCreateCustomer(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return json({ error: 'invalid json' }, 400);
  }
  const petName = String(body.petName || '').trim();
  if (!petName) return json({ error: 'petName required' }, 400);
  const ownerSlug = body.ownerSlug ? String(body.ownerSlug) : '';
  if (ownerSlug && !isValidSlug(ownerSlug)) {
    return json({ error: 'invalid ownerSlug' }, 400);
  }

  // owner を指定する作成フローでは、書込開始前に両メタデータの存在を確認して orphan 化を防ぐ。
  let ownerDoc = null;
  let ownerIndex = null;
  let ownerEntry = null;
  if (ownerSlug) {
    ownerDoc = await readJSON(env, `owners/${ownerSlug}.json`);
    if (!ownerDoc) return json({ error: 'owner not found' }, 404);
    ownerIndex = (await readJSON(env, 'index/owners.json')) || { version: 1, owners: [] };
    ownerEntry = (ownerIndex.owners || []).find((owner) => owner.ownerSlug === ownerSlug);
    if (!ownerEntry) return json({ error: 'owner index inconsistent' }, 409);
  }

  const index = (await readJSON(env, 'index/customers.json')) || { version: 1, customers: [] };
  const existingSlugs = new Set((index.customers || []).map((c) => c.slug));

  let slug = generateSlug(petName);
  let guard = 0;
  while (existingSlugs.has(slug) && guard < 10) {
    slug = generateSlug(petName);
    guard += 1;
  }

  const nowISO = new Date().toISOString();
  const customerDoc = {
    version: 1,
    slug,
    petName,
    createdAt: nowISO,
    months: {},
    // ownerSlug/template: 指定があれば保存。未指定時は省略（後方互換）
    ...(ownerSlug ? { ownerSlug } : {}),
    ...(body.template ? { template: String(body.template) } : {}),
  };
  await writeJSON(env, `customers/${slug}.json`, customerDoc);

  index.customers = index.customers || [];
  index.customers.push({ slug, petName, createdAt: nowISO, lastReportMonth: null, reportCount: 0 });
  await writeJSON(env, 'index/customers.json', index);

  // ownerSlug が指定された場合、飼い主メタの pets に追加
  if (ownerSlug) {
    ownerDoc.pets = ownerDoc.pets || [];
    if (!ownerDoc.pets.find((pet) => pet.slug === slug)) {
      ownerDoc.pets.push({ slug, petName });
    }
    ownerEntry.petCount = ownerDoc.pets.length;
    await Promise.all([
      writeJSON(env, `owners/${ownerSlug}.json`, ownerDoc),
      writeJSON(env, 'index/owners.json', ownerIndex),
    ]);
  }

  return json({ slug, petName });
}

// GET /api/owners — 飼い主一覧
async function handleListOwners(env) {
  const index = (await readJSON(env, 'index/owners.json')) || { version: 1, owners: [] };
  return json({ owners: index.owners || [] });
}

// POST /api/owners {ownerName} — 飼い主新規作成
async function handleCreateOwner(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return json({ error: 'invalid json' }, 400);
  }
  const ownerName = String(body.ownerName || '').trim();
  if (!ownerName) return json({ error: 'ownerName required' }, 400);

  const index = (await readJSON(env, 'index/owners.json')) || { version: 1, owners: [] };
  const existingSlugs = new Set((index.owners || []).map((o) => o.ownerSlug));

  let ownerSlug = generateOwnerSlug(ownerName);
  let guard = 0;
  while (existingSlugs.has(ownerSlug) && guard < 10) {
    ownerSlug = generateOwnerSlug(ownerName);
    guard += 1;
  }

  const nowISO = new Date().toISOString();
  const ownerDoc = { version: 1, ownerSlug, ownerName, createdAt: nowISO, pets: [] };
  await writeJSON(env, `owners/${ownerSlug}.json`, ownerDoc);

  index.owners = index.owners || [];
  index.owners.push({ ownerSlug, ownerName, petCount: 0, createdAt: nowISO });
  await writeJSON(env, 'index/owners.json', index);

  return json({ ownerSlug, ownerName });
}

// GET /api/reports/{slug}/{reportId} — レポート 1 件取得（犬別データ読み出し）
async function handleGetReport(env, slug, reportId) {
  if (!slug || !reportId) return json({ error: 'slug and reportId required' }, 400);
  if (!isValidSlug(slug)) return json({ error: 'invalid slug' }, 400);
  if (!isValidReportId(reportId)) return json({ error: 'invalid reportId' }, 400);
  const entry = await readJSON(env, `reports/${slug}/${reportId}.json`);
  if (!entry) return json({ error: 'report not found' }, 404);
  return json(entry);
}

// POST /api/reports {slug, date, year, report[, ownerSlug, template]} — レポート追加
async function handleAddReport(request, env, url) {
  let body;
  const raw = await request.text();
  if (raw.length > 5 * 1024 * 1024) return json({ error: 'payload too large' }, 413);
  try {
    body = JSON.parse(raw);
  } catch (_e) {
    return json({ error: 'invalid json' }, 400);
  }
  const slug = String(body.slug || '').trim();
  if (!slug) return json({ error: 'slug required' }, 400);
  if (!isValidSlug(slug)) return json({ error: 'invalid slug' }, 400);
  if (body.ownerSlug && !isValidSlug(body.ownerSlug)) return json({ error: 'invalid ownerSlug' }, 400);
  if (!body.report || typeof body.report !== 'object' || Array.isArray(body.report)) {
    return json({ error: 'report required' }, 400);
  }

  const doc = await readJSON(env, `customers/${slug}.json`);
  if (!doc) return json({ error: 'customer not found' }, 404);

  // ownerSlug / template が渡された場合は customers/{slug}.json に保存（上書き可）
  if (body.ownerSlug) doc.ownerSlug = String(body.ownerSlug);
  if (body.template) doc.template = String(body.template);

  const publishedAt = new Date().toISOString();
  // 既存 reportId が渡された場合は「上書き更新」。無ければ新規発行。
  const isUpdate = !!body.reportId;
  if (isUpdate && !isValidReportId(body.reportId)) {
    return json({ error: 'invalid reportId' }, 400);
  }
  const reportId = isUpdate ? String(body.reportId) : generateReportId();
  if (isUpdate && !(await readJSON(env, `reports/${slug}/${reportId}.json`))) {
    return json({ error: 'report not found' }, 404);
  }
  const month = monthKeyFromDate(body.date, publishedAt);

  // レポート実体（写真込み）は個別キーに保存（KV 25MB/値 上限回避）。
  // 既存 reportId 指定時は同キーを上書きする。
  await writeJSON(env, `reports/${slug}/${reportId}.json`, {
    reportId,
    date: String(body.date || ''),
    year: String(body.year || ''),
    publishedAt,
    report: body.report,
  });

  // 顧客メタには reportId 一覧のみ追加（軽量・写真なし）
  doc.months = doc.months || {};
  // 更新時は全月から同一 reportId の既存エントリを除去（重複防止・日付変更による月移動にも対応）。
  // 他 reportId には一切触れない。
  if (isUpdate) {
    for (const mk of Object.keys(doc.months)) {
      doc.months[mk] = (doc.months[mk] || []).filter((e) => e.reportId !== reportId);
    }
  }
  doc.months[month] = doc.months[month] || [];
  doc.months[month].push({ reportId, date: String(body.date || ''), year: String(body.year || ''), publishedAt });
  // 空になった月キーを掃除
  for (const mk of Object.keys(doc.months)) {
    if (doc.months[mk].length === 0) delete doc.months[mk];
  }
  await writeJSON(env, `customers/${slug}.json`, doc);

  // index 更新（lastReportMonth / reportCount）
  const index = (await readJSON(env, 'index/customers.json')) || { version: 1, customers: [] };
  const entry = (index.customers || []).find((c) => c.slug === slug);
  if (entry) {
    const allMonths = Object.keys(doc.months).sort();
    entry.lastReportMonth = allMonths[allMonths.length - 1] || null;
    entry.reportCount = Object.values(doc.months).reduce((n, arr) => n + arr.length, 0);
    await writeJSON(env, 'index/customers.json', index);
  }

  const publicUrl = `${url.origin}/p/${slug}`;
  return json({ reportId, publicUrl });
}

// DELETE /api/customers/{slug} — 犬 1 頭をカスケード削除（冪等）
async function handleDeleteCustomer(env, slug) {
  if (!isValidSlug(slug)) return json({ error: 'invalid slug' }, 400);
  // 1. customers/{slug}.json を読む。無ければ冪等 200
  const customerDoc = await readJSON(env, `customers/${slug}.json`);
  if (!customerDoc) return json({ ok: true, already: true });
  const ownerSlug = customerDoc.ownerSlug || null;

  // 2. 当該犬の全レポートキーを列挙して削除
  await deleteAllByPrefix(env, `reports/${slug}/`);

  // 3. customers/{slug}.json を削除
  await env.REPORTS.delete(`customers/${slug}.json`);

  // 4. index/customers.json から除去
  const custIndex = (await readJSON(env, 'index/customers.json')) || { version: 1, customers: [] };
  custIndex.customers = (custIndex.customers || []).filter((c) => c.slug !== slug);
  await writeJSON(env, 'index/customers.json', custIndex);

  // 5. owners/{ownerSlug}.json の pets[] から除去
  if (ownerSlug) {
    const ownerDoc = await readJSON(env, `owners/${ownerSlug}.json`);
    if (ownerDoc) {
      ownerDoc.pets = (ownerDoc.pets || []).filter((p) => p.slug !== slug);
      await writeJSON(env, `owners/${ownerSlug}.json`, ownerDoc);
    }

    // 6. index/owners.json の petCount を 1 減らす（0 未満にしない）
    const ownIndex = (await readJSON(env, 'index/owners.json')) || { version: 1, owners: [] };
    const ownerEntry = (ownIndex.owners || []).find((o) => o.ownerSlug === ownerSlug);
    if (ownerEntry) {
      ownerEntry.petCount = Math.max(0, (ownerEntry.petCount || 0) - 1);
      await writeJSON(env, 'index/owners.json', ownIndex);
    }
  }

  return json({ ok: true });
}

// DELETE /api/owners/{ownerSlug} — 飼い主 1 名＋その犬を全カスケード削除（冪等）
async function handleDeleteOwner(env, ownerSlug) {
  if (!isValidSlug(ownerSlug)) return json({ error: 'invalid ownerSlug' }, 400);
  // 1. owners/{ownerSlug}.json を読む。無ければ冪等 200
  const ownerDoc = await readJSON(env, `owners/${ownerSlug}.json`);
  if (!ownerDoc) return json({ ok: true, already: true });
  const pets = ownerDoc.pets || [];

  // 2. 各 pet について犬カスケード削除
  //    index/owners.json の petCount 更新は最後に owners 行ごと除去するため不要。
  //    handleDeleteCustomer 内の petCount 更新も最終的に上書きされるが、
  //    customers/{slug}.json / index/customers.json / reports/* の削除は各呼出で完結させる。
  for (const pet of pets) {
    await deleteAllByPrefix(env, `reports/${pet.slug}/`);
    await env.REPORTS.delete(`customers/${pet.slug}.json`);
  }

  // 2b. index/customers.json から全 pet を一括除去
  if (pets.length > 0) {
    const slugSet = new Set(pets.map((p) => p.slug));
    const custIndex = (await readJSON(env, 'index/customers.json')) || { version: 1, customers: [] };
    custIndex.customers = (custIndex.customers || []).filter((c) => !slugSet.has(c.slug));
    await writeJSON(env, 'index/customers.json', custIndex);
  }

  // 3. owners/{ownerSlug}.json を削除
  await env.REPORTS.delete(`owners/${ownerSlug}.json`);

  // 4. index/owners.json から除去
  const ownIndex = (await readJSON(env, 'index/owners.json')) || { version: 1, owners: [] };
  ownIndex.owners = (ownIndex.owners || []).filter((o) => o.ownerSlug !== ownerSlug);
  await writeJSON(env, 'index/owners.json', ownIndex);

  return json({ ok: true });
}

// ASSETS から指定 HTML を取得するヘルパ
// env.ASSETS.fetch() には "http://assets/{path}" 形式の URL を渡す。
// request.url（Worker 自身の URL）をベースにすると dev で Worker ルーティングに
// 再帰して /edit 等が無限ループ/ハングする原因になるため使わない。
// "http://assets" はダミーオリジンで、Static Assets バインディングはパス部分のみを参照する。
async function fetchAssetHtml(env, htmlPath) {
  const assetUrl = 'http://assets' + htmlPath;
  let assetRes;
  try {
    assetRes = await env.ASSETS.fetch(new Request(assetUrl));
  } catch (e) {
    console.error('[fetchAssetHtml] ASSETS.fetch error:', e);
    return null;
  }
  if (!assetRes.ok) {
    console.error('[fetchAssetHtml] ASSETS.fetch not ok:', assetRes.status, htmlPath);
    return null;
  }
  return assetRes.text();
}

function createAppStateScript({ screen, view = false, backend = null, owner = null, ownerList = null, pet = null, report = null }) {
  return (
    '<script>' +
    (view ? 'window.__VIEW__=true;' : '') +
    (backend ? `window.__BACKEND__='${backend}';` : '') +
    `window.__SCREEN__='${screen}';` +
    `window.__OWNER__=${safeJsonStr(owner)};` +
    `window.__OWNER_LIST__=${safeJsonStr(ownerList)};` +
    `window.__PET__=${safeJsonStr(pet)};` +
    `window.__REPORT__=${safeJsonStr(report)};` +
    '</script>'
  );
}

async function renderAppPage(env, state) {
  const templateHtml = await fetchAssetHtml(env, '/ponchi-v2.html');
  if (!templateHtml || !templateHtml.includes('</head>')) {
    console.error('[renderAppPage] valid template not found');
    return new Response('Template Not Found', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const injection = createAppStateScript(state);
  const supabaseScripts = state.backend === 'supabase'
    ? '<script src="/js/supabase-vendor.js"></script>' +
      '<script type="module" src="/js/supabase-auth.js"></script>' +
      '<script type="module" src="/js/supabase-staff.js"></script>'
    : '';
  const injectedHtml = templateHtml.replace('</head>', `${injection}${supabaseScripts}\n</head>`);
  return new Response(injectedHtml, { status: 200, headers: HTML_HEADERS });
}

// 月別メタ一覧を構築（新しい順）[{monthKey, reportId, date, heroThumb}]
function buildMonthsMeta(doc) {
  const months = doc.months || {};
  const result = [];
  const monthKeys = Object.keys(months).sort().reverse();
  for (const mk of monthKeys) {
    const metas = (months[mk] || []).slice().sort((a, b) =>
      String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    if (metas.length > 0) {
      const m = metas[0];
      // heroThumb は将来対応（KV 読取コスト回避のため customers/{slug}.json への保存設計）
      result.push({ monthKey: mk, reportId: m.reportId, date: m.date, heroThumb: m.heroThumb || null });
    }
  }
  return result;
}

// PET データオブジェクト構築（__PET__ 注入用）
function buildPetData(doc, months) {
  return {
    slug: doc.slug,
    petName: doc.petName,
    ownerSlug: doc.ownerSlug || null,
    months,
  };
}

// GET /o/{ownerSlug} — 飼い主 H1 ページ（ponchi-v2.html + __SCREEN__='owner' + __OWNER__ 注入）
async function handleOwnerPage(_request, env, ownerSlug) {
  const ownerDoc = await readJSON(env, `owners/${ownerSlug}.json`);
  if (!ownerDoc) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const ownerData = {
    ownerSlug: ownerDoc.ownerSlug,
    ownerName: ownerDoc.ownerName,
    pets: ownerDoc.pets || [],
  };

  return renderAppPage(env, { screen: 'owner', view: true, owner: ownerData });
}

// GET /p/{slug}、/p/{slug}/all、/p/{slug}/{reportId} — 閲覧ページ群（全て ponchi-v2.html 使用）
async function handlePublicPage(_request, env, slug, subPath) {
  // 顧客メタ取得
  const doc = await readJSON(env, `customers/${slug}.json`);
  if (!doc) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // /p/{slug}/all — アーカイブ画面
  if (subPath === 'all') {
    const months = buildMonthsMeta(doc);
    const petData = buildPetData(doc, months);
    return renderAppPage(env, { screen: 'archive', view: true, pet: petData });
  }

  // /p/{slug}/{reportId} — H3 月別カルテ
  if (subPath && subPath !== 'all') {
    const reportId = subPath;
    const entry = await readJSON(env, `reports/${slug}/${reportId}.json`);
    if (!entry || !entry.report) {
      return new Response('Report Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const reportData = entry.report;
    const months = buildMonthsMeta(doc);
    const petData = buildPetData(doc, months);
    return renderAppPage(env, { screen: 'report', view: true, pet: petData, report: reportData });
  }

  // /p/{slug} — H2 肉球画面（月別メタ注入）
  const months = buildMonthsMeta(doc);
  const petData = buildPetData(doc, months);
  return renderAppPage(env, { screen: 'paw', view: true, pet: petData });
}

// ─────────────────────────────────────────────────────────────────────────────
// 編集モード /edit/* ハンドラ群
// 閲覧(/p/*・/o/*)との違い: window.__VIEW__ を注入しない → ponchi-app.js が編集モードで起動
// ─────────────────────────────────────────────────────────────────────────────

// GET /edit — 編集モード: 飼い主一覧画面（__SCREEN__='owner' + __OWNER_LIST__ 注入）
async function handleEditIndex(_request, env) {
  const ownersIndex = (await readJSON(env, 'index/owners.json')) || { version: 1, owners: [] };
  const ownerList = ownersIndex.owners || [];
  return renderAppPage(env, { screen: 'owner', ownerList });
}

// GET /edit/o/{ownerSlug} — 編集モード: 飼い主の犬一覧（__SCREEN__='owner' + __OWNER__ 注入）
async function handleEditOwner(_request, env, ownerSlug) {
  const ownerDoc = await readJSON(env, `owners/${ownerSlug}.json`);
  if (!ownerDoc) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const ownerData = {
    ownerSlug: ownerDoc.ownerSlug,
    ownerName: ownerDoc.ownerName,
    pets: ownerDoc.pets || [],
  };

  return renderAppPage(env, { screen: 'owner', owner: ownerData });
}

// GET /edit/p/{slug} — 編集モード: 月一覧/新規作成導線（__SCREEN__='archive' + __PET__ 注入）
async function handleEditArchive(_request, env, slug) {
  const doc = await readJSON(env, `customers/${slug}.json`);
  if (!doc) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const months = buildMonthsMeta(doc);
  const petData = buildPetData(doc, months);
  return renderAppPage(env, { screen: 'archive', pet: petData });
}

// GET /edit/p/{slug}/{reportId} — 編集モード: 既存レポート編集（__SCREEN__='report' + __REPORT__ 注入、__VIEW__ なし）
async function handleEditReport(_request, env, slug, reportId) {
  const doc = await readJSON(env, `customers/${slug}.json`);
  if (!doc) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const entry = await readJSON(env, `reports/${slug}/${reportId}.json`);
  if (!entry || !entry.report) {
    return new Response('Report Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const months = buildMonthsMeta(doc);
  const petData = buildPetData(doc, months);
  // 編集モード: view=false（既定値）で __VIEW__ を付けない。
  return renderAppPage(env, { screen: 'report', pet: petData, report: entry.report });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ルート / は login（index.html）を配信する。
    // 4ページ動線の入口: login(index.html) → search.html → カルテ。
    // 旧実装は /edit へ 302（index.html 不在時の暫定・A 残骸対策）。login ページ追加に伴い廃止。
    // dummy origin "http://assets" で Worker ルーティングへの再帰を避ける（fetchAssetHtml と同方針）。
    if (path === '/' || path === '') {
      return env.ASSETS.fetch(new Request('http://assets/index.html'));
    }

    // 公開疎通
    if (path === '/api/ping') {
      return json({ ok: true }, 200, cors);
    }

    if (env.DATA_BACKEND === 'supabase') {
      return handleSupabaseMode(request, env, url, cors);
    }

    // KV モードのバックエンド告知。supabase-auth.js の bootLoginPage() が
    // ログインページで必ず叩く。Supabase モードにしか実装が無いと 404 が返り、
    // クライアントは正しく諦めるがコンソールにはエラーが残る（受入基準9が落ちる）。
    // 「supabase ではない」と答えるのが実態であり、黙って 404 を返すより正しい。
    if (path === '/api/config' && request.method === 'GET') {
      return json({ backend: 'kv' }, 200, cors);
    }

    // 編集モード: /edit、/edit/o/{ownerSlug}、/edit/p/{slug}、/edit/p/{slug}/{reportId}
    // GET のみ（POST/PUT は /api/* 経由）
    if (path === '/edit' || path === '/edit/') {
      return handleEditIndex(request, env);
    }
    if (path.startsWith('/edit/o/')) {
      const ownerSlug = decodeRouteRest(path, '/edit/o/');
      if (!isValidSlug(ownerSlug)) return new Response('Not Found', { status: 404 });
      return handleEditOwner(request, env, ownerSlug);
    }
    if (path.startsWith('/edit/p/')) {
      const rest = decodeRouteRest(path, '/edit/p/');
      if (!rest) return new Response('Not Found', { status: 404 });
      const parts = rest.split('/');
      const slug = parts[0];
      const reportId = parts[1] || null;
      if (parts.length > 2 || !isValidSlug(slug) || (reportId && !isValidReportId(reportId))) {
        return new Response('Not Found', { status: 404 });
      }
      if (reportId) {
        return handleEditReport(request, env, slug, reportId);
      }
      return handleEditArchive(request, env, slug);
    }

    // 飼い主 H1 ページ: /o/{ownerSlug}
    if (path.startsWith('/o/')) {
      const ownerSlug = decodeRouteRest(path, '/o/');
      if (!isValidSlug(ownerSlug)) return new Response('Not Found', { status: 404 });
      return handleOwnerPage(request, env, ownerSlug);
    }

    // 公開閲覧: /p/{slug}、/p/{slug}/all、/p/{slug}/{reportId}
    // KV route が Pages より優先されるため、HTML 注入配信はここで完結する。
    if (path.startsWith('/p/')) {
      const rest = decodeRouteRest(path, '/p/');
      if (!rest) return new Response('Not Found', { status: 404 });
      const parts = rest.split('/');
      const slug = parts[0];
      const subPath = parts[1] || null; // null=インデックス, "all"=アーカイブ, "{reportId}"=H3
      if (
        parts.length > 2 ||
        !isValidSlug(slug) ||
        (subPath && subPath !== 'all' && !isValidReportId(subPath))
      ) {
        return new Response('Not Found', { status: 404 });
      }
      return handlePublicPage(request, env, slug, subPath);
    }

    // API: 犬削除（カスケード・無認証）: DELETE /api/customers/{slug}
    if (path.startsWith('/api/customers/') && request.method === 'DELETE') {
      const slug = decodeRouteRest(path, '/api/customers/');
      if (!slug) return json({ error: 'slug required' }, 400, cors);
      if (!isValidSlug(slug)) return json({ error: 'invalid slug' }, 400, cors);
      const r = await handleDeleteCustomer(env, slug);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: 顧客 1 件取得（無認証）: /api/customers/{slug}
    if (path.startsWith('/api/customers/') && request.method === 'GET') {
      const slug = decodeRouteRest(path, '/api/customers/');
      if (!slug) return json({ error: 'slug required' }, 400, cors);
      if (!isValidSlug(slug)) return json({ error: 'invalid slug' }, 400, cors);
      const doc = await readJSON(env, `customers/${slug}.json`);
      if (!doc) return json({ error: 'not found' }, 404, cors);
      return json(doc, 200, cors);
    }

    // API: 顧客一覧（無認証）
    if (path === '/api/customers' && request.method === 'GET') {
      const r = await handleListCustomers(env);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: 顧客作成（無認証）
    if (path === '/api/customers' && request.method === 'POST') {
      const r = await handleCreateCustomer(request, env);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: 飼い主削除（カスケード・無認証）: DELETE /api/owners/{ownerSlug}
    if (path.startsWith('/api/owners/') && request.method === 'DELETE') {
      const ownerSlug = decodeRouteRest(path, '/api/owners/');
      if (!ownerSlug) return json({ error: 'ownerSlug required' }, 400, cors);
      if (!isValidSlug(ownerSlug)) return json({ error: 'invalid ownerSlug' }, 400, cors);
      const r = await handleDeleteOwner(env, ownerSlug);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: 飼い主一覧（無認証）
    if (path === '/api/owners' && request.method === 'GET') {
      const r = await handleListOwners(env);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: 飼い主作成（無認証）
    if (path === '/api/owners' && request.method === 'POST') {
      const r = await handleCreateOwner(request, env);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: レポート追加（無認証）
    if (path === '/api/reports' && request.method === 'POST') {
      const r = await handleAddReport(request, env, url);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    // API: レポート 1 件取得（犬別データ読み出し）
    // /api/reports/{slug}/{reportId}
    if (path.startsWith('/api/reports/') && request.method === 'GET') {
      const rest = decodeRouteRest(path, '/api/reports/');
      if (!rest) return json({ error: 'slug and reportId required' }, 400, cors);
      const parts = rest.split('/');
      const slug = parts[0];
      const reportId = parts[1] || '';
      if (parts.length !== 2) return json({ error: 'invalid report path' }, 400, cors);
      const r = await handleGetReport(env, slug, reportId);
      return new Response(r.body, { status: r.status, headers: { ...JSON_HEADERS, ...cors } });
    }

    return new Response('Not Found', { status: 404 });
  },
};

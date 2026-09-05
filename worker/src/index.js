// Trimmer System 公開 Worker
// **配るのは正UI `/index.html`**（旧 `ponchi-v2.html` は 6685df5 で削除済み・`deferred` #20）。
//
// **入口は1つ。** すべての要求は `handleSupabaseMode()` が受ける。
// 2026-09-02、旧 KV 版 Worker（`saltydog-report-worker`）を削除したのに伴い、
// KV モードの経路（無認証の `/api/customers` `/api/owners` `/api/reports`、
// `/p/*` `/o/*` `/edit/*` の KV 版、`readJSON`/`writeJSON` ほか26関数・513行）を
// すべて落とした（`D-20260902-62`）。**残すと、誰も通らない道に無認証の API が
// 生き続ける**——実際 2026-08-24 に workers.dev 経由で外から叩ける状態が見つかっている。
// データストアは Supabase のみ（`data-stores/supabase-data-store.js`）。

// 全閲覧ページは正UI `/index.html` を配る（テンプレート分岐なし）。
// 注入するのは `__REPORT__` の1つだけ（読む側の無い5つは 2026-08-27 に外した・`#21`）。

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
  updateShopSchema,
} from './api-schemas.js';
import { StoreError, SupabaseDataStore } from './data-stores/supabase-data-store.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
// HTML は毎回最新を配信（修正が実機に確実に届くようキャッシュさせない）
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
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

  /* 「次回のおすすめご来店時期」の既定日数・使用オプション一覧。書き換えは RLS
     `shops_admin_update` が店舗の管理者だけに絞る（一般スタッフの PATCH は upstream_rejected になる）。 */
  if (path === '/api/shop') {
    if (request.method === 'GET') return json({ shop: await store.getShop() }, 200, cors);
    if (request.method === 'PATCH') {
      const parsed = await parseJson(request, updateShopSchema);
      if (!parsed.ok) return invalidJsonResult(parsed, cors);
      return json({ shop: await store.updateShop(parsed.data) }, 200, cors);
    }
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
      /* 「次回のおすすめご来店時期」（マスター指示 2026-08-29・D-20260829-58）。
         読めなくてもカルテ本体は返す——欄が空になるだけにする。 */
      const shopDefaultRevisitDays = await store.getShopDefaultRevisitDays(pet.shop_id).catch(() => null);
      /* 体重の推移（マスター指示 2026-09-03）。**カルテ1枚には1回分しか入っていない**
         ので、横断して1本にしたものを添える。読めなくてもカルテ本体は返す。 */
      const weightHistory = await store.listWeightHistory(petId).catch(() => null);
      return json({
        report: {
          ...report,
          pet: { id: pet.id, name: pet.name, revisitDaysOverride: pet.revisit_days_override ?? null },
          shopDefaultRevisitDays,
          weightHistory,
        },
      }, 200, cors);
    }
  }

  // スタッフの「犬を選ぶ」画面（/edit）が使う、店舗の犬を飼い主名つきで直接一覧する口（F2）。
  if (path === '/api/pets' && request.method === 'GET') {
    return json({ pets: await store.listPetsWithOwner() }, 200, cors);
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
    /* 飼い主に紐付いたアカウントの確認と解除（D-20260824-30 の 9）。
       招待リンクは最初にクリックした Google アカウントに結び付くので、
       誤送信・転送で第三者が入ったときに外す手段が要る。
       RPC 側で「自店舗のスタッフか」を見る。 */
    if (parts.length === 4 && parts[3] === 'links') {
      if (request.method === 'GET') return json({ links: await store.listOwnerLinks(ownerId) }, 200, cors);
    }
    if (parts.length === 6 && parts[3] === 'links' && isUuid(parts[4]) && parts[5] === 'revoke') {
      if (request.method === 'POST') return json(await store.revokeOwnerLink(ownerId, parts[4]), 200, cors);
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
          if (request.method === 'GET') {
            /* ⑤確認も⑥飼い主と同じ「体重推移」を見る（同一レンダラ・マスター指定）。
               **取れなくてもカルテ本体は返す**——グラフがその回の1点に戻るだけにする
               （`shopDefaultRevisitDays` と同じ方針）。 */
            const [report, weightHistory] = await Promise.all([
              store.getReport(petId, reportId),
              store.listWeightHistory(petId).catch(() => null),
            ]);
            return json({ report: { ...report, weightHistory } }, 200, cors);
          }
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
          /* 確定済みカルテを直す（管理者画面の「カルテ修正」）。
             中身の形は新規作成と同じなので `updateReportSchema` を使い回す。 */
          if (parts[5] === 'revise') {
            const parsed = await parseJson(request, updateReportSchema);
            if (!parsed.ok) return invalidJsonResult(parsed, cors);
            await enforceRateLimit(store, 'report_write', request, env);
            return json({ report: await store.reviseReport(petId, reportId, parsed.data.data) }, 200, cors);
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
      /* データストアは Supabase だけ。`createDataStore()` という工場は、
         KV と Supabase を選び分けるために在った——選ぶ相手が消えたので外した
         （`D-20260902-62`）。既定値が `'kv'` だったため、`DATA_BACKEND` の
         設定漏れが**黙って KV に落ちる**造りでもあった。 */
      const store = new SupabaseDataStore({
        supabaseUrl: env.SUPABASE_URL,
        publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        accessToken: context?.accessToken,
        userId: context?.userId,
        fetchImpl: env.FETCH || fetch,
      });
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
  /* **トップページを、本物の唯一の入口にする**（マスター指示 2026-09-02:
     「入口は1つ、管理者ページが表示されるかされないかの差だけでいい」）。

     ここは長らく素の HTML を配るだけで、載っている「Google でログイン」は
     **ログインに繋がっていなかった**（押しても練習用の一覧へ進むだけ）。
     結果、ホーム画面のアイコンやブックマークから開いた人は、実在しない犬
     （ポンチ等）の画面に入り、本物のデータには一生たどり着けなかった。

     載せるのは認証の2本**だけ**。`supabase-staff.js` は載せない——あれは
     `/edit` 用で、`/` で起動すると即 `/edit` へ飛ばしてログイン画面が出ない。
     `window.__REPORT__` も入れない（`ui.js` が「お店の画面のはずなのに
     読めなかった」を判定する印であって、ここはお店の画面ではない）。 */
  if (path === '/' || path === '') {
    return renderLoginPage(env);
  }
  if (path === '/edit' || path === '/edit/' || SUPABASE_EDIT_PATH_PATTERN.test(path)) {
    /* `backend` は**捨ててはいけない**——`window.__BACKEND__` のほうは読む側が無くて
       外したが（`deferred` #21）、この値は `renderAppPage` が
       **Supabase 用のスクリプトを載せるかどうか**を決めるのに使う。
       いちど一緒に落として `/edit` が素の HTML になり、
       `test/supabase-store.test.mjs` が止めた。 */
    return renderAppPage(env, { backend: 'supabase' });
  }
  /* 管理者画面（マスター指示 2026-08-26）。器は `my.html` と同じく静的配信で、
     中身は `backend/js/supabase-admin.js` が実データから描く。
     **誰が入れるかはここでは見ない**——ログインしていない人・管理者でない人を
     弾くのは画面側（`role` は `/api/session` が返す）。器を配るだけの経路に
     認可を書くと、二重に判定する場所ができて食い違う。 */
  if (path === '/admin' || path === '/admin/' || path.startsWith('/admin/')) {
    return env.ASSETS.fetch(new Request('http://assets/admin.html'));
  }
  if (path === '/my' || path === '/my/' || path.startsWith('/my/')) {
    return env.ASSETS.fetch(new Request('http://assets/my.html'));
  }
  return env.ASSETS.fetch(new Request(`http://assets${path}${url.search}`));
}

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

/**
 * 画面に渡す状態を注入する。**いま渡すのは `__REPORT__` の1つだけ。**
 *
 * かつては `__VIEW__` `__BACKEND__` `__SCREEN__` `__OWNER__` `__OWNER_LIST__` `__PET__`
 * も出していたが、**読む側は1つも無かった**（`docs/deferred.md` #21・`A-5`）。
 * 読んでいたのは `6685df5`「古いUIをはがし…」で消えた `ponchi-app.js` /
 * `ponchi-engine.js` で、注入だけが残っていた。外す条件は「正UI の結線が固まってから」
 * で、F3 の結線が終わったので外した。
 *
 * **`__REPORT__` だけは生きている**——`src/js/ui.js` の `showReport()` が読み、
 * `backend/js/supabase-staff.js` が確定後に書き直す。ここを一緒に消すと
 * 「カルテ修正」が中身の無い画面になる。
 *
 * KV モードの経路は `owner` / `pet` を渡していたが、**それを読む画面はもう無い**
 * （KV は閉鎖のうえ残置・`D-20260823-09`）。切り戻しが要るときは `6685df5^` から
 * UI ごと戻すので、そのときこの注入も一緒に戻ることになる（`docs/deferred.md` #22）。
 */
function createAppStateScript({ report = null }) {
  return `<script>window.__REPORT__=${safeJsonStr(report)};</script>`;
}

/**
 * renderLoginPage(env) — トップページ（唯一の入口）を配る
 *
 * `renderAppPage` と器は同じ `index.html` だが、**載せるのは認証の2本だけ**。
 * 理由は呼び出し側のコメントに書いた。
 */
async function renderLoginPage(env) {
  const templateHtml = await fetchAssetHtml(env, '/index.html');
  if (!templateHtml || !templateHtml.includes('</head>')) {
    console.error('[renderLoginPage] valid template not found');
    return new Response('Template Not Found', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  /* `__ENTRY__` は「この HTML はログイン画面として配られた」の印。
     `index.html` は `/edit` でも使い回すので、印が無いと `supabase-auth.js` が
     `/edit` でもログイン画面として起動し、`/my` との往復ループになる。
     古典スクリプトなので、後から走る ES モジュールより必ず先に立つ。 */
  const scripts = '<script>window.__ENTRY__=true;</script>'
    + '<script src="/backend/js/supabase-vendor.js"></script>'
    + '<script type="module" src="/backend/js/supabase-auth.js"></script>';
  /* **業務の器は、入口には配らない。**
     `index.html` は `/`（入口）と `/edit`（スタッフの画面）で使い回している。
     そのため入口には**②カルテ検索・③カルテ作成・④顧客カルテの3画面と段のタブが
     まるごと載っており、未ログインの誰でも押して中へ入れた**
     ——犬のカード5件（架空の顧客名）とカルテの入力欄8個が、そのまま見えていた
     （2026-09-05・実機で確認）。

     `goToStep()` の関所は `__REPORT__` が在るときだけ効く。入口には注入しないので、
     **本物の入口では関所が1つも効いていない**。

     `/edit` から入口の道具を落としたのと**逆向き**に、入口からは業務の器を落とす。
     文書に無ければ、押しようがない（マスター指示 2026-09-05:
     「ふさぐというか、削除しろよ…消せば済むだろ」）。 */
  const entryOnly = stripAppMarkup(templateHtml);
  return new Response(entryOnly.replace('</head>', `${scripts}\n</head>`), {
    status: 200,
    headers: HTML_HEADERS,
  });
}

/**
 * 業務の器を落とす。入口（`/`）に配る `index.html` から、`/edit` 専用の器を消す。
 *
 * **消すのは2つだけ**——`screen-2` `screen-3` `screen-4` の3画面と、
 * そこへ連れて行く段のタブ（`data-step` が 2 以上）。
 * `screen-1`（ログイン）と `HOME`、`01 ログイン` タブは入口のものなので残す。
 * 目印が見つからなければ**何もしない**（黙って別のものを削らない・`D-10`）。
 */
export function stripAppMarkup(html) {
  let out = html;
  for (const id of ['screen-2', 'screen-3', 'screen-4']) {
    const start = out.indexOf(`id="${id}"`);
    if (start < 0) continue;
    const open = out.lastIndexOf('<section', start);
    if (open < 0) continue;
    /* `screen-3` は中に `<section>` を持つので、対応する閉じを数えて探す。 */
    let depth = 0;
    let i = open;
    let close = -1;
    while (i < out.length) {
      const nextOpen = out.indexOf('<section', i + 1);
      const nextClose = out.indexOf('</section>', i + 1);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth += 1; i = nextOpen; continue; }
      if (depth === 0) { close = nextClose; break; }
      depth -= 1;
      i = nextClose;
    }
    if (close < 0) continue;
    out = out.slice(0, open) + out.slice(close + '</section>'.length);
  }
  /* 段のタブ。`01 ログイン` は入口のものなので残す。 */
  for (let guard = 0; guard < 6; guard += 1) {
    const start = out.search(/<button[^>]*\sdata-step="[2-9]"/);
    if (start < 0) break;
    const end = out.indexOf('</button>', start);
    if (end < 0) break;
    out = out.slice(0, start) + out.slice(end + '</button>'.length);
  }
  return out;
}

/**
 * 入口の器を落とす。`/edit` に配る `index.html` から、`/` 専用の道具を消す。
 *
 * **消すのは3つだけ**——`data-entry-only` が付いた押しどころ（`01 ログイン` タブと
 * `HOME`）と、その行き先の `screen-1`。ほかは触らない。
 * 目印が見つからなければ**何もしない**（黙って別のものを削らない・`D-10`）。
 */
export function stripEntryMarkup(html) {
  let out = html;
  /* `<button ... data-entry-only ...>…</button>` を、開始から対応する `</button>` まで。 */
  for (let guard = 0; guard < 4; guard += 1) {
    const start = out.search(/<button[^>]*\sdata-entry-only[\s>]/);
    if (start < 0) break;
    const end = out.indexOf('</button>', start);
    if (end < 0) break;
    out = out.slice(0, start) + out.slice(end + '</button>'.length);
  }
  /* `<section ... id="screen-1" ...>…</section>` を丸ごと。
     入れ子の `</section>` が無いことは `src/index.html` で確認している。 */
  const secStart = out.search(/<section[^>]*\sid="screen-1"[\s>]/);
  if (secStart >= 0) {
    const secEnd = out.indexOf('</section>', secStart);
    if (secEnd >= 0) out = out.slice(0, secStart) + out.slice(secEnd + '</section>'.length);
  }
  return out;
}

async function renderAppPage(env, state) {
  /* 正UI（`src/index.html`）を配る。

     ここは `6685df5`「古いUIをはがし…」まで `/ponchi-v2.html` を読んでいたが、
     **その commit がテンプレート本体を削除していた**ため、`/edit` は
     `502 Template Not Found` を返す状態のまま放置されていた（`docs/deferred.md` #20）。
     `bad-scenarios-F3` #6 の9本のうち8本が `/edit` を開くので、ここが塞がっていた。

     スクリプトは**この場で注入する**（`src/index.html` に直接書かない）。
     `backend/js/supabase-auth.js` は **import しただけで起動する**
     （`data-portal` が無ければ `bootLoginPage()`）ので、静的配信の `/`＝
     `npm run walk` の経路に混ぜると F2 の合否そのものを壊す。
     注入なら `/edit` だけに載る。 */
  const templateHtml = await fetchAssetHtml(env, '/index.html');
  if (!templateHtml || !templateHtml.includes('</head>')) {
    console.error('[renderAppPage] valid template not found');
    return new Response('Template Not Found', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  /* **入口の器は、スタッフの画面には配らない。**
     `index.html` は `/`（入口）と `/edit`（スタッフの画面）で使い回している。
     入口の道具——`01 ログイン` タブ・`HOME`・`screen-1`（「Google でログイン」）——は
     `/edit` では**押しても何も起きない**（配線するのは `bootLoginPage()` で、
     それは `__ENTRY__` のときしか走らない）。

     はじめ、これを**画面側で実行時に隠していた**。ところが起動の途中で 401 に
     当たると隠す処理まで進めず、**死んだログイン画面が復活**した
     ——マスターが最初に報告した画面そのもの（2026-09-05・実機で再現）。
     隠すのをやめて、**配る時点で消す**。文書に無ければ、どの失敗経路でも復活しない
     （マスター指示 2026-09-05:「ふさぐというか、削除しろよ。お前がつくらなければ
       この世に存在していないのだから、消せば済むだろ」）。 */
  const withoutEntry = stripEntryMarkup(templateHtml);

  const injection = createAppStateScript(state);
  const supabaseScripts = state.backend === 'supabase'
    /* 置き場所は F1 で `src/js/` → `backend/js/` へ移った。
       vendor は `iife` で `globalThis.TrimmerSupabaseVendor` に載るので古典スクリプト、
       残り2本は ES モジュール（`bad-scenarios-F3` #10 で固定した繋ぎ方）。順序も同じ。 */
    ? '<script src="/backend/js/supabase-vendor.js"></script>' +
      '<script type="module" src="/backend/js/supabase-auth.js"></script>' +
      '<script type="module" src="/backend/js/supabase-staff.js"></script>'
    : '';
  const injectedHtml = withoutEntry.replace('</head>', `${injection}${supabaseScripts}\n</head>`);
  return new Response(injectedHtml, { status: 200, headers: HTML_HEADERS });
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
    // 動線の入口: login(index.html) → ログイン → 犬の一覧（/edit）。search.html は F2 で撤去した。
    //
    /* **配り先は Supabase 版 Worker（`shiota0823`）だけになった。**
       2026-09-02、旧 KV 版 Worker（`saltydog-report-worker`）を削除した
       （`D-20260902-62`）。以前はここに `DATA_BACKEND !== 'supabase'` の分岐があり、
       KV モード用に `/` を素の HTML のまま返していたが、その道はもう存在しない。 */

    // 公開疎通
    if (path === '/api/ping') {
      return json({ ok: true }, 200, cors);
    }

    return handleSupabaseMode(request, env, url, cors);
  },
};

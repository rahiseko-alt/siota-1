/**
 * options-human-fixture.mjs — ⑦使用オプションの検査が使う土台（サーバ・偽SDK・既定の応答）
 *
 * マスター指示 2026-09-01。
 * 「うまくできていると主張し続けているが、人間が操作してダメなら無意味だ」
 * 「受け入れ条件は人間と同じ操作をしてスクショで画像確認できることだ」
 *
 * **この検査は数字で合否を出さない。** 出すのは写真だけ。
 * 合否は人が写真を見て決める（`D-14` と同じ立て付け）。
 * 機械が数える「ボタンが N 個ある」は、`F-20260821-11` で一度
 * 「押せた＝届いた」と読み違えた種類の証拠なので、ここでは根拠にしない。
 *
 * ## 何をどう再現しているか
 *
 * 本番の `/edit` は **Worker が `dist/index.html` に script を3本注入して**配っている
 * （`worker/src/index.js` の `renderAppPage`）。`dist/index.html` をそのまま配ると
 * バックエンドが載らず、マスターが見ている画面とは別物になる。だからここでも
 * **同じ3本を同じ順で注入する**。
 *
 * 載るのは実物である:
 *   - `dist/js/ui.js`                     ← 画面を描く本体
 *   - `dist/backend/js/supabase-auth.js`  ← 認証
 *   - `dist/backend/js/supabase-staff.js` ← ④に `shopGroomingOptions` を渡す係
 *
 * 差し替えるのは**外の世界の2つだけ**:
 *   - Supabase の SDK（`supabase-vendor.js`）→ ログイン済みの体にする偽物
 *   - `/api/*` の応答 → パターンごとに変える
 *
 * こうすると「本物のコードに、パターンごとの外界を与えて、人が触る」形になる。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
/* 写真は追跡外に置く（`npm run walk` の `.human/` と同じ決まり）。
   絵は証拠であってソースではない——リポジトリに 19MB を積まない。 */
const SHOTS = path.join(ROOT, '.human', 'options');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

/* 本番 Worker と同じ注入（`worker/src/index.js:810-813`）。順序も同じ。
   ここがズレると、見ている画面がマスターの画面と別物になる。 */
const INJECTION = '<script>window.__REPORT__=null;</script>'
  + '<script src="/backend/js/supabase-vendor.js"></script>'
  + '<script type="module" src="/backend/js/supabase-auth.js"></script>'
  + '<script type="module" src="/backend/js/supabase-staff.js"></script>';

/** `/edit` 配下は本番と同じく index.html に script を注入して返す静的サーバ。 */
function startServer(port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (/^\/edit(\/|$)/i.test(url) || url === '/my') {
      const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
        .replace('</head>', `${INJECTION}\n</head>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      base: `http://127.0.0.1:${port}`,
      stop: () => new Promise((done) => server.close(done)),
    }));
  });
}

/* ログイン済みの体にする偽 SDK。`supabase-vendor.js` の代わりに配る。
   `createAuthClient` が要求するのは `createClient` だけ、`authorizedFetch` が
   要求するのは `auth.getSession()` だけ（`backend/js/supabase-auth.js:52,93`）。 */
const VENDOR_STUB = `
window.TrimmerSupabaseVendor = {
  createClient: function () {
    var session = { access_token: 'harness-token', user: { id: 'harness-user' } };
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
        getUser: function () { return Promise.resolve({ data: { user: session.user }, error: null }); },
        setSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
        signInWithOAuth: function () { return Promise.resolve({ data: {}, error: null }); },
        signOut: function () { return Promise.resolve({ error: null }); },
        onAuthStateChange: function () {
          return { data: { subscription: { unsubscribe: function () {} } } };
        }
      }
    };
  },
  QRCode: { toDataURL: function () { return Promise.resolve('data:image/png;base64,'); } }
};
`;

/* 実在しない犬と飼い主（`A-2`: 本物のお客さんの情報は使わない）。 */
const PET_ID = '11111111-1111-4111-8111-111111111111';
const PET_ID_2 = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const REPORT_ID = '44444444-4444-4444-8444-444444444444';

const NINE_OPTIONS = [
  '炭酸泉', 'マイクロバブル', 'ハーブパック', '泥パック', '薬用シャンプー',
  '歯磨き', '耳掃除', '爪やすり', '肉球ケア',
];

function pet(id, name, ownerName, months) {
  return {
    id, name, owner_id: OWNER_ID, template: 'standard',
    owners: { name: ownerName }, reports: months || [], revisit_days_override: null,
  };
}

const BASE_PETS = [
  pet(PET_ID, 'ハナ', 'テスト飼い主A', []),
  pet(PET_ID_2, 'ソラ', 'テスト飼い主B', [
    { id: REPORT_ID, report_date: '2026-08-10', status: 'final' },
  ]),
];

/**
 * 既定の `/api/*` 応答。パターンごとに `overrides` で一部だけ差し替える。
 * 値ではなく**関数**で持つ。遅延や失敗を差し込めるようにするため。
 */
function defaultRoutes() {
  return {
    '/api/config': () => ({ status: 200, body: { backend: 'supabase', supabaseUrl: 'http://127.0.0.1:0', publishableKey: 'sb_publishable_harness' } }),
    '/api/session': () => ({ status: 200, body: { memberships: [{ shop_id: 'shop-1', role: 'admin', active: true }] } }),
    '/api/pets': () => ({ status: 200, body: { pets: BASE_PETS } }),
    '/api/shop': () => ({ status: 200, body: { shop: { id: 'shop-1', name: 'テスト店', slug: 'test', default_revisit_days: 30, grooming_options: NINE_OPTIONS } } }),
    pet: (id) => ({ status: 200, body: { pet: BASE_PETS.find((p) => p.id === id) || BASE_PETS[0] } }),
    report: () => ({ status: 200, body: { report: { id: REPORT_ID, data: {}, assets: [], report_date: '2026-08-10', status: 'final' } } }),
    drafts: () => ({ status: 200, body: { drafts: [] } }),
  };
}


export { BASE_PETS, NINE_OPTIONS, OWNER_ID, PET_ID, PET_ID_2, REPORT_ID, defaultRoutes, startServer, VENDOR_STUB, SHOTS, DIST, ROOT };

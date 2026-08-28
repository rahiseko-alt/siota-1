/**
 * poison-stack.mjs — **何も動いていない世界**を立てる（毒見の土台）
 *
 * マスター指示（`D-20260828-53`）:
 *   「壊してみて赤にならないなら検査自体が壊れてるとするか」
 *
 * `docs/ops/proof-of-red.md` の182件を1件ずつ手で壊すのは現実的でないので、
 * **まとめて壊す**。土台（Supabase）の代わりに、**形だけ合っていて中身が空**の
 * 応答を返すサーバを置き、`SUPABASE_LOCAL_URL` をそこへ向ける。
 *
 * この世界では:
 *   ・ログインは**通る**（通らないと検査が入口で死に、中の検査を判定できない）
 *   ・データを引くと**必ず空**（犬も飼い主もカルテも写真も、1件も無い）
 *   ・書き込みは**受け取ったふりをして、何も残さない**
 *
 * **この世界では、すべての検査が赤にならなければおかしい。**
 * 緑のまま残った検査は「何も無くても通る検査」＝ `docs/watch.md` W-1 の型そのもの。
 *
 * **Docker は要らない**（`supabase start` の代わりだから）。この環境で走る。
 *
 *   node scripts/poison-run.mjs
 */

import http from 'node:http';

/** 本物と同じ形の、しかし中身の無いログイン応答。
    `passwordLogin()` は `res.ok` と JSON しか見ないので、これで通る。
    **本物の鍵ではない**（署名もされていない）——A-1 の対象外。 */
function emptySession(email) {
  return {
    access_token: 'poison.not-a-real-token.empty-world',
    refresh_token: 'poison-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: '00000000-0000-0000-0000-000000000000', email, role: 'authenticated' },
  };
}

/**
 * 毒の種類。**1種類では足りない**——毒見の判定力は
 * 「その検査の対象が、その毒に依存しているか」で決まる（`F-20260828-50`）。
 *
 *   empty  … データが空。犬も飼い主もカルテも0件。**データを見る検査**を判定する
 *   noauth … ログインが通らない。**認証を見る検査**を判定する
 *
 * `empty` では `verify-stack` の「seed のアカウントで実ログインできる」が
 * 緑のまま残った——何を送っても通すサーバ相手だったため。`noauth` はそこを突く。
 */
export const FLAVORS = ['empty', 'noauth'];

/** 中身が空の世界を立てる。`{ url, stop }` を返す。 */
export function startPoisonStack({ port = 54321, flavor = 'empty' } = {}) {
  if (!FLAVORS.includes(flavor)) throw new Error(`知らない毒: ${flavor}（${FLAVORS.join(' / ')}）`);
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url.split('?')[0]}`);
    const send = (code, body) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        /* 検査はブラウザからも叩く。CORS で落ちると「土台が空だから赤」ではなく
           「繋がらないから赤」になり、**何を確かめたのか分からなくなる**。 */
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Expose-Headers': '*',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(200, {});

    const path = req.url.split('?')[0];

    /* 生きているふりだけする（`ensureLocalSupabaseRunning` の入口）。 */
    if (path === '/auth/v1/health') return send(200, { date: new Date().toISOString() });

    /* `noauth` の毒: **ログインを拒む。**
       「実ログインできる」と主張する検査は、ここで赤にならなければ嘘をついている。
       検査は入口で死ぬが、**死ぬこと自体が正しい**——認証が通らない世界で
       先へ進める検査こそ、認証を見ていない検査である。 */
    if (flavor === 'noauth' && path.startsWith('/auth/v1/')) {
      req.resume();
      return req.on('end', () => send(400, {
        error: 'invalid_grant',
        error_description: 'poison: この世界ではログインできない',
      }));
    }

    /* ログインは通す。通らないと検査が入口で死に、中を判定できない。 */
    if (path.startsWith('/auth/v1/token')) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      return req.on('end', () => {
        let email = 'poison@local.test';
        try { email = JSON.parse(raw || '{}').email || email; } catch { /* 形が違っても通す */ }
        send(200, emptySession(email));
      });
    }
    if (path.startsWith('/auth/v1/user')) return send(200, emptySession('poison@local.test').user);
    if (path.startsWith('/auth/v1/logout')) return send(204, {});

    /* データは**必ず空**。ここが毒見の本体。 */
    if (path.startsWith('/rest/v1/rpc/')) return send(200, null);
    if (path.startsWith('/rest/v1/')) {
      if (req.method === 'GET') return send(200, []);
      req.resume();
      return req.on('end', () => send(201, []));   /* 受け取ったふり。何も残さない */
    }

    /* Storage も空。一覧は0件、実体は無い。 */
    if (path.startsWith('/storage/v1/object/list')) { req.resume(); return req.on('end', () => send(200, [])); }
    if (path.startsWith('/storage/v1/')) { req.resume(); return req.on('end', () => send(200, {})); }

    req.resume();
    return req.on('end', () => send(200, {}));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${port}`,
      hits,
      stop: () => new Promise((r) => server.close(r)),
    }));
  });
}

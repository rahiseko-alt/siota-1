/**
 * scripts/lib/local-stack.mjs — Supabase モード verify:* 共通の土台
 *
 * `supabase start`（ローカルの実 Postgres/Auth/PostgREST/Storage）+
 * `wrangler dev --config worker/wrangler.local.toml`（それを指すローカル Worker）を
 * 組み合わせて、CLOUDFLARE_API_TOKEN もホスト済み Supabase の service role key も
 * 無しに実ログイン・実DB・実RLSの検証を行うための共通部品。
 *
 * 前提: Supabase は事前に（このプロセスの外で）起動しておくこと。
 * 接続先は `SUPABASE_LOCAL_URL` で差し替えられる（既定はローカルの `supabase start`）。
 * 5本の verify:* を毎回 Postgres ごと起動/停止するのは重いため、
 * 起動は `npm run verify:all`（または手動の `npx supabase start`）が1回だけ行う。
 *
 * `supabase/seed.sql` にある password login 専用のローカルテストアカウント:
 *   staff@local.test  — 店舗スタッフ（Local SALTY DOG）。飼い主ではない
 *   admin@local.test  — 店舗管理者
 *   owner-a@local.test — 犬 X/Y/Z の飼い主（スタッフではない）
 *   owner-b@local.test — 犬 Q の飼い主（スタッフではない）
 *   uninvited@local.test — どの犬にも紐付いていない飼い主
 *   staff-owner@local.test — **スタッフかつ飼い主**（本番のマスター自身と同じ形・D-20260823-06）
 * パスワードはどれも同じ: LocalOnly-Password-2026!（本番の秘密情報ではない）
 */

import { spawn } from 'node:child_process';
import net from 'node:net';

/* **接続先は差し替えられるようにする**（`D-20260825-44`）。

   ここを直書きにしていたため、`verify:*` は「`supabase start` が同じ機械で動いていること」
   を前提にするしかなく、**特定の一台の机の上でしか動かない検査**になっていた。
   マスターの環境（Windows）でも、エージェントのコンテナでも動かない。
   差し替え可能にすれば、同じ検査が CI のランナーからでも走る。

   既定値は従来どおり `supabase start` の既定ポート。何も設定しなければ挙動は変わらない。
   変数名 `SUPABASE_LOCAL_URL` は `.env.example:10` に**最初から在った**——使っていなかっただけ。 */
export const LOCAL_SUPABASE_URL = process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321';

/* ローカル用の publishable key。秘密情報ではない（`AGENTS.md` D-3 / A-1 の対象外）が、
   接続先を差し替えるなら鍵も一緒に差し替わらないと意味がないので、同じ扱いにする。 */
export const LOCAL_ANON_KEY = process.env.SUPABASE_LOCAL_ANON_KEY
  || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
export const LOCAL_PASSWORD = 'LocalOnly-Password-2026!';

export const FIXTURE = {
  shopId: '10000000-0000-0000-0000-000000000001',
  staffEmail: 'staff@local.test',
  adminEmail: 'admin@local.test',
  ownerAEmail: 'owner-a@local.test',
  ownerAOwnerId: '30000000-0000-0000-0000-0000000000a1',
  ownerBEmail: 'owner-b@local.test',
  ownerBOwnerId: '30000000-0000-0000-0000-0000000000b1',
  uninvitedEmail: 'uninvited@local.test',
  /* スタッフかつ飼い主。**この形はもう本番の前提ではない**——`D-20260904-66`
     （マスター判断 2026-09-04）で**1ログインアカウント＝1役割**に決まり、
     兼務は別アカウントを発行することになった。`/my` に留める救済も削除済み。
     それでも fixture を残しているのは、**「スタッフ権限があれば必ず作業画面へ」を
     試すのに、いちばんきつい形だから**（飼い主リンクも持つ人で確かめる）。
     `verify:screens` の 5〜8b がこの口座を使う。 */
  staffOwnerEmail: 'staff-owner@local.test',
  petX: '40000000-0000-0000-0000-0000000000a1', // owner-a
  petY: '40000000-0000-0000-0000-0000000000a2', // owner-a
  petZ: '40000000-0000-0000-0000-0000000000a3', // owner-a
  petQ: '40000000-0000-0000-0000-0000000000b1', // owner-b
};

/** ローカル Supabase（`supabase start`）が既に起動していることを確かめる。 */
export async function ensureLocalSupabaseRunning() {
  try {
    const res = await fetch(`${LOCAL_SUPABASE_URL}/auth/v1/health`);
    if (res.ok) return true;
  } catch { /* fallthrough */ }
  throw new Error(
    'ローカル Supabase が起動していない（または起動直後で安定していない）。\n'
    + `先に \`npx supabase start\` を実行し、\`curl ${LOCAL_SUPABASE_URL}/auth/v1/health\` が\n`
    + '応答することを確かめてから、この検査を実行すること。\n'
    + '\n'
    + 'コンテナは全部 healthy なのにここで落ちる場合は、Kong の上流キャッシュを疑う。\n'
    + '`supabase db reset` は auth / storage / realtime を作り直すが Kong はそのまま\n'
    + '残るため、Kong が古い IP を掴んだままになり /auth/v1/health が 502 を返す。\n'
    + '  docker restart supabase_kong_trimmer-system\n'
    + 'で直る（20秒ほどで 200 になる）。実際に1度これで詰まった。',
  );
}

/**
 * ローカルスタックの service_role key を `supabase status` から取る。
 *
 * **RLS を無視して見るためだけに使う。** 「消したはずの写真が本当に消えているか」は、
 * RLS 越しには確かめられない——犬を消すと `storage_path_staff` が false になり、
 * 残っていても残っていなくても同じ「見えない」になるからである。検査が
 * 「見えない＝消えた」で満足してしまうと、まさに直したい不具合を見逃す。
 *
 * ハードコードしないのは、リポジトリに service_role と名の付く鍵を置かないため
 * （ローカルの既定値は公開情報だが、本番の鍵と見分けにくい形で残したくない）。
 */
export async function localServiceRoleKey() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('npx', ['supabase', 'status', '-o', 'json'], {
    maxBuffer: 4 * 1024 * 1024,
  });
  const key = JSON.parse(stdout).SERVICE_ROLE_KEY;
  if (!key) throw new Error('supabase status から SERVICE_ROLE_KEY を読めなかった');
  return key;
}

/** password grant でアクセストークンを取る。ログイン画面はGoogle認証のみを表示するので、
 * これはテスト専用の裏口（`supabase/seed.sql` 冒頭のコメント参照）。 */
export async function passwordLogin(email, password = LOCAL_PASSWORD) {
  const res = await fetch(`${LOCAL_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: LOCAL_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * 対象ページに実ログインを注入する。
 *
 * **注入は入口（`/`）で行う。** 以前は「未ログインの `/my` を開いてから注入する」
 * 前提だったが、`/my` は未ログインだと入口へ出ていくようになったので、そこで
 * `evaluate` すると転送で実行文脈ごと消える（`Execution context was destroyed`）。
 * 入口は未ログインの人が居られる唯一の画面で、`bootLoginPage()` が
 * `TrimmerAuth.setSession` を公開している。
 *
 * 呼び出し側は、注入のあと目的の画面へ `goto` すること（`page.reload()` ではなく）。
 */
export async function injectSession(page, email, password = LOCAL_PASSWORD) {
  const session = await passwordLogin(email, password);
  /* **入口へ移ってから注入する。** 既にセッションが在るときは入口が `/my` へ
     送るが、下の `waitForFunction` は転送後の文書で評価し直されるので、
     どちらに居ても `TrimmerAuth` を掴める。転送と `goto` が競合しても
     行き先は同じなので飲む。 */
  /* **どこも開いていない頁では行き先を作れない。** `about:blank` のまま呼ばれると
     `new URL('/', 'about:blank')` が投げる（実測: `Invalid URL`）。
     何が足りないかを言って落とす——「Invalid URL」だけでは誰も追えない。 */
  const here = page.url();
  if (!/^https?:/.test(here)) {
    throw new Error(
      `セッションを注入できない: まだどのドメインも開いていない（現在地 "${here}"）。`
      + '注入は入口（/）で行うので、先に page.goto(`${BASE}/`) してから呼ぶこと。',
    );
  }
  await page.goto(new URL('/', here).href, { waitUntil: 'domcontentloaded' })
    .catch(() => { /* 転送と競合しても、下の待ちが結果を見る */ });
  await page.evaluate((s) => new Promise((resolve, reject) => {
    /* **待ち続けない。** 以前はここに時間切れが無く、`TrimmerAuth` を公開しない
       画面で呼ぶと**永久に待った**——CI では `verify:m6` がそこで固まり、
       15分後にジョブごとキャンセルされた（2026-09-05・実測）。
       **ハングは、赤より悪い**。何が足りなかったかを言って落ちる。 */
    const deadline = Date.now() + 20_000;
    const wait = () => {
      if (window.TrimmerAuth && typeof window.TrimmerAuth.setSession === 'function') {
        window.TrimmerAuth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token })
          .then(resolve, reject);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(
          `セッションを注入できない: ${location.pathname} が TrimmerAuth を公開していない。`
          + '（注入は入口 / で行う。そこで公開されないなら、bootLoginPage() が'
          + ' /api/config か supabase-vendor.js の読み込みで失敗している）',
        ));
        return;
      }
      setTimeout(wait, 100);
    };
    wait();
  }), session);
  /* **覚えた戻り先は捨てる。**
     入口へ来る途中で `/my` などを開いていると `post_auth_return` が積まれる。
     ここはログイン画面を人が押す代わりに**セッションを直に入れている**ので、
     その戻り先は検査の意図ではない——**意図は、この直後に呼び出し側が開く URL**。
     捨てないと、`restoreProtectedRoute` が覚えた先へ送り、狙った画面に着かない
     （実測: `verify:roundtrip` の飼い主側が `.magazine-container` を待って時間切れ）。
     招待（`pending_invitation`）は消さない——アプリが消化するのを見る検査が在る。 */
  await page.evaluate(() => sessionStorage.removeItem('post_auth_return'));
}

/**
 * スタッフとしてログインし、トリマー画面（/edit 配下）を開く。
 *
 * 未ログインのまま /edit を開いてからセッションを注入すると、`bootStaffPortal()` が
 * 「セッションが無い」と判断して入口へ飛ばす処理と、こちらの注入がレースする。
 * どちらが先に走るかで結果が変わる不安定な検査になるため、先に入口でセッションを
 * 作ってから目的の画面へ入る（ログインを省いているわけではない。順序を決めているだけ）。
 */
export async function openStaffPage(page, base, path = '/edit', email = 'staff@local.test') {
  /* 入口を開いてから注入する（`injectSession` の注記）。 */
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await injectSession(page, email);
  await page.goto(`${base}${path}`);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * ローカル Supabase を指す Worker を起動する。呼び出し側は必ず `stop()` を呼ぶこと
 * （プロセスグループごと止めないと wrangler(node)/workerd がポートを掴んだまま残る）。
 */
export async function startLocalWorker({ port = 8787, readyTimeoutMs = 90_000, config } = {}) {
  await ensureLocalSupabaseRunning();
  if (!await portIsFree(port)) {
    throw new Error(`ポート ${port} が塞がっている。前回の wrangler dev が残っていないか確認すること。`);
  }
  /* 配信元を差し替えられるようにする（`POISON_WRANGLER_CONFIG`）。
     毒見の3種類目「配信物が空」は、**配る側を空にしないと作れない**——
     土台（Supabase）をいくら壊しても、静的配信と未ログイン画面は変わらないため
     （`docs/ops/proof-of-red.md`「両方の毒でも判定できない15件」）。
     既定は従来どおり。何も設定しなければ挙動は変わらない。 */
  const cfg = config || process.env.POISON_WRANGLER_CONFIG || 'worker/wrangler.local.toml';
  const worker = spawn('npx', [
    'wrangler', 'dev',
    '--config', cfg,
    '--port', String(port),
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });

  let log = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker が ${readyTimeoutMs / 1000}s で起動しなかった\n${log}`)), readyTimeoutMs);
    const watch = (chunk) => {
      log += chunk;
      if (log.includes(`Ready on http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    };
    worker.stdout.on('data', (c) => watch(String(c)));
    worker.stderr.on('data', (c) => watch(String(c)));
    worker.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker が起動前に終了した (exit ${code})\n${log}`));
    });
  });

  async function stop() {
    if (worker.exitCode !== null || worker.signalCode !== null) return;
    const exited = new Promise((resolve) => worker.once('exit', resolve));
    try {
      process.kill(-worker.pid, 'SIGTERM');
    } catch {
      return;
    }
    const hammer = setTimeout(() => {
      try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* もう居ない */ }
    }, 5_000);
    await exited;
    clearTimeout(hammer);
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { stop().finally(() => process.exit(130)); });
  }

  await ready;
  return { base: `http://localhost:${port}`, stop };
}

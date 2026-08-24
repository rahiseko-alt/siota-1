/**
 * scripts/lib/local-stack.mjs — Supabase モード verify:* 共通の土台
 *
 * `supabase start`（ローカルの実 Postgres/Auth/PostgREST/Storage）+
 * `wrangler dev --config worker/wrangler.local.toml`（それを指すローカル Worker）を
 * 組み合わせて、CLOUDFLARE_API_TOKEN もホスト済み Supabase の service role key も
 * 無しに実ログイン・実DB・実RLSの検証を行うための共通部品。
 *
 * 前提: `supabase start` は事前に（このプロセスの外で）起動しておくこと。
 * 5本の verify:* を毎回 Postgres ごと起動/停止するのは重いため、
 * 起動は `npm run verify:all`（または手動の `npx supabase start`）が1回だけ行う。
 *
 * `supabase/seed.sql` にある password login 専用のローカルテストアカウント:
 *   staff@local.test  — 店舗スタッフ（Local SALTY DOG）。飼い主ではない
 *   admin@local.test  — 店舗管理者
 *   owner-a@local.test — 犬 X/Y/Z の飼い主（スタッフではない）
 *   owner-b@local.test — 犬 Q の飼い主（スタッフではない）
 *   uninvited@local.test — どの犬にも紐付いていない飼い主
 * パスワードはどれも同じ: LocalOnly-Password-2026!（本番の秘密情報ではない）
 */

import { spawn } from 'node:child_process';
import net from 'node:net';

export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
export const LOCAL_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
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
    + '先に `npx supabase start` を実行し、`curl http://127.0.0.1:54321/auth/v1/health` が\n'
    + '応答することを確かめてから、この検査を実行すること。',
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
 * 対象ページに実ログインを注入する。ページは `window.TrimmerAuth.setSession` を
 * 公開している状態（`supabase-auth.js`/`supabase-staff.js` の boot 完了後）まで待つ。
 * 呼び出し側で `page.reload()` して起動分岐をやり直させること。
 */
export async function injectSession(page, email, password = LOCAL_PASSWORD) {
  const session = await passwordLogin(email, password);
  await page.evaluate((s) => new Promise((resolve) => {
    const wait = () => {
      if (window.TrimmerAuth && typeof window.TrimmerAuth.setSession === 'function') {
        window.TrimmerAuth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }).then(resolve);
      } else {
        setTimeout(wait, 100);
      }
    };
    wait();
  }), session);
}

/**
 * スタッフとしてログインし、トリマー画面（/edit 配下）を開く。
 *
 * 未ログインのまま /edit を開いてからセッションを注入すると、`bootStaffPortal()` が
 * 「セッションが無い」と判断して /my へ飛ばす処理と、こちらの注入がレースする。
 * どちらが先に走るかで結果が変わる不安定な検査になるため、先に /my でセッションを
 * 作ってから目的の画面へ入る（ログインを省いているわけではない。順序を決めているだけ）。
 */
export async function openStaffPage(page, base, path = '/edit', email = 'staff@local.test') {
  await page.goto(`${base}/my`);
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
export async function startLocalWorker({ port = 8787, readyTimeoutMs = 90_000 } = {}) {
  await ensureLocalSupabaseRunning();
  if (!await portIsFree(port)) {
    throw new Error(`ポート ${port} が塞がっている。前回の wrangler dev が残っていないか確認すること。`);
  }
  const worker = spawn('npx', [
    'wrangler', 'dev',
    '--config', 'worker/wrangler.local.toml',
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

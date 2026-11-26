const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthError extends Error {
  constructor(status = 401, message = 'authentication required', retryAfterSeconds = null) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/* ██ Supabase に問い合わせる前の、安い足切り（review R6・前回 M4）。██

   以前は `/api/*` に届いた Bearer を**1本残らず** Supabase の `/auth/v1/user` へ回していた。
   でたらめな文字列を送り続けるだけで、こちらの Worker と Supabase の両方に
   1回ずつ往復を払わせられた（API4:2023・CWE-770）。

   ① **形を見る**: Supabase のアクセストークンは JWT（`ヘッダ.中身.署名` の3つの base64url）。
      形が違う・長すぎる・中身の `exp` が過ぎている、は問い合わせるまでもなく偽物か期限切れ。
      **ここでは署名を確かめない＝中身を信用しない。** 弾くためだけに読み、通すかどうかは
      今までどおり Supabase が決める（形が合っていても偽物なら Supabase が断る）。
   ② **失敗の回数を数える**: 形だけ真似た偽物は①を通るので、同じ IP（`CF-Connecting-IP`）
      から認証に失敗し続けたら、しばらく Supabase へ回さず 429 を返す。
      数える場所は Worker の isolate の中のメモリ。**新しいサービスも有料の機能も使わない**
      代わりに、isolate ごと・拠点ごとの数で、isolate が入れ替われば数え直しになる
      （「完全に止める」ではなく「1つの isolate が払う往復に上限を付ける」）。
      ログインしていない（Bearer が無い）要求は Supabase を呼ばないので数えない。 */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 8192;
/* Worker と Supabase の時計のずれで、まだ有効なものを弾かないための猶予。 */
const EXP_LEEWAY_SECONDS = 60;
export const AUTH_FAILURE_LIMIT = 60;
export const AUTH_FAILURE_WINDOW_MS = 5 * 60 * 1000;
/* 覚える IP の数の上限（メモリを食い尽くされないため）。超えたら古いものから忘れる。 */
const AUTH_FAILURE_MAX_ENTRIES = 10000;
const authFailures = new Map();

function decodeBase64UrlJson(segment) {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function looksLikeLiveJwt(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !JWT_PATTERN.test(token)) return false;
  let payload;
  try {
    payload = decodeBase64UrlJson(token.split('.')[1]);
  } catch {
    return false;
  }
  return Boolean(payload) && typeof payload === 'object'
    && Number.isFinite(payload.exp) && payload.exp + EXP_LEEWAY_SECONDS > nowSeconds;
}

function failureEntry(ip, now) {
  const entry = authFailures.get(ip);
  if (entry && entry.resetAt > now) return entry;
  if (entry) authFailures.delete(ip);
  return null;
}

function isAuthBlocked(ip, now = Date.now()) {
  if (!ip) return null;
  const entry = failureEntry(ip, now);
  if (!entry || entry.count < AUTH_FAILURE_LIMIT) return null;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

function recordAuthFailure(ip, now = Date.now()) {
  if (!ip) return;
  const entry = failureEntry(ip, now);
  if (entry) {
    entry.count += 1;
    return;
  }
  if (authFailures.size >= AUTH_FAILURE_MAX_ENTRIES) {
    authFailures.delete(authFailures.keys().next().value);
  }
  authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS });
}

export function readBearer(request) {
  const value = request.headers.get('Authorization') || '';
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

/* src/js/supabase-auth.js の同名関数と同じ契約。片方だけ変えないこと。 */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/my';
  const url = new URL(value, 'https://local.invalid');
  return /^\/(?:my|edit)(?:\/|$)/.test(url.pathname) ? `${url.pathname}${url.search}` : '/my';
}

function authConfig(env) {
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new AuthError(503, 'authentication unavailable');
  }
  if (!['https:', 'http:'].includes(url.protocol) || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new AuthError(503, 'authentication unavailable');
  }
  return { url: url.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY };
}

export async function resolveAuthContext(request, env, fetchImpl = fetch) {
  const accessToken = readBearer(request);
  if (!accessToken) throw new AuthError();
  const ip = request.headers.get('CF-Connecting-IP');
  const retryAfter = isAuthBlocked(ip);
  if (retryAfter) throw new AuthError(429, 'too many requests', retryAfter);
  if (!looksLikeLiveJwt(accessToken)) {
    recordAuthFailure(ip);
    throw new AuthError();
  }
  const config = authConfig(env);
  let response;
  try {
    response = await fetchImpl(`${config.url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: config.publishableKey,
      },
    });
  } catch {
    throw new AuthError(503, 'authentication unavailable');
  }
  /* Supabase 側の不調（5xx 等）は、送ってきた人の失敗として数えない。
     数えると、障害のあいだに本物の利用者まで 429 で締め出してしまう。 */
  if (!response.ok && response.status !== 401 && response.status !== 403) throw new AuthError();
  let user = null;
  if (response.ok) {
    try {
      user = await response.json();
    } catch {
      user = null;
    }
  }
  if (!USER_ID_PATTERN.test(user?.id || '')) {
    recordAuthFailure(ip);
    throw new AuthError();
  }
  return {
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    accessToken,
  };
}

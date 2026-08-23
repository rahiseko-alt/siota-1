const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthError extends Error {
  constructor(status = 401, message = 'authentication required') {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
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
  if (!response.ok) throw new AuthError();
  let user;
  try {
    user = await response.json();
  } catch {
    throw new AuthError();
  }
  if (!USER_ID_PATTERN.test(user?.id || '')) throw new AuthError();
  return {
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    accessToken,
  };
}

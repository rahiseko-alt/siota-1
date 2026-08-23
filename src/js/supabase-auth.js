import { hydrateAssetReferences } from './supabase-storage.js';
import { renderMagazine } from './magazine-view.js';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTES = [
  { name: 'pets', pattern: /^\/my\/?$/i },
  { name: 'pet', pattern: new RegExp(`^/my/pets/(${UUID_PATTERN})/?$`, 'i') },
  { name: 'report', pattern: new RegExp(`^/my/pets/(${UUID_PATTERN})/reports/(${UUID_PATTERN})/?$`, 'i') },
];
const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/my';
  const url = new URL(value, 'https://local.invalid');
  return /^\/my(?:\/|$)/.test(url.pathname) ? `${url.pathname}${url.search}` : '/my';
}

export function parseProtectedRoute(pathname) {
  for (const route of ROUTES) {
    const match = pathname.match(route.pattern);
    if (!match) continue;
    return { name: route.name, petId: match[1] || null, reportId: match[2] || null };
  }
  return null;
}

export function captureInvitationToken(
  search,
  {
    storage = globalThis.sessionStorage,
    history = globalThis.history,
    pathname = globalThis.location?.pathname || '/my',
  } = {},
) {
  const params = new URLSearchParams(search || '');
  const token = params.get('invite');
  if (token && INVITATION_TOKEN_PATTERN.test(token)) storage?.setItem('pending_invitation', token.toLowerCase());
  if (params.has('invite')) {
    params.delete('invite');
    const remaining = params.toString();
    history?.replaceState(null, '', `${pathname}${remaining ? `?${remaining}` : ''}`);
  }
  return token && INVITATION_TOKEN_PATTERN.test(token) ? token.toLowerCase() : null;
}

export async function createAuthClient(fetchImpl = fetch, vendor = globalThis.TrimmerSupabaseVendor) {
  const response = await fetchImpl('/api/config');
  if (!response.ok) throw new Error('設定を読み込めませんでした');
  const config = await response.json();
  if (config.backend !== 'supabase' || !vendor?.createClient) throw new Error('認証を開始できませんでした');
  return vendor.createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export async function signInWithGoogle(
  supabase,
  returnPath,
  { storage = globalThis.sessionStorage, origin = globalThis.location?.origin } = {},
) {
  storage?.setItem('post_auth_return', safeReturnPath(returnPath));
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/my`,
      scopes: 'openid email profile',
    },
  });
}

export async function restoreProtectedRoute(
  supabase,
  {
    pathname = globalThis.location?.pathname || '/my',
    search = globalThis.location?.search || '',
    storage = globalThis.sessionStorage,
  } = {},
) {
  const { data, error } = await supabase.auth.getSession();
  if (error) return { state: 'error', message: 'ログイン状態を確認できませんでした' };
  if (!data.session) return { state: 'signed-out', returnPath: safeReturnPath(`${pathname}${search}`) };
  const target = safeReturnPath(storage?.getItem('post_auth_return') || `${pathname}${search}`);
  storage?.removeItem('post_auth_return');
  return { state: 'signed-in', target, accessToken: data.session.access_token };
}

export async function authorizedFetch(supabase, path, options = {}, fetchImpl = fetch) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('authentication required');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetchImpl(path, { ...options, headers });
}

function show(element, visible) {
  if (element) element.hidden = !visible;
}

function setMessage(element, message) {
  if (element) element.textContent = message;
}

function renderPets(container, pets) {
  container.replaceChildren();
  for (const pet of pets) {
    const link = document.createElement('a');
    link.className = 'pet-card';
    link.dataset.testid = 'pet-card';
    link.href = `/my/pets/${encodeURIComponent(pet.id)}`;
    link.textContent = pet.name;
    container.append(link);
  }
}

function renderPet(container, pet) {
  container.replaceChildren();
  const heading = document.createElement('h2');
  heading.dataset.testid = 'pet-name';
  heading.textContent = pet.name;
  container.append(heading);
  const list = document.createElement('div');
  list.className = 'report-list';
  for (const report of pet.reports || []) {
    const link = document.createElement('a');
    link.href = `/my/pets/${encodeURIComponent(pet.id)}/reports/${encodeURIComponent(report.id)}`;
    link.textContent = report.report_date;
    list.append(link);
  }
  container.append(list);
}

/* トリマーの確認画面（ponchi-app.js の showPreview）と同じ renderMagazine() を使う
   （マスター指定: ⑤確認 と ⑥顧客ページ は同一レンダラ）。写真は asset:// マーカーの
   ままでは表示できないため、hydrateAssetReferences で署名付きダウンロードに解決してから渡す。 */
async function renderReport(container, report, supabase, siblingReports) {
  const hydrated = await hydrateAssetReferences(report.data || {}, report.assets || [], supabase);
  renderMagazine(container, {
    petName: report.pet?.name || '',
    reportDate: report.report_date || '',
    data: hydrated.data,
    siblingReports: siblingReports || [],
    currentReportId: report.id,
    linkBase: `/my/pets/${encodeURIComponent(report.pet_id || '')}/reports/`,
  }, {
    onBack: () => { location.href = `/my/pets/${encodeURIComponent(report.pet_id || '')}`; },
    backLabel: 'このわんちゃんのカルテ一覧へ戻る',
  });
}

async function loadProtectedResource(supabase, route, content) {
  let apiPath = '/api/my/pets';
  if (route.name === 'pet') apiPath = `/api/my/pets/${encodeURIComponent(route.petId)}`;
  if (route.name === 'report') apiPath = `/api/my/pets/${encodeURIComponent(route.petId)}/reports/${encodeURIComponent(route.reportId)}`;
  const response = await authorizedFetch(supabase, apiPath);
  if (!response.ok) throw new Error(response.status === 401 ? 'authentication required' : 'not available');
  const body = await response.json();
  if (route.name === 'pets') renderPets(content, body.pets || []);
  if (route.name === 'pet') renderPet(content, body.pet);
  if (route.name === 'report') {
    let siblings = [];
    try {
      const petResponse = await authorizedFetch(supabase, `/api/my/pets/${encodeURIComponent(route.petId)}`);
      if (petResponse.ok) siblings = ((await petResponse.json()).pet?.reports || []);
    } catch { /* タイムライン表示は補助情報。取得に失敗してもカルテ本体は表示する */ }
    await renderReport(content, body.report, supabase, siblings);
  }
}

export async function bootProtectedPortal() {
  const status = document.querySelector('[data-portal-status]');
  const loginPanel = document.querySelector('[data-login-panel]');
  const content = document.querySelector('[data-portal-content]');
  const loginButton = document.querySelector('[data-google-login]');
  const signOutButton = document.querySelector('[data-sign-out]');
  captureInvitationToken(location.search);
  try {
    const supabase = await createAuthClient();
    globalThis.TrimmerAuth = {
      client: supabase,
      setSession: (session) => supabase.auth.setSession(session),
    };
    const restored = await restoreProtectedRoute(supabase);
    if (restored.state === 'signed-out') {
      show(loginPanel, true);
      show(content, false);
      setMessage(status, 'Googleでログインしてください');
      loginButton.onclick = async () => {
        loginButton.disabled = true;
        const { error } = await signInWithGoogle(supabase, restored.returnPath);
        if (error) {
          loginButton.disabled = false;
          setMessage(status, 'ログインを完了できませんでした。もう一度お試しください');
        }
      };
      return;
    }
    if (restored.state === 'error') throw new Error(restored.message);
    if (restored.target !== `${location.pathname}${location.search}`) {
      location.replace(restored.target);
      return;
    }
    const route = parseProtectedRoute(location.pathname);
    if (!route) throw new Error('not available');
    let invitationMessage = '';
    const pendingInvitation = sessionStorage.getItem('pending_invitation');
    if (pendingInvitation) {
      try {
        const claimResponse = await authorizedFetch(supabase, '/api/invitations/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: pendingInvitation }),
        });
        invitationMessage = claimResponse.ok
          ? '初回登録が完了しました。このページをブックマークして毎日ご利用ください。'
          : 'この招待は使用済み・期限切れ・取消済み、または無効です。';
      } finally {
        sessionStorage.removeItem('pending_invitation');
      }
    }
    const sessionResponse = await authorizedFetch(supabase, '/api/session');
    if (!sessionResponse.ok) throw new Error('authentication required');
    const session = await sessionResponse.json();
    if ((session.ownerLinks || []).length === 0 && (session.memberships || []).length === 0) {
      setMessage(status, invitationMessage || '登録されたお客様情報が見つかりません');
      show(loginPanel, false);
      return;
    }
    if ((session.memberships || []).length > 0 && (session.ownerLinks || []).length === 0) {
      location.replace('/edit');
      return;
    }
    await loadProtectedResource(supabase, route, content);
    show(loginPanel, false);
    show(content, true);
    show(signOutButton, true);
    setMessage(status, invitationMessage);
    signOutButton.onclick = async () => {
      await supabase.auth.signOut();
      location.replace('/my');
    };
  } catch (error) {
    show(loginPanel, false);
    show(content, false);
    setMessage(status, error.message === 'authentication required' ? 'Googleでログインしてください' : '表示できません');
  }
}

async function bootLoginPage() {
  const button = document.querySelector('[data-entry-login]');
  if (!button) return;
  let response;
  try {
    response = await fetch('/api/config');
  } catch {
    return;
  }
  if (!response.ok) return;
  const config = await response.json();
  if (config.backend !== 'supabase') return;
  const vendorScript = document.createElement('script');
  vendorScript.src = '/js/supabase-vendor.js';
  await new Promise((resolve, reject) => {
    vendorScript.onload = resolve;
    vendorScript.onerror = reject;
    document.head.append(vendorScript);
  });
  const supabase = await createAuthClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    location.replace('/my');
    return;
  }
  button.href = '/my';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    await signInWithGoogle(supabase, '/my');
  });
  const note = document.querySelector('[data-demo-note]');
  if (note) note.textContent = 'Googleアカウントで安全にログインします';
}

if (typeof document !== 'undefined') {
  if (document.body?.dataset.portal === 'customer') bootProtectedPortal();
  else bootLoginPage();
}

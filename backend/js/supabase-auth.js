import { hydrateAssetReferences } from './supabase-storage.js';
import { renderMagazine } from './magazine-view.js';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTES = [
  { name: 'pets', pattern: /^\/my\/?$/i },
  { name: 'pet', pattern: new RegExp(`^/my/pets/(${UUID_PATTERN})/?$`, 'i') },
  { name: 'report', pattern: new RegExp(`^/my/pets/(${UUID_PATTERN})/reports/(${UUID_PATTERN})/?$`, 'i') },
];
const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

/* ログイン後に戻す先。オープンリダイレクト防止のため、同一オリジンの保護された
   内部ルート（飼い主の /my とトリマーの /edit）だけを通し、それ以外は /my に潰す。
   /edit を通すのは、スタッフが未ログインで /edit を開いた場合にログイン後そこへ
   戻すため。ここを /my だけにしていると、スタッフかつ飼い主のアカウント
   （D-20260823-06 で管理者を飼い主にも紐付けた＝マスター自身）が、ログイン後に
   飼い主画面へ着いてトリマー画面に戻れなくなる。 */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/my';
  const url = new URL(value, 'https://local.invalid');
  return /^\/(?:my|edit)(?:\/|$)/.test(url.pathname) ? `${url.pathname}${url.search}` : '/my';
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
  /* **先に積まれた戻り先を潰さない。**
     未ログインで `/edit/p/{petId}` を開くと `supabase-staff.js` がその URL を
     `post_auth_return` に積んで `/` へ送る。ところがここで無条件に上書きしていたので、
     入口の「Google でログイン」を押した瞬間に `/my` に化け、**ログインしても
     深い URL に戻れなかった**（2026-09-04・サブ検証の実機で再現）。
     `supabase-staff.js` のコメントが約束していたことが、実際には成立していなかった。
     既に積まれているなら、それが人の意図した行き先なので残す。 */
  const pending = storage?.getItem('post_auth_return');
  if (!pending) storage?.setItem('post_auth_return', safeReturnPath(returnPath));
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
  const reports = pet.reports || [];
  if (reports.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'まだカルテがありません。';
    container.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'report-list';
  for (const report of reports) {
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
    /* 次回のおすすめご来店時期（マスター指示 2026-08-29・D-20260829-58）。
       編集は⑤スタッフ側だけ——ここには `onRevisitDaysChange` を渡さない。 */
    revisitDaysOverride: report.pet?.revisitDaysOverride ?? null,
    shopDefaultRevisitDays: report.shopDefaultRevisitDays,
    /* 体重の推移（マスター指示 2026-09-03）。カルテ1枚には1回分しか入っていないので、
       worker が確定カルテを横断して組み立てたものを渡す。 */
    weightHistory: report.weightHistory,
  }, {
    onBack: () => { location.href = `/my/pets/${encodeURIComponent(report.pet_id || '')}`; },
    backLabel: 'このわんちゃんのカルテ一覧へ戻る',
  });
  showAssetFailures(container, hydrated.failed);
}

/* 読み込めなかった写真を、黙って消さずに見えるところへ出す（bad-scenarios-F3 #4）。
   件数だけを出し、保存先のパスは出さない——飼い主の画面に出す情報ではない。
   `renderMagazine` が器を作り直した**後**に差し込む。 */
function showAssetFailures(container, failed) {
  if (!container || !failed || failed.length === 0) return;
  const notice = document.createElement('p');
  notice.dataset.assetFailures = String(failed.length);
  notice.style.cssText = 'margin:0;padding:12px 16px;background:#fdf3f2;border-left:3px solid #d32f2f;'
    + 'color:#8c3b36;font-size:13px;line-height:1.8';
  notice.textContent = `写真を ${failed.length}枚 読み込めませんでした。`
    + '通信の状態を確かめて、ページを開き直してください。';
  container.prepend(notice);
}

async function loadProtectedResource(supabase, route, content) {
  let apiPath = '/api/my/pets';
  if (route.name === 'pet') apiPath = `/api/my/pets/${encodeURIComponent(route.petId)}`;
  if (route.name === 'report') apiPath = `/api/my/pets/${encodeURIComponent(route.petId)}/reports/${encodeURIComponent(route.reportId)}`;

  /* report ルートはタイムライン用に犬本体（兄弟レポート一覧）も要るが、補助情報でしか
     ないので、本体取得と並行に投げる（直列にすると往復が倍かかる）。 */
  const siblingsPromise = route.name === 'report'
    ? authorizedFetch(supabase, `/api/my/pets/${encodeURIComponent(route.petId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.pet?.reports || [])
      .catch(() => [] /* タイムライン表示は補助情報。取得に失敗してもカルテ本体は表示する */)
    : null;

  const response = await authorizedFetch(supabase, apiPath);
  if (!response.ok) throw new Error(response.status === 401 ? 'authentication required' : 'not available');
  const body = await response.json();
  if (route.name === 'pets') renderPets(content, body.pets || []);
  if (route.name === 'pet') renderPet(content, body.pet);
  if (route.name === 'report') {
    const siblings = await siblingsPromise;
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
  let supabase;

  /* **ログインパネルを出して、押せる状態にする。**
     signed-out の分岐と、セッションが失効した／飼い主リンクを外された後に
     catch へ落ちたときの**両方**から呼ぶ。以前は結線が signed-out 分岐にしか無く、
     「Googleでログインしてください」と出るのに**押すものが画面に無かった**
     （飼い主はほぼ空白の画面で手が無くなる）。 */
  const openLoginPanel = (message, returnPath) => {
    show(loginPanel, true);
    show(content, false);
    setMessage(status, message);
    if (!loginButton) return;
    loginButton.disabled = false;
    loginButton.onclick = async () => {
      loginButton.disabled = true;
      const { error } = await signInWithGoogle(supabase, returnPath);
      if (error) {
        loginButton.disabled = false;
        setMessage(status, 'ログインを完了できませんでした。もう一度お試しください');
      }
    };
  };

  try {
    supabase = await createAuthClient();
    globalThis.TrimmerAuth = {
      client: supabase,
      setSession: (session) => supabase.auth.setSession(session),
    };
    const restored = await restoreProtectedRoute(supabase);
    if (restored.state === 'signed-out') {
      sessionStorage.removeItem('auth_reload_once');
      openLoginPanel('Googleでログインしてください', restored.returnPath);
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
    /* **管理者を `/admin` へ強制的に飛ばすのをやめた**（マスター指示 2026-09-02:
       「入口は1つ、管理者ページが表示されるかされないかの差だけでいい」）。

       以前はここで管理者だけ別の画面へ送っていた（マスター指示 2026-08-26）。
       そのため**着く先が人によって変わり**、しかもトリマー画面から管理画面へ
       戻る道が1つも無かった（`/admin` へのリンクは画面に0件だった）ので、
       管理者は日々のカルテ画面と管理画面のどちらかにしか居られなかった。

       いまは**着く先は全員同じ**。管理画面へは、カルテ画面のヘッダーに
       管理者のときだけ出る「管理」から入る（`index.html` の `data-admin-link`）。 */
    /* **振り分けは「スタッフ権限を持つか / 持たないか」の1本**
       （マスター判断 2026-09-04・`D-20260904-66`）。

       以前は `ownerLinks === 0` も条件にしていた。**スタッフ権限を持ちながら、
       この店の顧客としても登録されている人**（兼務アカウント）だけを `/my` に
       留めるためで、`D-20260823-06` で私がそう作った形が前提だった。
       マスター判断は「レアケースだから想定する必要なし。別のアカウントを発行するから
       仕組みとして用意しない」——**1ログインアカウント＝1役割**。
       条件を足すほど、着く先が人によって変わって説明できなくなる。 */
    if ((session.memberships || []).length > 0) {
      location.replace('/edit');
      return;
    }
    /* **兼務者の救済は無くした**（`D-20260904-66`）。上の分岐で、スタッフ権限を
       持つ人は必ず作業画面へ行くので、ここへは**持たない人しか来ない**。
       持たない人に「カルテを書く」を出すのは嘘になる。 */
    await loadProtectedResource(supabase, route, content);
    sessionStorage.removeItem('auth_reload_once');
    show(loginPanel, false);
    show(content, true);
    show(signOutButton, true);
    setMessage(status, invitationMessage);
    signOutButton.onclick = async () => {
      await supabase.auth.signOut();
      /* **入口へ返す。** `/my` に留めると、飼い主の画面でログイン画面が出る形になり、
         「入口は `/` の1本」（マスター指示 2026-09-04）とちぐはぐになる。 */
      location.replace('/');
    };
  } catch (error) {
    /* セッション確認後（restored.state === 'signed-in'）にトークンが失効するなどして
       ここへ来た場合、ログインボタンはまだ結線されていない（それは signed-out 分岐でしか
       行わない）。ただの reload では、壊れた/失効したセッションが localStorage に
       残ったままだと restoreProtectedRoute() が再び signed-in と判定して同じ場所に
       戻ってしまう（詰み）。signOut() でセッションを消してから 1回だけ再読み込みし、
       signed-out 判定からやり直す。 */
    if (error.message === 'authentication required' && !sessionStorage.getItem('auth_reload_once')) {
      sessionStorage.setItem('auth_reload_once', '1');
      try { await supabase?.auth.signOut(); } catch { /* セッションが既に壊れていても reload は続ける */ }
      location.reload();
      return;
    }
    sessionStorage.removeItem('auth_reload_once');
    /* **2回目以降と、認証以外の失敗。** 前者は再読み込みでは抜けられないので、
       ここでログインパネルを出して押せるようにする（出さないと詰む）。
       後者は押しても直らないので、パネルは出さずに次の一手だけ伝える。 */
    if (error.message === 'authentication required') {
      openLoginPanel('Googleでログインしてください', `${location.pathname}${location.search}`);
      return;
    }
    show(loginPanel, false);
    show(content, false);
    setMessage(status, '表示できません。少し時間をおいて、このページを開き直してください');
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
  /* F1 で `/js/` → `/backend/js/` へ移した先。ここだけ参照が取り残されていて
     **本番で 404** になっていた（実測: `/js/supabase-vendor.js` → 404）。
     読み込みに失敗するとこの下の `await` が投げ、ログインボタンは
     何も繋がれないまま終わる。 */
  vendorScript.src = '/backend/js/supabase-vendor.js';
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
  /* **入口（`/`）のときだけログイン画面として起動する。**
     `index.html` は `/` と `/edit` の**両方**で使い回されているので、
     「`data-portal` が無い＝ログイン画面」という判定では `/edit` でも動いてしまう。
     実際そうなり、`/edit` で「もうログイン済みだから `/my` へ」と送り返し、
     `/my` が「お店の人だから `/edit` へ」と送り返す**往復ループ**になった
     （2026-09-02 の実測で発見。それまでは `[data-entry-login]` が存在せず
     この関数が即 return していたので、穴が表に出ていなかっただけ）。
     どちらの役目で配られたかは Worker が知っているので、印で伝えてもらう
     ——`renderLoginPage()` が `window.__ENTRY__` を立てる。 */
  else if (globalThis.__ENTRY__) bootLoginPage();
}

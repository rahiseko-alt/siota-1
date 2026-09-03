import { authorizedFetch, createAuthClient } from './supabase-auth.js';
import { hydrateAssetReferences, replaceDataUrlAssets, uploadReportAssets } from './supabase-storage.js';
import { renderMagazine } from './magazine-view.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STAFF_ROUTES = [
  { name: 'owners', pattern: /^\/edit\/?$/i },
  { name: 'owner', pattern: new RegExp(`^/edit/o/(${UUID})/?$`, 'i') },
  { name: 'pet', pattern: new RegExp(`^/edit/p/(${UUID})/?$`, 'i') },
  { name: 'report', pattern: new RegExp(`^/edit/p/(${UUID})/(${UUID})/?$`, 'i') },
];
let activeMembership = null;
let activeObjectUrls = [];

/* いま画面を移ろうとしているか。移動中に打ち切られた通信を「故障」と
   取り違えて人を驚かせないための印（`boot()` の失敗表示で使う）。 */
let leavingPage = false;
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('pagehide', () => { leavingPage = true; });
  globalThis.addEventListener('beforeunload', () => { leavingPage = true; });
}

export function parseStaffRoute(pathname) {
  for (const route of STAFF_ROUTES) {
    const match = pathname.match(route.pattern);
    if (!match) continue;
    return {
      name: route.name,
      ownerId: route.name === 'owner' ? match[1] : null,
      petId: route.name === 'pet' || route.name === 'report' ? match[1] : null,
      reportId: match[2] || null,
    };
  }
  return null;
}

function reportMonth(report) {
  return {
    monthKey: String(report.report_date || '').slice(0, 7),
    reportId: report.id,
    date: report.report_date,
    status: report.status,
  };
}

export function mapPet(pet) {
  return {
    id: pet.id,
    slug: pet.id,
    petName: pet.name,
    ownerId: pet.owner_id,
    ownerSlug: pet.owner_id,
    /* /api/pets（listPetsWithOwner）が owners(name) を embed しているときだけ入る。
       PostgREST は多対一の embed をオブジェクトで返す（配列ではない）。 */
    ownerName: (pet.owners && pet.owners.name) || undefined,
    template: pet.template,
    months: (pet.reports || []).map(reportMonth),
    /* 「次回のおすすめご来店時期」のこの犬だけの上書き（マスター指示 2026-08-29・
       D-20260829-58）。null = 上書き無し（店舗の既定日数を使う）。 */
    revisitDaysOverride: pet.revisit_days_override ?? null,
  };
}

export function mapOwner(owner) {
  return {
    id: owner.id,
    ownerSlug: owner.id,
    ownerName: owner.name,
    petCount: Array.isArray(owner.pets) ? owner.pets.length : undefined,
    pets: (owner.pets || []).map(mapPet),
  };
}

export function buildInvitationUrl(origin, token) {
  if (!/^[0-9a-f]{64}$/i.test(token || '')) throw new TypeError('invalid invitation token');
  return `${new URL(origin).origin}/my?invite=${encodeURIComponent(token.toLowerCase())}`;
}

async function readJson(client, path, options) {
  const response = await authorizedFetch(client, path, options);
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'authentication required' : 'not available');
    error.status = response.status;
    /* Worker は失敗の理由を `{ error: "…" }` で返しているのに、ここで捨てていたため
       呼び出し側は「何かに失敗した」しか分からなかった。トリマーに原因を出すには
       status だけでは足りない（429 と 413 と HEIC はどれも「公開失敗」になる）ので、
       本文も載せて渡す。表示に使うかどうかは呼び出し側が決める。 */
    try {
      const body = await response.clone().json();
      if (body && typeof body.error === 'string') error.reason = body.error;
    } catch (_) { /* 本文が JSON でないことは失敗時に普通に起きる。status だけで進む */ }
    throw error;
  }
  return response.json();
}

function ensureDialogStyles() {
  if (document.getElementById('supabase-management-styles')) return;
  const style = document.createElement('style');
  style.id = 'supabase-management-styles';
  style.textContent = '.supabase-dialog{max-width:560px;width:calc(100% - 32px);border:0;border-radius:20px;padding:24px;box-shadow:0 20px 70px rgba(50,30,70,.28);font-family:inherit}.supabase-dialog::backdrop{background:rgba(30,20,40,.45)}.supabase-dialog img{display:block;max-width:320px;width:100%;margin:16px auto}.supabase-dialog input[type="text"]{box-sizing:border-box;width:100%;padding:10px}.supabase-dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.supabase-dialog button{padding:10px 14px;border-radius:10px;border:1px solid #c9b8dc;background:#fff;cursor:pointer}.supabase-dialog button[data-primary]{background:#72518c;color:#fff}.supabase-staff-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #eee}.supabase-staff-row code{overflow:hidden;text-overflow:ellipsis}';
  document.head.append(style);
}

function newDialog(title) {
  ensureDialogStyles();
  const dialog = document.createElement('dialog');
  dialog.className = 'supabase-dialog';
  const heading = document.createElement('h2');
  heading.textContent = title;
  dialog.append(heading);
  document.body.append(dialog);
  return dialog;
}

function appendCloseButton(dialog, actions) {
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '閉じる';
  close.onclick = () => {
    dialog.querySelectorAll('input').forEach((input) => { input.value = ''; });
    dialog.close();
    dialog.remove();
  };
  actions.append(close);
}

async function createInvitationArtifact(body) {
  const response = await globalThis.TrimmerStaffApi.request('/api/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const invitation = response.invitation;
  const url = buildInvitationUrl(location.origin, invitation.token);
  const qrDataUrl = await globalThis.TrimmerSupabaseVendor.QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M', width: 320, margin: 2,
  });
  return { ...invitation, url, qrDataUrl };
}

async function showInvitationDialog(body, label) {
  const artifact = await createInvitationArtifact(body);
  const dialog = newDialog(`${label}の初回登録`);
  const explanation = document.createElement('p');
  explanation.textContent = '初回登録用です。有効期限24時間・1回のみ使用できます。毎日の閲覧には、登録後の「マイカルテ」をブックマークしてください。';
  const expiry = document.createElement('p');
  expiry.textContent = `有効期限: ${new Date(artifact.expiresAt).toLocaleString('ja-JP')}`;
  const qr = document.createElement('img');
  qr.src = artifact.qrDataUrl;
  qr.alt = `${label}の初回登録QRコード`;
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.readOnly = true;
  urlInput.value = artifact.url;
  urlInput.setAttribute('aria-label', '初回登録URL');
  const status = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'supabase-dialog-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.dataset.primary = 'true';
  copy.textContent = 'URLをコピー';
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(artifact.url);
      status.textContent = 'コピーしました。';
    } catch {
      urlInput.focus();
      urlInput.select();
      status.textContent = 'URLを選択しました。端末のコピー操作をご利用ください。';
    }
  };
  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.textContent = 'この招待を取消';
  revoke.onclick = async () => {
    revoke.disabled = true;
    try {
      await globalThis.TrimmerStaffApi.request(`/api/invitations/${encodeURIComponent(artifact.id)}/revoke`, {
        method: 'POST',
      });
      urlInput.value = '';
      qr.removeAttribute('src');
      status.textContent = '招待を取り消しました。このQRとURLは使用できません。';
      copy.disabled = true;
    } catch {
      revoke.disabled = false;
      status.textContent = '取消に失敗しました。もう一度お試しください。';
    }
  };
  actions.append(copy, revoke);
  appendCloseButton(dialog, actions);
  dialog.append(explanation, expiry, qr, urlInput, status, actions);
  /* 飼い主招待のときだけ、いま紐付いているアカウントを出す。
     招待リンクは**最初にクリックした Google アカウント**に結び付くので、
     誤送信・転送で第三者が先に開くと、その人が飼い主のカルテを永久に読める。
     外す手段がアプリのどこにも無く、復旧は飼い主ごと削除しかなかった
     ——それは犬もカルテも写真も道連れにする（D-20260824-30 の 9）。 */
  if (body.invitationType === 'owner' && body.ownerId) {
    dialog.append(await buildOwnerLinkSection(body.ownerId, label));
  }
  dialog.showModal();
}

/**
 * buildOwnerLinkSection(ownerId, label)
 * 「このカルテを見られるアカウント」と、その解除ボタン。
 * 解除された相手はその瞬間から /my で何も見られなくなる（RLS が link を要求する）。
 */
async function buildOwnerLinkSection(ownerId, label) {
  const section = document.createElement('div');
  section.className = 'supabase-owner-links';
  const heading = document.createElement('h3');
  heading.textContent = 'このカルテを見られるアカウント';
  section.append(heading);

  let links = [];
  try {
    const response = await globalThis.TrimmerStaffApi.request(`/api/owners/${encodeURIComponent(ownerId)}/links`);
    links = response.links || [];
  } catch {
    const failed = document.createElement('p');
    failed.textContent = '紐付きを読み取れませんでした。';
    section.append(failed);
    return section;
  }

  if (links.length === 0) {
    const none = document.createElement('p');
    none.textContent = 'まだ誰も登録していません。上のQR・URLを渡してください。';
    section.append(none);
    return section;
  }

  for (const link of links) {
    const row = document.createElement('div');
    row.className = 'supabase-staff-row';
    const who = document.createElement('code');
    who.textContent = link.user_id;
    const since = document.createElement('span');
    since.textContent = link.created_at ? new Date(link.created_at).toLocaleDateString('ja-JP') : '';
    const cut = document.createElement('button');
    cut.type = 'button';
    cut.textContent = '解除';
    cut.onclick = async () => {
      if (!globalThis.confirm(
        `${label} 様のカルテを、このアカウントから見られないようにします。\n`
        + '間違えて別の人が登録してしまったときに使ってください。\n\nよろしいですか？',
      )) return;
      cut.disabled = true;
      try {
        await globalThis.TrimmerStaffApi.request(
          `/api/owners/${encodeURIComponent(ownerId)}/links/${encodeURIComponent(link.user_id)}/revoke`,
          { method: 'POST' },
        );
        row.replaceChildren(Object.assign(document.createElement('span'), {
          textContent: '解除しました。このアカウントからは見られません。',
        }));
      } catch {
        cut.disabled = false;
        globalThis.alert('解除できませんでした。もう一度お試しください。');
      }
    };
    row.append(who, since, cut);
    section.append(row);
  }
  return section;
}

async function showStaffManager() {
  if (activeMembership?.role !== 'admin') return;
  const dialog = newDialog('スタッフ管理');
  const intro = document.createElement('p');
  intro.textContent = '管理者だけがスタッフ招待・権限変更・利用停止を行えます。';
  const inviteActions = document.createElement('div');
  inviteActions.className = 'supabase-dialog-actions';
  for (const role of ['staff', 'admin']) {
    const invite = document.createElement('button');
    invite.type = 'button';
    invite.textContent = role === 'admin' ? '管理者を招待' : 'スタッフを招待';
    invite.onclick = async () => {
      invite.disabled = true;
      try {
        await showInvitationDialog({ invitationType: 'staff', staffRole: role }, invite.textContent);
      } finally {
        invite.disabled = false;
      }
    };
    inviteActions.append(invite);
  }
  const list = document.createElement('div');
  const response = await globalThis.TrimmerStaffApi.request('/api/staff');
  for (const membership of response.staff || []) {
    const row = document.createElement('div');
    row.className = 'supabase-staff-row';
    const user = document.createElement('code');
    user.textContent = membership.user_id;
    const role = document.createElement('select');
    for (const value of ['staff', 'admin']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'admin' ? '管理者' : 'スタッフ';
      option.selected = membership.role === value;
      role.append(option);
    }
    const active = document.createElement('input');
    active.type = 'checkbox';
    active.checked = membership.active;
    active.setAttribute('aria-label', '有効');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '保存';
    save.onclick = async () => {
      save.disabled = true;
      try {
        await globalThis.TrimmerStaffApi.request(`/api/staff/${encodeURIComponent(membership.user_id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: role.value, active: active.checked }),
        });
        save.textContent = '保存済み';
      } catch (error) {
        save.disabled = false;
        save.textContent = error.status === 409 ? '最後の管理者は停止不可' : '再試行';
      }
    };
    row.append(user, role, active, save);
    list.append(row);
  }
  const closeActions = document.createElement('div');
  closeActions.className = 'supabase-dialog-actions';
  appendCloseButton(dialog, closeActions);
  dialog.append(intro, inviteActions, list, closeActions);
  dialog.showModal();
}

async function bootStaffPortal(PonchiApp) {
  const client = await createAuthClient();
  globalThis.TrimmerAuth = {
    client,
    setSession: (session) => client.auth.setSession(session),
  };
  globalThis.TrimmerStaffApi = {
    request: (path, options) => readJson(client, path, options),
  };

  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    sessionStorage.setItem('post_auth_return', location.pathname + location.search);
    location.replace('/my');
    return;
  }
  const session = await readJson(client, '/api/session');
  if ((session.memberships || []).length === 0) {
    location.replace('/my');
    return;
  }
  activeMembership = (session.memberships || [])[0] || null;

  /* **管理者にだけ、管理画面への入口を出す**（マスター指示 2026-09-02）。
     `my.html` の `data-staff-link` と同じ作り——隠しておいて、該当する人にだけ見せる。
     これまで `/admin` へのリンクは画面に1つも無く、トリマー画面に居る管理者は
     URL を手打ちしない限り管理画面へ行けなかった。 */
  if ((session.memberships || []).some((m) => m.role === 'admin')) {
    const adminLink = document.querySelector('[data-admin-link]');
    if (adminLink) adminLink.hidden = false;
  }

  const route = parseStaffRoute(location.pathname);
  if (!route) {
    location.replace('/edit');
    return;
  }
  if (route.name === 'owners') {
    /* /edit — 犬を直接一覧する（F2）。「飼い主を選ぶ」層を挟まない。 */
    const body = await readJson(client, '/api/pets');
    PonchiApp.show('owner', { petListFlat: (body.pets || []).map(mapPet) });
    return;
  }
  if (route.name === 'owner') {
    const body = await readJson(client, `/api/owners/${encodeURIComponent(route.ownerId)}`);
    PonchiApp.show('owner', { owner: mapOwner(body.owner) });
    return;
  }

  const petBody = await readJson(client, `/api/pets/${encodeURIComponent(route.petId)}`);
  const pet = mapPet(petBody.pet);
  globalThis.__REPORT_CONTEXT__ = Object.freeze({
    petId: pet.id,
    ownerId: pet.ownerId,
    petName: pet.petName,
  });
  if (route.name === 'pet') {
    /* 使用オプション（マスター指示・2026-08-31で復活）を④カルテ作成に出すため、
       店舗の一覧を先読みしておく。読めなくても犬の画面自体は出す
       ——欄が空（選べるオプション無し）になるだけにする。

       **ただし「読めなかった」と「1件も登録が無い」を同じ空にしない。**
       以前は `.catch(() => null)` で失敗を丸ごと握り潰していたため、401 でも
       409（2店舗に所属していて店舗を1つに決められない）でも 502 でも、画面は
       どれも「帯が消えた④」になり、**どこを直せばよいか誰にも分からなかった**。
       実際この形で5セッション原因を外し続けている。失敗したことだけは持ち回り、
       トリマーの画面に出す（`D-2`「保存しましたと出たのに保存できていない」の型）。 */
    let shopBody = null;
    let shopUnavailable = null;
    try {
      shopBody = await readJson(client, '/api/shop');
    } catch (error) {
      shopUnavailable = error.status === 409
        ? 'この端末のアカウントが複数の店舗に所属しているため、店舗を1つに決められません。'
        : `店舗の設定を読み込めませんでした（${error.status || '通信できません'}）。`;
    }
    PonchiApp.show('archive', {
      ...pet,
      shopGroomingOptions: (shopBody && shopBody.shop && shopBody.shop.grooming_options) || [],
      shopOptionsUnavailable: shopUnavailable,
    });
    return;
  }

  const [reportBody, shopBody] = await Promise.all([
    readJson(
      client,
      `/api/pets/${encodeURIComponent(route.petId)}/reports/${encodeURIComponent(route.reportId)}`,
    ),
    /* 「次回のおすすめご来店時期」の既定日数・使用オプション一覧（マスター指示
       2026-08-29・D-20260829-58 / 2026-08-31）。読めなくても⑤の他の項目は表示する
       ——欄が空になるだけにする。 */
    readJson(client, '/api/shop').catch(() => null),
  ]);
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  const hydrated = await hydrateAssetReferences(
    reportBody.report.data,
    reportBody.report.assets || [],
    client,
  );
  activeObjectUrls = hydrated.objectUrls;
  globalThis.__REPORT__ = { ...hydrated.data, reportId: reportBody.report.id };
  PonchiApp.show('report', {
    ...pet,
    reportId: route.reportId,
    shopDefaultRevisitDays: shopBody && shopBody.shop ? shopBody.shop.default_revisit_days : null,
    shopGroomingOptions: (shopBody && shopBody.shop && shopBody.shop.grooming_options) || [],
    /* 体重の推移（マスター指示 2026-09-03）。⑤確認と⑥飼い主は同一レンダラなので、
       同じものを渡さないと**スタッフの画面だけ点1つ**になる。 */
    weightHistory: reportBody.report.weightHistory || null,
  });
  if (globalThis.SaltyDogPonchi) globalThis.SaltyDogPonchi.applyReport(globalThis.__REPORT__);
}

/**
 * saveReport(petId, reportData) — ④保存・確定（`plan.md` 4-1 の結線表）
 *
 * 画面が作った中身を、飼い主に届く形にして残す。順序に意味がある:
 *
 *   1. `replaceDataUrlAssets` … 中身に混ざっている `data:image/…` を `asset://{id}` に置き換え、
 *      実体（Blob）を取り出す。**JSONB に画像そのものを入れない**
 *   2. `POST /api/pets/{petId}/reports` … まず `draft` として作る。この時点では飼い主に見えない
 *   3. `uploadReportAssets` … 実体を Storage へ上げ、`report_assets` に登録する
 *   4. `POST …/finalize` … `finalize_report` RPC。**写真が1枚でも登録されていなければ
 *      サーバが 409 `storage_incomplete` を返す**（`supabase-data-store.js:255`）。
 *      `D-2`「`null` 返却は必ず失敗として扱う」はサーバ側で既に守られている
 *
 * **握りつぶさない。** どの段で落ちても投げる。ここで黙ると
 * 「保存しました」と出たのに残っていない、が起きる（`D-2`・`bad-scenarios-F3` #1）。
 *
 * 戻り値は確定したカルテ。呼び出し側は**その id で画面を開き直す**こと——
 * 手元の値をそのまま出すと、届いたかどうかを見ないまま「届いた」と言うことになる
 * （`D-12`「押せた ではなく 同じ値で届いた で見る」）。
 */
/**
 * saveDraft(petId, reportId, reportData, reportDate) — 記入を下書きとして残す
 *
 * `bad-scenarios-F3.md` #15。トリマーの記入は DOM とメモリにしか無く、サーバに残るのは
 * 「確定」を押した後だけだった。カルテ画面の「戻る」は確認なしで遷移するので、
 * **誤タップ1回で数十分の記入が消える**。施術中のスリープ・着信・引っぱって更新でも
 * 同じで、しかも消えたことに気づけない（`D-20260824-30` の 1 と 7）。
 *
 * 下書きは `status = 'draft'` のまま置く。**飼い主には見えない**——
 * 見えたら「存在しない履歴」になる（`#16` がそれを毎回確かめる）。
 *
 * 写真は下書きの時点では Storage へ上げない。上げると、下書きを捨てたときに
 * 誰も回収できない孤児が残る（`#2` と同じ形）。`data:` のまま JSONB に置き、
 * **確定のときにまとめて上げる**。
 *
 * 戻り値は下書きの id。呼び出し側は次回からそれを渡すこと。
 */
async function saveDraft(petId, reportId, reportData, reportDate) {
  const api = globalThis.TrimmerStaffApi && globalThis.TrimmerStaffApi.request;
  if (typeof api !== 'function') throw new Error('下書きを保存できません');
  if (reportId) {
    const updated = await api(
      `/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(reportId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reportData }) },
    );
    if (!updated || !updated.report) throw new Error('下書きを保存できませんでした');
    return updated.report.id;
  }
  const created = await api(`/api/pets/${encodeURIComponent(petId)}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ petId, reportDate, data: reportData }),
  });
  if (!created || !created.report) throw new Error('下書きを作れませんでした');
  return created.report.id;
}

/** その犬の、確定していない下書きを1件返す（無ければ null）。 */
async function findDraft(petId) {
  const api = globalThis.TrimmerStaffApi && globalThis.TrimmerStaffApi.request;
  if (typeof api !== 'function') return null;
  const body = await api(`/api/pets/${encodeURIComponent(petId)}/reports`);
  const draft = (body.reports || []).find((report) => report.status === 'draft');
  if (!draft) return null;
  const full = await api(
    `/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(draft.id)}`,
  );
  return { id: draft.id, data: (full.report && full.report.data) || {} };
}

/** その犬の、いちばん新しい確定カルテを1件返す（1枚も無ければ null）。

    6枚目のカルテを「前回の続き」から書き始めるために使う（マスター指示 2026-09-03）。
    `findDraft()` と同じ形——一覧で1件に絞ってから、その id で全文を取り直す。

    **`asset://` は解決しない。** 引き継ぐのは爪・耳・歯・BCS・体格・犬体図の印だけで、
    写真は引き継がない（撮り直さずに確定すると、前回の写真が今回のカルテとして
    飼い主に届く）。見える URL へ直す必要が無いので、余計な往復もしない。 */
async function findLastFinalReport(petId) {
  const api = globalThis.TrimmerStaffApi && globalThis.TrimmerStaffApi.request;
  if (typeof api !== 'function' || !petId) return null;
  const body = await api(`/api/pets/${encodeURIComponent(petId)}/reports`);
  /* 日付の新しい順。同じ日に2枚あるときは、後から作られた方（id の大きい方）を採る
     ——一覧の並び順に頼らない（`D-9`「見た目の順に依存しない」）。 */
  const finals = (body.reports || [])
    .filter((report) => report.status === 'final')
    .sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || ''))
      || String(b.id || '').localeCompare(String(a.id || '')));
  const latest = finals[0];
  if (!latest) return null;
  const full = await api(
    `/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(latest.id)}`,
  );
  return {
    id: latest.id,
    date: latest.report_date || '',
    data: (full.report && full.report.data) || {},
  };
}

async function saveReport(petId, reportData, reportDate, draftId) {
  const client = globalThis.TrimmerAuth && globalThis.TrimmerAuth.client;
  const api = globalThis.TrimmerStaffApi && globalThis.TrimmerStaffApi.request;
  if (!client || typeof api !== 'function') throw new Error('保存できません（ログインし直してください）');

  const { data, assets } = await replaceDataUrlAssets(reportData);
  /* 下書きが在ればそれを確定させる。**新しく作らない**——作ると下書きが残り、
     次に開いたときに古い記入が蘇る（`#15` の 3 が見ているのはそこ）。 */
  const saved = draftId
    ? await api(
      `/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(draftId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) },
    )
    : await api(`/api/pets/${encodeURIComponent(petId)}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId, reportDate, data }),
    });
  const report = saved.report;
  if (!report || !report.id) throw new Error('カルテを作れませんでした');

  if (assets.length > 0) {
    await uploadReportAssets({ client, api, report, petId, assets });
  }

  const finalized = await api(
    `/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(report.id)}/finalize`,
    { method: 'POST' },
  );
  /* **器だけでなく番号まで見る。** 作る段（上の `!report.id`）と揃えた。
     番号が欠けたまま返すと、呼ぶ側が URL に `encodeURIComponent(null)` を
     埋めて**文字列 `"null"`** を作り、例外も出ないまま `/edit/p/{id}/null` へ
     進む（`F-20260828-59`）。`D-2` を塞いだのは「空が返る」場合だけだった。 */
  if (!finalized || !finalized.report || !finalized.report.id) throw new Error('カルテを確定できませんでした');
  return finalized.report;
}

/**
 * reviseReport(petId, reportId, reportData) — 確定済みカルテの上書き（管理者画面「カルテ修正」）
 *
 * `saveReport` との違いは**作らないこと**。すでに飼い主に届いているカルテの
 * 中身だけを差し替える。`reports_staff_update_draft` は draft しか許さないので、
 * 直接 PATCH ではなく `revise`（`revise_report` RPC）を通す。
 *
 * 写真は `saveReport` と同じで、先に実体を上げてから中身を差し替える——
 * 上げる前に `asset://` を書き込むと、参照先の無い印を飼い主に届けることになる。
 */
async function reviseReport(petId, reportId, reportData) {
  const client = globalThis.TrimmerAuth && globalThis.TrimmerAuth.client;
  const api = globalThis.TrimmerStaffApi && globalThis.TrimmerStaffApi.request;
  if (!client || typeof api !== 'function') throw new Error('保存できません（ログインし直してください）');

  const { data, assets } = await replaceDataUrlAssets(reportData);
  if (assets.length > 0) {
    await uploadReportAssets({ client, api, report: { id: reportId }, petId, assets });
  }
  const revised = await api(
    `/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(reportId)}/revise`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) },
  );
  if (!revised || !revised.report || !revised.report.id) throw new Error('カルテを直せませんでした');
  return revised.report;
}

globalThis.TrimmerSupabaseStaff = {
  /* ⑤確認 と ⑥顧客ページ は同一のレンダラを使う（マスター指定）。
     `ui.js` は古典スクリプトで ES モジュールを import できないので、
     backend 側が globalThis に載せて渡す（`bad-scenarios-F3` #10 で固定した繋ぎ方）。 */
  renderMagazine,
  saveReport,
  reviseReport,
  saveDraft,
  findDraft,
  findLastFinalReport,
  isAdmin: () => activeMembership?.role === 'admin',
  showOwnerInvitation: (ownerId, ownerName) => showInvitationDialog(
    { invitationType: 'owner', ownerId }, ownerName || '飼い主',
  ),
  showStaffManager,
  boot(PonchiApp) {
    /* **失敗を、必ず人に見える形で出す。**
       ここは長らく `.owner-list` を探して書き込んでいたが、その名前の要素は
       `src/index.html` に**1つも存在しない**（`grep -c owner-list src/index.html` → 0）。
       つまり起動に失敗しても画面には何も出ず、トリマーには「犬が1頭も出ない」
       「オプションの帯が無い」だけが見えていた。原因を5セッション追えなかったのは、
       ここが黙っていたからでもある（`D-7`「気をつけるでは守れない」）。
       器の名前に頼らず、必ず出るもので知らせる。 */
    bootStaffPortal(PonchiApp).catch((error) => {
      /* **画面を移っている最中の打ち切りで驚かせない。**
         次の画面へ進むと、まだ返ってきていない通信は `Failed to fetch` で
         中断される。これは故障ではない。実測（`verify:admin` の 9）で
         カルテ修正の正常な流れでも出ることを確認したので、移動中は黙る。 */
      if (leavingPage) return;
      globalThis.alert(
        'お店の画面を読み込めませんでした。\n\n'
        + '通信が届いていないか、ログインが切れています。\n'
        + '画面を上から下へ引いて読み込み直すか、一度ログインし直してください。\n\n'
        + `（${(error && error.message) || '理由不明'}）`,
      );
    });
  },
};

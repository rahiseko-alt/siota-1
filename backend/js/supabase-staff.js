import { authorizedFetch, createAuthClient } from './supabase-auth.js';
import { hydrateAssetReferences } from './supabase-storage.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STAFF_ROUTES = [
  { name: 'owners', pattern: /^\/edit\/?$/i },
  { name: 'owner', pattern: new RegExp(`^/edit/o/(${UUID})/?$`, 'i') },
  { name: 'pet', pattern: new RegExp(`^/edit/p/(${UUID})/?$`, 'i') },
  { name: 'report', pattern: new RegExp(`^/edit/p/(${UUID})/(${UUID})/?$`, 'i') },
];
let activeMembership = null;
let activeObjectUrls = [];

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
    PonchiApp.show('archive', pet);
    return;
  }

  const reportBody = await readJson(
    client,
    `/api/pets/${encodeURIComponent(route.petId)}/reports/${encodeURIComponent(route.reportId)}`,
  );
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  const hydrated = await hydrateAssetReferences(
    reportBody.report.data,
    reportBody.report.assets || [],
    client,
  );
  activeObjectUrls = hydrated.objectUrls;
  globalThis.__REPORT__ = { ...hydrated.data, reportId: reportBody.report.id };
  PonchiApp.show('report', { ...pet, reportId: route.reportId });
  if (globalThis.SaltyDogPonchi) globalThis.SaltyDogPonchi.applyReport(globalThis.__REPORT__);
}

globalThis.TrimmerSupabaseStaff = {
  isAdmin: () => activeMembership?.role === 'admin',
  showOwnerInvitation: (ownerId, ownerName) => showInvitationDialog(
    { invitationType: 'owner', ownerId }, ownerName || '飼い主',
  ),
  showStaffManager,
  boot(PonchiApp) {
    bootStaffPortal(PonchiApp).catch(() => {
      const target = document.querySelector('.owner-list');
      if (target) target.innerHTML = '<p class="owner-error">表示できません。</p>';
    });
  },
};

export class StoreError extends Error {
  constructor(status, code = 'store_error') {
    super('data request failed');
    this.name = 'StoreError';
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('invalid Supabase URL');
  return url.origin;
}

export class SupabaseDataStore {
  constructor({ supabaseUrl, publishableKey, accessToken, userId = null, fetchImpl = fetch }) {
    if (!publishableKey || !accessToken) throw new TypeError('Supabase credentials are required');
    this.backend = 'supabase';
    this.supabaseUrl = normalizeBaseUrl(supabaseUrl);
    this.publishableKey = publishableKey;
    this.accessToken = accessToken;
    this.userId = userId;
    /* Workers の fetch は、レシーバ付きで呼ぶと `TypeError: Illegal invocation` で落ちる。
       `this.fetchImpl(...)` はレシーバが SupabaseDataStore になるため、そのまま持つと
       本番の全 REST 呼び出しが失敗する（auth-context.js が無事なのは、あちらが
       `fetchImpl(...)` と裸で呼んでいるから）。ここで束ねてしまい、呼び出し側の
       書き方に依存させない。テストが差し込む偽の fetch は `this` を使わないので影響しない。 */
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.staffShopId = null;
  }

  async request(path, { method = 'GET', body, prefer } = {}) {
    if (!path.startsWith('/rest/v1/')) throw new TypeError('unsupported Supabase path');
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      apikey: this.publishableKey,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let response;
    try {
      response = await this.fetchImpl(`${this.supabaseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new StoreError(503, 'unavailable');
    }
    if (!response.ok) throw new StoreError(response.status, 'upstream_rejected');
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new StoreError(502, 'invalid_upstream_response');
    }
  }

  async getSessionContext(userId) {
    const encodedUser = encodeURIComponent(userId);
    const [memberships, ownerLinks] = await Promise.all([
      this.request(`/rest/v1/shop_memberships?select=shop_id,role,active&user_id=eq.${encodedUser}&active=eq.true`),
      this.request(`/rest/v1/owner_users?select=owner_id&user_id=eq.${encodedUser}`),
    ]);
    return { memberships, ownerLinks };
  }

  async listPets() {
    return this.request('/rest/v1/pets?select=id,shop_id,owner_id,name,template,active,created_at,updated_at&active=eq.true&order=created_at.desc');
  }

  /* スタッフ側の「犬を選ぶ」画面（/edit）用。飼い主を経由せず店舗の犬を直接一覧する（F2）。
     RLS（pets_staff_all）が店舗のスタッフにだけ全件を返す。owners(name) は PostgREST の
     embed 構文で、pets_owner_shop_fkey を辿って飼い主名を1回の問い合わせで取得する。 */
  async listPetsWithOwner() {
    return this.request(
      '/rest/v1/pets?select=id,shop_id,owner_id,name,template,active,created_at,owners(name)&active=eq.true&order=created_at.desc',
    );
  }

  one(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new StoreError(404, 'not_found');
    return rows[0];
  }

  /**
   * この利用者が所属する店舗を1つに決める。2つ以上あれば「どの店舗か」を決められないので 409。
   *
   * **`user_id` で必ず絞ること。** RLS の `memberships_authorized_select` は
   * `user_id = auth.uid() or private.is_shop_admin(shop_id)` なので、**管理者には店舗の
   * 全メンバー行が返る**。以前ここに `user_id` フィルタが無く、スタッフが2人になった
   * 瞬間に管理者だけが 409 になっていた——飼い主の新規作成・招待の発行と一覧・
   * スタッフ管理（＝退職者の停止）が全部使えなくなる。日々のカルテ作成は
   * この関数を通らないので、しばらく気づけない類の壊れ方だった。
   */
  async getStaffShopId() {
    if (this.staffShopId) return this.staffShopId;
    if (!this.userId) throw new StoreError(401, 'missing_user');
    const memberships = await this.request(
      `/rest/v1/shop_memberships?select=shop_id&user_id=eq.${encodeURIComponent(this.userId)}`
      + '&active=eq.true&order=created_at.asc&limit=2',
    );
    if (!Array.isArray(memberships) || memberships.length === 0) throw new StoreError(403, 'not_staff');
    if (memberships.length > 1) throw new StoreError(409, 'shop_selection_required');
    this.staffShopId = memberships[0].shop_id;
    return this.staffShopId;
  }

  async listOwners() {
    return this.request(
      '/rest/v1/owners?select=id,shop_id,name,active,created_at,updated_at&active=eq.true&order=created_at.desc',
    );
  }

  async getOwner(ownerId) {
    const encoded = encodeURIComponent(ownerId);
    const [owners, pets] = await Promise.all([
      this.request(`/rest/v1/owners?select=id,shop_id,name,active,created_at,updated_at&id=eq.${encoded}&limit=1`),
      this.request(`/rest/v1/pets?select=id,shop_id,owner_id,name,template,active,created_at,updated_at&owner_id=eq.${encoded}&active=eq.true&order=created_at.desc`),
    ]);
    return { ...this.one(owners), pets };
  }

  async createOwner(input) {
    const shopId = await this.getStaffShopId();
    const rows = await this.request('/rest/v1/owners?select=id,shop_id,name,active,created_at,updated_at', {
      method: 'POST',
      body: { shop_id: shopId, name: input.name },
      prefer: 'return=representation',
    });
    return this.one(rows);
  }

  async updateOwner(ownerId, input) {
    const rows = await this.request(
      `/rest/v1/owners?id=eq.${encodeURIComponent(ownerId)}&select=id,shop_id,name,active,created_at,updated_at`,
      { method: 'PATCH', body: input, prefer: 'return=representation' },
    );
    return this.one(rows);
  }

  async deleteOwner(ownerId) {
    const rows = await this.request(
      `/rest/v1/owners?id=eq.${encodeURIComponent(ownerId)}&select=id`,
      { method: 'DELETE', prefer: 'return=representation' },
    );
    this.one(rows);
    return { ok: true };
  }

  async listOwnerPets(ownerId) {
    return this.request(
      `/rest/v1/pets?select=id,shop_id,owner_id,name,template,active,created_at,updated_at&owner_id=eq.${encodeURIComponent(ownerId)}&active=eq.true&order=created_at.desc`,
    );
  }

  async getPet(petId) {
    const encoded = encodeURIComponent(petId);
    const [pets, reports] = await Promise.all([
      this.request(`/rest/v1/pets?select=id,shop_id,owner_id,name,template,active,created_at,updated_at&id=eq.${encoded}&limit=1`),
      /* `deleting` も返す。以前は隠していたが、削除が途中で失敗するとカルテは
         `deleting` のまま残り、**一覧から消えるだけで実体は残る**——写真ごと
         残っているのに、画面からは再試行にも到達できなかった（D-20260824-30 の 10）。
         隠すのをやめて、スタッフの一覧に「削除が途中で止まっています」として
         出し、そこから再試行させる。飼い主側は別経路（RLS が `status='final'` を
         要求する）なので、これで飼い主に見えるようにはならない。 */
      this.request(`/rest/v1/reports?select=id,shop_id,pet_id,report_date,status,created_at,updated_at&pet_id=eq.${encoded}&order=report_date.desc,created_at.desc`),
    ]);
    return { ...this.one(pets), reports };
  }

  async createPet(ownerId, input) {
    const owner = await this.getOwner(ownerId);
    const rows = await this.request(
      '/rest/v1/pets?select=id,shop_id,owner_id,name,template,active,created_at,updated_at',
      {
        method: 'POST',
        body: { shop_id: owner.shop_id, owner_id: ownerId, name: input.name, template: input.template },
        prefer: 'return=representation',
      },
    );
    return this.one(rows);
  }

  async updatePet(petId, input) {
    const rows = await this.request(
      `/rest/v1/pets?id=eq.${encodeURIComponent(petId)}&select=id,shop_id,owner_id,name,template,active,created_at,updated_at`,
      { method: 'PATCH', body: input, prefer: 'return=representation' },
    );
    return this.one(rows);
  }

  async deletePet(petId) {
    const rows = await this.request(
      `/rest/v1/pets?id=eq.${encodeURIComponent(petId)}&select=id`,
      { method: 'DELETE', prefer: 'return=representation' },
    );
    this.one(rows);
    return { ok: true };
  }

  async listReports(petId) {
    return this.request(
      `/rest/v1/reports?select=id,shop_id,pet_id,report_date,status,data,created_at,updated_at&pet_id=eq.${encodeURIComponent(petId)}&status=neq.deleting&order=report_date.desc,created_at.desc`,
    );
  }

  async getReport(petId, reportId) {
    const [rows, assets] = await Promise.all([
      this.request(
        `/rest/v1/reports?select=id,shop_id,pet_id,report_date,status,data,created_at,updated_at&id=eq.${encodeURIComponent(reportId)}&pet_id=eq.${encodeURIComponent(petId)}&limit=1`,
      ),
      this.request(
        `/rest/v1/report_assets?select=id,shop_id,report_id,kind,storage_path,mime_type,byte_size,sort_order,created_at&report_id=eq.${encodeURIComponent(reportId)}&order=sort_order.asc`,
      ),
    ]);
    return { ...this.one(rows), assets };
  }

  async createReport(petId, input) {
    if (!this.userId) throw new StoreError(401, 'missing_user');
    const pet = await this.getPet(petId);
    const rows = await this.request(
      '/rest/v1/reports?select=id,shop_id,pet_id,report_date,status,data,created_at,updated_at',
      {
        method: 'POST',
        body: {
          shop_id: pet.shop_id,
          pet_id: petId,
          report_date: input.reportDate,
          data: input.data,
          created_by: this.userId,
        },
        prefer: 'return=representation',
      },
    );
    return this.one(rows);
  }

  async updateReport(petId, reportId, input) {
    const rows = await this.request(
      `/rest/v1/reports?id=eq.${encodeURIComponent(reportId)}&pet_id=eq.${encodeURIComponent(petId)}&status=eq.draft&select=id,shop_id,pet_id,report_date,status,data,created_at,updated_at`,
      { method: 'PATCH', body: input, prefer: 'return=representation' },
    );
    return this.one(rows);
  }

  async finalizeReport(petId, reportId) {
    await this.getReport(petId, reportId);
    const finalized = await this.request('/rest/v1/rpc/finalize_report', {
      method: 'POST', body: { target_report: reportId },
    });
    if (!finalized) throw new StoreError(409, 'storage_incomplete');
    return finalized;
  }

  async archiveReport(petId, reportId) {
    await this.getReport(petId, reportId);
    return this.request('/rest/v1/rpc/archive_report', {
      method: 'POST', body: { target_report: reportId },
    });
  }

  /* 確定済みカルテの中身を差し替える（管理者画面の「カルテ修正」）。
     `reports_staff_update_draft` は draft しか許さないので、直接 PATCH ではなく
     `revise_report`（security definer）を通す。できるのは final の data 差し替えだけ。
     先に `getReport` を通すのは archiveReport と同じ理由——その犬のカルテかを
     RLS 越しに確かめてから RPC に渡す（reportId だけでは他の犬のカルテを指せる）。 */
  async reviseReport(petId, reportId, data) {
    await this.getReport(petId, reportId);
    return this.request('/rest/v1/rpc/revise_report', {
      method: 'POST', body: { target_report: reportId, new_data: data },
    });
  }

  async consumeRateLimit(scope, ipHash = null) {
    const result = await this.request('/rest/v1/rpc/consume_rate_limit', {
      method: 'POST',
      body: { target_scope: scope, ip_hash: ipHash },
    });
    return result === true;
  }

  async listInvitations() {
    const shopId = await this.getStaffShopId();
    return this.request(
      `/rest/v1/invitations?select=id,shop_id,invitation_type,owner_id,staff_role,expires_at,claimed_at,claimed_by,revoked_at,created_by,created_at&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.desc&limit=100`,
    );
  }

  async createInvitation(input) {
    const shopId = await this.getStaffShopId();
    const result = await this.request('/rest/v1/rpc/create_invitation', {
      method: 'POST',
      body: {
        target_shop: shopId,
        target_type: input.invitationType,
        target_owner: input.invitationType === 'owner' ? input.ownerId : null,
        target_staff_role: input.invitationType === 'staff' ? input.staffRole : null,
      },
    });
    const invitation = this.one(result);
    return {
      id: invitation.invitation_id,
      token: invitation.raw_token,
      expiresAt: invitation.expires_at,
    };
  }

  async claimInvitation(token) {
    return this.request('/rest/v1/rpc/claim_invitation', {
      method: 'POST', body: { raw_token: token },
    });
  }

  async revokeInvitation(invitationId) {
    const revoked = await this.request('/rest/v1/rpc/revoke_invitation', {
      method: 'POST', body: { target_invitation: invitationId },
    });
    if (revoked !== true) throw new StoreError(404, 'not_found');
    return { ok: true };
  }

  /**
   * 飼い主に紐付いているアカウントの一覧。
   * 招待リンクは最初にクリックした Google アカウントに結び付くので、
   * 誤送信・転送で第三者が入ったときに**誰が入っているのかを見る**手段が要る
   * （D-20260824-30 の 9）。RLS `owner_users_staff_select` が自店舗に絞る。
   */
  async listOwnerLinks(ownerId) {
    return this.request(
      `/rest/v1/owner_users?select=owner_id,user_id,created_at&owner_id=eq.${encodeURIComponent(ownerId)}&order=created_at.asc`,
    );
  }

  /** 紐付けを外す。外れた相手はその瞬間から /my で何も見られなくなる。 */
  async revokeOwnerLink(ownerId, userId) {
    const revoked = await this.request('/rest/v1/rpc/revoke_owner_link', {
      method: 'POST', body: { target_owner: ownerId, target_user: userId },
    });
    if (revoked !== true) throw new StoreError(404, 'not_found');
    return { ok: true };
  }

  async listStaff() {
    const shopId = await this.getStaffShopId();
    return this.request(
      `/rest/v1/shop_memberships?select=shop_id,user_id,role,active,created_at&shop_id=eq.${encodeURIComponent(shopId)}&order=created_at.asc`,
    );
  }

  async updateStaff(userId, input) {
    const shopId = await this.getStaffShopId();
    const updated = await this.request('/rest/v1/rpc/update_staff_membership', {
      method: 'POST',
      body: {
        target_shop: shopId,
        target_user: userId,
        new_role: input.role ?? null,
        new_active: input.active ?? null,
      },
    });
    if (!updated) throw new StoreError(409, 'last_admin');
    return updated;
  }

  async registerReportAsset(petId, reportId, input) {
    await this.getReport(petId, reportId);
    return this.request('/rest/v1/rpc/register_report_asset', {
      method: 'POST',
      body: {
        target_report: reportId,
        target_asset: input.id,
        target_kind: input.kind,
        target_mime: input.mimeType,
        target_size: input.byteSize,
        target_sort: input.sortOrder,
      },
    });
  }

  async markReportDeleting(petId, reportId) {
    const report = await this.getReport(petId, reportId);
    const deleting = await this.request('/rest/v1/rpc/mark_report_deleting', {
      method: 'POST', body: { target_report: reportId },
    });
    return { report: deleting, assets: report.assets || [] };
  }

  async completeReportDeletion(petId, reportId) {
    await this.getReport(petId, reportId);
    const deleted = await this.request('/rest/v1/rpc/complete_report_deletion', {
      method: 'POST', body: { target_report: reportId },
    });
    if (deleted !== true) throw new StoreError(409, 'storage_cleanup_required');
    return { ok: true };
  }
}

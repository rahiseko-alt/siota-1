/**
 * supabase-admin.js — 管理者画面（マスター指示 2026-08-26）
 *
 * 動線（マスター指定・この形以外にしない）:
 *   管理者は Google 認証すると**毎回ここに入る**
 *     → ①リピーター → ①カルテ作成 ②カルテ修正
 *     → ②新規       → ①顧客アカウントの新規作成 ②ペットアカウントの新規作成
 *     → ③削除       → ①顧客アカウント全データ ②ペットアカウント全データ ③カルテ1枚
 *     → ⑤スタッフ招待 → 招待QR/URLを発行する
 *     → ⑥スタッフ管理 → お店の人を一覧し、利用を止める・再開する（放置リスト `#76`）
 *
 * **2026-08-26 時点は「管理者アカウントを作る機能はここに置かない（納品時に
 * 開発者が行う）」だったが、マスター指示（2026-09-24「招待ボタン復活させて」）で
 * 方針転換した。**
 *
 * **店舗側は「管理者」と「スタッフ」に分かれる**（マスター指示 2026-11-19・`N-49`・
 * `202611190017_admin_staff_roles.sql`）。スタッフ招待で入った人がスタッフで、
 * ③削除・④店舗設定・⑤スタッフ招待・⑥スタッフ管理はメニューに出さない。断るのは DB で、
 * ここで隠すのは押せないものを見せないための補助。
 *

 * **新しい API は作っていない。** 使うのは全部いま在るもの——
 * 顧客作成 `POST /api/owners` ／ ペット作成 `POST /api/owners/{id}/pets` ／
 * 顧客削除 `DELETE /api/owners/{id}` ／ ペット削除 `DELETE /api/pets/{id}` ／
 * カルテ削除 `deleteReportAssets` ／ 写真の片付け `purgeOwnerAssets` `purgePetAssets`。
 * 唯一の新設は確定済みカルテを直す `revise_report`（`reports_staff_update_draft` が
 * draft しか許さないため。migration `202608260008`）。
 *
 * **消す順序を守る**（`D-20260824-34`・機械: `scripts/guard/delete-order.mjs`）:
 * 写真（Storage）を片付けてから DB の行を消す。逆にすると RLS の条件が崩れ、
 * 写真が誰からも取れない置き去りになる。
 */

import { createAuthClient, authorizedFetch } from './supabase-auth.js';
import { deleteReportAssets, purgePetAssets, purgeOwnerAssets } from './supabase-storage.js';

let supabase = null;
let statusEl = null;
let contentEl = null;
/* 管理者か（`N-49`）。起動時に `/api/session` の `role` から決める。 */
let isAdmin = true;
/* ログインしている人（`/api/session` の `user.id`）。⑥スタッフ管理で自分の行に
   「止める」を出さないのに使う（自分を止める操作は DB も断る・`202611200020`）。 */
let myUserId = '';

function api(path, options = {}) {
  return authorizedFetch(supabase, path, options).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${response.status} ${text.slice(0, 200)}`);
    }
    if (response.status === 204) return null;
    return response.json();
  });
}

function show(element, visible) {
  if (element) element.hidden = !visible;
}

function setMessage(element, message) {
  if (element) element.textContent = message || '';
}

/** 器を空にしてから組み直す。**前の画面の文字を残さない**（`D-10`）。 */
function clear() {
  contentEl.replaceChildren();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  /* **`textContent` で入れる。** 実データ（犬の名前・飼い主の名前）が
     そのまま入る場所なので、`innerHTML` にすると細工が実行される（`D-11`）。 */
  if (text != null) node.textContent = text;
  return node;
}

/** 「◀ もどる」。どの画面からも1タッチで前に戻れるようにする（`D-14` の問2）。 */
function backButton(onBack, label = '◀ もどる') {
  const button = el('button', 'admin-back', label);
  button.type = 'button';
  button.onclick = onBack;
  return button;
}

function menuItem({ title, note, danger, onSelect, testid }) {
  const button = el('button', `admin-menu__item${danger ? ' admin-menu__item--danger' : ''}`);
  button.type = 'button';
  /* `data-*` の値は ASCII だけ（`D-9`）。日本語をセレクタに連結しない。 */
  if (testid) button.dataset.adminAction = testid;
  button.append(el('strong', null, title));
  if (note) button.append(el('span', null, note));
  button.onclick = onSelect;
  return button;
}

function menu(items) {
  const box = el('div', 'admin-menu');
  for (const item of items) box.append(menuItem(item));
  return box;
}

function heading(text) {
  return el('h2', null, text);
}

function note(text, danger) {
  return el('p', `admin-note${danger ? ' admin-note--danger' : ''}`, text);
}

/* ── 一覧を取る。**持っていないものは足さない**（`D-10`）。 ─────────── */

async function listPets() {
  const body = await api('/api/pets');
  return (body.pets || []).map((pet) => ({
    id: pet.id,
    name: pet.name || '',
    ownerName: (pet.owners && pet.owners.name) || '',
    ownerId: pet.owner_id || '',
    breed: pet.breed || '',
  }));
}

async function listOwners() {
  const body = await api('/api/owners');
  return (body.owners || []).map((owner) => ({
    id: owner.id,
    name: owner.name || '',
    createdAt: owner.created_at || '',
  }));
}

/* ── 同姓同名を取り違えないための見分け ────────────────────────────
   **名前だけでは足りない**（`docs/deferred.md` #36・マスター指摘）。
   田中さんが2人いると、削除の一覧も新規ペットの飼い主選びも**同じ文字列の行**に
   なる。DB は UUID なので中身は混ざらないが、**人がどちらを選んだか分からない**。
   取り違えの結果は、削除なら顧客の全データ消失、新規ペットなら**その子のカルテが
   別の飼い主のポータルに出る**（`/my` は `owner_id` で引く）。後者は誰も気づかない。

   **名前の重複を禁止にはしない。** 親子・別世帯の同姓は実在する。禁止ではなく区別。

   出すもの: **飼っている子の名前**（サロンは犬で顧客を覚えている）と**登録日**。
   それでも同じになる場合だけ、**ID の先頭6文字**を足す——ふだんは意味の無い
   文字列を人に読ませない。 */

/** 日付だけにする。`2026-08-27T12:34:56Z` → `2026-08-27`。取れなければ空。 */
function ymd(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

/**
 * 飼い主の行に出す見分け。`pets` はその店の子すべて（`listPets` の戻り）。
 *
 * **外に出しているのは検査から呼ぶため。** 取り違えは実ブラウザまで行かないと
 * 起きないが、「どこまでを見分けとして出すか」はここだけで決まる。
 */
export function ownerNote(owner, pets, owners) {
  const dogs = pets.filter((pet) => pet.ownerId === owner.id).map((pet) => pet.name).filter(Boolean);
  const parts = [];
  parts.push(dogs.length > 0 ? `子: ${dogs.join('・')}` : '子はまだ登録なし');
  const day = ymd(owner.createdAt);
  if (day) parts.push(`登録 ${day}`);
  /* ここまでで**まだ同じになる**同名の相手がいるときだけ、ID を足す。 */
  const sameName = owners.filter((other) => other.name === owner.name);
  if (sameName.length > 1) {
    const twin = sameName.some((other) => other.id !== owner.id
      && ymd(other.createdAt) === day
      && pets.filter((pet) => pet.ownerId === other.id).map((pet) => pet.name).join('・') === dogs.join('・'));
    if (twin) parts.push(`ID ${String(owner.id).slice(0, 6)}`);
  }
  return parts.join(' ・ ');
}

/** 飼い主一覧と子一覧をまとめて取る。**見分けを出すには両方要る。** */
function loadOwnersWithPets() {
  return Promise.all([listOwners(), listPets()]);
}

/** その犬の**確定済み**カルテだけ。下書きは飼い主に届いていないので直す対象にしない。 */
async function listFinalReports(petId) {
  const body = await api(`/api/pets/${encodeURIComponent(petId)}/reports`);
  return (body.reports || []).filter((report) => report.status === 'final');
}

/** 一覧から1つ選ばせる。空なら**空だと言う**（在るふりをしない）。 */
function picker({ items, label, empty, onPick, onBack, testid, search }) {
  clear();
  contentEl.append(backButton(onBack));
  contentEl.append(heading(label));
  if (items.length === 0) {
    contentEl.append(el('p', null, empty));
    return;
  }
  const list = menu(items.map((item) => ({
    title: item.title,
    note: item.note,
    danger: item.danger,
    testid,
    onSelect: () => onPick(item),
  })));
  /* **検索窓**（クライアント指示 C-14・2026-11-18「犬の名前・飼い主様の名前で検索」）。
     打った文字を、各行に**表示している文字**（犬の名前・飼い主の名前）と突き合わせて、
     合わない行を隠すだけ。サーバーには問い合わせない——一覧は既に全件読んである。
     作業画面（`/edit`）の検索窓 `App.filterKarte()` と同じ考え方（表示文字の部分一致）。 */
  if (search) {
    const field = el('label', 'admin-field');
    field.append(el('span', null, search));
    const input = document.createElement('input');
    input.type = 'search';
    input.dataset.adminField = 'pet-search';
    input.autocomplete = 'off';
    field.append(input);
    const none = el('p', 'admin-note', '該当する子がいません。名前を確かめてください。');
    none.hidden = true;
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      let shown = 0;
      for (const row of list.children) {
        const hit = !query || row.textContent.toLowerCase().includes(query);
        row.hidden = !hit;
        if (hit) shown += 1;
      }
      none.hidden = shown > 0;
    });
    contentEl.append(field, none);
  }
  contentEl.append(list);
}

/* ── 消す前の確認 ────────────────────────────────────────────────
   **取り返しがつかない唯一の操作**なので、名前を打ち直させる。押し間違いの
   1タッチで顧客の全データが消えるのは、`D-20260824-30` の 3（写真の置き去り）
   より重い。意匠モックに削除が無いためここは前例が無く、**この確認は私の判断で
   足したもの**である（`docs/deferred.md` #25 の置き場所はマスターが決めた）。 */
function confirmDestructive({ title, what, detail, name, onConfirm, onBack }) {
  clear();
  contentEl.append(backButton(onBack));
  contentEl.append(heading(title));
  contentEl.append(note(what, true));
  /* **どれを選んだのかを、消す直前にもう一度見せる**（`#36`）。 */
  if (detail) {
    const line = el('p', 'admin-note', detail);
    line.dataset.adminField = 'confirm-detail';
    contentEl.append(line);
  }

  const field = el('label', 'admin-field');
  field.append(el('span', null, `確認のため「${name}」と入力してください`));
  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.adminField = 'confirm-name';
  input.autocomplete = 'off';
  field.append(input);
  contentEl.append(field);

  const button = el('button', 'boxbutton');
  button.type = 'button';
  button.dataset.adminAction = 'confirm-delete';
  button.disabled = true;
  button.append(el('span', null, '完全に削除する'));
  input.addEventListener('input', () => { button.disabled = input.value.trim() !== name; });

  const result = el('p', 'admin-result');
  button.onclick = async () => {
    button.disabled = true;
    setMessage(result, '削除しています…');
    try {
      await onConfirm();
      setMessage(result, '削除しました');
      /* 消えたことを**一覧で**見せる。文字だけだと、消えたのかどうか分からない。 */
      setTimeout(onBack, 600);
    } catch (error) {
      button.disabled = false;
      setMessage(result, `削除できませんでした: ${error.message}`);
    }
  };
  contentEl.append(button);
  contentEl.append(result);
}

/* ── 画面 ──────────────────────────────────────────────────────── */

function screenHome() {
  clear();
  const items = [
    {
      title: '① リピーター',
      note: 'すでにお預かりしている子のカルテを作る・直す',
      testid: 'repeat',
      onSelect: () => navigate('/admin/repeat', screenRepeat),
    },
    {
      title: '② 新規',
      note: '新しい顧客アカウント・ペットアカウントを作る',
      testid: 'new',
      onSelect: () => navigate('/admin/new', screenNew),
    },
    {
      title: '③ 削除',
      note: '顧客・ペット・カルテを消す。元に戻せない',
      danger: true,
      testid: 'delete',
      onSelect: () => navigate('/admin/delete', screenDelete),
    },
    {
      title: '④ 店舗設定',
      note: '「次回のおすすめご来店時期」の既定日数・使用オプションの一覧を変える',
      testid: 'shop-settings',
      onSelect: () => navigate('/admin/settings', screenShopSettings),
    },
    {
      title: '⑤ スタッフ招待',
      note: '新しいスタッフのGoogleアカウントを、この店のスタッフとして迎える',
      testid: 'invite-staff',
      onSelect: () => navigate('/admin/invite-staff', screenInviteStaff),
    },
    {
      title: '⑥ スタッフ管理',
      note: 'お店の人を一覧し、利用を止める・再開する',
      testid: 'staff-manage',
      onSelect: () => navigate('/admin/staff', screenStaffManage),
    },
  ];
  /* スタッフには①②だけを出す。番号は振り直さない（管理者と同じ呼び名で話せるように）。 */
  contentEl.append(menu(isAdmin ? items : items.slice(0, 2)));
}

/* 「次回のおすすめご来店時期」の既定日数（マスター指示 2026-08-29・D-20260829-58）。

   **犬ごとに日数を直す欄は、もう無い**（マスター指示 2026-09-10「日後も保存も不要だから
   削除しろ。こんな機能を付けろと指示もしていない AI の誤爆だ」でコミット `923619d` にて削除）。
   ここと下の説明文は、消えた画面を案内したまま 2026-09-13 まで残っていた
   ——**画面が「そこでできます」と言っているのに、その画面が無い**（マスター指示
   「直せるものを先に治せ」で発見）。案内する先が無い文は書かない。
   `scripts/verify-revisit-interval.mjs` の `5.` が「犬ごとに日数を直す欄が、店の画面に無い」
   を毎回見ているので、欄が戻ることはない。 */
function screenShopSettings() {
  clear();
  contentEl.append(backButton(() => navigate('/admin', screenHome)));
  contentEl.append(heading('店舗設定'));
  contentEl.append(note('「次回のおすすめご来店時期」は、カルテの来店日にこの日数を足して出します。ここで決めた日数が、すべての犬のカルテに使われます。'));
  const field = el('label', 'admin-field');
  field.append(el('span', null, '既定の来店間隔（日）'));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '3650';
  input.dataset.adminField = 'shop-default-revisit-days';
  field.append(input);
  contentEl.append(field);
  const button = submitButton('保存する', 'save-shop-settings');
  const result = el('p', 'admin-result');
  contentEl.append(button, result);

  api('/api/shop').then((body) => {
    input.value = String((body.shop && body.shop.default_revisit_days) || '');
  }).catch(() => {
    setMessage(result, '既定の日数を読み込めませんでした。');
  });

  button.onclick = async () => {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      setMessage(result, '1〜3650の整数で入力してください。');
      return;
    }
    button.disabled = true;
    setMessage(result, '保存しています…');
    try {
      await api('/api/shop', { method: 'PATCH', body: JSON.stringify({ defaultRevisitDays: value }) });
      setMessage(result, '保存しました。');
    } catch (error) {
      setMessage(result, `保存できませんでした: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  };

  appendGroomingOptionsEditor(contentEl);
}

/* 使用オプション（旧デザイン試作の「今月の使用オプション」相当。マスター指示
   2026-08-31で復活）。④カルテ作成でトリマーが選べる名前を、店舗ごとに
   ここで追加・編集・削除する。DB は配列1本（`shops.grooming_options`）なので、
   保存はいつも一覧を丸ごと送り直す。 */
function appendGroomingOptionsEditor(root) {
  root.append(el('p', 'admin-note', '④カルテ作成画面でトリマーが選べる「使用オプション」の一覧です。名前は自由に変更・追加・削除できます。'));
  const list = el('div', 'admin-options-list');
  root.append(list);
  const addRow = el('div', 'admin-options-row');
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'オプション名を入力して追加';
  addInput.maxLength = 40;
  addRow.append(addInput);
  const addButton = submitButton('＋ 追加', 'add-shop-option');
  addRow.append(addButton);
  root.append(addRow);
  const saveButton = submitButton('使用オプションを保存する', 'save-shop-options');
  const saveResult = el('p', 'admin-result');
  root.append(saveButton, saveResult);

  let names = [];
  /* 一覧の読み込みが終わるまで保存できないようにする。**サブエージェントによる敵対検証で
     発見**: 以前は保存ボタンを最初から押せる状態にしており、`/api/shop` の応答が
     まだ届いていない（＝`names` がまだ空の初期値のまま）うちに押すと、
     店舗の一覧を空配列で丸ごと上書きしてしまっていた（読み込み失敗時も同様——
     手元の状態が正しいか分からないまま上書きするのは危険）。 */
  saveButton.disabled = true;

  function renderRows() {
    list.replaceChildren();
    names.forEach((name, index) => {
      const row = el('div', 'admin-options-row');
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 40;
      input.value = name;
      input.oninput = () => { names[index] = input.value; };
      row.append(input);
      const removeButton = el('button', 'admin-options-remove', '×');
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', `${name || `オプション${index + 1}`}を削除`);
      removeButton.onclick = () => { names.splice(index, 1); renderRows(); };
      row.append(removeButton);
      list.append(row);
    });
  }

  addButton.onclick = () => {
    const value = addInput.value.trim();
    if (!value) return;
    names.push(value);
    addInput.value = '';
    renderRows();
  };

  api('/api/shop').then((body) => {
    names = Array.isArray(body.shop && body.shop.grooming_options) ? [...body.shop.grooming_options] : [];
    renderRows();
    saveButton.disabled = false;
  }).catch(() => {
    /* 読み込めなかった＝手元の一覧（空のまま）が実際のものと合っている保証が無い。
       ここで保存を許すと、読めなかっただけなのに店舗の一覧を空で上書きしてしまう。 */
    setMessage(saveResult, '使用オプションの一覧を読み込めませんでした（保存はできません）。');
  });

  saveButton.onclick = async () => {
    const cleaned = names.map((v) => v.trim()).filter(Boolean);
    if (cleaned.length > 30) {
      setMessage(saveResult, 'オプションは30件までです。');
      return;
    }
    saveButton.disabled = true;
    setMessage(saveResult, '保存しています…');
    try {
      await api('/api/shop', { method: 'PATCH', body: JSON.stringify({ groomingOptions: cleaned }) });
      names = cleaned;
      renderRows();
      setMessage(saveResult, '保存しました。');
    } catch (error) {
      setMessage(saveResult, `保存できませんでした: ${error.message}`);
    } finally {
      saveButton.disabled = false;
    }
  };
}

/* スタッフ招待（マスター指示 2026-09-24「招待ボタン復活させて」）。
   使うのは既に在る `POST /api/invitations`（`invitationType: 'staff'`）だけで、
   新しいAPIは足していない——`backend/js/supabase-staff.js` の「初回登録QR」
   （飼い主向け）と同じ土台。あちらのモーダルの器は流用しない。admin.html は
   カルテ編集専用の重い依存（`supabase-staff.js` が読み込む asset 処理・
   magazine-view 等）を持ち込んでいないため、URLの組み立てだけこの画面が
   自前で持つ（1行だけの重複・`buildInvitationUrl` と同じ形）。 */
function buildStaffInvitationUrl(token) {
  return `${new URL(location.origin).origin}/my?invite=${encodeURIComponent(token.toLowerCase())}`;
}

function screenInviteStaff() {
  clear();
  contentEl.append(backButton(() => navigate('/admin', screenHome)));
  contentEl.append(heading('スタッフ招待'));
  /* **招待した相手が何を持つかを、発行前に言う**（`D-20` の精神・意見は率直に）。
     招待された人は**スタッフ**になり、削除・店舗設定・スタッフ招待ができない
     （`202611190017_admin_staff_roles.sql`・`N-49`）。 */
  contentEl.append(note('招待すると、その人は「スタッフ」になります。すべての飼い主・犬・カルテを見る・書く・直すことはできますが、削除・店舗設定・スタッフ招待はできません（管理者だけ）。有効期限24時間・1回のみ使用できます。新しく発行すると、前のQR・URLは使えなくなります。'));
  const button = submitButton('招待を発行する', 'create-staff-invitation');
  const result = el('div', 'admin-result');
  contentEl.append(button, result);

  button.onclick = async () => {
    button.disabled = true;
    result.replaceChildren();
    setMessage(result, '発行しています…');
    try {
      const response = await api('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ invitationType: 'staff' }),
      });
      const invitation = response.invitation;
      const url = buildStaffInvitationUrl(invitation.token);
      result.replaceChildren();
      result.append(el('p', 'admin-note', `有効期限: ${new Date(invitation.expiresAt).toLocaleString('ja-JP')}`));
      const img = document.createElement('img');
      img.alt = 'スタッフ招待QRコード';
      img.width = 240;
      img.height = 240;
      result.append(img);
      const urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.readOnly = true;
      urlInput.value = url;
      urlInput.setAttribute('aria-label', 'スタッフ招待URL');
      result.append(urlInput);
      const copyButton = submitButton('URLをコピー', 'copy-staff-invitation-url');
      const copyStatus = el('p', 'admin-result');
      copyButton.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          setMessage(copyStatus, 'コピーしました。');
        } catch {
          urlInput.focus();
          urlInput.select();
          setMessage(copyStatus, 'URLを選択しました。端末のコピー操作をご利用ください。');
        }
      };
      result.append(copyButton, copyStatus);
      try {
        img.src = await globalThis.TrimmerSupabaseVendor.QRCode.toDataURL(url, {
          errorCorrectionLevel: 'M', width: 320, margin: 2,
        });
      } catch {
        img.remove();
        result.append(el('p', 'admin-note', 'QRコードは表示できませんでした。上のURLをお使いください。'));
      }
    } catch (error) {
      setMessage(result, `発行できませんでした: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  };
}

/* ── ⑥ スタッフ管理（放置リスト `#76`・レビュー M1） ───────────────────
   **辞めた人を止める道が無かった。** `202609060013` でスタッフ管理の画面ごと消したので、
   辞めた人の Google アカウントがそのまま店の全データを読み書きできた。
   止めるのは**消すことではない**——行も監査記録も残り、「再開する」で元に戻せる。
   断るのは DB（`set_member_active`）で、ここで自分の行にボタンを出さないのは補助。 */
function memberLabel(member) {
  return member.display_name || member.email || '（名前もメールも登録されていません）';
}

function screenStaffManage() {
  return withList(async () => (await api('/api/staff')).members || [], (members) => {
    clear();
    contentEl.append(backButton(() => navigate('/admin', screenHome)));
    contentEl.append(heading('スタッフ管理'));
    contentEl.append(note('「利用を止める」と、その人はすぐにこの店の飼い主・犬・カルテを見ることも書くこともできなくなります。消すのではないので、「再開する」で元どおり使えるようになります。'));
    if (members.length === 0) {
      contentEl.append(el('p', null, 'お店の人が登録されていません。'));
      return;
    }
    const list = el('div', 'admin-menu');
    for (const member of members) {
      const row = el('div', 'admin-field');
      /* 同じ名前の人がいても取り違えないよう、名前とメールの両方を出す（`#36` と同じ考え方）。 */
      row.append(el('strong', null, memberLabel(member)));
      if (member.display_name && member.email) row.append(el('span', null, member.email));
      row.append(el('span', null, `${member.role === 'admin' ? '管理者' : 'スタッフ'}・${member.active ? '利用中' : '停止中'}`));
      if (member.user_id === myUserId) {
        row.append(el('span', null, 'あなた'));
      } else {
        const button = submitButton(member.active ? '利用を止める' : '再開する', 'member-toggle');
        /* 値は UUID（ASCII）だけ（`D-9`）。名前は入れない。 */
        button.dataset.adminUser = member.user_id;
        button.onclick = () => {
          if (member.active) {
            pushStep(() => confirmMemberStop(member));
            return;
          }
          /* 再開は取り返しのつく側なので、確認を挟まずにその場で効かせる。 */
          button.disabled = true;
          setMemberActive(member, true, row);
        };
        row.append(button);
      }
      list.append(row);
    }
    contentEl.append(list);
  });
}

async function setMemberActive(member, active, where) {
  const result = el('p', 'admin-result', active ? '再開しています…' : '止めています…');
  where.append(result);
  try {
    await api(`/api/staff/${encodeURIComponent(member.user_id)}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
    setMessage(result, active ? '再開しました' : '利用を止めました');
    /* 変わったことを**一覧で**見せる（`confirmDestructive` と同じ）。 */
    setTimeout(() => navigate('/admin/staff', screenStaffManage), 600);
    return true;
  } catch (error) {
    setMessage(result, `${active ? '再開' : '停止'}できませんでした: ${error.message}`);
    return false;
  }
}

/** 止める前の確認。**打ち直しは求めない**（止めても戻せるので）が、押し間違いの1タッチで
    止まらないよう、誰を止めるかを見せてからもう1回押させる。 */
function confirmMemberStop(member) {
  clear();
  contentEl.append(backButton(() => navigate('/admin/staff', screenStaffManage)));
  contentEl.append(heading('利用を止める'));
  contentEl.append(note(`${memberLabel(member)} さんの利用を止めます。止めるとすぐに、この店のデータを見ることも書くこともできなくなります。あとから「再開する」で戻せます。`, true));
  const detail = el('p', 'admin-note',
    [member.email, member.role === 'admin' ? '管理者' : 'スタッフ'].filter(Boolean).join(' ・ '));
  detail.dataset.adminField = 'confirm-detail';
  contentEl.append(detail);
  const button = submitButton('利用を止める', 'confirm-member-stop');
  contentEl.append(button);
  button.onclick = async () => {
    button.disabled = true;
    const done = await setMemberActive(member, false, contentEl);
    if (!done) button.disabled = false;
  };
}

function screenRepeat() {
  clear();
  contentEl.append(backButton(() => navigate('/admin', screenHome)));
  contentEl.append(heading('リピーター'));
  contentEl.append(menu([
    {
      title: '① カルテ作成',
      note: '今日の施術を書く',
      testid: 'repeat-create',
      onSelect: () => navigate('/admin/repeat/create', pickPetForCreate),
    },
    {
      title: '② カルテ修正',
      note: '確定済みのカルテを直す',
      testid: 'repeat-revise',
      onSelect: () => navigate('/admin/repeat/revise', pickPetForRevise),
    },
    {
      title: '③ 犬の情報を直す',
      note: '犬種を入れる・直す',
      testid: 'repeat-pet',
      onSelect: () => navigate('/admin/repeat/pet', pickPetForEdit),
    },
  ]));
}

async function withList(loader, render) {
  clear();
  contentEl.append(el('p', null, '読み込んでいます…'));
  try {
    render(await loader());
  } catch (error) {
    clear();
    contentEl.append(backButton(() => navigate('/admin', screenHome)));
    contentEl.append(note(`読み込めませんでした: ${error.message}`, true));
  }
}

function petItems(pets) {
  const items = pets.map((pet) => ({
    title: pet.name,
    /* 犬種は入っている子だけ出す（クライアント指示 C-14「飼い主名・犬名・犬種」・`N-48`）。
       行に出した文字は検索窓がそのまま探すので、犬種でも絞り込める。 */
    note: [pet.ownerName ? `飼い主: ${pet.ownerName}` : '', pet.breed].filter(Boolean).join(' ・ '),
    pet,
  }));
  /* 犬の名前と飼い主の名前が**両方とも同じ**行があれば、そこだけ ID を足す
     （`#36`）。ふだんは意味の無い文字列を人に読ませない。 */
  const seen = new Map();
  for (const item of items) {
    const key = `${item.title} ${item.note}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const item of items) {
    if (seen.get(`${item.title} ${item.note}`) > 1) {
      item.note = `${item.note} ・ ID ${String(item.pet.id).slice(0, 6)}`.trim();
    }
  }
  return items;
}

function pickPetForCreate() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets),
    label: 'レポートを作成する犬を選ぶ',
    empty: 'まだ1頭も登録されていません。「② 新規」から登録してください。',
    testid: 'pick-pet',
    search: '犬の名前・飼い主様の名前・犬種で探す',
    onBack: () => navigate('/admin/repeat', screenRepeat),
    onPick: (item) => { location.href = `/edit/p/${encodeURIComponent(item.pet.id)}`; },
  }));
}

/* 登録済みの子に犬種を入れる・直す（`N-48`）。犬種の欄を足す前に登録された子は空から始まる。 */
function pickPetForEdit() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets),
    label: '情報を直す犬を選ぶ',
    empty: 'まだ1頭も登録されていません。「② 新規」から登録してください。',
    testid: 'pick-pet',
    search: '犬の名前・飼い主様の名前・犬種で探す',
    onBack: () => navigate('/admin/repeat', screenRepeat),
    onPick: (item) => pushStep(() => formEditPet(item.pet)),
  }));
}

function formEditPet(pet) {
  clear();
  contentEl.append(backButton(() => navigate('/admin/repeat/pet', pickPetForEdit)));
  contentEl.append(heading('犬の情報を直す'));
  contentEl.append(el('p', null, pet.ownerName ? `${pet.name}（飼い主: ${pet.ownerName}）` : pet.name));
  const breed = breedField(pet.breed);
  contentEl.append(breed.field);
  contentEl.append(note('空欄にして保存すると、犬種を消します。'));
  const button = submitButton('保存する', 'save-pet');
  const result = el('p', 'admin-result');
  button.onclick = async () => {
    const value = breed.input.value.trim();
    button.disabled = true;
    setMessage(result, '保存しています…');
    try {
      const body = await api(`/api/pets/${encodeURIComponent(pet.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ breed: value || null }),
      });
      const saved = (body.pet && body.pet.breed) || '';
      pet.breed = saved;
      breed.input.value = saved;
      setMessage(result, saved ? `保存しました: ${saved}` : '犬種を消しました');
    } catch (error) {
      setMessage(result, `保存できませんでした: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  };
  contentEl.append(button);
  contentEl.append(result);
}

function pickPetForRevise() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets),
    label: 'カルテを直す子を選ぶ',
    empty: 'まだ1頭も登録されていません。',
    testid: 'pick-pet',
    onBack: () => navigate('/admin/repeat', screenRepeat),
    onPick: (item) => pushStep(() => pickReportForRevise(item.pet)),
  }));
}

function pickReportForRevise(pet) {
  return withList(() => listFinalReports(pet.id), (reports) => picker({
    items: reports.map((report) => ({
      title: report.report_date || '(日付なし)',
      note: pet.name,
      report,
    })),
    label: `${pet.name} のカルテを選ぶ`,
    empty: 'この子には確定済みのカルテがまだありません。',
    testid: 'pick-report',
    onBack: () => navigate('/admin/repeat/revise', pickPetForRevise),
    /* `?revise=1` を付けて④カルテ作成に入る。付けないと⑤確認（読むだけ）に着く。 */
    onPick: (item) => {
      location.href = `/edit/p/${encodeURIComponent(pet.id)}`
        + `/${encodeURIComponent(item.report.id)}?revise=1`;
    },
  }));
}

function screenNew() {
  clear();
  contentEl.append(backButton(() => navigate('/admin', screenHome)));
  contentEl.append(heading('新規'));
  contentEl.append(menu([
    {
      title: '① 顧客アカウントの新規作成',
      note: '飼い主さまを登録する',
      testid: 'new-owner',
      onSelect: () => navigate('/admin/new/owner', formNewOwner),
    },
    {
      title: '② ペットアカウントの新規作成',
      note: '登録済みの飼い主さまに子を追加する',
      testid: 'new-pet',
      onSelect: () => navigate('/admin/new/pet', formNewPet),
    },
  ]));
}

function textField(labelText, testid) {
  const field = el('label', 'admin-field');
  field.append(el('span', null, labelText));
  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.adminField = testid;
  input.autocomplete = 'off';
  field.append(input);
  return { field, input };
}

/* ── 犬種の欄（クライアント指示 C-14・マスター決定 案C・`N-48`） ─────────
   打ち始めると候補が出る。候補に無い犬種（ミックスなど）はそのまま打てる。
   ブラウザ標準の `<datalist>` で出すので、部品は足していない。
   候補はクライアントへの回答案（`docs/ops/client-reply-C13-C14.md`）の一覧と同じ。 */
export const BREED_CANDIDATES = [
  'トイ・プードル', 'チワワ', 'ミニチュア・ダックスフンド', 'ポメラニアン', '柴',
  'ミニチュア・シュナウザー', 'ヨークシャー・テリア', 'マルチーズ', 'シー・ズー',
  'フレンチ・ブルドッグ', 'パピヨン', 'ビション・フリーゼ', 'ミニチュア・ピンシャー',
  'キャバリア・キング・チャールズ・スパニエル', 'ウェルシュ・コーギー・ペンブローク',
  'ジャック・ラッセル・テリア', 'ペキニーズ', '狆', 'ボーダー・コリー',
  'ゴールデン・レトリーバー', 'ラブラドール・レトリーバー', 'ミックス',
];

/** 犬種の上限。DB の check 制約（`202611190016`）・`api-schemas.js` と同じ。 */
const BREED_MAX = 60;

function breedField(value = '') {
  const { field, input } = textField('犬種（打つと候補が出ます。候補に無いときはそのまま入力）', 'pet-breed');
  input.maxLength = BREED_MAX;
  input.value = value;
  const list = document.createElement('datalist');
  list.id = 'admin-breed-candidates';
  for (const breed of BREED_CANDIDATES) {
    const option = document.createElement('option');
    option.value = breed;
    list.append(option);
  }
  input.setAttribute('list', list.id);
  field.append(list);
  return { field, input };
}

function submitButton(label, testid) {
  const button = el('button', 'boxbutton');
  button.type = 'button';
  button.dataset.adminAction = testid;
  button.append(el('span', null, label));
  return button;
}

function formNewOwner() {
  clear();
  contentEl.append(backButton(() => navigate('/admin/new', screenNew)));
  contentEl.append(heading('顧客アカウントの新規作成'));
  const { field, input } = textField('飼い主さまのお名前', 'owner-name');
  contentEl.append(field);
  const button = submitButton('登録する', 'create-owner');
  const result = el('p', 'admin-result');
  button.onclick = async () => {
    const name = input.value.trim();
    if (!name) { setMessage(result, 'お名前を入力してください'); return; }
    button.disabled = true;
    setMessage(result, '登録しています…');
    try {
      const body = await api('/api/owners', { method: 'POST', body: JSON.stringify({ name }) });
      input.value = '';
      button.disabled = false;
      setMessage(result, `登録しました: ${(body.owner && body.owner.name) || name}`);
    } catch (error) {
      button.disabled = false;
      setMessage(result, `登録できませんでした: ${error.message}`);
    }
  };
  contentEl.append(button);
  contentEl.append(result);
}

/* **ここが一番危ない**（`#36`）。削除には確認の画面があるが、こちらは選んで登録して
   終わりで、間違えても誰にも見えない。そして間違えると、その子のカルテが**別の
   飼い主のポータルに出る**。だから選択肢にも見分けを出す。 */
function formNewPet() {
  return withList(loadOwnersWithPets, ([owners, pets]) => {
    clear();
    contentEl.append(backButton(() => navigate('/admin/new', screenNew)));
    contentEl.append(heading('ペットアカウントの新規作成'));
    if (owners.length === 0) {
      contentEl.append(el('p', null, '先に「① 顧客アカウントの新規作成」から飼い主さまを登録してください。'));
      return;
    }
    const ownerField = el('label', 'admin-field');
    ownerField.append(el('span', null, '飼い主さま'));
    const select = document.createElement('select');
    select.dataset.adminField = 'owner-select';
    for (const owner of owners) {
      const option = document.createElement('option');
      option.value = owner.id;
      const mark = ownerNote(owner, pets, owners);
      option.textContent = mark ? `${owner.name}（${mark}）` : owner.name;
      select.append(option);
    }
    ownerField.append(select);
    contentEl.append(ownerField);

    const { field, input } = textField('わんちゃんのお名前', 'pet-name');
    contentEl.append(field);
    const breed = breedField();
    contentEl.append(breed.field);
    const button = submitButton('登録する', 'create-pet');
    const result = el('p', 'admin-result');
    button.onclick = async () => {
      const name = input.value.trim();
      const breedValue = breed.input.value.trim();
      const ownerId = select.value;
      if (!name) { setMessage(result, 'お名前を入力してください'); return; }
      button.disabled = true;
      setMessage(result, '登録しています…');
      try {
        /* `template` は**必須**（`createPetSchema`・既定値は無い）。最初ここを省いて
           CI が落ちた——「サーバ側の既定に任せる」と思い込んで確かめなかった
           （`F-20260825-35`/`-36` の型）。いま在るテンプレートは `ponchi` の1つだけで、
           画面で選ばせる意味が無いので固定する。増えたらここに選択欄が要る。 */
        const body = await api(`/api/owners/${encodeURIComponent(ownerId)}/pets`, {
          method: 'POST',
          body: JSON.stringify({ ownerId, name, template: 'ponchi', ...(breedValue ? { breed: breedValue } : {}) }),
        });
        input.value = '';
        breed.input.value = '';
        button.disabled = false;
        setMessage(result, `登録しました: ${(body.pet && body.pet.name) || name}`);
      } catch (error) {
        button.disabled = false;
        setMessage(result, `登録できませんでした: ${error.message}`);
      }
    };
    contentEl.append(button);
    contentEl.append(result);
  });
}

function screenDelete() {
  clear();
  contentEl.append(backButton(() => navigate('/admin', screenHome)));
  contentEl.append(heading('削除'));
  contentEl.append(note('ここでの削除は元に戻せません。写真も一緒に消えます。', true));
  contentEl.append(menu([
    {
      title: '① 顧客アカウント全データ削除',
      note: 'その飼い主さまと、ひもづく子・カルテ・写真をすべて消す',
      danger: true,
      testid: 'delete-owner',
      onSelect: () => navigate('/admin/delete/owner', pickOwnerForDelete),
    },
    {
      title: '② ペットアカウント全データ削除',
      note: 'その子と、その子のカルテ・写真をすべて消す',
      danger: true,
      testid: 'delete-pet',
      onSelect: () => navigate('/admin/delete/pet', pickPetForDelete),
    },
    {
      title: '③ カルテ1枚単位削除',
      note: 'その子のカルテを1枚だけ消す',
      danger: true,
      testid: 'delete-report',
      onSelect: () => navigate('/admin/delete/report', pickPetForReportDelete),
    },
  ]));
}

function pickOwnerForDelete() {
  return withList(loadOwnersWithPets, ([owners, pets]) => picker({
    items: owners.map((owner) => ({
      title: owner.name,
      /* **空にしない**（`#36`）。同姓同名だと行が完全に同じ文字列になり、
         どちらを消すのか選べない。 */
      note: ownerNote(owner, pets, owners),
      danger: true,
      owner,
    })),
    label: '全データを消す飼い主さまを選ぶ',
    empty: '登録されている飼い主さまがいません。',
    testid: 'pick-owner',
    onBack: () => navigate('/admin/delete', screenDelete),
    onPick: (item) => pushStep(() => confirmDestructive({
      title: '顧客アカウント全データ削除',
      what: `${item.owner.name} さまと、ひもづく子・カルテ・写真をすべて消します。元に戻せません。`,
      /* 確認の画面にも**同じ見分けを出す**。名前を打たせるだけでは、同姓同名の
         どちらにも通ってしまい、押し間違いの歯止めにならない（`#36`）。 */
      detail: ownerNote(item.owner, pets, owners),
      name: item.owner.name,
      onBack: () => navigate('/admin/delete/owner', pickOwnerForDelete),
      /* **写真 → DB の順**（`D-20260824-34`）。逆にすると RLS の条件が崩れ、
         写真が誰からも取れない置き去りになる。 */
      onConfirm: async () => {
        await purgeOwnerAssets({ client: supabase, api, ownerId: item.owner.id });
        await api(`/api/owners/${encodeURIComponent(item.owner.id)}`, { method: 'DELETE' });
      },
    })),
  }));
}

function pickPetForDelete() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets).map((item) => ({ ...item, danger: true })),
    label: '全データを消す子を選ぶ',
    empty: '登録されている子がいません。',
    testid: 'pick-pet',
    onBack: () => navigate('/admin/delete', screenDelete),
    onPick: (item) => pushStep(() => confirmDestructive({
      title: 'ペットアカウント全データ削除',
      what: `${item.pet.name} と、その子のカルテ・写真をすべて消します。元に戻せません。`,
      detail: item.note,
      name: item.pet.name,
      onBack: () => navigate('/admin/delete/pet', pickPetForDelete),
      onConfirm: async () => {
        await purgePetAssets({ client: supabase, api, petId: item.pet.id });
        await api(`/api/pets/${encodeURIComponent(item.pet.id)}`, { method: 'DELETE' });
      },
    })),
  }));
}

function pickPetForReportDelete() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets),
    label: 'カルテを消す子を選ぶ',
    empty: '登録されている子がいません。',
    testid: 'pick-pet',
    onBack: () => navigate('/admin/delete', screenDelete),
    onPick: (item) => pushStep(() => pickReportForDelete(item.pet)),
  }));
}

function pickReportForDelete(pet) {
  return withList(() => api(`/api/pets/${encodeURIComponent(pet.id)}/reports`), (body) => picker({
    items: (body.reports || []).map((report) => ({
      title: report.report_date || '(日付なし)',
      note: report.status === 'final' ? '確定済み' : '下書き',
      danger: true,
      report,
    })),
    label: `${pet.name} の消すカルテを選ぶ`,
    empty: 'この子にはカルテがまだありません。',
    testid: 'pick-report',
    onBack: () => navigate('/admin/delete/report', pickPetForReportDelete),
    onPick: (item) => pushStep(() => confirmDestructive({
      title: 'カルテ1枚削除',
      what: `${pet.name} の ${item.report.report_date} のカルテと、その写真を消します。元に戻せません。`,
      name: pet.name,
      onBack: () => pickReportForDelete(pet),
      /* こちらは `deleteReportAssets` が「印を付ける → 写真を消す → 行を消す」まで
         通してやる（製品の削除の道そのもの。`verify:delete` が毎回確かめている）。 */
      onConfirm: () => deleteReportAssets({
        client: supabase, api, petId: pet.id, reportId: item.report.id,
      }),
    })),
  }));
}

/* ── 画面が変わったら住所も変える（マスター判断 2026-09-06）─────────────
   「ふつうの Web アプリは画面が変われば URL も変わる」。まず5つのメニューに
   URL を与え（PR #75）、ここでその先の**サブ画面**にも与えた。

   **与えたのは「開いた瞬間に自分で描き直せる画面」だけ**——犬や飼い主を1件
   選んだ後の画面（そのカルテ一覧・削除の確認）には与えていない。理由は2つ:
     ①削除の確認画面に URL を与えると、**確認画面へ直接飛べてしまう**
     ②選んだ1件は URL だけでは復元できず、開き直すたびに取り直しが要る
   これは「あとで足せる」——`docs/ops/plan.md` 放置リスト `#49` に残してある。

   ここに無い `/admin/...` は `screenHome` に落ちる（存在しない住所で
   白い画面にしない・`F-20260906-68` の型）。 */
const ADMIN_ROUTES = {
  '/admin': screenHome,
  '/admin/': screenHome,
  '/admin/repeat': screenRepeat,
  '/admin/repeat/create': pickPetForCreate,
  '/admin/repeat/revise': pickPetForRevise,
  '/admin/repeat/pet': pickPetForEdit,
  '/admin/new': screenNew,
  '/admin/new/owner': formNewOwner,
  '/admin/new/pet': formNewPet,
  '/admin/delete': screenDelete,
  '/admin/delete/owner': pickOwnerForDelete,
  '/admin/delete/pet': pickPetForDelete,
  '/admin/delete/report': pickPetForReportDelete,
  '/admin/settings': screenShopSettings,
  '/admin/invite-staff': screenInviteStaff,
  '/admin/staff': screenStaffManage,
};

/* 管理者だけの画面（`N-49`）。スタッフが住所を直に開いた・戻る/進むで来たときは、
   画面を描かずに理由と戻り道を出す（白い画面にしない・`D-14` の問2）。 */
const ADMIN_ONLY_PATHS = new Set([
  '/admin/delete',
  '/admin/delete/owner',
  '/admin/delete/pet',
  '/admin/delete/report',
  '/admin/settings',
  '/admin/invite-staff',
  '/admin/staff',
]);

function screenAdminOnly() {
  clear();
  contentEl.append(backButton(() => navigate('/admin', screenHome)));
  contentEl.append(note('この操作は管理者だけができます。管理者にお願いしてください。'));
}

function renderForPath(path) {
  if (!isAdmin && ADMIN_ONLY_PATHS.has(path)) {
    screenAdminOnly();
    return;
  }
  (ADMIN_ROUTES[path] || screenHome)();
}

/** メニュー画面への行き来だけ、住所バーも一緒に変える。 */
function navigate(path, screenFn) {
  if (location.pathname !== path) history.pushState(null, '', path);
  screenFn();
}

/* **1件選んだ後の画面にも、戻る1段ぶんを積む**
   （マスター指示 2026-09-13「直せるものを先に治せ」・放置リスト `#49`）。

   そのカルテ一覧・削除の確認は、URL を持たないまま関数を直に呼んでいた。
   履歴が積まれないので、**ブラウザの戻るを押すと一段多く戻っていた**
   （犬を選ぶ画面ではなく、その手前のメニューまで飛ぶ）。

   住所は**一段手前のまま**にする——`ADMIN_ROUTES` には手を触れない。
   そうすると戻るで `popstate` が起き、`renderForPath()` が
   一段手前（犬を選ぶ画面）を描き直す＝**ちょうど1つ戻る**。
   開き直したときも犬を選ぶ画面に着くので、**削除の確認画面へ直接飛べる**という
   前からの心配（ここにコメントで残っていたもの）も起きない。 */
function pushStep(screenFn) {
  history.pushState(null, '', location.pathname);
  screenFn();
}

/* ── 起動 ──────────────────────────────────────────────────────── */

export async function bootAdminPortal() {
  statusEl = document.querySelector('[data-portal-status]');
  contentEl = document.querySelector('[data-portal-content]');
  const signOutButton = document.querySelector('[data-sign-out]');

  try {
    supabase = await createAuthClient();
    /* 検査からセッションを入れる口。`my.html` / `index.html` と同じ形にそろえる。 */
    globalThis.TrimmerAuth = {
      client: supabase,
      setSession: (session) => supabase.auth.setSession(session),
    };

    const { data } = await supabase.auth.getSession();
    if (!data || !data.session) {
      /* **ログインできる画面は入口（`/`）の1つだけ**（マスター指示 2026-09-04
         「そもそも管理者と顧客の入り口を分けるな。指示は１つ。入り口を1つにしろ」）。
         ここは自前のログインパネルを出していた——**3つ目の入口**だった。

         **戻り先は積まない。** `safeReturnPath()` は `/my` と `/edit` しか通さないので、
         `/admin` を積んでも `/my` に潰れる「覚えたふり」になる（`D-10`）。
         実際、直す前の `signInWithGoogle(supabase, '/admin')` は**押せるのに
         `/admin` へ帰って来ない**入口だった。
         管理者は入口でログインすれば `/edit` に着き、ヘッダーの「管理」から
         ここへ入れる（`D-20260904-66` の形）。 */
      location.replace('/');
      return;
    }

    const session = await api('/api/session');
    /* **飼い主をここに入れない**——それは越境なので必ず止める。
       お店の人は管理者もスタッフもここに入る（`N-49`）。スタッフに出さないのは
       ③削除・④店舗設定・⑤スタッフ招待・⑥スタッフ管理だけで、それは下の `isAdmin` が決める。 */
    if ((session.memberships || []).length === 0) {
      /* 行き止まりにしない。その人が使える画面へ送る（`D-14` の問1）。 */
      setMessage(statusEl, 'この画面はお店の方だけが使えます。');
      show(contentEl, true);
      clear();
      contentEl.append(menuItem({
        title: 'マイカルテへ',
        note: 'お客様は、愛犬のページからご覧いただけます',
        testid: 'not-staff',
        onSelect: () => { location.href = '/my'; },
      }));
      show(signOutButton, true);
      signOutButton.onclick = async () => {
        await supabase.auth.signOut();
        /* **入口へ返す**（マスター指示 2026-09-04「入口を分けるな」）。
           `/my` に返すと、飼い主の画面がもう1つのログイン画面になってしまう。 */
        location.replace('/');
      };
      return;
    }

    /* `role` が無いのは役割を返さない古い Worker。そのときは今までどおり管理者として扱う
       （DB が断るので、画面が多めに出ても裏で通ることは無い）。 */
    isAdmin = session.memberships.some((membership) => (membership.role || 'admin') === 'admin');
    myUserId = (session.user && session.user.id) || '';

    show(contentEl, true);
    show(signOutButton, true);
    setMessage(statusEl, '');
    signOutButton.onclick = async () => {
      await supabase.auth.signOut();
      /* 上と同じ。ログアウトの行き先は3画面とも入口（`/`）で揃える。 */
      location.replace('/');
    };
    /* URLをブックマークして開き直したときも、その住所の画面から始める
       （メニュー5つと、犬を選ぶ・登録する等のサブ画面7つ）。 */
    renderForPath(location.pathname);
    /* ブラウザの「戻る/進む」でも、住所を持つ12画面を行き来できるようにする。 */
    window.addEventListener('popstate', () => { renderForPath(location.pathname); });
  } catch (error) {
    /* **ログインが切れているなら、入口へ返す。**
       ここは生の JSON（`401 {"error":"authentication required"}`）を人に見せたうえで、
       ログアウトも入口も出さない**行き止まり**だった（2026-09-05・サブ検証で実機再現）。
       未ログイン分岐は入口へ送るように直したのに、**失効の経路だけ守られていなかった**。
       鍵を捨ててから返す（残すと入口が送り返して往復する）。 */
    if (/authentication required|401/.test((error && error.message) || '')) {
      Promise.resolve(supabase ? supabase.auth.signOut() : null)
        .catch(() => { /* 消せなくても入口へは返す */ })
        .then(() => { location.replace('/'); });
      return;
    }
    setMessage(statusEl, `管理者ページを開けませんでした: ${error.message}`);
  }
}

globalThis.TrimmerAdmin = { boot: bootAdminPortal };

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bootAdminPortal(); });
  } else {
    bootAdminPortal();
  }
}

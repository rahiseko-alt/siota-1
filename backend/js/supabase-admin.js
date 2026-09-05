/**
 * supabase-admin.js — 管理者画面（マスター指示 2026-08-26）
 *
 * 動線（マスター指定・この形以外にしない）:
 *   管理者は Google 認証すると**毎回ここに入る**
 *     → ①リピーター → ①カルテ作成 ②カルテ修正
 *     → ②新規       → ①顧客アカウントの新規作成 ②ペットアカウントの新規作成
 *     → ③削除       → ①顧客アカウント全データ ②ペットアカウント全データ ③カルテ1枚
 *
 * **管理者アカウントを作る機能はここに置かない。** 納品時に開発者が行うため、
 * アプリからは作れない（マスター指示）。招待の仕組み（`staff` 招待）は在るが、
 * この画面からは呼ばない。
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

import { createAuthClient, signInWithGoogle, authorizedFetch } from './supabase-auth.js';
import { deleteReportAssets, purgePetAssets, purgeOwnerAssets } from './supabase-storage.js';

let supabase = null;
let statusEl = null;
let contentEl = null;

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
function picker({ items, label, empty, onPick, onBack, testid }) {
  clear();
  contentEl.append(backButton(onBack));
  contentEl.append(heading(label));
  if (items.length === 0) {
    contentEl.append(el('p', null, empty));
    return;
  }
  contentEl.append(menu(items.map((item) => ({
    title: item.title,
    note: item.note,
    danger: item.danger,
    testid,
    onSelect: () => onPick(item),
  }))));
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
  contentEl.append(menu([
    {
      title: '① リピーター',
      note: 'すでにお預かりしている子のカルテを作る・直す',
      testid: 'repeat',
      onSelect: screenRepeat,
    },
    {
      title: '② 新規',
      note: '新しい顧客アカウント・ペットアカウントを作る',
      testid: 'new',
      onSelect: screenNew,
    },
    {
      title: '③ 削除',
      note: '顧客・ペット・カルテを消す。元に戻せない',
      danger: true,
      testid: 'delete',
      onSelect: screenDelete,
    },
    {
      title: '④ 店舗設定',
      note: '「次回のおすすめご来店時期」の既定日数・使用オプションの一覧を変える',
      testid: 'shop-settings',
      onSelect: screenShopSettings,
    },
  ]));
}

/* 「次回のおすすめご来店時期」の既定日数（マスター指示 2026-08-29・D-20260829-58）。
   犬ごとの上書きはこの画面ではなく⑤カルテ確認画面（`magazine-view.js`）で直す
   ——編集の場所は「その犬のカルテを見ているとき」がいちばん迷わない。 */
function screenShopSettings() {
  clear();
  contentEl.append(backButton(screenHome));
  contentEl.append(heading('店舗設定'));
  contentEl.append(note('「次回のおすすめご来店時期」は、カルテの来店日にこの日数を足して出します。犬ごとに別の日数を使いたいときは、その犬のカルテ確認画面で個別に設定できます。'));
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

function screenRepeat() {
  clear();
  contentEl.append(backButton(screenHome));
  contentEl.append(heading('リピーター'));
  contentEl.append(menu([
    { title: '① カルテ作成', note: '今日の施術を書く', testid: 'repeat-create', onSelect: pickPetForCreate },
    { title: '② カルテ修正', note: '確定済みのカルテを直す', testid: 'repeat-revise', onSelect: pickPetForRevise },
  ]));
}

async function withList(loader, render) {
  clear();
  contentEl.append(el('p', null, '読み込んでいます…'));
  try {
    render(await loader());
  } catch (error) {
    clear();
    contentEl.append(backButton(screenHome));
    contentEl.append(note(`読み込めませんでした: ${error.message}`, true));
  }
}

function petItems(pets) {
  const items = pets.map((pet) => ({
    title: pet.name,
    note: pet.ownerName ? `飼い主: ${pet.ownerName}` : '',
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
    label: 'カルテを書く子を選ぶ',
    empty: 'まだ1頭も登録されていません。「② 新規」から登録してください。',
    testid: 'pick-pet',
    onBack: screenRepeat,
    onPick: (item) => { location.href = `/edit/p/${encodeURIComponent(item.pet.id)}`; },
  }));
}

function pickPetForRevise() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets),
    label: 'カルテを直す子を選ぶ',
    empty: 'まだ1頭も登録されていません。',
    testid: 'pick-pet',
    onBack: screenRepeat,
    onPick: (item) => pickReportForRevise(item.pet),
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
    onBack: pickPetForRevise,
    /* `?revise=1` を付けて④カルテ作成に入る。付けないと⑤確認（読むだけ）に着く。 */
    onPick: (item) => {
      location.href = `/edit/p/${encodeURIComponent(pet.id)}`
        + `/${encodeURIComponent(item.report.id)}?revise=1`;
    },
  }));
}

function screenNew() {
  clear();
  contentEl.append(backButton(screenHome));
  contentEl.append(heading('新規'));
  contentEl.append(menu([
    { title: '① 顧客アカウントの新規作成', note: '飼い主さまを登録する', testid: 'new-owner', onSelect: formNewOwner },
    { title: '② ペットアカウントの新規作成', note: '登録済みの飼い主さまに子を追加する', testid: 'new-pet', onSelect: formNewPet },
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

function submitButton(label, testid) {
  const button = el('button', 'boxbutton');
  button.type = 'button';
  button.dataset.adminAction = testid;
  button.append(el('span', null, label));
  return button;
}

function formNewOwner() {
  clear();
  contentEl.append(backButton(screenNew));
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
    contentEl.append(backButton(screenNew));
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
    const button = submitButton('登録する', 'create-pet');
    const result = el('p', 'admin-result');
    button.onclick = async () => {
      const name = input.value.trim();
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
          body: JSON.stringify({ ownerId, name, template: 'ponchi' }),
        });
        input.value = '';
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
  contentEl.append(backButton(screenHome));
  contentEl.append(heading('削除'));
  contentEl.append(note('ここでの削除は元に戻せません。写真も一緒に消えます。', true));
  contentEl.append(menu([
    {
      title: '① 顧客アカウント全データ削除',
      note: 'その飼い主さまと、ひもづく子・カルテ・写真をすべて消す',
      danger: true,
      testid: 'delete-owner',
      onSelect: pickOwnerForDelete,
    },
    {
      title: '② ペットアカウント全データ削除',
      note: 'その子と、その子のカルテ・写真をすべて消す',
      danger: true,
      testid: 'delete-pet',
      onSelect: pickPetForDelete,
    },
    {
      title: '③ カルテ1枚単位削除',
      note: 'その子のカルテを1枚だけ消す',
      danger: true,
      testid: 'delete-report',
      onSelect: pickPetForReportDelete,
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
    onBack: screenDelete,
    onPick: (item) => confirmDestructive({
      title: '顧客アカウント全データ削除',
      what: `${item.owner.name} さまと、ひもづく子・カルテ・写真をすべて消します。元に戻せません。`,
      /* 確認の画面にも**同じ見分けを出す**。名前を打たせるだけでは、同姓同名の
         どちらにも通ってしまい、押し間違いの歯止めにならない（`#36`）。 */
      detail: ownerNote(item.owner, pets, owners),
      name: item.owner.name,
      onBack: pickOwnerForDelete,
      /* **写真 → DB の順**（`D-20260824-34`）。逆にすると RLS の条件が崩れ、
         写真が誰からも取れない置き去りになる。 */
      onConfirm: async () => {
        await purgeOwnerAssets({ client: supabase, api, ownerId: item.owner.id });
        await api(`/api/owners/${encodeURIComponent(item.owner.id)}`, { method: 'DELETE' });
      },
    }),
  }));
}

function pickPetForDelete() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets).map((item) => ({ ...item, danger: true })),
    label: '全データを消す子を選ぶ',
    empty: '登録されている子がいません。',
    testid: 'pick-pet',
    onBack: screenDelete,
    onPick: (item) => confirmDestructive({
      title: 'ペットアカウント全データ削除',
      what: `${item.pet.name} と、その子のカルテ・写真をすべて消します。元に戻せません。`,
      detail: item.note,
      name: item.pet.name,
      onBack: pickPetForDelete,
      onConfirm: async () => {
        await purgePetAssets({ client: supabase, api, petId: item.pet.id });
        await api(`/api/pets/${encodeURIComponent(item.pet.id)}`, { method: 'DELETE' });
      },
    }),
  }));
}

function pickPetForReportDelete() {
  return withList(listPets, (pets) => picker({
    items: petItems(pets),
    label: 'カルテを消す子を選ぶ',
    empty: '登録されている子がいません。',
    testid: 'pick-pet',
    onBack: screenDelete,
    onPick: (item) => pickReportForDelete(item.pet),
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
    onBack: pickPetForReportDelete,
    onPick: (item) => confirmDestructive({
      title: 'カルテ1枚削除',
      what: `${pet.name} の ${item.report.report_date} のカルテと、その写真を消します。元に戻せません。`,
      name: pet.name,
      onBack: () => pickReportForDelete(pet),
      /* こちらは `deleteReportAssets` が「印を付ける → 写真を消す → 行を消す」まで
         通してやる（製品の削除の道そのもの。`verify:delete` が毎回確かめている）。 */
      onConfirm: () => deleteReportAssets({
        client: supabase, api, petId: pet.id, reportId: item.report.id,
      }),
    }),
  }));
}

/* ── 起動 ──────────────────────────────────────────────────────── */

export async function bootAdminPortal() {
  statusEl = document.querySelector('[data-portal-status]');
  contentEl = document.querySelector('[data-portal-content]');
  const loginPanel = document.querySelector('[data-login-panel]');
  const loginButton = document.querySelector('[data-google-login]');
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
      show(loginPanel, true);
      show(contentEl, false);
      setMessage(statusEl, 'Googleでログインしてください');
      loginButton.onclick = async () => {
        loginButton.disabled = true;
        const { error } = await signInWithGoogle(supabase, '/admin');
        if (error) {
          loginButton.disabled = false;
          setMessage(statusEl, 'ログインを完了できませんでした。もう一度お試しください');
        }
      };
      return;
    }

    const session = await api('/api/session');
    const isAdmin = (session.memberships || []).some((m) => m.role === 'admin');
    if (!isAdmin) {
      /* **管理者でない人をここに置かない。** ただし「権限がありません」とだけ出して
         行き止まりにもしない——その人が使える画面へ送る（`D-14` の問1）。 */
      const hasStaff = (session.memberships || []).length > 0;
      setMessage(statusEl, '管理者のアカウントではありません。');
      show(loginPanel, false);
      show(contentEl, true);
      clear();
      contentEl.append(menuItem({
        title: hasStaff ? 'カルテを書く画面へ' : 'マイカルテへ',
        note: 'この画面は管理者だけが使えます',
        testid: 'not-admin',
        onSelect: () => { location.href = hasStaff ? '/edit' : '/my'; },
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

    show(loginPanel, false);
    show(contentEl, true);
    show(signOutButton, true);
    setMessage(statusEl, '');
    signOutButton.onclick = async () => {
      await supabase.auth.signOut();
      /* 上と同じ。ログアウトの行き先は3画面とも入口（`/`）で揃える。 */
      location.replace('/');
    };
    screenHome();
  } catch (error) {
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

/**
 * ponchi-app.js — ポチ版B 階層ナビ + 作成フロー ルーティング
 *
 * 公開 API:
 *   window.PonchiApp.show(screen, params)
 *   window.PonchiApp.boot()
 *
 * 画面スタック:
 *   'owner'   — 犬の一覧（登録カルテ一覧） (#screen-owner)
 *   'archive' — 全月一覧               (#screen-archive)
 *   'report'  — H3 月別カルテ          (#screen-report)
 *
 * 2026-08-23: 肉球（月選択）画面を撤去した。マスター指定の動線
 * （ログイン→犬を選ぶ→カルテ作成→確認→顧客ページ）に無い層だったため。
 * 犬を選ぶと直接 archive（全月一覧）へ進む。
 */
(function () {
  'use strict';

  /* ── 内部状態 ─────────────────────────────────────────────── */
  var _current = null;
  var _params  = {};
  var _reportContext = null;
  var _supabaseDraftRetry = null;
  /* 新規カルテの初期化済みフラグ: 同一 slug+reportId での 2 回目以降の clearReport を防ぐ */
  var _clearedReportKey = null;

  /* ── 編集モード判定（閲覧モード = window.__VIEW__ が truthy / is-readonly）────── */
  function isEditMode() {
    return !window.__VIEW__ && !document.body.classList.contains('is-readonly');
  }

  function isSupabaseMode() {
    return window.__BACKEND__ === 'supabase';
  }

  function lockReportContext(context) {
    var petId = String((context && (context.petId || context.slug)) || '');
    if (!petId) return null;
    _reportContext = Object.freeze({
      petId: petId,
      ownerId: String((context && (context.ownerId || context.ownerSlug)) || ''),
      petName: String((context && context.petName) || ''),
    });
    window.__REPORT_CONTEXT__ = _reportContext;
    return _reportContext;
  }

  /* ── ユーティリティ ──────────────────────────────────────── */
  function show(el)  { if (el) el.style.display = 'block'; }
  function hide(el)  { if (el) el.style.display = 'none'; }
  function pathSegment(value) { return encodeURIComponent(String(value || '')); }

  /* ── params 正規化ヘルパー ───────────────────────────────── */
  /**
   * normalizeParams(p) → 平坦化された params
   *
   * 多重ネスト `p.params.params.params...` を解消し、
   * slug を持つ最も内側の有効 params を見つけて
   * ownerSlug / ownerData / months / petName を表層に引き上げる。
   *
   * 入力例: { slug:'x', params:{ slug:'x', ownerSlug:'o', params:{ slug:'x', ownerSlug:'o', params:{...} } } }
   * 出力例: { slug:'x', ownerSlug:'o', months:[], petName:'' }  ← 1 段のみ
   */
  function normalizeParams(p) {
    if (!p || typeof p !== 'object') return {};

    /* 最も内側の有効 params（slug を持つ）を掘り下げて見つける */
    var depth = 0;
    var cur = p;
    while (cur && cur.params && typeof cur.params === 'object' && depth < 20) {
      cur = cur.params;
      depth++;
    }
    /* cur が最も内側。slug がなければ p 自身を使う */
    var inner = (cur && cur.slug) ? cur : p;

    /* 外側→内側の順で各フィールドを合成（内側が優先） */
    var result = {};

    /* slug / reportId: 外から辿って最初に見つかった値 */
    result.slug     = p.slug     || inner.slug     || '';
    result.reportId = p.reportId || inner.reportId || '';

    /* petName: 外側優先 */
    result.petName  = p.petName  || inner.petName  || '';

    /* ownerSlug / ownerData: 外側→内側で最初に見つかった値 */
    result.ownerSlug = p.ownerSlug ||
                       (p.ownerData && p.ownerData.ownerSlug) ||
                       inner.ownerSlug ||
                       (inner.ownerData && inner.ownerData.ownerSlug) || '';
    result.ownerData = p.ownerData || inner.ownerData || null;

    /* months: 配列として存在する最初の値（外側優先） */
    if (Array.isArray(p.months)) {
      result.months = p.months;
    } else if (Array.isArray(inner.months)) {
      result.months = inner.months;
    }
    /* months 未定義の場合は undefined のまま（renderArchiveScreen で API fetch に fallback） */

    return result;
  }

  /* ── 全画面を隠す ────────────────────────────────────────── */
  function hideAll() {
    ['owner', 'archive', 'report'].forEach(function (s) {
      var el = document.getElementById('screen-' + s);
      if (el) el.style.display = 'none';
    });
  }

  /* ── API fetch ヘルパー（無認証 /api/*）────────────────────── */
  function apiRequest(path, options) {
    if (isSupabaseMode()) {
      if (!window.TrimmerStaffApi) return Promise.reject(new Error('authentication unavailable'));
      return window.TrimmerStaffApi.request(path, options);
    }
    return fetch(path, options).then(function (r) {
      if (!r.ok) throw new Error('fetch ' + path + ' => ' + r.status);
      return r.json();
    });
  }

  function apiFetch(path) {
    return apiRequest(path);
  }

  function apiPost(path, body) {
    return apiRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /* ── インライン入力フォームを生成する汎用ヘルパー ──────────── */
  /**
   * createInlineForm(opts) → Element
   * opts: { placeholder, submitLabel, onSubmit(value) }
   */
  function createInlineForm(opts) {
    var wrap = document.createElement('div');
    wrap.className = 'ponchi-inline-form';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ponchi-inline-input';
    input.placeholder = opts.placeholder || '';
    input.setAttribute('aria-label', opts.placeholder || '');

    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'ponchi-inline-submit';
    submitBtn.textContent = opts.submitLabel || '登録';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ponchi-inline-cancel';
    cancelBtn.textContent = 'キャンセル';

    var errEl = document.createElement('p');
    errEl.className = 'ponchi-inline-error';
    errEl.style.display = 'none';

    wrap.appendChild(input);
    wrap.appendChild(submitBtn);
    wrap.appendChild(cancelBtn);
    wrap.appendChild(errEl);

    function doSubmit() {
      var val = input.value.trim();
      if (!val) {
        errEl.textContent = '名前を入力してください。';
        errEl.style.display = 'block';
        input.focus();
        return;
      }
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      errEl.style.display = 'none';
      opts.onSubmit(val, function onError(msg) {
        errEl.textContent = msg || '登録に失敗しました。';
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
      });
    }

    submitBtn.addEventListener('click', doSubmit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSubmit();
      if (e.key === 'Escape' && opts.onCancel) opts.onCancel();
    });
    cancelBtn.addEventListener('click', function () {
      if (opts.onCancel) opts.onCancel();
    });

    return wrap;
  }

  /* ── 追加ボタン（＋ ラベル）を生成する汎用ヘルパー ─────────── */
  function createAddButton(label, className) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className || 'ponchi-add-btn';
    btn.setAttribute('aria-label', label);
    btn.innerHTML =
      '<span class="ponchi-add-icon" aria-hidden="true">＋</span>' +
      '<span class="ponchi-add-label">' + escHtml(label) + '</span>';
    return btn;
  }

  /* 削除ボタン（飼い主/犬の行に付与・編集モードのみ）。確認→DELETE→リロード */
  function makeDeleteBtn(confirmMsg, apiPath, aria) {
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'owner-pet-del';
    del.setAttribute('aria-label', aria);
    del.textContent = '🗑';
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!window.confirm(confirmMsg)) return;
      del.disabled = true;
      apiRequest(apiPath, { method: 'DELETE' })
        .then(function () { window.location.reload(); })
        .catch(function () { del.disabled = false; window.alert('削除に失敗しました。もう一度お試しください。'); });
    });
    return del;
  }

  /* owner-pet-row + owner-pet-item + icon/name/arrow の共通DOM生成
   * onDelete が関数で渡された場合のみ owner-pet-row ラッパを生成し
   * 編集モードで makeDeleteBtn 呼び出し結果を row に追加する。
   * onDelete なし（archive等）は item ボタンをそのまま返す。 */
  function createListItem(opts) {
    var item = document.createElement('button');
    item.className = 'owner-pet-item';
    item.setAttribute('type', 'button');
    item.setAttribute('aria-label', opts.ariaLabel);
    item.innerHTML =
      '<span class="owner-pet-icon" aria-hidden="true">' + opts.icon + '</span>' +
      '<span class="owner-pet-name">' + escHtml(opts.label) + '</span>' +
      '<span class="owner-pet-arrow" aria-hidden="true">›</span>';
    item.addEventListener('click', opts.onSelect);
    if (!opts.onDelete) return item;
    var row = document.createElement('div');
    row.className = 'owner-pet-row';
    row.appendChild(item);
    if (isEditMode()) row.appendChild(opts.onDelete());
    return row;
  }

  /* ════════════════════════════════════════════════════════════
   * H1 飼い主→犬名リスト
   * ════════════════════════════════════════════════════════════ */
  function renderOwnerScreen(params) {
    var sec = document.getElementById('screen-owner');
    if (!sec) return;

    var listEl = sec.querySelector('.owner-list');
    if (!listEl) return;

    /* 優先0: 犬の一覧をフラットに直接渡された場合（F2・Supabase の /edit）。
       「飼い主を選ぶ」層を挟まず、店舗の犬をそのまま並べる。空配列でも確実にこちらを通す。 */
    var petListFlat = (params && params.petListFlat);
    if (Array.isArray(petListFlat)) {
      renderFlatPetList(listEl, petListFlat);
      return;
    }

    var owner = (params && params.owner) || window.__OWNER__ || null;

    /* 優先1: Worker 注入の __OWNER__（単一飼い主）→ 犬一覧（pets が空配列でも確実に入る） */
    if (owner) {
      renderPetList(listEl, owner.pets || [], owner);
      return;
    }

    /* 優先2: Worker 注入の __OWNER_LIST__（編集モード飼い主一覧）→ 飼い主一覧 */
    var ownerList = (params && params.ownerList) || window.__OWNER_LIST__ || null;
    if (ownerList !== null) {
      renderOwnerIndexList(listEl, ownerList);
      return;
    }

    /* 優先3: ownerSlug が params にある → ページ遷移（Worker が __OWNER__ を注入）
       同一 URL への遷移は無限ループになるためガードを入れる */
    var ownerSlug = (params && params.ownerSlug) || '';
    if (ownerSlug) {
      var targetPath = (isEditMode() ? '/edit/o/' : '/o/') + pathSegment(ownerSlug);
      if (window.location.pathname !== targetPath) {
        window.location.href = targetPath;
      }
      return;
    }

    /* フォールバック: /api/owners fetch（ownerSlug も注入データも無い場合） */
    listEl.innerHTML = '<p class="owner-loading">読み込み中…</p>';
    apiFetch('/api/owners')
      .then(function (data) {
        var owners = Array.isArray(data) ? data : (data.owners || []);
        renderOwnerIndexList(listEl, owners);
      })
      .catch(function () {
        listEl.innerHTML = '<p class="owner-error">データを取得できませんでした。</p>';
      });
  }

  /* 犬の一覧を直接表示する（F2）。飼い主を選ぶ層を挟まない、/edit の唯一の入口。
     マスター指定の意匠見本（4ステップモックの「登録カルテ一覧」画面）に対応。 */
  function renderFlatPetList(listEl, pets) {
    listEl.innerHTML = '';

    var titleEl = document.getElementById('ownerTitle');
    if (titleEl) titleEl.innerHTML = '登録カルテ <em>一覧</em>';
    var subtitleEl = document.getElementById('ownerSubtitle');
    if (subtitleEl) subtitleEl.textContent = pets.length + '件';
    var backWrap = document.getElementById('ownerBackWrap');
    if (backWrap) backWrap.hidden = true;

    if (!pets.length) {
      var emptyEl = document.createElement('p');
      emptyEl.className = 'owner-empty';
      emptyEl.textContent = 'まだ犬が登録されていません。下のボタンから追加してください。';
      listEl.appendChild(emptyEl);
    }

    pets.forEach(function (pet) {
      var row = createListItem({
        icon:      '🐾',
        label:     pet.petName + (pet.ownerName ? '（' + pet.ownerName + ' 様）' : ''),
        ariaLabel: pet.petName + ' のカルテへ',
        onSelect:  function () {
          lockReportContext({ petId: pet.id, ownerId: pet.ownerId, petName: pet.petName });
          window.location.href = '/edit/p/' + pathSegment(pet.id);
        },
        onDelete:  function () {
          return makeDeleteBtn(
            pet.petName + ' のカルテをすべて削除します。よろしいですか？',
            '/api/pets/' + pathSegment(pet.id), pet.petName + ' を削除');
        },
      });
      listEl.appendChild(row);
    });

    /* ＋ 新規カルテを作成する: 犬の名前と飼い主名を1画面で受け取り、
       飼い主→犬の順に作成して編集画面へ進む。飼い主が1人もいない状態からでも
       ここだけで最初の1件を作れる。 */
    var addWrap = document.createElement('div');
    addWrap.className = 'ponchi-inline-form ponchi-new-karte-form';
    var petInput = document.createElement('input');
    petInput.type = 'text';
    petInput.placeholder = '犬のお名前';
    petInput.className = 'ponchi-inline-input';
    var ownerInput = document.createElement('input');
    ownerInput.type = 'text';
    ownerInput.placeholder = '飼い主のお名前';
    ownerInput.className = 'ponchi-inline-input';
    var errEl = document.createElement('p');
    errEl.className = 'ponchi-inline-error';
    errEl.style.display = 'none';
    var submitBtn = createAddButton('新規カルテを作成する', 'ponchi-add-btn cta');
    addWrap.appendChild(petInput);
    addWrap.appendChild(ownerInput);
    addWrap.appendChild(errEl);
    addWrap.appendChild(submitBtn);
    listEl.appendChild(addWrap);

    function fail(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
      submitBtn.disabled = false;
    }

    submitBtn.addEventListener('click', function () {
      var petName = petInput.value.trim();
      var ownerName = ownerInput.value.trim();
      if (!petName)   return fail('犬のお名前を入力してください。');
      if (!ownerName) return fail('飼い主のお名前を入力してください。');
      errEl.style.display = 'none';
      submitBtn.disabled = true;
      apiPost('/api/owners', { name: ownerName })
        .then(function (ownerBody) {
          var newOwner = ownerBody && ownerBody.owner;
          if (!newOwner || !newOwner.id) throw new Error('owner creation failed');
          return apiPost('/api/owners/' + pathSegment(newOwner.id) + '/pets', {
            ownerId: newOwner.id,
            name: petName,
            template: 'ponchi',
          });
        })
        .then(function (petBody) {
          var newPet = petBody && petBody.pet;
          if (!newPet || !newPet.id) throw new Error('pet creation failed');
          window.location.href = '/edit/p/' + pathSegment(newPet.id);
        })
        .catch(function () {
          fail('作成に失敗しました。もう一度お試しください。');
        });
    });
  }

  function renderPetList(listEl, pets, ownerData) {
    listEl.innerHTML = '';

    /* タイトル=「ワンちゃんページ」/ 飼い主ページ(/edit)へ戻るボタン（編集モードのみ表示）*/
    var _t = document.getElementById('ownerTitle');
    if (_t) _t.innerHTML = 'ワンちゃん <em>ページ</em>';
    var subtitleEl = document.getElementById('ownerSubtitle');
    if (subtitleEl) subtitleEl.textContent = 'ワンちゃんをお選びください';
    var _bw = document.getElementById('ownerBackWrap');
    var _bb = document.getElementById('ownerBackBtn');
    if (_bw) _bw.hidden = !isEditMode();
    if (_bb) _bb.onclick = function () { window.location.href = '/edit'; };

    /* 編集モード: 「＋ 新規犬登録」ボタン */
    if (isEditMode()) {
      var ownerSlug = (ownerData && ownerData.ownerSlug) || '';
      if (isSupabaseMode() && ownerSlug && window.TrimmerSupabaseStaff) {
        var inviteOwnerBtn = createAddButton('初回登録QRを発行', 'ponchi-add-btn');
        listEl.appendChild(inviteOwnerBtn);
        inviteOwnerBtn.addEventListener('click', function () {
          inviteOwnerBtn.disabled = true;
          window.TrimmerSupabaseStaff.showOwnerInvitation(ownerSlug, ownerData.ownerName)
            .catch(function () { window.alert('招待を発行できませんでした。'); })
            .finally(function () { inviteOwnerBtn.disabled = false; });
        });
      }
      var addBtn = createAddButton('新規犬登録', 'ponchi-add-btn cta');
      listEl.appendChild(addBtn);

      addBtn.addEventListener('click', function () {
        var form = createInlineForm({
          placeholder: '犬のお名前',
          submitLabel: '登録',
          onSubmit: function (petName, onError) {
            if (!ownerSlug) {
              onError('飼い主情報が見つかりません。');
              return;
            }
            var createPetPath = isSupabaseMode()
              ? '/api/owners/' + pathSegment(ownerSlug) + '/pets'
              : '/api/customers';
            var createPetBody = isSupabaseMode()
              ? { ownerId: ownerSlug, name: petName, template: 'ponchi' }
              : { petName: petName, ownerSlug: ownerSlug, template: 'ponchi' };
            apiPost(createPetPath, createPetBody)
              .then(function (data) {
                /* 登録成功 → 新規犬の全月一覧（空）に進む */
                var newPet = data && data.pet;
                var newSlug = (newPet && newPet.id) || (data && (data.petSlug || data.slug)) || '';
                if (newSlug) {
                  /* slug が取れた: 直接 archive（空）へ遷移 */
                  if (form.parentNode) form.parentNode.replaceChild(addBtn, form);
                  PonchiApp.show('archive', {
                    slug: newSlug,
                    petName: petName,
                    months: [],
                    ownerSlug: ownerSlug,
                    ownerData: ownerData,
                  });
                } else {
                  /* slug 不明: 犬一覧ページをリロードして再取得 */
                  window.location.href = '/edit/o/' + pathSegment(ownerSlug);
                }
              })
              .catch(function (err) {
                onError('登録に失敗しました: ' + err.message);
              });
          },
          onCancel: function () {
            if (form.parentNode) form.parentNode.replaceChild(addBtn, form);
          },
        });
        listEl.replaceChild(form, addBtn);
        form.querySelector('.ponchi-inline-input').focus();
      });
    }

    if (!pets || !pets.length) {
      var emptyEl = document.createElement('p');
      emptyEl.className = 'owner-empty';
      emptyEl.textContent = isEditMode()
        ? 'まだ犬が登録されていません。上のボタンから追加してください。'
        : '登録された犬がありません。';
      listEl.appendChild(emptyEl);
      return;
    }

    pets.forEach(function (pet) {
      listEl.appendChild(createListItem({
        icon:      '🐾',
        label:     pet.petName,
        ariaLabel: pet.petName + ' のカルテへ',
        onSelect:  function () {
          if (isSupabaseMode()) {
            lockReportContext({
              petId: pet.id || pet.slug,
              ownerId: pet.ownerId || (ownerData && ownerData.ownerSlug),
              petName: pet.petName,
            });
            /* /edit/p/{petId} へ遷移すると supabase-staff.js の route.name==='pet' が
               直接 archive を表示する。肉球（月選択）を経由しない。 */
            window.location.href = '/edit/p/' + pathSegment(pet.id || pet.slug);
            return;
          }
          PonchiApp.show('archive', { pet: pet, slug: pet.slug, petName: pet.petName, ownerData: ownerData });
        },
        onDelete:  function () {
          return makeDeleteBtn(
            pet.petName + ' のカルテをすべて削除します。よろしいですか？',
            (isSupabaseMode() ? '/api/pets/' : '/api/customers/') + pathSegment(pet.slug), pet.petName + ' を削除');
        },
      }));
    });
  }

  function renderOwnerIndexList(listEl, owners) {
    listEl.innerHTML = '';

    /* タイトル=「飼い主ページ」/ 戻るボタンは非表示（最上位画面） */
    var _t = document.getElementById('ownerTitle');
    if (_t) _t.innerHTML = '飼い主 <em>ページ</em>';
    var subtitleEl = document.getElementById('ownerSubtitle');
    if (subtitleEl) subtitleEl.textContent = '飼い主をお選びください';
    var _bw = document.getElementById('ownerBackWrap');
    if (_bw) _bw.hidden = true;

    /* 編集モード: 「＋ 新規飼い主登録」ボタン */
    if (isEditMode()) {
      if (isSupabaseMode() && window.TrimmerSupabaseStaff && window.TrimmerSupabaseStaff.isAdmin()) {
        var staffBtn = createAddButton('スタッフ管理', 'ponchi-add-btn');
        listEl.appendChild(staffBtn);
        staffBtn.addEventListener('click', function () {
          staffBtn.disabled = true;
          window.TrimmerSupabaseStaff.showStaffManager()
            .catch(function () { window.alert('スタッフ情報を表示できませんでした。'); })
            .finally(function () { staffBtn.disabled = false; });
        });
      }
      var addBtn = createAddButton('新規飼い主登録', 'ponchi-add-btn cta');
      listEl.appendChild(addBtn);

      addBtn.addEventListener('click', function () {
        /* ボタンをフォームに差し替え */
        var form = createInlineForm({
          placeholder: '飼い主のお名前',
          submitLabel: '登録',
          onSubmit: function (ownerName, onError) {
            apiPost('/api/owners', isSupabaseMode() ? { name: ownerName } : { ownerName: ownerName })
              .then(function (data) {
                /* 登録成功 → 作成した飼い主の犬一覧へ。
                   KV は結果整合性のため /edit/o/{slug} へページ遷移すると
                   書込直後の読込が古く（飼い主未反映＝飼い主一覧＝新規登録画面に戻る）。
                   登録結果から直接 owner 画面（犬一覧・空）を描画して回避する。 */
                var createdOwner = data && data.owner;
                var slug = (createdOwner && createdOwner.id) || (data && data.ownerSlug) || (data && data.slug) || '';
                if (slug) {
                  PonchiApp.show('owner', {
                    owner: {
                      ownerSlug: slug,
                      ownerName: (createdOwner && createdOwner.name) || (data && data.ownerName) || ownerName,
                      pets: [],
                    },
                  });
                } else {
                  window.location.reload();
                }
              })
              .catch(function (err) {
                onError('登録に失敗しました: ' + err.message);
              });
          },
          onCancel: function () {
            /* フォームを除去して addBtn を復元 */
            if (form.parentNode) form.parentNode.replaceChild(addBtn, form);
          },
        });
        listEl.replaceChild(form, addBtn);
        form.querySelector('.ponchi-inline-input').focus();
      });
    }

    if (!owners || !owners.length) {
      var emptyEl = document.createElement('p');
      emptyEl.className = 'owner-empty';
      emptyEl.textContent = isEditMode()
        ? 'まだ飼い主が登録されていません。上のボタンから追加してください。'
        : '飼い主が登録されていません。';
      listEl.appendChild(emptyEl);
      return;
    }

    owners.forEach(function (ow) {
      listEl.appendChild(createListItem({
        icon:      '🐾',
        label:     ow.ownerName,
        ariaLabel: ow.ownerName + ' のページへ',
        onSelect:  (function (slug) {
          return function () {
            /* 編集モード: /edit/o/{ownerSlug} へページ遷移（Worker が __OWNER__ を注入する） */
            /* 閲覧モード: /o/{ownerSlug} へページ遷移（同様に __OWNER__ 注入） */
            window.location.href = (isEditMode() ? '/edit/o/' : '/o/') + pathSegment(slug);
          };
        })(ow.ownerSlug),
        onDelete:  function () {
          return makeDeleteBtn(
            ow.ownerName + ' と、その犬・カルテをすべて削除します。よろしいですか？',
            '/api/owners/' + pathSegment(ow.ownerSlug), ow.ownerName + ' を削除');
        },
      }));
    });
  }
  /* ════════════════════════════════════════════════════════════
   * アーカイブ（全月一覧）
   * ════════════════════════════════════════════════════════════ */
  function renderArchiveScreen(params) {
    var sec = document.getElementById('screen-archive');
    if (!sec) return;

    var listEl = sec.querySelector('.archive-list');
    if (!listEl) return;

    var slug   = (params && params.slug) || '';
    var months = (params && params.months) || [];

    /* 「戻る」ボタン: 編集モードは犬の一覧（/edit）へ。閲覧モードは飼い主ページへ。 */
    var backBtn = document.getElementById('archiveBackBtn');
    if (backBtn) {
      backBtn.onclick = function () {
        if (isEditMode()) {
          window.location.href = '/edit';
          return;
        }
        var np = normalizeParams(params);
        var ownerSlug = np.ownerSlug;
        if (ownerSlug) window.location.href = '/o/' + pathSegment(ownerSlug);
      };
    }

    /* 犬名 */
    var titleEl = sec.querySelector('.archive-pet-name');
    var petName = (params && params.petName) || '';
    if (titleEl) titleEl.textContent = petName;

    /* months が配列として渡された場合はそのまま表示（空配列も含む）*/
    if (Array.isArray(months)) {
      renderArchiveList(listEl, months, slug, params);
      return;
    }

    if (!slug) {
      renderArchiveList(listEl, [], slug, params);
      return;
    }

    /* months が未定義の場合のみ Worker から取得（/api/customers/{slug}）*/
    listEl.innerHTML = '<p class="owner-loading">読み込み中…</p>';
    apiFetch('/api/customers/' + pathSegment(slug))
      .then(function (data) {
        /* Worker は customers/{slug}.json を返す: {slug, petName, months:{YYYY-MM:[{reportId,...}]}} */
        var monthsMap = (data && data.months) || {};
        var flatMonths = [];
        Object.keys(monthsMap).sort().reverse().forEach(function (mk) {
          var entries = monthsMap[mk] || [];
          if (entries.length) {
            var latest = entries.slice().sort(function (a, b) {
              return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
            })[0];
            flatMonths.push({ monthKey: mk, reportId: latest.reportId, date: latest.date });
          }
        });
        renderArchiveList(listEl, flatMonths, slug, params);
      })
      .catch(function () {
        /* /api/customers/{slug} が未実装の場合でも空一覧で表示（新規犬登録直後はここ通過で正常） */
        renderArchiveList(listEl, [], slug, params);
      });
  }

  function renderArchiveList(listEl, months, slug, archiveParams) {
    listEl.innerHTML = '';

    /* 編集モード: 「＋ 新規カルテ作成」ボタン */
    if (isEditMode()) {
      var addBtn = createAddButton('新規カルテ作成', 'archive-new-btn ponchi-add-btn cta');
      listEl.appendChild(addBtn);
      addBtn.addEventListener('click', function () {
        /* normalizeParams で archiveParams を平坦化して case4 に渡す。
           params キーは付けない（バグ4: ネスト増殖を防ぐ） */
        var ap = normalizeParams(archiveParams);
        showCreateFlow(4, {
          slug:      slug       || ap.slug,
          reportId:  'new',
          petName:   ap.petName || (archiveParams && archiveParams.petName) || '',
          months:    Array.isArray(ap.months) ? ap.months : (Array.isArray(archiveParams && archiveParams.months) ? archiveParams.months : undefined),
          ownerSlug: ap.ownerSlug,
          ownerData: ap.ownerData,
        });
      });
    }

    if (!months || !months.length) {
      var emptyEl = document.createElement('p');
      emptyEl.className = 'archive-empty';
      emptyEl.textContent = isEditMode()
        ? 'カルテがまだありません。上のボタンから作成してください。'
        : '記録がまだありません。';
      listEl.appendChild(emptyEl);
      return;
    }

    months.forEach(function (month) {
      listEl.appendChild(createListItem({
        icon:      '📋',
        label:     month.dateLabel || month.date || '',
        ariaLabel: (month.dateLabel || month.date || '') + ' のカルテへ',
        onSelect:  (function (m) {
          return function () {
            if (isSupabaseMode()) {
              window.location.href = '/edit/p/' + pathSegment(slug) + '/' + pathSegment(m.reportId);
              return;
            }
            /* normalizeParams で archiveParams を平坦化して report に渡す。
               params キーは付けない（バグ4: ネスト増殖を防ぐ） */
            var ap = normalizeParams(archiveParams);
            PonchiApp.show('report', {
              slug:      slug       || ap.slug,
              reportId:  m.reportId,
              petName:   ap.petName || (archiveParams && archiveParams.petName) || '',
              months:    Array.isArray(ap.months) ? ap.months : (Array.isArray(archiveParams && archiveParams.months) ? archiveParams.months : undefined),
              ownerSlug: ap.ownerSlug,
              ownerData: ap.ownerData,
            });
          };
        })(month),
        // onDelete なし → createListItem は row ラッパなしで item を直接返す（archive は行削除なし）
      }));
    });
  }

  /* ════════════════════════════════════════════════════════════
   * H3 月別カルテ
   * ════════════════════════════════════════════════════════════ */

  /**
   * clearReport()
   * DOM 上のデモ値をすべて空/初期状態にリセットする。
   * 新規作成時（reportId === 'new'）に呼ぶ。
   * applyReport の逆写像として、フィールドを空文字・選択解除・体重ゼロクリアする。
   */
  function clearReport() {
    /* data-field テキストを空に */
    var fieldNames = ['pet', 'date', 'year', 'best-weight', 'bm-title',
      'trimming-comment', 'body-language-comment',
      'teeth-comment', 'ear-comment', 'nail-comment'];
    fieldNames.forEach(function (name) {
      var el = document.querySelector('[data-field="' + name + '"]');
      if (el) el.textContent = '';
    });

    /* 皮膚チェック 1-10 */
    for (var i = 1; i <= 10; i++) {
      var locEl = document.querySelector('[data-field="skin-loc-' + i + '"]');
      if (locEl) locEl.textContent = '';
      var sizeEl = document.querySelector('[data-field="skin-size-' + i + '"]');
      if (sizeEl) sizeEl.textContent = '';
      document.querySelectorAll('.sk-pick[data-skin-type="' + i + '"]').forEach(function (el) {
        el.classList.remove('is-picked');
      });
      document.querySelectorAll('.sk-pick[data-skin-change="' + i + '"]').forEach(function (el) {
        el.classList.remove('is-picked');
      });
    }

    /* options: 全て off */
    document.querySelectorAll('.opt').forEach(function (el) {
      el.classList.remove('on');
      var chk = el.querySelector('.chk');
      if (chk) chk.textContent = '';
    });

    /* 体重グラフ: 空配列にセット */
    if (typeof window.__SALTYDOG_SET_WEIGHTS === 'function') {
      window.__SALTYDOG_SET_WEIGHTS([]);
    }

    /* 耳: 全選択解除 */
    document.querySelectorAll('.ear-cell').forEach(function (el) {
      el.classList.remove('is-picked');
    });

    /* 爪: 全選択解除 */
    document.querySelectorAll('.nail-lv').forEach(function (el) {
      el.classList.remove('is-picked');
    });

    /* 歯: 全選択解除 */
    document.querySelectorAll('.tt-pick').forEach(function (el) {
      el.classList.remove('is-picked');
    });

    /* 写真スロット: デモ Unsplash 画像をプレースホルダ（空）へ。
       編集モードでは .photo-upload-trigger ラッパを生成して「＋ 写真を追加」を表示する。 */
    var photoKeys = ['hero-1', 'hero-2', 'bl-1', 'bl-2', 'bl-3',
      'trim-1', 'trim-2', 'teeth-real'];
    photoKeys.forEach(function (key) {
      var img = document.querySelector('img[data-photo="' + key + '"]');
      if (img) {
        img.src = '';
        /* 編集モード: 空スロットに「＋ 写真を追加」data 属性を付けて CSS で表示 */
        if (isEditMode()) {
          img.setAttribute('data-empty', '1');
        }
      }
      if (window.SaltyDogPonchiPhoto && typeof window.SaltyDogPonchiPhoto.set === 'function') {
        window.SaltyDogPonchiPhoto.set(key, '');
      }
    });
  }

  /**
   * showCommitBar(params)
   * 編集モードの report 画面下部に「確定」バーを表示する。
   * 押下で showCreateFlow(5, ...) → 確認ページ → 公開。
   */
  function showCommitBar(params) {
    /* 既存バーがあれば除去 */
    var existing = document.getElementById('ponchi-commit-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'ponchi-commit-bar';
    bar.className = 'ponchi-confirm-bar';
    bar.innerHTML =
      '<p class="ponchi-confirm-msg">編集が完了したら「確定」を押してください。</p>' +
      '<div class="ponchi-confirm-actions">' +
      '  <button type="button" class="ponchi-btn-redo" id="ponchi-commit-back">‹ 戻る</button>' +
      '  <button type="button" class="ponchi-btn-pub" id="ponchi-commit-ok">確定 →</button>' +
      '</div>';

    /* archive へ戻る際は normalizeParams で平坦化したコンテキストを使う。
       前任の (params.params || params) フォールバックを正規化呼出に置換 */
    var archiveCtx = normalizeParams(params);
    bar.querySelector('#ponchi-commit-back').addEventListener('click', function () {
      bar.remove();
      PonchiApp.show('archive', {
        slug:      archiveCtx.slug,
        months:    Array.isArray(archiveCtx.months) ? archiveCtx.months : undefined,
        petName:   archiveCtx.petName,
        ownerSlug: archiveCtx.ownerSlug,
        ownerData: archiveCtx.ownerData,
      });
    });
    bar.querySelector('#ponchi-commit-ok').addEventListener('click', function () {
      bar.remove();
      showCreateFlow(5, params);
    });

    var sec = document.getElementById('screen-report');
    if (sec) sec.appendChild(bar);
  }

  function renderReportScreen(params) {
    var slug     = (params && params.slug) || '';
    var reportId = (params && params.reportId) || '';

    /* 「戻る」ボタン: 全月一覧（archive）へ直接戻る。
       以前は「飼い主ページ/犬ページ/月選択」を選ばせるドロワーだったが、
       階層をフラット化した（F2）のでその3択自体が意味を持たなくなった。 */
    var backBtn = document.getElementById('reportBackBtn');
    if (backBtn) {
      backBtn.onclick = function () {
        document.body.classList.remove('is-readonly');
        window.location.href = isEditMode()
          ? '/edit/p/' + pathSegment(slug)
          : '/p/' + pathSegment(slug) + '/all';
      };
    }

    /* 新規作成モード: reportId が 'new' の場合は空ひな形にリセットして編集開始 */
    if (reportId === 'new') {
      /* 同一セッションで既にクリア済みの場合（プレビュー→やり直しで戻った等）はスキップ */
      var clearKey = (slug || '') + '/new';
      if (_clearedReportKey !== clearKey) {
        _clearedReportKey = clearKey;
        clearReport();
      }
      if (isSupabaseMode() && _reportContext) {
        var scopedPetName = document.querySelector('[data-field="pet"]');
        if (scopedPetName) scopedPetName.textContent = _reportContext.petName;
      }
      /* 編集モードの場合は確定バーを表示 */
      if (isEditMode()) {
        showCommitBar(params);
      }
      return;
    }

    /* Worker 注入の __REPORT__ がある場合はそのまま applyReport */
    if (window.__REPORT__ && window.SaltyDogPonchi) {
      window.SaltyDogPonchi.applyReport(window.__REPORT__);
      /* 編集モード（__VIEW__ なし）の場合は確定バーを表示 */
      if (isEditMode() && !isSupabaseMode()) {
        showCommitBar(params);
      }
      if (isEditMode() && isSupabaseMode()) showSupabaseDeleteBar(slug, reportId);
      return;
    }

    /* デモ月（カルテ未登録の指・肉球）は実体を持たない。'demo-N' は publishReport 側でも
       「既存カルテではない」と扱われる（isExistingEdit の判定）。ここで fetch すると Worker の
       reportId 検証に弾かれて 400 が返り、静的なデモ内容が出たままコンソールにだけエラーが
       残る。投げずに、そのままデモ内容を見せて編集バーだけ出す。 */
    if (reportId && reportId.indexOf('demo-') === 0) {
      if (isEditMode() && !isSupabaseMode()) {
        showCommitBar(params);
      }
      return;
    }

    /* fetch して applyReport（犬別データ読み出し: /api/reports/{slug}/{reportId}）*/
    if (slug && reportId) {
      var reportPath = isSupabaseMode()
        ? '/api/pets/' + pathSegment(slug) + '/reports/' + pathSegment(reportId)
        : '/api/reports/' + pathSegment(slug) + '/' + pathSegment(reportId);
      apiFetch(reportPath)
        .then(function (data) {
          /* Worker は { reportId, date, year, publishedAt, report } 形式で返す */
          var reportData = (data && data.report && data.report.data) ? data.report.data : ((data && data.report) ? data.report : data);
          if (window.SaltyDogPonchi) window.SaltyDogPonchi.applyReport(reportData);
          /* 編集モードの場合は確定バーを表示 */
          if (isEditMode() && !isSupabaseMode()) {
            showCommitBar(params);
          }
          if (isEditMode() && isSupabaseMode()) showSupabaseDeleteBar(slug, reportId);
        })
        .catch(function () {
          console.warn('[PonchiApp] report fetch failed:', slug, reportId);
          /* fetch 失敗時も編集モードなら確定バーは表示（編集を続行可能にする） */
          if (isEditMode() && !isSupabaseMode()) showCommitBar(params);
        });
    }
  }

  function showSupabaseDeleteBar(petId, reportId) {
    if (!petId || !reportId || reportId === 'new' || document.getElementById('supabase-delete-report')) return;
    var sec = document.getElementById('screen-report');
    if (!sec) return;
    var button = document.createElement('button');
    button.id = 'supabase-delete-report';
    button.type = 'button';
    button.className = 'ponchi-btn-redo';
    button.textContent = 'このカルテを削除';
    button.addEventListener('click', function () {
      if (!window.confirm('このカルテと写真を削除します。よろしいですか？')) return;
      button.disabled = true;
      window.TrimmerSupabaseStorage.deleteReportAssets({
        client: window.TrimmerAuth.client,
        api: apiRequest,
        petId: petId,
        reportId: reportId,
      }).then(function () {
        window.location.href = '/edit/p/' + pathSegment(petId);
      }).catch(function () {
        button.disabled = false;
        window.alert('写真またはカルテの削除が完了していません。同じボタンから再試行してください。');
      });
    });
    sec.appendChild(button);
  }

  /* ════════════════════════════════════════════════════════════
   * 作成フロー 7 ステップ
   * ════════════════════════════════════════════════════════════
   * Step 1: 飼い主一覧   → show('owner')
   * Step 2: 犬一覧       → show('owner', {ownerSlug})
   * Step 3: 犬の全月一覧 → show('archive', {slug}) に [新規] ボタン付き
   * Step 4: 単月編集     → show('report', {slug, reportId})
   * Step 5: 最終確認     → showConfirm()
   * Step 6: 閲覧プレビュー→ __VIEW__ = true + show('report')
   * Step 7: 確定/やり直す → publishReport() / show('report', edit)
   */

  function showCreateFlow(step, context) {
    context = context || {};
    switch (step) {
      case 1:
        /* 編集モードの飼い主一覧はページ遷移（Worker が __OWNER_LIST__ を最新注入）
           /edit と /edit/ はどちらも Worker の handleEditIndex を呼ぶ */
        window.location.href = '/edit';
        break;
      case 2:
        /* 編集モードの犬一覧はページ遷移（Worker が __OWNER__ を最新注入・注入データへの吸収を防ぐ） */
        if (context.ownerSlug) {
          window.location.href = '/edit/o/' + pathSegment(context.ownerSlug);
        } else {
          window.location.href = '/edit';
        }
        break;
      case 3:
        showArchiveWithNew(context);
        break;
      case 4:
        /* normalizeParams で context を平坦化してから report へ渡す。
           params キーは付けない（バグ4: context.params || context によるネスト増殖の根本解消） */
        var c4 = normalizeParams(context);
        if (isSupabaseMode()) {
          lockReportContext({
            petId: context.slug || c4.slug,
            ownerId: context.ownerId || context.ownerSlug || c4.ownerSlug,
            petName: context.petName || c4.petName,
          });
        }
        PonchiApp.show('report', {
          slug:      context.slug      || c4.slug,
          reportId:  context.reportId  || c4.reportId,
          petName:   context.petName   || c4.petName,
          months:    Array.isArray(context.months) ? context.months : (Array.isArray(c4.months) ? c4.months : undefined),
          ownerSlug: context.ownerSlug || c4.ownerSlug,
          ownerData: context.ownerData || c4.ownerData,
        });
        break;
      case 5:
        showConfirm(context);
        break;
      case 6:
        showPreview(context);
        break;
      case 7:
        publishReport(context);
        break;
    }
  }

  function showArchiveWithNew(context) {
    /* 編集モードのみ新規作成ボタンを出す。閲覧モードは通常のアーカイブ表示のみ。
       renderArchiveList 内の isEditMode() 判定で自動制御されるため show するだけでよい。 */
    PonchiApp.show('archive', context);
  }

  /**
   * showConfirm(context)
   * Step 5: 最終確認バーを表示する。
   * 「プレビューを見る」→ Step 6 (showPreview) へ遷移。
   * 「やり直す」→ Step 4 (編集) へ戻る。
   * ※「確定（公開）」ボタンは showPreview 内に置き、プレビューを経由してから公開する。
   */
  function showConfirm(context) {
    var sec = document.getElementById('screen-report');
    if (!sec) return;

    /* 確認バーが既にあれば除去してから再追加 */
    var existing = document.getElementById('ponchi-confirm-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'ponchi-confirm-bar';
    bar.className = 'ponchi-confirm-bar';
    bar.innerHTML =
      '<p class="ponchi-confirm-msg">内容を確認してください。問題なければプレビューへ進んでください。</p>' +
      '<div class="ponchi-confirm-actions">' +
      '  <button type="button" class="ponchi-btn-redo">やり直す</button>' +
      '  <button type="button" class="ponchi-btn-pub">プレビューを確認 →</button>' +
      '</div>';

    bar.querySelector('.ponchi-btn-redo').addEventListener('click', function () {
      bar.remove();
      /* 編集モードに戻す（is-readonly が付いていたら除去） */
      document.body.classList.remove('is-readonly');
      showCreateFlow(4, context);
    });
    bar.querySelector('.ponchi-btn-pub').addEventListener('click', function () {
      bar.remove();
      showCreateFlow(6, context);
    });

    sec.appendChild(bar);
  }

  /**
   * showPreview(context)
   * Step 6: 閲覧プレビュー。is-readonly を付与して表示し、
   * 「確定（公開）」と「やり直す」の確定バーを表示する。
   * 「確定（公開）」→ Step 7 (publishReport)。
   * 「やり直す」→ 編集モードに戻り Step 4。
   */
  function showPreview(context) {
    /* プレビューは is-readonly で .bm-konva(線あり)を隠し .bm-single を表示する。
       切替前に描画(Konva)を静止画化して .bm-single に流し込む（公開ページの applyReport と同等処理）。
       これをしないと .bm-single が元の素図(線なし)のまま＝プレビューに描画線が出ない（真因）。 */
    try {
      [['__SALTYDOG_BM', '#bm-canvas-wrap .bm-single'], ['__SALTYDOG_TEETH', '#tt-canvas-wrap .bm-single'], ['__SALTYDOG_TC', '#tc-canvas-wrap .bm-single'], ['__SALTYDOG_TCN', '#tcn-canvas-wrap .bm-single']].forEach(function (p) {
        var inst = window[p[0]];
        if (inst && typeof inst.exportImage === 'function') {
          var url = inst.exportImage();
          if (url) {
            var el = document.querySelector(p[1]);
            if (el) el.src = url;
          } else {
            console.warn('showPreview: exportImage empty for', p[0]);
            var failEl = document.querySelector(p[1]);
            if (failEl && failEl.parentElement && !failEl.parentElement.querySelector('[data-preview-warn]')) {
              var warn = document.createElement('p');
              warn.setAttribute('data-preview-warn', '1');
              warn.style.cssText = 'color:#e85c5c;font-size:0.75rem;margin:4px 0';
              warn.textContent = '描画プレビューの読み込みに失敗しました';
              failEl.parentElement.appendChild(warn);
            }
          }
        }
      });
    } catch (e) { console.warn('showPreview: exportImage failed', e); }
    /* is-readonly を付与して閲覧モードに切替 */
    document.body.classList.add('is-readonly');
    PonchiApp.show('report', context);

    var sec = document.getElementById('screen-report');
    if (!sec) return;

    /* 既存の確認バーを除去してから確定バーを追加 */
    var existing = document.getElementById('ponchi-confirm-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'ponchi-confirm-bar';
    bar.className = 'ponchi-confirm-bar';
    bar.innerHTML =
      '<p class="ponchi-confirm-msg">これがお客様に届く内容です。よろしければ公開してください。</p>' +
      '<div class="ponchi-confirm-actions">' +
      '  <button type="button" class="ponchi-btn-redo">やり直す</button>' +
      '  <button type="button" class="ponchi-btn-pub">確定（公開）</button>' +
      '</div>';

    bar.querySelector('.ponchi-btn-redo').addEventListener('click', function () {
      bar.remove();
      /* 編集モードに戻す */
      document.body.classList.remove('is-readonly');
      showCreateFlow(4, context);
    });
    bar.querySelector('.ponchi-btn-pub').addEventListener('click', function () {
      showCreateFlow(7, context);
    });

    sec.appendChild(bar);
  }

  function publishReport(context) {
    /* slug は作成フローで既に選択済みの犬のスラッグ。顧客選択ステップは経由しない。 */
    var slug = isSupabaseMode() && _reportContext ? _reportContext.petId : (context.slug || '');
    /* 既存編集（reportId が実IDフォーマット）の場合は同一 reportId で上書き更新。
       'new' / 'demo-' プレフィクスは新規発行（Worker が body.reportId なしで新規生成）。 */
    var existingId = context.reportId || '';
    var isExistingEdit = !!existingId && existingId !== 'new' && existingId.indexOf('demo-') !== 0;
    if (!slug) {
      alert('犬の情報が見つかりません。フローをやり直してください。');
      return;
    }

    /* publish-client-ponchi.js の extractReport で DOM → JSON 変換 */
    var report = null;
    if (window.SaltyDogPonchi && typeof window.SaltyDogPonchi.extractReport === 'function') {
      report = window.SaltyDogPonchi.extractReport();
    }
    if (!report) {
      console.warn('[PonchiApp] extractReport が利用できません');
      alert('レポートの読み取りに失敗しました。ページを再読み込みしてください。');
      return;
    }

    if (isSupabaseMode()) {
      if (!_reportContext || _reportContext.petId !== slug) {
        alert('犬の選択状態を確認できません。カルテ一覧からやり直してください。');
        return;
      }
      if (isExistingEdit) {
        alert('確定済みカルテは直接上書きできません。新しいカルテとして追加してください。');
        return;
      }
      report = Object.assign({}, report, { pet: _reportContext.petName });
    }

    var rawDate = isSupabaseMode() ? String(report.date || '').trim() : '';
    var dateMatch = isSupabaseMode() ? rawDate.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/) : null;
    if (isSupabaseMode() && !dateMatch) {
      alert('日付を YYYY/MM/DD の形式で入力してください。');
      return;
    }

    /* 確認バーのボタンを無効化して二重送信を防ぐ */
    var bar = document.getElementById('ponchi-confirm-bar');
    if (bar) {
      var btns = bar.querySelectorAll('button');
      btns.forEach(function (b) { b.disabled = true; });
      var msg = bar.querySelector('.ponchi-confirm-msg');
      if (msg) msg.textContent = '公開中…';
    }

    var publishRequest;
    if (isSupabaseMode()) {
      var reportDate = dateMatch[1] + '-' + String(dateMatch[2]).padStart(2, '0') + '-' + String(dateMatch[3]).padStart(2, '0');
      publishRequest = (async function () {
        var retry = _supabaseDraftRetry;
        if (!retry || retry.petId !== slug || retry.reportDate !== reportDate) {
          var transformed = await window.TrimmerSupabaseStorage.replaceDataUrlAssets(report);
          var created = await apiPost('/api/pets/' + pathSegment(slug) + '/reports', {
            petId: slug,
            reportDate: reportDate,
            data: {},
          });
          retry = {
            petId: slug,
            reportDate: reportDate,
            draft: created.report,
            data: transformed.data,
            assets: transformed.assets,
          };
          _supabaseDraftRetry = retry;
        }
        await window.TrimmerSupabaseStorage.uploadReportAssets({
          client: window.TrimmerAuth.client,
          api: apiRequest,
          report: retry.draft,
          petId: slug,
          assets: retry.assets,
        });
        await apiRequest('/api/pets/' + pathSegment(slug) + '/reports/' + pathSegment(retry.draft.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: retry.data }),
        });
        await apiPost('/api/pets/' + pathSegment(slug) + '/reports/' + pathSegment(retry.draft.id) + '/finalize', {});
        _supabaseDraftRetry = null;
        return { reportId: retry.draft.id };
      })();
    } else {
      /* POST /api/reports — KVデモ版。body に slug を含める（Worker が顧客特定に使う） */
      publishRequest = apiRequest('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug:     slug,
        date:     report.date  || '',
        year:     report.year  || '',
        report:   report,
        reportId: isExistingEdit ? existingId : undefined,
      }),
      })
    }
    publishRequest
      .then(function (data) {
        var newId = (data && data.reportId) || '';
        /* 確認バーを除去 */
        if (bar) bar.remove();
        /* Supabaseは認証済み顧客URL、KVデモ版は従来の公開URL */
        var pubUrl = isSupabaseMode()
          ? ('/my/pets/' + pathSegment(slug) + '/reports/' + pathSegment(newId))
          : (newId ? ('/p/' + pathSegment(slug) + '/' + pathSegment(newId)) : ('/p/' + pathSegment(slug)));
        var notice = document.createElement('div');
        notice.className = 'ponchi-publish-notice';
        notice.innerHTML =
          '<p>公開しました！</p>' +
          '<a href="' + escHtml(pubUrl) + '" class="ponchi-pub-link">公開ページを見る →</a>';
        var sec = document.getElementById('screen-report');
        if (sec) sec.appendChild(notice);
      })
      .catch(function (err) {
        console.error('[PonchiApp] publish error:', err);
        /* ボタンを再有効化 */
        if (bar) {
          var btns2 = bar.querySelectorAll('button');
          btns2.forEach(function (b) { b.disabled = false; });
          var msg2 = bar.querySelector('.ponchi-confirm-msg');
          if (msg2) msg2.textContent = 'これがお客様に届く内容です。よろしければ公開してください。';
        }
        alert(isSupabaseMode() && _supabaseDraftRetry
          ? '保存途中の下書きを残しました。同じ画面で、もう一度「確定」を押すと続きから再試行します。'
          : '公開に失敗しました。もう一度お試しください。');
      });
  }

  /* ════════════════════════════════════════════════════════════
   * メイン切替 API
   * ════════════════════════════════════════════════════════════ */
  var PonchiApp = {

    /**
     * show(screen, params)
     * screen: 'owner' | 'archive' | 'report'
     */
    show: function (screen, params) {
      _current = screen;
      _params  = params || {};
      hideAll();

      var sec = document.getElementById('screen-' + screen);
      if (!sec) {
        console.warn('[PonchiApp] screen not found:', screen);
        return;
      }
      show(sec);

      switch (screen) {
        case 'owner':
          renderOwnerScreen(_params);
          break;
        case 'archive':
          renderArchiveScreen(_params);
          break;
        case 'report':
          renderReportScreen(_params);
          /* screen-report が hide→show されると clientWidth が復元するため
             Konva ステージを直接 refresh する。
             旧実装の dispatchEvent(resize) はresizeリスナーを通じて
             Konva stage.size()→canvas clear→redraw のフラッシュ（チカチカ）を
             show 呼出のたびに引き起こしていた（バグ修正 2026-06-04）。
             __SALTYDOG_BM / __SALTYDOG_TEETH は ponchi-v2.html が公開する refresh API。 */
          requestAnimationFrame(function () {
            if (window.__SALTYDOG_BM && window.__SALTYDOG_BM.refresh) window.__SALTYDOG_BM.refresh();
            if (window.__SALTYDOG_TEETH && window.__SALTYDOG_TEETH.refresh) window.__SALTYDOG_TEETH.refresh();
          });
          break;
      }
    },

    /**
     * boot() — 契約#3: 起動時 window.__SCREEN__ に従い初期表示
     */
    boot: function () {
      if (isSupabaseMode()) {
        if (window.TrimmerSupabaseStaff) {
          window.TrimmerSupabaseStaff.boot(this);
        } else {
          var list = document.querySelector('.owner-list');
          if (list) list.innerHTML = '<p class="owner-error">認証機能を読み込めませんでした。</p>';
        }
        return;
      }
      var screen = window.__SCREEN__ || 'archive';
      var params = {};

      switch (screen) {
        case 'owner':
          /* __OWNER__ が存在する場合は ownerSlug を詰めない（優先1→優先3の循環を防ぐ） */
          if (window.__OWNER__) {
            params = {
              owner:     window.__OWNER__,
              ownerList: null,
            };
          } else {
            params = {
              owner:     null,
              ownerSlug: '',
              ownerList: (window.__OWNER_LIST__ !== undefined ? window.__OWNER_LIST__ : null),
            };
          }
          break;
        case 'archive':
          params = {
            slug:      (window.__PET__ && window.__PET__.slug) || '',
            months:    (window.__PET__ && window.__PET__.months) || [],
            petName:   (window.__PET__ && window.__PET__.petName) || '',
            ownerSlug: (window.__PET__ && window.__PET__.ownerSlug) || '',
          };
          break;
        case 'report':
          /* __REPORT__ は is-readonly 結線 + SaltyDogPonchi.applyReport で処理 */
          params = {
            slug:     (window.__PET__ && window.__PET__.slug) || '',
            reportId: (window.__REPORT__ && window.__REPORT__.reportId) || '',
          };
          break;
        default:
          screen = 'archive';
          params = { pet: window.__PET__ || {} };
      }

      this.show(screen, params);
    },

    /* 作成フロー エントリポイント */
    startCreateFlow: function (step, context) {
      showCreateFlow(step || 1, context);
    },

    getReportContext: function () {
      return _reportContext;
    },
  };

  /* ── XSS 対策 ────────────────────────────────────────────── */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── グローバル公開 ──────────────────────────────────────── */
  window.PonchiApp = PonchiApp;

})();

// SALTY DOG ポチ版B 公開フロー（ponchi-v2.html 専用）
// 役割: DOM→report JSON 抽出 / 公開 POST / 公開 UI 制御
// 依存:
//   window.__SALTYDOG_GET_WEIGHTS() / __SALTYDOG_SET_WEIGHTS(arr)  ← E1 が ponchi-v2.html に公開
//   window.SaltyDogPonchiPhoto.set(key, src)                       ← E1 が ponchi-v2.html に公開
//   window.__SALTYDOG_BM.exportImage()                             ← Konva IIFE が expose
//   window.__SALTYDOG_TEETH.exportImage()                          ← Konva IIFE が expose
// ※ 無認証公開（パスワード・認証ヘッダなし）
// ※ ES module ではなく通常 script
(function () {
  'use strict';

  // ===== 設定 =====
  // 同一オリジン（Cloudflare Worker）への直接アクセスのみ。外部オリジン設定は不要。
  const API_BASE = '/api';

  // ===== DOM ヘルパ =====
  // cssAttrSafe はセレクタ組み立て時の注入防止。ASCII の「名前」（data-field 名・
  // 写真キー・行番号）にだけ使う。**保存された「値」には使ってはいけない。**
  // 皮膚の種類（湿疹・カサブタ・イボ・傷）、変化（成長・縮小・治療中・完治）、
  // 歯の状態（キレイ・歯石・維持）は日本語なので、通すと空文字になり
  // `[data-val=""]` という一致しないセレクタが出来上がる。抽出では正しく保存され、
  // 復元だけが静かに失敗する——トリマーが記入した所見が、保存後に消える。
  function cssAttrSafe(v){return String(v).replace(/[^a-zA-Z0-9_\-]/g,'');}

  /**
   * pickByValue(groupSelector, value, attr)
   * groupSelector に一致する要素から is-picked を外し、
   * 値が attr（既定 'val'）と一致する1件にだけ付け直す。
   *
   * 値をセレクタに連結せず JS で比較するので、日本語でも絵文字でも正しく一致し、
   * かつセレクタ注入の余地が無い。cssAttrSafe を緩めずに済ませるための入口。
   */
  function pickByValue(groupSelector, value, attr) {
    var key = attr || 'val';
    var wanted = value == null ? '' : String(value);
    [].forEach.call(document.querySelectorAll(groupSelector), function (el) {
      var matched = wanted !== '' && String(el.dataset[key] || '') === wanted;
      el.classList.toggle('is-picked', matched);
    });
  }
  function pathSegment(value) { return encodeURIComponent(String(value || '')); }
  function txt(sel) { var el = document.querySelector(sel); return el ? el.textContent.trim() : ''; }
  function field(name) { return txt('[data-field="' + cssAttrSafe(name) + '"]'); }

  // 契約#5: img[data-photo="key"] の src を抽出
  function photo(key) {
    var img = document.querySelector('img[data-photo="' + cssAttrSafe(key) + '"]');
    return img && img.src ? img.src : '';
  }

  // 'YYYY/MM/DD' → 'YYYY-MM'（表示用）
  function monthKey(dateStr) {
    var m = String(dateStr || '').match(/^(\d{4})\/(\d{1,2})\//);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');
    return '（日付未入力）';
  }

  // ===== レポート抽出（DOM → 構造化 JSON: 契約#4 スキーマ）=====
  // extractReport() → applyReport(report) は対称写像
  function extractReport() {
    // --- options[]: .opt.on クラスのリスト ---
    var options = [].map.call(document.querySelectorAll('.opt'), function (el) {
      return { on: el.classList.contains('on') };
    });

    // --- weights[]: 体重グラフデータ（E1 が公開する getter を使用）---
    var weights = [];
    try {
      if (typeof window.__SALTYDOG_GET_WEIGHTS === 'function') {
        weights = window.__SALTYDOG_GET_WEIGHTS();
      }
    } catch (_e) { weights = []; }

    // --- skin[]: 皮膚チェック 1-10 ---
    var skin = [];
    for (var i = 1; i <= 10; i += 1) {
      var typeEl  = document.querySelector('.sk-pick.is-picked[data-skin-type="' + cssAttrSafe(i) + '"]');
      var changeEl = document.querySelector('.sk-pick.is-picked[data-skin-change="' + cssAttrSafe(i) + '"]');
      skin.push({
        loc:    field('skin-loc-' + cssAttrSafe(i)),
        size:   txt('[data-field="skin-size-' + cssAttrSafe(i) + '"]'),
        type:   typeEl   ? (typeEl.dataset.val   || '') : '',
        change: changeEl ? (changeEl.dataset.val || '') : '',
      });
    }

    // --- 描画アコーディオンを一時展開して exportImage を安定化させる ---
    var drawAccs = [].slice.call(document.querySelectorAll('.hd-draw'));
    var prevOpen = drawAccs.map(function (d) { return d.open; });
    drawAccs.forEach(function (d) {
      if (!d.open) d.open = true;
      var inst = d.dataset.hd === 'spa' ? window.__SALTYDOG_BM
        : (d.dataset.hd === 'teeth' ? window.__SALTYDOG_TEETH : null);
      void d.offsetHeight; // 強制 reflow
      if (inst && typeof inst.refresh === 'function') { try { inst.refresh(); } catch (_e) {} }
    });

    var bodyMarkingImage = '';
    try {
      if (window.__SALTYDOG_BM && typeof window.__SALTYDOG_BM.exportImage === 'function') {
        bodyMarkingImage = window.__SALTYDOG_BM.exportImage() || '';
      }
    } catch (_e) { bodyMarkingImage = ''; }

    var teethDiagram = '';
    try {
      if (window.__SALTYDOG_TEETH && typeof window.__SALTYDOG_TEETH.exportImage === 'function') {
        teethDiagram = window.__SALTYDOG_TEETH.exportImage() || '';
      }
    } catch (_e) { teethDiagram = ''; }
    var tcDiagram = '';
    try {
      if (window.__SALTYDOG_TC && typeof window.__SALTYDOG_TC.exportImage === 'function') {
        tcDiagram = window.__SALTYDOG_TC.exportImage() || '';
      }
    } catch (_e) { tcDiagram = ''; }
    var tcnDiagram = '';
    try {
      if (window.__SALTYDOG_TCN && typeof window.__SALTYDOG_TCN.exportImage === 'function') {
        tcnDiagram = window.__SALTYDOG_TCN.exportImage() || '';
      }
    } catch (_e) { tcnDiagram = ''; }

    // open 状態を復元
    drawAccs.forEach(function (d, idx) { d.open = prevOpen[idx]; });

    // --- 耳: .ear-cell.is-picked[data-ear][data-val] ---
    var earRight = document.querySelector('.ear-cell.is-picked[data-ear="right"]');
    var earLeft  = document.querySelector('.ear-cell.is-picked[data-ear="left"]');

    // --- 爪: .nail-lv.is-picked[data-nail] ---
    var nailPick = document.querySelector('.nail-lv.is-picked');

    // --- 歯: .tt-pick.is-picked[data-teeth] ---
    var teethPick = document.querySelector('.tt-pick.is-picked');

    // #heroDateInput は HTML5 の <input type="date"> なので、値が入っていれば
    // 必ず YYYY-MM-DD 形式になる（date/year/day の3分割表示と違って結合が要らない）。
    // Supabase モードの公開検証（ponchi-app.js）はこちらを見る。
    // date/year/day の3キーは KV モード（A版14キー契約）が使い続けるので残す。
    var heroDateInputEl = document.getElementById('heroDateInput');
    var isoDate = heroDateInputEl ? String(heroDateInputEl.value || '').trim() : '';

    return {
      // A版 14 キー（契約#4 共通部）
      pet:       field('pet'),
      date:      field('date'),
      year:      field('year'),
      day:       field('day'),
      isoDate:   isoDate,
      bestWeight: field('best-weight'),
      // 「担当からの一言」。HTML には data-field="staff-note" として最初から在ったが
      // 抽出側が読んでいなかったため、トリマーが書いても保存されず飼い主に届かなかった。
      staffNote: field('staff-note'),
      options:   options,
      weights:   weights,
      skin:      skin,
      bmTitle:   field('bm-title'),
      bodyMarkingImage: bodyMarkingImage,
      trimming: {
        photos:  [photo('trim-1'), photo('trim-2')],
        comment: field('trimming-comment'),
      },
      bodyLanguage: {
        // B固有: 3枚（bl-1 / bl-2 / bl-3）← 契約#4 bodyLanguage.photos（従来bodyLanguage と共存）
        photos:  [photo('bl-1'), photo('bl-2'), photo('bl-3')],
        comment: field('body-language-comment'),
      },
      teeth: {
        status:  teethPick ? (teethPick.dataset.teeth || '') : '',
        photo:   photo('teeth-real'),
        diagram: teethDiagram,
        comment: field('teeth-comment'),
      },
      trimmingCheck: {
        diagram: tcDiagram,
        note: tcnDiagram,
      },
      ear: {
        right:   earRight ? Number(earRight.dataset.val) : 0,
        left:    earLeft  ? Number(earLeft.dataset.val)  : 0,
        comment: field('ear-comment'),
        photo:   photo('ear'),
      },
      nail: {
        level:   nailPick ? Number(nailPick.dataset.nail) : 0,
        comment: field('nail-comment'),
      },
      // B固有 3 キー（契約#4 B固有部）
      heroPhotos:         [photo('hero-1'), photo('hero-2')],
      bodyLanguagePhotos: [photo('bl-1'), photo('bl-2'), photo('bl-3')],
      template:           'ponchi',
    };
  }

  // ===== レポート復元（構造化 JSON → DOM）: extractReport の逆写像 =====
  // applyReport(report) — report は extractReport() の出力と同一スキーマ。
  // 閲覧モード時に Worker が注入した window.__REPORT__ を渡す想定。
  function applyReport(report) {
    if (!report) return;

    // --- template 識別子を保持（extractReport と対称・Worker 出し分けと整合） ---
    if (report.template) {
      document.body.setAttribute('data-template', report.template);
    }

    // --- data-field テキスト設定ヘルパ ---
    function setField(name, val) {
      var el = document.querySelector('[data-field="' + cssAttrSafe(name) + '"]');
      if (el) el.textContent = val != null ? val : '';
    }

    // --- date / pet / year / bestWeight / bmTitle ---
    setField('date',        report.date);
    setField('pet',         report.pet);
    setField('year',        report.year);
    setField('day',         report.day);
    setField('best-weight', report.bestWeight);
    setField('bm-title',    report.bmTitle);
    /* 本キーを持たない旧データでも必ず上書きする。触らずに残すと、HTML の既定文
       「今月もとっても良い仕上がりでした！…」が飼い主に見えてしまう。
       担当が書いていない文章を担当の言葉として届けるより、空で出すほうが正しい。 */
    setField('staff-note', report.staffNote || '');

    /* ヒーロー日付: span 復元後に native date ピッカーの value を再構築（旧データ＝day なしも許容） */
    if (typeof window.__SALTYDOG_HERODATE_FROM_SPANS === 'function') {
      try { window.__SALTYDOG_HERODATE_FROM_SPANS(); } catch (_e) {}
    }

    // --- options[]: .opt の on クラスと .chk テキスト ---
    // extractReport: el.classList.contains('on') → options[i].on
    if (Array.isArray(report.options)) {
      var optEls = document.querySelectorAll('.opt');
      report.options.forEach(function (opt, idx) {
        if (!optEls[idx]) return;
        var chk = optEls[idx].querySelector('.chk');
        if (opt.on) {
          optEls[idx].classList.add('on');
          if (chk) chk.textContent = '✓';
        } else {
          optEls[idx].classList.remove('on');
          if (chk) chk.textContent = '';
        }
      });
    }

    // --- weights[]: 体重グラフ（E1 が公開する setter を使用）---
    if (Array.isArray(report.weights) && report.weights.length > 0) {
      if (typeof window.__SALTYDOG_SET_WEIGHTS === 'function') {
        window.__SALTYDOG_SET_WEIGHTS(report.weights);
      } else {
        // フォールバック: DOM シミュレート
        var addYmEl = document.getElementById('wcYm');
        var addKgEl = document.getElementById('wcKg');
        var addBtn  = document.getElementById('wcAdd');
        if (addYmEl && addKgEl && addBtn) {
          report.weights.forEach(function (w) {
            addYmEl.value = w.ym || '';
            addKgEl.value = w.kg != null ? String(w.kg) : '';
            addBtn.click();
          });
        }
      }
    }

    // --- bestWeight 反映後に体重グラフを再描画（目標線更新）---
    var bestEl = document.querySelector('[data-field="best-weight"]');
    if (bestEl) {
      bestEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // --- skin[]: 皮膚チェック 1-10 ---
    // extractReport: .sk-pick.is-picked[data-skin-type/change="i"] → skin[i].type/change
    if (Array.isArray(report.skin)) {
      report.skin.forEach(function (s, idx) {
        var row = idx + 1;
        setField('skin-loc-' + row,  s.loc);
        setField('skin-size-' + row, s.size);
        // type / change
        // 値（湿疹・治療中 等）は日本語なのでセレクタに埋めない。pickByValue を使う。
        pickByValue('.sk-pick[data-skin-type="' + cssAttrSafe(row) + '"]', s.type);
        pickByValue('.sk-pick[data-skin-change="' + cssAttrSafe(row) + '"]', s.change);
      });
    }

    // --- bodyMarkingImage: #bm-canvas-wrap .bm-single の src ---
    if (report.bodyMarkingImage) {
      var bmSingle = document.querySelector('#bm-canvas-wrap .bm-single');
      if (bmSingle) bmSingle.src = report.bodyMarkingImage;
    }

    // --- heroPhotos[2]: hero-1 / hero-2 ← B固有（契約#4）---
    // extractReport: photo('hero-1'), photo('hero-2')
    var heroPhotos = report.heroPhotos || [];
    ['hero-1', 'hero-2'].forEach(function (key, idx) {
      var src = heroPhotos[idx];
      if (src) setPhotoSlot(key, src);
    });

    // --- trimming: photos[trim-1, trim-2] / comment ---
    if (report.trimming) {
      if (Array.isArray(report.trimming.photos)) {
        ['trim-1', 'trim-2'].forEach(function (key, idx) {
          var src = report.trimming.photos[idx];
          if (src) setPhotoSlot(key, src);
        });
      }
      setField('trimming-comment', report.trimming.comment);
    }

    // --- bodyLanguage: photos[bl-1, bl-2, bl-3] / comment ← B固有 3枚 ---
    // extractReport: photo('bl-1')〜photo('bl-3')
    // bodyLanguagePhotos（B固有）と bodyLanguage.photos を合わせて復元
    var blPhotos = (report.bodyLanguage && Array.isArray(report.bodyLanguage.photos))
      ? report.bodyLanguage.photos
      : (report.bodyLanguagePhotos || []);
    ['bl-1', 'bl-2', 'bl-3'].forEach(function (key, idx) {
      var src = blPhotos[idx];
      if (src) setPhotoSlot(key, src);
    });
    if (report.bodyLanguage) {
      setField('body-language-comment', report.bodyLanguage.comment);
    }

    // --- teeth: status / photo / diagram / comment ---
    if (report.teeth) {
      // status（キレイ・歯石・維持）は日本語なのでセレクタに埋めない。
      pickByValue('.tt-pick', report.teeth.status, 'teeth');
      if (report.teeth.photo) setPhotoSlot('teeth-real', report.teeth.photo);
      // diagram: #tt-canvas-wrap .bm-single の src
      if (report.teeth.diagram) {
        var ttSingle = document.querySelector('#tt-canvas-wrap .bm-single');
        if (ttSingle) ttSingle.src = report.teeth.diagram;
      }
      setField('teeth-comment', report.teeth.comment);
    }

    // --- trimmingCheck: diagram / note ---
    if (report.trimmingCheck && report.trimmingCheck.diagram) {
      var tcSingle = document.querySelector('#tc-canvas-wrap .bm-single');
      if (tcSingle) tcSingle.src = report.trimmingCheck.diagram;
    }
    if (report.trimmingCheck && report.trimmingCheck.note) {
      var tcnSingle = document.querySelector('#tcn-canvas-wrap .bm-single');
      if (tcnSingle) tcnSingle.src = report.trimmingCheck.note;
    }

    // --- ear: right / left / comment ---
    // extractReport: .ear-cell.is-picked[data-ear="right/left"][data-val]
    if (report.ear) {
      ['right', 'left'].forEach(function (side) {
        var val = report.ear[side];
        pickByValue(
          '.ear-cell[data-ear="' + cssAttrSafe(side) + '"]',
          val != null && val !== 0 ? val : '',
        );
      });
      setField('ear-comment', report.ear.comment);
      if (report.ear.photo) setPhotoSlot('ear', report.ear.photo);
    }

    // --- nail: level / comment ---
    if (report.nail) {
      pickByValue(
        '.nail-lv',
        report.nail.level != null && report.nail.level !== 0 ? report.nail.level : '',
        'nail',
      );
      setField('nail-comment', report.nail.comment);
    }
  }

  // 契約#5: img[data-photo="key"] に src を設定するヘルパ（閲覧時は img 要素を生成）
  // extractReport: img[data-photo="key"] の src
  function setPhotoSlot(key, src) {
    // E1 が公開する SaltyDogPonchiPhoto.set があれば優先使用
    if (window.SaltyDogPonchiPhoto && typeof window.SaltyDogPonchiPhoto.set === 'function') {
      window.SaltyDogPonchiPhoto.set(key, src);
      return;
    }
    // フォールバック: img[data-photo] に直接設定
    var img = document.querySelector('img[data-photo="' + cssAttrSafe(key) + '"]');
    if (img) { img.src = src; return; }
    // 要素がなければ生成して最初の親に挿入（閲覧モード互換）
    var parent = document.querySelector('[data-photo-slot="' + cssAttrSafe(key) + '"]');
    if (!parent) return;
    var newImg = document.createElement('img');
    newImg.alt = key;
    newImg.setAttribute('data-photo', key);
    newImg.src = src;
    parent.insertBefore(newImg, parent.firstChild);
  }

  // ===== API（publish-client-ponchi 内部用。作成フロー公開は ponchi-app.js の publishReport が担当） =====
  async function apiFetch(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API_BASE + path, { method: opts.method || 'GET', headers: headers, body: opts.body });
  }

  async function listCustomers() {
    var res = await apiFetch('/customers', { method: 'GET' });
    if (!res.ok) throw new Error('list failed: ' + res.status);
    var data = await res.json();
    return data.customers || [];
  }
  async function createCustomer(petName) {
    var res = await apiFetch('/customers', { method: 'POST', body: JSON.stringify({ petName: petName }) });
    if (!res.ok) throw new Error('create failed: ' + res.status);
    return res.json();
  }
  async function addReport(slug, report) {
    var res = await apiFetch('/reports', {
      method: 'POST',
      body: JSON.stringify({ slug: slug, date: report.date, year: report.year, report: report }),
    });
    if (!res.ok) throw new Error('publish failed: ' + res.status);
    return res.json();
  }

  // ===== スタイル注入 =====
  function injectStyle() {
    if (document.getElementById('sdp-pub-style')) return;
    var css = `
#sdp-publish-btn{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:8000;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;border:none;border-radius:28px;padding:14px 22px;font-size:1rem;font-weight:700;box-shadow:0 4px 14px rgba(139,92,246,0.45);cursor:pointer;font-family:inherit}
#sdp-publish-btn:active{transform:translateY(1px)}
.sdp-modal{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px}
.sdp-modal.hidden{display:none}
.sdp-modal-inner{background:#fff;border-radius:14px;width:100%;max-width:420px;max-height:85vh;overflow:auto;padding:20px;font-family:inherit;color:#333}
.sdp-step.hidden{display:none}
.sdp-step h2{font-size:1.15rem;font-weight:700;margin-bottom:12px}
.sdp-step p{font-size:0.9rem;margin-bottom:10px;line-height:1.5}
.sdp-btn{width:100%;padding:14px;font-size:1rem;font-weight:700;border:none;border-radius:8px;cursor:pointer;margin-bottom:8px;font-family:inherit}
.sdp-btn-primary{background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff}
.sdp-btn-sub{background:#eee;color:#333}
.sdp-cust-list{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:40vh;overflow:auto}
.sdp-cust-item{padding:12px;border:1px solid #ddd;border-radius:8px;cursor:pointer;font-size:0.95rem;background:#fff}
.sdp-cust-item:active{background:#f4edff}
.sdp-cust-item small{color:#888;font-size:0.78rem;display:block;margin-top:2px}
.sdp-input{width:100%;padding:12px;font-size:16px;border:1px solid #ccc;border-radius:8px;margin-bottom:12px}
.sdp-err{color:#e64;font-size:0.85rem;margin-bottom:8px;min-height:1em}
.sdp-url-box{background:#f4f1ec;border-radius:8px;padding:12px;word-break:break-all;margin-bottom:12px}
.sdp-url-box a{color:#8b5cf6;font-size:0.9rem}
.sdp-done-icon{font-size:2.5rem;text-align:center;margin-bottom:8px}
.sdp-spinner{font-size:0.9rem;color:#888;text-align:center;padding:10px}
`;
    var style = document.createElement('style');
    style.id = 'sdp-pub-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ===== UI 制御 =====
  var selectedSlug = null;

  function el(id) { return document.getElementById(id); }
  function showStep(name) {
    [].forEach.call(document.querySelectorAll('#sdp-modal .sdp-step'), function (s) {
      s.classList.toggle('hidden', s.dataset.step !== name);
    });
  }
  function openModal()  { el('sdp-modal').classList.remove('hidden'); }
  function closeModal() { el('sdp-modal').classList.add('hidden'); }
  function setErr(stepName, msg) {
    var e = document.querySelector('#sdp-modal .sdp-step[data-step="' + cssAttrSafe(stepName) + '"] .sdp-err');
    if (e) e.textContent = msg || '';
  }

  async function gotoCustomerStep() {
    showStep('customer');
    var listEl = el('sdp-cust-list');
    listEl.innerHTML = '<div class="sdp-spinner">読み込み中…</div>';
    try {
      var customers = await listCustomers();
      if (!customers.length) {
        listEl.innerHTML = '<div class="sdp-spinner">既存のお客様はまだいません</div>';
      } else {
        listEl.innerHTML = '';
        customers.forEach(function (c) {
          var item = document.createElement('div');
          item.className = 'sdp-cust-item';
          item.innerHTML = '<strong></strong><small></small>';
          item.querySelector('strong').textContent = c.petName;
          item.querySelector('small').textContent =
            (c.lastReportMonth ? '最終: ' + c.lastReportMonth + ' / ' : '') + (c.reportCount || 0) + '件';
          item.addEventListener('click', function () {
            selectedSlug = c.slug;
            gotoConfirmStep(c.petName);
          });
          listEl.appendChild(item);
        });
      }
    } catch (_e) {
      listEl.innerHTML = '<div class="sdp-err">一覧の取得に失敗しました。再度お試しください。</div>';
    }
  }

  function gotoConfirmStep(petName) {
    showStep('confirm');
    var report = extractReport();
    el('sdp-confirm-text').textContent =
      petName + ' さんの ' + monthKey(report.date) + ' に公開します。よろしいですか？';
  }

  async function doPublish() {
    setErr('confirm', '');
    var btn = el('sdp-confirm-ok');
    btn.disabled = true;
    btn.textContent = '公開中…';
    try {
      var report = extractReport();
      var result = await addReport(selectedSlug, report);
      showStep('done');
      // 公開 URL: /p/{slug}/{reportId}（契約#4 公開URL定義）
      var viewUrl = (result.reportId && selectedSlug)
        ? (location.origin + '/p/' + pathSegment(selectedSlug) + '/' + pathSegment(result.reportId))
        : (result.publicUrl || '');
      var link = el('sdp-done-url');
      link.textContent = viewUrl;
      link.href = viewUrl;
    } catch (_e) {
      setErr('confirm', '公開に失敗しました。通信状況をご確認ください。');
    } finally {
      btn.disabled = false;
      btn.textContent = '反映OK（公開する）';
    }
  }

  // onPublishClick / gotoCustomerStep は sdp-publish-btn がある場合のみ発火する。
  // B版作成フロー（/edit/*）では sdp-publish-btn は使用しない。
  // 作成フローの公開は ponchi-app.js の publishReport() が直接 POST /api/reports する。
  async function onPublishClick() {
    injectStyle();
    openModal();
    gotoCustomerStep();
  }

  async function onCreateCustomer() {
    var input = el('sdp-newpet-input');
    var petName = input.value.trim();
    if (!petName) { setErr('customer', 'お名前を入力してください'); return; }
    setErr('customer', '作成中…');
    try {
      var result = await createCustomer(petName);
      selectedSlug = result.slug;
      setErr('customer', '');
      gotoConfirmStep(result.petName);
    } catch (_e) {
      setErr('customer', '顧客作成に失敗しました');
    }
  }

  // ===== モーダル HTML 注入 =====
  function injectModal() {
    if (el('sdp-modal')) return;
    var div = document.createElement('div');
    div.innerHTML = `
<div id="sdp-modal" class="sdp-modal hidden" role="dialog" aria-modal="true" aria-label="カルテ公開">
  <div class="sdp-modal-inner">
    <!-- 顧客選択 -->
    <div class="sdp-step" data-step="customer">
      <h2>お客様を選択</h2>
      <p class="sdp-err"></p>
      <div class="sdp-cust-list" id="sdp-cust-list"></div>
      <details style="margin-bottom:8px">
        <summary style="font-size:0.88rem;cursor:pointer;color:#8b5cf6">新しいお客様を追加</summary>
        <input type="text" id="sdp-newpet-input" class="sdp-input" placeholder="わんちゃんのお名前">
        <button class="sdp-btn sdp-btn-primary" id="sdp-newpet-submit">登録して続ける</button>
      </details>
      <button class="sdp-btn sdp-btn-sub" data-close>キャンセル</button>
    </div>
    <!-- 確認 -->
    <div class="sdp-step hidden" data-step="confirm">
      <h2>公開の確認</h2>
      <p id="sdp-confirm-text"></p>
      <p class="sdp-err"></p>
      <button class="sdp-btn sdp-btn-primary" id="sdp-confirm-ok">反映OK（公開する）</button>
      <button class="sdp-btn sdp-btn-sub" data-close>キャンセル</button>
    </div>
    <!-- 完了 -->
    <div class="sdp-step hidden" data-step="done">
      <div class="sdp-done-icon">🐾</div>
      <h2 style="text-align:center">公開しました！</h2>
      <div class="sdp-url-box"><a id="sdp-done-url" href="#" target="_blank" rel="noopener"></a></div>
      <button class="sdp-btn sdp-btn-sub" data-close>閉じる</button>
    </div>
  </div>
</div>
`;
    document.body.appendChild(div.firstElementChild);
  }

  // ===== 初期化 =====
  function init() {
    var btn = el('sdp-publish-btn');
    if (!btn) return; // UI DOM 未挿入なら何もしない
    if (window.__BACKEND__ === 'supabase') {
      btn.remove();
      return;
    }
    injectStyle();
    injectModal();
    btn.addEventListener('click', onPublishClick);
    el('sdp-newpet-submit').addEventListener('click', onCreateCustomer);
    el('sdp-confirm-ok').addEventListener('click', doPublish);
    [].forEach.call(document.querySelectorAll('#sdp-modal [data-close]'), function (c) {
      c.addEventListener('click', closeModal);
    });
    // 新規顧客名の既定値をレポートのペット名に
    var newpet = el('sdp-newpet-input');
    if (newpet) {
      btn.addEventListener('click', function () { newpet.value = field('pet') || ''; });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ===== インターフェース契約#4 公開 =====
  window.SaltyDogPonchi = {
    extractReport: extractReport,
    applyReport:   applyReport,
  };
})();

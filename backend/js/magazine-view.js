// SALTY DOG マガジンカルテ表示（F4）
// 役割: 実データ(report) → マスター承認のマガジン意匠（4ステップ意匠モック #screen-4）への一方向投影
// トリマーの確認画面（/edit の公開前プレビュー）と飼い主の閲覧画面（/my）が
// この1本の renderMagazine() を共有する（マスター指定: ⑤と⑥は同一レンダラ）。
//
// 契約:
//   - この関数は DOM → 何も読み取らない。渡された report だけを描画する（一方向）。
//   - report.data は publish-client-ponchi.js の extractReport() と同一スキーマ。
//   - 写真は呼び出し側で解決済みの src（blob: / data: / https:）を渡すこと。
//     asset:// マーカーの解決（署名URL取得）はこの関数の責務ではない。
//   - 記入されていない項目はモックの文例で埋めない。空欄のまま「記録がありません」と
//     出すか、その項目ごと隠す（F-20260821-15/22 と同型の「架空データを見せる」再発防止）。

const TEMPLATE = `
<div class="magazine-container">
  <div class="timeline-accordion-box" data-view="timeline-box" hidden>
    <div class="timeline-accordion-head" data-view="timeline-toggle">
      <div style="display:flex;align-items:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>過去のレポートを見返す（来店履歴タイムライン）</span>
      </div>
      <span style="font-size:11px;color:var(--ink-muted)" data-view="timeline-toggle-text">表示する ▼</span>
    </div>
    <div class="timeline-chips-tray" data-view="timeline-tray" style="display:none"></div>
  </div>

  <div class="quick-jump-nav-sticky">
    <div class="quick-jump-buttons">
      <button type="button" class="btn-jump-number" data-jump="wave-skin">① 皮膚</button>
      <button type="button" class="btn-jump-number" data-jump="wave-nail">② 爪</button>
      <button type="button" class="btn-jump-number" data-jump="wave-ear">③ 耳</button>
      <button type="button" class="btn-jump-number" data-jump="wave-teeth">④ 歯</button>
      <button type="button" class="btn-jump-number" data-jump="wave-weight">⑤ 体重</button>
      <button type="button" class="btn-jump-number" data-jump="wave-cut">⑥ カット</button>
    </div>
    <button type="button" class="btn-toggle-all" data-view="toggle-all">全開/全閉</button>
  </div>

  <header class="magazine-hero">
    <div class="magazine-hero__header">
      <div class="magazine-hero__brand">SALTY DOG</div>
      <div class="magazine-hero__date" data-view="report-date"></div>
    </div>
    <div class="magazine-hero__media-grid">
      <div class="magazine-hero-photo-main" data-view="hero-photo-frame" hidden>
        <img data-view="hero-photo" alt="">
      </div>
      <div class="magazine-hero-side-card">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;color:var(--ink-muted);text-transform:uppercase;margin-bottom:6px">Trimming &amp; Spa Report</div>
          <h2 class="magazine-dog-title" data-view="dog-name"></h2>
          <div class="magazine-dog-sub" data-view="dog-sub"></div>
        </div>
      </div>
    </div>
  </header>

  <section class="magazine-letter-section" data-view="letter-section" hidden>
    <h3 class="magazine-letter-title">担当トリマーからのメッセージ</h3>
    <p class="magazine-letter-body" data-view="staff-note"></p>
  </section>

  <section class="wave-accordion-stack">
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-family:var(--font-en);font-size:11px;font-weight:700;letter-spacing:0.18em;color:var(--ink-muted);text-transform:uppercase">Health &amp; Grooming Details</div>
      <h3 style="font-family:var(--font-serif);font-size:22px;font-weight:700">各項目の健康診断・カルテ詳細</h3>
      <p style="font-size:12px;color:var(--ink-secondary);margin-top:4px">タップすると各項目の詳細が展開します</p>
    </div>

    <div class="wave-card is-open" id="wave-skin">
      <div class="wave-card-head" data-toggle="wave-skin">
        <div class="wave-card-head__title-wrap">
          <span class="wave-card-number-badge">1</span>
          <span class="wave-card-title">皮膚・被毛のチェック</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="wave-card-status-pill" data-view="skin-pill"></span>
          <div class="wave-card-toggle-icon">▼</div>
        </div>
      </div>
      <svg class="wave-separator-svg" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d="M0,6 Q250,0 500,6 T1000,6"/></svg>
      <div class="wave-card-body">
        <div class="wave-body-grid-2col">
          <div class="wave-body-img-frame" data-view="skin-image-frame" hidden><img data-view="skin-image" alt="皮膚チェック図"></div>
          <div data-view="skin-rows"></div>
        </div>
      </div>
    </div>

    <div class="wave-card is-open" id="wave-nail">
      <div class="wave-card-head" data-toggle="wave-nail">
        <div class="wave-card-head__title-wrap">
          <span class="wave-card-number-badge">2</span>
          <span class="wave-card-title">爪のチェック</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="wave-card-status-pill" data-view="nail-pill"></span>
          <div class="wave-card-toggle-icon">▼</div>
        </div>
      </div>
      <svg class="wave-separator-svg" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d="M0,6 Q250,12 500,6 T1000,6"/></svg>
      <div class="wave-card-body">
        <p style="font-size:13.5px;line-height:1.8;color:var(--ink-body)" data-view="nail-comment"></p>
      </div>
    </div>

    <div class="wave-card" id="wave-ear">
      <div class="wave-card-head" data-toggle="wave-ear">
        <div class="wave-card-head__title-wrap">
          <span class="wave-card-number-badge">3</span>
          <span class="wave-card-title">耳のチェック（左右）</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="wave-card-status-pill" data-view="ear-pill"></span>
          <div class="wave-card-toggle-icon">▼</div>
        </div>
      </div>
      <svg class="wave-separator-svg" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d="M0,6 Q250,0 500,6 T1000,6"/></svg>
      <div class="wave-card-body">
        <div class="wave-body-grid-2col">
          <div class="wave-body-img-frame" data-view="ear-image-frame" hidden><img data-view="ear-image" alt="耳の様子"></div>
          <p style="font-size:13.5px;line-height:1.8;color:var(--ink-body)" data-view="ear-comment"></p>
        </div>
      </div>
    </div>

    <div class="wave-card" id="wave-teeth">
      <div class="wave-card-head" data-toggle="wave-teeth">
        <div class="wave-card-head__title-wrap">
          <span class="wave-card-number-badge">4</span>
          <span class="wave-card-title">口・歯のチェック</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="wave-card-status-pill" data-view="teeth-pill"></span>
          <div class="wave-card-toggle-icon">▼</div>
        </div>
      </div>
      <svg class="wave-separator-svg" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d="M0,6 Q250,12 500,6 T1000,6"/></svg>
      <div class="wave-card-body">
        <div class="wave-body-grid-2col">
          <div class="wave-body-img-frame" data-view="teeth-image-frame" hidden><img data-view="teeth-image" alt="歯のチェック"></div>
          <p style="font-size:13.5px;line-height:1.8;color:var(--ink-body)" data-view="teeth-comment"></p>
        </div>
      </div>
    </div>

    <div class="wave-card" id="wave-weight">
      <div class="wave-card-head" data-toggle="wave-weight">
        <div class="wave-card-head__title-wrap">
          <span class="wave-card-number-badge">5</span>
          <span class="wave-card-title">体重の推移</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="wave-card-status-pill" data-view="weight-pill"></span>
          <div class="wave-card-toggle-icon">▼</div>
        </div>
      </div>
      <svg class="wave-separator-svg" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d="M0,6 Q250,0 500,6 T1000,6"/></svg>
      <div class="wave-card-body">
        <div data-view="weight-graph"></div>
      </div>
    </div>

    <div class="wave-card is-open" id="wave-cut">
      <div class="wave-card-head" data-toggle="wave-cut">
        <div class="wave-card-head__title-wrap">
          <span class="wave-card-number-badge">6</span>
          <span class="wave-card-title">カット &amp; 本日のフォト</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="wave-card-status-pill" data-view="cut-pill"></span>
          <div class="wave-card-toggle-icon">▼</div>
        </div>
      </div>
      <svg class="wave-separator-svg" viewBox="0 0 1000 12" preserveAspectRatio="none"><path d="M0,6 Q250,12 500,6 T1000,6"/></svg>
      <div class="wave-card-body">
        <p style="margin-bottom:16px;font-size:13.5px;line-height:1.8" data-view="trimming-comment"></p>
        <div class="gallery-mosaic-grid" data-view="trimming-gallery"></div>
        <p style="margin-top:16px;font-size:13.5px;line-height:1.8" data-view="body-language-comment"></p>
      </div>
    </div>
  </section>

  <div style="text-align:center;margin-top:40px">
    <button type="button" class="btn-toggle-all" data-view="back-btn" style="padding:12px 28px" hidden></button>
  </div>
</div>

<div class="lightbox-modal" data-view="lightbox">
  <div class="lightbox-close-btn" style="position:absolute;top:16px;right:24px;color:#fff;font-size:32px;cursor:pointer">&times;</div>
  <img data-view="lightbox-img" src="" alt="拡大画像">
</div>
`;

// フォント名は my.html の :root（既存・Google Fonts CDN 不使用）に合わせる。
// トークン名は my.html の :root と同一（衝突なし・my.html 側は再宣言が無害な重複になるだけ）。
const STYLE = `
:root{
  --bg-page:#f8f8f7; --bg-surface:#ffffff; --bg-subtle:#f2f2ef; --bg-muted:#e9e9e5; --bg-paper:#faf9f6;
  --ink-primary:#121212; --ink-body:#2c2c2c; --ink-secondary:#585858; --ink-muted:#8c8c88; --ink-inverse:#ffffff;
  --border-subtle:#e6e6e2; --border-divider:#deded9; --border-strong:#121212;
  --accent-terracotta:#c85a32; --accent-sage:#4a7c59; --accent-alert:#d32f2f;
  --font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic Medium","Yu Gothic",Meiryo,sans-serif;
  --font-en:"Inter",-apple-system,sans-serif;
  --font-serif:"Hiragino Mincho ProN","Yu Mincho",YuMincho,"Times New Roman",serif;
  --ease-editorial:cubic-bezier(0.16,1,0.3,1);
  --header-height:54px;
}
.magazine-container{max-width:1040px;margin:0 auto;padding:24px 16px 100px;background:#fff;font-family:var(--font-sans);color:var(--ink-body)}
.timeline-accordion-box{background:var(--bg-paper);border:1px solid var(--border-subtle);margin-bottom:28px}
.timeline-accordion-head{padding:12px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-weight:700;font-size:13px;color:var(--ink-primary);user-select:none}
.timeline-accordion-head:hover{background:var(--bg-subtle)}
.timeline-chips-tray{padding:12px 16px 16px;border-top:1px dashed var(--border-subtle);display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
.timeline-chips-tray::-webkit-scrollbar{display:none}
.timeline-date-chip{padding:6px 14px;background:#fff;border:1px solid var(--border-subtle);font-family:var(--font-en);font-size:12px;font-weight:600;color:var(--ink-body);white-space:nowrap;cursor:pointer;transition:all .15s ease;display:flex;flex-direction:column;align-items:center;text-decoration:none}
.timeline-date-chip.is-active,.timeline-date-chip:hover{background:var(--ink-primary);color:#fff;border-color:var(--ink-primary)}
.quick-jump-nav-sticky{position:sticky;top:var(--header-height);z-index:860;background:rgba(255,255,255,.94);backdrop-filter:blur(20px);border-bottom:1px solid var(--border-subtle);padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-24px -16px 28px -16px}
.quick-jump-buttons{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.quick-jump-buttons::-webkit-scrollbar{display:none}
.btn-jump-number{min-width:34px;height:34px;border:1px solid var(--border-subtle);background:var(--bg-paper);color:var(--ink-primary);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 10px;cursor:pointer;white-space:nowrap;transition:all .15s ease}
.btn-jump-number:hover{background:var(--ink-primary);color:#fff;border-color:var(--ink-primary)}
.btn-toggle-all{font-size:11.5px;font-weight:700;color:var(--ink-secondary);padding:6px 12px;border:1px solid var(--border-subtle);background:#fff;cursor:pointer;white-space:nowrap}
.magazine-hero{border-bottom:1px solid var(--border-divider);padding-bottom:36px;margin-bottom:36px}
.magazine-hero__header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;border-bottom:2px solid var(--ink-primary);padding-bottom:10px}
.magazine-hero__brand{font-family:var(--font-serif);font-size:26px;letter-spacing:.14em;color:var(--ink-primary)}
.magazine-hero__date{font-family:var(--font-en);font-size:13px;color:var(--ink-secondary);font-weight:600}
.magazine-hero__media-grid{display:grid;grid-template-columns:1fr;gap:20px;margin-bottom:28px}
@media(min-width:768px){.magazine-hero__media-grid{grid-template-columns:3fr 2fr;gap:28px}}
.magazine-hero-photo-main{position:relative;aspect-ratio:4/3;overflow:hidden;background:var(--bg-muted)}
.magazine-hero-photo-main img{width:100% !important;height:100% !important;object-fit:cover;margin:0 !important;border:0 !important;background:none !important}
.magazine-hero-side-card{display:flex;flex-direction:column;justify-content:space-between;padding:24px;background:var(--bg-paper);border:1px solid var(--border-subtle)}
.magazine-dog-title{font-family:var(--font-serif) !important;font-size:30px !important;font-weight:700;letter-spacing:.08em;color:var(--ink-primary);line-height:1.2;margin-bottom:8px !important}
.magazine-dog-sub{font-size:13px;color:var(--ink-secondary)}
.magazine-letter-section{padding:28px 24px;background:var(--bg-paper);border-left:3px solid var(--ink-primary);margin-bottom:40px}
.magazine-letter-title{font-family:var(--font-serif) !important;font-size:18px !important;font-weight:600;letter-spacing:.08em;color:var(--ink-primary);margin-bottom:12px !important}
.magazine-letter-body{font-size:14.5px !important;line-height:2.1 !important;color:var(--ink-body);letter-spacing:.03em;white-space:pre-wrap;margin-bottom:0 !important}
.wave-accordion-stack{display:flex;flex-direction:column;gap:12px;margin-bottom:48px}
.wave-card{border:1px solid var(--border-subtle);background:#fff;transition:all .3s var(--ease-editorial);overflow:hidden}
.wave-card.is-open{border-color:var(--ink-primary)}
.wave-card-head{padding:16px 20px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;background:var(--bg-paper);transition:background .2s ease}
.wave-card-head:hover{background:var(--bg-subtle)}
.wave-card.is-open .wave-card-head{background:#fff;border-bottom:1px solid var(--border-subtle)}
.wave-card-head__title-wrap{display:flex;align-items:center;gap:12px}
.wave-card-number-badge{width:26px;height:26px;border-radius:50%;background:var(--ink-primary);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:var(--font-en)}
.wave-card-title{font-family:var(--font-serif);font-size:16px;font-weight:700;letter-spacing:.04em}
.wave-card-status-pill{font-size:11px;font-weight:700;padding:3px 10px;background:#eaf5ea;color:var(--accent-sage);white-space:nowrap}
.wave-card-toggle-icon{width:20px;height:20px;display:flex;align-items:center;justify-content:center;transition:transform .3s ease;color:var(--ink-secondary)}
.wave-card.is-open .wave-card-toggle-icon{transform:rotate(180deg)}
.wave-separator-svg{width:100%;height:12px;display:block;fill:none;stroke:var(--border-subtle);stroke-width:1.5}
.wave-card-body{display:none;padding:24px 20px}
.wave-card.is-open .wave-card-body{display:block}
.wave-body-grid-2col{display:grid;grid-template-columns:1fr;gap:20px}
@media(min-width:768px){.wave-body-grid-2col{grid-template-columns:1fr 1fr}}
.wave-body-img-frame{border:1px solid var(--border-subtle);background:var(--bg-paper);overflow:hidden}
.wave-body-img-frame img{width:100% !important;height:auto;object-fit:cover;margin:0 !important;border:0 !important;background:none !important}
.gallery-mosaic-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media(min-width:768px){.gallery-mosaic-grid{grid-template-columns:repeat(4,1fr);gap:16px}}
.gallery-mosaic-item{position:relative;aspect-ratio:1;overflow:hidden;background:var(--bg-muted);cursor:pointer}
.gallery-mosaic-item img{width:100% !important;height:100% !important;object-fit:cover;transition:transform .4s var(--ease-editorial);margin:0 !important;border:0 !important;background:none !important}
.gallery-mosaic-item:hover img{transform:scale(1.05)}
.lightbox-modal{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(12px)}
.lightbox-modal.is-open{display:flex}
.lightbox-modal img{width:auto !important;max-width:90vw !important;height:auto !important;max-height:85vh !important;margin:0 !important;border:0 !important;background:none !important}
@media(max-width:600px){
  .magazine-container{padding:14px 10px 80px}
  .quick-jump-nav-sticky{margin:-14px -10px 18px -10px;padding:6px 8px;gap:4px}
  .btn-jump-number{min-width:26px;height:26px;font-size:10px;padding:0 5px}
  .btn-toggle-all{padding:4px 6px;font-size:9.5px}
  .magazine-hero{padding-bottom:20px;margin-bottom:24px}
  .magazine-hero__brand{font-size:20px}
  .magazine-hero__date{font-size:11px}
  .magazine-hero-side-card{padding:16px 12px}
  .magazine-dog-title{font-size:22px}
  .magazine-dog-sub{font-size:12px}
  .magazine-letter-section{padding:18px 14px;margin-bottom:28px}
  .magazine-letter-title{font-size:16px}
  .magazine-letter-body{font-size:13px;line-height:1.9}
  .wave-card-head{padding:12px 14px}
  .wave-card-title{font-size:13.5px}
  .wave-card-number-badge{width:22px;height:22px;font-size:10.5px}
  .wave-card-status-pill{font-size:9.5px;padding:2px 6px}
  .wave-card-body{padding:16px 12px}
  .gallery-mosaic-grid{grid-template-columns:repeat(2,1fr);gap:8px}
}
`;

function injectStyle() {
  if (document.getElementById('magazine-view-style')) return;
  const style = document.createElement('style');
  style.id = 'magazine-view-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function esc(value) {
  return value == null ? '' : String(value);
}

function fmtDate(isoOrSlash) {
  const s = esc(isoOrSlash).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}.${iso[2]}.${iso[3]}`;
  const slash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[1]}.${String(slash[2]).padStart(2, '0')}.${String(slash[3]).padStart(2, '0')}`;
  return s || '（日付未入力）';
}

function firstNonEmpty(list) {
  return (list || []).find((v) => typeof v === 'string' && v.trim() !== '') || '';
}

function setText(root, view, text) {
  const el = root.querySelector(`[data-view="${view}"]`);
  if (el) el.textContent = text;
  return el;
}

function setImage(root, frameView, imgView, src, hideFrame) {
  const frame = frameView ? root.querySelector(`[data-view="${frameView}"]`) : null;
  const img = root.querySelector(`[data-view="${imgView}"]`);
  const has = typeof src === 'string' && src.trim() !== '';
  /* 写真が無いときは **属性ごと出さない**。`img.src = ''` は空文字を入れたつもりでも
     ブラウザが**現在のページURL**に解決するため、空のスロット全部が
     `https://…/edit/p/{petId}` を指す（`docs/deferred.md` #16 ／ `D-20260824-30` #3）。
     枠を `hidden` にしているので目には見えないが、**飼い主の画面に読めない画像の
     取得要求が並ぶ**ことに変わりはなく、⑥を結線した瞬間に表に出る。 */
  if (img) {
    if (has) img.src = src;
    else img.removeAttribute('src');
  }
  if (frame) frame.hidden = hideFrame != null ? hideFrame : !has;
  return has;
}

function renderSkinRows(root, skin, lightbox) {
  const host = root.querySelector('[data-view="skin-rows"]');
  if (!host) return 0;
  host.replaceChildren();
  const rows = (skin || []).filter((s) => s && (s.loc || s.size || s.type || s.change));
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13.5px;line-height:1.8;color:var(--ink-secondary)';
    p.textContent = '記録がありません。';
    host.append(p);
    return 0;
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  rows.forEach((s) => {
    const row = document.createElement('div');
    row.style.cssText = 'font-size:12.5px;background:var(--bg-paper);padding:10px;border:1px solid var(--border-subtle)';
    const parts = [];
    if (s.loc) parts.push(`部位: ${s.loc}`);
    if (s.size) parts.push(`大きさ: ${s.size}`);
    if (s.type) parts.push(`種類: ${s.type}`);
    if (s.change) parts.push(`経過: ${s.change}`);
    row.textContent = parts.join(' / ');
    wrap.append(row);
  });
  host.append(wrap);
  return rows.length;
}

function renderWeightGraph(root, weights, bestWeight) {
  const host = root.querySelector('[data-view="weight-graph"]');
  if (!host) return;
  host.replaceChildren();
  const points = (weights || []).filter((w) => w && w.ym && Number.isFinite(Number(w.kg)));
  if (points.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:13.5px;line-height:1.8;color:var(--ink-secondary)';
    p.textContent = bestWeight ? `目標体重: ${bestWeight}kg（体重の記録はまだありません）` : '記録がありません。';
    host.append(p);
    return;
  }
  const sorted = points.slice().sort((a, b) => String(a.ym).localeCompare(String(b.ym)));
  const kgs = sorted.map((w) => Number(w.kg));
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  const span = max - min || 1;
  const w = 300;
  const h = 90;
  const pad = 10;
  const xStep = sorted.length > 1 ? (w - pad * 2) / (sorted.length - 1) : 0;
  const coords = sorted.map((pt, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (Number(pt.kg) - min) / span) * (h - pad * 2);
    return { x, y, kg: pt.kg, ym: pt.ym };
  });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '90');
  const polyline = document.createElementNS(svgNS, 'polyline');
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', '#121212');
  polyline.setAttribute('stroke-width', '2.5');
  polyline.setAttribute('points', coords.map((c) => `${c.x},${c.y}`).join(' '));
  svg.append(polyline);
  const last = coords[coords.length - 1];
  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('cx', String(last.x));
  dot.setAttribute('cy', String(last.y));
  dot.setAttribute('r', '4');
  dot.setAttribute('fill', '#c85a32');
  svg.append(dot);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:var(--bg-paper);padding:16px;border:1px solid var(--border-subtle)';
  const label = document.createElement('div');
  label.style.cssText = 'font-size:11px;font-weight:700;color:var(--ink-muted);margin-bottom:8px';
  label.textContent = '体重推移 (kg)';
  wrap.append(label, svg);
  const current = document.createElement('div');
  current.style.cssText = 'font-size:12.5px;margin-top:8px;color:var(--ink-secondary)';
  current.textContent = `直近: ${last.ym} ${last.kg}kg${bestWeight ? `（目標 ${bestWeight}kg）` : ''}`;
  wrap.append(current);
  host.append(wrap);
}

function renderGallery(root, photos) {
  const host = root.querySelector('[data-view="trimming-gallery"]');
  if (!host) return;
  host.replaceChildren();
  const list = (photos || []).filter((src) => typeof src === 'string' && src.trim() !== '');
  list.forEach((src) => {
    const item = document.createElement('div');
    item.className = 'gallery-mosaic-item';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'カルテ写真';
    item.append(img);
    item.addEventListener('click', () => openLightbox(root, src));
    host.append(item);
  });
}

function openLightbox(root, src) {
  const modal = root.querySelector('[data-view="lightbox"]');
  const img = root.querySelector('[data-view="lightbox-img"]');
  if (!modal || !img || !src) return;
  img.src = src;
  modal.classList.add('is-open');
}

function wireLightbox(root) {
  const modal = root.querySelector('[data-view="lightbox"]');
  if (modal) modal.addEventListener('click', () => modal.classList.remove('is-open'));
  root.querySelectorAll('[data-view="hero-photo"], [data-view="skin-image"], [data-view="ear-image"], [data-view="teeth-image"]')
    .forEach((img) => {
      img.addEventListener('click', () => { if (img.src) openLightbox(root, img.src); });
      img.style.cursor = 'pointer';
    });
}

function wireAccordion(root) {
  root.querySelectorAll('[data-toggle]').forEach((head) => {
    head.addEventListener('click', () => {
      const card = root.querySelector(`#${head.dataset.toggle}`);
      if (card) card.classList.toggle('is-open');
    });
  });
  root.querySelectorAll('[data-jump]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = root.querySelector(`#${btn.dataset.jump}`);
      if (card) {
        card.classList.add('is-open');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
  const toggleAll = root.querySelector('[data-view="toggle-all"]');
  if (toggleAll) {
    let open = true;
    toggleAll.addEventListener('click', () => {
      open = !open;
      root.querySelectorAll('.wave-card').forEach((card) => card.classList.toggle('is-open', open));
      toggleAll.textContent = open ? '全開/全閉' : 'すべて開く';
    });
  }
}

function renderTimeline(root, report) {
  const box = root.querySelector('[data-view="timeline-box"]');
  const tray = root.querySelector('[data-view="timeline-tray"]');
  const toggleHead = root.querySelector('[data-view="timeline-toggle"]');
  const toggleText = root.querySelector('[data-view="timeline-toggle-text"]');
  if (!box || !tray) return;
  const siblings = (report.siblingReports || []).filter((r) => r && r.id);
  if (siblings.length === 0) { box.hidden = true; return; }
  box.hidden = false;
  tray.replaceChildren();
  siblings.forEach((r) => {
    const chip = document.createElement(report.linkBase ? 'a' : 'div');
    chip.className = 'timeline-date-chip';
    if (r.id === report.currentReportId) chip.classList.add('is-active');
    if (report.linkBase) chip.href = `${report.linkBase}${encodeURIComponent(r.id)}`;
    const date = document.createElement('span');
    date.textContent = fmtDate(r.report_date);
    chip.append(date);
    tray.append(chip);
  });
  if (toggleHead && !toggleHead.dataset.wired) {
    toggleHead.dataset.wired = '1';
    toggleHead.addEventListener('click', () => {
      const isOpen = tray.style.display !== 'none';
      tray.style.display = isOpen ? 'none' : 'flex';
      if (toggleText) toggleText.textContent = isOpen ? '表示する ▼' : '閉じる ▲';
    });
  }
}

/**
 * renderMagazine(container, report, opts)
 * report: {
 *   petName, reportDate,           // 表示用の犬名・来店日
 *   data,                          // extractReport() と同一スキーマ（写真は解決済みsrc）
 *   siblingReports, currentReportId, linkBase,  // タイムライン（任意）
 * }
 * opts: { onBack, backLabel }      // 戻るボタン（任意）
 */
/** カルテが取れなかったときに器へ入れる、正直な空の状態。
    ここに文例を置かない——置いた瞬間に #1 が戻る。 */
const EMPTY_HTML = '<p style="padding:28px 24px;color:#8c8c88;font-size:14px;line-height:2">'
  + 'このカルテはまだ表示できません。</p>';

export function renderMagazine(container, report, opts = {}) {
  if (!container) throw new Error('renderMagazine: 描画先の器がありません');
  if (!report) {
    /* **静かに帰らない。** 帰ると、器に前から入っていたものが残る。
       ⑥の器（`src/index.html` の screen-4）には意匠モック由来の
       「担当トリマーからのメッセージ」の文例が入っているので、
       **誰も書いていない手紙が、担当トリマーが書いたものとして飼い主に見え続ける**
       （`docs/ops/bad-scenarios-F3.md` #1）。`D-2`「null は必ず失敗として扱う」の表示側。

       先に器を空にしてから投げる。呼び出し側が握りつぶしても、
       **偽の手紙だけは残らない**ようにするため。 */
    container.innerHTML = EMPTY_HTML;
    throw new Error('renderMagazine: カルテがありません（呼び出し側で必ず扱うこと）');
  }
  injectStyle();
  container.innerHTML = TEMPLATE;
  const data = report.data || {};

  setText(container, 'report-date', `${fmtDate(report.reportDate || data.isoDate || data.date)}`);
  setText(container, 'dog-name', esc(report.petName || data.pet));
  setText(container, 'dog-sub', data.bestWeight ? `目標体重 ${data.bestWeight}kg` : '');

  const heroPhoto = firstNonEmpty(data.heroPhotos) || firstNonEmpty((data.trimming || {}).photos);
  setImage(container, 'hero-photo-frame', 'hero-photo', heroPhoto);

  const staffNote = esc(data.staffNote).trim();
  const letterSection = container.querySelector('[data-view="letter-section"]');
  if (letterSection) letterSection.hidden = staffNote === '';
  setText(container, 'staff-note', staffNote);

  const skinCount = renderSkinRows(container, data.skin, true);
  setText(container, 'skin-pill', skinCount > 0 ? `記録 ${skinCount}件` : '記録なし');
  setImage(container, 'skin-image-frame', 'skin-image', data.bodyMarkingImage);

  const nailLevel = Number(data.nail && data.nail.level) || 0;
  setText(container, 'nail-pill', nailLevel > 0 ? `Lv.${nailLevel}` : '未記録');
  setText(container, 'nail-comment', esc(data.nail && data.nail.comment).trim() || '記録がありません。');

  const earRight = Number(data.ear && data.ear.right) || 0;
  const earLeft = Number(data.ear && data.ear.left) || 0;
  setText(container, 'ear-pill', earRight || earLeft ? `右 Lv.${earRight || '-'} / 左 Lv.${earLeft || '-'}` : '未記録');
  setText(container, 'ear-comment', esc(data.ear && data.ear.comment).trim() || '記録がありません。');
  setImage(container, 'ear-image-frame', 'ear-image', data.ear && data.ear.photo);

  const teethStatus = esc(data.teeth && data.teeth.status).trim();
  setText(container, 'teeth-pill', teethStatus || '未記録');
  setText(container, 'teeth-comment', esc(data.teeth && data.teeth.comment).trim() || '記録がありません。');
  setImage(container, 'teeth-image-frame', 'teeth-image', firstNonEmpty([(data.teeth || {}).photo, (data.teeth || {}).diagram]));

  const weightPoints = (data.weights || []).filter((w) => w && w.ym && Number.isFinite(Number(w.kg)));
  setText(container, 'weight-pill', weightPoints.length > 0 ? `${weightPoints[weightPoints.length - 1].kg}kg` : '未記録');
  renderWeightGraph(container, data.weights, data.bestWeight);

  const cutPhotos = [...((data.trimming || {}).photos || []), ...((data.bodyLanguage || {}).photos || [])]
    .filter((src) => typeof src === 'string' && src.trim() !== '');
  setText(container, 'cut-pill', cutPhotos.length > 0 ? `${cutPhotos.length}枚撮影` : '写真なし');
  setText(container, 'trimming-comment', esc(data.trimming && data.trimming.comment).trim());
  setText(container, 'body-language-comment', esc(data.bodyLanguage && data.bodyLanguage.comment).trim());
  renderGallery(container, cutPhotos);

  renderTimeline(container, report);

  const backBtn = container.querySelector('[data-view="back-btn"]');
  if (backBtn && typeof opts.onBack === 'function') {
    backBtn.hidden = false;
    backBtn.textContent = opts.backLabel || '一覧へ戻る';
    backBtn.addEventListener('click', opts.onBack);
  }

  wireAccordion(container);
  wireLightbox(container);
}

/* ponchi-app.js は classic script（type=module ではない）なので import できない。
   publish-client-ponchi.js の window.SaltyDogPonchi と同じ橋渡し方式を使う。 */
if (typeof window !== 'undefined') {
  window.SaltyDogMagazine = { renderMagazine };
}

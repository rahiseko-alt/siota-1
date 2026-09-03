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
          <div class="magazine-course-badge" data-view="course-badge" hidden></div>
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
        <div class="wave-body-grid-2col" data-view="nail-sides"></div>
        <p style="font-size:13.5px;line-height:1.8;color:var(--ink-body);margin-top:8px" data-view="nail-comment"></p>
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
          <div class="gallery-mosaic-grid" data-view="teeth-gallery"></div>
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
        <p style="font-size:13.5px;line-height:1.8;color:var(--ink-body);margin-bottom:8px" data-view="bcs-text" hidden></p>
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
        <div class="options-tags" data-view="options-tags" hidden></div>
        <div class="gallery-mosaic-grid" data-view="trimming-gallery"></div>
        <p style="margin-top:16px;font-size:13.5px;line-height:1.8" data-view="body-language-comment"></p>
      </div>
    </div>
  </section>

  <section class="magazine-revisit-box" data-view="revisit-box" hidden>
    <div class="magazine-revisit-tag">Next Schedule</div>
    <h4 class="magazine-revisit-title">次回のおすすめご来店時期</h4>
    <p class="magazine-revisit-desc">
      被毛の毛玉防止と皮膚の健康維持のため、定期的なケアをおすすめいたします。
    </p>
    <div class="magazine-revisit-date" data-view="revisit-date"></div>
    <div data-view="revisit-edit" hidden style="margin-top:20px">
      <label style="font-size:12px;opacity:.8;display:block;margin-bottom:6px">この犬だけの来店間隔（空欄なら既定日数を使用）</label>
      <div style="display:flex;gap:8px;justify-content:center;align-items:center">
        <input type="number" data-view="revisit-days-input" min="1" max="3650" style="width:90px;padding:8px;text-align:center">
        <span style="font-size:12px">日後</span>
        <button type="button" data-view="revisit-save-btn" class="boxbutton boxbutton--white" style="padding:8px 16px;min-height:auto">保存</button>
      </div>
      <p data-view="revisit-save-status" style="font-size:11px;margin-top:6px;min-height:14px"></p>
    </div>
  </section>

  <div style="text-align:center;margin-top:40px">
    <button type="button" class="btn-toggle-all" data-view="back-btn" style="padding:12px 28px" hidden></button>
  </div>
</div>

<div class="lightbox-modal" data-view="lightbox">
  <div class="lightbox-close-btn" style="position:absolute;top:16px;right:24px;color:#fff;font-size:32px;cursor:pointer">&times;</div>
  <!-- 空の src を書かない。空文字はブラウザが現在のページURLに解決するので、
       飼い主の画面を開くだけで「ページを画像として取りに行く」要求が1件出る
       （deferred #16 ／ D-20260824-30 #3 と同じ穴。拡大用のここだけ残っていた）。
       絵は openLightbox() が入れる。ここは JS のテンプレート文字列の中なので、
       コメントでも逆引用符を使わない——文字列がそこで終わる。 -->
  <img data-view="lightbox-img" alt="拡大画像">
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
  /* 全文明朝体（マスター指示・C-8再指示）。理由は src/index.html 参照。 */
  --font-sans:"Hiragino Mincho ProN","Yu Mincho",YuMincho,"Times New Roman",serif;
  --font-en:"Hiragino Mincho ProN","Yu Mincho",YuMincho,"Times New Roman",serif;
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
.magazine-course-badge{display:inline-block;margin-top:8px;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:.04em;background:var(--bg-paper);border:1px solid var(--border-subtle)}
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
.magazine-revisit-box{background:var(--ink-primary);color:#fff;padding:36px 28px;text-align:center;margin-bottom:40px}
.magazine-revisit-tag{font-family:var(--font-en);font-size:11px;letter-spacing:.2em;color:rgba(255,255,255,.6);text-transform:uppercase;margin-bottom:8px}
.magazine-revisit-title{font-family:var(--font-serif);font-size:22px;font-weight:600;letter-spacing:.08em;margin-bottom:14px}
.magazine-revisit-desc{font-size:14px;line-height:1.9;color:rgba(255,255,255,.85);max-width:600px;margin:0 auto 24px}
.magazine-revisit-date{font-family:var(--font-en);font-size:26px;font-weight:700;letter-spacing:.05em}
.wave-card.is-open .wave-card-body{display:block}
.wave-body-grid-2col{display:grid;grid-template-columns:1fr;gap:20px}
@media(min-width:768px){.wave-body-grid-2col{grid-template-columns:1fr 1fr}}
.wave-body-img-frame{border:1px solid var(--border-subtle);background:var(--bg-paper);overflow:hidden}
.wave-body-img-frame img{width:100% !important;height:auto;object-fit:cover;margin:0 !important;border:0 !important;background:none !important}
.options-tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.option-tag{background:var(--bg-paper);border:1px solid var(--border-subtle);border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;color:var(--ink-primary)}
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

/* 来店日に日数を足す（マスター指示 2026-08-29・D-20260829-58「次回のおすすめご来店時期」）。
   `fmtDate` と表記を揃えるため同じ `YYYY.MM.DD` で返す。UTC で計算する
   （タイムゾーンの日またぎでローカル日時を使うと1日ずれることがあるため）。 */
function addDaysToIsoLike(dateStr, days) {
  const s = esc(dateStr).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}.${mo}.${da}`;
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

/* 使用オプション（マスター指示 2026-08-31で復活）。選んだ名前をタグとして並べる。
   1件も無ければ帯ごと隠す（`D-10`）。`textContent` で入れる——店舗管理者が
   自由入力した名前なので `innerHTML` にすると細工が実行される（`D-9`/`verify:xss`）。 */
function renderOptionTags(root, names) {
  const host = root.querySelector('[data-view="options-tags"]');
  if (!host) return;
  host.replaceChildren();
  const list = (names || []).filter((v) => typeof v === 'string' && v.trim() !== '');
  list.forEach((name) => {
    const tag = document.createElement('span');
    tag.className = 'option-tag';
    tag.textContent = name;
    host.append(tag);
  });
  host.hidden = list.length === 0;
}

function renderGallery(root, photos, view = 'trimming-gallery') {
  const host = root.querySelector(`[data-view="${view}"]`);
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

/** 体重グラフに何を渡すか。**空の配列は「無い」として扱う。**
 *
 *  `report.weightHistory || data.weights` と書いていたが、**`[]` は真**なので
 *  `data.weights` へ落ちてこなかった。結果、確定カルテがまだ1枚も無い犬
 *  （初回の子）では、**今日量った体重が捨てられて**「記録がありません。」になる。
 *  実測: `weightHistory=[]` / `data.weights=[{kg:3.3,…}]` → 渡っていたのは `[]`。
 *
 *  直す前は、画面でも検査でも「まだ量っていない」と「量ったのに捨てた」が
 *  同じ見た目だったので、誰も気づけなかった（`D-12`）。
 *
 *  `history` は worker が確定カルテを横断して組み立てたもの。取れなかった回は
 *  `null` で来る（`worker/src/index.js` の `.catch(() => null)`）ので、
 *  **「取れなかった」と「1件も無い」を同じ扱いにする**——どちらも、いま手元に
 *  在るカルテ1枚分の体重を出すのが正しい。 */
export function pickWeightSeries(report, data) {
  const history = (report || {}).weightHistory;
  if (Array.isArray(history) && history.length > 0) return history;
  return (data || {}).weights;
}

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

  /* 来店日（マスター指示 2026-08-29・C-3）を時系列基準にする。`report.reportDate`
     は確定を押した日（`report_date` 列・migration 回避のため触っていない）で、
     `data.isoDate`/`data.date` が来店日入力欄からの値。**来店日が有れば来店日を
     優先する**——確定日を先に置くと、来店日入力の意味が画面に出ない
     （検証2・敵対検証で指摘）。古い報告（来店日入力欄が無かった頃）には
     `data.isoDate`/`data.date` が無いので、その場合だけ確定日にフォールバックする。 */
  setText(container, 'report-date', `${fmtDate(data.isoDate || data.date || report.reportDate)}`);
  setText(container, 'dog-name', esc(report.petName || data.pet));
  setText(container, 'dog-sub', data.bestWeight ? `目標体重 ${data.bestWeight}kg` : '');

  /* 来店コース（マスター指示 2026-08-29・C-9）。未記入（旧いカルテ等）は帯ごと隠す（`D-10`）。 */
  const course = esc(data.course).trim();
  const courseBadge = setText(container, 'course-badge', course);
  if (courseBadge) courseBadge.hidden = course === '';

  const heroPhoto = firstNonEmpty(data.heroPhotos) || firstNonEmpty((data.trimming || {}).photos);
  setImage(container, 'hero-photo-frame', 'hero-photo', heroPhoto);

  /* 次回のおすすめご来店時期（マスター指示 2026-08-29・D-20260829-58）。
     日数 = 犬ごとの上書き（`report.revisitDaysOverride`）優先、無ければ店舗の既定
     （`report.shopDefaultRevisitDays`）。どちらも渡ってこなければ空文字のまま。
     ここで先に計算するのは、案内文（下の letter-section）に織り込むため。 */
  const visitDateStr = data.isoDate || data.date || report.reportDate;
  const overrideRaw = report.revisitDaysOverride;
  const hasOverride = overrideRaw !== null && overrideRaw !== undefined && Number.isFinite(Number(overrideRaw));
  const shopDefaultRaw = report.shopDefaultRevisitDays;
  const revisitDays = hasOverride ? Number(overrideRaw) : Number(shopDefaultRaw);
  const revisitDateText = Number.isFinite(revisitDays) && revisitDays > 0
    ? addDaysToIsoLike(visitDateStr, revisitDays)
    : '';

  const staffNote = esc(data.staffNote).trim();
  /* 顧客ページ（編集欄が渡らない＝⑥飼い主側）の案内文には、次回のおすすめご来店時期を
     一文添える（マスター指示: 「次回のおすすめ時期は顧客ページの案内文に表示しろ」）。
     編集はスタッフ限定のままなので、この一文は⑤トリマー確認画面には出さない
     （`opts.onRevisitDaysChange` の有無で分ける——編集欄の出し分けと同じ条件）。 */
  const isCustomerView = typeof opts.onRevisitDaysChange !== 'function';
  const revisitLine = isCustomerView && revisitDateText ? `次回のご来店は ${revisitDateText} 頃をおすすめします。` : '';
  const noteDisplay = [staffNote, revisitLine].filter(Boolean).join('\n\n');
  const letterSection = container.querySelector('[data-view="letter-section"]');
  if (letterSection) letterSection.hidden = noteDisplay === '';
  setText(container, 'staff-note', noteDisplay);

  const skinCount = renderSkinRows(container, data.skin, true);
  setText(container, 'skin-pill', skinCount > 0 ? `記録 ${skinCount}件` : '記録なし');
  setImage(container, 'skin-image-frame', 'skin-image', data.bodyMarkingImage);

  /* 爪は前足・後ろ足を分けて記録する（マスター指示 2026-08-29・C-5）。
     ⚠️ 移行前の旧いカルテは `nail.level`（単一値）のまま——**推測で埋めない**。
     前足・後ろ足のどちらも無ければ、旧い形の `level` を「前足」の値として出す
     （旧いカルテを空欄扱いにしないための、片方向だけの読み替え）。 */
  const nailFront = Number(data.nail && data.nail.front) || Number(data.nail && data.nail.level) || 0;
  const nailRear = Number(data.nail && data.nail.rear) || 0;
  const nailHost = container.querySelector('[data-view="nail-sides"]');
  if (nailHost) {
    nailHost.replaceChildren();
    const mk = (label, level) => {
      const div = document.createElement('div');
      div.style.cssText = 'font-size:12.5px;background:var(--bg-paper);padding:10px;border:1px solid var(--border-subtle);text-align:center';
      div.textContent = `${label}: ${level > 0 ? `Lv.${level}` : '未記録'}`;
      return div;
    };
    nailHost.append(mk('前足', nailFront), mk('後ろ足', nailRear));
  }
  setText(container, 'nail-pill', nailFront || nailRear ? `前 Lv.${nailFront || '-'} / 後 Lv.${nailRear || '-'}` : '未記録');
  setText(container, 'nail-comment', esc(data.nail && data.nail.comment).trim() || '記録がありません。');

  /* 耳は6段階（マスター指示 2026-08-29・C-6）。表示の形は従来どおり Lv.N。 */
  const earRight = Number(data.ear && data.ear.right) || 0;
  const earLeft = Number(data.ear && data.ear.left) || 0;
  setText(container, 'ear-pill', earRight || earLeft ? `右 Lv.${earRight || '-'} / 左 Lv.${earLeft || '-'}` : '未記録');
  setText(container, 'ear-comment', esc(data.ear && data.ear.comment).trim() || '記録がありません。');
  setImage(container, 'ear-image-frame', 'ear-image', data.ear && data.ear.photo);

  /* 口の写真は最大2枚（マスター指示 2026-08-29・C-11）。旧い単数キー
     （`photo` / `diagram`）が残っているカルテも、そのまま1枚として出す。 */
  const teethStatus = esc(data.teeth && data.teeth.status).trim();
  setText(container, 'teeth-pill', teethStatus || '未記録');
  setText(container, 'teeth-comment', esc(data.teeth && data.teeth.comment).trim() || '記録がありません。');
  const teethPhotos = ((data.teeth || {}).photos && (data.teeth || {}).photos.length > 0)
    ? data.teeth.photos
    : [firstNonEmpty([(data.teeth || {}).photo, (data.teeth || {}).diagram])].filter(Boolean);
  renderGallery(container, teethPhotos, 'teeth-gallery');

  const weightPoints = (data.weights || []).filter((w) => w && w.ym && Number.isFinite(Number(w.kg)));
  setText(container, 'weight-pill', weightPoints.length > 0 ? `${weightPoints[weightPoints.length - 1].kg}kg` : '未記録');
  const bcsLabels = { 1: '削痩', 2: 'やや細い', 3: '適正', 4: 'やや肥満', 5: '肥満' };
  const bcs = Number(data.bcs) || 0;
  const bcsText = setText(container, 'bcs-text', bcs > 0 ? `BCS: ${bcs}（${bcsLabels[bcs] || ''}）` : '');
  if (bcsText) bcsText.hidden = bcs === 0;
  /* **推移が在るならそれを描く**（マスター指示 2026-09-03）。`data.weights` は
     このカルテ1枚分（1回）しか持たないので、それだけを描いていたときは
     「体重推移」と書いた箱に**点が1つ**しか乗らなかった——`polyline` は2点未満では
     線を引けないので、推移は一度も飼い主に届いていない。`weightHistory` は
     worker が確定カルテを横断して組み立てたもの。無い経路では今までどおりに落ちる。
     **カルテの中身（`data`）からは読まない**——`key-parity` は `data` のプロパティを
     ⑥が読むキーとして数えるので、ここは保存されるキーではないことを形でも示しておく
     （実際に `report` 側から取っている）。 */
  /* **空の配列は「無い」として扱う。** `report.weightHistory || …` と書いていたが
     `[]` は真なので落ちてこず、**確定カルテがまだ1枚も無い犬では、今日量った体重が
     捨てられていた**（実測: `weightHistory=[]` / `data.weights=[{kg:3.3}]` →
     渡っていたのは `[]`。画面は「記録がありません。」）。直す前は「まだ量っていない」と
     「今日量ったのに捨てた」が画面でも検査でも見分けられなかった。 */
  renderWeightGraph(container, pickWeightSeries(report, data), data.bestWeight);

  const cutPhotos = [...((data.trimming || {}).photos || []), ...((data.bodyLanguage || {}).photos || [])]
    .filter((src) => typeof src === 'string' && src.trim() !== '');
  setText(container, 'cut-pill', cutPhotos.length > 0 ? `${cutPhotos.length}枚撮影` : '写真なし');
  setText(container, 'trimming-comment', esc(data.trimming && data.trimming.comment).trim());
  setText(container, 'body-language-comment', esc(data.bodyLanguage && data.bodyLanguage.comment).trim());
  renderOptionTags(container, data.options);
  renderGallery(container, cutPhotos);

  renderTimeline(container, report);

  /* 次回のおすすめご来店時期の箱（マスター指示 2026-08-29・D-20260829-58）。
     日数・日付テキストは冒頭（案内文を組み立てた箇所）で計算済みのものを使い回す。
     **どちらも渡ってこなければ節ごと隠す**（D-10・持っていない値を出さない）。
     編集欄はスタッフ側だけ（`opts.onRevisitDaysChange` が渡っているとき）出す
     ——⑥飼い主画面には渡さない。 */
  const revisitBox = container.querySelector('[data-view="revisit-box"]');
  if (revisitBox) {
    revisitBox.hidden = revisitDateText === '';
    setText(container, 'revisit-date', revisitDateText);

    const revisitEdit = container.querySelector('[data-view="revisit-edit"]');
    if (revisitEdit && typeof opts.onRevisitDaysChange === 'function') {
      revisitBox.hidden = false;
      revisitEdit.hidden = false;
      const input = container.querySelector('[data-view="revisit-days-input"]');
      if (input) input.value = hasOverride ? String(Number(overrideRaw)) : '';
      const statusEl = container.querySelector('[data-view="revisit-save-status"]');
      const saveBtn = container.querySelector('[data-view="revisit-save-btn"]');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const raw = (input && input.value || '').trim();
          const value = raw === '' ? null : Number(raw);
          if (value !== null && (!Number.isInteger(value) || value < 1 || value > 3650)) {
            if (statusEl) statusEl.textContent = '1〜3650の整数か、空欄にしてください。';
            return;
          }
          saveBtn.disabled = true;
          if (statusEl) statusEl.textContent = '保存中…';
          try {
            await opts.onRevisitDaysChange(value);
            const nextDays = value !== null ? value : Number(shopDefaultRaw);
            const nextText = Number.isFinite(nextDays) && nextDays > 0
              ? addDaysToIsoLike(visitDateStr, nextDays)
              : '';
            setText(container, 'revisit-date', nextText);
            revisitBox.hidden = nextText === '';
            if (statusEl) statusEl.textContent = '保存しました。';
          } catch (error) {
            if (statusEl) statusEl.textContent = `保存できませんでした。${error.message || ''}`;
          } finally {
            saveBtn.disabled = false;
          }
        });
      }
    }
  }

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

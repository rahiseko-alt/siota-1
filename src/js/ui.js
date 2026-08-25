const App = {
  currentStep: 1,
  currentDog: {
    name: 'ポンチ',
    owner: '塩田 様',
    breed: 'トイプードル',
    weight: 2.79,
    prevWeight: 2.67
  },
  currentStamp: '赤み',
  marks: [],
  allWavesOpen: true,

  /* 実データで動いているときに backend から入る犬の一覧。
     `null` のあいだは「まだ受け取っていない」。仮データ（`window.DUMMY`）を使うのは
     backend が居ないとき——つまり静的配信の `/`（F2 の `npm run walk` の経路）だけ。 */
  dogs: null,

  /* ④カルテ作成で押された値の控え。**押された時点で入る**（DOM から読み直さない）。
     初期値は「まだ触っていない」を表す。触っていないものを 0 や既定値で埋めない
     ——書いていないことが書いてあるように見える（`D-10`）。 */
  form: { nail: 0, ear: { right: 0, left: 0 }, teeth: '', weight: 0 },

  init() {
    this.initCanvas();

    /* backend が載っていれば、そちらに描画を任せる（`/edit`）。
       載っていなければ仮データで描く（`/`）。**判定は「居るか」だけ**で、
       URL を見ない——見ると経路が増えたときに黙って片方が壊れる。

       `supabase-staff.js` は ES モジュールなので `defer` 相当で走り、
       `DOMContentLoaded` の時点では `globalThis.TrimmerSupabaseStaff` が載っている
       （`bad-scenarios-F3` #10 で固定した繋ぎ方: backend が自分で globalThis に登録し、
       `ui.js` は古典スクリプトのままそれを使う）。 */
    if (globalThis.TrimmerSupabaseStaff) {
      globalThis.TrimmerSupabaseStaff.boot(this);
      return;
    }
    this.renderDogs();
  },

  /* ── 描画係の口 ────────────────────────────────────────────────
     `TrimmerSupabaseStaff.boot(App)` が、取ってきたものをここへ渡す。
     backend は `App` を依存ではなく**差し替え可能な口**として扱うので、
     こちら側が `show(screen, data)` を満たしていればよい（`plan.md` 4-1）。

     受け取る画面は4つ。知らない画面が来たら**投げる**——黙って無視すると、
     前の画面（意匠モックの既定文が入っている）が残り、
     お客さんがそれを本当のことだと読む（`bad-scenarios-F3` #1・`D-10`）。 */
  show(screen, data) {
    if (screen === 'owner') return this.showDogList(data || {});
    if (screen === 'archive') return this.showPetKarte(data || {});
    if (screen === 'report') return this.showReport(data || {});
    throw new Error(`描画できない画面が来ました: ${screen}`);
  },

  /* ②一覧 — 実データの犬をカードにする。
     `mapPet()` の形（`petName` / `ownerName` / `months`）を、カードの形に写すだけ。
     **持っていない項目は空で出す。** 犬種も担当も `pets` テーブルに無いので、
     ここで見本を入れると「書いていないことが書いてあるように見える」（`D-10`）。 */
  showDogList(data) {
    const pets = data.petListFlat || (data.owner && data.owner.pets) || [];
    this.dogs = pets.map((pet) => {
      const dates = (pet.months || []).map((m) => m && m.date).filter(Boolean).sort();
      return {
        id: pet.id,
        name: pet.petName || '',
        owner: pet.ownerName || '',
        breed: '',
        lastVisit: dates.length > 0 ? dates[dates.length - 1] : '',
        staff: '',
        incomplete: '',
      };
    });
    this.renderDogs();
    this.goToStep(2);
  },

  /* ③選択のあと — その犬のカルテ画面へ。
     いまは最新1件を開く導線が無いので、カルテ作成（screen-3）に入る。
     過去カルテを開く導線は ④保存・確定 と一緒に作る（`docs/deferred.md` #23）。 */
  showPetKarte(pet) {
    this.selectKarte(pet.petName || '', pet.ownerName || '', '');
  },

  /* ⑤確認 — 実データのカルテを screen-4 に描く。
     **描くのは backend のレンダラ**（`renderMagazine`）で、⑥顧客ページと同一のもの
     （マスター指定）。器の中身は丸ごと差し替わるので、意匠モックの既定文もここで消える。

     カルテが取れていなければ `renderMagazine` は器を空にしてから投げる。
     ここで握りつぶすと**誰も書いていない手紙が残る**ので、そのまま外へ出す。 */
  showReport(pet) {
    const render = globalThis.TrimmerSupabaseStaff && globalThis.TrimmerSupabaseStaff.renderMagazine;
    if (!render) throw new Error('カルテの描画係が載っていません');
    const panel = document.getElementById('screen-4');
    if (!panel) throw new Error('screen-4 が見つかりません');
    const report = globalThis.__REPORT__;
    /* **描いてから移る。** 先に移ると、描画に失敗したときに空の器へ人を運ぶ。 */
    render(panel, report && {
      petName: pet.petName || '',
      reportDate: report.isoDate || report.date || '',
      data: report,
    });
    this.goToStep(4);
  },

  /* 実データのカードを押したとき。URL を変えて backend に読み直させる
     （画面の中だけで完結させない——戻る・共有・再読み込みが効かなくなる）。 */
  openPet(petId) {
    location.href = `/edit/p/${encodeURIComponent(petId)}`;
  },

  /* 犬の一覧を仮データ（window.DUMMY）から描く。
     ベタ書きの3件を置き換えたもの。同名の犬（モモが2頭）を入れてあるのは、
     飼い主名まで見ないと見分けられない場面を、絵で確かめるため。 */
  renderDogs() {
    const box = document.getElementById('karte-cards-container');
    /* 実データを受け取っていればそれ。まだなら仮データ（`/` の経路だけ）。 */
    const data = this.dogs || (window.DUMMY && window.DUMMY.dogs) || [];
    if (!box) return;
    box.innerHTML = '';
    data.forEach((dog) => {
      const card = document.createElement('div');
      card.className = 'karte-card';
      /* 実データの犬は `id` を持つ。持っていれば URL で開く、持っていなければ
         画面の中だけで進む（仮データ）。**データの形で決める**——URL を見ない。 */
      card.onclick = () => (dog.id
        ? this.openPet(dog.id)
        : this.selectKarte(dog.name, dog.owner, dog.breed));
      card.innerHTML =
        '<div class="karte-card-top-row">'
        + '<div class="karte-card__avatar"></div>'
        + '<div class="karte-card__body">'
        +   '<div class="karte-card__name-line">'
        +     '<span class="karte-card__dog-name"></span>'
        +     '<span class="karte-card__owner-name"></span>'
        +     '<span class="karte-card__breed"></span>'
        +   '</div>'
        +   '<div class="karte-card__meta-line">'
        +     '<span>最終: <strong class="js-last"></strong></span>'
        +     '<span>担当: <strong class="js-staff"></strong></span>'
        +     '<span class="karte-card__badge-alert js-alert"></span>'
        +   '</div>'
        + '</div></div>'
        + '<div class="karte-card__actions">'
        +   '<button class="btn-clone-karte">前回を複製</button>'
        +   '<button class="boxbutton boxbutton--sm">選択</button>'
        + '</div>';
      /* 値は textContent で入れる。仮データでも、名前を HTML として解釈させない。 */
      card.querySelector('.karte-card__dog-name').textContent = dog.name;
      card.querySelector('.karte-card__owner-name').textContent = dog.owner;
      card.querySelector('.karte-card__breed').textContent = dog.breed;
      card.querySelector('.js-last').textContent = dog.lastVisit;
      card.querySelector('.js-staff').textContent = dog.staff;
      const alert = card.querySelector('.js-alert');
      if (dog.incomplete) alert.textContent = '⚠️ 未記入: ' + dog.incomplete;
      else alert.remove();
      const clone = card.querySelector('.btn-clone-karte');
      clone.onclick = (e) => { e.stopPropagation(); this.cloneAndCreate(dog.name, dog); };
      box.appendChild(card);
    });
    const total = document.getElementById('karte-total-count');
    if (total) total.textContent = data.length + '件';
  },

  goToStep(stepNum) {
    this.currentStep = stepNum;

    document.querySelectorAll('.btn-step').forEach(btn => {
      btn.classList.toggle('is-active', parseInt(btn.dataset.step) === stepNum);
    });

    document.querySelectorAll('.screen-panel').forEach(panel => {
      panel.classList.remove('is-active');
    });
    const targetPanel = document.getElementById(`screen-${stepNum}`);
    if (targetPanel) targetPanel.classList.add('is-active');

    const brandLabel = document.getElementById('nav-brand-label');
    if (brandLabel) {
      if (stepNum === 1) brandLabel.textContent = 'SALTY DOG';
      else if (stepNum === 2) brandLabel.textContent = 'カルテ検索・一覧';
      else if (stepNum === 3) brandLabel.textContent = `${this.currentDog.name} カルテ作成`;
      else if (stepNum === 4) brandLabel.textContent = `${this.currentDog.name} 顧客カルテ`;
    }

    if (stepNum === 3) {
      setTimeout(() => this.drawCanvas(), 50);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  selectKarte(dogName, ownerName, breed) {
    this.currentDog.name = dogName;
    this.currentDog.owner = ownerName;
    this.currentDog.breed = breed;

    /* screen-4 は実データのときレンダラが器ごと差し替えるので、この3つは
       在るとは限らない。無い前提で触る（`renderMagazine` が入ったあとに
       ここへ来ると、素で書くと TypeError で導線が止まる）。 */
    const header = document.getElementById('editor-dog-header');
    if (header) header.textContent = `${dogName} カルテ入力`;
    const magName = document.getElementById('mag-dog-name');
    if (magName) magName.textContent = `${dogName} くん`;
    const magSub = document.getElementById('mag-dog-sub');
    if (magSub) magSub.textContent = `${breed} / 4歳 / 2.79kg`;

    // 爪の未選択リセット & フッターを赤（未記入あり）にセット
    const nailWrap = document.getElementById('nail-stepper-wrap');
    if (nailWrap) {
      nailWrap.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('is-active'));
    }
    const dock = document.getElementById('editor-bottom-dock');
    const statusIcon = document.getElementById('dock-status-icon');
    const statusText = document.getElementById('dock-status-text');
    const gotoBtn = document.getElementById('btn-dock-goto');

    if (dock) dock.classList.add('has-incomplete');
    if (statusIcon) statusIcon.textContent = '⚠️';
    if (statusText) statusText.textContent = '未記入: 爪のチェック';
    if (gotoBtn) gotoBtn.style.display = 'inline-block';

    this.goToStep(3);
  },

  cloneAndCreate(dogName, dog) {
    alert(`【複製完了】${dogName}の過去カルテデータを読み込みました。変更箇所のみ上書きして保存できます。`);
    this.selectKarte(dogName, (dog && dog.owner) || '', (dog && dog.breed) || '');
  },

  createNewKarte() {
    this.selectKarte('新規わんちゃん', '新規飼い主 様', '未設定');
  },

  filterKarte(query) {
    const q = (query || '').trim().toLowerCase();
    const cards = document.querySelectorAll('.karte-card');
    let count = 0;

    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      if (!q || text.includes(q)) {
        card.style.display = 'flex';
        count++;
      } else {
        card.style.display = 'none';
      }
    });

    const totalEl = document.getElementById('karte-total-count');
    if (totalEl) totalEl.textContent = `${count}件`;
  },

  toggleDirVoiceSearch() {
    const btn = document.getElementById('dir-mic-btn');
    const label = document.getElementById('dir-mic-label');
    const input = document.getElementById('dir-search-input');

    if (btn) btn.classList.add('is-recording');
    if (label) label.textContent = '録音中...';

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SpeechRec();
      rec.lang = 'ja-JP';
      rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        if (input) {
          input.value = text;
          this.filterKarte(text);
        }
        if (btn) btn.classList.remove('is-recording');
        if (label) label.textContent = '音声検索';
      };
      rec.onerror = () => {
        if (btn) btn.classList.remove('is-recording');
        if (label) label.textContent = '音声検索';
      };
      rec.start();
    } else {
      setTimeout(() => {
        if (input) {
          input.value = 'ポンチ';
          this.filterKarte('ポンチ');
        }
        if (btn) btn.classList.remove('is-recording');
        if (label) label.textContent = '音声検索';
      }, 1200);
    }
  },

  toggleWaveCard(id) {
    const card = document.getElementById(id);
    if (card) {
      card.classList.toggle('is-open');
    }
  },

  toggleAllWaves() {
    this.allWavesOpen = !this.allWavesOpen;
    document.querySelectorAll('.wave-card').forEach(card => {
      card.classList.toggle('is-open', this.allWavesOpen);
    });
    const btn = document.getElementById('btn-toggle-all-waves');
    if (btn) btn.textContent = this.allWavesOpen ? 'すべて閉じる' : 'すべて開く';
  },

  jumpToWave(id) {
    const card = document.getElementById(id);
    if (card) {
      card.classList.add('is-open');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  toggleTimeline() {
    const tray = document.getElementById('timeline-tray');
    const label = document.getElementById('timeline-toggle-text');
    if (tray) {
      const isOpen = tray.style.display !== 'none';
      tray.style.display = isOpen ? 'none' : 'flex';
      if (label) label.textContent = isOpen ? '表示する ▼' : '閉じる ▲';
    }
  },

  switchReportDate(dateStr, chipEl) {
    document.querySelectorAll('.timeline-date-chip').forEach(c => c.classList.remove('is-active'));
    chipEl.classList.add('is-active');

    const dateLabel = document.getElementById('mag-report-date-label');
    if (dateLabel) dateLabel.textContent = `${dateStr} vol.24`;
    alert(`【過去カルテ表示】${dateStr} の施術記録に切り替えました。`);
  },

  selectStepper(btn, type, val) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    }
    
    /* 掴んだ値を控える。`is-active` から読み直す手もあるが、爪の表示は
       「1. 適切」のように**日本語混じり**で、数字だけを取り出す規則が要る。
       押された時点の値をそのまま持つほうが、規則を1つ減らせる。 */
    this.form[type] = val;

    if (type === 'nail') {
      const dock = document.getElementById('editor-bottom-dock');
      const statusIcon = document.getElementById('dock-status-icon');
      const statusText = document.getElementById('dock-status-text');
      const gotoBtn = document.getElementById('btn-dock-goto');

      if (dock) dock.classList.remove('has-incomplete');
      if (statusIcon) statusIcon.textContent = '✓';
      if (statusText) statusText.textContent = '全項目入力完了 (6/6)';
      if (gotoBtn) gotoBtn.style.display = 'none';
    }
  },

  /* 耳は左右で同じ形の段が2つ並ぶ。押されたボタンだけでは**どちらの耳か分からない**
     ので、囲みに付けた `data-ear`（`right` / `left`・ASCII。`D-9`）で見分ける。 */
  selectSubStepper(btn) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const side = parent.dataset && parent.dataset.ear;
      if (side === 'right' || side === 'left') {
        const val = btn.querySelector('.val');
        this.form.ear[side] = Number((val && val.textContent) || '') || 0;
      }
    }
  },

  selectTeeth(btn, label) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.teeth-pill-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    }
    this.form.teeth = label;
  },

  onWeightChange(val) {
    const w = parseFloat(val) || 0;
    this.form.weight = w;
    const diff = Math.round((w - this.currentDog.prevWeight) * 1000);
    const badge = document.getElementById('weight-diff-badge');
    if (badge) {
      if (diff >= 0) {
        badge.className = 'weight-diff-badge is-up';
        badge.textContent = `+${diff}g ▲`;
      } else {
        badge.className = 'weight-diff-badge is-down';
        badge.textContent = `${diff}g ▼`;
      }
    }
  },

  toggleEditorVoice() {
    const btn = document.getElementById('editor-voice-btn');
    const ta = document.getElementById('editor-trimmer-letter');
    if (btn) btn.classList.add('is-recording');

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SpeechRec();
      rec.lang = 'ja-JP';
      rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        if (ta) {
          ta.value += (ta.value ? ' ' : '') + text;
          document.getElementById('mag-letter-content').textContent = ta.value;
        }
        if (btn) btn.classList.remove('is-recording');
      };
      rec.onerror = () => { if (btn) btn.classList.remove('is-recording'); };
      rec.start();
    } else {
      setTimeout(() => {
        if (ta) {
          ta.value += (ta.value ? ' ' : '') + '耳裏のブラッシングを丁寧に行いました。';
          document.getElementById('mag-letter-content').textContent = ta.value;
        }
        if (btn) btn.classList.remove('is-recording');
      }, 1500);
    }
  },

  focusNailSection() {
    const sec = document.getElementById('sec-nail');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  initCanvas() {
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) return;
    const wrapper = document.getElementById('canvas-wrapper');

    const resize = () => {
      canvas.width = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
      this.drawCanvas();
    };

    window.addEventListener('resize', resize);
    setTimeout(resize, 100);

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      this.marks.push({ x, y, type: this.currentStamp });
      this.drawCanvas();
    });
  },

  setStamp(type, btn) {
    this.currentStamp = type;
    document.querySelectorAll('.stamp-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  },

  clearCanvas() {
    this.marks = [];
    this.drawCanvas();
  },

  /* 犬体図に付けた印を、カルテに残せる形（PNG）で取り出す。

     印は `marks` に載っているだけで、**画面を移れば消える**。トリマーが体を触って
     見つけた「しこり/イボ」も、ここを通らなければ飼い主にも記録にも残らない
     （`docs/ops/bad-scenarios-F3.md` #3）。⑥の受け手は
     `backend/js/magazine-view.js` の `data.bodyMarkingImage` で、**そこへ渡す唯一の道**。

     印が1つも無いときは `null` を返す——白紙の絵を「所見あり」として残さない。
     印が在るのに描き先が無いときは**投げる**。黙って `null` を返すと、
     見つけた所見が消えたことに誰も気づけない（`#1` と同じ型）。 */
  /* ④が出す側。⑥（`backend/js/magazine-view.js`）が読む形にそろえる。

     **対応は `docs/ops/key-parity-F3.md` が正**で、`scripts/guard/key-parity.mjs` が
     毎回突き合わせる。⑥に読む先を足したのにここが出していなければ**黙って消える**し、
     ここが出していて⑥が読まなければ**届かない**——どちらも同じ事故なので両方向を見る
     （`F-20260821-12`/`-13` の型）。

     **入力欄が無いキーは、キーごと出さない。** 空の器を出すと⑥側で「記録なし」と
     「入力欄が無い」を区別できなくなる。出どころが無い6キー（`date` `isoDate`
     `bestWeight` `skin` `heroPhotos` `bodyLanguage`）は、いま正UI に入力が無い。 */
  extractReport() {
    const text = (selector) => {
      const el = document.querySelector(selector);
      return ((el && (el.value != null ? el.value : el.textContent)) || '').trim();
    };
    const report = {};
    const context = globalThis.__REPORT_CONTEXT__;
    if (context && context.petName) report.pet = context.petName;

    const staffNote = text('[data-field="staff-note"]');
    if (staffNote) report.staffNote = staffNote;

    if (this.form.nail) report.nail = { level: this.form.nail };
    if (this.form.ear.right || this.form.ear.left) {
      report.ear = { right: this.form.ear.right, left: this.form.ear.left };
    }
    if (this.form.teeth) report.teeth = { status: this.form.teeth };
    if (this.form.weight) report.weights = [{ kg: this.form.weight }];

    const length = text('[data-field="trim-length"]');
    const style = text('[data-field="trim-style"]');
    if (length || style) report.trimming = { length, style };

    /* 犬体図の印。**印が無ければキーごと出さない**（白紙の絵を「所見あり」にしない）。
       印が在るのに描き先が無ければ `exportBodyMarking()` が投げる——握らない。 */
    const marking = this.exportBodyMarking();
    if (marking) report.bodyMarkingImage = marking;

    return report;
  },

  exportBodyMarking() {
    if (this.marks.length === 0) return null;
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) throw new Error('犬体図が見つからないため、付けた印を保存できません');
    this.drawCanvas();
    return canvas.toDataURL('image/png');
  },

  drawCanvas() {
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const img = document.getElementById('canvas-bg-img');
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#faf9f6';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8c8c88';
      ctx.font = '12px Noto Sans JP';
      ctx.textAlign = 'center';
      ctx.fillText('犬体4面図（前面・背面・左側面・右側面）', canvas.width / 2, canvas.height / 2);
    }

    this.marks.forEach(m => {
      const px = m.x * canvas.width;
      const py = m.y * canvas.height;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);

      if (m.type === '赤み') ctx.fillStyle = '#d32f2f';
      else if (m.type === 'しこり/イボ') ctx.fillStyle = '#f57c00';
      else if (m.type === '毛玉') ctx.fillStyle = '#1976d2';
      else ctx.fillStyle = '#7b1fa2';

      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(m.type.charAt(0), px, py + 3);
    });
  },

  openLightbox(src) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    if (modal && img) {
      img.src = src;
      modal.classList.add('is-open');
    }
  },

  closeLightbox() {
    const modal = document.getElementById('lightbox-modal');
    if (modal) modal.classList.remove('is-open');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

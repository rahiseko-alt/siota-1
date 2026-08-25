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

  init() {
    this.renderDogs();
    this.initCanvas();
  },

  /* 犬の一覧を仮データ（window.DUMMY）から描く。
     ベタ書きの3件を置き換えたもの。同名の犬（モモが2頭）を入れてあるのは、
     飼い主名まで見ないと見分けられない場面を、絵で確かめるため。 */
  renderDogs() {
    const box = document.getElementById('karte-cards-container');
    const data = (window.DUMMY && window.DUMMY.dogs) || [];
    if (!box) return;
    box.innerHTML = '';
    data.forEach((dog) => {
      const card = document.createElement('div');
      card.className = 'karte-card';
      card.onclick = () => this.selectKarte(dog.name, dog.owner, dog.breed);
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

    document.getElementById('editor-dog-header').textContent = `${dogName} カルテ入力`;
    document.getElementById('mag-dog-name').textContent = `${dogName} くん`;
    document.getElementById('mag-dog-sub').textContent = `${breed} / 4歳 / 2.79kg`;

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

  selectSubStepper(btn) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    }
  },

  selectTeeth(btn, label) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.teeth-pill-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    }
  },

  onWeightChange(val) {
    const w = parseFloat(val) || 0;
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

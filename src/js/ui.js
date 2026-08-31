const App = {
  currentStep: 1,
  currentDog: {
    name: 'ポンチ',
    owner: '塩田 様',
    breed: 'トイプードル',
    /* **見本の数字を置かない。** ここに 2.79 / 2.67 が入っていたため、
       どの犬を開いても同じ体重と「前回比」が出ていた（書いていないことが
       書いてあるように見える・`D-10`）。前回の記録は、実データから
       入るまで `null`＝「記録なし」。 */
    weight: null,
    prevWeight: null
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
     ——書いていないことが書いてあるように見える（`D-10`）。
     `nail` は前足・後ろ足を分けて記録する（マスター指示 2026-08-29・C-5）。 */
  form: {
    nail: { front: 0, rear: 0 }, ear: { right: 0, left: 0 }, teeth: '', weight: 0,
    bcs: 0, bestWeight: 0, options: [],
  },

  /* 口の写真1枚あたりの上限枚数（マスター指示 2026-08-29・C-11）。 */
  MAX_TEETH_PHOTOS: 2,

  /* 選ばれた写真。**中身は `data:image/jpeg` か、既に上がっている `asset://{id}`。**
     前者は `saveReport`/`reviseReport` が実体化し（`replaceDataUrlAssets`）、
     後者は**そのまま出し直す**——直しのときに落とすと、飼い主に届いていた写真が消える。
     `trimming` と `teeth` は配列（`teeth` は最大2枚・C-11）、耳は1枚のまま。 */
  photos: { trimming: [], ear: '', teeth: [] },

  /* 下書きの居場所。`null` は「まだ1度も保存していない」。 */
  draftPetId: null,
  draftReportId: null,
  /* 確定済みカルテを直しているときだけ、その id が入る（管理者画面「カルテ修正」）。
     `null` は「新しく書いている」。ここが混ざると、直したつもりが2枚目になる。 */
  reviseReportId: null,
  draftWatching: false,
  draftTimer: null,
  draftSaving: false,

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
        ownerId: pet.ownerId || '',
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
     カルテ作成（screen-3）に入り、その犬の**過去カルテを同じ画面に並べる**
     （`docs/deferred.md` #23・マスター指定 2026-08-26）。 */
  showPetKarte(pet) {
    this.selectKarte(pet.petName || '', pet.ownerName || '', '');
    this.renderPastReports(pet);
    /* 使用オプションのボタンを、下書き読み込みより前に組み立てる。
       `resumeDraft` が呼ぶ `applyReport` はボタンを探して押すので、
       先に用意しておかないと選んでいたものが戻せない。 */
    this.renderOptionChips(pet.shopGroomingOptions || []);
    this.resumeDraft(pet.id);
  },

  /* その犬の過去カルテを、新しい順に並べる。
     **確定済み（`final`）だけを出す。** 下書きは飼い主に届いていないし、
     archived は畳んだものなので、ここに混ぜると「在る」ことになってしまう。
     **1件も無ければ帯ごと出さない**——空の一覧は「まだ無い」と
     「読み込めていない」の区別を消す（`D-10`）。

     文字は `textContent` で入れる。日付は DB の `date` 列から来るので
     スクリプトにはならないが、**入力形を信用しない**（`D-11`）。 */
  renderPastReports(pet) {
    const wrap = document.getElementById('past-reports');
    const list = document.getElementById('past-reports-list');
    if (!wrap || !list) return;

    const petId = pet && pet.id;
    const months = ((pet && pet.months) || [])
      .filter((m) => m && m.reportId && m.status === 'final')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    list.textContent = '';
    if (!petId || months.length === 0) {
      wrap.hidden = true;
      return;
    }

    for (const month of months) {
      const item = document.createElement('a');
      item.className = 'past-reports__item';
      item.href = `/edit/p/${encodeURIComponent(petId)}/${encodeURIComponent(month.reportId)}`;
      item.textContent = String(month.date || '').replace(/-/g, '.');
      list.append(item);
    }
    wrap.hidden = false;
  },

  /* ── ④の記入を、黙って失わないための下書き ──────────────────────
     `bad-scenarios-F3` #15。記入は DOM とメモリにしか無く、サーバに残るのは
     「確定」の後だけだった。カルテ画面の「戻る」は確認なしで遷移するので、
     **誤タップ1回で数十分の記入が消える**。スリープ・着信・引っぱって更新でも同じで、
     しかも消えたことに気づけない（`D-20260824-30` の 1 と 7）。 */

  /** 前回の続きを読み込む。無ければ何もしない（新規のまま）。 */
  resumeDraft(petId) {
    const staff = globalThis.TrimmerSupabaseStaff;
    if (!staff || !staff.findDraft || !petId) return;
    this.draftPetId = petId;

    /* **読み込みを待つ間に人が打ったら、書き戻さない**（`docs/deferred.md` #27）。
       `findDraft` はサーバとの往復で、その間 ④ の入力欄は打てる。戻ってきた
       中身を無条件に `applyReport` すると、**打った文字が下書きの内容で上書きされる**
       ——しかも消えたことに気づけない（`D-20260824-30` の 1 と同じ型）。
       印を付けるのは**往復を始める前**でなければならない。後から付けると、
       往復中に打たれた分を見落とす。 */
    this.draftTouched = false;
    const panel = document.getElementById('screen-3');
    const mark = () => { this.draftTouched = true; };
    if (panel) {
      panel.addEventListener('input', mark, { once: true });
      panel.addEventListener('change', mark, { once: true });
    }

    staff.findDraft(petId).then((draft) => {
      if (draft) {
        /* **id は必ず引き継ぐ。** 引き継がないと、続きを書いたつもりが新しい
           下書きになって、同じ犬の下書きが2枚残る。 */
        this.draftReportId = draft.id;
        if (this.draftTouched) {
          /* **黙って捨てない。**「読み込まなかった」と言う（`D-12`）。 */
          const status = document.getElementById('dock-status-text');
          if (status) status.textContent = '入力中のため、前回の続きは読み込みませんでした';
        } else {
          this.applyReport(draft.data || {});
        }
      }
      this.watchDraft();
    }).catch(() => {
      /* 読み込めなくても記入は続けられる。**続きから書けないことだけは伝える。** */
      const status = document.getElementById('dock-status-text');
      if (status) status.textContent = '前回の続きを読み込めませんでした';
      this.watchDraft();
    });
  },

  /** 触られたら下書きを保存する。1秒まとめてから1回だけ送る。 */
  watchDraft() {
    const panel = document.getElementById('screen-3');
    if (!panel || this.draftWatching) return;
    this.draftWatching = true;
    const queue = () => {
      /* **最初の1回はすぐ残す。** まとめて1秒待つだけだと、書いた直後に誤タップで
         画面を移った人の記入が**そのまま消える**——それが `#15` の防ぎたいことそのもの
         （`D-20260824-30` の 1）。`verify:m6` が実際にこれで落ちた: 一言を書いて
         すぐ段のタブを押すと、下書きが出来る前にページが移っていた。
         2回目以降は1秒まとめる（毎打鍵で送らない）。 */
      if (this.draftReportId === null && !this.draftSaving) {
        this.saveDraft();
        return;
      }
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(() => this.saveDraft(), 1000);
    };
    panel.addEventListener('input', queue);
    panel.addEventListener('click', queue);
    panel.addEventListener('pointerdown', queue);
    /* 画面を離れるときに、まとめ待ちの分を出しておく。 */
    globalThis.addEventListener('pagehide', () => {
      clearTimeout(this.draftTimer);
      this.saveDraft();
    });
  },

  saveDraft() {
    const staff = globalThis.TrimmerSupabaseStaff;
    if (!staff || !staff.saveDraft || !this.draftPetId) return;
    /* 1件目を作っている最中にもう1回入ると、下書きが2件出来る。 */
    if (this.draftSaving) return;
    this.draftSaving = true;
    /* 印は PNG から戻せないので、**印そのもの**も一緒に置く（`__marks`）。
       ⑥ は読まないキーなので、確定のときに落とす。 */
    const data = { ...this.extractReport(), __marks: this.marks };
    staff.saveDraft(this.draftPetId, this.draftReportId, data, this.today())
      .then((id) => { this.draftReportId = id; this.draftSaving = false; })
      .catch(() => {
        this.draftSaving = false;
        /* **黙って捨てない。** 保存できていないことを画面に出す（`D-2` の型）。 */
        const status = document.getElementById('dock-status-text');
        if (status) status.textContent = '⚠️ 下書きを保存できていません';
      });
  },

  /** 下書きを画面に戻す。`extractReport()` の逆。 */
  applyReport(data) {
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el && value != null) el.value = value;
    };
    set('[data-field="staff-note"]', data.staffNote || '');
    set('[data-field="course"]', data.course || '');
    /* **来店日を戻す**（マスター指示 2026-08-29・C-3）。`isoDate`/`date` のどちらかに
       入っている（⑥の受け手は両方読む・`magazine-view.js`）。 */
    set('#input-visit-date', data.isoDate || data.date || '');
    const weight = (data.weights || [])[0];
    if (weight && weight.kg) {
      set('#input-weight', weight.kg);
      this.onWeightChange(weight.kg);
    }
    if (data.bestWeight) {
      set('#input-best-weight', data.bestWeight);
      this.onBestWeightChange(data.bestWeight);
    }
    const bcs = data.bcs;
    if (bcs) {
      const btn = [...document.querySelectorAll('#bcs-stepper-wrap .stepper-btn')]
        .find((el) => (el.getAttribute('onclick') || '').includes(`'bcs', ${bcs}`));
      if (btn) btn.click();
    }
    /* 爪は前足・後ろ足に分けて記録する（マスター指示 2026-08-29・C-5）。
       ⚠️ 移行前の記録は `nail.level`（単一値）で保存されている。新しい形
       （`nail.front` / `nail.rear`）が無ければ、そちらへは戻さない
       （無い値を推測で埋めない＝`D-10`）。 */
    for (const side of ['front', 'rear']) {
      const value = (data.nail || {})[side];
      if (!value) continue;
      const group = document.querySelector(`[data-group="nail"][data-side="${side}"]`);
      if (!group) continue;
      const btn = [...group.querySelectorAll('.stepper-btn')]
        .find((el) => (el.querySelector('.val') || {}).textContent === String(value));
      if (btn) btn.click();
    }
    /* 耳は6段階（マスター指示 2026-08-29・C-6）。段は `data-level` の数字で持つ
       （日本語の表示文字列に依存しない＝`D-9`）。 */
    for (const side of ['right', 'left']) {
      const value = (data.ear || {})[side];
      if (!value) continue;
      const btn = document.querySelector(`[data-ear="${side}"] .teeth-pill-btn[data-level="${value}"]`);
      if (btn) btn.click();
    }
    const teeth = (data.teeth || {}).status;
    if (teeth) {
      /* 日本語はセレクタに連結しない。中身を読んで比べる（`D-9`）。
         表示＝保存値なので、表示で探せる。**歯のグリッドに絞る**——使用オプション
         のボタンも同じ `.teeth-pill-btn` を流用しており `data-level` も持たないため、
         絞らないと名前が偶然一致したオプションを歯の状態として押してしまう。 */
      const btn = [...document.querySelectorAll('#teeth-selector-grid .teeth-pill-btn')]
        .find((el) => ((el.querySelector('.name') || {}).textContent || '').trim() === teeth);
      if (btn) btn.click();
    }
    /* 使用オプション（マスター指示 2026-08-31）。名前が一致するボタンだけ押す
       ——店舗の一覧から消えた名前は、無い値を推測で埋めない（`D-10`）ので触らない。 */
    const options = Array.isArray(data.options) ? data.options : [];
    if (options.length > 0) {
      document.querySelectorAll('#options-grid .teeth-pill-btn').forEach((btn) => {
        const name = ((btn.querySelector('.name') || {}).textContent || '').trim();
        if (options.includes(name) && !btn.classList.contains('is-active')) btn.click();
      });
    }
    /* **写真を戻す。** 下書きの再開でも「カルテ修正」でも、ここで戻さなければ
       次の確定で**落ちる**——飼い主に届いていた写真が消える。中身は
       `asset://{id}`（保存済み）のことが多く、絵にはできないが**そのまま出し直せる**。
       `teeth` は最大2枚の配列になった（マスター指示 2026-08-29・C-11）。 */
    this.photos = { trimming: [], ear: '', teeth: [] };
    const keep = (value) => (typeof value === 'string' && value.trim() !== '' ? value : '');
    this.photos.trimming = ((data.trimming || {}).photos || []).filter((v) => keep(v));
    this.photos.ear = keep((data.ear || {}).photo);
    this.photos.teeth = ((data.teeth || {}).photos || []).filter((v) => keep(v)).slice(0, this.MAX_TEETH_PHOTOS);
    for (const kind of ['trimming', 'ear', 'teeth']) this.renderPhotoThumbs(kind);

    if (Array.isArray(data.__marks) && data.__marks.length > 0) {
      this.marks = data.__marks;
      this.resizeCanvas();
    }
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

    /* **「カルテ修正」で来たときは、⑤確認ではなく④カルテ作成に入る。**
       管理者画面が `?revise=1` を付けて開く。付いていなければ従来どおり
       ⑤確認（読むだけ）に着く——`verify:*` も飼い主の導線もそちらを通る。
       確定済みを上書きする道はここだけで、`commitReport()` が `reviseReport` を呼ぶ。 */
    const reviseId = new URLSearchParams(location.search).get('revise') === '1'
      ? pet.reportId
      : null;
    if (reviseId && report) {
      this.selectKarte(pet.petName || '', pet.ownerName || '', '');
      /* ここも `applyReport` の前に組み立てる（`showPetKarte` と同じ理由）。 */
      this.renderOptionChips(pet.shopGroomingOptions || []);
      this.reviseReportId = reviseId;
      this.applyReport(report);
      this.goToStep(3);
      return;
    }

    /* **③の見出しも、この犬に合わせておく。** 確定すると保存したカルテの URL へ
       開き直すので、この経路は `selectKarte()` を通らない。そのままだと③の見出しが
       HTML の初期値のまま残り、確定後に「03 カルテ作成」へ戻った人に**別の犬の
       名前**が見える。`D-14` の問2 が ✕ になった唯一の原因で、絵で見つけた
       （`docs/ops/walk-D14-F3.md` / `docs/deferred.md` #28）。
       保存先は URL の petId なので書けば正しい子に入るが、**人はそれを見出しで
       確かめる**ので、見えているものが違えば手が止まる。 */
    this.selectKarte(pet.petName || '', pet.ownerName || '', '');
    /* **描いてから移る。** 先に移ると、描画に失敗したときに空の器へ人を運ぶ。 */
    render(panel, report && {
      petName: pet.petName || '',
      reportDate: report.isoDate || report.date || '',
      data: report,
      /* 「次回のおすすめご来店時期」（マスター指示 2026-08-29・D-20260829-58）。 */
      revisitDaysOverride: pet.revisitDaysOverride ?? null,
      shopDefaultRevisitDays: pet.shopDefaultRevisitDays,
    }, {
      onRevisitDaysChange: (value) => globalThis.TrimmerStaffApi.request(
        `/api/pets/${encodeURIComponent(pet.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisitDaysOverride: value }),
        },
      ),
    });
    /* **描けたことを覚えておく。** 段のタブ「04」は本番の動線として使う
       （マスター回答 2026-08-27・`docs/deferred.md` #2）ので、まだ描いていない
       ときに押されたら**空の器へ運ばない**ための印（`goToStep` が見る）。 */
    this.magazineReady = true;
    this.goToStep(4);
  },

  /* 実データのカードを押したとき。URL を変えて backend に読み直させる
     （画面の中だけで完結させない——戻る・共有・再読み込みが効かなくなる）。 */
  /* 初回登録の QR / URL を出す。中身は backend が持っている（`showOwnerInvitation`）。
     押せる場所を1つ作っただけで、発行の仕組みは足していない。 */
  showInvitation(ownerId, ownerName) {
    const staff = globalThis.TrimmerSupabaseStaff;
    if (!staff || !staff.showOwnerInvitation) return;
    Promise.resolve(staff.showOwnerInvitation(ownerId, ownerName)).catch((error) => {
      globalThis.alert(`初回登録用のQRを出せませんでした。\n\n${error.message}`);
    });
  },

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
        +   '<button class="btn-invite" hidden>初回登録QR</button>'
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
      /* 初回登録（QR）の入口。**新規のお客様はこれを通らないと自分のカルテを
         永久に見られない**——飼い主側の RLS は `owner_users` 経由でしか通らず、
         そこへ行を入れられるのは `claim_invitation`（招待の消化）だけである。
         F2 で飼い主を選ぶ画面ごと動線から外れ、**本番で招待を発行する手段が
         消えていた**（`D-20260823-05` は残すと決めていたのに・`D-20260824-29`）。
         仮データの犬は飼い主 id を持たないので出さない。 */
      const invite = card.querySelector('.btn-invite');
      if (dog.ownerId) {
        invite.hidden = false;
        invite.onclick = (e) => { e.stopPropagation(); this.showInvitation(dog.ownerId, dog.owner); };
      } else {
        invite.remove();
      }
      box.appendChild(card);
    });
    const total = document.getElementById('karte-total-count');
    if (total) total.textContent = data.length + '件';
  },

  goToStep(stepNum) {
    /* **②へ戻るとき、一覧を持っていなければ URL で開き直す。**
       `/edit/p/{petId}` で開いた画面は、その犬の分しか読んでいない（backend の
       `bootStaffPortal` が route ごとに必要なものだけ取る）。この状態で段のタブ
       「02」を押すと、screen-2 に移りはするが**中身が空**で、犬を選び直せない
       ——「押せた」だけで「戻れて」いない（`D-14` の2問目）。
       `verify:m6` がこれを見つけた。 */
    if (stepNum === 2 && this.dogs === null && globalThis.TrimmerSupabaseStaff) {
      location.href = '/edit';
      return;
    }

    /* **「04 顧客カルテ」を、中身が無いまま開かない。**
       段のタブは本番の動線として使う（マスター回答 2026-08-27・`#2`）。
       `screen-4` の中身は `renderMagazine` が丸ごと差し替えるまで**意匠の器**なので、
       確定前に押すと「その犬の顧客カルテ」の見出しのまま**空の雑誌**が出る
       ——`D-12`「押せた ではなく 届いた」で見れば、これは届いていない。
       ②の穴（`verify:m6` が見つけたもの）とまったく同じ形。
       **黙って何もしないのは同じ罪**なので、何をすれば見られるかを器に出す。 */
    if (stepNum === 4 && !this.magazineReady && globalThis.TrimmerSupabaseStaff) {
      const panel = document.getElementById('screen-4');
      if (panel) {
        panel.textContent = '';
        const note = document.createElement('p');
        note.className = 'magazine-empty-note';
        note.dataset.view = 'not-ready';
        note.textContent = 'このカルテはまだ確定していません。'
          + '「03 カルテ作成」で書いて、確認へ進むとここに出ます。';
        panel.append(note);
      }
    }

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
      /* **描く前に測り直す。** 隠れている間は器が 0 なので、ここで測らないと
         描画面が 0×0 のままになる（上の `resizeCanvas` の注記）。 */
      setTimeout(() => this.resizeCanvas(), 50);
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
    /* **犬種だけ。** 以前は見本の年齢と体重を全頭に付けていた（`#35`）。 */
    if (magSub) magSub.textContent = breed || '';

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

  /* `nail`（前足/後ろ足）は分割済みで、いまここを通るのは `bcs` だけ。
     `this.form[type]` に**そのまま代入する型**（数値1個）にのみ使うこと。 */
  selectStepper(btn, type, val) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    }
    this.form[type] = val;
  },

  /* 前足/後ろ足の爪、左右の耳……**同じ形の段が2つ並ぶ項目**で使う。
     押されたボタンだけでは**どの組か分からない**ので、囲みに付けた
     `data-group`（例: `nail`）と `data-side`（例: `front`/`rear`・ASCII。`D-9`）で見分ける。
     `this.form[group]` が `{ side: number, ... }` の形を持っていることが前提。 */
  selectSubStepper(btn) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const group = parent.dataset && parent.dataset.group;
      const side = parent.dataset && parent.dataset.side;
      if (group && side && this.form[group] && typeof this.form[group] === 'object') {
        const val = btn.querySelector('.val');
        this.form[group][side] = Number((val && val.textContent) || '') || 0;

        /* 爪は前足・後ろ足の**両方**を選んで初めて完了扱いにする
           （マスター指示 2026-08-29・C-5。以前は爪1系統を選んだ時点で完了にしていた）。 */
        if (group === 'nail' && this.form.nail.front && this.form.nail.rear) {
          const dock = document.getElementById('editor-bottom-dock');
          const statusIcon = document.getElementById('dock-status-icon');
          const statusText = document.getElementById('dock-status-text');
          const gotoBtn = document.getElementById('btn-dock-goto');
          if (dock) dock.classList.remove('has-incomplete');
          if (statusIcon) statusIcon.textContent = '✓';
          if (statusText) statusText.textContent = '全項目入力完了 (6/6)';
          if (gotoBtn) gotoBtn.style.display = 'none';
        }
      }
    }
  },

  /* 耳の6段階（マスター指示 2026-08-29・C-6）。歯と同じグリッド見た目を使うが、
     押した先が**どちらの耳か**を `data-ear` から見分け、値は表示文字ではなく
     `data-level`（ASCII の数字・`D-9`）から取る。 */
  selectEarLevel(btn) {
    const group = btn.closest('[data-ear]');
    if (!group) return;
    group.querySelectorAll('.teeth-pill-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const side = group.dataset.ear;
    if (side === 'right' || side === 'left') {
      this.form.ear[side] = Number(btn.dataset.level || '') || 0;
    }
  },

  /* 歯の状態。**押されたボタンの表示そのものを保存値にする。**

     もとは HTML 側で `App.selectTeeth(this, 'ちょっと歯石💦')` のように保存値を
     第2引数で二重に書いていた。そのため6つのうち3つで**表示と保存値がずれていた**
     ——トリマーが「ちょっと付着💦」を押すと、飼い主には「ちょっと歯石💦」が届く
     （意匠モックの時点でずれており、`src/` で混入したものではない）。
     悪意も事故も無いが、**押した表示と届く値が違うこと**は `D-12` が守ろうとしている型。
     引数を廃して重複そのものを無くしたので、構造的に二度とずれない。 */
  selectTeeth(btn) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll('.teeth-pill-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    }
    const name = btn.querySelector('.name');
    this.form.teeth = ((name && name.textContent) || '').trim();
  },

  /* 使用オプション（旧デザイン試作にあった「今月の使用オプション」の復活。
     マスター指示 2026-08-31）。選べる名前は店舗ごとに管理者が④店舗設定で
     追加・編集する（`shopGroomingOptions`）ので、ボタンはその場で組み立てる
     ——歯の状態と同じ `.teeth-pill-btn` を流用するが、こちらは複数選択
     （押すたびに on/off が切り替わるだけで、他のボタンを消さない）。
     1件も無い店舗では帯ごと隠す（`D-10`・空の選択肢を出さない）。 */
  renderOptionChips(names) {
    const section = document.getElementById('sec-options');
    const grid = document.getElementById('options-grid');
    if (!section || !grid) return;
    this.form.options = [];
    grid.textContent = '';
    const list = (names || []).filter((v) => typeof v === 'string' && v.trim() !== '');
    section.hidden = list.length === 0;
    for (const name of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'teeth-pill-btn';
      btn.onclick = () => this.toggleOption(btn);
      const label = document.createElement('span');
      label.className = 'name';
      /* `textContent` で入れる。店舗管理者が自由入力した文字列なので
         `innerHTML` にすると細工が実行される（`D-11`）。 */
      label.textContent = name;
      btn.append(label);
      grid.append(btn);
    }
  },

  toggleOption(btn) {
    btn.classList.toggle('is-active');
    const name = ((btn.querySelector('.name') || {}).textContent || '').trim();
    if (!name) return;
    const set = new Set(this.form.options);
    if (btn.classList.contains('is-active')) set.add(name);
    else set.delete(name);
    this.form.options = [...set];
  },

  onWeightChange(val) {
    const w = parseFloat(val) || 0;
    this.form.weight = w;
    const badge = document.getElementById('weight-diff-badge');
    /* **前回の記録が無ければ、前回比は出さない。** 以前は見本の体重と
       引き算していたので、初めての犬にも「+120g ▲」が出ていた。 */
    if (badge && !this.currentDog.prevWeight) {
      badge.className = 'weight-diff-badge';
      badge.textContent = '前回の記録なし';
      return;
    }
    const diff = Math.round((w - this.currentDog.prevWeight) * 1000);
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

  /* ベスト体重（目標体重）。⑥側の受け手は既にあり、この値をそのまま渡すだけ
     （マスター指示 2026-08-29・C-4）。 */
  onBestWeightChange(val) {
    this.form.bestWeight = parseFloat(val) || 0;
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

  /* 犬体図の描画面を、いまの器の大きさに合わせる。

     **画面が隠れているあいだは器の大きさが 0 になる。** `screen-3` は最初
     `is-active` ではないので、読み込み直後に測ると `clientWidth === 0` になり、
     描画面が 0×0 のまま固定される。そのまま印を付けると `toDataURL()` は
     `data:,`（**中身の無い画像**）を返し、飼い主には空が届く。
     実際 `verify:roundtrip` の 8 と 15 がこれで落ちた。
     `#3`（トリマーが見つけた印がどこにも残らず消える）と同じ結末なので、
     **画面に入るたびに測り直す**。 */
  resizeCanvas() {
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) return;
    /* 器は測るためだけに要る。無くても**描くことはやめない**——
       描画面の大きさが既に決まっていれば、印は描ける。 */
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    this.drawCanvas();
  },

  initCanvas() {
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) return;

    const resize = () => this.resizeCanvas();
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

    const course = text('[data-field="course"]');
    if (course) report.course = course;

    /* 来店日（マスター指示 2026-08-29・C-3）。`report_date`（DB 列）は触らない
       ——トリマーのトークンでは書き換えられない設計のまま（`#33`）。
       体重の時系列は、この入力値を基準にする。未入力なら押した日のまま
       （従来どおり・`today()`）。⑥は `isoDate` と `date` の両方を読む
       （`magazine-view.js:550`）ので両方に入れる。 */
    const visitDate = text('#input-visit-date');
    if (visitDate) {
      report.date = visitDate;
      report.isoDate = visitDate;
    }

    if (this.form.bcs) report.bcs = this.form.bcs;
    if (this.form.bestWeight) report.bestWeight = this.form.bestWeight;

    /* 爪は前足・後ろ足を分けて記録する（マスター指示 2026-08-29・C-5）。 */
    if (this.form.nail.front || this.form.nail.rear) {
      report.nail = { front: this.form.nail.front, rear: this.form.nail.rear };
    }
    /* **写真だけでもキーを出す。** レベルが未選択でも、撮った写真は届けたい。
       逆に、どちらも無ければキーごと出さない（空の器を出さない）。 */
    if (this.form.ear.right || this.form.ear.left || this.photos.ear) {
      report.ear = { right: this.form.ear.right, left: this.form.ear.left };
      if (this.photos.ear) report.ear.photo = this.photos.ear;
    }
    if (this.form.teeth || this.photos.teeth.length > 0) {
      report.teeth = {};
      if (this.form.teeth) report.teeth.status = this.form.teeth;
      /* 口の写真は最大2枚（マスター指示 2026-08-29・C-11）。 */
      if (this.photos.teeth.length > 0) report.teeth.photos = [...this.photos.teeth];
    }
    /* **`ym` を必ず添える。** ⑥は `weights` を `w.ym` が在るものだけに絞ってから描く
       （`magazine-view.js:575`）ので、`kg` だけ出すと**体重は「未記録」になる**——
       書いたのに届かない（`F-20260821-12`/`-13` の型）。**月は来店日から作る**
       （マスター指示 2026-08-29・C-3。未入力なら押した日のまま）。 */
    if (this.form.weight) {
      const baseDate = visitDate || this.today();
      report.weights = [{ ym: baseDate.slice(0, 7), date: baseDate, kg: this.form.weight }];
    }

    /* ⑥が読むのは `trimming.comment` と `trimming.photos`（`magazine-view.js:582`）。
       カットの長さ・スタイルの選択欄は削除した（マスター指示 2026-08-29・C-12）ので、
       `comment` はもう作らない。写真の入口はそのまま残す。 */
    if (this.photos.trimming.length > 0) {
      report.trimming = { photos: [...this.photos.trimming] };
    }

    /* 使用オプション（マスター指示 2026-08-31で復活）。1件も選ばれていなければ
       キーごと出さない（空の選択を「選んだ」ことにしない＝`D-10`）。 */
    if (this.form.options.length > 0) report.options = [...this.form.options];

    /* 犬体図の印。**印が無ければキーごと出さない**（白紙の絵を「所見あり」にしない）。
       印が在るのに描き先が無ければ `exportBodyMarking()` が投げる——握らない。 */
    const marking = this.exportBodyMarking();
    if (marking) report.bodyMarkingImage = marking;

    return report;
  },

/* ④保存・確定 — ドックの「確定してお客様カルテを見る」から呼ばれる。

     backend が居なければ、これまでどおり画面を移すだけ（仮データの `/`＝F2 の
     `npm run walk` の経路。ここを壊すと合否の絵が撮れなくなる）。

     居るときは**保存して、保存されたものを開き直す**。手元の値をそのまま
     screen-4 に出すと、届いたかどうかを見ないまま「届いた」と言うことになる
     （`D-12`「押せた ではなく 同じ値で届いた で見る」）。

     失敗したら**画面を移さず、理由を出す。** 黙って進むと「保存しました」と
     出たのに残っていない、が起きる（`D-2`・`bad-scenarios-F3` #1）。 */
  async commitReport() {
    /* コースは来店ごとに変わるので、カルテ作成のたびに選択必須にする
       （マスター指示 2026-08-29・C-9）。`<select required>` は HTML の見た目だけの
       印なので、確定の直前にもう一度ここで確かめる——ボタンを直接叩かれても抜けない。 */
    const courseEl = document.querySelector('[data-field="course"]');
    if (courseEl && !courseEl.value) {
      globalThis.alert('来店コースを選択してください。');
      courseEl.focus();
      return;
    }
    const staff = globalThis.TrimmerSupabaseStaff;
    const context = globalThis.__REPORT_CONTEXT__;
    if (!staff || !staff.saveReport || !context || !context.petId) {
      this.goToStep(4);
      return;
    }
    const button = document.querySelector('.dock-action-wrap .boxbutton');
    if (button) button.disabled = true;
    try {
      clearTimeout(this.draftTimer);
      /* 直しているのか、新しく書いているのか。**ここを間違えると、直したつもりが
         2枚目のカルテになって飼い主に2通届く。** */
      const saved = this.reviseReportId
        ? await staff.reviseReport(context.petId, this.reviseReportId, this.extractReport())
        : await staff.saveReport(
          context.petId, this.extractReport(), this.today(), this.draftReportId,
        );
      /* **番号が入っているところまで確かめてから移る。** `encodeURIComponent` は
         `null`／`undefined` を**文字列**に変えてしまうので、欠けていても URL は
         組み上がり、例外が出ないまま `/edit/p/{petId}/null` へ進んでいた
         （`F-20260828-59`）。ここで投げて、下の `catch` に理由を出させる。 */
      if (!saved || !saved.id) throw new Error('確定の応答にカルテの番号がありませんでした');
      location.href = `/edit/p/${encodeURIComponent(context.petId)}/${encodeURIComponent(saved.id)}`;
    } catch (error) {
      if (button) button.disabled = false;
      /* 理由をそのまま出す。「失敗しました」だけだと、やり直せばよいのか
         人を呼ぶのかが分からない。 */
      globalThis.alert(`カルテを保存できませんでした。\n\n${error.message}\n\nもう一度お試しください。`);
    }
  },

  /* 施術日。正UI に日付の入力欄が無いので、**押した日**を使う
     （`docs/ops/key-parity-F3.md`: `date` / `isoDate` は出どころが無い6キーのうちの2つ）。 */
  today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  },

  /* 写真を1枚、送れる大きさの `data:image/jpeg` にする。

     **そのまま送らない。** いまのスマホは1枚 4〜8MP で、上限（10MB）に当たるか、
     当たらなくても飼い主の回線で開けない。長辺 1600px・q0.8 まで落とす。

     **iPhone の HEIC もここで JPEG になる。** サーバが受け取るのは canvas が出した
     JPEG なので、`mimeType` の enum（jpeg/png/webp）を広げる必要が無い。
     ただし **HEIC を復号できるのは、その形式を読めるブラウザだけ**（iPhone/iPad は読める）。
     読めない環境では下の `createImageBitmap` が投げるので、**黙って捨てずに理由を出す**。 */
  async shrinkImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error(`「${file.name}」を読めませんでした。この端末が対応していない形式かもしれません。`);
    }
    const long = Math.max(bitmap.width, bitmap.height);
    const scale = long > 1600 ? 1600 / long : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    if (!canvas.width || !canvas.height) throw new Error(`「${file.name}」の大きさを取れませんでした。`);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.8);
  },

  /* `trimming` と `teeth` は配列（複数枚）、`ear` は文字列（1枚）。
     配列かどうかで分岐すれば、新しく配列になったキーにも自動で対応する。 */
  isMultiPhoto(kind) {
    return Array.isArray(this.photos[kind]);
  },

  /* ファイルが選ばれたとき。**1枚でも失敗したら理由を出す**——黙って減ると、
     トリマーは「入れたつもり」で確定してしまう（`D-2`）。
     `teeth` は上限が2枚（マスター指示 2026-08-29・C-11）——**超えた分は理由を出して捨てる**。
     黙って先頭2枚だけ使うと、選んだのに届かない写真が出る。 */
  async onPhotoPick(kind, input) {
    const files = [...(input.files || [])];
    input.value = '';
    if (files.length === 0) return;
    const limit = kind === 'teeth' ? this.MAX_TEETH_PHOTOS : Infinity;
    for (const file of files) {
      if (this.isMultiPhoto(kind) && this.photos[kind].length >= limit) {
        globalThis.alert(`「${file.name}」は追加できませんでした。この項目は最大${limit}枚までです。`);
        continue;
      }
      try {
        const dataUrl = await this.shrinkImage(file);
        if (this.isMultiPhoto(kind)) this.photos[kind].push(dataUrl);
        else this.photos[kind] = dataUrl;
      } catch (error) {
        globalThis.alert(error.message);
      }
    }
    this.renderPhotoThumbs(kind);
    /* **その場で下書きに残す。** 画面の入力を見張っている `queue` は、
       ファイルを選んだ瞬間に走る——縮小が終わる前なので、待たずに送ると
       写真の無い下書きが残る。処理が終わったここで、明示的に残す。 */
    this.saveDraft();
  },

  removePhoto(kind, index) {
    if (this.isMultiPhoto(kind)) this.photos[kind].splice(index, 1);
    else this.photos[kind] = '';
    this.renderPhotoThumbs(kind);
    this.saveDraft();
  },

  /* 選んだものを見せる。**`asset://` は絵にできない**（実体は認証つきでしか取れない）ので、
     「保存済み」と字で出す。消せることは同じ——押せば次の確定で落ちる。
     `kind === 'teeth'` の `data:` 画像だけは、タップで書き込み（お絵描き）を開ける
     （マスター指示 2026-08-29・C-10。`asset://` は復号していないので対象外）。 */
  renderPhotoThumbs(kind) {
    const box = document.querySelector(`[data-photo-thumbs="${kind}"]`);
    if (!box) return;
    const list = this.isMultiPhoto(kind) ? this.photos[kind] : [this.photos[kind]].filter(Boolean);
    box.textContent = '';
    list.forEach((src, index) => {
      const cell = document.createElement('div');
      cell.className = 'photo-pick__thumb';
      if (src.startsWith('data:')) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        if (kind === 'teeth') {
          img.style.cursor = 'pointer';
          img.title = 'タップして書き込む';
          img.onclick = () => this.openAnnotate(kind, index);
        }
        cell.appendChild(img);
      } else {
        const kept = document.createElement('span');
        kept.className = 'photo-pick__kept';
        kept.textContent = '保存済み';
        cell.appendChild(kept);
      }
      const drop = document.createElement('button');
      drop.className = 'photo-pick__drop';
      drop.type = 'button';
      drop.textContent = '×';
      drop.onclick = () => this.removePhoto(kind, index);
      cell.appendChild(drop);
      box.appendChild(cell);
    });
  },

  /* 口の写真への書き込み（マスター指示 2026-08-29・C-10）。
     犬体4面図（`#marking-canvas`）とは別の、写真1枚専用の使い捨てキャンバスを
     その場で作る——`#marking-canvas` は全画面で1個だけの決め打ちで、
     複数の写真スロットには使えないため。フリーハンドで丸を描き、
     「保存」で元の写真に焼き込む（差し替え）。 */
  openAnnotate(kind, index) {
    const src = this.photos[kind][index];
    if (!src || !src.startsWith('data:')) return;

    const overlay = document.createElement('div');
    overlay.className = 'annotate-overlay';
    overlay.innerHTML = `
      <div class="annotate-box">
        <div class="annotate-canvas-wrap"><canvas class="annotate-canvas"></canvas></div>
        <div class="annotate-actions">
          <button type="button" class="btn-inline annotate-clear">やり直す</button>
          <button type="button" class="btn-inline annotate-cancel">キャンセル</button>
          <button type="button" class="btn-inline annotate-save">保存する</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.annotate-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    let strokes = [];
    let drawing = false;
    let activePointerId = null;

    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#e0392b';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of strokes) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (const pt of stroke.slice(1)) ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
    };

    const pointFromEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    img.onload = () => {
      const long = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      const scale = long > 900 ? 900 / long : 1;
      canvas.width = Math.round((img.naturalWidth || 1) * scale);
      canvas.height = Math.round((img.naturalHeight || 1) * scale);
      redraw();
    };
    img.src = src;

    /* ピンチ操作は2本の指がそれぞれ pointerdown/pointermove を発火させる。
       pointerId で区別せず両方を描画に使うと、2本指の座標が同じ線に混ざって
       暴れた線になる（マスター報告）。1本目の指だけを追跡し、2本目以降は無視する。 */
    canvas.addEventListener('pointerdown', (event) => {
      if (drawing) return;
      drawing = true;
      activePointerId = event.pointerId;
      strokes.push([pointFromEvent(event)]);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drawing || event.pointerId !== activePointerId) return;
      strokes[strokes.length - 1].push(pointFromEvent(event));
      redraw();
    });
    const stopDrawing = (event) => {
      if (event && event.pointerId !== activePointerId) return;
      drawing = false;
      activePointerId = null;
    };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointerleave', stopDrawing);

    const close = () => overlay.remove();
    overlay.querySelector('.annotate-cancel').onclick = close;
    overlay.querySelector('.annotate-clear').onclick = () => { strokes = []; redraw(); };
    overlay.querySelector('.annotate-save').onclick = () => {
      /* 印を焼き込んだ1枚として保存し直す。書き込みは元の写真に**戻せない形で**
         合成する——このリポジトリの犬体図と同じ「印は最終的に画像として出す」方式
         （`exportBodyMarking()` と同型）。 */
      this.photos[kind][index] = canvas.toDataURL('image/jpeg', 0.85);
      this.renderPhotoThumbs(kind);
      this.saveDraft();
      close();
    };
  },

  exportBodyMarking() {
    if (this.marks.length === 0) return null;
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) throw new Error('犬体図が見つからないため、付けた印を保存できません');
    /* 描画面が 0×0 のままだと `toDataURL()` は `data:,` を返す。**中身が無い。**
       これを返すと「印を保存した」ことになってしまい、飼い主には空が届く
       ——`#3` そのもの。測り直しても駄目なら、黙って空を返さずに投げる。 */
    this.resizeCanvas();
    if (!canvas.width || !canvas.height) {
      throw new Error('犬体図の大きさを取れないため、付けた印を保存できません');
    }
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
      /* Canvas の `font` は CSS の `var(--font-sans)` を参照できないので、
         フォント統一（C-8）と同じシステムフォント列を直書きする。 */
      ctx.font = '12px "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Times New Roman", serif';
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
      /* ここに乗るのは印の種類の頭文字（例:「赤み」→「赤」）で日本語なので、
         ラテン文字専用の `Inter` ではなく（C-8）システムフォント列に揃える。 */
      ctx.font = 'bold 8px "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Times New Roman", serif';
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

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
     ——書いていないことが書いてあるように見える（`D-10`）。 */
  form: { nail: 0, ear: { right: 0, left: 0 }, teeth: '', weight: 0 },

  /* 選ばれた写真。**中身は `data:image/jpeg` か、既に上がっている `asset://{id}`。**
     前者は `saveReport`/`reviseReport` が実体化し（`replaceDataUrlAssets`）、
     後者は**そのまま出し直す**——直しのときに落とすと、飼い主に届いていた写真が消える。
     `trimming` は配列（1枚目が表紙・残りはギャラリー）、耳と歯は1枚。 */
  photos: { trimming: [], ear: '', teeth: '' },

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

  /**
   * `trimming.comment` から、カットの長さとスタイルの選択を戻す。
   *
   * **文字を `' / '` で割って入れるだけにはしない。** それだと選択肢に無い言葉まで
   * `select.value` に代入しようとして、静かに空になる（`select` は無い値を拒む）。
   * **選択肢そのものと突き合わせて、一致したものだけ選ぶ。**
   * 一致しなければ触らない——戻せないものを推測で埋めない。
   */
  restoreTrimSelects(comment) {
    const parts = String(comment || '').split(' / ').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return;
    for (const selector of ['[data-field="trim-length"]', '[data-field="trim-style"]']) {
      const el = document.querySelector(selector);
      if (!el || !el.options) continue;
      const hit = Array.from(el.options).find((opt) => opt.value && parts.includes(opt.value));
      if (hit) el.value = hit.value;
    }
  },

  /** 下書きを画面に戻す。`extractReport()` の逆。 */
  applyReport(data) {
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el && value != null) el.value = value;
    };
    set('[data-field="staff-note"]', data.staffNote || '');
    /* **カットの長さ・スタイルを戻す**（`docs/deferred.md` #26）。
       出すときは `[length, style].join(' / ')` で `trimming.comment` に**まとめて**
       入れている（`extractReport`）。戻さないままにしていたが、それだと
       「カルテ修正」（`?revise=1`・`showReport`）で選び直さなかったとき、
       `extractReport` が `trimming.comment` を出さず、**すでに飼い主に届いていた
       カット内容が黙って消える**。下書き再開だけの話ではなかった。 */
    this.restoreTrimSelects((data.trimming || {}).comment);
    const weight = (data.weights || [])[0];
    if (weight && weight.kg) {
      set('#input-weight', weight.kg);
      this.onWeightChange(weight.kg);
    }
    const nail = (data.nail || {}).level;
    if (nail) {
      const btn = [...document.querySelectorAll('#nail-stepper-wrap .stepper-btn')]
        .find((el) => (el.getAttribute('onclick') || '').includes(`'nail', ${nail}`));
      if (btn) btn.click();
    }
    for (const side of ['right', 'left']) {
      const value = (data.ear || {})[side];
      if (!value) continue;
      const group = document.querySelector(`[data-ear="${side}"]`);
      if (!group) continue;
      const btn = [...group.querySelectorAll('.stepper-btn')]
        .find((el) => (el.querySelector('.val') || {}).textContent === String(value));
      if (btn) btn.click();
    }
    const teeth = (data.teeth || {}).status;
    if (teeth) {
      /* 日本語はセレクタに連結しない。中身を読んで比べる（`D-9`）。
         表示＝保存値なので、表示で探せる。 */
      const btn = [...document.querySelectorAll('.teeth-pill-btn')]
        .find((el) => ((el.querySelector('.name') || {}).textContent || '').trim() === teeth);
      if (btn) btn.click();
    }
    /* **写真を戻す。** 下書きの再開でも「カルテ修正」でも、ここで戻さなければ
       次の確定で**落ちる**——飼い主に届いていた写真が消える。中身は
       `asset://{id}`（保存済み）のことが多く、絵にはできないが**そのまま出し直せる**。 */
    this.photos = { trimming: [], ear: '', teeth: '' };
    const keep = (value) => (typeof value === 'string' && value.trim() !== '' ? value : '');
    this.photos.trimming = ((data.trimming || {}).photos || []).filter((v) => keep(v));
    this.photos.ear = keep((data.ear || {}).photo);
    this.photos.teeth = keep((data.teeth || {}).photo);
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

    if (this.form.nail) report.nail = { level: this.form.nail };
    /* **写真だけでもキーを出す。** レベルが未選択でも、撮った写真は届けたい。
       逆に、どちらも無ければキーごと出さない（空の器を出さない）。 */
    if (this.form.ear.right || this.form.ear.left || this.photos.ear) {
      report.ear = { right: this.form.ear.right, left: this.form.ear.left };
      if (this.photos.ear) report.ear.photo = this.photos.ear;
    }
    if (this.form.teeth || this.photos.teeth) {
      report.teeth = {};
      if (this.form.teeth) report.teeth.status = this.form.teeth;
      if (this.photos.teeth) report.teeth.photo = this.photos.teeth;
    }
    /* **`ym` を必ず添える。** ⑥は `weights` を `w.ym` が在るものだけに絞ってから描く
       （`magazine-view.js:575`）ので、`kg` だけ出すと**体重は「未記録」になる**——
       書いたのに届かない（`F-20260821-12`/`-13` の型）。月は施術日から作る。 */
    if (this.form.weight) report.weights = [{ ym: this.today().slice(0, 7), kg: this.form.weight }];

    /* **⑥が読むのは `trimming.comment` と `trimming.photos` だけ**（`magazine-view.js:582`）。
       `length` / `style` という名前で出しても、どこにも表示されない。
       画面に在る2つの select は「カットの長さ」と「スタイル」なので、
       ⑥が出す場所——トリミングの一言——にまとめて入れる。 */
    const length = text('[data-field="trim-length"]');
    const style = text('[data-field="trim-style"]');
    const trimming = [length, style].filter(Boolean).join(' / ');
    /* **写真は `trimming.photos` へ。** ⑥はここの1枚目を表紙（hero）にし、
       残りをギャラリーに並べる（`magazine-view.js:549,580`）。
       だから hero 用の入力を別に作らない——1つの入口が2か所に効く。 */
    if (trimming || this.photos.trimming.length > 0) {
      report.trimming = {};
      if (trimming) report.trimming.comment = trimming;
      if (this.photos.trimming.length > 0) report.trimming.photos = [...this.photos.trimming];
    }

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

  /* ファイルが選ばれたとき。**1枚でも失敗したら理由を出す**——黙って減ると、
     トリマーは「入れたつもり」で確定してしまう（`D-2`）。 */
  async onPhotoPick(kind, input) {
    const files = [...(input.files || [])];
    input.value = '';
    if (files.length === 0) return;
    for (const file of files) {
      try {
        const dataUrl = await this.shrinkImage(file);
        if (kind === 'trimming') this.photos.trimming.push(dataUrl);
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
    if (kind === 'trimming') this.photos.trimming.splice(index, 1);
    else this.photos[kind] = '';
    this.renderPhotoThumbs(kind);
    this.saveDraft();
  },

  /* 選んだものを見せる。**`asset://` は絵にできない**（実体は認証つきでしか取れない）ので、
     「保存済み」と字で出す。消せることは同じ——押せば次の確定で落ちる。 */
  renderPhotoThumbs(kind) {
    const box = document.querySelector(`[data-photo-thumbs="${kind}"]`);
    if (!box) return;
    const list = kind === 'trimming' ? this.photos.trimming : [this.photos[kind]].filter(Boolean);
    box.textContent = '';
    list.forEach((src, index) => {
      const cell = document.createElement('div');
      cell.className = 'photo-pick__thumb';
      if (src.startsWith('data:')) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
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

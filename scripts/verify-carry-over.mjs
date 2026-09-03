/**
 * verify-carry-over.mjs — 常連の6枚目を「前回の続き」から書き始められること
 *
 * マスター指示（2026-09-03）:
 *   「カルテを作成するを押すと、自動的に前回のカルテのコピーが表示される。
 *     日時やコースなど毎回必ず変わる項目は空欄で、変わらないであろう項目は
 *     5回目のコピーになっている、という状況から6回目のカルテ作成を始められるようにしろ」
 *
 * **ここで見るのは「実際に動くか」だけ。** 形（キーの取捨）は
 * `test/ui-carry-over.test.mjs` が純関数として見ている。こちらは
 * **実 Supabase・実ブラウザ・人と同じクリック**で、次の3つを確かめる:
 *
 *   1. 確定カルテを5枚持つ犬を作り、②一覧から**カードを押して**④に入る
 *   2. ④が「前回の続き」になっている——空にすると言った項目が空で、
 *      引き継ぐと言った項目が5枚目と同じ**値として画面に入っている**
 *   3. 触らずに閉じても**下書きが1枚も生えない**
 *
 * `App` を直接呼ばない（呼べば「配線がつながっている」ことの証明にならない）。
 * 唯一の例外はログインの注入で、Google OAuth は自動化できないため
 * `injectSession()` が代わりに押す（`walk-human.mjs` と同じ扱い）。
 *
 * 前提: `npx supabase start` が動いていること。
 *   npm run verify:carry-over
 */

import { devices } from 'playwright';
import {
  FIXTURE, LOCAL_PASSWORD, openStaffPage, passwordLogin, startLocalWorker,
} from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    process.stdout.write(`PASS  ${label}${detail ? `  ${detail}` : ''}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${label}${detail ? `  ${detail}` : ''}\n`);
  }
}

/** 5枚目（前回）の確定カルテ。**引き継ぐ側も、空にする側も、全部埋めておく**
    ——空の項目で試すと「消えた」のか「元から無い」のかが区別できない。 */
const FIFTH = {
  date: '2026-08-01',
  isoDate: '2026-08-01',
  course: 'フルコース',
  staffNote: '前回のメッセージ。これは6枚目に出てはいけない。',
  bcs: 3,
  bestWeight: 4.2,
  nail: { front: 2, rear: 3 },
  ear: { right: 2, left: 4 },
  teeth: { status: '歯石が厚い😥' },
  weights: [{ ym: '2026-08', date: '2026-08-01', kg: 4.4 }],
  options: ['アメージング'],
  __marks: [{ x: 0.4, y: 0.6, type: 'しこり/イボ' }],
};

/** 5枚のカルテを積む。**アプリ自身の API で作る**——DB へ直接書くと、
    アプリが作れない形のデータでも通ってしまい、6枚目の入口の検査にならない。
    下書きとして作ってから確定させるのは `saveReport()` と同じ順序。 */
async function seedReports(base, headers, petId, count) {
  const ids = [];
  for (let n = 1; n <= count; n += 1) {
    const month = String(n).padStart(2, '0');
    const data = n === count
      ? FIFTH
      : { pet: petName, course: `過去コース${n}`, isoDate: `2026-0${n}-01` };
    const created = await fetch(`${base}/api/pets/${petId}/reports`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ petId, reportDate: `2026-${month}-01`, data }),
    });
    if (!created.ok) throw new Error(`カルテ${n}枚目の下書きを作れなかった: ${created.status} ${await created.text()}`);
    const { report } = await created.json();
    const finalized = await fetch(`${base}/api/pets/${petId}/reports/${report.id}/finalize`, {
      method: 'POST', headers,
    });
    if (!finalized.ok) throw new Error(`カルテ${n}枚目を確定できなかった: ${finalized.status} ${await finalized.text()}`);
    ids.push(report.id);
  }
  return ids;
}

async function countDrafts(base, headers, petId) {
  const body = await (await fetch(`${base}/api/pets/${petId}/reports`, { headers })).json();
  return (body.reports || []).filter((r) => r.status === 'draft').length;
}

/** この検査のためだけの犬を1頭、画面と同じ API で作る。
    **種の犬（`FIXTURE.petZ` 等）に相乗りしない**——他の `verify:*` が
    同じ犬を消したり増やしたりするので、「前回のカルテ」が実行順で変わってしまう。 */
async function createPet(base, headers, label) {
  const owner = await fetch(`${base}/api/owners`, {
    method: 'POST', headers, body: JSON.stringify({ name: `引き継ぎ検査の飼い主${label}` }),
  });
  if (!owner.ok) throw new Error(`飼い主を作れなかった: ${owner.status} ${await owner.text()}`);
  const { owner: created } = await owner.json();
  const pet = await fetch(`${base}/api/owners/${created.id}/pets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ownerId: created.id, name: `常連${label}`, template: 'ponchi' }),
  });
  if (!pet.ok) throw new Error(`犬を作れなかった: ${pet.status} ${await pet.text()}`);
  const { pet: madePet } = await pet.json();
  return { petId: madePet.id, petName: madePet.name };
}

const worker = await startLocalWorker({ port: 8791 });
const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
const headers = {
  Authorization: `Bearer ${staffSession.access_token}`,
  'Content-Type': 'application/json',
};

const label = Math.random().toString(36).slice(2, 6);
const { petId, petName } = await createPet(worker.base, headers, label);
const seeded = await seedReports(worker.base, headers, petId, 5);
check('土台: 確定カルテが5枚ある犬を作った', seeded.length === 5, `pet=${petName} reports=${seeded.length}`);

const browser = await launchChromium();
const context = await browser.newContext({ ...devices['iPhone 12'] });
const page = await context.newPage();

try {
  /* ── ②一覧から、人と同じようにカードを押して④へ ───────────────── */
  await openStaffPage(page, worker.base, '/edit');
  await page.waitForSelector('.karte-card', { timeout: 20_000 });

  const card = page.locator('.karte-card').filter({ hasText: petName }).first();
  const found = await card.count();
  check('② 一覧に犬が出ている', found > 0, `card=${found}`);
  await card.click();

  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  check('④ カルテ作成画面まで、押すだけで着いた', true);

  /* ── 引き継ぎの帯が出ているか（言ったことと、やったことが合うか）──
     引き継ぎは**サーバとの往復のあと**に起きる。画面が出た瞬間に読むと、
     「まだ来ていない」を「入っていない」と読み違える。帯に字が入るまで待つ。 */
  const arrived = await page
    .waitForFunction(() => {
      const el = document.getElementById('carry-over-text');
      return !!el && el.textContent.trim() !== '';
    }, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  check('引き継ぎが実際に走った（帯に字が入った）', arrived);

  const band = page.locator('#carry-over-undo');
  const bandVisible = await band.isVisible();
  const bandText = await page.locator('#carry-over-text').textContent();
  check('引き継ぎの帯が出ている', bandVisible, bandText.slice(0, 30));
  for (const word of ['爪', '耳', '歯', 'BCS', 'ベスト体重', '犬体図の印']) {
    check(`帯が「${word}」を名指ししている`, bandText.includes(word));
  }

  /* ── 空にする項目 ─────────────────────────────────────────────
     **画面の値を読む。** `App.form` ではなく入力欄そのものを見る。 */
  const visitDate = await page.inputValue('#input-visit-date');
  check('来店日が空', visitDate === '', `value="${visitDate}"`);
  const course = await page.inputValue('[data-field="course"]');
  check('コースが空', course === '', `value="${course}"`);
  const note = await page.inputValue('[data-field="staff-note"]');
  check('トリマーからのメッセージが空', note === '', `value="${note.slice(0, 20)}"`);
  const weight = await page.inputValue('#input-weight');
  check('体重が空', weight === '', `value="${weight}"`);

  /* ── 体重の「前回比」（マスター指示 2026-09-03「納品して問題あるなら直せ」）──
     体重を毎回空で始める設計は「前回値は前回比で見える」ことを前提にしている。
     ここが「前回の記録なし」だと、その前提が崩れる。 */
  const diffBefore = (await page.locator('#weight-diff-badge').textContent() || '').trim();
  check('前回比が「前回の記録なし」ではない（5枚目の体重を引けている）',
    diffBefore !== '前回の記録なし', `badge="${diffBefore}"`);
  check('まだ量っていないので、前回の体重を出している（痩せたように見せない）',
    diffBefore === '前回 4.4kg', `badge="${diffBefore}"`);

  const activeOptions = await page.locator('#options-grid .teeth-pill-btn.is-active').count();
  check('⑦使用オプションが1つも選ばれていない', activeOptions === 0, `active=${activeOptions}`);

  const thumbs = await page.locator('.photo-pick__thumb').count();
  check('写真が1枚も入っていない', thumbs === 0, `thumb=${thumbs}`);

  /* ── 引き継ぐ項目 ─────────────────────────────────────────────
     **画面のボタンが実際に押された状態になっているか**を見る。 */
  const activeText = async (selector) => {
    const el = page.locator(selector).first();
    return (await el.count()) > 0 ? ((await el.textContent()) || '').trim() : '';
  };

  const nailFront = await activeText('[data-group="nail"][data-side="front"] .stepper-btn.is-active .val');
  check('爪（前足）が5枚目と同じ', nailFront === '2', `front=${nailFront}`);
  const nailRear = await activeText('[data-group="nail"][data-side="rear"] .stepper-btn.is-active .val');
  check('爪（後ろ足）が5枚目と同じ', nailRear === '3', `rear=${nailRear}`);

  const earRight = await page.locator('[data-ear="right"] .teeth-pill-btn.is-active').getAttribute('data-level');
  check('耳（右）が5枚目と同じ', earRight === '2', `right=${earRight}`);
  const earLeft = await page.locator('[data-ear="left"] .teeth-pill-btn.is-active').getAttribute('data-level');
  check('耳（左）が5枚目と同じ', earLeft === '4', `left=${earLeft}`);

  const teeth = await activeText('#teeth-selector-grid .teeth-pill-btn.is-active .name');
  check('歯の状態が5枚目と同じ', teeth === '歯石が厚い😥', `teeth=${teeth}`);

  const bcsActive = await page.locator('#bcs-stepper-wrap .stepper-btn.is-active').count();
  check('BCS が選ばれている', bcsActive === 1, `active=${bcsActive}`);
  const bestWeight = await page.inputValue('#input-best-weight');
  check('ベスト体重が5枚目と同じ', bestWeight === '4.2', `value="${bestWeight}"`);

  /* 犬体図の印は**絵で見る**。`marks` の件数ではなく、赤い画素が乗っているか。 */
  const marked = await page.evaluate(() => {
    const canvas = document.getElementById('marking-canvas');
    if (!canvas || !canvas.width || !canvas.height) return { ok: false, reason: '描画面が 0×0' };
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) {
      /* しこり/イボ の色（#f57c00）に近い画素を数える。 */
      if (data[i] > 200 && data[i + 1] > 90 && data[i + 1] < 160 && data[i + 2] < 80) colored += 1;
    }
    return { ok: colored > 20, colored };
  });
  check('犬体図に前回の印が描かれている', marked.ok, JSON.stringify(marked));

  /* **人が見て判定できる絵を残す**（マスター指示 2026-09-01:
     「受け入れ条件は人間と同じ操作をしてスクショで画像確認できること」）。
     全画面1枚は高さ13000pxを超えて人が読めないので、**判定できる単位で切る**。
     この検査は合否も出すが、絵は絵で人が確かめられるようにしておく（`D-14`）。 */
  const shot = async (name, selector) => {
    await page.locator(selector).first().screenshot({ path: `.human/carry-over/${name}.png` })
      .catch(() => {});
  };
  await shot('1_引き継ぎの帯', '.carry-over');
  await shot('2_来店日とコース_空のまま', '.clinical-group:has(#input-visit-date)');
  await shot('3_爪_前回から引き継ぎ', '.clinical-group:has([data-group="nail"])');
  await shot('4_耳と歯_前回から引き継ぎ', '.clinical-group:has([data-ear="right"])');
  await shot('5_体重とBCS_体重だけ空', '.clinical-group:has(#input-weight)');
  await shot('6_犬体図_前回の印', '.body-marking-tool');

  /* ── 触らずに閉じたら、下書きは生えていないか ────────────────── */
  const drafts = await countDrafts(worker.base, headers, petId);
  check('触っていないので下書きは生えていない', drafts === 0, `draft=${drafts}`);

  /* ── 「引き継ぎをやめて白紙にする」が効くか ──────────────────── */
  /* 帯が出ていないとき（引き継ぎが起きていないとき）は押せない。
     **押せないことで検査を終わらせない**——以降の項が消えると、
     壊したときに何が守れていないのか分からなくなる。 */
  const clearable = await page.locator('.carry-over__clear').isVisible().catch(() => false);
  if (clearable) await page.locator('.carry-over__clear').click();
  const afterNail = await page.locator('[data-group="nail"] .stepper-btn.is-active').count();
  const afterTeeth = await page.locator('#teeth-selector-grid .teeth-pill-btn.is-active').count();
  check('白紙にすると、引き継いだ選択が全部外れる', afterNail === 0 && afterTeeth === 0,
    `nail=${afterNail} teeth=${afterTeeth}`);
  const bandAfter = await page.locator('#carry-over-undo').isVisible();
  check('白紙にすると、引き継ぎの帯が消える', bandAfter === false);
  const initiallyHidden = await page.evaluate(() => {
    /* **`hidden` が CSS に負けていないか。** `.carry-over { display: flex }` を
       素で書くと `[hidden] { display: none }` を上書きし、引き継ぎが起きていない
       犬（初回の子）にも空の帯が出る。 */
    const el = document.getElementById('carry-over-undo');
    return el ? getComputedStyle(el).display : 'なし';
  });
  check('隠したら本当に消えている（hidden が CSS に負けていない）',
    initiallyHidden === 'none', `display=${initiallyHidden}`);

  /* ── ここから先は「6枚目を最後まで書いて確定する」。────────────────
     引き継げただけでは終わりではない。**確定して、飼い主に届き、
     さらに次（7枚目）でまた引き継げる**ところまで通す。 */
  await page.reload();
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('carry-over-text');
    return !!el && el.textContent.trim() !== '';
  }, null, { timeout: 20_000 }).catch(() => {});

  await page.fill('#input-visit-date', '2026-09-03');
  await page.selectOption('[data-field="course"]', { index: 1 }).catch(async () => {
    const first = await page.locator('[data-field="course"] option').nth(1).getAttribute('value');
    await page.selectOption('[data-field="course"]', first);
  });
  await page.fill('#input-weight', '4.6');
  /* 4.4kg → 4.6kg。**入れた瞬間に増減が出ること。** */
  const diffAfter = (await page.locator('#weight-diff-badge').textContent() || '').trim();
  check('体重を入れると前回比が出る（4.4 → 4.6 で +200g ▲）',
    diffAfter === '+200g ▲', `badge="${diffAfter}"`);
  await page.fill('[data-field="staff-note"]', '6枚目のメッセージ。今回書いたもの。');

  const optionCount = await page.locator('#options-grid .teeth-pill-btn').count();
  if (optionCount > 0) await page.locator('#options-grid .teeth-pill-btn').first().click();
  check('⑦使用オプションが選べる（帯が出ている）', optionCount > 0, `option=${optionCount}`);

  /* 引き継いだ印に、今回の分を1つ足す。**引き継いだ印が編集できる**こと。 */
  const canvas = page.locator('#marking-canvas');
  /* **画面に入れてから触る。** `boundingBox()` は表示域からの座標なので、
     下の方に在るまま押すと別の場所を押すことになる。 */
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await canvas.boundingBox();
  /* **クリックではなく、なぞる。** 既定の置き方は「なぞる」で、
     なぞらずに触れただけの点1つは捨てる仕様（見えない印を残さない）。
     人が指でやるのと同じに、押して・動かして・離す。 */
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.35, { steps: 5 });
  await page.mouse.up();
  const markCount = await page.evaluate(() => App.marks.length);
  check('引き継いだ印に、今回の印を足せる', markCount === 2, `marks=${markCount}`);

  /* **確定に失敗しても、そこで検査を終わらせない。** 途中で throw すると、
     以降の項（6枚目の中身・7枚目の引き継ぎ）が**赤とも緑とも言われない**まま
     消える——壊したときに何が守れていないのかが分からなくなる。 */
  await page.locator('.dock-action-wrap .boxbutton').click();
  const committed = await page
    .waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check('確定できた（⑤へ進んだ）', committed, page.url().split('/').slice(-1)[0].slice(0, 8));

  const afterFinals = await (await fetch(`${worker.base}/api/pets/${petId}/reports`, { headers })).json();
  const finals = (afterFinals.reports || []).filter((r) => r.status === 'final');
  check('確定カルテが6枚になった', finals.length === 6, `${finals.length}枚`);

  const sixth = finals.sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)))[0];
  const sixthFull = await (await fetch(
    `${worker.base}/api/pets/${petId}/reports/${sixth.id}`, { headers },
  )).json();
  const sixthData = (sixthFull.report && sixthFull.report.data) || {};
  check('6枚目のメッセージは今回書いたもの（前回の使い回しではない）',
    sixthData.staffNote === '6枚目のメッセージ。今回書いたもの。',
    `staffNote="${String(sixthData.staffNote).slice(0, 20)}"`);
  /* **「無い」だけを見ない。** 読めていないのに「混ざっていない」と言えてしまう
     （`docs/watch.md` W-1）。同じ条件に「6枚目を実際に読めたこと」を置く。 */
  check('6枚目に前回の写真が混ざっていない',
    sixthData.course !== undefined
    && !sixthData.trimming && !(sixthData.ear || {}).photo && !(sixthData.teeth || {}).photos,
    JSON.stringify({ course: sixthData.course, trimming: !!sixthData.trimming }));
  check('6枚目に爪が引き継がれている', (sixthData.nail || {}).front === 2, `front=${(sixthData.nail || {}).front}`);
  check('6枚目に __marks が載っている（次の回で印を引き継げる）',
    Array.isArray(sixthData.__marks) && sixthData.__marks.length === 2,
    `marks=${(sixthData.__marks || []).length}`);

  /* ── 飼い主に「体重推移」が届くか（マスター指示 2026-09-03）─────────
     `data.weights` はこのカルテ1枚分（1回）しか持たない。それだけを描いていたときは
     **「体重推移」と書いた箱に点が1つ**しか乗らず、`polyline` は2点未満では線を
     引けないので推移が一度も届いていなかった。**確定カルテを横断した履歴**が
     応答に載り、**線が実際に引かれている**ところまで見る。 */
  const history = (sixthFull.report && sixthFull.report.weightHistory) || [];
  check('カルテ1枚の応答に、確定カルテを横断した体重の履歴が載っている',
    Array.isArray(history) && history.length >= 2, `点=${history.length}`);
  check('履歴の最後が、いま入れた体重（4.6kg）',
    history.length > 0 && Number(history[history.length - 1].kg) === 4.6,
    `最後=${history.length > 0 ? history[history.length - 1].kg : 'なし'}kg`);

  /* ⑤スタッフ確認の画面で、**実際に線が引かれているか**を数える。
     ⑤と⑥は同一レンダラ（マスター指定）なので、ここで線が引ければ飼い主にも届く。 */
  /* ⑤が描き終わるまで待つ。**描く前に読むと「線が無い」と読み違える。** */
  await page.waitForSelector('[data-view="weight-graph"] svg', { timeout: 20_000 }).catch(() => {});
  const graphPoints = await page.evaluate(() => {
    const host = document.querySelector('[data-view="weight-graph"]');
    if (!host) return { ok: false, points: 0, why: 'グラフの器そのものが無い' };
    const line = host.querySelector('polyline');
    if (!line) return { ok: false, points: 0, why: `線が無い（中身="${host.textContent.trim().slice(0, 40)}"）` };
    const points = (line.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean);
    return { ok: points.length >= 2, points: points.length };
  });
  check('⑤の体重グラフに線が引かれている（点が2つ以上）',
    graphPoints.ok, JSON.stringify(graphPoints));
  /* **要素そのままの `screenshot()` は使わない。** ⑤の器は開いたあとも動いており、
     Playwright が「静止した」と判断できずに待ち続ける（実測: 30秒でタイムアウト）。
     位置を測って、画面をその範囲で切る。 */
  /* **人と同じように、段を開いてから見る。** `#wave-weight` は既定で閉じている
     （`magazine-view.js` の `wave-card` に `is-open` が無い）。閉じた段の中は
     大きさ0なので、開かずに撮ると「グラフが無い」ことと区別できない。 */
  await page.locator('[data-toggle="wave-weight"]').click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const graphRect = await page.evaluate(() => {
    const el = document.querySelector('[data-view="weight-graph"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, display: getComputedStyle(el).display };
  });
  await page.waitForTimeout(400);
  if (graphRect && graphRect.width > 0 && graphRect.height > 0) {
    const again = await page.evaluate(() => {
      const r = document.querySelector('[data-view="weight-graph"]').getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
    });
    await page.screenshot({ path: '.human/carry-over/8_体重推移_線が引かれている.png', clip: again })
      .catch((e) => process.stdout.write(`      （絵が撮れなかった: ${String(e).slice(0, 100)}）\n`));
  } else {
    process.stdout.write(`      （グラフの位置が取れない: ${JSON.stringify(graphRect)}）\n`);
  }

  /* ── 7枚目。6枚目から引き継げるか（線が次の回まで続くか）────────── */
  await page.goto(`${worker.base}/edit/p/${petId}`);
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  const seventh = await page
    .waitForFunction(() => {
      const el = document.getElementById('carry-over-text');
      return !!el && el.textContent.trim() !== '';
    }, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  check('7枚目も「前回の続き」から始まる', seventh);
  const seventhMarks = await page.evaluate(() => App.marks.length);
  check('7枚目に、6枚目で足した印まで引き継がれている', seventhMarks === 2, `marks=${seventhMarks}`);
  const seventhNote = await page.inputValue('[data-field="staff-note"]');
  check('7枚目のメッセージは空（6枚目の文が残っていない）', seventhNote === '', `value="${seventhNote.slice(0, 20)}"`);
  const seventhDiff = (await page.locator('#weight-diff-badge').textContent() || '').trim();
  check('7枚目の前回比は、6枚目で量った体重（4.6kg）を基準にする',
    seventhDiff === '前回 4.6kg', `badge="${seventhDiff}"`);
  await page.locator('.clinical-group:has(#input-weight)').first()
    .screenshot({ path: '.human/carry-over/7_前回比.png' }).catch(() => {});

  /* ── 作りすぎていないか。**1枚も確定していない犬**では前回比を出さない ──
     引き継ぎも起きないので、帯も出ない。ここが緑でないと、
     「初回の犬に前回の数字が見える」形になる（`D-10`）。 */
  const fresh = await createPet(worker.base, headers, `${label}n`);
  await page.goto(`${worker.base}/edit/p/${fresh.petId}`);
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForTimeout(2_000);
  const freshDiff = (await page.locator('#weight-diff-badge').textContent() || '').trim();
  check('カルテが1枚も無い犬では「前回の記録なし」のまま',
    freshDiff === '前回の記録なし', `badge="${freshDiff}"`);
  const freshBand = await page.locator('#carry-over-undo').isVisible();
  check('カルテが1枚も無い犬では、引き継ぎの帯を出さない', freshBand === false);
} finally {
  await page.screenshot({ path: '.human/carry-over-last.png' }).catch(() => {});
  await browser.close();
  await worker.stop();
}

process.stdout.write(`\n${passed}/${passed + failed} PASS\n`);
process.exit(failed === 0 ? 0 : 1);

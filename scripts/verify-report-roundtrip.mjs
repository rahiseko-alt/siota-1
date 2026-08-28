/**
 * verify-report-roundtrip.mjs — トリマーが書いたものが、飼い主にそのまま届くか
 *
 * **このアプリが在る理由そのものを見る検査**（`AGENTS.md` D-12 の機械強制）。
 * `bad-scenarios-F3.md` #13。画面が出る・ボタンが押せるではなく、
 * **記入 → 確定 → 飼い主が `/my` で開く**の往復で、1項目でも値が変わったら失格とする。
 *
 * `6685df5^` の版から**書き直した**（復元ではない）。旧版が掴んでいた目印
 * （`.owner-pet-item` `#ponchi-commit-ok` `[data-field="skin-loc-1"]` …）は
 * 正UI に1つも無い（`docs/ops/verify-restore-F3.md`）。**見るもの**——入力した値が
 * 受け手に同一で届いたか——だけを引き継ぎ、掴む場所を正UI に合わせた。
 *
 * 入力欄を足したら、必ずここにも足すこと（`AGENTS.md` STEP 5 の指示）。
 * いま正UI に在る入力は `docs/ops/key-parity-F3.md` の突き合わせが正。
 *
 * **日本語をセレクタに連結しない**（`D-9`）。歯の状態のように値が日本語のものは、
 * ボタンを全部見て**中身で選ぶ**（`pickByValue`）。
 *
 *   npm run verify:roundtrip
 *   （CI では .github/workflows/ci.yml が自動で走らせる）
 *
 * EXIT 0 = 全項目が往復した / EXIT 1 = 1項目でも変わった・消えた
 */

import { startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

/** トリマーが1回の施術で入れる値。**正UI に実在する入力だけ**を使う。 */
const INPUT = {
  staffNote: '耳の裏を丁寧に洗いました。来月もお待ちしています。',
  nail: 2,          /* 爪レベル（1〜3） */
  earRight: 3,
  earLeft: 1,
  teeth: 'ちょっと付着💦',   /* 値が日本語。セレクタに連結しない（D-9） */
  weight: 3.42,
};

const results = [];
function check(name, actual, expected) {
  const pass = String(actual) === String(expected);
  results.push({ name, pass });
  process.stdout.write(
    `${pass ? 'PASS' : 'FAIL'}  ${name}`
    + (pass ? `  "${String(actual).slice(0, 30)}"` : `\n        期待: "${expected}"\n        実際: "${actual}"`)
    + '\n',
  );
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.ROUNDTRIP_PORT || 8791) });
let browser = null;
try {
  /* 既存の飼い主（owner-a）の下に犬を作る。新しい飼い主を作ると `owner_users` に
     紐付かない孤児になり、**誰も飼い主として読めない**——RLS がそこしか通さない。 */
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const PET_NAME = `RT${Math.random().toString(36).slice(2, 7)}`;
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: PET_NAME, template: 'ponchi' }),
  });
  check('0. 検査用の犬を登録できた', petRes.status, 201);
  const pet = (await petRes.json()).pet;

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  /* ── トリマー側: ④カルテ作成に入って記入する ── */
  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 15_000 });

  const filled = await page.evaluate((input) => {
    const missing = [];
    let teethLabel = '';
    let teethSaved = null;
    const note = document.querySelector('[data-field="staff-note"]');
    if (!note) missing.push('[data-field="staff-note"]');
    else { note.value = input.staffNote; note.dispatchEvent(new Event('input', { bubbles: true })); }

    const weight = document.getElementById('input-weight');
    if (!weight) missing.push('#input-weight');
    else {
      weight.value = String(input.weight);
      weight.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /* 爪は `App.selectStepper(this,'nail',N)` を持つボタン。N で選ぶ（ASCII）。 */
    const nailBtn = [...document.querySelectorAll('#nail-stepper-wrap .stepper-btn')]
      .find((el) => (el.getAttribute('onclick') || '').includes(`'nail', ${input.nail}`));
    if (!nailBtn) missing.push(`nail=${input.nail}`); else nailBtn.click();

    for (const [side, value] of [['right', input.earRight], ['left', input.earLeft]]) {
      const group = document.querySelector(`[data-ear="${side}"]`);
      if (!group) { missing.push(`[data-ear="${side}"]`); continue; }
      const btn = [...group.querySelectorAll('.stepper-btn')]
        .find((el) => (el.querySelector('.val') || {}).textContent === String(value));
      if (!btn) missing.push(`ear ${side}=${value}`); else btn.click();
    }

    /* 歯は**ボタンの表示**で選ぶ。表示と保存値は同じもの——もとは HTML 側で
       保存値を第2引数に二重に書いており、6つのうち3つでずれていた（`#24`・直した）。
       日本語は**セレクタに連結せず**、中身を読んで比べる（`D-9`）。 */
    const teethBtn = [...document.querySelectorAll('.teeth-pill-btn')]
      .find((el) => ((el.querySelector('.name') || {}).textContent || '').trim() === input.teeth);
    if (!teethBtn) missing.push(`teeth=${input.teeth}`);
    else {
      teethLabel = ((teethBtn.querySelector('.name') || {}).textContent || '').trim();
      teethBtn.click();
      /* **押した直後に、保存されることになった値そのものを読む。** ここが
         「表示と保存値が同じ」と言える唯一の地点で、実際に3つずれていたのも
         ここだった（`#24`）。届いた先（6・13）だけを見ていると、たまたま
         同じ文字を入れ直しても気づけない。 */
      /* `ui.js` は `const App = {...}` の素のスクリプトなので、**`globalThis.App`
         では取れない**（宣言的レキシカル環境にいる）。素の `App` なら解決する。 */
      teethSaved = (typeof App !== 'undefined' && App.form || {}).teeth;
    }

    /* 犬体図に印を1つ付ける。押した所見が残る道はここしか無い（`#3`）。 */
    const canvas = document.getElementById('marking-canvas');
    if (!canvas) missing.push('#marking-canvas');
    else {
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    }
    return { missing, teethLabel, teethSaved };
  }, INPUT);
  check('1. 記入先の要素がすべて実在する',
    filled.missing.length === 0 ? 'ok' : `欠落 ${JSON.stringify(filled.missing)}`, 'ok');
  if (filled.missing.length > 0) throw new Error('UI と保存契約が食い違っている');

  /* **押した表示と、保存される値が同じであること。** かつては6つのうち3つでずれていた
     （`docs/deferred.md` #24）。HTML 側の二重書きを廃して直したので、**合否で見る**。
     ここを出力だけにしておくと、また静かにずれても誰も止められない。

     比べるのは「ボタンの表示」と「`App.form` に入った値」である。はじめは
     `filled.teethLabel` を `INPUT.teeth` と比べていたが、**その表示で探した
     ボタンの表示を読み返していただけ**で、何をどう壊しても緑になる検査だった
     （偽-2）。読む先を `App.form.teeth` に変えて、ずれが出る地点に当てた。 */
  check('1b. 押したボタンの表示が、そのまま保存される値になっている',
    filled.teethSaved, filled.teethLabel);

  /* ── ④確定 → ⑤確認へ。**保存されたものを開き直す**ので、ここに出ている値は
        既にサーバを往復している（`D-12`）。 ── */
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  await page.waitForSelector('#screen-4 .magazine-container', { timeout: 20_000 });
  const reportId = new URL(page.url()).pathname.split('/').pop();
  check('2. 確定してカルテが1件できた', /^[0-9a-f-]{36}$/.test(reportId) ? 'ok' : page.url(), 'ok');

  const view = async (target) => target.evaluate(() => {
    const at = (name) => {
      const el = document.querySelector(`[data-view="${name}"]`);
      return el ? el.textContent.trim() : '(器が無い)';
    };
    return {
      dogName: at('dog-name'),
      staffNote: at('staff-note'),
      nailPill: at('nail-pill'),
      earPill: at('ear-pill'),
      teethPill: at('teeth-pill'),
      weightPill: at('weight-pill'),
      /* **体重のグラフが実際に描かれたか。**
         数字（`weight-pill`）が出ていてもグラフは別の関数が描く。
         `mutate-run.mjs` の `weight-graph-off`（`renderWeightGraph` を空にする）で
         **どの検査も赤にならなかった**——数字だけ見ていて、グラフを誰も見ていなかった
         （`F-20260828-51`）。中の要素を数える（枠が在るだけでは通さない）。 */
      weightGraphNodes: (document.querySelector('[data-view="weight-graph"]') || {})
        .childElementCount ?? -1,
      /* 犬体図の印が**画像として**届いているか。`asset://` のままだと出ない。 */
      skinImage: (document.querySelector('[data-view="skin-image"]') || {}).getAttribute
        ? (document.querySelector('[data-view="skin-image"]').getAttribute('src') || '')
        : '',
      pageUrlImgs: [...document.querySelectorAll('img')]
        .map((el) => el.getAttribute('src') || '')
        .filter((src) => /^https?:\/\/[^/]+\/(edit|my)\//.test(src)).length,
    };
  });

  process.stdout.write('\n── ⑤確認（トリマー）に出ている値 ──\n');
  const staffView = await view(page);
  check('3. 確認: 担当からの一言', staffView.staffNote, INPUT.staffNote);
  check('4. 確認: 爪', staffView.nailPill, `Lv.${INPUT.nail}`);
  check('5. 確認: 耳', staffView.earPill, `右 Lv.${INPUT.earRight} / 左 Lv.${INPUT.earLeft}`);
  check('6. 確認: 歯', staffView.teethPill, INPUT.teeth);
  check('7. 確認: 体重', staffView.weightPill, `${INPUT.weight}kg`);
  check('8. 確認: 犬体図の印が画像として出ている',
    /^(blob:|data:image)/.test(staffView.skinImage) ? 'ok' : `src=${staffView.skinImage.slice(0, 40)}`, 'ok');

  /* ── 飼い主側: 別のブラウザ文脈でログインし直し、`/my` で同じ値を見る ── */
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}/reports/${reportId}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('.magazine-container', { timeout: 20_000 });

  process.stdout.write('\n── ⑥飼い主が /my で見るもの ──\n');
  const ownerView = await view(ownerPage);
  check('9. 飼い主: 犬の名前', ownerView.dogName, PET_NAME);
  check('10. 飼い主: 担当からの一言', ownerView.staffNote, INPUT.staffNote);
  check('11. 飼い主: 爪', ownerView.nailPill, `Lv.${INPUT.nail}`);
  check('12. 飼い主: 耳', ownerView.earPill, `右 Lv.${INPUT.earRight} / 左 Lv.${INPUT.earLeft}`);
  check('13. 飼い主: 歯', ownerView.teethPill, INPUT.teeth);
  check('14. 飼い主: 体重', ownerView.weightPill, `${INPUT.weight}kg`);
  check('14b. 飼い主: 体重のグラフが描かれている（数字だけでなく）',
    ownerView.weightGraphNodes > 0 ? 'ok' : `中の要素=${ownerView.weightGraphNodes}`, 'ok');
  check('15. 飼い主: 犬体図の印が画像として届く',
    /^(blob:|data:image)/.test(ownerView.skinImage) ? 'ok' : `src=${ownerView.skinImage.slice(0, 40)}`, 'ok');
  check('16. 飼い主: 壊れた画像（ページURL）が出ていない', ownerView.pageUrlImgs, 0);

  /* 他人には見えないこと（RLS）。届くことだけを見て、届いてはいけない相手に
     届いていないかを見ないのは、検査として半分しかやっていない。 */
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(`${BASE}/my`);
  await injectSession(strangerPage, FIXTURE.ownerBEmail);
  await strangerPage.goto(`${BASE}/my/pets/${pet.id}/reports/${reportId}`, { waitUntil: 'networkidle' });
  await strangerPage.waitForTimeout(2_000);
  const strangerSees = await strangerPage.evaluate(
    (note) => document.body.textContent.includes(note), INPUT.staffNote,
  );
  check('17. 他人には見えない（RLS）', strangerSees ? '見えた' : 'ok', 'ok');
  await ownerContext.close();
  await strangerContext.close();

  /* ── 19: **量らなかった体重が、勝手に届かないこと。**
     入力欄に `value="2.79"` が入っていたため、体重に触れずに確定しても
     **どの犬にも 2.79kg が届いていた**（診断 #75/#76）。書いていないことが
     書いてあるように見える形で、`D-10` の型。 */
  const NO_WEIGHT_PET = `NW${Math.random().toString(36).slice(2, 7)}`;
  const nwRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: NO_WEIGHT_PET, template: 'ponchi' }),
  });
  const nwPet = (await nwRes.json()).pet;
  await page.goto(`${BASE}/edit/p/${nwPet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  /* **体重には触らない。** 一言だけ書いて確定する。 */
  const startedEmpty = await page.inputValue('#input-weight');
  check('19. 体重の欄が空で始まる（見本値が入っていない）', startedEmpty === '' ? 'ok' : startedEmpty, 'ok');
  await page.fill('[data-field="staff-note"]', '体重は量っていない回。');
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const nwReportId = new URL(page.url()).pathname.split('/').pop();
  const nwOwnerContext = await browser.newContext();
  const nwOwnerPage = await nwOwnerContext.newPage();
  await nwOwnerPage.goto(`${BASE}/my`);
  await injectSession(nwOwnerPage, FIXTURE.ownerAEmail);
  await nwOwnerPage.goto(`${BASE}/my/pets/${nwPet.id}/reports/${nwReportId}`, { waitUntil: 'networkidle' });
  await nwOwnerPage.waitForSelector('.magazine-container', { timeout: 20_000 });
  const nwOwnerView = await view(nwOwnerPage);
  await nwOwnerContext.close();
  /* 器が無い／空／数字を含まない、のいずれでも合格。**落ちるのは数字が出たときだけ**。
     「空文字と比べる」だけにすると、器ごと消えた日にも緑になる（`F-20260825-40` の型）。 */
  const nwWeightText = nwOwnerView.weightPill;
  check('20. 飼い主の画面に、量っていない体重が出ない',
    /\d/.test(nwWeightText) ? `出た: "${nwWeightText}"` : 'ok', 'ok');

  check('18. アプリ由来のエラーが無い', pageErrors.length === 0 ? 'ok' : pageErrors.join(' | '), 'ok');
} catch (error) {
  check('検査を最後まで実行できた', error.message, 'ok');
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n===== 往復: ${passed}/${results.length} =====\n`);
if (passed !== results.length) {
  process.stdout.write('\nトリマーが書いたのに、飼い主に同じ値で届いていない項目がある。\n');
}
process.exit(passed === results.length ? 0 : 1);

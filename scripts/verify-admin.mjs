/**
 * verify-admin.mjs — 管理画面（マスター指示 2026-08-26）
 *
 * **店舗側の権限は「管理者」と「スタッフ」に分け直した**（マスター指示 2026-11-19・`N-49`・
 * `202611190017`）。下の ①〜⑥ は**管理者の口座**（`staff@local.test`・名前は昔のまま）で通す。
 * スタッフ権限（`limited-staff@local.test`）が削除・店舗設定・スタッフ招待を
 * 断られることは ⑧（`22*`）で見る。
 *
 * 見るもの:
 *   ① お店の人はカルテ画面に着き、ヘッダーの「管理」から管理画面へ入れる
 *   ② 管理画面に ①リピーター ②新規 ③削除 が在る
 *   ③ リピーター → カルテ作成 / カルテ修正
 *   ④ 新規 → 顧客アカウント作成・ペットアカウント作成が**実際に効く**
 *   ⑤ 削除3種が**実際に消す**（写真の実体まで。`service_role` で数える）
 *   ⑥ カルテ修正が**確定済みを上書きする**（2枚目を作らない・飼い主に届く中身が変わる）
 *   ⑦ **飼い主はこの画面を使えず**、かつ行き止まりにならない
 *   ⑧ **スタッフ**は リピーター / 新規 だけを使え、削除・店舗設定・スタッフ招待は
 *      画面でも API でも断られ、**断られた後も何も消えていない・変わっていない**
 *   ⑨ **スタッフ管理**: 管理者が辞めた人の利用を止めると、その人の鍵で店のデータが
 *      取れなくなり、再開すると戻る。自分は止められない。スタッフには出ない（`#76`）
 *
 * **「押せた」で合格にしない**（`D-12`）。作った/消した/直したものを、
 * 作用の出た先（一覧・Storage の実体・飼い主の画面）で数え直す。
 *
 *   npm run verify:admin
 */

import zlib from 'node:zlib';
import {
  startLocalWorker, injectSession, passwordLogin, localServiceRoleKey, createTestUser,
  FIXTURE, LOCAL_PASSWORD, LOCAL_SUPABASE_URL,
} from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

/** 単色 PNG（`verify-photo-roundtrip.mjs` と同じ作り方をそのまま持ってきた）。
    `18.` は Storage の実体が消えたかを見るが、**この検査の動線では写真を1枚も
    上げていなかった**——upload の有無にかかわらず prefix 下は常に0件で、
    `purgePetAssets` をどう壊しても赤にならない構造欠陥だった（W-1 の型）。
    1枚だけ実際に上げることで、消す対象を作る。 */
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function solidPng([r, g, b], size = 16) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  const note = detail && !(pass && String(detail).startsWith('★')) ? detail : '';
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.ADMIN_PORT || 8797) });
let browser = null;
/* ⑨ で止めたスタッフの口座を戻す手順。止める直前に入れ、finally で必ず呼ぶ。 */
let restoreLimitedStaff = null;

/** 画面の文字でボタンを選ぶ（人と同じ探し方）。日本語はセレクタに連結しない（`D-9`）。 */
const tapByText = (page, text) => page.evaluate((needle) => {
  const button = [...document.querySelectorAll('.admin-menu__item, .boxbutton, .admin-back')]
    .find((el) => (el.textContent || '').includes(needle));
  if (!button) return false;
  button.click();
  return true;
}, text);

/** 画面が何と言ったか。**落ちたときに理由を出すため**だけに使う（合否には使わない）。 */
const resultText = async (page) => (
  (await page.locator('.admin-result').first().textContent().catch(() => '') || '').trim()
);

const menuTitles = (page) => page.evaluate(
  () => [...document.querySelectorAll('.admin-menu__item strong')].map((el) => el.textContent.trim()),
);

try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const serviceKey = await localServiceRoleKey();

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  /* **アプリが人に見せた理由を、検査も読む。** `commitReport()` は保存に失敗すると
     `alert()` で理由を出して画面を移さない。listener を置かないと Playwright が
     黙って閉じるので、**保存できなかったのに「押せた」だけが残る**。 */
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  /* ── ① お店の人は、みんなと同じカルテ画面に着き、そこから管理画面へ入れる ──

     **仕様が変わった**（マスター指示 2026-09-02:「入口は1つ、管理者ページが
     表示されるかされないかの差だけでいい」）。以前ここは「管理者が `/my` を開くと
     `/admin` へ送られる」を見ていた。その作りだと**着く先が人によって変わり**、
     しかもカルテ画面から管理画面へ戻る道が1つも無く（`/admin` へのリンクは
     画面に0件だった）、管理者はどちらか一方にしか居られなかった。

     いまは**着く先は全員同じ**で、お店の人にはヘッダーに「管理」が出る
     （権限が1つになったので、出す相手も「お店の人なら全員」に揃えた・`D-20260906-68`）。
     検査もその**往復**を見る——着く／入口が出る／押すと着く、の3つ。
     前の1問より見る範囲は広い（弱めていない）。 */
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(page, FIXTURE.staffEmail);
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/edit$/, { timeout: 20_000 }).catch(() => {});
  check('1. お店の人は、みんなと同じカルテ画面に着く',
    new URL(page.url()).pathname === '/edit', `path=${new URL(page.url()).pathname}`);

  /* **画面が起動しきるまで待つ。** 「管理」は `/api/session` の応答が返って
     初めて出る。犬のカードが並んだ時点で、その応答は既に返っている。
     待たずに見ると、起動中の DOM を掴んで「無い」と読む（実際に一度そうなった）。 */
  await page.waitForSelector('.karte-card', { timeout: 30_000 }).catch(() => {});
  const adminLink = page.locator('[data-admin-link]');
  await adminLink.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  /* **`isVisible()` だけで合格にしない。** 最初これだけで見ていたら、
     スマホ幅で右にはみ出して**指が届かない**のに true になった
     （2026-09-02・スクショで発覚）。画面の幅の内側に入っているかまで見る
     ——`D-14`「押せたではなく、人が届くか」。 */
  const reach = await page.evaluate(() => {
    const el = document.querySelector('[data-admin-link]');
    if (!el || el.hidden) return { ok: false, why: '出ていない' };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { ok: false, why: '大きさが0' };
    if (r.left < 0 || r.right > window.innerWidth) {
      return { ok: false, why: `画面の外（left=${Math.round(r.left)} right=${Math.round(r.right)} 幅=${window.innerWidth}）` };
    }
    return { ok: true, why: `left=${Math.round(r.left)} right=${Math.round(r.right)} 幅=${window.innerWidth}` };
  });
  check('1b. お店の人には「管理」の入口が見えていて、指が届く', reach.ok, reach.why);

  await adminLink.click();
  await page.waitForURL(/\/admin$/, { timeout: 20_000 }).catch(() => {});
  check('1c. 「管理」を押すと管理画面に着く',
    new URL(page.url()).pathname === '/admin', `path=${new URL(page.url()).pathname}`);

  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });

  /* ── ② 管理者ページの6つ（`#4` 店舗設定はマスター指示 2026-08-29・D-20260829-58・
     `#5` スタッフ招待はマスター指示 2026-09-24「招待ボタン復活させて」で新設・
     `#6` スタッフ管理は放置リスト `#76`・レビュー M1 で復活） ── */
  const top = await menuTitles(page);
  check('2. 管理画面に リピーター / 新規 / 削除 / 店舗設定 / スタッフ招待 / スタッフ管理 が在る',
    top.length === 6
    && top[0].includes('リピーター') && top[1].includes('新規') && top[2].includes('削除')
    && top[3].includes('店舗設定') && top[4].includes('スタッフ招待') && top[5].includes('スタッフ管理'),
    `出た項目=${JSON.stringify(top)}`);

  /* ── ③ リピーター ── */
  await tapByText(page, 'リピーター');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const repeat = await menuTitles(page);
  check('3. リピーターに カルテ作成 / カルテ修正 / 犬の情報を直す が在る',
    repeat.length === 3 && repeat[0].includes('カルテ作成') && repeat[1].includes('カルテ修正')
    && repeat[2].includes('犬の情報を直す'),
    `出た項目=${JSON.stringify(repeat)}`);
  await tapByText(page, '◀ もどる');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });

  /* ── ③b 画面が変われば住所も変わる（マスター判断 2026-09-06）──────────
     5つのメニューに URL を与えた回（PR #75）は、**その URL を見る検査を
     1本も足さなかった**（`grep -rn "/admin/repeat" scripts/` → 0件）。
     サブ画面にも与えた今回、まとめてここで見る。

     見るのは4つ:
       ①メニューを押すと住所が変わる ②サブ画面でも変わる
       ③**ブラウザの戻るで、押した順にちょうど1つ戻る**（`#49` の型）
       ④**その住所を直接開いても、同じ画面が出る**（貼れる URL であること） */
  const pathNow = () => new URL(page.url()).pathname;

  await tapByText(page, 'リピーター');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  check('3b. メニューを押すと住所が変わる', pathNow() === '/admin/repeat', `path=${pathNow()}`);

  await tapByText(page, 'カルテ作成');
  /* この時点では犬がまだ0頭のこともある（作るのは ④）。**行ではなく見出しを待つ**
     ——0件でも picker は必ず見出しを出す。 */
  const pickerShown = await page.waitForFunction(
    () => (document.body.textContent || '').includes('レポートを作成する犬を選ぶ'),
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);
  check('3c. サブ画面（犬を選ぶ）でも住所が変わる',
    pickerShown && pathNow() === '/admin/repeat/create', `path=${pathNow()} 出た=${pickerShown}`);

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  const backTitles = await menuTitles(page);
  check('3d. ブラウザの戻るで、ちょうど1つ手前（リピーター）に戻る',
    pathNow() === '/admin/repeat' && backTitles.length === 3
    && backTitles[0].includes('カルテ作成'),
    `path=${pathNow()} 項目=${JSON.stringify(backTitles)}`);

  await page.goto(`${BASE}/admin/new/owner`, { waitUntil: 'domcontentloaded' });
  const formShown = await page.waitForSelector('[data-admin-field="owner-name"]', { timeout: 20_000 })
    .then(() => true).catch(() => false);
  check('3e. サブ画面の住所を直接開くと、その画面が出る（貼れる URL）',
    formShown && pathNow() === '/admin/new/owner', `path=${pathNow()} 出た=${formShown}`);

  /* ── 3g **1件選んだ後の画面からも、戻るは1つだけ**
     （マスター指示 2026-09-13・放置リスト `#49`）。
     そのカルテ一覧・削除の確認は URL を持たず、履歴も積んでいなかったので、
     **ブラウザの戻るで一段多く戻っていた**（犬を選ぶ画面を飛び越してメニューへ）。 ── */
  await page.goto(`${BASE}/admin/delete/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-admin-action="pick-pet"]', { timeout: 20_000 });
  await page.locator('[data-admin-action="pick-pet"]').first().click();
  const reportListShown = await page
    .waitForSelector('[data-admin-action="pick-report"]', { timeout: 20_000 })
    .then(() => true).catch(() => false);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  const backToPetPick = await page
    .waitForSelector('[data-admin-action="pick-pet"]', { timeout: 20_000 })
    .then(() => true).catch(() => false);
  check('3g. カルテ一覧から戻ると、ちょうど1つ手前（犬を選ぶ）に戻る',
    reportListShown && backToPetPick && pathNow() === '/admin/delete/report',
    `カルテ一覧=${reportListShown} 犬選び=${backToPetPick} path=${pathNow()}`);

  /* ── 3h **犬を名前・飼い主名で探して、そのままカルテ作成へ**
     （クライアント指示 C-14・2026-11-18）。見るのは「打った文字で行が絞られる」
     「合う行が無ければ無いと言う」「絞った行を押すとその子のカルテ作成に着く」の3つ。
     fixture の飼い主 `Owner B` の犬は `Q` の1頭だけ（`supabase/seed.sql`）。 ── */
  await page.goto(`${BASE}/admin/repeat/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-admin-field="pet-search"]', { timeout: 20_000 });
  const visibleRows = () => page.evaluate(() => [...document.querySelectorAll('[data-admin-action="pick-pet"]')]
    .filter((row) => !row.hidden).map((row) => row.textContent));
  const allRows = (await visibleRows()).length;
  await page.fill('[data-admin-field="pet-search"]', 'owner b');
  const ownerRows = await visibleRows();
  check('3h. 飼い主の名前で打つと、その飼い主の犬だけに絞られる（大文字小文字は問わない）',
    ownerRows.length >= 1 && ownerRows.length < allRows && ownerRows.every((t) => t.includes('Owner B')),
    `全${allRows}行 → ${JSON.stringify(ownerRows)}`);
  await page.fill('[data-admin-field="pet-search"]', 'zz-該当なし-zz');
  const noneShown = await page.evaluate(() => (document.body.textContent || '').includes('該当する子がいません'));
  check('3i. 合う犬がいなければ、0行で「該当する子がいません」と出る',
    (await visibleRows()).length === 0 && noneShown, `行=${(await visibleRows()).length} 案内=${noneShown}`);
  await page.fill('[data-admin-field="pet-search"]', 'owner b');
  await page.locator('[data-admin-action="pick-pet"]:not([hidden])').first().click();
  await page.waitForURL((url) => new URL(url).pathname.startsWith('/edit/p/'), { timeout: 20_000 }).catch(() => {});
  check('3j. 絞った行を押すと、その犬のカルテ作成（/edit/p/…）に直接着く',
    pathNow() === '/edit/p/40000000-0000-0000-0000-0000000000b1', `path=${pathNow()}`);

  await page.goto(`${BASE}/admin/nowhere`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  const fallback = await menuTitles(page);
  check('3f. 無い住所を開いても白い画面にならず、管理のトップが出る',
    fallback.length === 6 && fallback[0].includes('リピーター'),
    `出た項目=${JSON.stringify(fallback)}`);

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });

  /* ── ④ 新規: 顧客を作る ── */
  const stamp = Math.random().toString(36).slice(2, 7);
  const ownerName = `新規飼い主${stamp}`;
  await tapByText(page, '新規');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const news = await menuTitles(page);
  check('4. 新規に 顧客アカウント作成 / ペットアカウント作成 が在る',
    news.length === 2 && news[0].includes('顧客アカウント') && news[1].includes('ペットアカウント'),
    `出た項目=${JSON.stringify(news)}`);

  await tapByText(page, '顧客アカウントの新規作成');
  await page.waitForSelector('[data-admin-field="owner-name"]', { timeout: 10_000 });
  await page.fill('[data-admin-field="owner-name"]', ownerName);
  await page.click('[data-admin-action="create-owner"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});

  /* **画面の文字で合格にしない。** サーバに在るかを数え直す（`D-12`）。 */
  const ownersAfter = await (await fetch(`${BASE}/api/owners`, { headers: authHeaders })).json();
  const createdOwner = (ownersAfter.owners || []).find((o) => o.name === ownerName);
  check('5. 顧客アカウントが実際に作られた', !!createdOwner, `name=${ownerName}`);
  if (!createdOwner) throw new Error('顧客が作られていないので先へ進めない');

  /* ── ④ 新規: ペットを作る ── */
  const petName = `新規犬${stamp}`;
  await tapByText(page, '◀ もどる');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  await tapByText(page, 'ペットアカウントの新規作成');
  await page.waitForSelector('[data-admin-field="pet-name"]', { timeout: 20_000 });
  await page.selectOption('[data-admin-field="owner-select"]', createdOwner.id);
  await page.fill('[data-admin-field="pet-name"]', petName);
  /* 犬種（`N-48`・案C）。**候補に無い犬種を手で打つ**——候補からしか入らない作りなら
     ここで落ちる。 */
  const breedTyped = `手入力犬種${stamp}`;
  const breedCandidates = await page.evaluate(() => {
    const input = document.querySelector('[data-admin-field="pet-breed"]');
    const list = input && input.list;
    return list ? [...list.options].map((o) => o.value) : [];
  });
  check('6a. 犬種の欄に、打つと出る候補が付いている',
    breedCandidates.length >= 20 && breedCandidates.includes('トイ・プードル') && breedCandidates.includes('ミックス'),
    `候補${breedCandidates.length}件`);
  await page.fill('[data-admin-field="pet-breed"]', breedTyped);
  await page.click('[data-admin-action="create-pet"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});

  const petsAfter = await (await fetch(`${BASE}/api/pets`, { headers: authHeaders })).json();
  const createdPet = (petsAfter.pets || []).find((p) => p.name === petName);
  check('6. ペットアカウントが実際に作られた', !!createdPet, `name=${petName}`);
  if (!createdPet) throw new Error('犬が作られていないので先へ進めない');
  /* **画面の文字で合格にしない**（`D-12`）。打った犬種がサーバーに同じ値で入ったかを見る。 */
  check('6b. 登録で手入力した犬種が、そのままの値で保存された', createdPet.breed === breedTyped,
    `保存=${JSON.stringify(createdPet.breed)}`);

  /* ── 6c 犬を選ぶ画面の行に犬種が出て、犬種でも探せる（C-14「飼い主名・犬名・犬種」） ── */
  await page.goto(`${BASE}/admin/repeat/create`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-admin-field="pet-search"]', { timeout: 20_000 });
  await page.fill('[data-admin-field="pet-search"]', breedTyped.toLowerCase());
  const breedRows = await page.evaluate(() => [...document.querySelectorAll('[data-admin-action="pick-pet"]')]
    .filter((row) => !row.hidden).map((row) => row.textContent));
  check('6c. 犬種で打つと、その犬種の子だけが出て、行に飼い主名・犬名・犬種が並ぶ',
    breedRows.length === 1 && breedRows[0].includes(petName) && breedRows[0].includes(ownerName)
    && breedRows[0].includes(breedTyped),
    JSON.stringify(breedRows));

  /* ── 6d 登録済みの子の犬種を直す・消す（`N-48`「犬の情報を直す」） ── */
  await page.goto(`${BASE}/admin/repeat`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '犬の情報を直す');
  await page.waitForSelector('[data-admin-field="pet-search"]', { timeout: 20_000 });
  check('6d. 犬の情報を直す画面にも住所がある', pathNow() === '/admin/repeat/pet', `path=${pathNow()}`);
  await page.fill('[data-admin-field="pet-search"]', petName);
  await page.locator('[data-admin-action="pick-pet"]:not([hidden])').first().click();
  await page.waitForSelector('[data-admin-action="save-pet"]', { timeout: 20_000 });
  const prefilled = await page.inputValue('[data-admin-field="pet-breed"]');
  check('6e. 直す画面には、いまの犬種が入っている', prefilled === breedTyped, `欄=${JSON.stringify(prefilled)}`);
  await page.fill('[data-admin-field="pet-breed"]', 'ミックス');
  await page.click('[data-admin-action="save-pet"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('保存しました'),
    { timeout: 20_000 },
  ).catch(() => {});
  const breedOf = async () => {
    const body = await (await fetch(`${BASE}/api/pets`, { headers: authHeaders })).json();
    const pet = (body.pets || []).find((p) => p.id === createdPet.id);
    return pet ? pet.breed : 'missing';
  };
  const afterEdit = await breedOf();
  check('6f. 直した犬種がサーバーに入った', afterEdit === 'ミックス', `保存=${JSON.stringify(afterEdit)}`);
  await page.fill('[data-admin-field="pet-breed"]', '');
  await page.click('[data-admin-action="save-pet"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('消しました'),
    { timeout: 20_000 },
  ).catch(() => {});
  const afterClear = await breedOf();
  check('6g. 空欄で保存すると犬種が消える（空文字ではなく「無し」）', afterClear === null,
    `保存=${JSON.stringify(afterClear)}`);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-admin-field="pet-search"]', { timeout: 20_000 }).catch(() => {});
  check('6h. 直す画面からブラウザの戻るで、犬を選ぶ画面にちょうど1つ戻る',
    pathNow() === '/admin/repeat/pet' && (await page.locator('[data-admin-field="pet-search"]').count()) === 1,
    `path=${pathNow()}`);

  /* ── ⑥ カルテ修正 — 確定済みを上書きする ──
     まず1枚確定させる（製品の道で作る。検査用の別経路を書かない）。 */
  const FIRST = '最初に書いた一言。';
  const FIXED = '直したあとの一言。';
  await page.goto(`${BASE}/edit/p/${createdPet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForTimeout(2000);
  /* **`18.`（写真の実体が消えたか）が測る対象を、実際に作る。** ここで1枚も上げなければ
     `18.` は upload の有無に関係なく常に0件で緑になり、`purgePetAssets` をどう壊しても
     気づけない（W-1 の型）。他の項と同じく製品の道（`[data-field="photo-ear"]`）で上げる。 */
  await page.locator('[data-field="photo-ear"]').setInputFiles(
    { name: 'ear.png', mimeType: 'image/png', buffer: solidPng([40, 60, 200]) },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-photo-thumbs="ear"] .photo-pick__thumb').length === 1,
    { timeout: 20_000 },
  ).catch(() => {});
  await page.fill('[data-field="staff-note"]', FIRST);
  /* コースは必須（マスター指示 2026-08-29・C-9）。選ばないと確定できない。 */
  await page.selectOption('[data-field="course"]', 'トリミングコース');
  /* **本日の体重と一言も入れる**（マスター指示 2026-09-13・放置リスト `#55`）。
     空のままだと確定の手前で「このまま確定しますか？」と一度訊くようにしたため、
     ここを空で通していた台本は止まる。実際の業務でも空で確定することはまず無いので、
     **本物に近い形に直す**（検査を弱めるのではなく、台本を現実に合わせる）。 */
  await page.fill('#input-weight', '4.2');
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const reportId = new URL(page.url()).pathname.split('/').pop();
  check('7. 直す対象のカルテを1枚確定できた', /^[0-9a-f-]{36}$/.test(reportId), `id=${reportId}`);

  /* 管理者画面の「カルテ修正」が開く URL と同じ形で入る。 */
  await page.goto(`${BASE}/edit/p/${createdPet.id}/${reportId}?revise=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  const carried = await page.inputValue('[data-field="staff-note"]');
  check('8. 修正で開くと、前に書いた中身が入っている', carried === FIRST, `"${carried}"`);

  await page.fill('[data-field="staff-note"]', FIXED);
  /* **URL の形だけで待ってはいけない。** いま居るのは `/edit/p/{犬}/{カルテ}?revise=1` で、
     `waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/)` は**押す前から合っている**。
     だから押した瞬間に返り、保存を1ミリ秒も待たないまま次の行へ進んでいた
     （CI の実測で 8→9 が 51ms。本当に保存した 7 は約3.6秒かかっている）。
     結果、下の「2枚目を作らない」「1枚のまま」は**何も起きていなくても PASS** する
     恒真になり、中身を見る1件だけが落ちていた——`F-20260825-40` と同じ型。
     保存が終わって開き直したこと＝**`?revise=1` が落ちたこと**を待つ。 */
  const [reopened] = await Promise.all([
    page.waitForURL(
      (u) => /^\/edit\/p\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(u.pathname) && u.search === '',
      { timeout: 30_000 },
    ).then(() => true, () => false),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  check('9. 直す操作が最後まで進んだ（保存されて開き直した）', reopened,
    dialogs.length ? `画面に出た理由="${dialogs[dialogs.length - 1]}"` : `url=${page.url()}`);
  const afterRevise = new URL(page.url()).pathname.split('/').pop();
  /* **2枚目を作っていないこと。** ここが増えると飼い主に2通届く。 */
  check('10. 直しても同じカルテのまま（2枚目を作らない）', afterRevise === reportId,
    `直す前=${reportId} 直した後=${afterRevise}`);

  const reportsNow = await (await fetch(
    `${BASE}/api/pets/${createdPet.id}/reports`, { headers: authHeaders },
  )).json();
  const finals = (reportsNow.reports || []).filter((r) => r.status === 'final');
  check('11. 確定済みのカルテは1枚のまま', finals.length === 1, `${finals.length}枚`);
  check('12. 中身が直っている（確定済みが上書きされた）',
    finals[0] && finals[0].data && finals[0].data.staffNote === FIXED,
    `staffNote="${finals[0] && finals[0].data && finals[0].data.staffNote}"`);

  /* ── ⑤ 削除: カルテ1枚 ── */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const del = await menuTitles(page);
  check('13. 削除に 顧客 / ペット / カルテ の3つが在る',
    del.length === 3
    && del[0].includes('顧客アカウント全データ削除')
    && del[1].includes('ペットアカウント全データ削除')
    && del[2].includes('カルテ1枚単位削除'),
    `出た項目=${JSON.stringify(del)}`);

  await tapByText(page, 'カルテ1枚単位削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, petName);
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, finals[0].report_date);
  await page.waitForSelector('[data-admin-field="confirm-name"]', { timeout: 20_000 });
  /* **名前を打つまで押せない。** 取り返しがつかない操作なので確認を1枚挟んでいる。 */
  const disabledBefore = await page.isDisabled('[data-admin-action="confirm-delete"]');
  check('14. 名前を打つまで削除ボタンは押せない', disabledBefore === true);
  await page.fill('[data-admin-field="confirm-name"]', petName);
  await page.click('[data-admin-action="confirm-delete"]');

  /* **消えるのを待つ。理由を握り潰さない。**
     以前はここで「削除しました」の表示を待ち、待てなくても `.catch(() => {})` で
     素通りして数えていた。**消し終わる前に数えれば「1枚残っている」になる**——
     しかも画面が何と言っていたかは出力に残らないので、落ちた人は原因を追えない
     （`F-20260826-41` と同じ「待っていない検査」の型）。
     カルテ1枚の削除は Storage の片付けを挟むので、他の2つより時間がかかる。
     **サーバに数え直させて 0 になるまで待つ**——0 になれば即座に進む。 */
  const countFinals = async () => {
    const body = await (await fetch(
      `${BASE}/api/pets/${createdPet.id}/reports`, { headers: authHeaders },
    )).json();
    return (body.reports || []).filter((r) => r.status === 'final').length;
  };
  let finalsLeft = await countFinals();
  for (let i = 0; i < 30 && finalsLeft > 0; i += 1) {
    await page.waitForTimeout(1000);
    finalsLeft = await countFinals();
  }
  check('15. カルテ1枚が実際に消えた', finalsLeft === 0,
    finalsLeft === 0 ? '' : `${finalsLeft}枚残っている　画面の表示="${await resultText(page)}"`);

  /* **`18.`（ペット丸ごと削除で写真の実体が消えるか）が測る対象を、ここでもう一度作る。**
     直前の「カルテ1枚単位削除」（15.）が、この犬の唯一の写真を**すでに Storage から
     消している**——`purgePetAssets` がこのあと何を壊されようと、対象が0件のままで
     常に合格してしまう構造欠陥だった（`F-20260828-56` の続き・`pet-purge-broken` が
     CI で2回連続で気づかれなかった原因）。ここで別のカルテを1枚確定させ、
     写真を残したまま「⑤ 削除: ペット全データ」へ進む。 */
  await page.goto(`${BASE}/edit/p/${createdPet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.waitForTimeout(2000);
  await page.locator('[data-field="photo-ear"]').setInputFiles(
    { name: 'ear2.png', mimeType: 'image/png', buffer: solidPng([90, 30, 150]) },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-photo-thumbs="ear"] .photo-pick__thumb').length === 1,
    { timeout: 20_000 },
  ).catch(() => {});
  await page.fill('[data-field="staff-note"]', '2枚目の一言。');
  /* コースは必須（マスター指示 2026-08-29・C-9）。 */
  await page.selectOption('[data-field="course"]', 'トリミングコース');
  /* **本日の体重と一言も入れる**（マスター指示 2026-09-13・放置リスト `#55`）。
     空のままだと確定の手前で「このまま確定しますか？」と一度訊くようにしたため、
     ここを空で通していた台本は止まる。実際の業務でも空で確定することはまず無いので、
     **本物に近い形に直す**（検査を弱めるのではなく、台本を現実に合わせる）。 */
  await page.fill('#input-weight', '4.2');
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);

  /* ── ⑤ 削除: ペット全データ ── */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  await tapByText(page, 'ペットアカウント全データ削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, petName);
  await page.waitForSelector('[data-admin-field="confirm-name"]', { timeout: 20_000 });
  await page.fill('[data-admin-field="confirm-name"]', petName);
  await page.click('[data-admin-action="confirm-delete"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('削除しました'),
    { timeout: 30_000 },
  ).catch(() => {});

  /* **「無いこと」は、空だと必ず真になる。** 以前ここは
     `!(petsLeft.pets || []).some(…)` だった。`petsLeft.pets` が `undefined`
     （API が落ちた・鍵が切れた・形が変わった）でも `|| []` が空配列にし、
     `.some()` は false、`!false` で **PASS** になる——**何も消えていなくても、
     そもそも一覧を引けていなくても緑**（`F-20260825-40` の型・`docs/watch.md` W-1）。
     直したのは2つ:
       1. **一覧が実際に引けたこと**（配列であること）を、同じ条件の中に置く
       2. **サーバに数え直させて消えるまで待つ**——上の待ちは `.catch(() => {})` で
          握り潰しており、待てなくても素通りして数えていた（15 と同じ `F-20260826-41` の型）。
          犬の削除はカルテと Storage の片付けを挟むので、表示より遅れて終わる
     機械: `scripts/guard/empty-pass.mjs` が 1 の形を止める */
  const petsRemaining = async () => {
    const body = await (await fetch(`${BASE}/api/pets`, { headers: authHeaders })).json();
    return Array.isArray(body.pets)
      ? { ok: true, hit: body.pets.some((p) => p.id === createdPet.id), left: body.pets.length }
      : { ok: false, raw: JSON.stringify(body).slice(0, 80) };
  };
  let petsLeft = await petsRemaining();
  for (let i = 0; i < 30 && petsLeft.ok && petsLeft.hit; i += 1) {
    await page.waitForTimeout(1000);
    petsLeft = await petsRemaining();
  }
  check('16. ペットが実際に消えた', petsLeft.ok && !petsLeft.hit,
    petsLeft.ok
      ? (petsLeft.hit ? `まだ居る（残り${petsLeft.left}頭）　画面の表示="${await resultText(page)}"` : '')
      : `一覧が引けなかった: ${petsLeft.raw}`);

  /* ── ⑤ 削除: 顧客全データ ── */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, '削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  await tapByText(page, '顧客アカウント全データ削除');
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, ownerName);
  await page.waitForSelector('[data-admin-field="confirm-name"]', { timeout: 20_000 });
  await page.fill('[data-admin-field="confirm-name"]', ownerName);
  await page.click('[data-admin-action="confirm-delete"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('削除しました'),
    { timeout: 30_000 },
  ).catch(() => {});

  /* 16 と同じ2つ（空で受けて合格にしない／数え直して待つ）。 */
  const ownersRemaining = async () => {
    const body = await (await fetch(`${BASE}/api/owners`, { headers: authHeaders })).json();
    return Array.isArray(body.owners)
      ? { ok: true, hit: body.owners.some((o) => o.id === createdOwner.id), left: body.owners.length }
      : { ok: false, raw: JSON.stringify(body).slice(0, 80) };
  };
  let ownersLeft = await ownersRemaining();
  for (let i = 0; i < 30 && ownersLeft.ok && ownersLeft.hit; i += 1) {
    await page.waitForTimeout(1000);
    ownersLeft = await ownersRemaining();
  }
  check('17. 顧客が実際に消えた', ownersLeft.ok && !ownersLeft.hit,
    ownersLeft.ok
      ? (ownersLeft.hit ? `まだ居る（残り${ownersLeft.left}件）　画面の表示="${await resultText(page)}"` : '')
      : `一覧が引けなかった: ${ownersLeft.raw}`);

  /* **写真の実体まで消えたか。** RLS 越しに見ると、行が消えた時点で「見えない」に
     なるので必ず合格してしまう。`service_role` で数える（`verify:delete` と同じ理由）。
     `apikey` ヘッダが無いと Kong が弾く（`Authorization` だけでは通らない）——それで
     `listed.ok` が常に false になり、下の `listed.ok ? … : []` が「空」を返して
     **何を壊しても常に合格**していた（`F-20260828-56`・16/17 で直したのと同じ
     「空で受けて合格にする」型が、ここにはまだ残っていた）。失敗は握り潰さず投げる。 */
  const listed = await fetch(
    `${LOCAL_SUPABASE_URL}/storage/v1/object/list/report-assets`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: `${FIXTURE.shopId}/${createdPet.id}`, limit: 100 }),
    },
  );
  if (!listed.ok) throw new Error(`storage list failed: ${listed.status} ${await listed.text()}`);
  const objects = await listed.json();
  check('18. 消した犬の写真が Storage に残っていない',
    Array.isArray(objects) && objects.length === 0, `${(objects || []).length}件`);

  /* ── ⑤ スタッフ招待（マスター指示 2026-09-24「招待ボタン復活させて」） ──
     「初回登録QR」（飼い主向け・`verify-invitation.mjs`）と同じ土台
     （`POST /api/invitations`）を使うが、**この画面から呼べること自体**が
     新設なので、ここで見る。**固定 fixture の口座を消化には使わない**
     （`createTestUser` の注記参照）——消化した瞬間その口座が恒久的にスタッフに
     なり、他の `verify:*` の前提を壊すため。 */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });
  await tapByText(page, 'スタッフ招待');
  await page.waitForSelector('[data-admin-action="create-staff-invitation"]', { timeout: 10_000 });
  const explanation = await page.evaluate(() => (document.querySelector('.admin-note') || {}).textContent || '');
  check('18b. スタッフ招待の画面で、招待される側の権限を発行前に伝えている',
    explanation.includes('スタッフ') && explanation.includes('削除・店舗設定・スタッフ招待はできません'), `"${explanation.slice(0, 40)}"`);

  await page.click('[data-admin-action="create-staff-invitation"]');
  /* **失敗しても、ここだけで止めない。** 待たずに投げると外側の try/catch まで
     抜けて残り全部（19〜21含む）が「検査を最後まで実行できた」1件に潰れてしまう
     ——壊れた場所を名指しできなくなる（`F-20260912-85` と同じ型）。18c/18d/18e/18f を
     個別に赤にするため、ここは失敗を飲んで下の check に判定させる。 */
  await page.waitForSelector('[data-admin-action="copy-staff-invitation-url"]', { timeout: 20_000 }).catch(() => {});
  const staffArtifact = await page.evaluate(() => {
    const input = document.querySelector('.admin-result input[type="text"]');
    const img = document.querySelector('.admin-result img');
    return {
      url: input ? input.value : '',
      qrIsImage: img ? (img.getAttribute('src') || '').startsWith('data:image') : false,
    };
  });
  check('18c. 発行すると スタッフ招待URL が出る',
    /\/my\?invite=[0-9a-f]{64}$/.test(staffArtifact.url), staffArtifact.url.slice(0, 60));
  check('18d. QR が画像として出ている', staffArtifact.qrIsImage === true);

  /* **消化するのは、その場限りの新規アカウント**（固定 fixture ではない）。 */
  const newStaffEmail = `new-staff-${Math.random().toString(36).slice(2, 8)}@local.test`;
  await createTestUser(newStaffEmail);
  const newStaffContext = await browser.newContext();
  const newStaffPage = await newStaffContext.newPage();
  await newStaffPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(newStaffPage, newStaffEmail);
  /* **18c が既に赤ならURLが壊れている。** ここで `new URL()` に投げさせず、
     18e/18f もちゃんと個別に赤にする（18c と同じ理由）。 */
  const staffInviteUrl = /^https?:\/\//.test(staffArtifact.url) ? staffArtifact.url : null;
  if (staffInviteUrl) {
    const staffInvitePath = new URL(staffInviteUrl).pathname + new URL(staffInviteUrl).search;
    await newStaffPage.goto(`${BASE}${staffInvitePath}`, { waitUntil: 'domcontentloaded' });
    await newStaffPage.waitForURL((u) => u.pathname === '/edit', { timeout: 20_000 }).catch(() => {});
  }
  check('18e. 招待を消化すると、新しいアカウントがトリマーの作業画面に着く',
    new URL(newStaffPage.url()).pathname === '/edit', `path=${new URL(newStaffPage.url()).pathname}`);

  /* 「押せた」で合格にしない（`D-12`）——アプリ自身が使う判定口 `/api/session`
     で数え直す（`shop_memberships` の直読みは `service_role` でも権限が無く、
     この repo の他の検査もテーブルの直読みはしていない・自前APIで数え直す形に揃える）。 */
  const newStaffSession = await passwordLogin(newStaffEmail);
  const sessionAfterClaim = await (await fetch(`${BASE}/api/session`, {
    headers: { Authorization: `Bearer ${newStaffSession.access_token}` },
  })).json();
  check('18f. その場で shop_memberships に有効な行が実際に作られている',
    Array.isArray(sessionAfterClaim.memberships) && sessionAfterClaim.memberships.length === 1
      && sessionAfterClaim.memberships[0].shop_id === FIXTURE.shopId
      && sessionAfterClaim.memberships[0].active === true,
    JSON.stringify(sessionAfterClaim.memberships));
  await newStaffContext.close();

  /* ── ⑦ 飼い主をここに入れない ──
     ここまでの 1〜18 は**管理者の口座**（`staff@local.test`）で通っている
     （店舗側を管理者とスタッフに分け直した・マスター指示 2026-11-19・`N-49`）。
     スタッフの境目は下の ⑧ で見る。ここは**飼い主をここに入れない**こと。
     ここが緩むと、お客様が他人の顧客データを消せる越境になるので、必ず見る。 */
  const ownerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ownerPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await ownerPage.waitForSelector('[data-admin-action="not-staff"]', { timeout: 20_000 }).catch(() => {});
  const ownerSees = await ownerPage.evaluate(() => ({
    denied: !!document.querySelector('[data-admin-action="not-staff"]'),
    menus: document.querySelectorAll('[data-admin-action="delete"]').length,
    status: (document.querySelector('[data-portal-status]') || {}).textContent || '',
  }));
  check('19. 飼い主は管理画面を使えない（顧客データを消せない）',
    ownerSees.denied === true && ownerSees.menus === 0,
    `denied=${ownerSees.denied} 削除メニュー=${ownerSees.menus}`);
  check('20. 飼い主を行き止まりにせず、愛犬のページへの入口を出している',
    ownerSees.denied === true && ownerSees.status.includes('お店の方だけ'),
    `status="${ownerSees.status.trim()}"`);

  /* ── ⑧ スタッフ権限（管理者ではない）——マスター指示 2026-11-19・`N-49` ──
     スタッフにさせないのは 削除・店舗設定・スタッフ招待 の3つだけ。それ以外
     （顧客と犬の登録・犬の情報を直す）はこれまでどおりできることも、同じ口座で見る。
     **断られたことは状態コードだけで合格にしない**（`D-12`）。断られた後に、
     消そうとした行が、管理者の鍵で数え直しても残っているか・値が変わっていないかを見る。
     対象はこの回にスタッフ自身が作った顧客と犬（fixture を消しかけない）。 */
  const limitedSession = await passwordLogin(FIXTURE.limitedStaffEmail, LOCAL_PASSWORD);
  const limitedHeaders = { Authorization: `Bearer ${limitedSession.access_token}`, 'Content-Type': 'application/json' };
  /* **管理者の鍵で、画面と同じ API から数え直す。** このリポジトリは service_role に
     表を読ませていない（`permission denied for table`・実測）ので、裏から行を数えられない。
     読めなかったら null を返し、検査側で赤にする（空で受けて合格にしない・`F-20260828-56`）。 */
  const adminRead = async (path, pick) => {
    const res = await fetch(`${BASE}${path}`, { headers: authHeaders }).catch(() => null);
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    return body ? pick(body) : null;
  };

  const limitedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const limitedPage = await limitedContext.newPage();
  limitedPage.on('pageerror', (e) => pageErrors.push(`[スタッフ] ${e.message}`));
  limitedPage.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const limitedPath = () => new URL(limitedPage.url()).pathname;

  /* 入口から人と同じ道で入る（`D-27`）——管理者の ① と同じ手順。 */
  await limitedPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(limitedPage, FIXTURE.limitedStaffEmail);
  await limitedPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await limitedPage.waitForURL(/\/edit$/, { timeout: 20_000 }).catch(() => {});
  await limitedPage.waitForSelector('.karte-card', { timeout: 30_000 }).catch(() => {});
  const limitedAdminLink = limitedPage.locator('[data-admin-link]');
  await limitedAdminLink.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (await limitedAdminLink.isVisible().catch(() => false)) await limitedAdminLink.click();
  await limitedPage.waitForURL(/\/admin$/, { timeout: 20_000 }).catch(() => {});
  check('22a. スタッフも入口から「管理」を押して管理画面に着く',
    limitedPath() === '/admin', `path=${limitedPath()}`);

  await limitedPage.waitForSelector('.admin-menu__item', { timeout: 20_000 }).catch(() => {});
  const limitedTop = await menuTitles(limitedPage);
  check('22b. スタッフの管理画面には リピーター / 新規 の2つだけが出る（削除・店舗設定・スタッフ招待が無い）',
    limitedTop.length === 2 && limitedTop[0].includes('リピーター') && limitedTop[1].includes('新規'),
    `出た項目=${JSON.stringify(limitedTop)}`);

  /* 新規: 顧客 → 犬（スタッフにも許したままの操作が、本当に効くか）。 */
  const limitedStamp = Math.random().toString(36).slice(2, 7);
  const limitedOwnerName = `スタッフ登録飼い主${limitedStamp}`;
  const limitedPetName = `スタッフ登録犬${limitedStamp}`;
  const limitedBreed = `スタッフ手入力犬種${limitedStamp}`;
  await tapByText(limitedPage, '新規');
  await limitedPage.waitForSelector('.admin-menu__item', { timeout: 10_000 }).catch(() => {});
  await tapByText(limitedPage, '顧客アカウントの新規作成');
  await limitedPage.waitForSelector('[data-admin-field="owner-name"]', { timeout: 10_000 }).catch(() => {});
  await limitedPage.fill('[data-admin-field="owner-name"]', limitedOwnerName).catch(() => {});
  await limitedPage.click('[data-admin-action="create-owner"]').catch(() => {});
  await limitedPage.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});
  const limitedOwners = await (await fetch(`${BASE}/api/owners`, { headers: limitedHeaders })).json();
  const limitedOwner = (limitedOwners.owners || []).find((o) => o.name === limitedOwnerName);
  check('22c. スタッフも新規で顧客アカウントを作れる（サーバーに在る）', !!limitedOwner,
    limitedOwner ? '' : `name=${limitedOwnerName} 画面の表示="${await resultText(limitedPage)}"`);

  await tapByText(limitedPage, '◀ もどる');
  await limitedPage.waitForSelector('.admin-menu__item', { timeout: 10_000 }).catch(() => {});
  await tapByText(limitedPage, 'ペットアカウントの新規作成');
  await limitedPage.waitForSelector('[data-admin-field="pet-name"]', { timeout: 20_000 }).catch(() => {});
  if (limitedOwner) {
    await limitedPage.selectOption('[data-admin-field="owner-select"]', limitedOwner.id).catch(() => {});
  }
  await limitedPage.fill('[data-admin-field="pet-name"]', limitedPetName).catch(() => {});
  await limitedPage.fill('[data-admin-field="pet-breed"]', limitedBreed).catch(() => {});
  await limitedPage.click('[data-admin-action="create-pet"]').catch(() => {});
  await limitedPage.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});
  const limitedPetOf = async () => {
    const body = await (await fetch(`${BASE}/api/pets`, { headers: limitedHeaders })).json();
    return (body.pets || []).find((p) => p.name === limitedPetName) || null;
  };
  const limitedPet = await limitedPetOf();
  check('22d. スタッフも新規で犬を作れて、打った犬種がそのまま保存される',
    !!limitedPet && limitedPet.breed === limitedBreed,
    limitedPet ? `保存=${JSON.stringify(limitedPet.breed)}` : `作られていない 画面の表示="${await resultText(limitedPage)}"`);

  /* 犬の情報を直す（リピーター）。メニューは押して戻る——住所へ飛ばない（`D-27`）。 */
  await tapByText(limitedPage, '◀ もどる');
  await limitedPage.waitForFunction(
    () => [...document.querySelectorAll('.admin-menu__item strong')].some((el) => el.textContent.includes('ペットアカウント')),
    { timeout: 10_000 },
  ).catch(() => {});
  await tapByText(limitedPage, '◀ もどる');
  await limitedPage.waitForFunction(
    () => [...document.querySelectorAll('.admin-menu__item strong')].some((el) => el.textContent.includes('リピーター')),
    { timeout: 10_000 },
  ).catch(() => {});
  await tapByText(limitedPage, 'リピーター');
  await limitedPage.waitForFunction(
    () => [...document.querySelectorAll('.admin-menu__item strong')].some((el) => el.textContent.includes('犬の情報を直す')),
    { timeout: 10_000 },
  ).catch(() => {});
  await tapByText(limitedPage, '犬の情報を直す');
  await limitedPage.waitForSelector('[data-admin-field="pet-search"]', { timeout: 20_000 }).catch(() => {});
  await limitedPage.fill('[data-admin-field="pet-search"]', limitedPetName).catch(() => {});
  await limitedPage.locator('[data-admin-action="pick-pet"]:not([hidden])').first().click({ timeout: 10_000 }).catch(() => {});
  await limitedPage.waitForSelector('[data-admin-action="save-pet"]', { timeout: 20_000 }).catch(() => {});
  await limitedPage.fill('[data-admin-field="pet-breed"]', 'ミックス').catch(() => {});
  await limitedPage.click('[data-admin-action="save-pet"]').catch(() => {});
  await limitedPage.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('保存しました'),
    { timeout: 20_000 },
  ).catch(() => {});
  const limitedEdited = await limitedPetOf();
  check('22e. スタッフも「犬の情報を直す」で犬種を変えられる（サーバーの値が変わった）',
    !!limitedEdited && limitedEdited.breed === 'ミックス',
    `保存=${JSON.stringify(limitedEdited && limitedEdited.breed)} path=${limitedPath()}`);

  /* ── 画面: 住所を直接開いても、管理者だけの画面の部品は出ない ──
     **断る側の確認なので、ここだけは住所を直接開く**（人の道では押せる入口自体が無い。
     入口が無いことは 22b で見た）。出てよいのは「もどる」と案内だけ。 */
  const ADMIN_ONLY_CONTROLS = [
    '[data-admin-action^="confirm"]', '[data-admin-field="confirm-name"]',
    '[data-admin-action^="delete-"]', '[data-admin-action="pick-owner"]',
    '[data-admin-action="pick-pet"]', '[data-admin-action="pick-report"]',
    '[data-admin-action^="save-shop"]', '[data-admin-action="add-shop-option"]',
    '[data-admin-field="shop-default-revisit-days"]',
    '[data-admin-action="create-staff-invitation"]', '[data-admin-action="copy-staff-invitation-url"]',
  ].join(', ');
  const DENY_NOTE = 'この操作は管理者だけができます';
  /** その住所を開いて、案内・もどる・部品の数を見る。**検査名は呼ぶ側に1本ずつ書く**
      （`proof-of-red.mjs` が名前で台帳と突き合わせるので、名前を組み立てない）。 */
  const deniedScreen = async (deniedPath) => {
    await limitedPage.goto(`${BASE}${deniedPath}`, { waitUntil: 'domcontentloaded' });
    await limitedPage.waitForFunction(
      (needle) => (document.body.textContent || '').includes(needle),
      DENY_NOTE, { timeout: 20_000 },
    ).catch(() => {});
    const seen = await limitedPage.evaluate(({ needle, controls }) => ({
      note: [...document.querySelectorAll('.admin-note')].some((el) => (el.textContent || '').includes(needle)),
      back: [...document.querySelectorAll('.admin-back')].some((el) => (el.textContent || '').includes('◀ もどる')),
      controls: document.querySelectorAll(controls).length,
    }), { needle: DENY_NOTE, controls: ADMIN_ONLY_CONTROLS });
    return {
      ok: seen.note && seen.back && seen.controls === 0,
      why: `案内=${seen.note} もどる=${seen.back} 部品=${seen.controls} path=${limitedPath()}`,
    };
  };
  const deniedDelete = await deniedScreen('/admin/delete');
  check('22f-1. スタッフが /admin/delete を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い',
    deniedDelete.ok, deniedDelete.why);
  const deniedDeleteOwner = await deniedScreen('/admin/delete/owner');
  check('22f-2. スタッフが /admin/delete/owner を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い',
    deniedDeleteOwner.ok, deniedDeleteOwner.why);
  const deniedDeletePet = await deniedScreen('/admin/delete/pet');
  check('22f-3. スタッフが /admin/delete/pet を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い',
    deniedDeletePet.ok, deniedDeletePet.why);
  const deniedDeleteReport = await deniedScreen('/admin/delete/report');
  check('22f-4. スタッフが /admin/delete/report を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い',
    deniedDeleteReport.ok, deniedDeleteReport.why);
  const deniedSettings = await deniedScreen('/admin/settings');
  check('22f-5. スタッフが /admin/settings を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い',
    deniedSettings.ok, deniedSettings.why);
  const deniedInvite = await deniedScreen('/admin/invite-staff');
  check('22f-6. スタッフが /admin/invite-staff を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い',
    deniedInvite.ok, deniedInvite.why);

  /* ── API: 画面を通らずに叩いても、データベースが断る（`N-49`「守るのはデータベース」） ──
     429（回数制限）は「断られた」ではないので、拒否として数えない。 */
  const refused = (status) => status >= 400 && status !== 429;
  /* **fixture の犬を代わりに使わない**——断るはずが通ったとき fixture が壊れ、他の検査を巻き込む。
     作れていなければ下の4本は対象無しとして赤にする。 */
  const limitedPetId = limitedPet ? limitedPet.id : null;
  const limitedOwnerId = limitedOwner ? limitedOwner.id : null;

  /* カルテ削除の対象を、スタッフ自身が1枚作る（下書きの作成はスタッフにも許している）。 */
  const draftRes = limitedPetId ? await fetch(`${BASE}/api/pets/${limitedPetId}/reports`, {
    method: 'POST', headers: limitedHeaders,
    body: JSON.stringify({ petId: limitedPetId, reportDate: new Date().toISOString().slice(0, 10), data: {} }),
  }) : null;
  const draft = draftRes && draftRes.ok ? ((await draftRes.json()).report || null) : null;
  const reportDeleteRes = draft
    ? await fetch(`${BASE}/api/pets/${limitedPetId}/reports/${draft.id}/delete`, { method: 'POST', headers: limitedHeaders })
    : null;
  const reportRows = draft ? await adminRead(`/api/pets/${limitedPetId}/reports`,
    (b) => (b.reports || []).filter((r) => r.id === draft.id).map((r) => ({ id: r.id, status: r.status }))) : null;
  check('22g. スタッフのカルテ削除は断られ、カルテは消えず・削除中にもなっていない',
    !!draft && !!reportDeleteRes && refused(reportDeleteRes.status)
    && Array.isArray(reportRows) && reportRows.length === 1 && reportRows[0].status === 'draft',
    `下書き作成=${draftRes && draftRes.status} 削除=${reportDeleteRes && reportDeleteRes.status} 行=${JSON.stringify(reportRows)}`);

  const deactivateRes = limitedPetId ? await fetch(`${BASE}/api/pets/${limitedPetId}`, {
    method: 'PATCH', headers: limitedHeaders, body: JSON.stringify({ active: false }),
  }) : null;
  const activeRows = limitedPetId ? await adminRead(`/api/pets/${limitedPetId}`,
    (b) => (b.pet ? [{ id: b.pet.id, active: b.pet.active }] : [])) : null;
  check('22h. スタッフが犬を「使わない」にするのは断られ、犬は有効のまま（消す代わりの抜け道を塞ぐ）',
    !!deactivateRes && refused(deactivateRes.status) && Array.isArray(activeRows) && activeRows.length === 1 && activeRows[0].active === true,
    `PATCH=${deactivateRes && deactivateRes.status} 行=${JSON.stringify(activeRows)}`);

  const petDeleteRes = limitedPetId
    ? await fetch(`${BASE}/api/pets/${limitedPetId}`, { method: 'DELETE', headers: limitedHeaders })
    : null;
  const petRows = limitedPetId ? await adminRead('/api/pets',
    (b) => (b.pets || []).filter((pet) => pet.id === limitedPetId)) : null;
  check('22i. スタッフの DELETE /api/pets は断られ、犬は消えていない',
    !!petDeleteRes && refused(petDeleteRes.status) && Array.isArray(petRows) && petRows.length === 1,
    `DELETE=${petDeleteRes && petDeleteRes.status} 行=${JSON.stringify(petRows)}`);

  const ownerDeleteRes = limitedOwnerId
    ? await fetch(`${BASE}/api/owners/${limitedOwnerId}`, { method: 'DELETE', headers: limitedHeaders })
    : null;
  const limitedOwnerRows = limitedOwnerId ? await adminRead('/api/owners',
    (b) => (b.owners || []).filter((owner) => owner.id === limitedOwnerId)) : null;
  check('22j. スタッフの DELETE /api/owners は断られ、顧客は消えていない',
    !!ownerDeleteRes && refused(ownerDeleteRes.status) && Array.isArray(limitedOwnerRows) && limitedOwnerRows.length === 1,
    `DELETE=${ownerDeleteRes && ownerDeleteRes.status} 行=${JSON.stringify(limitedOwnerRows)}`);

  const shopBefore = await adminRead('/api/shop', (b) => (b.shop ? [b.shop] : []));
  const daysBefore = Array.isArray(shopBefore) && shopBefore[0] ? shopBefore[0].default_revisit_days : null;
  const shopPatchRes = await fetch(`${BASE}/api/shop`, {
    method: 'PATCH', headers: limitedHeaders,
    body: JSON.stringify({ defaultRevisitDays: daysBefore === 77 ? 78 : 77 }),
  });
  const shopAfter = await adminRead('/api/shop', (b) => (b.shop ? [b.shop] : []));
  const daysAfter = Array.isArray(shopAfter) && shopAfter[0] ? shopAfter[0].default_revisit_days : null;
  check('22k. スタッフの PATCH /api/shop は断られ、既定の来店間隔は変わっていない',
    refused(shopPatchRes.status) && daysBefore !== null && daysAfter === daysBefore,
    `PATCH=${shopPatchRes.status} 前=${daysBefore} 後=${daysAfter}`);

  /* スタッフ招待: 行が増えていないこと、**管理者が 18c で出した招待が取り消されていない**こと
     （`create_invitation` は先に前の招待を取り消すので、断る位置が後ろだと巻き添えになる）。 */
  const staffInvitations = (b) => (b.invitations || []).filter((i) => i.invitation_type === 'staff');
  const invitesBefore = await adminRead('/api/invitations', staffInvitations);
  const inviteRes = await fetch(`${BASE}/api/invitations`, {
    method: 'POST', headers: limitedHeaders, body: JSON.stringify({ invitationType: 'staff' }),
  });
  const invitesAfter = await adminRead('/api/invitations', staffInvitations);
  const openCount = (rows) => rows.filter((r) => r.revoked_at === null).length;
  check('22l. スタッフのスタッフ招待は断られ、招待は増えず・前の招待も取り消されていない',
    refused(inviteRes.status) && Array.isArray(invitesBefore) && Array.isArray(invitesAfter)
    && invitesAfter.length === invitesBefore.length && openCount(invitesAfter) === openCount(invitesBefore),
    `POST=${inviteRes.status} 件数 ${invitesBefore && invitesBefore.length}→${invitesAfter && invitesAfter.length}`
    + ` 有効 ${invitesBefore && openCount(invitesBefore)}→${invitesAfter && openCount(invitesAfter)}`);

  await limitedContext.close();
  /* 後片付け: スタッフが作った顧客を**管理者の鍵で**消す（犬とカルテは消える側に連なる・
     写真は上げていない）。合否には使わない——消せることは 17 で見ている。 */
  if (limitedOwnerId) {
    await fetch(`${BASE}/api/owners/${limitedOwnerId}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
  }

  /* ── ⑨ スタッフ管理 — 辞めた人の利用を止める・再開する（放置リスト `#76`・レビュー M1） ──
     **⑧ のあとに置く。** ⑧ はスタッフの口座（`limited-staff@local.test`）が有効なことを
     前提にしているので、止めるのはその後。止めた口座は**合否にかかわらず最後に戻す**
     （下の後片付け）——他の verify が同じ口座を使う。
     **「押せた」で合格にしない**（`D-12`）: 止めた人の鍵で、本当に店のデータが取れなく
     なったか・再開で取れるようになったかを API で数え直す。 */
  const LIMITED_ID = FIXTURE.limitedStaffUserId;
  const memberRow = (targetPage, userId) => targetPage.evaluate((id) => {
    const button = document.querySelector(`[data-admin-action="member-toggle"][data-admin-user="${id}"]`);
    const row = button ? button.closest('.admin-field') : null;
    return row ? { text: (row.textContent || '').trim(), button: (button.textContent || '').trim() } : null;
  }, userId);
  const waitRowText = (needle) => page.waitForFunction(({ id, text }) => {
    const button = document.querySelector(`[data-admin-action="member-toggle"][data-admin-user="${id}"]`);
    const row = button ? button.closest('.admin-field') : null;
    return !!row && (row.textContent || '').includes(text);
  }, { id: LIMITED_ID, text: needle }, { timeout: 20_000 }).catch(() => {});
  /** その人の鍵で、店の犬が取れるか。断られたら count は null、取れたら件数。 */
  const limitedPetCount = async () => {
    const res = await fetch(`${BASE}/api/pets`, { headers: limitedHeaders }).catch(() => null);
    if (!res || !res.ok) return { status: res ? res.status : 0, count: null };
    const body = await res.json().catch(() => ({}));
    return { status: res.status, count: Array.isArray(body.pets) ? body.pets.length : null };
  };
  const petsBeforeStop = await limitedPetCount();
  /* 後片付けの予約: 止めた口座は、**途中で落ちても**最後（finally）に必ず有効へ戻す
     （合否には使わない——戻ることは 23e で見ている）。他の verify と次の回が同じ口座を使う。 */
  restoreLimitedStaff = () => fetch(`${BASE}/api/staff/${LIMITED_ID}/active`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ active: true }),
  });

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 }).catch(() => {});
  await tapByText(page, 'スタッフ管理');
  await page.waitForSelector('[data-admin-action="member-toggle"]', { timeout: 20_000 }).catch(() => {});
  const listedRow = await memberRow(page, LIMITED_ID);
  check('23a. 管理者が ⑥ スタッフ管理 を押して開くと、limited-staff@local.test が「スタッフ・利用中」で出る',
    pathNow() === '/admin/staff' && !!listedRow && listedRow.text.includes(FIXTURE.limitedStaffEmail)
    && listedRow.text.includes('スタッフ・利用中') && listedRow.button === '利用を止める',
    `path=${pathNow()} 行=${JSON.stringify(listedRow)}`);

  const ownRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.admin-menu .admin-field')]
      .filter((row) => [...row.querySelectorAll('span')].some((span) => span.textContent.trim() === 'あなた'));
    return rows.map((row) => ({ text: (row.textContent || '').trim(), buttons: row.querySelectorAll('button').length }));
  });
  check('23b. 管理者自身の行は「あなた」と出て、止めるボタンが無い',
    ownRow.length === 1 && ownRow[0].text.includes(FIXTURE.staffEmail) && ownRow[0].buttons === 0,
    `自分の行=${JSON.stringify(ownRow)}`);

  await page.click(`[data-admin-action="member-toggle"][data-admin-user="${LIMITED_ID}"]`, { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-admin-action="confirm-member-stop"]', { timeout: 10_000 }).catch(() => {});
  const confirmShown = await page.evaluate(() => ({
    detail: (document.querySelector('[data-admin-field="confirm-detail"]') || {}).textContent || '',
    button: !!document.querySelector('[data-admin-action="confirm-member-stop"]'),
  }));
  await page.click('[data-admin-action="confirm-member-stop"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(
    () => [...document.querySelectorAll('.admin-result')].some((el) => el.textContent.includes('利用を止めました')),
    { timeout: 20_000 },
  ).catch(() => {});
  await waitRowText('停止中');
  const stoppedRow = await memberRow(page, LIMITED_ID);
  check('23c. 「利用を止める」は確認の画面でもう1回押すと効き、一覧で「停止中」・「再開する」に変わる',
    confirmShown.button && confirmShown.detail.includes(FIXTURE.limitedStaffEmail)
    && !!stoppedRow && stoppedRow.text.includes('停止中') && stoppedRow.button === '再開する',
    `確認=${JSON.stringify(confirmShown)} 行=${JSON.stringify(stoppedRow)}`);

  const petsWhileStopped = await limitedPetCount();
  const sessionWhileStopped = await fetch(`${BASE}/api/session`, { headers: limitedHeaders })
    .then((res) => res.json()).catch(() => null);
  check('23d. 止めた人の鍵では /api/pets が断られるか店の犬が1件も返らず、お店の人として扱われない',
    petsBeforeStop.count > 0
    && (petsWhileStopped.count === null || petsWhileStopped.count === 0)
    && !!sessionWhileStopped && Array.isArray(sessionWhileStopped.memberships)
    && sessionWhileStopped.memberships.length === 0,
    `止める前=${JSON.stringify(petsBeforeStop)} 止めた後=${JSON.stringify(petsWhileStopped)}`
    + ` メンバー=${JSON.stringify(sessionWhileStopped && sessionWhileStopped.memberships)}`);

  await page.click(`[data-admin-action="member-toggle"][data-admin-user="${LIMITED_ID}"]`, { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(
    () => [...document.querySelectorAll('.admin-result')].some((el) => el.textContent.includes('再開しました')),
    { timeout: 20_000 },
  ).catch(() => {});
  await waitRowText('利用中');
  const resumedRow = await memberRow(page, LIMITED_ID);
  const petsAfterResume = await limitedPetCount();
  check('23e. 「再開する」を押すと「利用中」に戻り、その人の鍵で店の犬が再び取れる',
    !!resumedRow && resumedRow.text.includes('利用中') && resumedRow.button === '利用を止める'
    && petsAfterResume.count === petsBeforeStop.count && petsAfterResume.count > 0,
    `行=${JSON.stringify(resumedRow)} 再開後=${JSON.stringify(petsAfterResume)}`);

  /* 管理者は自分を止められない——画面にボタンが無いだけでなく、API でも DB が断る。 */
  const adminSession = await fetch(`${BASE}/api/session`, { headers: authHeaders }).then((res) => res.json()).catch(() => null);
  const adminId = adminSession && adminSession.user ? adminSession.user.id : null;
  const selfStopRes = adminId ? await fetch(`${BASE}/api/staff/${adminId}/active`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ active: false }),
  }) : null;
  const adminAfter = await fetch(`${BASE}/api/session`, { headers: authHeaders }).then((res) => res.json()).catch(() => null);
  check('23f. 管理者が API で自分を止めようとしても断られ、管理者のまま使える',
    !!selfStopRes && refused(selfStopRes.status)
    && !!adminAfter && (adminAfter.memberships || []).some((m) => m.active && m.role === 'admin'),
    `POST=${selfStopRes && selfStopRes.status} メンバー=${JSON.stringify(adminAfter && adminAfter.memberships)}`);

  /* スタッフには ⑥ が出ない・住所を直に開いても部品が出ない・API も断られる。
     入口から人と同じ道で入る（`D-27`）。断る画面だけは ⑧ の `22f-*` と同じく住所を直に開く。 */
  const staffMgmtContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staffMgmtPage = await staffMgmtContext.newPage();
  staffMgmtPage.on('pageerror', (e) => pageErrors.push(`[スタッフ・⑨] ${e.message}`));
  await staffMgmtPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(staffMgmtPage, FIXTURE.limitedStaffEmail);
  await staffMgmtPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await staffMgmtPage.waitForURL(/\/edit$/, { timeout: 20_000 }).catch(() => {});
  await staffMgmtPage.waitForSelector('.karte-card', { timeout: 30_000 }).catch(() => {});
  const staffMgmtLink = staffMgmtPage.locator('[data-admin-link]');
  await staffMgmtLink.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (await staffMgmtLink.isVisible().catch(() => false)) await staffMgmtLink.click();
  await staffMgmtPage.waitForSelector('.admin-menu__item', { timeout: 20_000 }).catch(() => {});
  const staffMgmtTop = await menuTitles(staffMgmtPage);
  await staffMgmtPage.goto(`${BASE}/admin/staff`, { waitUntil: 'domcontentloaded' });
  await staffMgmtPage.waitForFunction(
    (needle) => (document.body.textContent || '').includes(needle),
    DENY_NOTE, { timeout: 20_000 },
  ).catch(() => {});
  const staffMgmtDenied = await staffMgmtPage.evaluate((needle) => ({
    note: [...document.querySelectorAll('.admin-note')].some((el) => (el.textContent || '').includes(needle)),
    back: [...document.querySelectorAll('.admin-back')].some((el) => (el.textContent || '').includes('◀ もどる')),
    controls: document.querySelectorAll('[data-admin-action="member-toggle"], [data-admin-action="confirm-member-stop"]').length,
  }), DENY_NOTE);
  check('23g. スタッフには ⑥ スタッフ管理 が出ず、/admin/staff を開くと「管理者だけ」の案内ともどるだけが出る',
    staffMgmtTop.length === 2 && !staffMgmtTop.some((title) => title.includes('スタッフ管理'))
    && staffMgmtDenied.note && staffMgmtDenied.back && staffMgmtDenied.controls === 0,
    `メニュー=${JSON.stringify(staffMgmtTop)} 案内=${staffMgmtDenied.note} もどる=${staffMgmtDenied.back} 部品=${staffMgmtDenied.controls}`);
  await staffMgmtContext.close();

  /* **対象は管理者**（スタッフが管理者を止められたら店ごと乗っ取れる）。管理者の id が
     取れていなければ赤にする——別の相手に置き換えて合格にしない。 */
  const staffListRes = await fetch(`${BASE}/api/staff`, { headers: limitedHeaders });
  const staffStopRes = adminId ? await fetch(`${BASE}/api/staff/${adminId}/active`, {
    method: 'POST', headers: limitedHeaders, body: JSON.stringify({ active: false }),
  }) : null;
  const adminStill = await fetch(`${BASE}/api/session`, { headers: authHeaders }).then((res) => res.json()).catch(() => null);
  check('23h. スタッフの GET /api/staff と、管理者を止める POST は断られ、管理者は止まっていない',
    refused(staffListRes.status) && !!staffStopRes && refused(staffStopRes.status)
    && !!adminStill && (adminStill.memberships || []).some((m) => m.active && m.role === 'admin'),
    `GET=${staffListRes.status} POST=${staffStopRes && staffStopRes.status} 管理者=${JSON.stringify(adminStill && adminStill.memberships)}`);

  check('21. アプリ由来のエラーが無い', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (restoreLimitedStaff) await restoreLimitedStaff().catch(() => {});
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('管理者の動線（リピーター/新規/削除）と、削除3種・カルテ修正が実際に効くか。\n');
process.exit(passed === results.length ? 0 : 1);

/**
 * verify-admin.mjs — 管理者画面（マスター指示 2026-08-26）
 *
 * 見るもの:
 *   ① 管理者は Google 認証すると**毎回**管理者画面に入る
 *   ② 管理者ページに ①リピーター ②新規 ③削除 が在る
 *   ③ リピーター → カルテ作成 / カルテ修正
 *   ④ 新規 → 顧客アカウント作成・ペットアカウント作成が**実際に効く**
 *   ⑤ 削除3種が**実際に消す**（写真の実体まで。`service_role` で数える）
 *   ⑥ カルテ修正が**確定済みを上書きする**（2枚目を作らない・飼い主に届く中身が変わる）
 *   ⑦ 管理者でない人はこの画面を使えず、かつ行き止まりにならない
 *
 * **「押せた」で合格にしない**（`D-12`）。作った/消した/直したものを、
 * 作用の出た先（一覧・Storage の実体・飼い主の画面）で数え直す。
 *
 *   npm run verify:admin
 */

import zlib from 'node:zlib';
import {
  startLocalWorker, injectSession, passwordLogin, localServiceRoleKey,
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
  const staffSession = await passwordLogin(FIXTURE.adminEmail, LOCAL_PASSWORD);
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

  /* ── ① 管理者は毎回この画面に入る ── */
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(page, FIXTURE.adminEmail);
  await page.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/admin$/, { timeout: 20_000 }).catch(() => {});
  check('1. 管理者が /my を開くと管理者画面へ送られる',
    new URL(page.url()).pathname === '/admin', `path=${new URL(page.url()).pathname}`);

  await page.waitForSelector('.admin-menu__item', { timeout: 20_000 });

  /* ── ② 管理者ページの3つ ── */
  const top = await menuTitles(page);
  check('2. 管理者ページに リピーター / 新規 / 削除 が在る',
    top.length === 3
    && top[0].includes('リピーター') && top[1].includes('新規') && top[2].includes('削除'),
    `出た項目=${JSON.stringify(top)}`);

  /* ── ③ リピーター ── */
  await tapByText(page, 'リピーター');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });
  const repeat = await menuTitles(page);
  check('3. リピーターに カルテ作成 / カルテ修正 が在る',
    repeat.length === 2 && repeat[0].includes('カルテ作成') && repeat[1].includes('カルテ修正'),
    `出た項目=${JSON.stringify(repeat)}`);
  await tapByText(page, '◀ もどる');
  await page.waitForSelector('.admin-menu__item', { timeout: 10_000 });

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
  await page.click('[data-admin-action="create-pet"]');
  await page.waitForFunction(
    () => (document.querySelector('.admin-result') || {}).textContent?.includes('登録しました'),
    { timeout: 20_000 },
  ).catch(() => {});

  const petsAfter = await (await fetch(`${BASE}/api/pets`, { headers: authHeaders })).json();
  const createdPet = (petsAfter.pets || []).find((p) => p.name === petName);
  check('6. ペットアカウントが実際に作られた', !!createdPet, `name=${petName}`);
  if (!createdPet) throw new Error('犬が作られていないので先へ進めない');

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

  /* ── ⑦ 管理者でない人 ── */
  const staffPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staffPage.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(staffPage, FIXTURE.staffEmail);
  await staffPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await staffPage.waitForSelector('[data-admin-action="not-admin"]', { timeout: 20_000 }).catch(() => {});
  const staffSees = await staffPage.evaluate(() => ({
    denied: !!document.querySelector('[data-admin-action="not-admin"]'),
    menus: document.querySelectorAll('[data-admin-action="delete"]').length,
    status: (document.querySelector('[data-portal-status]') || {}).textContent || '',
  }));
  check('19. 管理者でないスタッフに管理者の操作を出していない',
    staffSees.denied === true && staffSees.menus === 0,
    `denied=${staffSees.denied} 削除メニュー=${staffSees.menus}`);
  check('20. 行き止まりにせず、その人が使える画面への入口を出している',
    staffSees.denied === true && staffSees.status.includes('管理者のアカウントではありません'),
    `status="${staffSees.status.trim()}"`);

  check('21. アプリ由来のエラーが無い', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('管理者の動線（リピーター/新規/削除）と、削除3種・カルテ修正が実際に効くか。\n');
process.exit(passed === results.length ? 0 : 1);

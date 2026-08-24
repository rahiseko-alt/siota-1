/**
 * verify-delete.mjs — 削除したら写真も本当に消えること（Supabaseモード）
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:delete
 *
 * EXIT 0 = 消える / EXIT 1 = 残る
 *
 * **なぜこの検査が要るか**
 *   Storage のポリシー `private.storage_path_staff` は「その `reports` 行が存在すること」を
 *   条件にしている。ところが犬や飼い主の削除は FK カスケード（pets → reports →
 *   report_assets）でその行を先に消してしまうため、**写真は Storage に残るのに、
 *   その瞬間から誰も列挙も削除もできなくなる**（D-20260824-30 の 3）。
 *   スタッフからも飼い主からも見えないので、画面上は「消えた」ように見える。
 *   回収は service_role でしか出来ず、どれが孤児かを示す `report_assets.storage_path` も
 *   一緒に消えている。「削除したのに残る」は個人情報の扱いとして通らない。
 *
 *   **だからこの検査は RLS 越しに見てはいけない。** 削除後は「残っていても見えない」ので、
 *   RLS 越しの確認は必ず合格してしまう。service_role で実体を数える。
 */

import { chromium } from 'playwright';
import {
  startLocalWorker, openStaffPage, localServiceRoleKey,
  FIXTURE, LOCAL_SUPABASE_URL,
} from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;
const BUCKET = 'report-assets';
/* 8x8 の PNG。verify-m6 / verify-roundtrip と同じもの。 */
const PNG_8X8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVQoz2P8//8/AzUBEwOVwaiBowaOGjgsDAQAtcMD8YJ0iVUAAAAASUVORK5CYII=',
  'base64',
);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const SRKEY = await localServiceRoleKey();

/** service_role で prefix 配下の実オブジェクトを数える（RLS を無視して実体を見る）。 */
async function countObjects(prefix) {
  const res = await fetch(`${LOCAL_SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: SRKEY, Authorization: `Bearer ${SRKEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`storage list ${res.status} ${await res.text()}`);
  const rows = await res.json();
  let total = 0;
  for (const row of rows) {
    /* id が null のものは擬似フォルダ。1段だけ潜って実体を数える。 */
    if (row?.id === null) total += await countObjects(`${prefix}/${row.name}`);
    else if (row?.name) total += 1;
  }
  return total;
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8792) });
let browser;
try {
  const stamp = Date.now().toString(36).slice(-5);
  const PET_NAME = `削除の犬${stamp}`;
  const OWNER_NAME = `削除${stamp}`;

  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
  staff.on('dialog', async (d) => { await d.accept(); });

  // ── 犬を作り、写真つきのカルテを1件公開する ──
  await openStaffPage(staff, BASE, '/edit', FIXTURE.staffEmail);
  await staff.waitForSelector('.owner-pet-item, .ponchi-new-karte-form', { timeout: 20000 });
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=0', PET_NAME);
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=1', OWNER_NAME);
  await Promise.all([
    staff.waitForURL(/\/edit\/p\//, { timeout: 20000 }),
    staff.click('.ponchi-new-karte-form .ponchi-add-btn'),
  ]);
  const petId = staff.url().match(/\/edit\/p\/([0-9a-f-]{36})/)?.[1];
  check('検査用の犬を作れる', !!petId, `petId=${petId}`);

  await staff.waitForSelector('.archive-new-btn', { timeout: 20000 });
  await staff.click('.archive-new-btn');
  await staff.waitForSelector('#heroDateInput', { timeout: 20000 });
  /* 写真を1枚入れる。隠しファイル入力は写真スロットのクリックで開く。 */
  /* 直接 click すると、確定バーなどに重なった瞬間に届かず 30秒で TimeoutError になる
     （実際に2回踏んだ）。verify-m6 と同じく、先に視界へ入れてから押す。 */
  await staff.evaluate(() => document.querySelector('img[data-photo="hero-1"]')?.scrollIntoView({ block: 'center' }));
  await staff.waitForTimeout(300);
  await staff.click('img[data-photo="hero-1"]');
  await staff.setInputFiles('input[type="file"]', {
    name: 'hero.png', mimeType: 'image/png', buffer: PNG_8X8,
  });
  await staff.waitForFunction(
    () => document.querySelector('img[data-photo="hero-1"]')?.getAttribute('data-empty') === null,
    { timeout: 15000 },
  );
  await staff.click('#ponchi-commit-ok');
  await staff.waitForSelector('.ponchi-btn-pub', { timeout: 15000 });
  await staff.click('.ponchi-btn-pub');
  await staff.waitForSelector('#screen-magazine .magazine-container', { timeout: 20000 });
  await staff.click('#screen-magazine .ponchi-btn-pub');
  await staff.waitForSelector('.ponchi-publish-notice', { timeout: 40000 });

  /* shop_id は犬の情報から取る（画面のセッションで叩ける）。 */
  const petShopId = await staff.evaluate(async (id) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    const r = await fetch(`/api/pets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await r.json())?.pet?.shop_id || '';
  }, petId);
  check('店舗IDを取得できる', !!petShopId, petShopId);

  const prefix = `${petShopId}/${petId}`;
  const before = await countObjects(prefix);
  check('公開後、写真が Storage に実在する', before > 0, `${before}件`);

  // ── 犬を削除する（画面のゴミ箱ボタンから）──
  await staff.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
  await staff.waitForSelector('.owner-pet-item', { timeout: 20000 });
  const row = staff.locator('.owner-pet-row', { hasText: PET_NAME }).first();
  const delBtn = row.locator('.owner-pet-del');
  check('犬の行に削除ボタンが在る', await delBtn.count() > 0);
  await Promise.all([
    staff.waitForLoadState('load'),
    delBtn.click(),
  ]);
  await staff.waitForTimeout(3000);

  const gone = await staff.evaluate((n) => ![...document.querySelectorAll('.owner-pet-item')]
    .some((e) => e.textContent.includes(n)), PET_NAME);
  check('犬が一覧から消える', gone);

  // ── 本題: 実体としても消えていること（RLS 越しではなく service_role で見る）──
  const after = await countObjects(prefix);
  check('削除後、写真が Storage に1件も残っていない', after === 0, `${after}件 残っている`);

  // ── 飼い主ごと削除する経路も同じであること ──
  const OWNER2 = `削除飼主${stamp}`;
  const PET2 = `削除の犬2${stamp}`;
  await staff.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
  await staff.waitForSelector('.ponchi-new-karte-form', { timeout: 20000 });
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=0', PET2);
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=1', OWNER2);
  await Promise.all([
    staff.waitForURL(/\/edit\/p\//, { timeout: 20000 }),
    staff.click('.ponchi-new-karte-form .ponchi-add-btn'),
  ]);
  const petId2 = staff.url().match(/\/edit\/p\/([0-9a-f-]{36})/)?.[1];
  await staff.waitForSelector('.archive-new-btn', { timeout: 20000 });
  await staff.click('.archive-new-btn');
  await staff.waitForSelector('#heroDateInput', { timeout: 20000 });
  /* 直接 click すると、確定バーなどに重なった瞬間に届かず 30秒で TimeoutError になる
     （実際に2回踏んだ）。verify-m6 と同じく、先に視界へ入れてから押す。 */
  await staff.evaluate(() => document.querySelector('img[data-photo="hero-1"]')?.scrollIntoView({ block: 'center' }));
  await staff.waitForTimeout(300);
  await staff.click('img[data-photo="hero-1"]');
  await staff.setInputFiles('input[type="file"]', {
    name: 'hero.png', mimeType: 'image/png', buffer: PNG_8X8,
  });
  await staff.waitForFunction(
    () => document.querySelector('img[data-photo="hero-1"]')?.getAttribute('data-empty') === null,
    { timeout: 15000 },
  );
  await staff.click('#ponchi-commit-ok');
  await staff.waitForSelector('.ponchi-btn-pub', { timeout: 15000 });
  await staff.click('.ponchi-btn-pub');
  await staff.waitForSelector('#screen-magazine .magazine-container', { timeout: 20000 });
  await staff.click('#screen-magazine .ponchi-btn-pub');
  await staff.waitForSelector('.ponchi-publish-notice', { timeout: 40000 });

  const ownerId2 = await staff.evaluate(async (id) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    const r = await fetch(`/api/pets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await r.json())?.pet?.owner_id || '';
  }, petId2);
  const prefix2 = `${petShopId}/${petId2}`;
  const before2 = await countObjects(prefix2);
  check('2頭目も写真が Storage に実在する', before2 > 0, `${before2}件`);

  /* 飼い主の削除は「飼い主一覧」画面（/edit/o/... ではなく古い一覧経路）からしか
     押せないので、UI の関数を直接呼ぶのではなく、purgeOwnerAssets → DELETE の順序が
     画面と同じであることを、同じ公開APIを使って確かめる。 */
  await staff.evaluate(async (oid) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    const api = (path, options) => fetch(path, {
      ...options,
      headers: { ...(options?.headers || {}), Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    await window.TrimmerSupabaseStorage.purgeOwnerAssets({
      client: window.TrimmerAuth.client, api, ownerId: oid,
    });
    await fetch(`/api/owners/${oid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  }, ownerId2);
  await staff.waitForTimeout(1500);
  const after2 = await countObjects(prefix2);
  check('飼い主ごと削除しても写真が残らない', after2 === 0, `${after2}件 残っている`);

  // ── 途中で止まった削除から復帰できること（D-20260824-30 の 10）──
  const PET3 = `途中で止まる犬${stamp}`;
  await staff.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
  await staff.waitForSelector('.ponchi-new-karte-form', { timeout: 20000 });
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=0', PET3);
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=1', `途中${stamp}`);
  await Promise.all([
    staff.waitForURL(/\/edit\/p\//, { timeout: 20000 }),
    staff.click('.ponchi-new-karte-form .ponchi-add-btn'),
  ]);
  const petId3 = staff.url().match(/\/edit\/p\/([0-9a-f-]{36})/)?.[1];
  await staff.waitForSelector('.archive-new-btn', { timeout: 20000 });
  await staff.click('.archive-new-btn');
  await staff.waitForSelector('#heroDateInput', { timeout: 20000 });
  /* 直接 click すると、確定バーなどに重なった瞬間に届かず 30秒で TimeoutError になる
     （実際に2回踏んだ）。verify-m6 と同じく、先に視界へ入れてから押す。 */
  await staff.evaluate(() => document.querySelector('img[data-photo="hero-1"]')?.scrollIntoView({ block: 'center' }));
  await staff.waitForTimeout(300);
  await staff.click('img[data-photo="hero-1"]');
  await staff.setInputFiles('input[type="file"]', {
    name: 'hero.png', mimeType: 'image/png', buffer: PNG_8X8,
  });
  await staff.waitForFunction(
    () => document.querySelector('img[data-photo="hero-1"]')?.getAttribute('data-empty') === null,
    { timeout: 15000 },
  );
  await staff.click('#ponchi-commit-ok');
  await staff.waitForSelector('.ponchi-btn-pub', { timeout: 15000 });
  await staff.click('.ponchi-btn-pub');
  await staff.waitForSelector('#screen-magazine .magazine-container', { timeout: 20000 });
  await staff.click('#screen-magazine .ponchi-btn-pub');
  await staff.waitForSelector('.ponchi-publish-notice', { timeout: 40000 });
  const reportUrl3 = await staff.evaluate(() => document.querySelector('.ponchi-pub-link')?.getAttribute('href') || '');
  const reportId3 = reportUrl3.match(/\/reports\/([0-9a-f-]{36})/)?.[1];

  /* 削除の1段目だけを踏んで、写真を消さずに中断した状態を作る。 */
  const marked = await staff.evaluate(async ([pid, rid]) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    const r = await fetch(`/api/pets/${pid}/reports/${rid}/delete`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    return r.status;
  }, [petId3, reportId3]);
  check('削除の1段目だけ踏んで中断できる（検査の前提）', marked === 200, `status=${marked}`);
  const prefix3 = `${petShopId}/${petId3}`;
  check('中断中: 写真はまだ Storage に残っている', await countObjects(prefix3) > 0);

  await staff.goto(`${BASE}/edit/p/${petId3}`, { waitUntil: 'domcontentloaded' });
  await staff.waitForSelector('.archive-list', { timeout: 25000 });
  await staff.waitForTimeout(1500);
  const stuck = await staff.evaluate(() => {
    const el = document.querySelector('.archive-stuck');
    return { shown: !!el, text: el?.textContent || '', retry: !!el?.querySelector('.archive-stuck-retry') };
  });
  check('中断したカルテが一覧に出る（消えたまま放置されない）', stuck.shown, stuck.text.slice(0, 40));
  check('やり直す導線が出ている', stuck.retry);

  if (stuck.retry) {
    await Promise.all([
      staff.waitForLoadState('load'),
      staff.click('.archive-stuck-retry'),
    ]);
    await staff.waitForTimeout(3000);
    check('やり直しで写真が消える', await countObjects(prefix3) === 0);
    const stuckGone = await staff.evaluate(() => !document.querySelector('.archive-stuck'));
    check('やり直し後は一覧から消える', stuckGone);
  }
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 削除: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\n削除したはずの写真が Storage に残る。しかも誰からも触れない。\n');
}
process.exit(failed.length ? 1 : 0);

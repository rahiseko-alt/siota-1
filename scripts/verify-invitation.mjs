/**
 * verify-invitation.mjs — 新規のお客様が自分のカルテを見られるようになるまで（Supabaseモード）
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:invitation
 *
 * EXIT 0 = 新規客が自分のカルテを見られる / EXIT 1 = 見られない
 *
 * **なぜこの検査が要るか**
 *   カルテを作っただけでは、飼い主は自分のカルテを見られない。飼い主側の RLS
 *   （`pets_customer_select` → `private.is_owner_user`）は `owner_users` を経由してしか
 *   通らず、`owner_users` に行を入れられるのは `claim_invitation`（招待の消化）だけである。
 *   つまり**招待フローは飾りではなく、新規のお客様を迎えるたびに必ず通る必須経路**。
 *
 *   にもかかわらず、この経路は長らく一度も検証されていなかった。さらに悪いことに、
 *   F2 で「飼い主を選ぶ層」を撤去したとき、QR発行ボタンが乗っていた画面ごと動線から
 *   外れ、**本番で招待を発行する手段が消えていた**（D-20260823-05 は「残す」と決めて
 *   いたのに）。既存の verify 5本は、この穴を踏まないよう fixture の
 *   `owner-a`（seed.sql で最初から `owner_users` 済み）を使って書かれていたため、
 *   誰も気づかないままだった。
 *
 *   この検査は「実店舗に新しいお客様が来た」ところから始める。fixture の飼い主は使わない。
 */

import { chromium } from 'playwright';
import {
  startLocalWorker, passwordLogin, injectSession, openStaffPage,
  FIXTURE, LOCAL_PASSWORD, LOCAL_SUPABASE_URL, LOCAL_ANON_KEY,
} from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

/** 招待を消化する側の「まだ何にも紐付いていない」お客様。seed の owner-a/b は使わない。 */
const NEW_CUSTOMER = FIXTURE.uninvitedEmail;

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8787) });
let browser;
try {
  const stamp = Date.now().toString(36).slice(-5);
  const PET_NAME = `新規客の犬${stamp}`;
  const OWNER_NAME = `新規客${stamp}`;

  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

  // ── トリマー: /edit で新しいお客様の犬を登録する（画面のフォームから）──
  const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openStaffPage(staff, BASE, '/edit', FIXTURE.staffEmail);
  await staff.waitForSelector('.owner-pet-item, .ponchi-new-karte-form', { timeout: 20000 });
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=0', PET_NAME);
  await staff.fill('.ponchi-new-karte-form .ponchi-inline-input >> nth=1', OWNER_NAME);
  await Promise.all([
    staff.waitForURL(/\/edit\/p\//, { timeout: 20000 }),
    staff.click('.ponchi-new-karte-form .ponchi-add-btn'),
  ]);
  const petId = staff.url().match(/\/edit\/p\/([0-9a-f-]{36})/)?.[1];
  check('新しいお客様の犬を画面から登録できる', !!petId, `petId=${petId}`);

  // ── トリマー: その犬のカルテを1件書いて公開する ──
  await staff.waitForSelector('.archive-new-btn', { timeout: 20000 });
  await staff.click('.archive-new-btn');
  await staff.waitForSelector('#heroDateInput', { timeout: 20000 });
  const NOTE = `新規客への初回カルテ ${stamp}`;
  await staff.evaluate((note) => {
    const el = document.querySelector('[data-field="staff-note"]');
    if (el) { el.textContent = note; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, NOTE);
  await staff.click('#ponchi-commit-ok');
  await staff.waitForSelector('.ponchi-btn-pub', { timeout: 15000 });
  await staff.click('.ponchi-btn-pub');
  await staff.waitForSelector('#screen-magazine .magazine-container', { timeout: 20000 });
  await staff.click('#screen-magazine .ponchi-btn-pub');
  await staff.waitForSelector('.ponchi-publish-notice', { timeout: 40000 });
  const reportUrl = await staff.evaluate(() => document.querySelector('.ponchi-pub-link')?.getAttribute('href') || '');
  check('その犬のカルテを公開できる', /\/my\/pets\/.+\/reports\/.+/.test(reportUrl), reportUrl);

  // ── ここが本題: 招待前は、まだ誰もこのカルテを見られない ──
  const before = await browser.newContext();
  const beforePage = await before.newPage();
  await beforePage.goto(`${BASE}${reportUrl}`);
  await injectSession(beforePage, NEW_CUSTOMER);
  await beforePage.reload();
  await beforePage.waitForTimeout(2500);
  const seenBefore = await beforePage.evaluate((n) => document.body.textContent.includes(n), NOTE);
  check('招待前: お客様はまだ自分のカルテを見られない（RLSが効いている）', !seenBefore);
  await before.close();

  // ── トリマー: 犬の一覧に戻り、その行から初回登録QRを発行する ──
  await staff.goto(`${BASE}/edit`);
  await staff.waitForSelector('.owner-pet-item', { timeout: 20000 });
  const row = staff.locator('.owner-pet-row', { hasText: PET_NAME }).first();
  const inviteBtn = row.locator('.owner-pet-invite');
  const hasInviteBtn = await inviteBtn.count() > 0;
  check('犬の一覧の行から初回登録QRを発行できる（ボタンが在る）', hasInviteBtn);
  if (!hasInviteBtn) throw new Error('招待発行ボタンが画面に無い。新規のお客様を紐付ける手段が存在しない');

  await inviteBtn.click();
  await staff.waitForSelector('dialog[open]', { timeout: 20000 });
  /* URL は readonly の <input> の value に入っている（textContent には出ない）。 */
  const inviteUrl = await staff.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    if (!dlg) return '';
    const input = [...dlg.querySelectorAll('input')].find((el) => (el.value || '').includes('invite='));
    return input ? input.value : '';
  });
  check('招待URLが発行される（64桁のトークンつき）', /\/my\?invite=[0-9a-f]{64}$/i.test(inviteUrl), inviteUrl.replace(/invite=[0-9a-f]+/, 'invite=***'));
  const qrShown = await staff.evaluate(() => !!document.querySelector('dialog[open] img[src^="data:image"]'));
  check('QRコードが画像として表示される', qrShown);

  // ── お客様: 招待URLを開いてログインし、紐付けが済むこと ──
  const after = await browser.newContext();
  const customer = await after.newPage();
  const inviteePath = inviteUrl.replace(/^https?:\/\/[^/]+/, '');
  await customer.goto(`${BASE}${inviteePath}`);
  await customer.waitForTimeout(1500);
  const tokenCaptured = await customer.evaluate(() => !!sessionStorage.getItem('pending_invitation'));
  check('招待トークンがURLから取り込まれる', tokenCaptured);
  const urlCleaned = await customer.evaluate(() => !location.search.includes('invite='));
  check('招待トークンがURLから消える（履歴・共有で漏れない）', urlCleaned);

  await injectSession(customer, NEW_CUSTOMER);
  await customer.reload();
  await customer.waitForTimeout(4000);

  // ── お客様: 自分の犬が一覧に出て、カルテが読める ──
  await customer.goto(`${BASE}/my`);
  /* `[data-portal-status]` は常に DOM に在るので待機条件にしてはいけない（即マッチして
     実質待たないことになる）。犬カードそのものを待つ。 */
  await customer.waitForSelector('.pet-card', { timeout: 25000 }).catch(() => {});
  const myPets = await customer.evaluate(() => [...document.querySelectorAll('.pet-card')].map((e) => e.textContent.trim()));
  check('招待後: 自分の犬がマイページに出る', myPets.includes(PET_NAME), JSON.stringify(myPets));

  await customer.goto(`${BASE}${reportUrl}`);
  await customer.waitForSelector('.magazine-container', { timeout: 25000 });
  const seenAfter = await customer.evaluate((n) => document.body.textContent.includes(n), NOTE);
  check('招待後: 自分のカルテの中身が読める', seenAfter);

  // ── 招待は使い捨て: 同じURLをもう一度は使えない ──
  const reuse = await browser.newContext();
  const reusePage = await reuse.newPage();
  await reusePage.goto(`${BASE}${inviteePath}`);
  await injectSession(reusePage, FIXTURE.ownerBEmail);
  await reusePage.reload();
  await reusePage.waitForTimeout(3500);
  const statusText = await reusePage.evaluate(() => document.querySelector('[data-portal-status]')?.textContent || '');
  const strangerGotIn = await reusePage.evaluate((p) => [...document.querySelectorAll('.pet-card')].some((e) => e.textContent.includes(p)), PET_NAME);
  check('消化済みの招待は使い回せない（別人が入り込めない）', !strangerGotIn, statusText.slice(0, 60));
  await reuse.close();

  // ── 退会扱い（owners.active=false）にしたら、飼い主からも見えなくなること ──
  /* スタッフ側の一覧は `active=eq.true` で絞るので退会扱いの飼い主は画面から消えるが、
     以前は飼い主側の判定が `owner_users` の行しか見ておらず、**その飼い主は /my で
     今まで通り読めた**。「退会済みに見えるのに見えている」食い違い（D-20260824-30 の 8）。 */
  const ownerId = await staff.evaluate(async (id) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    const r = await fetch(`/api/pets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await r.json())?.pet?.owner_id || '';
  }, petId);
  check('飼い主IDを取得できる（検査の前提）', !!ownerId, ownerId);

  await staff.evaluate(async (oid) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    await fetch(`/api/owners/${oid}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
  }, ownerId);
  await customer.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await customer.waitForTimeout(3500);
  const petsWhenInactive = await customer.evaluate(() => [...document.querySelectorAll('.pet-card')].map((e) => e.textContent.trim()));
  check('退会扱いにしたら飼い主の画面から犬が消える', !petsWhenInactive.includes(PET_NAME), JSON.stringify(petsWhenInactive));
  await customer.goto(`${BASE}${reportUrl}`, { waitUntil: 'domcontentloaded' });
  await customer.waitForTimeout(3500);
  const noteWhenInactive = await customer.evaluate((n) => document.body.textContent.includes(n), NOTE);
  check('退会扱いにしたらカルテの中身も読めない', !noteWhenInactive);

  /* 元に戻して、次の検査（紐付けの解除）を素の状態から始める。 */
  await staff.evaluate(async (oid) => {
    const token = (await window.TrimmerAuth.client.auth.getSession()).data.session.access_token;
    await fetch(`/api/owners/${oid}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
  }, ownerId);
  await customer.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await customer.waitForSelector('.pet-card', { timeout: 25000 }).catch(() => {});
  const backAgain = await customer.evaluate(() => [...document.querySelectorAll('.pet-card')].map((e) => e.textContent.trim()));
  check('退会を取り消せば元に戻る', backAgain.includes(PET_NAME), JSON.stringify(backAgain));

  // ── 間違えて登録された相手の紐付けを外せること ──
  /* 招待リンクは最初にクリックした Google アカウントに結び付く。誤送信・転送で
     第三者が先に開くと、以前はその人が永久に読めた（外す手段が無かった）。 */
  await staff.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
  await staff.waitForSelector('.owner-pet-item', { timeout: 20000 });
  await staff.locator('.owner-pet-row', { hasText: PET_NAME }).first().locator('.owner-pet-invite').click();
  await staff.waitForSelector('dialog[open] .supabase-owner-links', { timeout: 25000 });
  const linkRows = await staff.locator('dialog[open] .supabase-owner-links .supabase-staff-row').count();
  check('紐付いているアカウントが画面に出る', linkRows === 1, `${linkRows}件`);

  staff.once('dialog', async (d) => { await d.accept(); });
  await staff.locator('dialog[open] .supabase-owner-links .supabase-staff-row button').first().click();
  await staff.waitForTimeout(2500);
  const revoked = await staff.evaluate(() => (document.querySelector('dialog[open] .supabase-owner-links')?.textContent || '').includes('解除しました'));
  check('紐付けを解除できる', revoked);

  await customer.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await customer.waitForTimeout(3500);
  const afterRevoke = await customer.evaluate(() => [...document.querySelectorAll('.pet-card')].map((e) => e.textContent.trim()));
  check('解除された相手はもう犬を見られない', !afterRevoke.includes(PET_NAME), JSON.stringify(afterRevoke));
  await customer.goto(`${BASE}${reportUrl}`, { waitUntil: 'domcontentloaded' });
  await customer.waitForTimeout(3500);
  const noteAfterRevoke = await customer.evaluate((n) => document.body.textContent.includes(n), NOTE);
  check('解除された相手はカルテの中身も読めない', !noteAfterRevoke);

  await after.close();
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 招待: ${results.length - failed.length}/${results.length} =====\n`);
if (failed.length) {
  process.stdout.write('\n新規のお客様が自分のカルテを見られない。実店舗では毎回この経路を通る。\n');
}
process.exit(failed.length ? 1 : 0);

/**
 * verify-invitation.mjs — 新規のお客様が、自分のカルテを見られるようになるまで
 *
 * `bad-scenarios-F3.md` #17。**記録から漏れていた4本の1つ。**
 *
 * カルテを作っただけでは、飼い主は自分のカルテを見られない。飼い主側の RLS
 * （`pets_customer_select` → `private.is_owner_user`）は `owner_users` を経由してしか
 * 通らず、`owner_users` に行を入れられるのは `claim_invitation`（招待の消化）だけである。
 * つまり**招待は飾りではなく、新規のお客様を迎えるたびに必ず通る経路**。
 *
 * にもかかわらず一度も検証されていなかった。さらに F2 で「飼い主を選ぶ層」を撤去した
 * とき、QR発行ボタンが乗っていた画面ごと動線から外れ、**本番で招待を発行する手段が
 * 消えていた**（`D-20260823-05` は残すと決めていたのに・`D-20260824-29`）。
 * 既存の検査は fixture の `owner-a`（seed で最初から `owner_users` 済み）を使って
 * 書かれていたため、誰も気づかないままだった。
 *
 * **だからここでは fixture を使わない。** 新しい飼い主を作り、招待を発行し、
 * 招待を持たない別のアカウントで消化して、そのアカウントがカルテを見られるまでを通す。
 *
 *   npm run verify:invitation
 */

import { startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.INVITE_PORT || 8796) });
let browser = null;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const stamp = Math.random().toString(36).slice(2, 7);

  /* **新しい飼い主**を作る。fixture の owner-a を使うと招待を迂回してしまう。 */
  const ownerRes = await fetch(`${BASE}/api/owners`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ name: `新規${stamp}` }),
  });
  check('0. 新しい飼い主を登録できた', ownerRes.status === 201, `status=${ownerRes.status}`);
  const owner = (await ownerRes.json()).owner;

  const petRes = await fetch(`${BASE}/api/owners/${owner.id}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: owner.id, name: `新犬${stamp}`, template: 'ponchi' }),
  });
  check('1. その飼い主の犬を登録できた', petRes.status === 201, `status=${petRes.status}`);
  const pet = (await petRes.json()).pet;

  browser = await launchChromium();
  const staffPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staffPage.goto(`${BASE}/my`);
  await injectSession(staffPage, FIXTURE.staffEmail);

  /* ── 招待を発行する入口が**画面に在る**こと。ここが消えていた。 ── */
  await staffPage.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });
  await staffPage.waitForSelector('.karte-card', { timeout: 20_000 });
  const inviteButtons = await staffPage.evaluate(() => document.querySelectorAll('.btn-invite:not([hidden])').length);
  check('2. 一覧に初回登録（QR）の入口が出ている', inviteButtons > 0, `${inviteButtons}件`);

  /* 押したら本当に出るか。**在るだけでは足りない。** */
  await staffPage.evaluate((petName) => {
    const card = [...document.querySelectorAll('.karte-card')]
      .find((el) => (el.querySelector('.karte-card__dog-name') || {}).textContent === petName);
    card.querySelector('.btn-invite').click();
  }, `新犬${stamp}`);
  await staffPage.waitForSelector('dialog.supabase-dialog[open] img', { timeout: 20_000 });
  const artifact = await staffPage.evaluate(() => {
    const dialog = document.querySelector('dialog.supabase-dialog[open]');
    const url = [...dialog.querySelectorAll('input[type="text"]')].map((el) => el.value).find(Boolean) || '';
    const qr = (dialog.querySelector('img') || {}).getAttribute('src') || '';
    return { url, qrIsImage: qr.startsWith('data:image') };
  });
  check('3. 押すと初回登録の URL が出る', /\/my\?invite=[0-9a-f]{64}$/.test(artifact.url), artifact.url.slice(0, 60));
  check('4. QR が画像として出ている', artifact.qrIsImage === true);
  await staffPage.close();

  /* ── 新規のお客様が、その URL からカルテを見られるようになるまで ── */
  const invitePath = new URL(artifact.url).pathname + new URL(artifact.url).search;
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`${BASE}/my`);
  /* どの犬にも紐付いていないアカウント。招待を消化するまでは何も見えない。 */
  await injectSession(guestPage, FIXTURE.uninvitedEmail);
  await guestPage.goto(`${BASE}/my/pets/${pet.id}`, { waitUntil: 'networkidle' });
  await guestPage.waitForTimeout(2_000);
  const beforeClaim = await guestPage.evaluate(() => document.body.textContent);
  check('5. 招待を消化する前は、その犬を見られない', !beforeClaim.includes(`新犬`), '★ 見えている');

  await guestPage.goto(`${BASE}${invitePath}`, { waitUntil: 'networkidle' });
  await guestPage.waitForSelector('.pet-card, [data-portal-content]:not([hidden])', { timeout: 20_000 });
  await guestPage.waitForTimeout(1_500);
  const afterClaim = await guestPage.evaluate(() => ({
    text: document.body.textContent,
    pets: document.querySelectorAll('.pet-card').length,
  }));
  check('6. 招待を消化すると、自分の犬が見える', afterClaim.text.includes(`新犬${stamp}`),
    `pet=${afterClaim.pets}`);
  await guest.close();

  /* 招待は1回だけ。使い回せてはいけない。 */
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await secondPage.goto(`${BASE}/my`);
  await injectSession(secondPage, FIXTURE.ownerBEmail);
  await secondPage.goto(`${BASE}${invitePath}`, { waitUntil: 'networkidle' });
  await secondPage.waitForTimeout(2_000);
  const reuse = await secondPage.evaluate(() => document.body.textContent);
  check('7. 使い終わった招待は、別の人が使えない', !reuse.includes(`新犬${stamp}`), '★ 別の人にも見えた');
  await second.close();
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

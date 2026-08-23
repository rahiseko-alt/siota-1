/**
 * verify-empty-pet.mjs — カルテ0件の犬に、存在しない履歴を見せていないか（Supabaseモード）
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:empty
 *
 * EXIT 0 = 空は空として出ている / EXIT 1 = 架空の履歴が出ている
 *
 * KV版からの引き継ぎ: カルテを1件も作っていない犬に、他の犬の写真や所見で埋まった
 * デモが見えるのは、納品物として成立しない（D-10）。トリマー側は1件目を作る導線が
 * 生きていることも確かめる。
 */

import { chromium } from 'playwright';
import { startLocalWorker, passwordLogin, injectSession, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';

const CHROME = process.env.M6_CHROMIUM;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PORTAL_PORT || 8787) });
let browser;
try {
  const stamp = Date.now().toString(36).slice(-5);
  const PET_NAME = `空${stamp}`;
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: PET_NAME, template: 'ponchi' }),
  });
  const pet = (await petRes.json()).pet;
  check('スタッフAPIでカルテ0件の犬を新規登録できる', petRes.status === 201, `status=${petRes.status}`);

  browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

  // ── 飼い主側: /my/pets/{id} に架空の履歴が出ないこと ──
  const ownerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.reload();
  await ownerPage.waitForSelector('[data-testid="pet-name"]', { timeout: 15000 });

  const ownerState = await ownerPage.evaluate(() => ({
    name: document.querySelector('[data-testid="pet-name"]')?.textContent,
    images: document.querySelectorAll('img').length,
    reportLinks: document.querySelectorAll('.report-list a').length,
    bodyText: document.querySelector('[data-portal-content]')?.textContent || '',
  }));
  check('飼い主: 犬の名前が正しく出る', ownerState.name === PET_NAME, `name=${ownerState.name}`);
  check('飼い主: 見本画像が出ていない', ownerState.images === 0, `img=${ownerState.images}`);
  check('飼い主: タップできるカルテリンクが無い', ownerState.reportLinks === 0, `links=${ownerState.reportLinks}`);
  check('飼い主: 「まだカルテがありません」が出る', ownerState.bodyText.includes('まだカルテがありません'), `text=${JSON.stringify(ownerState.bodyText.slice(0, 60))}`);

  // ── トリマー側: 1件目を作る導線が残っていること ──
  const staffPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staffPage.goto(`${BASE}/edit`);
  await injectSession(staffPage, FIXTURE.staffEmail);
  await staffPage.reload();
  await staffPage.waitForSelector('.owner-pet-item', { timeout: 15000 });
  await Promise.all([
    staffPage.waitForURL(/\/edit\/p\//, { timeout: 10000 }),
    staffPage.locator('.owner-pet-item', { hasText: `${PET_NAME}（` }).first().click(),
  ]);
  await staffPage.waitForSelector('.archive-new-btn', { timeout: 15000 });
  const trimmerState = await staffPage.evaluate(() => ({
    reportRows: document.querySelectorAll('.archive-report-item, .report-list a, [data-report-id]').length,
    newBtnText: document.querySelector('.archive-new-btn')?.textContent?.trim(),
  }));
  check('トリマー: 新規作成の導線が出ている', !!trimmerState.newBtnText, `btn="${trimmerState.newBtnText}"`);
  await staffPage.click('.archive-new-btn');
  await staffPage.waitForSelector('#heroDateInput', { timeout: 15000 });
  const opened = await staffPage.evaluate(() => document.getElementById('screen-report')?.style.display !== 'none');
  check('トリマー: 導線から1件目を作れる', opened, `screen-report表示=${opened}`);
} finally {
  if (browser) await browser.close();
  await stop();
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n===== 空状態: ${results.length - failed.length}/${results.length} =====\n`);
process.exit(failed.length ? 1 : 0);

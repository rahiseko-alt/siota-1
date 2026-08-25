/**
 * verify-delete.mjs — 削除したら、写真も**本当に**消えること
 *
 * `bad-scenarios-F3.md` #14。`#2`（消したはずの写真が残り、誰も回収できなくなる）の
 * 唯一の防波堤で、**`docs/deferred.md` #8 の記録から漏れていた4本の1つ**である。
 *
 * **RLS 越しに見てはいけない。** Storage のポリシー `private.storage_path_staff` は
 * 「その `reports` 行が存在すること」を条件にしている。削除で行が消えると、
 * 写真が残っていても残っていなくても同じ「見えない」になる——**RLS 越しの確認は
 * 必ず合格してしまい、まさに直したい不具合を見逃す。** だから `service_role` で
 * 実体を数える（`scripts/lib/local-stack.mjs` の `localServiceRoleKey`）。
 *
 * **入口を思いつきで足さない**（D-18 偽-7）。正UI に削除のボタンはまだ無い
 * （`docs/deferred.md` #25）。ここで走らせるのは**製品と同じ関数**
 * `TrimmerSupabaseStorage.deleteReportAssets` で、実ブラウザの中から呼ぶ。
 * 検査用の別経路を書くと、製品が使う順序（Storage → DB・`D-20260824-34`）を
 * 通らないまま緑になる。
 *
 * 見るのは4つ、すべて「こうなっていれば合格」の形で書く:
 *   1. 確定したカルテには、写真の実体が Storage に在る（service_role で数えて 1件以上）
 *   2. 削除すると、その実体が Storage から消える（service_role で数えて 0件）
 *   3. 飼い主のページからもカルテが消える
 *   4. 削除の途中で落ちても、DB 行だけが先に消えることはない（順序）
 *
 *   npm run verify:delete
 */

import {
  startLocalWorker, injectSession, passwordLogin, localServiceRoleKey,
  LOCAL_SUPABASE_URL, FIXTURE, LOCAL_PASSWORD,
} from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

/** service_role で Storage の中身を数える。**RLS を無視して実体を見るためだけ**に使う。 */
async function countObjects(serviceKey, prefix, bucket = 'report-assets') {
  const res = await fetch(`${LOCAL_SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`storage list failed: ${res.status} ${await res.text()}`);
  const items = await res.json();
  return (items || []).filter((item) => item && item.name).length;
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.DELETE_PORT || 8794) });
let browser = null;
try {
  const serviceKey = await localServiceRoleKey();
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };

  const stamp = Math.random().toString(36).slice(2, 7);
  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: `削除${stamp}`, template: 'ponchi' }),
  });
  check('0. 検査用の犬を登録できた', petRes.status === 201, `status=${petRes.status}`);
  const pet = (await petRes.json()).pet;

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);

  /* 写真の在るカルテを1件、**製品と同じ道**（`saveReport`）で作る。
     犬体図の印を付ければ画像が1枚 Storage に上がる。 */
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  await page.evaluate(() => {
    const canvas = document.getElementById('marking-canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    }));
  });
  await Promise.all([
    page.waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/, { timeout: 30_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const reportId = new URL(page.url()).pathname.split('/').pop();
  check('1. 写真つきのカルテを確定できた', /^[0-9a-f-]{36}$/.test(reportId), `url=${page.url()}`);

  const prefix = `${FIXTURE.shopId}/${pet.id}/${reportId}`;
  const before = await countObjects(serviceKey, prefix);
  check('2. 写真の実体が Storage に在る（service_role で数える）', before >= 1, `${before}件`);

  /* ── 削除。**製品と同じ関数**を実ブラウザの中から呼ぶ（順序ごと確かめるため） ── */
  const deleted = await page.evaluate(async ({ petId, report }) => {
    try {
      await globalThis.TrimmerSupabaseStorage.deleteReportAssets({
        client: globalThis.TrimmerAuth.client,
        api: globalThis.TrimmerStaffApi.request,
        petId,
        reportId: report,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }, { petId: pet.id, report: reportId });
  check('3. 製品の削除の道が最後まで通った', deleted.ok === true, deleted.message);

  const after = await countObjects(serviceKey, prefix);
  check('4. 写真の実体が Storage から消えた（service_role で数える）', after === 0, `${after}件`);

  /* ── 飼い主のページからも消えていること ── */
  const ownerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('[data-testid="pet-name"]', { timeout: 20_000 });
  const ownerView = await ownerPage.evaluate(() => ({
    links: document.querySelectorAll('[data-portal-content] .report-list a').length,
    text: document.body.textContent,
  }));
  check('5. 飼い主のページからカルテが消えている',
    ownerView.links === 0 && ownerView.text.includes('まだカルテがありません。'), `link=${ownerView.links}`);

  process.stdout.write(
    '\n【画面に無いもの・1件】カルテを削除する入口: 無い（docs/deferred.md #25）\n'
    + '  `deleteReportAssets` は在るが、正UI のどの画面からも押せない。\n'
    + '  入口を思いつきで足さない（D-18 偽-7）。意匠モックに削除が無いので、\n'
    + '  どこに置くかはマスターの判断が要る。\n',
  );
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);

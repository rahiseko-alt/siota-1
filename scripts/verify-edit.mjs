/**
 * verify-edit.mjs — トリマーの画面 `/edit` が、正UI を配れているか
 *
 * `docs/ops/plan.md` 4-1 の1本目。`bad-scenarios-F3` #6 の9本のうち **8本が `/edit` を開く**ので、
 * ここが通らない限りその8本は戻せない。
 *
 * なぜ塞がっていたか（`docs/deferred.md` #20）:
 *   `renderAppPage` は `/ponchi-v2.html` を読んでいたが、そのテンプレートは
 *   `6685df5`「古いUIをはがし…」で**削除されていた**。テンプレートが無ければ
 *   `502 Template Not Found` を返す実装なので、`/edit` は壊れたまま放置されていた。
 *   注入するスクリプトの置き場所も `/js/` のままで、実体は `backend/js/` へ移っていた。
 *
 * 見るのは「配れているか」まで。**中身の結線（一覧・保存・確定）はまだ見ない**——
 * それは 4-1 の残りで、`PonchiApp` に相当する描画係を正UI 側に用意してから。
 *
 *   npm run verify:edit
 */

import { startLocalWorker, injectSession, FIXTURE } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.EDIT_PORT || 8789) });
let browser = null;
try {
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  /* ログインしてから開く。未ログインだと supabase-auth.js が /my へ飛ばすため、
     「配れているか」を見る前に画面が入れ替わってしまう。 */
  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);

  const res = await page.goto(`${BASE}/edit`, { waitUntil: 'networkidle' });

  /* 1. そもそも 200 か。**ここが 502 だった。** */
  check('1. /edit が配信される', res?.status() === 200, `status=${res?.status()}`);

  const seen = await page.evaluate(() => ({
    screens: document.querySelectorAll('[id^="screen-"]').length,
    hasApp: typeof globalThis.App === 'object' && globalThis.App !== null,
    vendor: typeof globalThis.TrimmerSupabaseVendor?.createClient,
    staff: typeof globalThis.TrimmerSupabaseStaff?.boot,
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
  }));

  /* 2. 配られたのが**正UI** か。古いテンプレートには screen-N は無い。 */
  check('2. 正UI が配られている（screen-N が在る）', seen.screens === 4, `screen=${seen.screens}`);

  /* 3. 古典スクリプトの App がグローバルに居るか（`#10` で固定した繋ぎ方）。
        ここが false なら onclick 63件が死んでいる。 */
  check('3. グローバル App が居る（onclick が生きている）', seen.hasApp === true);

  /* 4. backend が**モジュールとして**載っているか。置き場所の読み替えができていないと落ちる。 */
  check('4. Supabase vendor が載っている', seen.vendor === 'function');
  check('5. staff モジュールが載っている（boot を持つ）', seen.staff === 'function');

  /* 6. 注入されたスクリプトが新しい置き場所を指しているか。 */
  const backendScripts = seen.scripts.filter((s) => s.startsWith('/backend/js/'));
  const oldScripts = seen.scripts.filter((s) => /^\/js\/supabase-/.test(s));
  check('6. 注入先が backend/js/ に直っている', backendScripts.length === 3 && oldScripts.length === 0,
    `backend=${backendScripts.length} / 旧=${oldScripts.length}`);

  /* 7. 読み込みで落ちていないか。`#10` の壊れ方（App が消える）はここに出る。 */
  check('7. アプリ由来のエラーが無い', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('/edit が配れているかまでの検査。中身の結線は 4-1 の残りで見る。\n');
process.exit(passed === results.length ? 0 : 1);

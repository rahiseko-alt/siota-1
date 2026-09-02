/**
 * verify-first-run.mjs — **犬が1頭も居ない店から、人と同じ操作で最後まで行けるか**
 *
 * `AGENTS.md` D-23。「確認した」と言えるのは**人と同じ操作で目標に到達したとき**だけ。
 *
 * **なぜ要るか（実際に起きたこと・`F-20260902-66`）**
 *   `verify:*` 15本と CI が全部緑、本番の `verify:prod` も 5/5 PASS の状態で、
 *   マスターがログインしたら **犬が0件で、そこから先へ進めなかった**。
 *   検査は**全部「犬が既に居る」状態から始めていた**（fixture が必ず犬を持っている）ので、
 *   **店を開いた初日の状態を、どの検査も一度も通っていなかった。**
 *   そのうえ画面は「0件」としか言わず、「＋新規カルテを作成する」の案内は
 *   **画面に存在しない入口**（初回登録QR は犬のカードの中にしかない）を指していた。
 *
 * **ここで見るのは「動線が繋がっているか」だけ。**
 *   個々の機能の正しさは他の `verify:*` の担当。ここは
 *   **端から端まで、人の指で辿り着けるか**を見る。
 *
 *   npm run verify:first-run
 */

import { execSync } from 'node:child_process';
import { startLocalWorker, injectSession, FIXTURE } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

/** 店を「開店初日」に戻す。**この検査の出発点そのもの。** */
const sql = (q) => execSync(
  `docker exec supabase_db_trimmer-system psql -U postgres -tAc "${q}"`,
  { encoding: 'utf8' },
).trim();

const STAMP = Math.random().toString(36).slice(2, 6);
const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.FIRSTRUN_PORT || 8801) });
let browser = null;
try {
  for (const t of ['reports', 'invitations', 'pets', 'owners']) sql(`delete from ${t}`);
  const pets0 = Number(sql('select count(*) from pets'));
  /* **0件から始めていることを、まず確かめる。** ここが0でなければ
     この検査は「初日の店」を見ていない——**空で緑になる穴**を先に塞ぐ。 */
  check('0. 犬が1頭も居ない店から始めている', pets0 === 0, `犬=${pets0}頭`);

  browser = await launchChromium();
  const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const said = [];
  staff.on('dialog', async (d) => { said.push(d.message()); await d.accept(); });

  /* ── A: 病院スタッフ ── */
  await staff.goto(`${BASE}/my`, { waitUntil: 'domcontentloaded' });
  await injectSession(staff, FIXTURE.adminEmail);
  await staff.waitForTimeout(1_500);
  await staff.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await staff.waitForTimeout(5_000);
  check('1. 入口から、自分の作業画面に着く', new URL(staff.url()).pathname === '/edit',
    `着いた先=${new URL(staff.url()).pathname}`);

  /* **0件のとき、次に何をすればいいかが画面に出ているか。**
     「0件」とだけ出して黙るのが、まさにマスターが詰まった状態。 */
  const emptyNote = await staff.locator('[data-view="karte-empty"]:visible').count();
  check('2. 1頭も居ないとき、次にどうすればいいかが画面に出ている', emptyNote === 1,
    `案内=${emptyNote}件`);

  /* **案内が、画面に実在する入口を指しているか。**
     以前は「②一覧の初回登録QR」と言っていたが、0件のときそれは画面に無い。 */
  const adminVisible = await staff.locator('[data-admin-link]:not([hidden])').count();
  const inviteVisible = await staff.locator('.btn-invite:not([hidden])').count();
  check('3. 案内が指す入口が、実際に画面に在る', adminVisible === 1 && inviteVisible === 0,
    `「管理」=${adminVisible}件 / 初回登録QR=${inviteVisible}件（0件のときQRは無いので、そこを案内してはいけない）`);

  await staff.locator('text=新規カルテを作成する').first().click();
  await staff.waitForTimeout(1_200);
  const msg = said[0] || '';
  check('4. 「新規カルテを作成する」の案内が、存在しない入口を指していない',
    msg !== '' && !msg.includes('初回登録QR') && msg.includes('管理'),
    `案内="${msg.replace(/\n+/g, ' ／ ').slice(0, 60)}"`);

  /* 管理画面から、飼い主 → 犬 を登録する（**押して作る**） */
  await staff.locator('[data-admin-link]').first().click();
  await staff.waitForTimeout(3_500);
  check('5. 「管理」を押すと管理画面に着く', new URL(staff.url()).pathname === '/admin',
    `着いた先=${new URL(staff.url()).pathname}`);

  await staff.locator('text=② 新規').first().click();
  await staff.waitForTimeout(1_500);
  await staff.locator('text=顧客アカウント').first().click();
  await staff.waitForTimeout(1_500);
  await staff.locator('input:visible').first().fill(`初日飼い主${STAMP}`);
  await staff.locator('button:visible').filter({ hasText: /登録する/ }).first().click();
  await staff.waitForTimeout(2_500);
  check('6. 飼い主を登録できた', Number(sql('select count(*) from owners')) === 1,
    `${sql('select count(*) from owners')}人`);

  await staff.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await staff.waitForTimeout(3_000);
  await staff.locator('text=② 新規').first().click();
  await staff.waitForTimeout(1_500);
  await staff.locator('text=ペットアカウント').first().click();
  await staff.waitForTimeout(1_500);
  /* 飼い主の選択肢は後から入る。**人も出るまで待つ。** */
  await staff.waitForFunction(() => {
    const s = document.querySelector('select[data-admin-field="owner-select"]');
    return s && [...s.options].some((o) => o.value);
  }, null, { timeout: 20_000 });
  const sel = staff.locator('select[data-admin-field="owner-select"]').first();
  await sel.selectOption({ index: await sel.evaluate((s) => [...s.options].findIndex((o) => o.value)) });
  await staff.locator('input:visible').first().fill(`初日犬${STAMP}`);
  await staff.locator('button:visible').filter({ hasText: /登録する/ }).first().click();
  await staff.waitForTimeout(2_500);
  check('7. その飼い主に犬を登録できた', Number(sql('select count(*) from pets')) === 1,
    `${sql('select count(*) from pets')}頭`);

  await staff.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
  await staff.waitForTimeout(4_000);
  const cards = await staff.locator('.karte-card').count();
  check('8. 登録した犬が、作業画面の一覧に出る', cards === 1, `${cards}件`);

  await staff.locator('.karte-card .karte-card__dog-name').first().click();
  await staff.waitForTimeout(3_500);
  check('9. 犬を押すとカルテ作成に着く',
    (await staff.evaluate(() => (document.querySelector('.screen-panel.is-active') || {}).id)) === 'screen-3');

  await staff.locator('input[type="date"]:visible').first().fill('2026-09-02');
  await staff.locator('select:visible').first().selectOption({ index: 1 });
  await staff.waitForTimeout(600);
  /* **⑦使用オプションに、指で届くか。** DOM に在るだけでは足りない
     ——ここが5セッション追いかけた場所（`F-20260901-63`）。 */
  const opt = staff.locator('text=アメージング').first();
  const optCount = await opt.count();
  check('10. ④に使用オプションが出ている', optCount > 0, `${optCount}件`);
  if (optCount > 0) {
    await opt.scrollIntoViewIfNeeded();
    const reach = await opt.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { ok: r.left >= 0 && r.right <= window.innerWidth && r.width > 0, left: Math.round(r.left), right: Math.round(r.right), w: window.innerWidth };
    });
    check('11. その使用オプションに指が届く', reach.ok, `left=${reach.left} right=${reach.right} 幅=${reach.w}`);
    await opt.click();
  }

  await staff.locator('text=確定してお客様カルテを見る').first().click();
  await staff.waitForTimeout(6_000);
  check('12. 確定できた（カルテが1枚できた）', Number(sql('select count(*) from reports')) === 1,
    `${sql('select count(*) from reports')}枚`);

  /* ── B: 病院の客 ── */
  await staff.goto(`${BASE}/edit`, { waitUntil: 'domcontentloaded' });
  await staff.waitForTimeout(4_000);
  await staff.locator('.btn-invite').first().click();
  await staff.waitForTimeout(3_000);
  const inviteUrl = await staff.evaluate(() => {
    const t = [...document.querySelectorAll('dialog input, dialog a, dialog code, dialog p, dialog textarea')]
      .map((e) => e.value || e.textContent || '').find((x) => /invite=/.test(x));
    return t ? (t.match(/https?:\/\/\S*invite=[\w-]+/) || [null])[0] : null;
  });
  check('13. 客に渡す初回登録の URL が出る', !!inviteUrl, inviteUrl ? '出た' : '**出ない**');

  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await owner.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
  await owner.waitForTimeout(3_000);
  await injectSession(owner, FIXTURE.uninvitedEmail);
  await owner.waitForTimeout(1_500);
  await owner.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
  await owner.waitForTimeout(5_000);
  const pets = await owner.locator('.pet-card').count();
  check('14. 客がログインすると、自分の犬が出る', pets === 1, `${pets}件`);

  await owner.locator('.pet-card').first().click();
  await owner.waitForTimeout(4_000);
  await owner.locator('a[href*="/reports/"], li a').first().click();
  await owner.waitForTimeout(4_500);
  const text = await owner.evaluate(() => document.body.innerText);
  check('15. 客がカルテを開ける', /reports\//.test(owner.url()), new URL(owner.url()).pathname);
  check('16. スタッフが選んだ使用オプションが、客の画面に届いている',
    text.includes('アメージング'), text.includes('アメージング') ? '"アメージング"' : '**届いていない**');
} catch (error) {
  check('最後まで歩けた', false, error.message.split('\n')[0]);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('**これは「動線が繋がっているか」だけを見る**（D-23）。個々の機能の正しさは他の verify:* の担当。\n');
process.exit(passed === results.length ? 0 : 1);

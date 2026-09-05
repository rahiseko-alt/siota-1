/**
 * verify-xss.mjs — 保存されたカルテが、飼い主のブラウザで**実行されない**こと
 *
 * `AGENTS.md` D-11 の機械強制。`bad-scenarios-F3.md` #12（`#6` を割ったうちの1本）。
 *
 * 脅威モデルは KV 版から引き継ぐ。「誰でも書ける」ことは塞がない——`/api` の無認証は
 * 意図された前提である（D-3）。塞ぐのは「**書かれたものが飼い主のブラウザでコードとして
 * 実行される**」ことだけ。だから細工は画面からではなく**スタッフ API から直接**入れ、
 * DOM の無害化を迂回して `renderMagazine()` の**出口**を見る。入り口に穴があっても、
 * ここが最後の砦として効かなければならない。
 *
 * **この検査は `/edit` を開かない。** 細工は API で入れ、見るのは飼い主の画面だけなので、
 * 4-1 の結線を待たずに走る（`docs/ops/verify-restore-F3.md` の実測）。
 *
 * **`6685df5^` の版から、合格条件だけ書き直した。** 旧版は `!fired`——「実行されなければ
 * 合格」だけを見ていた。これだと**細工が飼い主の画面に届いていなくても合格**する
 * （ページが出ない・カルテが見えない・確定に失敗した、のどれでも `__XSS_FIRED` は
 * undefined になる）。`F-20260825-35`/`-36` で2回やった「期待する成功の形を、実際の
 * 仕組みに合わせて書かずに検査を書いた」と同じ型なので、**先に「届いていること」を
 * 積極的に確かめる**形にした。1件につき3つ、すべて「こうなっていれば合格」で書く:
 *
 *   ① 細工した文字列が、**文字として**飼い主の画面に出ている  ← 届いた証拠
 *   ② `window.__XSS_FIRED` が立っていない                      ← 実行されていない
 *   ③ 注入されたはずの要素（`img[src="x"]`）が DOM に無い       ← HTML として解釈されていない
 *
 * ①が無いと②③は「何も起きなかったから合格」になり、検査の意味が消える。
 *
 * 使い方:
 *   端末1: npx supabase start
 *   端末2: npm run verify:xss
 *   （CI では .github/workflows/ci.yml が自動で走らせる）
 *
 * EXIT 0 = 実行されない / EXIT 1 = 実行された（Critical）
 */

import { startLocalWorker, passwordLogin, injectSession, FIXTURE, LOCAL_PASSWORD } from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const FIRE = 'window.__XSS_FIRED=1';
const SPIKE = `<img src=x onerror="${FIRE}">`;

/* 仕掛ける場所。`renderMagazine()` が描画する箇所を一通り洗う。増やすときはここに1行足す。
   `petName` を持つ項は**犬の名前そのもの**に仕掛ける——飼い主の画面の見出しは
   `report.pet.name`（DB の値）を使い、`data.pet` は petName が空のときしか出ない
   （`backend/js/supabase-auth.js` の `renderReport`）。`data.pet` に入れる旧版の形は
   飼い主の画面では一度も描画されず、**必ず合格する検査**になっていた。 */
const PAYLOADS = [
  { name: '犬の名前（見出しへ入る）', petName: true, build: (d) => d },
  { name: 'staffNote（担当からの一言）', build: (d) => ({ ...d, staffNote: SPIKE }) },
  { name: 'skin[].loc（皮膚の部位）', build: (d) => ({ ...d, skin: [{ loc: SPIKE, size: '5mm', type: '', change: '' }] }) },
  { name: 'ear.comment（耳のコメント）', build: (d) => ({ ...d, ear: { right: 1, left: 1, comment: SPIKE } }) },
  { name: 'nail.comment（爪のコメント）', build: (d) => ({ ...d, nail: { level: 1, comment: SPIKE } }) },
  { name: 'teeth.status（歯の状態）', build: (d) => ({ ...d, teeth: { status: SPIKE, comment: '' } }) },
  { name: 'teeth.comment（歯のコメント）', build: (d) => ({ ...d, teeth: { status: '', comment: SPIKE } }) },
  { name: 'weights[].ym（体重グラフのラベル）', build: (d) => ({ ...d, weights: [{ ym: SPIKE, kg: 3.2 }] }) },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  /* `★` で始まる detail は**落ちたときに何が起きたか**を書いたもの。合格した行に
     出すと「PASS なのに ★ 文例が出ている」のように読めてしまい、緑と赤が見分け
     られなくなる。出力を読んで判断する運用なので、ここは正確に出す。 */
  const note = detail && !(pass && String(detail).startsWith('★')) ? detail : '';
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  ${note}` : ''}\n`);
}

const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.XSS_PORT || 8790) });
let browser = null;
try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = {
    Authorization: `Bearer ${staffSession.access_token}`,
    'Content-Type': 'application/json',
  };
  browser = await launchChromium();

  for (const [i, payload] of PAYLOADS.entries()) {
    const label = payload.name;
    const stamp = `${i}${Math.random().toString(36).slice(2, 6)}`;
    const petName = payload.petName ? `${SPIKE}XSS${stamp}` : `XSS${stamp}`;

    const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: petName, template: 'ponchi' }),
    });
    if (petRes.status !== 201) {
      check(label, false, `犬を登録できず、細工を届けられなかった (${petRes.status})`);
      continue;
    }
    const pet = (await petRes.json()).pet;

    const base = { template: 'ponchi', pet: petName, weights: [], skin: [], options: [], teeth: {}, ear: {}, nail: {} };
    const reportRes = await fetch(`${BASE}/api/pets/${pet.id}/reports`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ petId: pet.id, reportDate: '2026-08-23', data: payload.build(base) }),
    });
    if (reportRes.status !== 201) {
      check(label, false, `カルテを作れず、細工を届けられなかった (${reportRes.status})`);
      continue;
    }
    const report = (await reportRes.json()).report;

    /* 作成直後は `draft`。飼い主には見えないので確定させる。ここを飛ばすと
       「見えないから実行もされない」で合格してしまう。 */
    const finalizeRes = await fetch(`${BASE}/api/pets/${pet.id}/reports/${report.id}/finalize`, {
      method: 'POST', headers: authHeaders,
    });
    if (!finalizeRes.ok) {
      check(label, false, `確定に失敗 (${finalizeRes.status})。細工を飼い主の画面まで届けられなかった`);
      continue;
    }

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    /* **注入は入口で行われる**（`injectSession` が自分で `/` へ移る）。
       戻ってくるので `reload()` ではなく、見たいカルテを名指しで開く。 */
    await injectSession(page, FIXTURE.ownerAEmail);
    await page.goto(`${BASE}/my/pets/${pet.id}/reports/${report.id}`);
    await page.waitForSelector('.magazine-container', { timeout: 20_000 });

    const seen = await page.evaluate((spike) => ({
      /* 細工が**文字として**出ているか。HTML として解釈されていれば `<img` は
         textContent に現れない（要素になる）。届いたことと、文字のままであることを
         1つの観測で見る。 */
      asText: document.body.textContent.includes(spike),
      fired: !!window.__XSS_FIRED,
      injected: document.querySelectorAll('img[src="x"]').length,
    }), SPIKE);

    check(`${label}: 細工が文字として飼い主の画面に出ている`, seen.asText === true,
      seen.asText ? '' : '★ 届いていない。この項は何も検査できていない');
    check(`${label}: 実行されない`, seen.fired === false, seen.fired ? '★ 実行された' : '');
    check(`${label}: 要素として注入されていない`, seen.injected === 0, `img[src="x"]=${seen.injected}`);
    await page.close();
  }
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
if (passed !== results.length) {
  process.stdout.write('\n保存されたデータが飼い主のブラウザで実行されている、または細工が届いていない。Critical。\n');
}
process.exit(passed === results.length ? 0 : 1);

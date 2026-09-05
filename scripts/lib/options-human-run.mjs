/**
 * options-human-run.mjs — ⑦使用オプションを「人間と同じ操作」で10パターン見る
 *
 * マスター指示 2026-09-01。`scripts/verify-options-human.mjs` から呼ばれる。
 *
 * **出すのは写真だけ。合否はこの検査が決めない**（`D-14` と同じ立て付け）。
 * 各パターンで、人がやるのと同じ手順（開く → 犬のカードを押す → 下まで送る）を
 * なぞり、④カルテ作成画面の全体を1枚に撮る。
 */

import fs from 'node:fs';
import path from 'node:path';
import { devices } from 'playwright';
import { launchChromium } from './chromium.mjs';
import {
  BASE_PETS, NINE_OPTIONS, PET_ID, PET_ID_2, REPORT_ID,
  SHOTS, VENDOR_STUB, defaultRoutes, startServer,
} from './options-human-fixture.mjs';

/** JSON の応答を1本作る。 */
function json(status, body) {
  return { status, body };
}

/**
 * パターン定義。
 * `routes` は既定（`defaultRoutes()`）に対する差分だけ書く。
 * `nav` は「人がどう④へ入るか」。
 */
export const PATTERNS = [
  {
    id: '01-card-baseline',
    title: '①指示どおり: ②一覧の犬のカードを押して④に入る',
    why: '他の9本の比較基準。この経路は開発側が何度も緑にしてきた経路でもある',
    routes: {},
    nav: 'card',
    journey: true,
  },
  {
    id: '02-tab-03',
    title: '②上の帯の「03 カルテ作成」を押して④に入る（犬を選ばずに）',
    why: 'このボタンは常に画面の上に出ている。押すと goToStep(3) だけが動き、'
      + 'オプションを組み立てる係を一度も通らない。帯は HTML の既定 hidden のまま',
    routes: {},
    nav: 'tab',
  },
  {
    id: '03-card-then-tab',
    title: '③犬を選んで④に入ったあと、②へ戻ってからまた「03 カルテ作成」で戻る',
    why: '一度は帯が出た人でも、戻ってから入り直すと消えるのか。'
      + '「さっきは出たのに今は無い」の説明になり得る',
    routes: {},
    nav: 'card-then-tab',
  },
  {
    id: '04-home-icon-root',
    title: '④ホーム画面のアイコンから開く（manifest の start_url は "/"）',
    why: '本番の `/` は Worker がバックエンドを注入しない静的ページ。'
      + '仮データの犬が出て、オプションは永久に出ない',
    routes: {},
    nav: 'root',
  },
  {
    id: '05-backend-not-loaded',
    title: '⑤バックエンドの読み込みが1本落ちる（電波が切れた・キャッシュが壊れた）',
    why: 'dummy.js のコメントが「本番で実際に発生・マスター報告」と記録している型。'
      + '失敗の知らせ先（.owner-list）は画面に存在しないので、何も出ずに仮データへ落ちる',
    routes: {},
    nav: 'backend-fail',
  },
  {
    id: '06-new-karte-button',
    title: '⑥②一覧に「＋新規カルテを作成する」が無い状態で、人が次にどうするか',
    why: 'ボタンは 2026-09-04 に削除した（押しても案内を出すだけで、犬を登録できるのは'
      + '管理画面だけだった・マスター指示）。**無くなったあと、人が詰まらないか**を見る。'
      + '0件の店では案内が「管理」を指す（`verify:first-run` の 4b.）。'
      + 'ここは犬が居る店なので、上の帯の「03 カルテ作成」に合流できるかを撮る',
    routes: {},
    nav: 'new-karte-button',
  },
  {
    id: '07-shop-409-two-shops',
    title: '⑦この人が2店舗に所属している（/api/shop が 409）',
    why: '店舗を1つに決められないと 409。犬の一覧は別の口なので普通に出るため、'
      + '「オプションの帯だけが消える」という壊れ方になる',
    routes: { '/api/shop': () => json(409, { error: 'shop_selection_required' }) },
    nav: 'card',
  },
  {
    id: '08-shop-401',
    title: '⑧店舗の口だけ認証が切れている（/api/shop が 401）',
    why: '⑦と見分けが付くか。付かないなら「画面を見ても原因が分からない」ことの証明になる',
    routes: { '/api/shop': () => json(401, { error: 'authentication required' }) },
    nav: 'card',
  },
  {
    id: '09-options-empty',
    title: '⑨店舗のオプションが空（管理画面で消えている／保存で上書きされた）',
    why: '設計上わざと帯ごと隠す。この絵がマスターの絵と同じなら、原因はデータ側',
    routes: {
      '/api/shop': () => json(200, { shop: { id: 'shop-1', name: 'テスト店', slug: 'test', default_revisit_days: 30, grooming_options: [] } }),
    },
    nav: 'card',
  },
  {
    id: '10-draft-resume',
    title: '⑩下書きが残っている犬を開く（前回の続きから）',
    why: '下書きの読み込みがボタンを押し直すので、組み立て順を間違えると消える',
    routes: {
      reportsList: () => json(200, { reports: [{ id: REPORT_ID, status: 'draft', report_date: '2026-09-01' }] }),
      report: () => json(200, { report: { id: REPORT_ID, status: 'draft', report_date: '2026-09-01', data: { options: ['炭酸泉', '歯磨き'] }, assets: [] } }),
    },
    nav: 'card',
  },
];

/** 1パターン分。ブラウザを毎回新しくして、前の状態を持ち越さない。 */
async function runOne(browser, base, pattern) {
  const routes = { ...defaultRoutes(), ...pattern.routes };
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    /* マスターはスマホで見ている。幅が狭いほうが「見えない」は起きやすい。 */
  });
  const page = await context.newPage();
  const notes = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') notes.push(`console.error: ${msg.text()}`.slice(0, 200));
  });
  page.on('pageerror', (err) => notes.push(`pageerror: ${err.message}`.slice(0, 200)));

  /* Supabase の SDK を偽物に差し替える（ログイン済みの体にする）。 */
  await page.route('**/backend/js/supabase-vendor.js', (route) => route.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8', body: VENDOR_STUB,
  }));

  /* `/api/*` をパターンどおりに返す。 */
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let result = null;
    if (routes[p]) result = await routes[p]();
    else if (/^\/api\/pets\/[^/]+\/reports$/.test(p)) {
      result = routes.reportsList ? await routes.reportsList() : json(200, { reports: [] });
    } else if (/^\/api\/pets\/[^/]+\/reports\/[^/]+$/.test(p)) {
      result = await routes.report();
    } else if (/^\/api\/pets\/[^/]+$/.test(p)) {
      result = await routes.pet(p.split('/').pop());
    }
    if (!result) {
      notes.push(`未定義のAPI: ${p}`);
      result = json(404, { error: 'not found' });
    }
    await route.fulfill({
      status: result.status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(result.body),
    });
  });

  /* backend のモジュールを1本落とす（電波が切れた・キャッシュが壊れた等）。
     `dummy.js` のコメントが「本番で実際に発生・マスター報告」と記録している型。 */
  if (pattern.nav === 'backend-fail') {
    await page.route('**/backend/js/supabase-staff.js', (route) => route.abort());
  }

  /* ── ここから「人と同じ操作」────────────────────────── */
  const steps = [];
  try {
    if (pattern.nav === 'direct') {
      const id = PET_ID;
      await page.goto(`${base}/edit/p/${id}`, { waitUntil: 'domcontentloaded' });
      steps.push(`URL を直接開いた: /edit/p/${id}`);
    } else if (pattern.nav === 'root') {
      /* ホーム画面に追加したアイコンは `manifest.json` の `start_url: "./"` ＝
         `/` を開く。本番の `/` は Worker が backend を注入しない静的ページ。 */
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      steps.push('ホーム画面のアイコンと同じ `/` を開いた（①ログイン画面が出る）');
      await page.waitForTimeout(2000);
      /* 人はここで「Google でログイン」を押す。`/` にはバックエンドが
         載っていないので、押しても②へ進むだけでログインはしない。 */
      const login = page.locator('button, a').filter({ hasText: 'Google でログイン' }).first();
      if (await login.count() > 0) {
        await login.click();
        steps.push('「Google でログイン」を押した');
        await page.waitForTimeout(1500);
      }
      const card = page.locator('.karte-card:visible').first();
      if (await card.count() > 0) {
        const label = (await card.innerText()).split('\n')[0].trim();
        await card.click();
        steps.push(`②一覧のいちばん上のカード「${label}」を押した`);
      } else {
        await page.locator('.btn-step[data-step="3"]').click();
        steps.push('カードが無いので「03 カルテ作成」を押した');
      }
    } else if (pattern.nav === 'tab') {
      /* ②一覧から、犬を選ばずにタブ「03 カルテ作成」で④へ入る。 */
      await page.goto(`${base}/edit`, { waitUntil: 'domcontentloaded' });
      steps.push('/edit を開いた');
      await page.locator('.karte-card').first().waitFor({ state: 'visible', timeout: 15000 });
      steps.push('②一覧が出た');
      await page.locator('.btn-step[data-step="3"]').click();
      steps.push('上の帯の「03 カルテ作成」を押した');
    } else if (pattern.nav === 'card-then-tab') {
      /* 犬を選んで④に入ったあと、②へ戻ってからタブで④に入り直す
         （確定後や、途中で他の犬を見たあとに戻る人の手癖）。 */
      await page.goto(`${base}/edit`, { waitUntil: 'domcontentloaded' });
      const card = page.locator('.karte-card', { hasText: BASE_PETS[0].name }).first();
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.click();
      await page.waitForURL(/\/edit\/p\//, { timeout: 15000 });
      steps.push('犬のカードから④に入った（ここでは帯が出る）');
      await page.waitForTimeout(4000);
      await page.locator('.btn-step[data-step="2"]').click();
      steps.push('「02 カルテ検索」を押して②へ戻った');
      await page.waitForTimeout(800);
      await page.locator('.btn-step[data-step="3"]').click();
      steps.push('「03 カルテ作成」を押して④へ入り直した');
    } else if (pattern.nav === 'new-karte-button') {
      await page.goto(`${base}/edit`, { waitUntil: 'domcontentloaded' });
      await page.locator('.karte-card').first().waitFor({ state: 'visible', timeout: 15000 });
      steps.push('/edit を開いた（②一覧）');
      page.on('dialog', (d) => { steps.push(`お知らせが出た: ${d.message().slice(0, 60)}`); d.accept(); });
      /* **ボタンはもう無い。**「見つからない」と書いて終わるのではなく、
         **無いことを確かめてから、人が実際に取る次の手を撮る**
         ——else 側に落ちて何も試さないシナリオになっていた（サブ検証 2026-09-04）。 */
      const btn = page.locator('button', { hasText: '新規カルテを作成' });
      steps.push(`「＋新規カルテを作成する」は ${await btn.count()} 件（削除済みなので 0 が正しい）`);
      await page.locator('.btn-step[data-step="3"]').click();
      steps.push('人は上の帯の「03 カルテ作成」を押す');
    } else if (pattern.nav === 'backend-fail') {
      await page.goto(`${base}/edit`, { waitUntil: 'domcontentloaded' });
      steps.push('/edit を開いた（backend のモジュールが1本落ちる状態）');
      await page.waitForTimeout(3000);
      const card = page.locator('.karte-card:visible').first();
      if (await card.count() > 0) {
        const label = (await card.innerText()).split('\n')[0].trim();
        await card.click();
        steps.push(`②一覧のいちばん上のカード「${label}」を押した`);
      } else {
        /* 一覧が出ないなら、人は上の帯から④へ入るしかない。 */
        await page.locator('.btn-step[data-step="3"]').click();
        steps.push('②一覧に犬が出ないので「03 カルテ作成」を押した');
      }
    } else {
      await page.goto(`${base}/edit`, { waitUntil: 'domcontentloaded' });
      steps.push('/edit を開いた');
      const name = pattern.nav === 'card2' ? BASE_PETS[1].name : BASE_PETS[0].name;
      /* 名前が見えるまで待ってから押す——人は出るまで待つ。 */
      const card = page.locator('.karte-card', { hasText: name }).first();
      await card.waitFor({ state: 'visible', timeout: 15000 });
      steps.push(`②一覧に「${name}」のカードが出た`);
      await card.click();
      steps.push(`「${name}」のカードを押した`);
      await page.waitForURL(/\/edit\/p\//, { timeout: 15000 });
      steps.push(`④へ移った: ${new URL(page.url()).pathname}`);
    }
    /* 描画と `/api/shop` の到着を待つ。遅いパターンでもここで待ちきる。 */
    await page.waitForTimeout(8000);

    /* **人が指で送る回数を数える。**
       帯が「在る」ことと、人が「たどり着ける」ことは別物（`D-14`）。
       1回のスワイプ＝画面ほぼ1つ分として、⑦に着くまで何回送るかを実際に送って数える。 */
    const reach = await page.evaluate(() => {
      const sec = document.getElementById('sec-options');
      const view = window.innerHeight;
      const pageH = document.body.scrollHeight;
      if (!sec || sec.hidden) return { present: false, view, pageH };
      const top = sec.getBoundingClientRect().top + window.scrollY;
      return { present: true, view, pageH, top, swipes: Math.ceil(top / (view * 0.85)) };
    });
    if (reach.present) {
      steps.push(
        `⑦の帯は上から ${Math.round(reach.top)}px の位置（ページ全体は ${reach.pageH}px、`
        + `画面の高さは ${reach.view}px）＝ 指で約 ${reach.swipes} 回送る`,
      );
    } else {
      steps.push(`⑦の帯は画面に出ていない（ページ全体は ${reach.pageH}px）`);
    }

    /* 人と同じように、上から順に送っていく絵も残す（1パターンにつき数枚）。
       「下まで一気に飛ぶ」のは人の操作ではない。 */
    if (pattern.journey) {
      const shots = [];
      for (let i = 0; i < Math.min(reach.swipes ? reach.swipes + 1 : 6, 20); i += 1) {
        await page.evaluate((n) => window.scrollTo(0, window.innerHeight * 0.85 * n), i);
        await page.waitForTimeout(250);
        const f = path.join(SHOTS, `${pattern.id}-swipe${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path: f });
        shots.push(f);
      }
      steps.push(`指で送っていく絵を ${shots.length} 枚撮った`);
    }

    /* **⑦の帯だけを大きく1枚。** 全体の写真は縦に長すぎて、
       帯の文字が読めない（読めない絵で合否を決めない）。 */
    if (reach.present) {
      const sec = page.locator('#sec-options');
      await sec.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await sec.screenshot({ path: path.join(SHOTS, `${pattern.id}-帯.png`) });
      steps.push('⑦の帯だけを大きく撮った');
    }

    /* 最後に全体を1枚。 */
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    steps.push('画面をいちばん下まで送った');
  } catch (error) {
    notes.push(`操作の途中で止まった: ${error.message}`.slice(0, 300));
    steps.push(`途中で止まった: ${error.message}`.slice(0, 120));
  }

  const file = path.join(SHOTS, `${pattern.id}.png`);
  await page.screenshot({ path: file, fullPage: true });

  await context.close();
  return { steps, notes, file };
}

export async function runPatterns() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { base, stop } = await startServer(8811);
  /* 環境に在るブラウザで起動する（`walk-human.mjs` と同じ係を使い回す）。 */
  const browser = await launchChromium();
  const results = [];
  try {
    /* 1本だけ見たいときの絞り込み（`OPTIONS_ONLY=01` のように使う）。
       既定は全部——**絞り込みを既定にしない**（`偽-2`「見る範囲を狭める」）。 */
    const only = process.env.OPTIONS_ONLY;
    const targets = only ? PATTERNS.filter((p) => p.id.startsWith(only)) : PATTERNS;
    for (const pattern of targets) {
      process.stdout.write(`\n■ ${pattern.id}  ${pattern.title}\n`);
      const r = await runOne(browser, base, pattern);
      for (const s of r.steps) process.stdout.write(`    ・${s}\n`);
      for (const n of r.notes) process.stdout.write(`    ⚠ ${n}\n`);
      process.stdout.write(`    📷 ${path.relative(process.cwd(), r.file)}\n`);
      results.push({ pattern, ...r });
    }
  } finally {
    await browser.close();
    await stop();
  }

  process.stdout.write('\n────────────────────────────────────\n');
  process.stdout.write(`写真を ${results.length} 枚撮りました: ${path.relative(process.cwd(), SHOTS)}\n`);
  process.stdout.write('**合否はこの検査が決めません。**写真を見て人が決めてください。\n');
  process.stdout.write('見るのは1つだけ: ④の画面に「⑦ 使用オプション」の帯とボタンが写っているか。\n');
  return 0;
}

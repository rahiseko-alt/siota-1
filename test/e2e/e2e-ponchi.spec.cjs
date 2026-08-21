/**
 * e2e-ponchi.spec.js
 * Playwright E2E test: trimmer-system B (ponchi)
 * http://localhost:8787
 */
// @ts-check
const { test, expect } = require('playwright/test');

const BASE = 'http://localhost:8787';

/** API ヘルパ */
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${url} => ${res.status}`);
  return res.json();
}

async function cleanupE2EData() {
  const data = await apiFetch(`${BASE}/api/owners`);
  const owners = data.owners || [];
  await Promise.all(owners
    .filter((owner) => String(owner.ownerName || '').startsWith('E2E'))
    .map((owner) => apiFetch(`${BASE}/api/owners/${encodeURIComponent(owner.ownerSlug)}`, {
      method: 'DELETE',
    })));
}

test.describe('trimmer-system B (ponchi) E2E', () => {
  test.beforeAll(cleanupE2EData);
  test.afterAll(cleanupE2EData);

  // ─── E2E-1: 飼い主一覧表示 + 新規飼い主登録 ───────────────────────────
  test('E2E-1: 飼い主一覧 → 新規飼い主登録 → 犬一覧へ', async ({ page }) => {
    await page.goto(`${BASE}/edit`);

    // owner 画面が表示されていること
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#screen-owner .screen-list-title')).toBeVisible();
    await expect(page.locator('#ownerSubtitle')).toHaveText('飼い主をお選びください');

    // 「＋新規飼い主登録」ボタンが出ること
    const addBtn = page.locator('#screen-owner .ponchi-add-btn');
    await expect(addBtn).toBeVisible();

    // クリックするとインラインフォームが現れる
    await addBtn.click();
    const input = page.locator('#screen-owner .ponchi-inline-input');
    await expect(input).toBeVisible();

    // 飼い主名を入力して登録
    const ownerName = 'E2Eテスト飼い主';
    await input.fill(ownerName);
    await page.locator('#screen-owner .ponchi-inline-submit').click();

    // 登録後 owner 画面（犬一覧・空）が描画されること
    // ※ KV 結果整合性回避のため、登録直後は URL 遷移ではなく
    //    PonchiApp.show('owner', {owner:{...}}) でインライン描画される設計。
    //    URL ではなく画面要素で検証する。
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ownerSubtitle')).toHaveText('ワンちゃんをお選びください');
    // 犬一覧が空であること（「まだ犬が登録されていません」）
    await expect(page.locator('#screen-owner .owner-empty')).toBeVisible();
    // 犬追加ボタンがある
    await expect(page.locator('#screen-owner .ponchi-add-btn')).toBeVisible();
  });

  // ─── E2E-2: 新規犬登録 → 全月一覧へ ──────────────────────────────────
  test('E2E-2: 新規犬登録 → 全月一覧へ', async ({ page }) => {
    // まず飼い主を API で作成
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー2' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    await page.goto(`${BASE}/edit/o/${ownerSlug}`);
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 8000 });

    // 「＋新規犬登録」ボタン
    const addBtn = page.locator('#screen-owner .ponchi-add-btn');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const input = page.locator('#screen-owner .ponchi-inline-input');
    await expect(input).toBeVisible();
    await input.fill('E2Eテスト犬');
    await page.locator('#screen-owner .ponchi-inline-submit').click();

    // archive 画面（全月一覧）に遷移
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 10000 });
    // 空一覧メッセージと「＋新規カルテ作成」ボタン
    await expect(page.locator('#screen-archive .archive-list')).toBeVisible();
    await expect(page.locator('#screen-archive .archive-new-btn')).toBeVisible();
  });

  // ─── E2E-3: 新規カルテ作成 → 空カルテ（前の犬/デモ値が残らない）──────
  test('E2E-3: 新規カルテ → hero に＋写真を追加・デモ値なし', async ({ page }) => {
    // API で飼い主+犬を作成
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー3' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬3', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });

    // 新規カルテ作成ボタン
    const newBtn = page.locator('#screen-archive .archive-new-btn');
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    // report 画面に切替
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // date/year フィールドが空になっていること（デモ値 "2026" / "12" が消えている）
    const dateField = page.locator('[data-field="date"]');
    const yearField = page.locator('[data-field="year"]');
    await expect(dateField).toHaveText('');
    await expect(yearField).toHaveText('');

    // hero-1 が data-empty="1"（＋写真を追加 状態）になっていること
    const heroImg = page.locator('img[data-photo="hero-1"]');
    await expect(heroImg).toHaveAttribute('data-empty', '1');

    // 確定バーが表示されること
    await expect(page.locator('#ponchi-commit-bar')).toBeVisible();
  });

  // ─── E2E-4: カルテ入力（contenteditable / 体重グラフ / オプション）──────
  test('E2E-4: カルテ入力 - contenteditable/体重/オプション', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー4' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬4', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });
    await page.locator('#screen-archive .archive-new-btn').click();
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // ヒーロー日付: native date ピッカー（type=date）で年月日を選ぶ → 表示 span に同期
    const heroDate = page.locator('#heroDateInput');
    await heroDate.fill('2026-06-01');
    await expect(page.locator('#screen-report [data-field="year"]')).toHaveText('2026');
    await expect(page.locator('#screen-report [data-field="date"]')).toHaveText('6');
    await expect(page.locator('#screen-report [data-field="day"]')).toHaveText('1');

    // 体重: 「新規登録」ボタン → kg 入力 → 登録（日付はヒーローのカレンダーと同期・独立日付選択なし）
    // weightCard が開いていなければ開く（el.open で正確判定・open 済みを誤って閉じない）
    const weightCard = page.locator('#weightCard');
    const wcOpen = await weightCard.evaluate((el) => el.open);
    if (!wcOpen) {
      await weightCard.locator('summary').click();
    }

    await page.locator('#wcNew').click();
    await expect(page.locator('#wcInputRow')).toBeVisible();
    await page.locator('#wcKg').fill('3.5');
    await page.locator('#wcAdd').click();

    // wcList にエントリが追加される
    const wcList = page.locator('#wcList');
    await expect(wcList.locator('.wc-item, li, .wc-entry').first()).toBeVisible({ timeout: 3000 })
      .catch(async () => {
        // wc-list の中身確認（何らかの要素が追加されたか）
        const count = await wcList.locator('*').count();
        expect(count).toBeGreaterThan(0);
      });

    // オプション: 最初の .opt をクリックして on になる
    const firstOpt = page.locator('.opt').first();
    await firstOpt.click();
    await expect(firstOpt).toHaveClass(/on/);
  });

  // ─── E2E-5: 確定 → 公開確認 → 公開URL発行 ────────────────────────────
  test('E2E-5: 確定→公開→公開URL(/p/{slug}/{reportId})発行', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー5' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬5', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });
    await page.locator('#screen-archive .archive-new-btn').click();
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // 最低限の入力: ヒーロー日付を native date ピッカーで設定
    await page.locator('#heroDateInput').fill('2026-06-01');

    // 確定ボタン
    const commitBar = page.locator('#ponchi-commit-bar');
    await expect(commitBar).toBeVisible();
    await commitBar.locator('#ponchi-commit-ok').click();

    // 確認バーが表示される（「プレビューを確認 →」ボタン）
    const confirmBar = page.locator('#ponchi-confirm-bar');
    await expect(confirmBar).toBeVisible({ timeout: 5000 });
    await expect(confirmBar.locator('.ponchi-btn-pub')).toContainText('プレビュー');

    // プレビューへ進む
    await confirmBar.locator('.ponchi-btn-pub').click();

    // is-readonly が付与されて閲覧プレビューになる
    await expect(page.locator('body')).toHaveClass(/is-readonly/, { timeout: 5000 });

    // 確認バーに「確定（公開）」ボタン
    const publishBar = page.locator('#ponchi-confirm-bar');
    await expect(publishBar.locator('.ponchi-btn-pub')).toContainText('確定（公開）');

    // 公開
    await publishBar.locator('.ponchi-btn-pub').click();

    // 公開通知と公開URLリンク
    const notice = page.locator('.ponchi-publish-notice');
    await expect(notice).toBeVisible({ timeout: 10000 });
    const link = notice.locator('.ponchi-pub-link');
    await expect(link).toBeVisible();
    const pubUrl = await link.getAttribute('href');
    expect(pubUrl).toMatch(/^\/p\/[^/]+\/r-[0-9a-f]+$/);

    // 公開URLを記録
    page.__pubUrl = pubUrl;
    // グローバルに保存してテスト8で使う
    process.env.E2E_PUB_URL = pubUrl;
    process.env.E2E_PUB_SLUG = petSlug;
  });

  // ─── E2E-6: 各画面で「戻る」が1つ前へ ──────────────────────────────────
  test('E2E-6: 戻るボタンが機能する', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー6' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬6', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    // archive → 新規カルテ → report 画面
    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });
    await page.locator('#screen-archive .archive-new-btn').click();
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // report の「戻る」→ ガラスドロワーが開き 3 経路（飼い主/飼い犬/月選択）が出る
    await page.locator('#reportBackBtn').click();
    await expect(page.locator('#backDrawer')).toHaveClass(/is-open/, { timeout: 3000 });
    await expect(page.locator('#backDrawer [data-bd="owners"]')).toBeVisible();
    await expect(page.locator('#backDrawer [data-bd="owner"]')).toBeVisible();
    await expect(page.locator('#backDrawer [data-bd="paw"]')).toBeVisible();
    // 「月を選ぶ」→ 月選択ページ(paw)へ
    await page.locator('#backDrawer [data-bd="paw"]').click();
    await expect(page.locator('#screen-paw')).toBeVisible({ timeout: 5000 });
  });

  // ─── E2E-7: 既存月を開く → そのデータが出る（別の犬/月と混ざらない）───
  test('E2E-7: 既存カルテ開封 → 正しいデータが表示', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー7' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬7', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    // カルテを API で直接作成
    const reportPayload = {
      slug: petSlug,
      date: '2026/05/01',
      year: '2026',
      report: {
        pet: 'E2E犬7',
        date: '2026/05/01',
        year: '2026',
        bestWeight: '',
        options: [],
        weights: [],
        skin: [],
        bmTitle: '',
        bodyMarkingImage: '',
        trimming: { photos: [], comment: '' },
        bodyLanguage: { photos: [], comment: '' },
        teeth: { status: '', photo: '', diagram: '', comment: '' },
        ear: { right: 0, left: 0, comment: '' },
        nail: { level: 0, comment: '' },
        heroPhotos: [],
        bodyLanguagePhotos: [],
        template: 'ponchi',
      },
    };
    const pubResult = await apiFetch(`${BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportPayload),
    });
    const reportId = pubResult.reportId;

    // 編集: archive → 既存カルテをクリック
    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });

    // archive リストに既存カルテが表示される
    const archiveItem = page.locator('#screen-archive .archive-list .owner-pet-item').first();
    await expect(archiveItem).toBeVisible({ timeout: 5000 });
    await archiveItem.click();

    // report 画面が開き、正しいデータが表示される
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // E2E-7 の犬名が pet フィールドに反映される
    const petField = page.locator('[data-field="pet"]');
    await expect(petField).toHaveText('E2E犬7', { timeout: 5000 });
    const dateFieldCheck = page.locator('[data-field="date"]');
    await expect(dateFieldCheck).toHaveText('2026/05/01');
  });

  // ─── E2E-8: 公開URL閲覧 → 編集UI なし・内容表示 ─────────────────────
  test('E2E-8: 公開URL /p/{slug}/{reportId} 閲覧モード', async ({ page }) => {
    // API でカルテ作成
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー8' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬8', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    const pubResult = await apiFetch(`${BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: petSlug,
        date: '2026/06/01',
        year: '2026',
        report: {
          pet: 'E2E犬8',
          date: '2026/06/01',
          year: '2026',
          bestWeight: '3.0',
          options: [{ on: true }, { on: false }],
          weights: [{ ym: '2026-06', kg: 3.5 }],
          skin: [],
          bmTitle: '',
          bodyMarkingImage: '',
          trimming: { photos: [], comment: 'トリミングコメント8' },
          bodyLanguage: { photos: [], comment: '' },
          teeth: { status: '', photo: '', diagram: '', comment: '' },
          ear: { right: 0, left: 0, comment: '' },
          nail: { level: 0, comment: '' },
          heroPhotos: [],
          bodyLanguagePhotos: [],
          template: 'ponchi',
        },
      }),
    });
    const reportId = pubResult.reportId;
    const pubUrl = `/p/${petSlug}/${reportId}`;

    await page.goto(`${BASE}${pubUrl}`);
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 10000 });

    // __VIEW__ = true → is-readonly クラスなし（直接 body 確認）
    // Worker が window.__VIEW__=true を注入 → 編集UIが非表示
    // 確定バー・コミットバーが存在しないこと
    await expect(page.locator('#ponchi-commit-bar')).not.toBeVisible();
    await expect(page.locator('#ponchi-confirm-bar')).not.toBeVisible();

    // データが表示されていること: pet フィールド
    const petField = page.locator('[data-field="pet"]');
    await expect(petField).toHaveText('E2E犬8', { timeout: 8000 });
    const dateFieldCheck = page.locator('[data-field="date"]');
    await expect(dateFieldCheck).toHaveText('2026/06/01');

    // コンテンツ編集不可（contenteditable が false か属性がないこと、または is-readonly body）
    // 閲覧モードでは photo-upload-trigger が非表示
    const uploadTriggers = page.locator('.photo-upload-trigger');
    const count = await uploadTriggers.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(uploadTriggers.nth(i)).not.toBeVisible();
      }
    }
  });

  // ─── E2E-9: /o/{ownerSlug} → 犬一覧 → 肉球(月) → カルテ ─────────────
  test('E2E-9: /o/{ownerSlug} 閲覧フロー', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'E2Eオーナー9' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'E2E犬9', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    // カルテ作成
    const pubResult = await apiFetch(`${BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: petSlug,
        date: '2026/06/01',
        year: '2026',
        report: {
          pet: 'E2E犬9',
          date: '2026/06/01',
          year: '2026',
          bestWeight: '',
          options: [],
          weights: [],
          skin: [],
          bmTitle: '',
          bodyMarkingImage: '',
          trimming: { photos: [], comment: '' },
          bodyLanguage: { photos: [], comment: '' },
          teeth: { status: '', photo: '', diagram: '', comment: '' },
          ear: { right: 0, left: 0, comment: '' },
          nail: { level: 0, comment: '' },
          heroPhotos: [],
          bodyLanguagePhotos: [],
          template: 'ponchi',
        },
      }),
    });
    const reportId = pubResult.reportId;

    // /o/{ownerSlug} を開く
    await page.goto(`${BASE}/o/${ownerSlug}`);
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 10000 });

    // 犬一覧に E2E犬9 が表示
    const petItem = page.locator('#screen-owner .owner-pet-item').first();
    await expect(petItem).toBeVisible({ timeout: 5000 });
    await expect(petItem).toContainText('E2E犬9');

    // クリック → paw 画面（肉球）へ
    await petItem.click();
    await expect(page.locator('#screen-paw')).toBeVisible({ timeout: 8000 });

    // 肉球の pad（最新月）をクリック → report 画面へ
    const pad = page.locator('#screen-paw .pad');
    await expect(pad).toBeVisible();
    await pad.click();

    // report 画面表示
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 10000 });

    // 閲覧モードなので編集UIなし
    await expect(page.locator('#ponchi-commit-bar')).not.toBeVisible();
  });

});

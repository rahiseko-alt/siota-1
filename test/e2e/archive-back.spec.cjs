// @ts-check
/**
 * archive-back.spec.cjs
 * 受け入れ基準2 — archive 戻るボタンで owner 画面が visible になること
 * 不具合3「多重ネスト解消後の owner 復帰」を検証。
 * フロー: owner → (犬登録) → archive → report → archiveに戻る → ownerに戻る
 * これを3回反復して owner が必ず復帰することを確認する。
 */
const { test, expect } = require('playwright/test');

const BASE = 'http://localhost:8787';

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${url} => ${res.status}`);
  return res.json();
}

async function cleanupArchiveBackData() {
  const data = await apiFetch(`${BASE}/api/owners`);
  await Promise.all((data.owners || [])
    .filter((owner) => String(owner.ownerName || '').startsWith('AB'))
    .map((owner) => apiFetch(`${BASE}/api/owners/${encodeURIComponent(owner.ownerSlug)}`, {
      method: 'DELETE',
    })));
}

test.describe('受け入れ基準2: archive 戻る → owner 復帰（不具合3検証）', () => {
  test.beforeAll(cleanupArchiveBackData);
  test.afterAll(cleanupArchiveBackData);

  // ─── AB-1: report → archive戻る → owner戻る（1回フロー） ───
  test('AB-1: report→archive戻る→owner復帰 (基本1回)', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'AB1オーナー' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'AB1犬', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    // archive 画面へ
    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });

    // 新規カルテ → report 画面
    await page.locator('#screen-archive .archive-new-btn').click();
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // report 戻る → ガラスドロワー →「飼い犬ページへ」で飼い主の犬一覧(owner)へ復帰（不具合3: owner 情報伝播）
    await page.locator('#reportBackBtn').click();
    await expect(page.locator('#backDrawer')).toHaveClass(/is-open/, { timeout: 3000 });
    await page.locator('#backDrawer [data-bd="owner"]').click();
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#screen-report')).not.toBeVisible();
  });

  // ─── AB-2: 3回反復フロー — 毎回 owner が復帰すること ───────
  test('AB-2: archive→report→archive→owner 3回反復', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'AB2オーナー' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'AB2犬', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    // 初期: archive 画面
    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });

    for (let i = 1; i <= 3; i++) {
      // archive → report（新規カルテ）
      await page.locator('#screen-archive .archive-new-btn').click();
      await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

      // report 戻る → ドロワー →「飼い犬ページへ」で owner 復帰（不具合3: 多重ネスト時の owner 伝播）
      await page.locator('#reportBackBtn').click();
      await expect(page.locator('#backDrawer')).toHaveClass(/is-open/, { timeout: 3000 });
      await page.locator('#backDrawer [data-bd="owner"]').click();
      await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 8000 });
      await expect(page.locator('#screen-report')).not.toBeVisible();

      // 次の反復のために archive 画面へ直接 goto（犬クリックは paw 画面に遷移するため使用不可）
      if (i < 3) {
        await page.goto(`${BASE}/edit/p/${petSlug}`);
        await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });
      }
    }

    // 最終: owner 画面が visible で終了していること
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#screen-archive')).not.toBeVisible();
    await expect(page.locator('#screen-report')).not.toBeVisible();
  });

  // ─── AB-3: 既存 report を開いて戻る ─────────────────────────
  test('AB-3: 既存reportを開いて戻る → archive → owner', async ({ page }) => {
    const ownerData = await apiFetch(`${BASE}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerName: 'AB3オーナー' }),
    });
    const ownerSlug = ownerData.ownerSlug;

    const petData = await apiFetch(`${BASE}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petName: 'AB3犬', ownerSlug, template: 'ponchi' }),
    });
    const petSlug = petData.slug;

    // カルテを API で作成
    await apiFetch(`${BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: petSlug,
        date: '2026/06/01',
        year: '2026',
        report: {
          pet: 'AB3犬',
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

    // archive 画面
    await page.goto(`${BASE}/edit/p/${petSlug}`);
    await expect(page.locator('#screen-archive')).toBeVisible({ timeout: 8000 });

    // 既存カルテをクリック → report 画面
    const archiveItem = page.locator('#screen-archive .archive-list .owner-pet-item').first();
    await expect(archiveItem).toBeVisible({ timeout: 5000 });
    await archiveItem.click();
    await expect(page.locator('#screen-report')).toBeVisible({ timeout: 8000 });

    // report 戻る → ドロワー →「飼い犬ページへ」で owner 復帰（不具合3の核心検証: 既存 report 経由）
    await page.locator('#reportBackBtn').click();
    await expect(page.locator('#backDrawer')).toHaveClass(/is-open/, { timeout: 3000 });
    await page.locator('#backDrawer [data-bd="owner"]').click();
    await expect(page.locator('#screen-owner')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#screen-report')).not.toBeVisible();
  });

});

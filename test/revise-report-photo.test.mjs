/**
 * revise-report-photo.test.mjs — 「カルテ修正」で新しい画像（データURL）を保存できること
 *
 * `reviseReport()` は新しく行を作らないので、`uploadReportAssets()` が要る
 * `report.pet_id` / `report.shop_id` を手元に持っていなかった。前は
 * `{ id: reportId }` だけの器を渡しており、`buildAssetPath()` の UUID 検証で
 * 両方 `undefined` のまま毎回 `invalid asset context` に落ちていた。
 *
 * 犬体図に印がある回は、確定のたびに `exportBodyMarking()` が PNG を作り直す
 * （`bodyMarkingImage` は常に `data:image/...`）。つまり②③④の写真を一切
 * 触らなくても、犬体図さえ描いてあれば直しのたびにこの経路を踏む——
 * マスター報告「カルテの修正をしようと思ったら保存できないと言われた」の実体。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;

/* `buildAssetPath()` は保存先の4つとも UUID の形を要求する。試験用の名前
   （'pet-1' 等）は形が違うだけで別の理由で落ちるので、実在のUUIDと同じ形にする。 */
const ids = {
  shop: '10000000-0000-0000-0000-000000000001',
  pet: '40000000-0000-0000-0000-0000000000a1',
  report: '50000000-0000-0000-0000-0000000000a1',
};

async function loadStaff() {
  globalThis.document = {
    querySelector: () => null,
    addEventListener() {},
    createElement: () => ({
      style: {}, dataset: {}, classList: { add() {}, remove() {} }, append() {},
    }),
  };
  globalThis.window = { addEventListener() {} };
  await import('../backend/js/supabase-staff.js');
  return globalThis.TrimmerSupabaseStaff;
}

test('カルテ修正で犬体図の絵（データURL）を含めても保存できる', async () => {
  const staff = await loadStaff();
  const uploadedPaths = [];
  const apiCalls = [];

  globalThis.TrimmerAuth = {
    client: {
      storage: {
        from: () => ({
          upload: async (path) => { uploadedPaths.push(path); return { error: null }; },
        }),
      },
    },
  };
  const reportPath = `/api/pets/${ids.pet}/reports/${ids.report}`;
  globalThis.TrimmerStaffApi = {
    request: async (url, options) => {
      apiCalls.push(url);
      /* 直す元のカルテを取得する1回（今回の直し）。GET は options が付かない。 */
      if (url === reportPath && !options) {
        return { report: { id: ids.report, pet_id: ids.pet, shop_id: ids.shop, status: 'final' } };
      }
      if (url.endsWith('/assets')) {
        return { asset: { id: JSON.parse(options.body).id } };
      }
      if (url.endsWith('/revise')) {
        return { report: { id: ids.report } };
      }
      throw new Error(`想定外のURL: ${url}`);
    },
  };

  const revised = await staff.reviseReport(ids.pet, ids.report, {
    pet: 'X',
    bodyMarkingImage: DATA_URL,
  });

  assert.equal(revised.id, ids.report);
  assert.equal(uploadedPaths.length, 1);
  assert.match(
    uploadedPaths[0],
    new RegExp(`^${ids.shop}/${ids.pet}/${ids.report}/`),
    '保存先が実在の店舗・犬・カルテのIDで組まれていない',
  );
  assert.ok(apiCalls.includes(reportPath), '直す元のカルテを取得していない');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAssetPath,
  deleteReportAssets,
  replaceDataUrlAssets,
  uploadReportAssets,
  validateAsset,
  validateAssetContent,
} from '../src/js/supabase-storage.js';

const ids = {
  shop: '10000000-0000-0000-0000-000000000001',
  pet: '40000000-0000-0000-0000-0000000000a1',
  report: '50000000-0000-0000-0000-0000000000a1',
  asset: '60000000-0000-0000-0000-0000000000a1',
};

test('storage path is derived from the trusted report context', () => {
  assert.equal(buildAssetPath({
    shopId: ids.shop,
    petId: ids.pet,
    reportId: ids.report,
    assetId: ids.asset,
    mimeType: 'image/webp',
  }), `${ids.shop}/${ids.pet}/${ids.report}/${ids.asset}.webp`);
  assert.throws(() => buildAssetPath({
    shopId: ids.shop, petId: '../other', reportId: ids.report, assetId: ids.asset, mimeType: 'image/webp',
  }));
});

test('unsupported empty and oversized assets are rejected before upload', () => {
  assert.throws(() => validateAsset({ type: 'image/svg+xml', size: 1 }), /JPEG, PNG, WebP/);
  assert.throws(() => validateAsset({ type: 'image/jpeg', size: 0 }), /10 MiB/);
  assert.throws(() => validateAsset({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }), /10 MiB/);
  assert.equal(validateAsset({ type: 'image/png', size: 123 }), 'png');
});

test('MIME spoofing is rejected by image signature inspection', async () => {
  await assert.rejects(
    () => validateAssetContent(new Blob(['<svg></svg>'], { type: 'image/png' })),
    /内容と形式/,
  );
  const pngHeader = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(await validateAssetContent(new Blob([pngHeader], { type: 'image/png' })), true);
});

test('data URL photos become deduplicated asset markers and leave no Base64 in report JSON', async () => {
  const dataUrl = 'data:image/png;base64,eA==';
  let sequence = 0;
  const result = await replaceDataUrlAssets({
    pet: 'X',
    heroPhotos: [dataUrl, ''],
    bodyLanguage: { photos: [dataUrl] },
  }, { randomUUID: () => `60000000-0000-0000-0000-0000000000a${++sequence}` });

  assert.equal(result.assets.length, 1);
  assert.equal(result.data.heroPhotos[0], 'asset://60000000-0000-0000-0000-0000000000a1');
  assert.equal(result.data.bodyLanguage.photos[0], result.data.heroPhotos[0]);
  assert.equal(JSON.stringify(result.data).includes('data:image'), false);
  assert.equal(result.assets[0].blob.type, 'image/png');
  assert.equal(result.assets[0].blob.size, 1);
});

test('partial upload reports completed metadata and leaves the draft retryable', async () => {
  const uploads = [];
  const apiCalls = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path) => {
          uploads.push(path);
          return uploads.length === 1 ? { error: null } : { error: { message: 'temporary' } };
        },
      }),
    },
  };
  const api = async (path, options) => {
    apiCalls.push({ path, options });
    return { asset: { id: JSON.parse(options.body).id } };
  };
  const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const png = new Blob([pngBytes], { type: 'image/png' });
  await assert.rejects(
    () => uploadReportAssets({
      client,
      api,
      report: { id: ids.report, pet_id: ids.pet, shop_id: ids.shop, status: 'draft' },
      petId: ids.pet,
      assets: [
        { id: ids.asset, kind: 'hero.0', blob: png, mimeType: 'image/png', byteSize: png.size, sortOrder: 0 },
        { id: '60000000-0000-0000-0000-0000000000a2', kind: 'hero.1', blob: png, mimeType: 'image/png', byteSize: png.size, sortOrder: 1 },
      ],
    }),
    (error) => error.completedAssets.length === 1,
  );
  assert.equal(apiCalls.length, 1);
  assert.match(uploads[0], new RegExp(`^${ids.shop}/${ids.pet}/${ids.report}/`));
});

test('storage deletion failure never calls destructive completion', async () => {
  const apiCalls = [];
  const api = async (path) => {
    apiCalls.push(path);
    if (path.endsWith('/delete')) return {
      report: { shop_id: ids.shop },
      assets: [{ storage_path: `${ids.shop}/${ids.pet}/${ids.report}/${ids.asset}.webp` }],
    };
    return { ok: true };
  };
  const client = { storage: { from: () => ({
    list: async () => ({ data: [{ name: `${ids.asset}.webp` }], error: null }),
    remove: async () => ({ error: { message: 'temporary' } }),
  }) } };
  await assert.rejects(() => deleteReportAssets({ client, api, petId: ids.pet, reportId: ids.report }));
  assert.equal(apiCalls.length, 1);
  assert.ok(apiCalls[0].endsWith('/delete'));
});

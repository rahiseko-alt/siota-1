import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  buildAssetPath,
  deleteReportAssets,
  hydrateAssetReferences,
  purgeOwnerAssets,
  purgePetAssets,
  replaceDataUrlAssets,
  uploadReportAssets,
  validateAsset,
  validateAssetContent,
} from '../backend/js/supabase-storage.js';

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

/* ── 犬・飼い主を消す前の片付け（bad-scenarios-F3 #2 / D-20260824-34） ──
   順序が全て。犬を先に消すと FK カスケードで `reports` 行が消え、Storage ポリシー
   `private.storage_path_staff` の条件が偽になる。以後その写真は**誰も列挙も削除も
   できない**（回収は service_role のみ）。だから片付けは「Storage だけを触り、
   DB 行には一切触らない」「失敗したら投げて、犬の削除自体を止める」でなければならない。
   実行時に確かめる検査は作れない——削除後は「残っていても見えない」ので
   RLS 越しの確認は必ず合格する。ここでは**契約**を固定する。 */

/** 片付けが DB を触っていないことを見張る `api`。触ったら即座に落とす。 */
function makeApi(responses) {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET' });
    if ((options.method || 'GET') !== 'GET') {
      throw new Error(`片付けが DB を変更しようとした: ${options.method} ${path}`);
    }
    for (const [match, body] of responses) if (path.includes(match)) return body;
    return {};
  };
  return { api, calls };
}

test('犬の片付けは Storage だけを消し、DB 行には触らない', async () => {
  const removed = [];
  const client = { storage: { from: () => ({
    list: async (prefix) => (prefix.includes(ids.report)
      ? { data: [{ name: `${ids.asset}.webp` }], error: null }
      : { data: [{ name: ids.report }], error: null }),
    remove: async (paths) => { removed.push(...paths); return { error: null }; },
  }) } };
  const { api, calls } = makeApi([]);

  const result = await purgePetAssets({ client, api, petId: ids.pet, shopId: ids.shop });

  assert.equal(result.removed, 1);
  assert.deepEqual(removed, [`${ids.shop}/${ids.pet}/${ids.report}/${ids.asset}.webp`]);
  /* DB を変える呼び出しが1つも無いこと。shopId を渡したので読み取りすら要らない。 */
  assert.deepEqual(calls, []);
});

test('写真の削除に失敗したら投げる（犬の削除自体を止める）', async () => {
  const client = { storage: { from: () => ({
    list: async (prefix) => (prefix.includes(ids.report)
      ? { data: [{ name: `${ids.asset}.webp` }], error: null }
      : { data: [{ name: ids.report }], error: null }),
    remove: async () => ({ error: { message: 'temporary' } }),
  }) } };
  const { api } = makeApi([]);
  await assert.rejects(
    () => purgePetAssets({ client, api, petId: ids.pet, shopId: ids.shop }),
    /写真の削除を再試行/,
  );
});

test('写真の一覧が取れなかったら投げる（消えたと誤認しない）', async () => {
  const client = { storage: { from: () => ({
    list: async () => ({ data: null, error: { message: 'unreachable' } }),
    remove: async () => { throw new Error('ここへ来てはいけない'); },
  }) } };
  const { api } = makeApi([]);
  await assert.rejects(
    () => purgePetAssets({ client, api, petId: ids.pet, shopId: ids.shop }),
    /写真一覧の取得を再試行/,
  );
});

test('飼い主の片付けは、その飼い主の犬すべてを回る', async () => {
  const petB = '40000000-0000-0000-0000-0000000000b2';
  const removed = [];
  const client = { storage: { from: () => ({
    list: async (prefix) => (prefix.split('/').length >= 3
      ? { data: [{ name: `${ids.asset}.webp` }], error: null }
      : { data: [{ name: ids.report }], error: null }),
    remove: async (paths) => { removed.push(...paths); return { error: null }; },
  }) } };
  const { api, calls } = makeApi([
    ['/api/owners/', { owner: { shop_id: ids.shop, pets: [{ id: ids.pet }, { id: petB }] } }],
  ]);

  const result = await purgeOwnerAssets({ client, api, ownerId: 'owner-1' });

  assert.equal(result.removed, 2);
  assert.ok(removed.some((p) => p.includes(ids.pet)));
  assert.ok(removed.some((p) => p.includes(petB)));
  /* 読み取りだけ。DB を変える呼び出しは無い（あれば makeApi が投げている）。 */
  assert.ok(calls.every((c) => c.method === 'GET'));
});

/* ── 読み込めなかった写真を握りつぶさない（bad-scenarios-F3 #4） ──
   以前は download 失敗を `continue` で捨てており、失敗した写真は
   記録なし → マーカーが `''` → 枠ごと非表示、と流れて**最初から無かったように
   見えて**いた。店の人は「載せたはず」、飼い主は「載っていない」。
   1枚読めないだけでカルテ全体を止めるのは飼い主にとって損なので投げない。
   代わりに `failed` で必ず報告する。 */

/** download の成否を差し替えられる偽 client。 */
function makeHydrateClient(results) {
  return { storage: { from: () => ({
    download: async (storagePath) => results[storagePath]
      || { data: null, error: { message: 'not found' } },
  }) } };
}

/* Node の URL.createObjectURL は本物の Blob しか受け取らない。 */
const okBlob = { data: new Blob(['png']), error: null };

test('写真が読めなかったら、黙って消さずに報告する', async () => {
  const assets = [{ id: ids.asset, storage_path: 'a/b/c/one.webp' }];
  const client = makeHydrateClient({ 'a/b/c/one.webp': { data: null, error: { message: 'network' } } });

  const out = await hydrateAssetReferences({ photo: `asset://${ids.asset}` }, assets, client);

  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].id, ids.asset);
  assert.equal(out.failed[0].reason, 'network');
});

test('中身が空でも失敗として報告する（error が無くても見逃さない）', async () => {
  const assets = [{ id: ids.asset, storage_path: 'a/b/c/one.webp' }];
  const client = makeHydrateClient({ 'a/b/c/one.webp': { data: null, error: null } });

  const out = await hydrateAssetReferences({}, assets, client);

  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].reason, '中身が空でした');
});

test('読めた写真だけが URL になり、読めた分は失敗に数えない', async () => {
  const other = '60000000-0000-0000-0000-0000000000b2';
  const assets = [
    { id: ids.asset, storage_path: 'a/b/c/one.webp' },
    { id: other, storage_path: 'a/b/c/two.webp' },
  ];
  const client = makeHydrateClient({
    'a/b/c/one.webp': okBlob,
    'a/b/c/two.webp': { data: null, error: { message: 'gone' } },
  });

  const out = await hydrateAssetReferences(
    { good: `asset://${ids.asset}`, bad: `asset://${other}` }, assets, client,
  );

  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].id, other);
  assert.equal(out.objectUrls.length, 1);
  assert.notEqual(out.data.good, '');
});

test('全部読めたときは、失敗は 0 件', async () => {
  const assets = [{ id: ids.asset, storage_path: 'a/b/c/one.webp' }];
  const client = makeHydrateClient({ 'a/b/c/one.webp': okBlob });

  const out = await hydrateAssetReferences({ photo: `asset://${ids.asset}` }, assets, client);

  assert.deepEqual(out.failed, []);
});

test('呼び出し側が failed を必ず見ている（握りつぶしに戻っていない）', async () => {
  const auth = await readFile(new URL('../backend/js/supabase-auth.js', import.meta.url), 'utf8');
  assert.match(auth, /hydrated\.failed/, '飼い主の画面が failed を読んでいない');
  assert.match(auth, /showAssetFailures/, '読み込めなかった写真を見せる導線が無い');
});

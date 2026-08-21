const EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_MARKER_PATTERN = /^asset:\/\/([0-9a-f-]{36})$/i;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export function validateAsset(file) {
  const extension = EXTENSIONS.get(file?.type);
  if (!extension) throw new Error('JPEG, PNG, WebP のみアップロードできます');
  if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > MAX_ASSET_BYTES) {
    throw new Error('画像は10 MiB以下にしてください');
  }
  return extension;
}

export async function validateAssetContent(file) {
  validateAsset(file);
  if (typeof file.slice !== 'function') throw new Error('画像ファイルを読み取れません');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = file.type === 'image/png'
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const isWebp = file.type === 'image/webp'
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new Error('画像の内容と形式が一致しません');
  return true;
}

export function buildAssetPath({ shopId, petId, reportId, assetId, mimeType }) {
  for (const value of [shopId, petId, reportId, assetId]) {
    if (!UUID_PATTERN.test(value || '')) throw new TypeError('invalid asset context');
  }
  const extension = EXTENSIONS.get(mimeType);
  if (!extension) throw new TypeError('invalid asset type');
  return `${shopId}/${petId}/${reportId}/${assetId}.${extension}`;
}

function dataUrlBlob(value) {
  const match = String(value).match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('JPEG, PNG, WebP のBase64画像だけを変換できます');
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error('画像データが壊れています');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: match[1].toLowerCase() });
  validateAsset(blob);
  return blob;
}

function assetKind(path) {
  return path.join('.').replace(/[^a-z0-9_.-]/gi, '-').slice(0, 40) || 'image';
}

export async function replaceDataUrlAssets(
  reportData,
  { randomUUID = () => crypto.randomUUID() } = {},
) {
  const assets = [];
  const seen = new Map();

  function visit(value, path = []) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      if (seen.has(value)) return seen.get(value);
      const id = randomUUID();
      if (!UUID_PATTERN.test(id)) throw new TypeError('invalid generated asset id');
      const blob = dataUrlBlob(value);
      const marker = `asset://${id}`;
      assets.push({ id, kind: assetKind(path), blob, mimeType: blob.type, byteSize: blob.size, sortOrder: assets.length });
      seen.set(value, marker);
      return marker;
    }
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, [...path, String(index)]));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry, [...path, key])]));
    }
    return value;
  }

  return { data: visit(reportData), assets };
}

export async function uploadReportAssets({
  client,
  api,
  report,
  petId,
  assets,
  bucket = 'report-assets',
}) {
  if (!client || typeof api !== 'function' || report?.pet_id !== petId) throw new TypeError('invalid report context');
  const completed = [];
  try {
    for (const asset of assets) {
      await validateAssetContent(asset.blob);
      const storagePath = buildAssetPath({
        shopId: report.shop_id,
        petId,
        reportId: report.id,
        assetId: asset.id,
        mimeType: asset.mimeType,
      });
      if (!asset.uploaded) {
        const { error } = await client.storage.from(bucket).upload(storagePath, asset.blob, {
          contentType: asset.mimeType,
          upsert: false,
        });
        if (error) throw new Error('画像を保存できませんでした');
        asset.uploaded = true;
      }
      if (!asset.registered) {
        const response = await api(`/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(report.id)}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: asset.id,
            kind: asset.kind,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            sortOrder: asset.sortOrder,
          }),
        });
        asset.registered = true;
        asset.metadata = { ...response.asset, storage_path: storagePath };
      }
      completed.push(asset.metadata);
    }
    return completed;
  } catch (error) {
    error.completedAssets = completed;
    throw error;
  }
}

async function replaceMarkers(value, urls) {
  if (typeof value === 'string') {
    const match = value.match(ASSET_MARKER_PATTERN);
    return match ? (urls.get(match[1]) || '') : value;
  }
  if (Array.isArray(value)) return Promise.all(value.map((entry) => replaceMarkers(entry, urls)));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await replaceMarkers(entry, urls)]));
    return Object.fromEntries(entries);
  }
  return value;
}

export async function hydrateAssetReferences(data, assets, client, bucket = 'report-assets') {
  const urls = new Map();
  const objectUrls = [];
  for (const asset of assets || []) {
    const { data: blob, error } = await client.storage.from(bucket).download(asset.storage_path);
    if (error || !blob) continue;
    const url = URL.createObjectURL(blob);
    urls.set(asset.id, url);
    objectUrls.push(url);
  }
  return { data: await replaceMarkers(data, urls), objectUrls };
}

export async function deleteReportAssets({ client, api, petId, reportId, bucket = 'report-assets' }) {
  const deleting = await api(`/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(reportId)}/delete`, {
    method: 'POST',
  });
  const report = deleting.report;
  const prefix = `${report.shop_id}/${petId}/${reportId}`;
  const storage = client.storage.from(bucket);
  const { data: listed, error: listError } = await storage.list(prefix, { limit: 1000 });
  if (listError) throw new Error('画像一覧の取得を再試行してください');
  const paths = Array.from(new Set([
    ...(deleting.assets || []).map((asset) => asset.storage_path),
    ...(listed || []).filter((item) => item?.name).map((item) => `${prefix}/${item.name}`),
  ]));
  if (paths.length > 0) {
    const { error } = await storage.remove(paths);
    if (error) throw new Error('画像削除を再試行してください');
  }
  await api(`/api/pets/${encodeURIComponent(petId)}/reports/${encodeURIComponent(reportId)}/delete/complete`, {
    method: 'POST',
  });
  return { ok: true };
}

globalThis.TrimmerSupabaseStorage = {
  deleteReportAssets,
  hydrateAssetReferences,
  replaceDataUrlAssets,
  uploadReportAssets,
};

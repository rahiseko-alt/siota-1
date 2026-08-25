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

/**
 * purgePetAssets({ client, api, petId })
 *
 * 犬を消す**前に**、その犬の写真を Storage から片付ける。
 *
 * **順序が全て。** Storage のポリシー `private.storage_path_staff` は
 * 「その `reports` 行が存在すること」を条件にしている:
 *
 *   select exists (select 1 from public.reports report
 *     join public.pets pet on ... where report.id = (パスの3階層目) and private.is_shop_staff(...))
 *
 * 一方 `DELETE /rest/v1/pets` は FK カスケード（pets → reports → report_assets）で
 * その行を消す。つまり犬を先に消すと、**写真は残るのに、その瞬間から誰も
 * 列挙も削除もできなくなる**——スタッフも飼い主も、SELECT が false になるので
 * 見ることすらできない。回収は service_role（ダッシュボード）でしか出来ず、
 * どのオブジェクトが孤児かを示す `report_assets.storage_path` も一緒に消えている。
 * 「削除したのに写真が残る」は個人情報の扱いとして通らない。
 *
 * ここでやるのは Storage の掃除だけで、DB 行には触れない（カスケードに任せる）。
 * 失敗したら例外を投げ、**犬の削除自体を止める**。中途半端に消えるより、
 * 何も消えずにもう一度押せるほうがよい。
 *
 * 一覧は `reports` テーブルではなく Storage の実体を辿る。`status='deleting'` で
 * 止まったカルテ（一覧から消えているもの）や、過去の中断で取り残された孤児も、
 * こちらなら拾えるため。
 */
async function listPetObjectPaths({ client, shopId, petId, bucket }) {
  const storage = client.storage.from(bucket);
  const prefix = `${shopId}/${petId}`;
  const { data: folders, error: folderError } = await storage.list(prefix, { limit: 1000 });
  if (folderError) throw new Error('写真一覧の取得を再試行してください');
  const paths = [];
  for (const folder of folders || []) {
    if (!folder?.name) continue;
    /* Supabase の list は、直下のオブジェクトと擬似フォルダを混ぜて返す。
       カルテIDのフォルダも、直置きのファイルも、どちらも起こりうる形で扱う。 */
    const { data: files, error } = await storage.list(`${prefix}/${folder.name}`, { limit: 1000 });
    if (error) throw new Error('写真一覧の取得を再試行してください');
    if ((files || []).length === 0) { paths.push(`${prefix}/${folder.name}`); continue; }
    for (const file of files) {
      if (file?.name) paths.push(`${prefix}/${folder.name}/${file.name}`);
    }
  }
  return paths;
}

export async function purgePetAssets({ client, api, petId, shopId, bucket = 'report-assets' }) {
  let shop = shopId;
  if (!shop) {
    const body = await api(`/api/pets/${encodeURIComponent(petId)}`);
    shop = body?.pet?.shop_id;
  }
  if (!shop) throw new Error('犬の情報を読み取れませんでした');
  const paths = await listPetObjectPaths({ client, shopId: shop, petId, bucket });
  if (paths.length === 0) return { removed: 0 };
  const { error } = await client.storage.from(bucket).remove(paths);
  if (error) throw new Error('写真の削除を再試行してください');
  return { removed: paths.length };
}

/** 飼い主を消す前に、その飼い主の犬すべての写真を片付ける。理由は purgePetAssets と同じ。 */
export async function purgeOwnerAssets({ client, api, ownerId, bucket = 'report-assets' }) {
  const body = await api(`/api/owners/${encodeURIComponent(ownerId)}`);
  const owner = body?.owner;
  if (!owner?.shop_id) throw new Error('飼い主の情報を読み取れませんでした');
  let removed = 0;
  for (const pet of owner.pets || []) {
    if (!pet?.id) continue;
    const result = await purgePetAssets({ client, api, petId: pet.id, shopId: owner.shop_id, bucket });
    removed += result.removed;
  }
  return { removed };
}

globalThis.TrimmerSupabaseStorage = {
  deleteReportAssets,
  hydrateAssetReferences,
  purgeOwnerAssets,
  purgePetAssets,
  replaceDataUrlAssets,
  uploadReportAssets,
};

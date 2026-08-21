import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const DATA_IMAGE_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i;

export class MigrationValidationError extends Error {
  constructor(issues) {
    super('KV export validation failed');
    this.name = 'MigrationValidationError';
    this.code = 'validation_failed';
    this.issues = issues;
  }
}

export async function collectAllKeys(listPage) {
  const keys = [];
  const seenCursors = new Set();
  let cursor;
  while (true) {
    const page = await listPage(cursor);
    if (!page || !Array.isArray(page.keys)) throw new TypeError('invalid KV list page');
    keys.push(...page.keys);
    if (page.list_complete) return keys;
    if (!page.cursor || seenCursors.has(page.cursor)) throw new Error('KV list cursor did not advance');
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableUuid(seed) {
  const hex = sha256(seed).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function entity(entityType, legacyKey, payload, options = {}) {
  const sourceHash = options.sourceHash || sha256(canonicalJson(payload));
  const targetSeed = options.targetSeed
    || `${entityType}:${legacyKey}${options.versioned ? `:${sourceHash}` : ''}`;
  return {
    entityType,
    legacyKey,
    targetId: stableUuid(targetSeed),
    sourceHash,
    payload,
  };
}

function normalizeDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function decodeImage(value, path, issues) {
  const match = String(value).match(DATA_IMAGE_PATTERN);
  if (!match) {
    issues.push({ path, code: 'unsupported_image' });
    return null;
  }
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    issues.push({ path, code: 'invalid_base64' });
    return null;
  }
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
    issues.push({ path, code: 'invalid_base64' });
    return null;
  }
  const mimeType = match[1].toLowerCase();
  const signatureValid = (
    (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mimeType === 'image/png' && Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(bytes.subarray(0, 8)))
    || (mimeType === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
  );
  if (!signatureValid || bytes.length > 10 * 1024 * 1024) {
    issues.push({ path, code: !signatureValid ? 'mime_mismatch' : 'image_too_large' });
    return null;
  }
  return { bytes, mimeType, byteSize: bytes.length, sha256: sha256(bytes) };
}

function extractImages(reportLegacyKey, reportTargetId, data, issues) {
  const assets = [];
  function visit(value, path = []) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      const location = path.join('.') || 'image';
      const decoded = decodeImage(value, `${reportLegacyKey}:${location}`, issues);
      if (!decoded) return value;
      const legacyKey = `${reportLegacyKey}:${location}`;
      const asset = entity('assets', legacyKey, {
        reportLegacyKey,
        reportTargetId,
        kind: location.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 40),
        mimeType: decoded.mimeType,
        byteSize: decoded.byteSize,
        sha256: decoded.sha256,
      }, { targetSeed: `assets:${legacyKey}:${reportTargetId}:${decoded.sha256}` });
      assets.push({
        ...asset,
        bytes: decoded.bytes,
        mimeType: decoded.mimeType,
        byteSize: decoded.byteSize,
        sha256: decoded.sha256,
      });
      return `asset://${asset.targetId}`;
    }
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, [...path, String(index)]));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry, [...path, key])]));
    }
    return value;
  }
  return { data: visit(data), assets };
}

function listedNames(document, issues) {
  const names = [];
  const seen = new Set();
  const pages = Array.isArray(document.pages) ? document.pages : [];
  if (pages.length === 0 || pages.at(-1)?.list_complete !== true) {
    issues.push({ path: 'pages', code: 'incomplete_key_listing' });
  }
  for (const [pageIndex, page] of pages.entries()) {
    for (const key of page.keys || []) {
      const name = String(key?.name || '');
      if (!name) issues.push({ path: `pages[${pageIndex}]`, code: 'invalid_key' });
      else if (seen.has(name)) issues.push({ path: name, code: 'duplicate_legacy_key' });
      else {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

export async function parseKvExport(document) {
  const issues = [];
  if (document?.format !== 'trimmer-kv-export-v1') issues.push({ path: 'format', code: 'unsupported_format' });
  const values = document?.values && typeof document.values === 'object' ? document.values : {};
  const names = listedNames(document || {}, issues);
  for (const name of names) {
    if (!(name in values)) issues.push({ path: name, code: 'missing_value' });
  }

  const owners = [];
  const ownerByKey = new Map();
  for (const name of names.filter((key) => /^owners\/[^/]+\.json$/.test(key))) {
    const value = values[name];
    if (!value || typeof value !== 'object') continue;
    const legacyKey = name.slice('owners/'.length, -'.json'.length);
    const owner = entity('owners', legacyKey, { name: String(value.ownerName || '').trim() });
    owner.petLegacyKeys = (value.pets || []).map((pet) => String(pet.slug || '')).filter(Boolean);
    owners.push(owner);
    ownerByKey.set(legacyKey, owner);
  }
  const ownerIndexKeys = new Set();
  for (const entry of values['index/owners.json']?.owners || []) {
    const legacyKey = String(entry?.ownerSlug || '');
    if (!legacyKey || ownerIndexKeys.has(legacyKey)) {
      issues.push({ path: 'index/owners.json', code: 'duplicate_legacy_key' });
    } else {
      ownerIndexKeys.add(legacyKey);
      if (!ownerByKey.has(legacyKey)) issues.push({ path: 'index/owners.json', code: 'missing_owner' });
    }
  }
  for (const legacyKey of ownerByKey.keys()) {
    if (!ownerIndexKeys.has(legacyKey)) issues.push({ path: `owners/${legacyKey}.json`, code: 'missing_owner_index' });
  }

  const pets = [];
  const petByKey = new Map();
  for (const name of names.filter((key) => /^customers\/[^/]+\.json$/.test(key))) {
    const value = values[name];
    if (!value || typeof value !== 'object') continue;
    const legacyKey = name.slice('customers/'.length, -'.json'.length);
    const ownerLegacyKey = String(value.ownerSlug || '');
    if (!ownerByKey.has(ownerLegacyKey)) issues.push({ path: name, code: 'missing_owner' });
    const pet = entity('pets', legacyKey, {
      ownerLegacyKey,
      name: String(value.petName || '').trim(),
      template: String(value.template || 'ponchi'),
    });
    pet.ownerLegacyKey = ownerLegacyKey;
    pet.reportRefs = Object.values(value.months || {}).flat().map((entry) => ({
      reportId: String(entry?.reportId || ''),
      date: entry?.date,
    }));
    pets.push(pet);
    petByKey.set(legacyKey, pet);
  }
  const customerIndexKeys = new Set();
  for (const entry of values['index/customers.json']?.customers || []) {
    const legacyKey = String(entry?.slug || '');
    if (!legacyKey || customerIndexKeys.has(legacyKey)) {
      issues.push({ path: 'index/customers.json', code: 'duplicate_legacy_key' });
    } else {
      customerIndexKeys.add(legacyKey);
      if (!petByKey.has(legacyKey)) issues.push({ path: 'index/customers.json', code: 'missing_pet' });
    }
  }
  for (const legacyKey of petByKey.keys()) {
    if (!customerIndexKeys.has(legacyKey)) issues.push({ path: `customers/${legacyKey}.json`, code: 'missing_customer_index' });
  }

  for (const owner of owners) {
    for (const petKey of owner.petLegacyKeys) {
      if (!petByKey.has(petKey)) issues.push({ path: `owners/${owner.legacyKey}.json`, code: 'missing_pet' });
      else if (petByKey.get(petKey).ownerLegacyKey !== owner.legacyKey) {
        issues.push({ path: `owners/${owner.legacyKey}.json`, code: 'owner_pet_mismatch' });
      }
    }
  }

  const reports = [];
  const assets = [];
  const referencedReports = new Set();
  const seenReportLegacyKeys = new Set();
  for (const pet of pets) {
    for (const reference of pet.reportRefs) {
      const name = `reports/${pet.legacyKey}/${reference.reportId}.json`;
      referencedReports.add(name);
      const value = values[name];
      if (!value) {
        issues.push({ path: `customers/${pet.legacyKey}.json:${reference.reportId}`, code: 'missing_report' });
        continue;
      }
      const reportDate = normalizeDate(value.date || reference.date);
      if (!reportDate) issues.push({ path: name, code: 'invalid_report_date' });
      const reportLegacyKey = `${pet.legacyKey}/${reference.reportId}`;
      if (seenReportLegacyKeys.has(reportLegacyKey)) {
        issues.push({ path: `customers/${pet.legacyKey}.json:${reference.reportId}`, code: 'duplicate_legacy_key' });
        continue;
      }
      seenReportLegacyKeys.add(reportLegacyKey);
      const rawReportHash = sha256(canonicalJson({
        petLegacyKey: pet.legacyKey,
        reportDate,
        data: value.report || {},
      }));
      const reportTargetId = stableUuid(`reports:${reportLegacyKey}:${rawReportHash}`);
      const extracted = extractImages(reportLegacyKey, reportTargetId, value.report || {}, issues);
      assets.push(...extracted.assets);
      const report = entity('reports', reportLegacyKey, {
        petLegacyKey: pet.legacyKey,
        reportDate,
        data: extracted.data,
      }, { sourceHash: rawReportHash, targetSeed: `reports:${reportLegacyKey}:${rawReportHash}` });
      report.petLegacyKey = pet.legacyKey;
      reports.push(report);
    }
  }
  for (const name of names.filter((key) => /^reports\/[^/]+\/[^/]+\.json$/.test(key))) {
    if (!referencedReports.has(name)) issues.push({ path: name, code: 'orphan_report' });
  }

  const summary = {
    owners: owners.length,
    pets: pets.length,
    reports: reports.length,
    assets: assets.length,
    assetBytes: assets.reduce((total, asset) => total + asset.payload.byteSize, 0),
    issues: issues.map(({ path, code }) => ({ path, code })),
  };
  return { owners, pets, reports, assets, issues, summary };
}

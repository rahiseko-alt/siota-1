import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';

import { sha256 } from './kv-export-parser.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for execute mode`);
  return value;
}

function accepted(data, error) {
  if (error) throw new Error('Supabase migration operation was rejected');
  return data;
}

export function createSupabaseMigrationTarget({ environment }) {
  if (!['local', 'development'].includes(environment)) throw new Error('production target is prohibited');
  const supabaseUrl = required(environment === 'local' ? 'SUPABASE_LOCAL_URL' : 'SUPABASE_URL');
  const publishableKey = required('SUPABASE_PUBLISHABLE_KEY');
  const accessToken = required('SUPABASE_ACCESS_TOKEN');
  const shopId = required('MIGRATION_SHOP_ID');
  if (!UUID_PATTERN.test(shopId)) throw new Error('MIGRATION_SHOP_ID must be a UUID');
  const bucket = process.env.SUPABASE_REPORT_ASSETS_BUCKET || 'report-assets';
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const maps = {};
  const pendingReports = new Set();

  return {
    environment,
    async configure(parsed) {
      for (const type of ['owners', 'pets', 'reports', 'assets']) {
        maps[type] = new Map(parsed[type].map((entry) => [entry.legacyKey, entry]));
      }
      for (const report of parsed.reports) pendingReports.add(report.targetId);
    },
    async readLedger(entityType, legacyKey) {
      const { data, error } = await client.rpc('read_import_ledger', {
        target_shop: shopId,
        target_entity_type: entityType,
        target_legacy_key: legacyKey,
      });
      const row = accepted(data, error);
      return row ? { targetId: row.target_id, sourceHash: row.source_hash } : null;
    },
    async upsertEntity(entity, previous) {
      if (entity.entityType === 'owners') {
        const result = await client.from('owners').upsert({
          id: entity.targetId, shop_id: shopId, name: entity.payload.name, active: true,
        }, { onConflict: 'id' });
        accepted(result.data, result.error);
      } else if (entity.entityType === 'pets') {
        const owner = maps.owners.get(entity.payload.ownerLegacyKey);
        const result = await client.from('pets').upsert({
          id: entity.targetId,
          shop_id: shopId,
          owner_id: owner.targetId,
          name: entity.payload.name,
          template: entity.payload.template,
          active: true,
        }, { onConflict: 'id' });
        accepted(result.data, result.error);
      } else if (entity.entityType === 'reports') {
        if (previous?.targetId && previous.targetId !== entity.targetId) {
          const archived = await client.rpc('archive_report', { target_report: previous.targetId });
          accepted(archived.data, archived.error);
        }
        const pet = maps.pets.get(entity.payload.petLegacyKey);
        const result = await client.from('reports').upsert({
          id: entity.targetId,
          shop_id: shopId,
          pet_id: pet.targetId,
          report_date: entity.payload.reportDate,
          status: 'draft',
          data: entity.payload.data,
        }, { onConflict: 'id' });
        accepted(result.data, result.error);
        pendingReports.add(entity.targetId);
      } else if (entity.entityType === 'assets') {
        const report = maps.reports.get(entity.payload.reportLegacyKey);
        const pet = maps.pets.get(report.payload.petLegacyKey);
        const extension = EXTENSIONS[entity.payload.mimeType];
        const storagePath = `${shopId}/${pet.targetId}/${report.targetId}/${entity.targetId}.${extension}`;
        const storage = client.storage.from(bucket);
        const uploaded = await storage.upload(storagePath, entity.bytes, {
          contentType: entity.payload.mimeType,
          upsert: false,
        });
        if (uploaded.error) {
          const existing = await storage.download(storagePath);
          if (existing.error || sha256(Buffer.from(await existing.data.arrayBuffer())) !== entity.payload.sha256) {
            throw new Error('Supabase migration asset upload was rejected');
          }
        }
        const registered = await client.rpc('register_report_asset', {
          target_report: report.targetId,
          target_asset: entity.targetId,
          target_kind: entity.payload.kind,
          target_mime: entity.payload.mimeType,
          target_size: entity.payload.byteSize,
          target_sort: 0,
        });
        accepted(registered.data, registered.error);
      }
      return entity.targetId;
    },
    async writeLedger(entity) {
      const result = await client.rpc('write_import_ledger', {
        target_shop: shopId,
        target_entity_type: entity.entityType,
        target_legacy_key: entity.legacyKey,
        target_row: entity.targetId,
        target_source_hash: entity.sourceHash,
      });
      accepted(result.data, result.error);
    },
    async finalize() {
      for (const reportId of pendingReports) {
        const current = await client.from('reports').select('status').eq('id', reportId).maybeSingle();
        const report = accepted(current.data, current.error);
        if (report?.status === 'final') continue;
        if (report?.status !== 'draft') throw new Error('Supabase migration report is unavailable');
        const result = await client.rpc('finalize_report', { target_report: reportId });
        if (!accepted(result.data, result.error)) throw new Error('Supabase migration report assets are incomplete');
      }
    },
    async counts() {
      const result = await client.rpc('count_import_ledger', { target_shop: shopId });
      const rows = accepted(result.data, result.error) || [];
      const counts = { owners: 0, pets: 0, reports: 0, assets: 0 };
      for (const row of rows) if (row.entity_type in counts) counts[row.entity_type] = Number(row.total);
      return counts;
    },
  };
}

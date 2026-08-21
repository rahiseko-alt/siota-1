import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { MigrationValidationError, parseKvExport } from './lib/kv-export-parser.mjs';

const ENTITY_TYPES = ['owners', 'pets', 'reports', 'assets'];

function zeroCounts() {
  return { owners: 0, pets: 0, reports: 0, assets: 0, total: 0 };
}

export function createMemoryTarget({ environment = 'local' } = {}) {
  if (environment === 'production') throw new Error('production target is prohibited');
  const rows = Object.fromEntries(ENTITY_TYPES.map((type) => [type, new Map()]));
  const ledger = new Map();
  return {
    environment,
    rows,
    ledger,
    writeCount: 0,
    async configure() {},
    async readLedger(entityType, legacyKey) {
      return ledger.get(`${entityType}:${legacyKey}`) || null;
    },
    async upsertEntity(entity) {
      rows[entity.entityType].set(entity.legacyKey, entity);
      this.writeCount += 1;
      return entity.targetId;
    },
    async writeLedger(entity) {
      ledger.set(`${entity.entityType}:${entity.legacyKey}`, {
        targetId: entity.targetId,
        sourceHash: entity.sourceHash,
      });
      this.writeCount += 1;
    },
    async finalize() {},
    async counts() {
      return Object.fromEntries(ENTITY_TYPES.map((type) => [type, rows[type].size]));
    },
  };
}

export async function migrateParsedExport({ parsed, target, dryRun = true }) {
  if (!parsed || !target) throw new TypeError('parsed source and target are required');
  if (parsed.issues.length > 0) throw new MigrationValidationError(parsed.issues);
  const inserted = zeroCounts();
  const updated = zeroCounts();
  const skipped = zeroCounts();
  let writes = 0;

  if (!dryRun) await target.configure(parsed);
  for (const entityType of ENTITY_TYPES) {
    for (const current of parsed[entityType]) {
      if (dryRun) {
        inserted[entityType] += 1;
        continue;
      }
      const previous = await target.readLedger(entityType, current.legacyKey);
      if (previous?.sourceHash === current.sourceHash) {
        skipped[entityType] += 1;
        continue;
      }
      await target.upsertEntity(current, previous);
      await target.writeLedger(current);
      writes += 2;
      if (previous) updated[entityType] += 1;
      else inserted[entityType] += 1;
    }
  }
  if (!dryRun) await target.finalize(parsed);

  for (const counts of [inserted, updated, skipped]) {
    counts.total = ENTITY_TYPES.reduce((total, type) => total + counts[type], 0);
  }
  const sourceCounts = Object.fromEntries(ENTITY_TYPES.map((type) => [type, parsed[type].length]));
  const targetCounts = dryRun ? { ...sourceCounts } : await target.counts();
  return {
    dryRun,
    writes,
    inserted,
    updated,
    skipped,
    duplicates: 0,
    reconciliation: Object.fromEntries(ENTITY_TYPES.map((type) => [type, {
      source: sourceCounts[type],
      target: targetCounts[type],
    }])),
    assets: {
      count: parsed.assets.length,
      bytes: parsed.assets.reduce((total, asset) => total + asset.payload.byteSize, 0),
      hashes: parsed.assets.map((asset) => asset.payload.sha256),
    },
  };
}

export function parseMigrationArguments(argv) {
  const args = { dryRun: false, execute: false, target: null, source: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--execute') args.execute = true;
    else if (value === '--source') args.source = argv[++index];
    else if (value === '--target') args.target = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.source) throw new Error('--source is required');
  if (args.dryRun === args.execute) throw new Error('choose exactly one of --dry-run or --execute');
  if (args.execute && !['local', 'development'].includes(args.target)) {
    throw new Error(args.target === 'production' ? 'production target is prohibited' : '--target local|development is required');
  }
  return args;
}

async function runCli() {
  const args = parseMigrationArguments(process.argv.slice(2));
  const source = JSON.parse(await readFile(args.source, 'utf8'));
  const parsed = await parseKvExport(source);
  let target;
  if (args.execute) {
    const { createSupabaseMigrationTarget } = await import('./lib/supabase-migration-target.mjs');
    target = createSupabaseMigrationTarget({ environment: args.target });
  } else {
    target = createMemoryTarget();
  }
  const result = await migrateParsedExport({ parsed, target, dryRun: args.dryRun });
  process.stdout.write(`${JSON.stringify({ ...result, issues: parsed.summary.issues }, null, 2)}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch((error) => {
    const issues = error instanceof MigrationValidationError ? error.issues : [];
    process.stderr.write(`${JSON.stringify({ error: error.code || 'migration_failed', issues })}\n`);
    process.exitCode = 1;
  });
}

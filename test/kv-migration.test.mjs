import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  collectAllKeys,
  parseKvExport,
} from '../scripts/lib/kv-export-parser.mjs';
import {
  createMemoryTarget,
  migrateParsedExport,
  parseMigrationArguments,
} from '../scripts/migrate-kv-to-supabase.mjs';

const fixtureUrl = new URL('./fixtures/kv-export.json', import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function manyReportsExport(count = 1001) {
  const values = {
    'index/owners.json': { owners: [{ ownerSlug: 'a' }] },
    'owners/a.json': { ownerSlug: 'a', ownerName: 'sample owner', pets: [{ slug: 'x' }] },
    'index/customers.json': { customers: [{ slug: 'x' }] },
  };
  const reportRefs = [];
  for (let index = 0; index < count; index += 1) {
    const reportId = `r${String(index).padStart(4, '0')}`;
    reportRefs.push({ reportId, date: '2026/07/16' });
    values[`reports/x/${reportId}.json`] = {
      reportId,
      date: '2026/07/16',
      report: { pet: 'X', memo: `sample ${index}` },
    };
  }
  values['customers/x.json'] = {
    slug: 'x', petName: 'X', ownerSlug: 'a', template: 'ponchi', months: { '2026-07': reportRefs },
  };
  const names = Object.keys(values);
  return {
    format: 'trimmer-kv-export-v1',
    pages: [
      { keys: names.slice(0, 1000).map((name) => ({ name })), cursor: 'page-2', list_complete: false },
      { keys: names.slice(1000).map((name) => ({ name })), list_complete: true },
    ],
    values,
  };
}

test('walks every KV page without stopping at the 1000-key boundary', async () => {
  const source = manyReportsExport();
  const pages = new Map([[undefined, source.pages[0]], ['page-2', source.pages[1]]]);
  const keys = await collectAllKeys(async (cursor) => pages.get(cursor));
  assert.equal(keys.length, Object.keys(source.values).length);
  assert.equal(keys.filter((key) => key.name.startsWith('reports/')).length, 1001);
});

test('parses A to X Y Z, extracts image hashes, and reports no personal data', async () => {
  const parsed = await parseKvExport(await fixture());
  assert.deepEqual(parsed.owners.find((owner) => owner.legacyKey === 'a').petLegacyKeys, ['x', 'y', 'z']);
  assert.equal(parsed.reports.length, 1);
  assert.equal(parsed.assets.length, 1);
  assert.match(parsed.assets[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(parsed.assets[0].byteSize, 12);
  assert.equal(JSON.stringify(parsed.summary).includes('サンプルA'), false);
});

test('rerun imports 1001 reports with zero duplicate rows', async () => {
  const parsed = await parseKvExport(manyReportsExport());
  const target = createMemoryTarget();
  const first = await migrateParsedExport({ parsed, target, dryRun: false });
  const second = await migrateParsedExport({ parsed, target, dryRun: false });
  assert.equal(first.reconciliation.reports.source, 1001);
  assert.equal(first.reconciliation.reports.target, 1001);
  assert.equal(second.inserted.total, 0);
  assert.equal(second.updated.total, 0);
  assert.equal(second.duplicates, 0);
});

test('changed source hash updates only the changed legacy entity', async () => {
  const source = await fixture();
  const target = createMemoryTarget();
  await migrateParsedExport({ parsed: await parseKvExport(source), target, dryRun: false });
  source.values['reports/x/rx.json'].report.memo = 'changed sample';
  const rerun = await migrateParsedExport({ parsed: await parseKvExport(source), target, dryRun: false });
  assert.equal(rerun.updated.reports, 1);
  assert.equal(rerun.inserted.total, 0);
});

test('broken references stop before the first target write', async () => {
  const source = await fixture();
  source.values['customers/x.json'].months['2026-07'][0].reportId = 'missing';
  const parsed = await parseKvExport(source);
  const target = createMemoryTarget();
  await assert.rejects(
    () => migrateParsedExport({ parsed, target, dryRun: false }),
    (error) => error.code === 'validation_failed' && error.issues[0].path.startsWith('customers/x.json'),
  );
  assert.equal(target.writeCount, 0);
});

test('dry-run performs no writes and production target is always rejected', async () => {
  const parsed = await parseKvExport(await fixture());
  const target = createMemoryTarget();
  const result = await migrateParsedExport({ parsed, target, dryRun: true });
  assert.equal(result.writes, 0);
  assert.equal(target.writeCount, 0);
  assert.throws(() => createMemoryTarget({ environment: 'production' }), /production/);
  assert.throws(
    () => parseMigrationArguments(['--source', 'fixture.json', '--execute', '--target', 'production']),
    /production/,
  );
});

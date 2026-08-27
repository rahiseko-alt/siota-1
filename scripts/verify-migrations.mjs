/**
 * verify-migrations.mjs — supabase/migrations/*.sql が本物の PostgreSQL を通るか
 *
 * 使い方:
 *   npm run verify:migrations
 *   既存の DB を使う場合は MIGRATION_PG_URL=postgres://user:pass@host:5432/db
 *
 * EXIT 0 = 5本とも通る / EXIT 1 = どれかが落ちる
 *
 * なぜこの検査が要るか:
 *   `202607160001_supabase_base.sql` は `insert into … as window` と書いていた。
 *   `window` は PostgreSQL の予約語（WINDOW 句）なので、この文はパースすら
 *   通らない。つまりこのマイグレーションは**一度も実行されたことがなかった**。
 *   気づいたのは、マスターが本番の Supabase の SQL Editor に貼って
 *   `syntax error at or near "window"` を踏んだときである（F-20260821-24）。
 *   SQL はテストが無ければ「書いてあるだけ」で通ったことにならない。
 *
 * この検査が見るもの: 構文と、スキーマ内で完結する参照（型・関数・制約・RLS 定義）。
 * 見ないもの: RLS が実際に誰に何を見せるか（pgTAP の `npm run test:supabase` の領分）。
 *   Supabase が先に用意している auth / storage は `scripts/lib/supabase-stub.sql` で
 *   最小限だけ再現している。本物と完全に同じではない。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLedger, LEDGER } from './guard/sql-verified.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const RLS_TEST = path.join(ROOT, 'supabase', 'tests', 'rls.sql');
const STUB = path.join(ROOT, 'scripts', 'lib', 'supabase-stub.sql');
const PORT = Number(process.env.MIGRATION_PG_PORT || 5440);

function has(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

/** PostgreSQL の実行ファイル置き場。Debian 系は PATH に出ないので掘る。 */
function findPgBin() {
  if (has('initdb') && has('pg_ctl')) return '';
  const base = '/usr/lib/postgresql';
  if (!fs.existsSync(base)) return null;
  const versions = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a));
  for (const version of versions) {
    const bin = path.join(base, version, 'bin');
    if (fs.existsSync(path.join(bin, 'initdb'))) return bin;
  }
  return null;
}

/** root では initdb が動かない。postgres ユーザが居ればそちらで実行する。 */
const asPostgres = process.getuid?.() === 0
  && spawnSync('id', ['postgres'], { stdio: 'ignore' }).status === 0;

function run(command, args, options = {}) {
  const line = [command, ...args].map((a) => (/[\s'"]/.test(a) ? `'${a}'` : a)).join(' ');
  return spawnSync(asPostgres && options.viaPostgres ? 'su' : command,
    asPostgres && options.viaPostgres ? ['postgres', '-c', line] : args,
    { encoding: 'utf8', ...options });
}

let started = null;

function stop() {
  if (!started) return;
  run(path.join(started.bin, 'pg_ctl'), ['-D', started.data, '-m', 'immediate', 'stop'], { viaPostgres: true, stdio: 'ignore' });
  started = null;
}

process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(130); });

let connection = process.env.MIGRATION_PG_URL || null;
let socketDir = null;

if (!connection) {
  const bin = findPgBin();
  if (bin === null) {
    process.stderr.write(
      'PostgreSQL が見つからない。どちらかを用意すること:\n'
      + '  1. PostgreSQL を入れる（Debian/Ubuntu: apt-get install -y postgresql）\n'
      + '  2. 既存の DB を使う: MIGRATION_PG_URL=postgres://… npm run verify:migrations\n',
    );
    process.exit(1);
  }

  const data = asPostgres
    ? path.join('/var/lib/postgresql', 'verify-migrations')
    : path.join(os.tmpdir(), 'verify-migrations-pgdata');
  socketDir = os.tmpdir();

  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  if (asPostgres) spawnSync('chown', ['postgres:postgres', data]);

  const init = run(path.join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust'], { viaPostgres: true });
  if (init.status !== 0) {
    process.stderr.write(`initdb に失敗した\n${init.stderr || init.stdout}\n`);
    process.exit(1);
  }

  const start = run(path.join(bin, 'pg_ctl'),
    ['-D', data, '-l', path.join(data, 'server.log'), '-o', `-p ${PORT} -k ${socketDir}`, '-w', 'start'],
    { viaPostgres: true });
  if (start.status !== 0) {
    process.stderr.write(`PostgreSQL を起動できなかった\n${start.stderr || start.stdout}\n`);
    process.exit(1);
  }
  started = { bin, data };
  connection = `postgres://postgres@localhost:${PORT}/postgres?host=${socketDir}`;
}

/** 毎回まっさらな DB に流す。前回の残りが通してしまうのを防ぐ。 */
const dbName = 'verify_migrations';
const admin = ['-d', connection, '-v', 'ON_ERROR_STOP=1', '-q'];
execFileSync('psql', [...admin, '-c', `drop database if exists ${dbName};`], { stdio: 'ignore' });
execFileSync('psql', [...admin, '-c', `create database ${dbName};`], { stdio: 'ignore' });

const target = connection.includes('?')
  ? connection.replace(/\/postgres\?/, `/${dbName}?`)
  : `${connection.replace(/\/[^/]*$/, '')}/${dbName}`;

function apply(file, label) {
  const result = spawnSync('psql', ['-d', target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' });
  const ok = result.status === 0;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}\n`);
  if (!ok) {
    const message = `${result.stderr || ''}${result.stdout || ''}`
      .split('\n').filter((line) => /error/i.test(line)).slice(0, 4).join('\n');
    process.stdout.write(`${message}\n`);
  }
  return ok;
}

if (!apply(STUB, 'supabase-stub.sql（auth / storage の最小再現）')) {
  stop();
  process.exit(1);
}

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
let failed = 0;
for (const file of files) {
  if (!apply(path.join(MIGRATIONS, file), file)) failed += 1;
}

/* **RLS を実際に測る**（2026-08-27 に追加）。
   `supabase/tests/rls.sql` は pgTAP で書かれていたが、**走らせる仕組みがどこにも
   無く、一度も実行されていなかった**（納品前診断 #5 は「cross-shop が未検証」と
   書いていたが、実際にはその1本すら動いていなかった）。素の SQL に書き直し、
   ここで流す。中で `rollback` するので、検査用の行は残らない。 */
let rlsOk = true;
if (failed === 0) {
  rlsOk = apply(RLS_TEST, 'tests/rls.sql（誰に何が見える・書けるか）');
  if (!rlsOk) failed += 1;
}

stop();
process.stdout.write(`\n${files.length + 1 - failed}/${files.length + 1} PASS\n`);
process.stdout.write('構文・スキーマ内の参照に加えて、RLS が誰に何を見せるかも見る。\n');

/* 通ったときだけ記録を更新する。`npm test` の `sql-verified` がこれを見て、
   **SQL を触ったら実際に流すまで緑にしない**（bad-scenarios-F3 #5）。 */
if (failed === 0) {
  const fingerprint = writeLedger(ROOT, `${files.length}/${files.length} PASS`);
  process.stdout.write(`実際に流して通った記録を更新した: ${LEDGER} (${fingerprint.slice(0, 16)}…)\n`);
}

process.exit(failed === 0 ? 0 : 1);

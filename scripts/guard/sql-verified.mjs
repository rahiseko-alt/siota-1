/**
 * sql-verified.mjs — SQL は「書いてあるだけ」で通ったことにしない
 *
 * **なぜこの検査が要るか**（`F-20260821-24` / `F-20260823-01`・`bad-scenarios-F3` #5）
 *   `202607160001_supabase_base.sql` は `insert into … as window` と書いていた。
 *   `window` は PostgreSQL の予約語なのでパースすら通らない——つまりこの
 *   マイグレーションは**一度も実行されたことがなかった**。気づいたのは、マスターが
 *   本番の SQL Editor に貼って `syntax error at or near "window"` を踏んだとき。
 *   `npm test` は緑のままだった（`test:schema` は SQL を**文字列として** grep するだけ）。
 *
 * **なぜ `verify:migrations` を `npm test` に直接足さないか**
 *   あれは実 PostgreSQL を起動する（Debian のパス・`sh`・`su postgres` を使う）。
 *   マスターの環境は Windows なので、直接足すと**マスターの `npm test` が必ず落ちる**
 *   ——`F-20260825-33`「自分が動かせる環境でしか確かめていない」を繰り返すことになる。
 *
 * **だからこうする**: SQL の中身のハッシュと、「そのハッシュで実際に流して通った」
 *   という記録を突き合わせる。**SQL を触ったら、実際に流すまで緑にならない。**
 *   触っていなければ、PostgreSQL の無い環境でも緑のまま。
 *   黙って飛ばす分岐は作らない（`D-18` 偽-2）。
 *
 * **CI が入ってからの位置づけ（`D-20260825-44` / plan.md 4-0-e）**
 *   CI は毎回 `npm run verify:migrations` で**本物を流す**ので、SQL が通ることの
 *   保証はそちらが持つ。この札は**手元で早く気づくための前倒し**に格下げになった。
 *   札は手で書き換えられる——それが直せない以上、札を最後の砦にしてはいけない。
 *
 *   node scripts/guard/sql-verified.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** 実際に PostgreSQL へ流している対象と、同じ集合にすること。 */
export function sqlFiles(root) {
  const dir = path.join(root, 'supabase', 'migrations');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f))
    : [];
  const stub = path.join(root, 'scripts', 'lib', 'supabase-stub.sql');
  if (fs.existsSync(stub)) files.unshift(stub);
  return files;
}

/** SQL の中身だけから決まる指紋。ファイル名も含める（並び順で意味が変わるため）。 */
export function sqlFingerprint(root) {
  const hash = crypto.createHash('sha256');
  for (const file of sqlFiles(root)) {
    hash.update(path.relative(root, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export const LEDGER = 'supabase/.sql-verified';

/** 記録されている指紋。無ければ null。 */
export function recordedFingerprint(root) {
  const p = path.join(root, LEDGER);
  if (!fs.existsSync(p)) return null;
  const line = fs.readFileSync(p, 'utf8').split('\n').find((l) => /^[0-9a-f]{64}$/.test(l.trim()));
  return line ? line.trim() : null;
}

/** 実際に流して通ったことを記録する。`verify-migrations.mjs` の成功時だけが呼ぶ。 */
export function writeLedger(root, note) {
  const fingerprint = sqlFingerprint(root);
  fs.writeFileSync(path.join(root, LEDGER), [
    '# supabase/migrations の中身を、実際の PostgreSQL に流して通した記録。',
    '# 手で書かない。`npm run verify:migrations` が通ったときだけ更新される。',
    `# ${note}`,
    fingerprint,
    '',
  ].join('\n'));
  return fingerprint;
}

/* ── 直接叩かれたとき ── */
/* `process.argv[1]` は `node -e` などでは undefined で、`pathToFileURL` が投げる。
   直接実行かどうかを見るだけの分岐で落ちると、**このファイルを import した側**が
   道連れになる（F-20260825-33 の型）。存在を先に確かめる。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const files = sqlFiles(root);
  const now = sqlFingerprint(root);
  const recorded = recordedFingerprint(root);

  /* 対象の件数を必ず出す。対象を減らして 0 件にする逃げ道を塞ぐため（D-18 偽-2）。 */
  process.stdout.write(`[sql-verified] SQL ${files.length} 本を照合\n`);

  if (files.length === 0) {
    process.stderr.write('❌ SQL が 1 本も見つからない。走査の対象が消えている。\n');
    process.exit(1);
  }
  if (recorded === now) {
    process.stdout.write('✅ SQL は、いまの中身のまま実際の PostgreSQL を通っている\n');
    process.exit(0);
  }

  process.stderr.write(
    `\n❌ SQL が「実際に流して通った」記録と一致しません\n\n`
    + (recorded === null
      ? `    記録がありません（${LEDGER} が無い）\n`
      : `    記録: ${recorded.slice(0, 16)}…\n    いま: ${now.slice(0, 16)}…\n`)
    + `\n  SQL は書いてあるだけでは通ったことになりません（F-20260821-24）。\n`
    + `  実際の PostgreSQL に流してください:\n\n`
    + `      npm run verify:migrations\n\n`
    + `  通れば記録が更新され、この検査も通ります。\n`
    + `  PostgreSQL が無い環境（Windows 等）では流せません。**その場合は緑にできません**\n`
    + `  ——「動かせないから飛ばす」を作ると、また一度も実行されていない SQL が本番へ出ます。\n`,
  );
  process.exit(1);
}

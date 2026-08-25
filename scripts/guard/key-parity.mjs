/**
 * key-parity.mjs — ④が出すキーと ⑥が読むキーが、黙ってズレないようにする
 *
 * `plan.md` 4-1「繋ぐ前に必ず片づけること」の2つ目。突き合わせの結果は
 * `docs/ops/key-parity-F3.md` が正で、この機械はそれを**実体と照合し続ける**。
 *
 * なぜ要るか（`F-20260821-12`/`-13` の型）:
 *   ⑥に読む先を足したのに ④が出していなければ、**書いたのに黙って消える**。
 *   ④が出しているのに ⑥が読まなければ、**書いたのに届かない**。
 *   どちらも画面もコンソールも何も言わない。だから両方向を見る。
 *
 * 見るのは3つ:
 *   1. ⑥（`backend/js/magazine-view.js` の `data.*`）が読むキーの集合
 *   2. ④（`src/js/ui.js` の `extractReport()`）が出すキーの集合
 *   3. 台帳（`docs/ops/key-parity-F3.md`）が、その両方を漏れなく載せているか
 *
 * **この検査が保証しないこと**: 値の中身が正しいかは見ない。**キーの名前だけ**を見る。
 * 「同じ値で届いたか」は `verify:roundtrip`（`bad-scenarios-F3` #13）の担当である。
 *
 *   node scripts/guard/key-parity.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LEDGER = 'docs/ops/key-parity-F3.md';

/** ⑥が読むキー。`data.foo` の形で書かれているものを拾う。 */
export function keysReadByMagazine(root) {
  const src = fs.readFileSync(path.join(root, 'backend/js/magazine-view.js'), 'utf8');
  return [...new Set([...src.matchAll(/\bdata\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort();
}

/** ④が出すキー。`extractReport()` の中で `report.foo = …` と書かれているものを拾う。 */
export function keysWrittenByEditor(root) {
  const src = fs.readFileSync(path.join(root, 'src/js/ui.js'), 'utf8');
  const start = src.indexOf('  extractReport() {');
  if (start < 0) return null;
  const end = src.indexOf('\n  },', start);
  const body = src.slice(start, end < 0 ? undefined : end);
  return [...new Set([...body.matchAll(/\breport\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]))].sort();
}

export function checkKeyParity(root) {
  const problems = [];
  const ledgerPath = path.join(root, LEDGER);
  if (!fs.existsSync(ledgerPath)) return [`台帳が無い: ${LEDGER}`];
  const ledger = fs.readFileSync(ledgerPath, 'utf8');

  const read = keysReadByMagazine(root);
  const written = keysWrittenByEditor(root);
  if (written === null) {
    return ['`src/js/ui.js` に `extractReport()` が無い。④が何を出すのか読めない。'];
  }

  /* ④が出しているのに ⑥が読まないもの＝**届かない**。 */
  for (const key of written) {
    if (!read.includes(key)) problems.push(`④が出しているのに⑥が読まない（届かない）: ${key}`);
  }
  /* 両方の全キーが台帳に載っているか。載っていないキーは、
     「無いこと」を誰も知らないまま繋がることになる（`#6` と同じ形）。 */
  for (const key of [...new Set([...read, ...written])]) {
    if (!new RegExp(`\`${key}\``).test(ledger)) {
      problems.push(`台帳に無いキー: ${key} → ${LEDGER} に行を足すこと`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const read = keysReadByMagazine(root);
  const written = keysWrittenByEditor(root) || [];
  const problems = checkKeyParity(root);
  const head = `[key-parity] ⑥が読む ${read.length}キー / ④が出す ${written.length}キー`;
  if (problems.length > 0) {
    process.stderr.write(`${head}\n`);
    problems.forEach((p) => process.stderr.write(`❌ ${p}\n`));
    process.stderr.write(`\n台帳の正は ${LEDGER}。\n`);
    process.exit(1);
  }
  const missing = read.filter((k) => !written.includes(k));
  process.stdout.write(`${head}\n`);
  process.stdout.write(`✅ キーの対応 OK（**値の中身は見ていない**——それは verify:roundtrip の担当）\n`);
  process.stdout.write(`   出どころが無いキー ${missing.length}件: ${missing.join(' ')}\n`);
  process.stdout.write(`   （入力欄が正UI に無い。足すかは F3 完了後の棚卸し・${LEDGER}）\n`);
}

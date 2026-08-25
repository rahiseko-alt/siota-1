/**
 * verify-inventory.mjs — 「消えた検査の台帳」が、実体とズレたら止める
 *
 * `docs/ops/bad-scenarios-F3.md` #6 の原因はこれだった:
 * **無いものが、無いと分かっていなかった。** `docs/deferred.md` #8 は消えた検査を
 * 「7本（`m6`/`roundtrip`/`empty`/`xss`/`portal`/`all`/`preview`）」と書いていたが、
 * `all` と `preview` はファイルではなく npm の集約スクリプトで、実体で消えた
 * `delete`・`draft`・`invitation`・`screens` の4本は**記録から漏れていた**。
 * うち `verify-delete.mjs` は「削除したら写真も本当に消える」を見る唯一の検査である。
 *
 * 記録を人が書き直すだけでは、また同じズレが起きる（D-7「自分のルールを自分で守れると思わない」）。
 * だからここで**毎回 git と突き合わせる**。台帳の正は `docs/ops/verify-restore-F3.md`。
 *
 * 見るのは3つ:
 *   1. これまでに消えた `scripts/verify-*.mjs` が、**全部**台帳に載っているか
 *   2. 台帳の「状態」が実体と一致するか（`復元済み` と書いて無い／`未復元` と書いて在る、を止める）
 *   3. `復元済み` と書いたものに、`package.json` の口（`verify:*`）が在るか
 *      —— ファイルだけ戻して誰も呼べない状態を「戻した」と数えない（D-18 偽-5）
 *
 * **この検査が保証しないこと**: 戻っている検査の**中身が正しいか**は見ない。
 * 本数と名前が合っているかだけを見る。中身は各 `verify:*` 自身が CI で見る。
 *
 *   node scripts/guard/verify-inventory.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LEDGER = 'docs/ops/verify-restore-F3.md';

/** これまでに削除された `scripts/verify-*.mjs` の名前（重複なし）。
    コミットを直書きしない——あとで別の検査が消えたときも、ここに出る。 */
function deletedVerifyScripts(root) {
  const out = execSync(
    "git log --diff-filter=D --name-only --format= -- 'scripts/verify-*.mjs'",
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString();
  const names = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('scripts/verify-'));
  return [...new Set(names.map((n) => path.basename(n)))].sort();
}

/** 台帳の表から「基名 → 状態」を読む。`| 2 | `xss` | 未復元 | …` の形。 */
function readLedger(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|\s*`([a-z0-9-]+)`\s*\|\s*(復元済み|未復元)\s*\|/);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

export function checkVerifyInventory(root) {
  const problems = [];
  const ledgerPath = path.join(root, LEDGER);
  if (!fs.existsSync(ledgerPath)) {
    return [`台帳そのものが無い: ${LEDGER}`];
  }
  const rows = readLedger(fs.readFileSync(ledgerPath, 'utf8'));
  if (rows.size === 0) {
    return [`台帳に読める行が無い: ${LEDGER}`];
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const npmMouths = new Set(
    Object.entries(pkg.scripts || {})
      .filter(([name]) => name.startsWith('verify:'))
      .map(([, cmd]) => cmd)
      .flatMap((cmd) => [...cmd.matchAll(/scripts\/(verify-[a-z0-9-]+)\.mjs/g)].map((m) => m[1])),
  );

  for (const file of deletedVerifyScripts(root)) {
    const base = file.replace(/^verify-/, '').replace(/\.mjs$/, '');
    const exists = fs.existsSync(path.join(root, 'scripts', file));
    const stated = rows.get(base);
    if (!stated) {
      problems.push(`台帳に無い: ${file}（消えた検査は全部 ${LEDGER} に載せる）`);
      continue;
    }
    if (exists && stated !== '復元済み') {
      problems.push(`台帳が実体と食い違う: ${file}（台帳=${stated} / 実体=在る）`);
    }
    if (!exists && stated !== '未復元') {
      problems.push(`台帳が実体と食い違う: ${file}（台帳=${stated} / 実体=無い）`);
    }
    if (exists && stated === '復元済み' && !npmMouths.has(`verify-${base}`)) {
      problems.push(`口が無い: ${file} は在るのに package.json の verify:* から呼ばれていない`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const problems = checkVerifyInventory(root);
  const total = deletedVerifyScripts(root).length;
  if (problems.length > 0) {
    process.stderr.write(`[verify-inventory] 消えた検査 ${total}本を台帳と突き合わせた\n`);
    problems.forEach((p) => process.stderr.write(`❌ ${p}\n`));
    process.stderr.write(`\n台帳の正は ${LEDGER}。実体に合わせて直すこと。\n`);
    process.exit(1);
  }
  process.stdout.write(`[verify-inventory] 消えた検査 ${total}本を台帳と突き合わせた\n`);
  process.stdout.write('✅ 台帳 OK（本数と名前と状態が実体と一致。**中身の正しさは見ていない**）\n');
}

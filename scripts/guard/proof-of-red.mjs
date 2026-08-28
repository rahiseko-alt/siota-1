/**
 * proof-of-red.mjs — **壊して赤にならない検査は、壊れているとみなす**
 *
 * マスター指示（2026-08-28）:
 *   「もはやルールじゃダメだろ。16回中16回盛れない方法にしろ。
 *     壊してみて赤にならないなら検査自体が壊れてるとするか」
 *
 * ── なぜ「書き方を見張る」では足りないか ──
 * `empty-pass.mjs` は**形**を見る。形で判るのは `docs/watch.md` W-1 の16回のうち
 * **5回分だけ**で、残り11回は形が正常なまま嘘をついていた（恒真・待たない・右辺の作り方）。
 * **形をいくら足しても、次の11回目の形は予測できない。**
 *
 * ── 代わりに置く定義 ──
 * **「赤になったところを見ていない検査は、壊れているものとして数える」。**
 * 形に依存しないので**どんな嘘の付き方をしても逃げられない**——嘘をついている検査は、
 * 定義上「壊したら赤になった証拠」を出せないからである。
 *
 * ── 盛らせない造り ──
 * **数ではなく、検査を1件ずつ名前で台帳に載せる**（数だけの上限は、
 * 別の検査を消して枠を空ければ通ってしまう）。機械が数え上げた全件について:
 *   ・台帳のどちらの節にも無い  → 赤（**新しい検査は、証拠と一緒でないと足せない**）
 *   ・台帳に在るが実体に無い    → 赤（`W-8` の型・古い台帳を放置させない）
 * 「未証明」の節に書けば通るが、**その1行が「まだ確かめていない」と名指しで残る**。
 * 消して通す道は無い（消せば「台帳に無い」で赤になる）。
 *
 *   node scripts/guard/proof-of-red.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { passConditions } from './empty-pass.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = 'docs/ops/proof-of-red.md';

/** 機械が数える検査の全件。**人が並べた一覧は使わない**（並べ忘れが逃げ道になる）。 */
export function allChecks(root) {
  const dir = path.join(root, 'scripts');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^verify-.*\.mjs$/.test(f)).sort()
    : [];
  const out = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const { line, name } of passConditions(src)) out.push({ file: f, line, name });
  }
  return out;
}

/** 台帳の1節を読む。`- <ファイル> :: <検査の名前>` の行だけ。 */
export function sectionEntries(text, heading) {
  const i = text.indexOf(heading);
  if (i < 0) return null;
  const rest = text.slice(i + heading.length);
  const end = rest.search(/\n## /);
  const body = end < 0 ? rest : rest.slice(0, end);
  return [...body.matchAll(/^-\s+(verify-[\w-]+\.mjs)\s*::\s*(.+?)\s*$/gm)]
    .map((m) => ({ file: m[1], name: m[2] }));
}

const key = (c) => `${c.file}::${c.name}`;

export function audit(root) {
  const ledgerPath = path.join(root, LEDGER);
  if (!fs.existsSync(ledgerPath)) return { fatal: `台帳が無い → ${LEDGER}` };
  const text = fs.readFileSync(ledgerPath, 'utf8');

  const proven = sectionEntries(text, '## 証明済み');
  const unproven = sectionEntries(text, '## 未証明');
  if (proven === null || unproven === null) {
    return { fatal: `台帳に「## 証明済み」と「## 未証明」の節が要る → ${LEDGER}` };
  }

  const checks = allChecks(root);
  const live = new Set(checks.map(key));
  const listed = new Map();
  for (const e of proven) listed.set(key(e), '証明済み');
  for (const e of unproven) if (!listed.has(key(e))) listed.set(key(e), '未証明');

  return {
    total: checks.length,
    proven: proven.filter((e) => live.has(key(e))).length,
    unlisted: checks.filter((c) => !listed.has(key(c))),
    stale: [...listed.keys()].filter((k) => !live.has(k)),
    remaining: checks.filter((c) => listed.get(key(c)) === '未証明').length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = audit(ROOT);
  if (r.fatal) {
    process.stderr.write(`[proof-of-red] ${r.fatal}\n`);
    process.exit(1);
  }
  const head = `[proof-of-red] 検査 ${r.total}件 / 壊して赤になったところを見た ${r.proven}件`
    + ` / まだ見ていない ${r.remaining}件\n`;

  const problems = [];
  if (r.unlisted.length > 0) {
    problems.push(
      `**台帳に無い検査が ${r.unlisted.length}件**。新しい検査は、赤になったところを見てから足してください。\n`
      + r.unlisted.map((c) => `      ${c.file}:${c.line}  ${c.name}`).join('\n')
      + `\n    壊し方と、そのとき実際に出た赤の出力を ${LEDGER} に貼り、\n`
      + `    「## 証明済み」に「- <ファイル> :: <検査の名前>」を足してください。\n`
      + `    確かめずに足すなら「## 未証明」へ——**その1行が名指しで残ります**。`,
    );
  }
  if (r.stale.length > 0) {
    problems.push(
      `**台帳が実体に無い検査を ${r.stale.length}件 指している**（消したか、名前を変えた）:\n`
      + r.stale.map((k) => `      ${k.replace('::', ' :: ')}`).join('\n')
      + `\n    ${LEDGER} の行を消すか、名前を合わせてください。`,
    );
  }

  if (problems.length === 0) {
    process.stdout.write(head
      + `✅ 全件が台帳に載っている（**${r.remaining}件は、壊しても赤になるか未確認のまま**）\n`);
    process.exit(0);
  }
  process.stderr.write(head + '\n' + problems.map((p) => `  - ${p}`).join('\n\n') + '\n');
  process.exit(1);
}

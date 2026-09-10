/**
 * failure-match.mjs — **触った場所が過去に落ちているなら、その記録を画面に出すまで進ませない**
 *
 * `AGENTS.md` STEP 2（FAILURE MATCH）は「Level 2 / Level 3 の変更では `docs/failures.md` と
 * 照合しろ」と定めている。**文章だけだった。** そして踏まれなかった。
 *
 * 実際に起きたこと（2026-09-10・マスターの指摘「同じミスをループしてるだろ」）:
 *   `F-20260907-75`「本番でカルテを確定できず」（2026-09-07・マスターが本番で発見）
 *   `F-20260910-79`「本番でカルテを保存できない」（2026-09-10・マスターが本番で発見）
 *   **同じ確定処理で、3日のうちに2回**。しかも 9/7 の直しのコメントには
 *   「1件も返らない＝写真の登録が揃っていない」と**書いてあった**。9/10 に同じ場所へ
 *   `saveDraft()` を足した者（＝わたし）は、それを読まずに、その条件を踏ませた。
 *
 * **「読め」と書いても読まない。** だから読ませるのではなく、**出す**。
 * この関所は、いま触っているファイルの名前を挙げている失敗記録を**本文ごと画面に出し**、
 * 出したことを印（`.failure-matched`）に残す。印が無ければ `npm run check` が赤で止まる。
 *
 *   node scripts/guard/failure-match.mjs          ← 関所（印が要る／`npm run check` から）
 *   node scripts/guard/failure-match.mjs --show   ← 記録を画面に出して、印を書く
 *
 * **自己申告にしない。** 印に書くのは「読みました」ではなく**出した失敗の番号**で、
 * 触るファイルが増えて新しい失敗に当たれば、また止まる（`偽-6` を塞ぐ形）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sessionKey } from './plan-read-mark.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = 'docs/failures.md';
const MARK = path.join(ROOT, '.failure-matched');

/** 製品の実体。ここを触るときだけ照合を要求する（文書だけの回で止めない）。 */
const PRODUCT = /^(src|worker|backend|supabase)\//;

/** 出発点から変わったファイル（`guard/run.mjs` と同じ見方——コミット済み＋未コミット）。 */
function changedFiles() {
  const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  const out = [];
  for (const ref of ['origin/master', 'origin/main', 'master', 'main']) {
    try {
      sh(`git rev-parse --verify --quiet ${ref}`);
      const mb = sh(`git merge-base ${ref} HEAD`).trim();
      out.push(...sh(`git diff --name-only ${mb} HEAD`).split('\n'));
      break;
    } catch { /* 次の候補へ */ }
  }
  try {
    for (const line of sh('git status --porcelain=v1 --untracked-files=all').split('\n')) {
      if (line.trim()) out.push(line.slice(3).trim());
    }
  } catch { /* git が無い場所では未コミット分を諦める */ }
  return [...new Set(out.filter(Boolean))];
}

/** 失敗記録を1件ずつに割り、それぞれが名前を挙げているファイルを取り出す。 */
export function parseLedger(text) {
  const entries = [];
  const parts = text.split(/^## (F-[0-9]{8}-[0-9]+)/m);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = parts[i + 1] || '';
    const title = (body.split('\n')[0] || '').replace(/^\s*—\s*/, '').trim();
    const files = new Set();
    for (const m of body.matchAll(/`((?:src|worker|backend|scripts|supabase|test)\/[A-Za-z0-9_./-]+)`/g)) {
      files.add(m[1]);
    }
    entries.push({ id, title, body: body.trim(), files: [...files] });
  }
  return entries;
}

/** 触ったファイルに当たる失敗記録。ディレクトリ止まりの記述（`supabase/migrations/`）も拾う。 */
export function matchFailures(entries, touched) {
  const product = touched.filter((f) => PRODUCT.test(f));
  return entries
    .map((entry) => ({
      ...entry,
      hits: product.filter((f) => entry.files.some((known) => (
        known.endsWith('/') ? f.startsWith(known) : f === known
      ))),
    }))
    .filter((entry) => entry.hits.length > 0);
}

function readMark() {
  try { return JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch { return null; }
}

const entries = parseLedger(fs.readFileSync(path.join(ROOT, LEDGER), 'utf8'));
const touched = changedFiles();
const hits = matchFailures(entries, touched);
const show = process.argv.includes('--show');

if (hits.length === 0) {
  console.log(`[failure-match] ✅ 触った場所に当たる失敗記録は無い（${LEDGER} ${entries.length}件と照合）`);
  process.exit(0);
}

if (show) {
  process.stdout.write(`\n${'='.repeat(60)}\n`
    + `【過去に、いま触っている場所で落ちている】${hits.length}件\n${'='.repeat(60)}\n`);
  for (const entry of hits) {
    process.stdout.write(`\n■ ${entry.id} — ${entry.title}\n`
      + `   （当たったファイル: ${entry.hits.join(' / ')}）\n\n${entry.body}\n`);
  }
  fs.writeFileSync(MARK, `${JSON.stringify({
    at: new Date().toISOString(), session: sessionKey(), ids: hits.map((e) => e.id),
  })}\n`);
  process.stdout.write(`\n[failure-match] 出した: ${hits.map((e) => e.id).join(' ')}\n`);
  process.exit(0);
}

/* ── 関所 ── */
const mark = readMark();
const key = sessionKey();
const seen = new Set((mark && mark.ids) || []);
const sameSession = mark && (key ? mark.session === key : true);
const missing = hits.filter((e) => !sameSession || !seen.has(e.id));

if (missing.length === 0) {
  console.log(`[failure-match] ✅ 当たった ${hits.length}件は、このセッションで画面に出した`);
  process.exit(0);
}

process.stderr.write('\n[failure-match] ❌ **いま触っている場所は、過去に落ちている。**\n\n');
for (const entry of missing) {
  process.stderr.write(`  ${entry.id} — ${entry.title}\n      → ${entry.hits.join(' / ')}\n`);
}
process.stderr.write('\n  読んでから進むこと（本文を画面に出し、印を残す）:\n'
  + '      node scripts/guard/failure-match.mjs --show\n\n'
  + '  **「気をつける」では守れないので、機械にした**（`D-7`）。\n'
  + '  3日のうちに同じ確定処理で2回落ちた（`F-20260907-75` → `F-20260910-79`）のが由来。\n\n');
process.exit(1);

/**
 * run.mjs — `npm run guard`。①逸脱監視 と ②③の関所を、変更した全ファイルに掛ける。
 *
 * どの AI が書いたかに関係なく、**同じ1つの命令**で同じ判定になる。
 * 特定の AI の設定ファイルには依存しない（それが食い違いの元だから）。
 * `npm run check` から呼ばれるので、忘れても止まる。
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPhase, SCOPE, checkPath, ALWAYS } from './scope.mjs';
import { missingArtifacts } from './gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const phase = readPhase(ROOT);
if (!phase) {
  console.log('[guard] docs/ops/phase が無いので、見張るものがない');
  process.exit(0);
}
console.log(`[guard] いまのフェーズ: ${phase}（${SCOPE[phase].label}）`);

/** HEAD から変わったファイル（未追跡も含む。改名は新旧どちらも見る）。
    `-z` の並びは `XY PATH\0`、改名だけ `RY NEW\0OLD\0` と**接頭辞の無い**行が続く。 */
const fields = execSync('git status --porcelain=v1 -z --untracked-files=all', { cwd: ROOT })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const changed = [];
for (let i = 0; i < fields.length; i += 1) {
  const status = fields[i].slice(0, 2);
  changed.push(fields[i].slice(3));
  if (status[0] === 'R' || status[0] === 'C') {
    i += 1;
    if (fields[i]) changed.push(fields[i]);   /* 改名前のパスは接頭辞が無い */
  }
}
const seen = new Set();
const files = changed.filter((f) => f && !f.endsWith('/') && !seen.has(f) && seen.add(f));

if (files.length === 0) {
  console.log('[guard] 変更なし');
  process.exit(0);
}

const problems = [];

/* ① 場所が範囲内か */
for (const f of files) {
  const why = checkPath(ROOT, phase, f);
  if (why) problems.push(why);
}

/* ②③ 作業場が開いているか（記録と仕組み以外を触っているときだけ） */
const workArea = files.filter(
  (f) => !ALWAYS.some((e) => f === e.slice(0, -1) || f.startsWith(e)),
);
if (workArea.length > 0) {
  const missing = missingArtifacts(ROOT, phase);
  if (missing.length > 0) {
    problems.push(
      `【関所】${phase} の作業場はまだ開いていません。触っている場所: ${workArea.join(', ')}\n`
      + missing.map((m) => `  - ${m}`).join('\n'),
    );
  }
}

if (problems.length === 0) {
  console.log(`[guard] ${files.length}件の変更、すべて ${phase} の範囲内`);
  process.exit(0);
}
console.error(`\n[guard] ${problems.length}件、止めました\n`);
console.error(problems.join('\n\n'));
process.exit(1);

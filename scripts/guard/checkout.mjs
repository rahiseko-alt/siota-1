/**
 * checkout.mjs — セッションを終えてよいかを機械で確かめる（AGENTS.md D-19）
 *
 * **次のセッションは、別のコンテナで、まっさらから始まる。**
 * だから「手元で終わっている」ことに意味は無い。`master` に乗っていないものは、
 * 次のセッションからは**存在しない**のと同じ。
 *
 * 実際に起きた事故（`docs/failures.md` F-20260825-34）:
 *   PR を draft のまま残して「チェックアウト完了です」と宣言した。master には
 *   引き継ぎが1文字も乗っておらず、マスターに「マージまで行け」と言われて初めて反映した。
 *   その前のセッションでも同じことが起き、次のセッションが**マージ前の状態から作業を始めた**。
 *
 * ここが EXIT 0 になるまで、**「チェックアウト完了」と言ってはいけない。**
 *
 *   node scripts/guard/checkout.mjs
 *   node scripts/guard/checkout.mjs --no-build   まっさらからの実行だけ省く（非推奨・理由を報告に書くこと）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.REPO_ROOT || process.cwd();
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const quiet = (cmd, opts = {}) => { try { execSync(cmd, { cwd: ROOT, stdio: 'ignore', ...opts }); return 0; } catch (e) { return e.status || 1; } };

/** 次のセッションが、これが無いと前回の続きを始められない、というもの。
    2026-08-29: `docs/deferred.md` は `docs/ops/plan.md`（第12章・放置リスト）に統合され、廃止した。 */
const HANDOFF_FILES = [
  'docs/handoff.md',
  'docs/ops/phase',
  'docs/ops/plan.md',
  'docs/failures.md',
  'docs/decisions.md',
  'AGENTS.md',
];

const steps = [];
const add = (ok, title, detail) => steps.push({ ok, title, detail });

/* ── 1. 手元に書き残しが無いか ── */
const dirty = sh('git status --porcelain --untracked-files=all');
add(dirty === '', '手元の変更をすべてコミットした',
  dirty === '' ? '未コミット 0件' : `未コミットが ${dirty.split('\n').length}件:\n${dirty.split('\n').map((l) => `      ${l}`).join('\n')}`);

/* ── 2. push したか ── */
const branch = sh('git rev-parse --abbrev-ref HEAD');
quiet('git fetch origin --prune');
let pushed = false;
try {
  pushed = sh('git rev-parse HEAD') === sh(`git rev-parse origin/${branch}`);
} catch { /* リモートに無い */ }
add(pushed, `push した（${branch}）`,
  pushed ? `origin/${branch} と一致` : `origin/${branch} に無いか、手元が進んでいる → git push -u origin ${branch}`);

/* ── 3. **master に取り込まれたか**（ここが本題） ── */
const merged = quiet('git merge-base --is-ancestor HEAD origin/master') === 0;
add(merged, 'master に取り込まれた（PR をマージした）',
  merged ? 'HEAD は origin/master の祖先' : `**まだマージされていない。**\n`
    + `      次のセッションは別のコンテナで origin/master から始まるので、\n`
    + `      いまの作業は**次のセッションからは存在しない**ことになる。\n`
    + `      PR を ready にしてマージすること（draft のままではマージできない）。`);

/* ── 4. 引き継ぎ一式が master 側に在るか ── */
const missing = HANDOFF_FILES.filter((f) => quiet(`git cat-file -e origin/master:${f}`) !== 0);
add(missing.length === 0, '引き継ぎ一式が master に在る',
  missing.length === 0 ? `${HANDOFF_FILES.length}件すべて在る`
    : `master に無いもの: ${missing.join(', ')}`);

/* ── 5. 手元の引き継ぎと master の引き継ぎが同じか ── */
const differing = HANDOFF_FILES.filter((f) => {
  if (!fs.existsSync(path.join(ROOT, f))) return true;
  try {
    return sh(`git show origin/master:${f}`) !== fs.readFileSync(path.join(ROOT, f), 'utf8').trim();
  } catch { return true; }
});
add(differing.length === 0, '手元の引き継ぎが master に反映されている',
  differing.length === 0 ? '内容まで一致' : `master 側が古いもの: ${differing.join(', ')}`);

/* ── 6. **まっさらから動くか**（master の中身だけで build / check / test） ── */
const skipBuild = process.argv.includes('--no-build');
if (skipBuild) {
  add(false, 'まっさらな作業場で build / check / test が通る',
    '**--no-build で省いた。** 次のセッションで動く保証は無い。省いた理由を報告に書くこと');
} else if (!merged) {
  add(false, 'まっさらな作業場で build / check / test が通る',
    'master に取り込まれていないので、確かめる対象が無い（3 を先に通すこと）');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-verify-'));
  const results = [];
  let ok = false;
  try {
    /* origin/master の中身だけを取り出す。node_modules は付いてこないので、
       次のセッション（別コンテナ）と同じ条件になる。 */
    execSync(`git worktree add --detach -q "${tmp}" origin/master`, { cwd: ROOT, stdio: 'ignore' });
    const run = (label, cmd) => {
      const code = quiet(cmd, { cwd: tmp });
      results.push(`${label}: EXIT ${code}`);
      return code === 0;
    };
    ok = run('npm ci', 'npm ci --prefer-offline --no-audit --no-fund')
      && run('npm run build', 'npm run build')
      && run('npm run check', 'npm run check')
      && run('npm test', 'npm test');
  } catch (e) {
    results.push(`作業場を作れなかった: ${e.message.split('\n')[0]}`);
  } finally {
    quiet(`git worktree remove --force "${tmp}"`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  add(ok, 'まっさらな作業場で build / check / test が通る',
    `master の中身だけを取り出して実行した\n${results.map((r) => `      ${r}`).join('\n')}`);
}

/* ── 7. 「いまやる番」（docs/ops/plan.md）を、このセッションで更新したか ──
   マスター指示（2026-08-29）: 「毎回全体計画を強制的に進捗の読み書きをする」。
   `checkin.mjs` は読んだことを機械で確かめる。ここは**書いたこと**を機械で確かめる。
   セッション開始時点（`origin/master`）の行と、いま手元にある行を比べるだけ——
   同じままなら、進んでいないか、進んだのに書き忘れたかのどちらか。 */
const NEXT_RE = /^\*\*いまやる番:\s*(.+?)\*\*\s*$/m;
{
  let ok = false;
  let detail;
  try {
    const localPlan = fs.readFileSync(path.join(ROOT, 'docs/ops/plan.md'), 'utf8');
    const localNext = (localPlan.match(NEXT_RE) || [])[1];
    if (localNext === undefined) {
      detail = 'docs/ops/plan.md に「いまやる番」の行が無い（第0章の直下にあるはず）';
    } else {
      let baseNext = null;
      try { baseNext = (sh('git show origin/master:docs/ops/plan.md').match(NEXT_RE) || [])[1]; } catch { /* origin/master にまだ無い＝初回 */ }
      if (baseNext === null) {
        ok = true;
        detail = `新設: ${localNext}`;
      } else if (baseNext !== localNext) {
        ok = true;
        detail = `${baseNext}\n      → ${localNext}`;
      } else {
        detail = `セッション開始時点から変わっていない: "${localNext}"\n`
          + '      進めたなら、この行を次の項目に書き換えること。\n'
          + '      本当に何も進まなかった回なら、その旨をマスターへ報告すること（優先度の禁止事項②）。';
      }
    }
  } catch (e) {
    detail = `確認できなかった: ${e.message.split('\n')[0]}`;
  }
  add(ok, '「いまやる番」（docs/ops/plan.md）を今回のセッションで更新した', detail);
}

/* ── 結果 ── */
const failed = steps.filter((s) => !s.ok);
process.stdout.write('\n【チェックアウト】次のセッションは別のコンテナで、master から始まる\n\n');
steps.forEach((s, i) => {
  process.stdout.write(`  ${s.ok ? '✅' : '❌'} ${i + 1}. ${s.title}\n      ${s.detail}\n`);
});

if (failed.length === 0) {
  process.stdout.write('\n  すべて確認できた。**ここで初めて「チェックアウト完了」と言ってよい。**\n\n');
  process.exit(0);
}
process.stderr.write(`\n  ${failed.length}件が未了。**「チェックアウト完了です」と言ってはいけない**（D-19）。\n\n`);
process.exit(1);

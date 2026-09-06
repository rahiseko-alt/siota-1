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

import {
  PLAN as NEXT_PLAN, parseNextList, readDoingMark, judgeDoingClosed,
} from './next-list.mjs';

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

/* ── 3. **master に取り込まれたか**（ここが本題） ──

   **系譜だけで見てはいけない。** ここは長らく
   `git merge-base --is-ancestor HEAD origin/master` だけを見ていたが、
   このリポジトリは **squash マージ**で運用している（master の `#54`〜`#60` が
   すべてその形）。squash は新しいコミットを1本作るので、**中身が完全に
   取り込まれていても HEAD は master の祖先にならない**。
   つまりこの関所は、正しくマージした直後でも「まだマージされていない」と
   言い続け、**D-19 の門が構造的に通れなかった**
   （2026-09-02、PR #60 をマージした直後に実測して判明。
   `git diff --name-only origin/master HEAD` は 0件なのに ❌ が出た）。
   `checkin.mjs` が毎回「未マージのブランチがある」と誤警告していたのも同じ穴。

   D-19 が本当に気にしているのは「次のセッションが master から始めたとき、
   今回の成果がそこに在るか」——それは**系譜ではなく中身**で決まる。
   だから2通りのどちらかで「取り込まれた」とする:
     ① HEAD が origin/master の祖先（merge コミット運用ならこれで通る）
     ② **このブランチが触った全ファイルが、master 側と1バイトも違わない**
   ②は「差分が0」ではなく「**このブランチの変更分**が master に在るか」を見る。
   master に別の PR が後から入っていても誤判定しないため。
   どちらでもないときだけ「まだ」と言う——判定を緩めたのではなく、
   **測る対象を、系譜から中身へ正した**。 */
const isAncestor = quiet('git merge-base --is-ancestor HEAD origin/master') === 0;
let contentInMaster = false;
if (!isAncestor) {
  try {
    const base = sh('git merge-base origin/master HEAD');
    const touched = sh(`git diff --name-only ${base} HEAD`).split('\n').filter(Boolean);
    /* 1件も触っていないブランチを「取り込まれた」とは言わない（無を通さない）。 */
    contentInMaster = touched.length > 0
      && touched.every((f) => quiet(`git diff --quiet origin/master HEAD -- "${f}"`) === 0);
  } catch { contentInMaster = false; }
}
const merged = isAncestor || contentInMaster;
add(merged, 'master に取り込まれた（PR をマージした）',
  merged
    ? (isAncestor
      ? 'HEAD は origin/master の祖先'
      : 'squash マージ済み（このブランチが触った全ファイルが master 側と一致）')
    : `**まだマージされていない。**\n`
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
    /* `npm run check` の1本目（`plan-read.mjs`）は「このセッションが `plan.md` を
       読んだか」を見る関所で、**CI では見ない**（実際の CI に `.plan-read` は無い）。
       ここは CI と同じ「まっさらな作業場」を模しているのに `CI` を立てていなかった
       ため、`npm run check` が毎回 plan-read で止まり、**この関所自体が壊れていた**
       （本物の CI では通るのに、ここでは常に赤になる）。実際の CI 環境に合わせる。 */
    const run = (label, cmd) => {
      const code = quiet(cmd, { cwd: tmp, env: { ...process.env, CI: 'true' } });
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
   比べる相手は `.plan-next-baseline`（`checkin.mjs` が**セッション開始時点**に書いた値）。
   以前は `origin/master` を実行時に取り直して比べていたが、**このセッション自身の
   最後のマージが既に origin/master にその更新を運んでいる**のが通常の実行順序
   （`checkout.mjs` はマージの後に走らせる・項目3が要求する）ため、その時点の
   origin/master は既に「このセッションが書いた後」の値になっており、**何を書いても
   「変わっていない」としか出せなかった**（`F-20260830-62`）。セッション開始時点の
   値を固定のファイルに残すことで、時点をずらさずに比べる。 */
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
      const baselinePath = path.join(ROOT, '.plan-next-baseline');
      let baseNext = null;
      if (fs.existsSync(baselinePath)) {
        baseNext = fs.readFileSync(baselinePath, 'utf8').trim();
      } else {
        /* 印が無い（`checkin.mjs` を通していない・古いセッションの続き等）。
           次善として `origin/master` と比べる——このセッション自身がまだ
           何もマージしていなければ、これでも正しく判定できる。 */
        try { baseNext = (sh('git show origin/master:docs/ops/plan.md').match(NEXT_RE) || [])[1] ?? null; } catch { /* origin/master にまだ無い＝初回 */ }
      }
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

/* ── 8. 大計画（docs/ops/roadmap.md）の進捗が、いまの実態と合っているか ──
   マスター指示（2026-09-06）:「大計画の書き込みもチェックアウトスキルに組み込め」。

   `checkin.mjs` は**読んだこと**を、項目7は「いまやる番」を**書いたこと**を見る。
   ここは**地図そのものの現在地**を見る。

   **実際に古くなっていた。** 2026-09-06 の時点で `docs/ops/phase` は `F4` なのに、
   地図は「いま居るのは『棚卸し』の入口」「本番はまだ古い版のまま。いま作ったものは
   一度も出していない」と書いたままだった——**その時点で本番へは2回出していた**。
   地図が嘘をつくと、次に来た人が「まだ何も出ていない」と思って動く。

   見るのは2つだけ:
     ①`scripts/plan.mjs` の `STAGES` の**全段が地図の表に在る**こと
       （F4 が抜けていて `npm run plan` が全段「未着手」と出した事故と同じ型）
     ②現在地より**前は ✅**・**現在地は ▶**・**後ろに ✅ や ▶ が無い**こと

   **中身の正しさは見ていない**（それは人が書く）。ここが見るのは、
   **地図が現在地について嘘をついていないか**だけ。 */
{
  let ok = false;
  let detail;
  try {
    const { STAGES, stageIndex } = await import(pathToFileURL(path.join(ROOT, 'scripts/plan.mjs')).href);
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/ops/roadmap.md'), 'utf8');
    const phase = fs.readFileSync(path.join(ROOT, 'docs/ops/phase'), 'utf8').trim();
    const here = stageIndex(phase);
    /* 表の行だけを見る。地の文の ✅ を拾うと、どこを直しても緑になる。 */
    const rowOf = (key) => (roadmap.match(
      new RegExp(`^\\|\\s*\\*\\*${key}\\*\\*\\s*\\|.*$`, 'm'),
    ) || [])[0] || null;
    const missing = STAGES.filter((s2) => rowOf(s2.key) === null).map((s2) => s2.key);
    if (here === -1) {
      detail = `docs/ops/phase の値 "${phase}" が STAGES に無い（先に plan.mjs へ足すこと）`;
    } else if (missing.length > 0) {
      detail = `大計画の表に段が足りない: ${missing.join(' / ')}`;
    } else {
      const wrong = [];
      STAGES.forEach((s2, i) => {
        const row = rowOf(s2.key);
        const done = row.includes('✅');
        const nowHere = row.includes('▶');
        if (i < here && !done) wrong.push(`${s2.key} は終わっているのに ✅ が無い`);
        if (i === here && !nowHere) wrong.push(`${s2.key} がいまの現在地なのに ▶ が無い`);
        if (i > here && (done || nowHere)) wrong.push(`${s2.key} はまだなのに ✅／▶ が付いている`);
      });
      if (wrong.length === 0) {
        ok = true;
        detail = `現在地 ${phase} と一致（docs/ops/roadmap.md）`;
      } else {
        detail = `${wrong.join('\n      ')}\n`
          + '      docs/ops/roadmap.md の「フェーズごとの宿題」の表を、いまの実態に直すこと。';
      }
    }
  } catch (e) {
    detail = `確認できなかった: ${e.message.split('\n')[0]}`;
  }
  add(ok, '大計画（docs/ops/roadmap.md）の現在地が実態と合っている', detail);
}

/* ── 9. このセッションに割り当てられた「次の一手」が片づいたか ──
   マスター指示（2026-09-06）:「大計画通りに進めろ。毎回そうしろ。毎回そうする仕組みに変えろ」。

   `checkin.mjs` が「次の一手」のいちばん上を機械で割り当て（`.plan-doing`）、
   `npm run check` の `plan-next` が割り当ての有無を見る。**ここが最後の1枚**——
   割り当てられた1件が `[x]`（片づいた）か `[-] 理由: …`（やらないと決めた）に
   なっていなければ、チェックアウトさせない。

   **行ごと消して片づけたことにはできない**（`偽-9`「症状の場所を移す」）。
   印が指す番号が「次の一手」から消えていたら、それも ❌ にする。 */
{
  let ok = false;
  let detail;
  try {
    const items = parseNextList(fs.readFileSync(path.join(ROOT, NEXT_PLAN), 'utf8'));
    const verdict = judgeDoingClosed(readDoingMark(), items);
    ok = verdict.ok;
    detail = verdict.why;
  } catch (e) {
    detail = `確認できなかった: ${e.message.split('\n')[0]}`;
  }
  add(ok, '割り当てられた「次の一手」を片づけた（docs/ops/plan.md）', detail);
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

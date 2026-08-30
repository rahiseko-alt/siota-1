/**
 * checkin.mjs — セッションを始めるとき、**前回の続きから始められる状態か**を確かめる（AGENTS.md D-19）
 *
 * 新しいセッションは**別のコンテナ**で、`master` を clone したところから始まる。
 * だから前回の作業がマージされていないと、**気づかないまま古い土台の上に積み上げる**。
 *
 * 実際に起きた事故（`docs/failures.md` F-20260825-34）:
 *   前セッションの PR が draft のまま残っていたのに、それに気づかず作業を始めた。
 *   マスターから「緊急連絡、前回セッションがマージしてない状態でこのセッションを始めた」と
 *   言われて初めて分かり、ブランチを載せ替え直すことになった。
 *
 * **2026-08-29 の追記（マスター指示「毎回全体計画を強制的に進捗の読み書きをする」）**:
 * 引き継ぎだけでなく、**大計画（`docs/ops/plan.md`）を毎回強制的に読ませる**。
 * 自動注入は `CLAUDE.md` 1枚だけで、大計画はそこに含まれない（`docs/failures.md`
 * 「大計画が自動で読まれない」の事故）。ここで `npm run plan` の出力を必ず画面に出し、
 * 読んだ印として `.plan-read`（gitignore 対象）を書く。**この印が無いと `npm run check`
 * が EXIT 1** になる（`scripts/guard/run.mjs` から呼ぶ）——チェックインを踏まずに
 * 作業を進められない。`.claude/settings.json` の SessionStart フックが、Claude Code
 * ではこれを自動起動する（併用。フックにはルールを書かない・`AGENTS.md` D-15）。
 *
 *   node scripts/guard/checkin.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.REPO_ROOT || process.cwd();
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quiet = (cmd) => { try { execSync(cmd, { cwd: ROOT, stdio: 'ignore' }); return 0; } catch (e) { return e.status || 1; } };

quiet('git fetch origin --prune');

const problems = [];
process.stdout.write('\n【チェックイン】前回の続きから始められるかを見る\n\n');

/* ── 1. master に取り込まれていない作業ブランチが無いか ── */
const remotes = sh("git branch -r --format='%(refname:short)'")
  .split('\n').map((s) => s.trim())
  .filter((b) => b && b !== 'origin/master' && !b.includes('->'));
const unmerged = remotes.filter((b) => quiet(`git merge-base --is-ancestor ${b} origin/master`) !== 0);

if (unmerged.length === 0) {
  process.stdout.write('  ✅ master に取り込まれていない作業ブランチは無い\n');
} else {
  process.stdout.write('  ❌ **master に取り込まれていない作業ブランチがある**\n');
  for (const b of unmerged) {
    const n = sh(`git rev-list --count origin/master..${b}`);
    const last = sh(`git log -1 --format=%s ${b}`);
    process.stdout.write(`       ${b}  （master より ${n} コミット先行）\n         最新: ${last}\n`);
  }
  process.stdout.write('       → **その中身は master に無い。** 前回の成果なら、まずマージするか、\n'
    + '         そのブランチを土台にして始めること。master から始めると作業が二重になる。\n');
  problems.push('未マージのブランチがある');
}

/* ── 2. いまの HEAD がどこに立っているか ── */
const branch = sh('git rev-parse --abbrev-ref HEAD');
const hasMaster = quiet('git merge-base --is-ancestor origin/master HEAD') === 0;
const inMaster = quiet('git merge-base --is-ancestor HEAD origin/master') === 0;
if (hasMaster) {
  process.stdout.write(`  ✅ いまのブランチ（${branch}）は origin/master を含んでいる\n`);
} else if (inMaster) {
  /* 前回の作業がマージ済みで、master がその先へ進んだ状態。作業自体は失われていない。 */
  const ahead = sh('git rev-list --count HEAD..origin/master');
  process.stdout.write(`  ⚠️  いまのブランチ（${branch}）はマージ済みだが、master が ${ahead} コミット先行している\n`);
  process.stdout.write('       → 作業は master に入っている（失われていない）。続けるなら取り込むこと:\n');
  process.stdout.write(`         git fetch origin && git checkout -B ${branch} origin/master\n`);
  problems.push('master が先行している（取り込みが要る）');
} else {
  process.stdout.write(`  ❌ いまのブランチ（${branch}）が origin/master から分岐している\n`);
  process.stdout.write('       → **古い土台の上に立っている。** origin/master を取り込んでから始めること。\n');
  problems.push('HEAD が origin/master から分岐している');
}

/* ── 3. 引き継ぎ文書と、いまのフェーズ ── */
const phasePath = path.join(ROOT, 'docs/ops/phase');
const phase = fs.existsSync(phasePath) ? fs.readFileSync(phasePath, 'utf8').trim() : '(無し)';
process.stdout.write(`  📖 現在フェーズ: ${phase}\n`);
for (const [label, f] of [['引き継ぎ', 'docs/handoff.md'], ['計画', 'docs/ops/plan.md'], ['ルール', 'AGENTS.md']]) {
  const exists = fs.existsSync(path.join(ROOT, f));
  process.stdout.write(`  ${exists ? '📖' : '❌'} ${label}: ${f}${exists ? '' : ' が無い'}\n`);
  if (!exists) problems.push(`${f} が無い`);
}

/* ── 3.5 大計画を強制的に画面へ出す（`npm run plan`）。読んだ印を残す ── */
try {
  process.stdout.write(`\n${sh('node scripts/plan.mjs')}\n`);
  fs.writeFileSync(path.join(ROOT, '.plan-read'), `${new Date().toISOString()}\n`);
  /* **「いまやる番」の値を、このセッション開始時点のものとして残す。**
     `checkout.mjs` の7項目目（この行を今回のセッションで更新したか）は、
     以前は `origin/master` の値と比べていた。だが**このセッション自身の
     最後のマージが `origin/master` にその更新を運んだ後**に checkout.mjs を
     走らせると、比べる相手（origin/master）がもう自分の更新後の値になっており、
     何を書いても「変わっていない」としか出せない（`git show origin/master` を
     実行時に取り直しているため）。セッション開始の瞬間の値をここに固定して、
     checkout.mjs には**これ**と比べさせる。 */
  const planText = fs.readFileSync(path.join(ROOT, 'docs/ops/plan.md'), 'utf8');
  const nextLine = (planText.match(/^\*\*いまやる番:\s*(.+?)\*\*\s*$/m) || [])[1];
  if (nextLine !== undefined) {
    fs.writeFileSync(path.join(ROOT, '.plan-next-baseline'), `${nextLine}\n`);
  }
} catch (e) {
  process.stdout.write(`\n  ❌ 大計画を読めなかった: ${e.message.split('\n')[0]}\n`);
  problems.push('docs/ops/plan.md を読めない（壊れている可能性）');
}

/* ── 4. そのフェーズの作業場が開いているか ── */
if (phase !== '(無し)') {
  const gate = quiet('node scripts/guard/gate.mjs src/index.html');
  process.stdout.write(`  ${gate === 0 ? '🔓' : '🔒'} ${phase} の作業場: ${gate === 0 ? '開いている' : '閉じている（②バッドシナリオ・③再発防止が要る）'}\n`);
}

/* ── 5. いま検査が通るか ── */
process.stdout.write('\n  いまの状態（実行して確かめた）:\n');
for (const [label, cmd] of [['npm run build', 'npm run build'], ['npm run check', 'npm run check'], ['npm test', 'npm test']]) {
  const code = quiet(cmd);
  process.stdout.write(`    ${code === 0 ? '✅' : '❌'} ${label.padEnd(16)} EXIT ${code}\n`);
  if (code !== 0 && label === 'npm run build') problems.push('build が通らない');
}

process.stdout.write('\n  次に読むもの: docs/handoff.md の冒頭「## 0」（上の「いまやる番」が指す作業の詳細）\n');
if (problems.length === 0) {
  process.stdout.write('  始めてよい。\n\n');
  process.exit(0);
}
process.stderr.write(`\n  ${problems.length}件、始める前に片づけること: ${problems.join(' / ')}\n\n`);
process.exit(1);

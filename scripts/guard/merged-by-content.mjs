/**
 * merged-by-content.mjs — 「master に取り込まれたか」を**系譜ではなく中身**で見る、1か所
 *
 * このリポジトリは squash マージで運用している。squash は新しいコミットを1本作るので、
 * **中身が完全に取り込まれていても、元のブランチは master の祖先にならない**
 * （`checkout.mjs` 項目3・`F-20260902-64`）。
 *
 * この判定は `checkout.mjs`（自分のブランチが取り込まれたか、マージ直後に見る）と
 * `checkin.mjs`（他のブランチが取り込まれていないか、何日も後に見る）の両方が必要と
 * するのに、以前は `checkout.mjs` 側にしか実装されておらず、`checkin.mjs` は系譜だけを
 * 見て毎回「未マージのブランチがある」と誤警告していた（放置リスト `#40`）。
 * 2か所に書くと今回のように片方だけ直って食い違う（`AGENTS.md` D-15 と同じ理由）ので、
 * ここ1か所にする。
 *
 * **単純な「触った全ファイルが1バイトも違わない」比較だけでは足りない**（実測で判明）。
 * `checkin.mjs` はマージの何日も後に古いブランチを見るため、そのブランチが触った
 * `docs/ops/plan.md` のような**頻繁に書き換わる共有ファイル**は、squash マージ後も
 * master 側でさらに書き換わっている——ブランチ自身の変更は取り込み済みでも、
 * ファイル全体としては master と一致しなくなる。そこで3通りを順に試す。
 *   ① `git merge-tree` で ref を base へ合流させて、結果が base とまったく同じか
 *      （合流させても何も変わらない＝完全に飲み込み済み）
 *   ② ref が触った全ファイルが base 側と1バイトも違わないか（マージ直後はこれで足りる）
 *   ③ ref 固有のコミット（マージコミットを除く）が、件名だけで base の履歴に
 *      在るか（GitHub の squash マージは既定で「元コミットの件名 (#PR番号)」を
 *      コミットメッセージにする。共有ファイルが後から変わっていても、これなら
 *      「このブランチの仕事そのものは既に master に入っている」と分かる）
 * どれにも当たらなければ「まだ」とする——判定を緩めたのではなく、
 * **系譜だけでは見えない「中身」を、複数の角度から確かめている。**
 */

import { execSync } from 'node:child_process';

const sh = (root, cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quiet = (root, cmd) => { try { execSync(cmd, { cwd: root, stdio: 'ignore' }); return 0; } catch (e) { return e.status || 1; } };

function mergeIsNoop(root, ref, base) {
  try {
    const tree = sh(root, `git merge-tree --write-tree ${base} ${ref}`).split('\n')[0].trim();
    return tree === sh(root, `git rev-parse ${base}^{tree}`);
  } catch {
    return false;
  }
}

function filesIdentical(root, mergeBase, ref, base) {
  const touched = sh(root, `git diff --name-only ${mergeBase} ${ref}`).split('\n').filter(Boolean);
  /* 1件も触っていない（無を通さない）。 */
  return touched.length > 0
    && touched.every((f) => quiet(root, `git diff --quiet ${base} ${ref} -- "${f}"`) === 0);
}

function commitsAlreadyPresent(root, mergeBase, ref, base) {
  const subjects = sh(root, `git log --format=%s --no-merges ${mergeBase}..${ref}`).split('\n').filter(Boolean);
  if (subjects.length === 0) return false;
  const baseLog = sh(root, `git log --format=%s ${base}`);
  return subjects.every((subject) => {
    const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}( \\(#\\d+\\))?$`, 'm').test(baseLog);
  });
}

export function isMergedByContent(root, ref, base = 'origin/master') {
  try {
    const mergeBase = sh(root, `git merge-base ${base} ${ref}`);
    return mergeIsNoop(root, ref, base)
      || filesIdentical(root, mergeBase, ref, base)
      || commitsAlreadyPresent(root, mergeBase, ref, base);
  } catch {
    return false;
  }
}

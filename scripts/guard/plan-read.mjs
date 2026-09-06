/**
 * plan-read.mjs — このセッションが大計画（docs/ops/roadmap.md）を読んだかを確かめる
 *
 * マスター指示（2026-08-29）:「毎回全体計画を強制的に進捗の読み書きをする」。
 * マスター指示（2026-09-06）:「大計画をセッション開始時に絶対に見る様にしろ。
 * 三重で見逃し防止体制にしろ」。
 *
 * **三重の3層目がここ。** 人（`.agents/skills/session-checkin/SKILL.md`）と
 * 目に入る所（`CLAUDE.md` の `@` 参照）が外れても、ここで `npm run check` が止まる。
 *
 * `checkin.mjs` が読ませた印として `.plan-read`（gitignore 対象・作業用のみ）を書く。
 * **この印が無ければ EXIT 1 で止める**——チェックインを踏まずに作業を進められない
 * ようにするため（`AGENTS.md` D-7「文章だけで終わらせない」）。
 *
 * **「在ればいい」ではない**（2026-09-06 に穴を実測）。以前の印は時刻1行で、ここは
 * ファイルの有無しか見ていなかったため、**前のセッションが残した印で次のセッションが
 * 素通りできた**。実際このセッションは前日 2026-09-05 の印のまま通っていた。
 * いまは印に「どのセッションが」「何を読んだか」が入っており、それを突き合わせる
 * （形は `plan-read-mark.mjs` に1本化）。
 *
 * **CI では見ない。** CI はまっさらな clone から `npm ci` を走らせるだけで、
 * 対話セッションの手順（`checkin.mjs`）を一度も呼ばない。ここを CI にも適用すると、
 * すべての PR の `check` job が恒常的に赤くなる——それは「大計画を読め」の強制ではなく、
 * ただの機械の不具合になる。GitHub Actions が既定で立てる `CI=true` で判定する。
 *
 *   node scripts/guard/plan-read.mjs
 */

import { judgePlanReadMark, readPlanReadMark } from './plan-read-mark.mjs';

if (process.env.CI === 'true') {
  console.log('[plan-read] CI 実行なので見ない（checkin.mjs を通らないため）');
  process.exit(0);
}

const verdict = judgePlanReadMark(readPlanReadMark());
if (!verdict.ok) {
  console.error(
    `[plan-read] ❌ ${verdict.why}\n`
    + '  node scripts/guard/checkin.mjs を先に実行すること'
    + '（大計画 docs/ops/roadmap.md を画面に出し、このセッションの印を残す）。',
  );
  process.exit(1);
}
console.log(`[plan-read] ✅ ${verdict.why}`);

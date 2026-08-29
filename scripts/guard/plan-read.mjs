/**
 * plan-read.mjs — このセッションが大計画（docs/ops/plan.md）を読んだかを確かめる
 *
 * マスター指示（2026-08-29）:「毎回全体計画を強制的に進捗の読み書きをする」。
 * `checkin.mjs` が読んだ印として `.plan-read`（gitignore 対象・作業用のみ）を書く。
 * **この印が無ければ `npm run check` を EXIT 1 で止める**——チェックインを踏まずに
 * 作業を進められないようにするため（`AGENTS.md` D-7「文章だけで終わらせない」）。
 *
 * **CI では見ない。** CI はまっさらな clone から `npm ci` を走らせるだけで、
 * 対話セッションの手順（`checkin.mjs`）を一度も呼ばない。ここを CI にも適用すると、
 * すべての PR の `check` job が恒常的に赤くなる——それは「大計画を読め」の強制ではなく、
 * ただの機械の不具合になる。GitHub Actions が既定で立てる `CI=true` で判定する。
 *
 *   node scripts/guard/plan-read.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (process.env.CI === 'true') {
  console.log('[plan-read] CI 実行なので見ない（checkin.mjs を通らないため）');
  process.exit(0);
}

const p = path.join(ROOT, '.plan-read');
if (!fs.existsSync(p)) {
  console.error(
    '[plan-read] ❌ このセッションはまだ大計画（docs/ops/plan.md）を読んでいない。\n'
    + '  node scripts/guard/checkin.mjs を先に実行すること（大計画を画面に出し、印を残す）。',
  );
  process.exit(1);
}
console.log(`[plan-read] ✅ 読んだ（${fs.readFileSync(p, 'utf8').trim()}）`);

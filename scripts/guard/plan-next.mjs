/**
 * plan-next.mjs — このセッションが**大計画のどれをやるか**割り当てられているかを見る
 *
 * マスター指示（2026-09-06）:「大計画通りに進めろ。毎回そうしろ。毎回そうする仕組みに変えろ」。
 *
 * `plan-read.mjs` は**読んだか**を見る。ここは**その通りに進めているか**を見る。
 * 読んだ直後に「どれから着手しますか」と訊いた回が実際にあった（同日・実測）。
 * 大計画に次の一手が書いてあるのに選ばせていた——**読ませただけでは進まない。**
 *
 * 割り当ては人が選ばない。`checkin.mjs` が「次の一手」のいちばん上を機械で取る。
 * ここは、その印がこのセッションのものかだけを見る。
 *
 * **CI では見ない**（`plan-read.mjs` と同じ理由——CI は `checkin.mjs` を通らない）。
 *
 *   node scripts/guard/plan-next.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PLAN, parseNextList, readDoingMark, judgeDoingMark } from './next-list.mjs';

if (process.env.CI === 'true') {
  console.log('[plan-next] CI 実行なので見ない（checkin.mjs を通らないため）');
  process.exit(0);
}

const items = parseNextList(fs.readFileSync(path.join(ROOT, PLAN), 'utf8'));
const verdict = judgeDoingMark(readDoingMark(), items);
if (!verdict.ok) {
  console.error(
    `[plan-next] ❌ ${verdict.why}\n`
    + '  node scripts/guard/checkin.mjs を実行すること'
    + `（${PLAN} の「次の一手」のいちばん上を、このセッションに割り当てる）。`,
  );
  process.exit(1);
}
console.log(`[plan-next] ✅ このセッションがやること: ${verdict.why}`);

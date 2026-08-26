/**
 * plan.mjs — 全体計画を1枚で出す（マスター指示 2026-08-26）
 *
 * 出すとき（3つ）:
 *   ①「全体計画を見せて」と言われたとき
 *   ② フェーズが終わったとき
 *   ③ チェックイン／チェックアウトのとき
 *
 * **現在地を人が書き写さない。** `docs/ops/phase` と `docs/deferred.md` から
 * 機械で読む——書き写すと、地図だけが現実とズレる（`docs/handoff.md` の
 * 「## 0」が実際にそうなっていた）。
 *
 *   npm run plan
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const phase = read('docs/ops/phase').trim();

/* 宿題の件数は台帳から数える。手で書くと必ず古くなる。 */
const deferred = read('docs/deferred.md').split('\n').filter((l) => /^\| \d+ \|/.test(l));
const done = deferred.filter((l) => l.includes('直した')).length;
const open = deferred.length - done;

/* フェーズは「終わったか」だけを持つ。細かい作業は書かない（マスター指示）。 */
const STAGES = [
  { key: 'F1', label: '片づける', what: '見た目とデータ処理を分ける' },
  { key: 'F2', label: '画面だけで通す', what: '仮のデータで最後まで通す' },
  { key: 'F3', label: '本物のデータにつなぐ', what: '書いたものが飼い主さんに同じ内容で届く' },
  { key: '棚卸し', label: '宿題を仕分ける', what: 'あなたが「直す／やらない」を決める' },
  { key: '納品準備', label: '本番に出せる状態にする', what: '本番へ出す・鍵の入れ替え・ダミー削除' },
];

/* いまのフェーズより前は終わり、同じなら作業中、後はこれから。
   `docs/ops/phase` が `F3` でも、F3 の完了条件を満たしていれば次は棚卸し——
   その判定は `gate.mjs --end` の担当なので、ここでは**言い切らない**。 */
const index = STAGES.findIndex((s) => s.key === phase);

const out = [];
out.push('');
out.push('【全体計画】スタート → ゴール');
out.push('  デザイン見本とアプリがバラバラ → …… → お店が毎日使い、飼い主さんに届く');
out.push('');
for (let i = 0; i < STAGES.length; i += 1) {
  const stage = STAGES[i];
  const mark = i < index ? '✅' : (i === index ? '▶ ' : '⬜');
  out.push(`  ${mark} ${stage.key.padEnd(6, '　')} ${stage.label}`);
  out.push(`       ${stage.what}`);
}
out.push('');
out.push(`  現在地: ${phase}（docs/ops/phase）`);
out.push(`  宿題:   残り ${open}件 / 片づいた ${done}件（docs/deferred.md）`);
out.push('');
out.push('  詳しい地図: docs/ops/roadmap.md（フロー図つき）');
out.push('  フェーズを閉じてよいか: node scripts/guard/gate.mjs --end');
out.push('');

process.stdout.write(out.join('\n'));

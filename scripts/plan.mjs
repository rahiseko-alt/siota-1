/**
 * plan.mjs — 全体計画を1枚で出す（マスター指示 2026-08-26）
 *
 * 出すとき（3つ）:
 *   ①「全体計画を見せて」と言われたとき
 *   ② フェーズが終わったとき
 *   ③ チェックイン／チェックアウトのとき
 *
 * **現在地を人が書き写さない。** `docs/ops/phase` と `docs/ops/plan.md`（放置リスト節）から
 * 機械で読む——書き写すと、地図だけが現実とズレる（`docs/handoff.md` の
 * 「## 0」が実際にそうなっていた）。
 *
 * **2026-08-29 の直し（`F-plan-stages-mismatch`）**: `STAGES` に `F4` が無く、
 * `docs/ops/phase` が `F4` になった時点で `findIndex` が `-1` を返し、
 * **完了済みの F1〜F3 まで全段「未着手」と表示していた。** `docs/deferred.md` も
 * `docs/ops/plan.md` に統合されたため、宿題の集計先も差し替えた。
 *
 *   npm run plan
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* フェーズは「終わったか」だけを持つ。細かい作業は書かない（マスター指示）。
   F4 以降（棚卸し・納品準備）はまだ固有の札を持たないので、`docs/ops/phase` の
   値がそのまま残る。C-1〜C-12・P-1〜P-3 の状態は第9〜10章の表を見ること。
   **`test/plan.test.mjs` が `F4` の欠落を再発させないことを見る。** */
export const STAGES = [
  { key: 'F1', label: '片づける', what: '見た目とデータ処理を分ける' },
  { key: 'F2', label: '画面だけで通す', what: '仮のデータで最後まで通す' },
  { key: 'F3', label: '本物のデータにつなぐ', what: '書いたものが飼い主さんに同じ内容で届く' },
  { key: 'F4', label: '棚卸しと納品の仕上げ', what: 'クライアント指示・納品前診断・放置リストを片づける' },
  { key: '棚卸し', label: '宿題を仕分ける', what: 'あなたが「直す／やらない」を決める' },
  { key: '納品準備', label: '本番に出せる状態にする', what: '本番へ出す・鍵の入れ替え・ダミー削除' },
];

/** `docs/ops/phase` の値が `STAGES` のどこに立つか。見つからなければ `-1`
    （呼び出し側は全段 `⬜` として扱う——これが今回の事故そのものだった）。 */
export function stageIndex(phase) {
  return STAGES.findIndex((s) => s.key === phase);
}

/** 一本化した計画（`docs/ops/plan.md`）から「いまやる番」を読む。 */
export function readNextLine(planText) {
  return (planText.match(/^\*\*いまやる番:\s*(.+?)\*\*\s*$/m) || [])[1] || '(未設定)';
}

/** 放置リスト（第12章）の行数を数える。`| 数字 |` で始まる行だけが対象
    （`C-1` や `1-1` のような節番号は混ざらない）。 */
export function countDeferred(planText) {
  const rows = planText.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const done = rows.filter((l) => l.includes('直した')).length;
  return { total: rows.length, done, open: rows.length - done };
}

/** 出力本体（テストから直接呼べるよう純関数にしてある）。 */
export function render(phase, planText) {
  const index = stageIndex(phase);
  const nextLine = readNextLine(planText);
  const { open, done } = countDeferred(planText);

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
  out.push(`  いまやる番: ${nextLine}`);
  out.push(`  放置リスト: 残り ${open}件 / 片づいた ${done}件（docs/ops/plan.md 第12章）`);
  out.push('');
  out.push('  詳しい地図: docs/ops/roadmap.md（フロー図つき）');
  out.push('  クライアント指示: docs/ops/plan.md 第10章（C-1〜C-12）');
  out.push('  フェーズを閉じてよいか: node scripts/guard/gate.mjs --end');
  out.push('');
  return out.join('\n');
}

/* `import` されただけでは走らない（`mutate-run.mjs` と同じ理由・F-20260825-33 の型）。 */
const DIRECT = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (DIRECT) {
  const phase = read('docs/ops/phase').trim();
  const planText = read('docs/ops/plan.md');
  process.stdout.write(render(phase, planText));
}

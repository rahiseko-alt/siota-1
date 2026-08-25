/**
 * gate.mjs — ②③のサブを「呼び忘れ」させないための関所
 *
 * マスター指定の発火タイミング:
 *   ② バッドシナリオ … フェーズ開始直後
 *   ③ 再発防止       … フェーズの開始直後 と 完了直後
 *
 * 呼んだかどうかは記憶に頼らない。**成果物が在るか**だけを見る。
 *   docs/ops/failure-check-F{n}-start.md   ③（開始）
 *   docs/ops/bad-scenarios-F{n}.md         ②（10個の提案・マスターの承認印・実行結果）
 *   docs/ops/failure-check-F{n}-end.md     ③（完了）※フェーズを閉じるときだけ
 *   docs/ops/solved-F{n}.md                「解決した」の3出力（D-18）※閉じるときだけ
 *
 * 揃うまで、そのフェーズの**作業場**を書き換えない。
 * 記録と仕組みの置き場（docs/ scripts/guard/ .agents/）は、いつでも書ける——
 * そこを止めたら、成果物そのものが作れなくなる。
 *
 *   node scripts/guard/gate.mjs src/index.html
 *   node scripts/guard/gate.mjs --end        フェーズを閉じてよいか
 */

import fs from 'node:fs';
import path from 'node:path';
import { readPhase, rel, ALWAYS } from './scope.mjs';
import { checkSolved } from './solved.mjs';
import { pathToFileURL } from 'node:url';

/** 関所を通さずに書いてよい場所（＝成果物と仕組みの置き場）。 */
const EXEMPT = ALWAYS;

/** 揃っていない成果物の一覧。空なら開いている。 */
export function missingArtifacts(root, phase, { end = false } = {}) {
  const missing = [];
  const at = (n) => path.join(root, `docs/ops/${n}`);

  if (!fs.existsSync(at(`failure-check-${phase}-start.md`))) {
    missing.push(`③ 再発防止（開始）が無い → docs/ops/failure-check-${phase}-start.md\n`
      + `   docs/failures.md と docs/decisions.md を全件照合した結果を置くこと。`);
  }
  const bad = at(`bad-scenarios-${phase}.md`);
  if (!fs.existsSync(bad)) {
    missing.push(`② バッドシナリオが無い → docs/ops/bad-scenarios-${phase}.md\n`
      + `   **本質的かつ単純な見落とし10個**を出してマスターに提案すること。`);
  } else {
    const text = fs.readFileSync(bad, 'utf8');
    if (!/^承認:\s*済/m.test(text)) {
      missing.push(`② バッドシナリオに**マスターの承認印が無い** → docs/ops/bad-scenarios-${phase}.md\n`
        + `   10個を提案し、承認を受けてから「承認: 済」を書き、10個を実行すること。`);
      /* 見出し行だけを見る。手順の説明文に出てくる「結果: 未」を数えない。 */
    } else if (/^###.*結果:\s*未\s*$/m.test(text)) {
      missing.push(`② バッドシナリオが**まだ実行されていない** → docs/ops/bad-scenarios-${phase}.md\n`
        + `   結果が「未」の行が残っている。10個を実行し、該当しないことを確かめること。`);
      /* 「該当した」のまま手つかずの項だけを止める。
         「該当した ／ 解決済み」は solved.mjs が3出力で裏を取る。
         書き換えて「該当せず」にする逃げ道は solved.mjs 側で塞いである。 */
    } else if (/^###.*結果:\s*該当した\s*$/m.test(text)) {
      missing.push(`② バッドシナリオに**手つかずの「該当した」が残っている** → docs/ops/bad-scenarios-${phase}.md\n`
        + `   解決したら見出しを「結果: 該当した ／ 解決済み」にし、docs/ops/solved-${phase}.md に3出力を貼ること。`);
    }
  }
  if (end) {
    /* 「解決した」の主張が、赤 → 緑 → 戻して赤 の3出力で裏づけられているか（D-18）。 */
    for (const why of checkSolved(root, phase)) {
      missing.push(`D-18 解決の裏づけ: ${why}`);
    }
  }
  if (end && !fs.existsSync(at(`failure-check-${phase}-end.md`))) {
    missing.push(`③ 再発防止（完了）が無い → docs/ops/failure-check-${phase}-end.md\n`
      + `   フェーズを閉じる前に、もう一度全件照合すること。`);
  }
  return missing;
}

/* ── 直接叩かれたとき ── */
/* Windows では `process.argv[1]` が `C:\...` 形式なので、`file://` を前置しても
   `import.meta.url`（`file:///C:/...`）と一致しない＝直接実行しても何も起きない。
   `pathToFileURL()` は Node 標準で、どの OS でも同じ形にそろえる。 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const phase = readPhase(root);
  if (!phase) process.exit(0);

  const argv = process.argv.slice(2);
  const end = argv.includes('--end');
  const targets = argv.filter((a) => a !== '--end');

  if (!end) {
    const rels = targets.map((t) => rel(root, t)).filter(Boolean);
    if (rels.length === 0) process.exit(0);
    const outside = rels.filter(
      (r) => !EXEMPT.some((e) => r === e.slice(0, -1) || r.startsWith(e)),
    );
    if (outside.length === 0) process.exit(0);
    const missing = missingArtifacts(root, phase);
    if (missing.length === 0) process.exit(0);
    process.stderr.write(
      `【関所】${phase} の作業場はまだ開いていません。触ろうとした場所: ${outside.join(', ')}\n\n`
      + missing.map((m) => `- ${m}`).join('\n')
      + `\n\n記録と仕組み（docs/ scripts/guard/ .agents/）は、いつでも書けます。\n`,
    );
    process.exit(1);
  }

  const missing = missingArtifacts(root, phase, { end: true });
  if (missing.length === 0) {
    process.stdout.write(`【関所】${phase} は閉じてよい状態です。\n`);
    process.exit(0);
  }
  process.stderr.write(`【関所】${phase} はまだ閉じられません。\n\n`
    + missing.map((m) => `- ${m}`).join('\n') + '\n');
  process.exit(1);
}

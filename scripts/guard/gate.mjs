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
 * バッドシナリオの未解決は、**作業中は「減っていること」・閉じるときは「0 件」**を要求する
 * （常に 0 件を要求すると、作業場の中にある地雷を潰す作業そのものが止まるため）。
 * 記録と仕組みの置き場（docs/ scripts/guard/ .agents/）は、いつでも書ける——
 * そこを止めたら、成果物そのものが作れなくなる。
 *
 *   node scripts/guard/gate.mjs src/index.html
 *   node scripts/guard/gate.mjs --end        フェーズを閉じてよいか
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readPhase, rel, ALWAYS } from './scope.mjs';
import { checkSolved } from './solved.mjs';
import { check as deliveryCheck } from './delivery-ready.mjs';
import { pathToFileURL } from 'node:url';

/** 関所を通さずに書いてよい場所（＝成果物と仕組みの置き場）。 */
const EXEMPT = ALWAYS;

/** 見出し行だけを見て、手つかずの「該当した」の**番号**を返す。

    行末で判定しない。`結果: 該当した（マスター作業・未着手）` のように**後ろに何か書くだけで
    数から外れてしまう**ため（実際に旧 #3 がそうなっていた）。
    「解決済み」と書いてあるかどうかだけで決める。 */
export function unresolvedNumbers(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('###')) continue;
    if (!/結果:\s*該当した/.test(line)) continue;
    if (/解決済み/.test(line)) continue;
    const m = line.match(/^###\s*(\d+)\./);
    out.push(m ? m[1] : line.trim());
  }
  return out;
}

export function unresolvedCount(text) {
  return unresolvedNumbers(text).length;
}

/** **出発点**の未解決数。「減っているか」を言うには、比べる相手が要る。

    ①本流（`origin/master`）に在ればそれ。②無ければ**この書類が最初にコミットされた版**
    ——つまり提案した時点。③どちらも取れなければ項目数。

    ②が要る理由: この枝で始めたフェーズでは本流にまだ書類が無い。そこで項目数を出発点に
    すると、**`結果: 該当せず` の項を新しく足すだけで出発点が1つ増え、条件が緩む**。
    「提案した時点」を出発点にすれば、あとから何を足しても出発点は動かない。 */
function baselineUnresolvedNumbers(root, phase, currentText) {
  const rel = `docs/ops/bad-scenarios-${phase}.md`;
  for (const ref of ['origin/master', 'origin/main', 'master', 'main']) {
    try {
      const past = execSync(`git show ${ref}:${rel}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return unresolvedNumbers(past);
    } catch { /* その ref に無い。次を試す */ }
  }
  try {
    const first = execSync(`git log --diff-filter=A --format=%H -- ${rel}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n').filter(Boolean).pop();
    if (first) {
      const past = execSync(`git show ${first}:${rel}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return unresolvedNumbers(past);
    }
  } catch { /* まだ一度もコミットしていない */ }
  return unresolvedNumbers(currentText);
}

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
      /* 「該当した」のまま手つかずの項を見る。
         「該当した ／ 解決済み」は solved.mjs が3出力で裏を取る。
         書き換えて「該当せず」にする逃げ道は solved.mjs 側で塞いである。

         **閉じるときは 0 件を要求する。作業中は「減っていること」を要求する。**
         0 件を常に要求すると、**地雷を潰す作業そのものが止まる**——#8 や #9 のように
         直す場所が作業場の中にある項は、永久に着手できなくなっていた（マスター判断・2026-08-25）。
         増やす変更は従来どおり止まるので、緩めたことにはならない。 */
    } else {
      const now = unresolvedCount(text);
      if (end) {
        if (now > 0) {
          missing.push(`② バッドシナリオに**手つかずの「該当した」が ${now}件**残っている → docs/ops/bad-scenarios-${phase}.md\n`
            + `   フェーズを閉じるには 0 件にすること。`
            + `解決したら見出しを「結果: 該当した ／ 解決済み」にし、docs/ops/solved-${phase}.md に3出力を貼る。`);
        }
      } else {
        /* 数えるのは**出発点に在った項目**だけ。作業中に新しく見つけた項目を
           分母に入れると、**見つけて記録するほど条件が厳しくなる**——
           記録しないほうが得になってしまう。F2 の #11 のように、
           作業中に見つかるものこそ重い（マスター判断・2026-08-25）。
           新しい項目も**閉じるときには 0 件を要求される**ので、逃がしてはいない。 */
        const base = baselineUnresolvedNumbers(root, phase, text);
        const stillOpen = unresolvedNumbers(text).filter((n) => base.includes(n));
        if (base.length > 0 && stillOpen.length >= base.length) {
          missing.push(`② バッドシナリオの**未解決が減っていない**（出発点 ${base.length}件 → いま ${stillOpen.length}件） → docs/ops/bad-scenarios-${phase}.md\n`
            + `   作業場を触ってよいのは、**この書類の未解決を減らす変更**のときだけです。\n`
            + `   1件でも解決して（見出しを「結果: 該当した ／ 解決済み」にし、docs/ops/solved-${phase}.md に3出力を貼る）から進めてください。\n`
            + `   まだ手つかず: ${stillOpen.join(', ')}`);
        }
      }
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
  /* F4 固有: 台帳（docs/ops/proof-of-red.md）が「客に当たる経路」まで埋まっているか。
     `docs/ops/proof-of-red.md` の「## F4 を閉じる範囲」節が無ければ delivery-ready 側が
     fatal を返すので、その場合はここでは何も言わない（台帳自体が無いフェーズで
     誤って引っかからないように、節の有無で判定する）。 */
  if (end && phase === 'F4' && fs.existsSync(path.join(root, 'docs/ops/proof-of-red.md'))) {
    const d = deliveryCheck(root);
    if (!d.fatal) {
      if (d.unprovenInScope.length > 0) {
        missing.push(`台帳（客に当たる経路）に未証明が ${d.unprovenInScope.length}件 → docs/ops/proof-of-red.md\n`
          + `   node scripts/guard/delivery-ready.mjs で内訳を見ること。`);
      }
      if (d.unaccounted.length > 0) {
        missing.push(`台帳に理由の無い未証明が ${d.unaccounted.length}件 → docs/ops/proof-of-red.md\n`
          + `   「### 判定できない」か「### F4 の後に回す」に理由つきで足すこと。`);
      }
      if (d.result.missing || d.result.warning) {
        missing.push(`1件ずつ壊す（mutate-run.mjs）の全体結果に赤0件の組が残っているか、まだ無い → docs/ops/mutate-run-result.md`);
      }
    }
  }
  return missing;
}

/* ── 直接叩かれたとき ── */
/* Windows では `process.argv[1]` が `C:\...` 形式なので、`file://` を前置しても
   `import.meta.url`（`file:///C:/...`）と一致しない＝直接実行しても何も起きない。
   `pathToFileURL()` は Node 標準で、どの OS でも同じ形にそろえる。 */
/* `process.argv[1]` は `node -e` などでは undefined で、`pathToFileURL` が投げる。
   直接実行かどうかを見るだけの分岐で落ちると、**このファイルを import した側**が
   道連れになる（F-20260825-33 の型）。存在を先に確かめる。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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

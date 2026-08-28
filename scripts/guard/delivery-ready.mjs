/**
 * delivery-ready.mjs — 台帳が「客に当たる経路」まで埋まったか（F4 を閉じてよいか）を機械で見る
 *
 * マスター判断（2026-08-28）: `docs/ops/proof-of-red.md` の129件すべてではなく、
 * **客に当たる経路まで**で F4 を閉じる。あわせて「受け入れ基準を決めろ」との指示があった。
 *
 * **`npm run check` は毎日通す道なので、そこを赤にはしない。** これは `gate.mjs --end`
 * （フェーズを閉じてよいかの関所）から呼ばれる。`checkout.mjs`（セッション終了の関所）は
 * F4 が閉じていない状態でも毎回通る必要があるので、そちらには繋がない。
 *
 * 範囲は `docs/ops/proof-of-red.md` の「## F4 を閉じる範囲」節に、**ファイル名で**
 * 固定してある。ここでその3節を読み、3つの条件すべてを機械で確かめる:
 *
 *   1. 「客に当たる経路」11本の全件が「証明済み」
 *   2. 「未証明」に残るものは、すべて「判定できない」か「F4 の後に回す」のどちらかにも載っている
 *   3. `docs/ops/mutate-run-result.md`（全体の記録）に ⚠️ が無い
 *
 * **盛らせない造り**: 11本の一覧は台帳のファイル名から読む。減らせば「宣言した本数が
 * 減っている」で赤。条件2があるので、未証明を黙って消すことも理由なく除外することもできない
 * （`proof-of-red.mjs` が「台帳に無い検査」「台帳が実体に無い検査を指している」で
 * すでに塞いでいる範囲の外側を、この機械が塞ぐ）。
 *
 *   node scripts/guard/delivery-ready.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allChecks, sectionEntries, audit } from './proof-of-red.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = 'docs/ops/proof-of-red.md';
const RESULT = 'docs/ops/mutate-run-result.md';
const REASON_HEADING = '## 1項ごとに埋められない理由';

/** 「## F4 を閉じる範囲」以下から、見出しごとの `verify-*.mjs` 名を拾う。
    3節とも書き方（コードブロック／太字つき箇条書き）が違うので、
    節の本文から `verify-[\w-]+\.mjs` を正規表現で総なめにする——
    「どの節に、どのファイルが名指しされているか」だけが要る。 */
export function scopeSections(text) {
  const start = text.indexOf('## F4 を閉じる範囲');
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(/\n## ⛔/);
  const body = end < 0 ? rest : rest.slice(0, end);

  const heading = (h) => {
    const i = body.indexOf(h);
    if (i < 0) return null;
    const after = body.slice(i + h.length);
    const stop = after.search(/\n### /);
    return after.slice(0, stop < 0 ? undefined : stop);
  };

  const filesIn = (s) => (s === null ? null
    : [...new Set([...s.matchAll(/verify-[\w-]+\.mjs/g)].map((m) => m[0]))]);

  return {
    scope: filesIn(heading('### 客に当たる経路')),
    excluded: filesIn(heading('### 判定できない')),
    later: filesIn(heading('### F4 の後に回す')),
  };
}

/**
 * 「## 1項ごとに埋められない理由」を読む（マスター判断 A・2026-08-28）。
 *
 * **なぜ要るか**: 除外はそれまで**ファイル単位**でしか書けなかった。ところが
 * 実測してみると、埋められない項の理由は**1項ごとに違う**——「直前の待ちが
 * 同じことを既に保証している」「二重の守りの結果を見ている」「名前が変数」
 * 「症状が起きないので緑が正しい」。**ファイル単位で外すと、同じファイルの
 * 他の項まで一緒に外れてしまう**ので書けず、理由を台帳に書いても機械は数え
 * 続け、F4 が構造上閉じられなかった。
 *
 * **書き方**（`- <ファイル> :: <検査の名前>` の次の行に、字下げして理由）:
 *
 *   - verify-portal.mjs :: 1. /my が配信される
 *     理由: ここを壊すと検査が最初の一歩で死ぬので、狙った項は何も証明できない。
 *
 * **黙らせる道具にしないための歯止め**（下の `check()` で全部見る）:
 *   - 理由が短すぎる（`MIN_REASON` 未満）ものは**理由と認めない**
 *   - 実体に無い検査を指している行は**古い**として赤にする
 *   - すでに証明済みの項を指している行は**矛盾**として赤にする
 *   - 何件を、どの理由で外したかを**必ず出力に出す**（黙って消えない）
 */
export const MIN_REASON = 20;

export function perCheckReasons(text) {
  const start = text.indexOf(REASON_HEADING);
  if (start < 0) return [];
  const rest = text.slice(start + REASON_HEADING.length);
  const end = rest.search(/\n## /);
  const body = end < 0 ? rest : rest.slice(0, end);
  return [...body.matchAll(
    /^-\s+(verify-[\w-]+\.mjs)\s*::\s*(.+?)\s*\n\s+理由:\s*(.+?)\s*$/gm,
  )].map((m) => ({ file: m[1], name: m[2], reason: m[3] }));
}

/** `docs/ops/mutate-run-result.md`（全体の記録・部分実行は別名なのでここには来ない）に
    ⚠️ の節が無いか。**ファイルが無ければ「まだ一度も走らせていない」で不足扱い**——
    無いことを「問題なし」と読むと、一度も証明していないのに通ってしまう。 */
export function latestResultHasWarning(root) {
  const p = path.join(root, RESULT);
  if (!fs.existsSync(p)) return { missing: true };
  const text = fs.readFileSync(p, 'utf8');
  return { missing: false, warning: /^## ⚠️/m.test(text) };
}

export function check(root) {
  const ledgerPath = path.join(root, LEDGER);
  if (!fs.existsSync(ledgerPath)) return { fatal: `台帳が無い → ${LEDGER}` };
  const text = fs.readFileSync(ledgerPath, 'utf8');

  const sections = scopeSections(text);
  if (sections === null) return { fatal: `台帳に「## F4 を閉じる範囲」節が無い → ${LEDGER}` };
  const { scope, excluded, later } = sections;
  if (!scope || scope.length === 0) {
    return { fatal: `「### 客に当たる経路」に \`verify-*.mjs\` が1本も名指しされていない → ${LEDGER}` };
  }

  const a = audit(root);
  if (a.fatal) return { fatal: a.fatal };

  const checks = allChecks(root);
  const proven = sectionEntries(text, '## 証明済み') || [];
  const provenKeys = new Set(proven.map((e) => `${e.file}::${e.name}`));
  const reasoned = new Set([...(excluded || []), ...(later || [])]);

  /* 条件1: 客に当たる経路の全件が証明済み。 */
  const inScope = checks.filter((c) => scope.includes(c.file));
  const unprovenInScope = inScope.filter((c) => !provenKeys.has(`${c.file}::${c.name}`));

  /* 条件2: 未証明に残るものは、範囲外なら理由つきの節に載っていること。
     `proof-of-red` の「未証明」節そのものではなく、**いま実際に未証明な全件**を機械で
     数え直す——台帳の「未証明」の書き漏れに引きずられないため。 */
  /* **1項ごとの理由**（マスター判断 A・2026-08-28）。ファイル単位の除外では
     書けない「この項だけは埋められない」を機械に読ませる。歯止めは3つ数える。 */
  const live = new Set(checks.map((c) => `${c.file}::${c.name}`));
  const reasons = perCheckReasons(text);
  const thin = reasons.filter((r) => r.reason.length < MIN_REASON);
  const staleReasons = reasons.filter((r) => !live.has(`${r.file}::${r.name}`));
  const contradicting = reasons.filter((r) => provenKeys.has(`${r.file}::${r.name}`));
  /* **歯止めに引っかかった行は、理由として認めない。** 認めると「短い言い訳を
     書けば外せる」「古い行が残ったまま外し続ける」になる。 */
  const bad = new Set(
    [...thin, ...staleReasons, ...contradicting].map((r) => `${r.file}::${r.name}`),
  );
  const excused = reasons.filter((r) => !bad.has(`${r.file}::${r.name}`));
  const excusedKeys = new Set(excused.map((r) => `${r.file}::${r.name}`));

  const unproven = checks.filter((c) => !provenKeys.has(`${c.file}::${c.name}`));
  const unaccounted = unproven.filter(
    (c) => !scope.includes(c.file) && !reasoned.has(c.file)
      && !excusedKeys.has(`${c.file}::${c.name}`),
  );

  /* 条件3: 最新の全体結果に赤0件の組が無いこと。 */
  const result = latestResultHasWarning(root);

  return {
    scopeFiles: scope,
    excludedFiles: excluded || [],
    laterFiles: later || [],
    /* 理由つきで外したものは差し引く。**何件をどの理由で外したかは必ず出力に出す。** */
    unprovenInScope: unprovenInScope.filter((c) => !excusedKeys.has(`${c.file}::${c.name}`)),
    unaccounted,
    excused,
    thin,
    staleReasons,
    contradicting,
    result,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = check(ROOT);
  if (r.fatal) {
    process.stderr.write(`[delivery-ready] ${r.fatal}\n`);
    process.exit(1);
  }

  const problems = [];
  if (r.unprovenInScope.length > 0) {
    problems.push(
      `**客に当たる経路（${r.scopeFiles.join(' / ')}）に未証明が ${r.unprovenInScope.length}件**残っている:\n`
      + r.unprovenInScope.map((c) => `      ${c.file}:${c.line}  ${c.name}`).join('\n'),
    );
  }
  if (r.unaccounted.length > 0) {
    problems.push(
      `**理由の無い未証明が ${r.unaccounted.length}件**（客に当たる経路でも、除外の理由も無い）:\n`
      + r.unaccounted.map((c) => `      ${c.file}:${c.line}  ${c.name}`).join('\n')
      + `\n    台帳の「### 判定できない」か「### F4 の後に回す」に、理由つきでファイル名を足すこと。`,
    );
  }
  /* **歯止め。** 理由として認めなかった行は、黙って落とさず名指しで出す。 */
  if (r.thin.length > 0) {
    problems.push(
      `**理由が短すぎる行が ${r.thin.length}件**（${MIN_REASON}字未満は理由と認めない）:\n`
      + r.thin.map((x) => `      ${x.file} :: ${x.name}  → 「${x.reason}」`).join('\n')
      + `\n    **何が守られていて、なぜ単発の壊しでは赤にできないのか**を書くこと。`,
    );
  }
  if (r.staleReasons.length > 0) {
    problems.push(
      `**実体に無い検査を指している理由が ${r.staleReasons.length}件**（台帳が古い）:\n`
      + r.staleReasons.map((x) => `      ${x.file} :: ${x.name}`).join('\n'),
    );
  }
  if (r.contradicting.length > 0) {
    problems.push(
      `**すでに証明済みの項に「埋められない理由」が付いている行が ${r.contradicting.length}件**（矛盾）:\n`
      + r.contradicting.map((x) => `      ${x.file} :: ${x.name}`).join('\n')
      + `\n    証明できたなら、この理由の行は消すこと。`,
    );
  }

  if (r.result.missing) {
    problems.push(`**${RESULT} が無い**。1件ずつ壊す（\`mutate-run.mjs\`）を、絞らずに一度は走らせること。`);
  } else if (r.result.warning) {
    problems.push(`**${RESULT} に ⚠️（赤0件の組）が残っている**。埋めるのではなく直す作業が先。`);
  }

  if (problems.length === 0) {
    process.stdout.write(
      `[delivery-ready] ✅ F4 を閉じてよい。\n`
      + `  客に当たる経路 ${r.scopeFiles.length}本 … 全件証明済み\n`
      + `  判定できない ${r.excludedFiles.length}本 ／ F4 の後に回す ${r.laterFiles.length}本 … 理由つきで除外\n`
      + (r.excused.length === 0 ? ''
        : `  1項ごとに埋められない ${r.excused.length}件 … **理由つきで外した**（下記）\n`
          + r.excused.map((x) => `      ${x.file} :: ${x.name}\n        ${x.reason}`).join('\n') + '\n'),
    );
    process.exit(0);
  }
  process.stderr.write(
    `[delivery-ready] ❌ F4 はまだ閉じられない。\n\n`
    + problems.map((p) => `  - ${p}`).join('\n\n') + '\n',
  );
  process.exit(1);
}

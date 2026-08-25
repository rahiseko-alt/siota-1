/**
 * solved.mjs — 「解決した」の主張を、出力で裏づけさせる（AGENTS.md D-18）
 *
 * 三層を混同しないための関所。
 *   調べる（テスト） … 該当するかを判定しただけ。直していない
 *   直す（修正）     … 症状が出なくなっただけ。原因は残っていてよい
 *   解決する         … 原因が無くなった
 *
 * 「解決」と言うには、1件につき**3つの出力**が要る。
 *   ① 直す前（赤）  ② 直した後（緑）  ③ 直しを戻した（また赤）
 * ③が無い主張は、**直したのがそこだという証明が無い**（偽-4・偽-6・偽-10）。
 * ①と③に同じ症状の行が無ければ、**別のものを直している**。
 *
 * 「解決」と呼べないものは `種別: 回避` `種別: 保留` と書き、
 * `docs/deferred.md` の番号を添える（偽-3・偽-8）。逃げ道は記録に残す。
 *
 *   node scripts/guard/solved.mjs        現在フェーズを見る
 *   node scripts/guard/solved.mjs F1     フェーズを指定する
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readPhase } from './scope.mjs';
import { pathToFileURL } from 'node:url';

/** この記録の過去の版。書き換えて無かったことにする逃げ道を塞ぐ。 */
function pastVersions(root, relPath) {
  try {
    const revs = execSync(`git log --format=%H -- ${relPath}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n').filter(Boolean);
    return revs.map((r) => {
      try {
        return execSync(`git show ${r}:${relPath}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      } catch { return ''; }
    });
  } catch { return []; }
}

const HEADS = ['直す前（赤）', '直した後（緑）', '直しを戻した（また赤）'];
const KINDS = ['解決', '回避', '保留'];

/** ``` で囲まれた塊を全部取り出す。 */
function fences(text) {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/** 見出し直後の出力（次の #### か ### までの間）。 */
function sectionOf(body, head) {
  const i = body.indexOf(`#### ${head}`);
  if (i < 0) return null;
  const rest = body.slice(i + head.length + 5);
  const end = rest.search(/\n#{3,4} /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** 意味のある行だけ（短すぎる行・空行は、偶然一致するので数えない）。 */
const meaningful = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l.length >= 8);

export function checkSolved(root, phase) {
  const badPath = path.join(root, `docs/ops/bad-scenarios-${phase}.md`);
  if (!fs.existsSync(badPath)) return [];      /* 関所の別項が既に止めている */

  const bad = fs.readFileSync(badPath, 'utf8');
  /* `### 7. 見出し — 結果: 該当した` の形から、該当した項を拾う。 */
  /* 一度「該当した」と書いた項は、あとで「該当せず」に書き換えても逃がさない。
     いまの本文と、git 履歴の全版の両方を見る（偽-4「判定条件を緩める」対策）。 */
  const pick = (text) => [...text.matchAll(/^###\s*(\d+)\.\s*(.+?)\s*[—-]\s*結果:\s*該当した/gm)]
    .map((m) => ({ no: m[1], title: m[2] }));
  const seen = new Map();
  for (const h of pick(bad)) seen.set(h.no, h);
  for (const past of pastVersions(root, `docs/ops/bad-scenarios-${phase}.md`)) {
    for (const h of pick(past)) if (!seen.has(h.no)) seen.set(h.no, h);
  }
  const hit = [...seen.values()].sort((a, b) => Number(a.no) - Number(b.no));
  if (hit.length === 0) return [];

  const solvedPath = path.join(root, `docs/ops/solved-${phase}.md`);
  if (!fs.existsSync(solvedPath)) {
    return [`「該当した」が ${hit.length}件あるのに docs/ops/solved-${phase}.md が無い。\n`
      + `  該当した番号: ${hit.map((h) => h.no).join(', ')}\n`
      + `  1件につき3つの出力（直す前=赤 / 直した後=緑 / 戻した=また赤）を貼ること（D-18）。`];
  }

  const solved = fs.readFileSync(solvedPath, 'utf8');
  const problems = [];

  for (const { no, title } of hit) {
    /* 次の `### ` まで、無ければ文字列の終わりまでを本文とする。
       終わりを `$` で書くと、`m` フラグの下では**各行末**に当たる。
       非貪欲と組み合わさって本文が1行目で切れ、`種別:` も3出力も読めないまま
       「種別が無い」と報告していた（F1 の作業中に発見・`docs/failures.md` F-20260825-31）。 */
    const re = new RegExp(`^###\\s*${no}[.\\s]([\\s\\S]*?)(?=\\n###\\s|(?![\\s\\S]))`, 'm');
    const m = solved.match(re);
    if (!m) { problems.push(`#${no}「${title}」が solved-${phase}.md に無い。`); continue; }
    const body = m[1];

    const kind = (body.match(/^種別:\s*(\S+)/m) || [])[1];
    if (!KINDS.includes(kind)) {
      problems.push(`#${no}: 「種別:」が無いか不正（${KINDS.join(' / ')} のどれか）。`);
      continue;
    }

    if (kind !== '解決') {
      if (!/deferred[^\n]*#\s*\d+|docs\/deferred\.md[^\n]*\d+/.test(body)) {
        problems.push(`#${no}: 種別が「${kind}」なのに docs/deferred.md の番号が無い。`
          + `\n  逃がすなら記録に残す（D-18 偽-3・偽-8）。`);
      }
      continue;
    }

    const missing = HEADS.filter((h) => sectionOf(body, h) === null);
    if (missing.length > 0) {
      problems.push(`#${no}: 「解決」なのに ${missing.map((h) => `「${h}」`).join('と')} が無い。`
        + `\n  戻して赤くなるところを見ていない主張は、解決ではない（D-18 偽-10）。`);
      continue;
    }

    const outs = HEADS.map((h) => fences(sectionOf(body, h)).join('\n'));
    const empty = HEADS.filter((_, i) => outs[i].trim() === '');
    if (empty.length > 0) {
      problems.push(`#${no}: ${empty.map((h) => `「${h}」`).join('と')} に出力が貼られていない。`
        + `\n  文章での申告は証拠ではない（D-18 の解決の定義 5）。`);
      continue;
    }

    const before = new Set(meaningful(outs[0]));
    const again = meaningful(outs[2]);
    if (!again.some((l) => before.has(l))) {
      problems.push(`#${no}: 「直す前（赤）」と「直しを戻した（また赤）」に同じ症状の行が無い。`
        + `\n  別のものを直している可能性がある（D-18 の解決の定義 3）。`);
    }
  }
  return problems;
}

/* ── 直接叩かれたとき ── */
/* Windows では `process.argv[1]` が `C:\...` 形式なので、`file://` を前置しても
   `import.meta.url`（`file:///C:/...`）と一致しない＝直接実行しても何も起きない。
   `pathToFileURL()` は Node 標準で、どの OS でも同じ形にそろえる。 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const phase = process.argv[2] || readPhase(root);
  if (!phase) process.exit(0);
  const problems = checkSolved(root, phase);
  if (problems.length === 0) {
    process.stdout.write(`[solved] ${phase}: 「解決」の主張はすべて3つの出力で裏づけられている\n`);
    process.exit(0);
  }
  process.stderr.write(`【解決の裏づけ】${phase}: ${problems.length}件\n\n`
    + problems.map((p) => `- ${p}`).join('\n') + '\n');
  process.exit(1);
}

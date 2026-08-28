/**
 * empty-pass.mjs — 「無いこと」を、**空で受けて合格**にしていないか
 *
 * `docs/watch.md` W-1 の型（検査が実際の仕組みと違う所を見る）のうち、
 * **機械で判る1形だけ**を止める。W-1 は 2026-08-28 の数え直しで **16回**になり、
 * 「機械で塞げていない」が唯一の未達だった（`AGENTS.md` ルール昇格原則の4条件目）。
 *
 * ── 止める形 ──
 * 「消えた」「入っていない」を見る合格条件は、**空だと必ず真になる**:
 *
 *     check('ペットが実際に消えた', !(left.pets || []).some((p) => p.id === id));
 *                                     ~~~~~~~~~~~~~~~~~~
 *   `left.pets` が `undefined`（API が落ちた・鍵が切れた・形が変わった）でも
 *   `|| []` が空配列にし、`.some()` は false、`!false` で **PASS** になる。
 *   **何も消えていなくても、そもそも見に行けていなくても、緑。**
 *
 * ── 通す形 ──
 * 同じ条件の中に「**見に行けたこと**」を置けばよい。この2つは実際に在る:
 *
 *     check('…', Array.isArray(objects) && objects.length === 0, …);
 *     check('…', staffSees.denied === true && staffSees.menus === 0, …);
 *           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   ← 錨。空なら落ちる
 *
 * 逃げ道（台帳・免除リスト）は**置かない**。錨を1つ足せば通るので、
 * 免除する理由が無い（`D-18` 偽-3「無条件の免罪符を作らない」）。
 *
 * ── この機械が見ないもの（`key-parity.mjs` と同じく、役割を書いておく）──
 *   ・恒真一般（左辺と右辺が同じ場所から来る形・`F-20260825-40`）
 *   ・待ちの述語が開始時から真（`F-20260826-41`）
 *   ・右辺を配る側でなく静的側から作る（`F-20260827-43`）
 *   これらは**人が読むしかない**。緑でも「この検査は落ちる形か」を毎回読む。
 *
 *   node scripts/guard/empty-pass.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 文字列・テンプレートリテラルを飛ばしながら i を進める。 */
function skipString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') i += 1;
    i += 1;
  }
  return i + 1;
}

/** `check(` の呼び出しから、**第2引数（合格条件）だけ**を取り出す。
    第3引数（画面に出す説明文）は判定に使わない——説明文の中の `|| []` は
    合否に効かないので、混ぜると嘘の指摘が出る。 */
export function passConditions(src) {
  const out = [];
  const re = /\bcheck\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    /* **`function check(name, pass, detail)` の宣言そのものを数えない。**
       ここを見落として14件（検査1本につき1件）を「合格条件」として数えていた。
       台帳に `:: name` という在りもしない検査名が並んで気づいた——
       **数える機械が、数える対象を取り違えていた**（`docs/watch.md` W-1 の型を、
       W-1 を止める機械の中で踏んだ）。 */
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(function|const|let|var)\s+$/.test(before)) continue;
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      i += 1;
    }
    const args = src.slice(start, i - 1);

    /* トップレベルのカンマで区切る（入れ子とリテラルの中のカンマは数えない）。 */
    const parts = [];
    let d = 0;
    let last = 0;
    for (let j = 0; j < args.length; j += 1) {
      const c = args[j];
      if (c === "'" || c === '"' || c === '`') { j = skipString(args, j) - 1; continue; }
      if (c === '(' || c === '[' || c === '{') d += 1;
      else if (c === ')' || c === ']' || c === '}') d -= 1;
      else if (c === ',' && d === 0) { parts.push(args.slice(last, j)); last = j + 1; }
    }
    parts.push(args.slice(last));
    if (parts.length < 2) continue;

    /* 名前は、素の文字列なら中身を、そうでなければ**書いてある式をそのまま**使う。
       `\`${kind === …}\`` のような式を引用符で切ると、途中で千切れた名前になり、
       台帳の突き合わせが静かにずれる（消えた検査を「在る」と読む）。 */
    const raw = parts[0].trim();
    const literal = raw.match(/^'([^'\\]*)'$|^"([^"\\]*)"$|^`([^`$\\]*)`$/);
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      name: (literal ? (literal[1] ?? literal[2] ?? literal[3]) : raw).replace(/\s+/g, ' ').trim(),
      cond: parts[1].trim(),
    });
  }
  return out;
}

/** 空フォールバック（`|| []` / `|| {}`）を挟んでいるか。 */
const hasEmptyFallback = (cond) => /\|\|\s*(\[\s*\]|\{\s*\})/.test(cond);

/** 「無いこと」を見ている条件か。 */
const isNegative = (cond) => /(^|[^!=<>])!\s*[({[A-Za-z_$]/.test(cond)
  || /\.length\s*===\s*0/.test(cond)
  || /===\s*0(\b|$)/.test(cond)
  || /!==/.test(cond);

/** 「見に行けたこと」の錨が、同じ条件の中に在るか。 */
const hasAnchor = (cond) => /Array\.isArray\s*\(/.test(cond)
  || /===\s*true\b/.test(cond)
  || /!!/.test(cond)
  || /\.length\s*>\s*0/.test(cond)
  || /\.length\s*>=\s*1/.test(cond)
  || /!==\s*(undefined|null)\b/.test(cond)
  || /\bBoolean\s*\(/.test(cond);

export function findEmptyPasses(root) {
  const dir = path.join(root, 'scripts');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^verify-.*\.mjs$/.test(f)).sort()
    : [];
  const bad = [];
  let scanned = 0;
  for (const f of files) {
    const rel = `scripts/${f}`;
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const { line, name, cond } of passConditions(src)) {
      scanned += 1;
      if (hasEmptyFallback(cond) && isNegative(cond) && !hasAnchor(cond)) {
        bad.push({ rel, line, name, cond: cond.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }
  }
  return { files, scanned, bad };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, scanned, bad } = findEmptyPasses(ROOT);
  if (bad.length === 0) {
    process.stdout.write(
      `[empty-pass] 検査 ${files.length}本・合格条件 ${scanned}件。`
      + `「無いこと」を空で受けて合格にしている条件は 0 件\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `[empty-pass] **空でも合格になる条件が ${bad.length}件**（検査 ${files.length}本・合格条件 ${scanned}件を見た）\n\n`
    + bad.map((b) => `  ${b.rel}:${b.line}  ${b.name}\n    ${b.cond}\n`).join('\n')
    + `\n  「無いこと」を見る条件は、空だと必ず真になります。\n`
    + `  同じ条件の中に「**見に行けたこと**」を置いてください:\n`
    + `    Array.isArray(x) && x.length === 0\n`
    + `    res.ok === true && !x.some(…)\n`
    + '  （docs/watch.md W-1 / F-20260825-40 / F-20260826-41）\n',
  );
  process.exit(1);
}

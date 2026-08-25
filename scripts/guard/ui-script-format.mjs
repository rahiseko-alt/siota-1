/**
 * ui-script-format.mjs — 画面側と裏側の「繋ぎ方」を1つに固定する
 *
 * **なぜこの検査が要るか**（`docs/ops/bad-scenarios-F3.md` #10）
 *   `src/index.html` は古典スクリプト（`type="module"` なし）で `js/ui.js` を読み、
 *   `backend/js/*.js` は全ファイルが `export` の ES モジュール。規格が違うので、
 *   そのままでは繋がらない。
 *
 *   繋ぐときに**やってはいけないのが「`ui.js` を `type="module"` にする」**。
 *   モジュールのトップレベル宣言はモジュール内に閉じるため、`const App` が
 *   グローバルから消え、`src/index.html` の **インライン `onclick="App.…"` が全部壊れる**。
 *   実ブラウザで測った結果（`docs/ops/solved-F3.md` #10）:
 *     古典スクリプト   → 動く
 *     type="module"   → `ReferenceError: App is not defined`
 *     グローバル経由   → 動く
 *
 *   壊れ方が**画面を開くまで分からない**（構文エラーにならない）ので、機械で止める。
 *
 * **正しい繋ぎ方**: `backend/js/*.js` は既に `globalThis.TrimmerSupabaseStorage` /
 *   `TrimmerStaffApi` / `TrimmerSupabaseStaff` / `window.SaltyDogMagazine` を publish する。
 *   モジュールとして読み込めば自分でグローバルに登録するので、
 *   **`ui.js` は古典スクリプトのまま、そのグローバルを使う**。
 *   モジュールは defer なので `DOMContentLoaded` より先に走る（実測済み）。
 *
 * 何を保証しないか: 繋いだ結果が正しく動くこと（D-18 偽-5）。ここは**規格だけ**を見る。
 *
 *   node scripts/guard/ui-script-format.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ENTRY = 'src/index.html';
const UI = 'src/js/ui.js';

/** `<script ...>` の開きタグを全部拾う。 */
const scriptTags = (html) => [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);

export function checkUiScriptFormat(root) {
  const problems = [];
  const htmlPath = path.join(root, ENTRY);
  if (!fs.existsSync(htmlPath)) return { handlers: 0, problems: [`${ENTRY} が無い`] };

  const html = fs.readFileSync(htmlPath, 'utf8');
  /* インラインの `onclick="App.…"` の数。これがグローバル `App` に依存している。 */
  const handlers = (html.match(/on\w+\s*=\s*["']\s*App\./g) || []).length;

  const tags = scriptTags(html);
  for (const tag of tags) {
    const src = (tag.match(/src\s*=\s*["']([^"']+)["']/) || [])[1];
    if (!src) continue;
    const isModule = /type\s*=\s*["']module["']/i.test(tag);

    /* ① UI 本体をモジュールにしない（グローバル App が消え、onclick が全部壊れる）。 */
    if (/\/js\/ui\.js$/.test(src) && isModule && handlers > 0) {
      problems.push(
        `${ENTRY} が ${src} を type="module" で読んでいます。\n`
        + `      インラインの onclick="App.…" が ${handlers} 件あり、モジュールにすると\n`
        + `      const App がグローバルから消えて **全部が ReferenceError になります**。`,
      );
    }
    /* ② backend/ をモジュール以外で読まない（export 構文が構文エラーになる）。 */
    if (/backend\//.test(src) && !isModule) {
      problems.push(
        `${ENTRY} が ${src} を古典スクリプトで読んでいます。\n`
        + `      backend/js/*.js は ES モジュール（export）なので、type="module" が要ります。`,
      );
    }
  }

  /* ③ ui.js 自身にトップレベルの import/export を書かない（モジュール化を強いる）。 */
  const uiPath = path.join(root, UI);
  if (fs.existsSync(uiPath)) {
    const ui = fs.readFileSync(uiPath, 'utf8');
    const offenders = ui.split('\n')
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => /^(import\s|export\s|export\{|import\{)/.test(line));
    for (const { line, no } of offenders) {
      problems.push(
        `${UI}:${no} にトップレベルの import/export があります。\n`
        + `      ${line.slice(0, 70)}\n`
        + `      これを書くと ui.js はモジュールでしか読めなくなり、①と同じ壊れ方をします。\n`
        + `      backend の機能は globalThis に publish されたものを使ってください。`,
      );
    }
  }
  return { handlers, problems };
}

/* ── 直接叩かれたとき ── */
/* `process.argv[1]` は `node -e` などでは undefined で、`pathToFileURL` が投げる。
   直接実行かどうかを見るだけの分岐で落ちると、**このファイルを import した側**が
   道連れになる（F-20260825-33 の型）。存在を先に確かめる。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const { handlers, problems } = checkUiScriptFormat(root);

  /* 依存している件数を必ず出す。減らして 0 件にする逃げ道を塞ぐため（D-18 偽-2）。 */
  process.stdout.write(`[ui-script-format] グローバル App に依存する onclick: ${handlers} 件\n`);

  if (problems.length === 0) {
    process.stdout.write('✅ 繋ぎ方 OK（UI は古典スクリプト / backend はモジュール）\n');
    process.exit(0);
  }
  process.stderr.write(
    `\n❌ 画面側と裏側の繋ぎ方が壊れています（${problems.length} 件）\n\n`
    + problems.map((p) => `    ${p}`).join('\n\n')
    + `\n\n  正しい繋ぎ方: backend/js/*.js は自分で globalThis に登録します。\n`
    + `  モジュールとして読み込み、**ui.js は古典スクリプトのまま**そのグローバルを使ってください。\n`,
  );
  process.exit(1);
}

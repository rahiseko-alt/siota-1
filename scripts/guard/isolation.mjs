/**
 * isolation.mjs — F1 の完了条件 A・B を機械で確かめる
 *
 * **A**: `src/` に UI 以外が無い（＝ `src/index.html` から到達できないファイルが無い）
 * **B**: UI から backend への参照が 0 ——**F1 / F2 でだけ見る**
 *
 * **B はフェーズで切り替わる（D-20260825-42）。** F1 の「隔離」と F3 の「結線」は
 * 目的が正面から矛盾する——F3 の仕事はまさに UI と backend をつなぐことなので、
 * B を掛けたままだと結線の1行目で赤くなる。だから F3 では B を外す。
 * **ただし黙って外さない。** 外した回は「何を見ていないか」を必ず出力する。
 * 緑を見た人が「隔離も見た」と誤読しないため（D-18 偽-2「対象を減らして0件にする」）。
 * A は F3 でも残す。置いたきり誰からも呼ばれないファイルを増やさない検査で、結線と矛盾しない。
 *
 * 何を保証するか: 画面の側が、バックエンドにも外の世界にも繋がっていないこと。
 *   そして `src/` に、どこからも呼ばれないまま置かれているファイルが無いこと。
 * **何を保証しないか**: 画面が正しく動くこと・意匠が合っていること・
 *   到達できるファイルの中身が正しいこと。ここは**繋がりと在庫だけ**を見る（D-18 偽-5）。
 *
 * 走査対象は `src/` を実際に読んで決める（固定リストにしない）。
 * 走査した件数を必ず出力する——対象を減らして 0 件にする逃げ道を塞ぐため（D-18 偽-2）。
 *
 * 未到達ファイルを逃がせるのは、`docs/deferred.md` に**番号付きで登録されているもの**だけ。
 * 無条件の例外リストは作らない（D-18 偽-3）。
 *
 *   node scripts/guard/isolation.mjs          src/ を見る
 *   node scripts/guard/isolation.mjs dist     配られるものを見る
 */

import fs from 'node:fs';
import path from 'node:path';
import { readPhase } from './scope.mjs';

/* 中身を読んで参照を辿る対象。これ以外（画像・フォント）は葉として扱う。 */
const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg']);

/* B を掛けるフェーズ。ここに無いフェーズでは B を見ない（D-20260825-42）。
   `docs/ops/phase` が読めないときは**掛ける側**に倒す——検査は緩いほうへ倒さない。 */
const B_PHASES = new Set(['F1', 'F2']);

/* B: UI に在ってはならないもの。名前は人間に見せる文言。 */
const FORBIDDEN = [
  { name: 'backend/ への参照', re: /backend\// },
  { name: 'Supabase の SDK', re: /@supabase|createClient\s*\(|supabase-js/ },
  { name: 'API の呼び出し先', re: /['"`]\/api\// },
  { name: '外部への URL', re: /https?:\/\/(?!local\.invalid|www\.w3\.org)/ },
  { name: '通信そのもの', re: /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket/ },
];

const listFiles = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory()
    ? listFiles(path.join(dir, e.name), base)
    : [path.relative(base, path.join(dir, e.name))]));

/** そのファイルが指している先を、ルート相対のパスで返す。 */
function referencesOf(root, rel) {
  const ext = path.extname(rel);
  if (!TEXT.has(ext)) return [];
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const raw = [
    ...[...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
  const out = [];
  for (const r of raw) {
    if (/^(https?:|data:|mailto:|tel:|#|\/\/)/.test(r)) continue;
    const clean = r.split(/[?#]/)[0];
    if (!clean) continue;
    /* 先頭 `/` は配信ルート（＝ここでは root）。それ以外は自分からの相対。 */
    const resolved = clean.startsWith('/')
      ? clean.slice(1)
      : path.join(path.dirname(rel), clean);
    out.push(path.normalize(resolved));
  }
  return out;
}

/** entry から辿り着ける全ファイル。 */
function reachableFrom(root, entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    if (!fs.existsSync(path.join(root, cur))) continue;
    seen.add(cur);
    for (const next of referencesOf(root, cur)) queue.push(next);
  }
  return seen;
}

/** docs/deferred.md に番号付きで登録されている名前（あと回しの記録・ルール⑤）。 */
function deferredNames(repoRoot) {
  const p = path.join(repoRoot, 'docs/deferred.md');
  if (!fs.existsSync(p)) return new Map();
  const found = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const no = line.match(/^\|\s*(\d+)\s*\|/);
    if (!no) continue;
    /* 拡張子は**長いものから**並べる。`js` を `json` より先に置くと
       `manifest.json` が `manifest.js` として拾われ、逃がすべきものが逃げない。
       ファイル名側に `.` を許すのは `konva.min.js` のような名前のため。 */
    for (const name of line.match(/[\w.-]+\.(?:woff2?|json|jpe?g|html|webp|mjs|png|svg|css|js)/g) || []) {
      found.set(name, no[1]);
    }
  }
  return found;
}

const repoRoot = process.env.REPO_ROOT || process.cwd();
const uiDir = process.argv[2] || 'src';
const root = path.join(repoRoot, uiDir);
const entry = 'index.html';

if (!fs.existsSync(path.join(root, entry))) {
  process.stderr.write(`❌ ${uiDir}/${entry} が無い。走査の起点が無いので判定できない。\n`);
  process.exit(1);
}

const all = listFiles(root).map((f) => path.normalize(f)).sort();
const reachable = reachableFrom(root, entry);
const deferred = deferredNames(repoRoot);

/* ── A: 到達できないファイル ── */
const unreachable = all.filter((f) => !reachable.has(f));
const unregistered = unreachable.filter((f) => !deferred.has(path.basename(f)));

/* ── B: 到達できるファイルの中の、あってはならない参照 ── */
const phase = readPhase(repoRoot);
const checkB = phase === null || B_PHASES.has(phase);
const scanned = [...reachable].filter((f) => TEXT.has(path.extname(f))).sort();
const violations = [];
for (const f of checkB ? scanned : []) {
  const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of FORBIDDEN) {
      if (re.test(line)) violations.push({ file: f, line: i + 1, name, text: line.trim().slice(0, 100) });
    }
  });
}

process.stdout.write(
  `[isolation] ${uiDir}/ を走査: 全 ${all.length} ファイル / ${entry} から到達 ${reachable.size} / `
  + `中身を読んだ ${checkB ? scanned.length : 0}\n`,
);

/* 外した回は、外したと声に出す。黙って消さない（A-4 / D-18 偽-2）。 */
if (!checkB) {
  process.stdout.write(
    `⚠️  【条件B は見ていません】フェーズ ${phase} では UI→backend の隔離を検査しません（D-20260825-42）。\n`
    + `    F3 の仕事は UI と backend をつなぐことなので、B を掛けたままだと結線できません。\n`
    + `    **この実行が緑でも「隔離できている」ことの証明にはなりません。** 見たのは条件A だけです。\n`
    + `    B を戻すには docs/ops/phase を F1 / F2 に戻します（書き換えは要りません）。\n`,
  );
}

const problems = [];
if (unregistered.length > 0) {
  problems.push(
    `【条件A】${uiDir}/${entry} からどこにも繋がっていないファイルが ${unregistered.length} 件あります。\n`
    + unregistered.map((f) => `    ${uiDir}/${f}`).join('\n')
    + `\n  UI として使われていないなら、${uiDir}/ に置いたままにしない。\n`
    + `  いま消せない事情があるなら docs/deferred.md に**番号付きで**1行残す（ルール⑤）。\n`
    + `  ファイル名をその行に書くこと——書いていないものは、ここで逃がしません（D-18 偽-3）。`,
  );
}
if (violations.length > 0) {
  problems.push(
    `【条件B】UI からバックエンド・外部への繋がりが ${violations.length} 件あります。\n`
    + violations.map((v) => `    ${uiDir}/${v.file}:${v.line}  ${v.name}\n      ${v.text}`).join('\n')
    + `\n  F1 は「UI とバックエンドの隔離」です。UI は ${uiDir}/js/dummy.js の仮データだけで動くこと。`,
  );
}

if (problems.length === 0) {
  const escaped = unreachable.length - unregistered.length;
  process.stdout.write(
    `✅ ${checkB ? '隔離 OK' : '条件A のみ OK'}（条件A: 未到達 0 件`
    + `${escaped > 0 ? `・あと回し登録済み ${escaped} 件は除く` : ''}`
    + ` / 条件B: ${checkB ? '繋がり 0 件' : '**見ていない**'}）\n`,
  );
  process.exit(0);
}
process.stderr.write(`\n❌ 隔離できていません（${problems.length} 件）\n\n${problems.join('\n\n')}\n`);
process.exit(1);

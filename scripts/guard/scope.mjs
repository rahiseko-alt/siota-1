/**
 * scope.mjs — ①逸脱監視（常時）
 *
 * 見るのは1つだけ: **その変更が、いまのフェーズの範囲内か。**
 * 良し悪しは見ない——場所だけを見る。範囲外なら止めて理由を返す。
 *
 * いまのフェーズは `docs/ops/phase`（F1 / F2 / F3 の1行）。
 * フェーズごとに触ってよい場所は下の SCOPE が正。`docs/ops/plan.md` と揃える。
 *
 * 特定の AI の設定に依存しない。どの AI でも、これを直接叩ける:
 *   node scripts/guard/scope.mjs src/index.html supabase/x.sql
 *   node scripts/guard/scope.mjs --cmd "npm install left-pad"
 * まとめて掛けるなら `npm run guard`（変更した全ファイルを見る）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* フェーズに関係なく触ってよい場所（生成物・作業場・この仕組みそのもの）。 */
export const ALWAYS = [
  'dist/', '.human/', '.screens/', 'node_modules/', '.git/',
  'docs/', 'scripts/guard/', '.agents/',
  'AGENTS.md', 'CLAUDE.md', 'README.md',   /* ルールと記録は、いつでも書ける */
];

/* フェーズごとに触ってよい場所。ここに無い場所は、すべて範囲外。 */
export const SCOPE = {
  F1: {
    label: 'UI とバックエンドの隔離',
    allow: [
      'src/', 'backend/', 'test/', 'scripts/', 'package.json', 'package-lock.json',
      '.gitignore', 'src-dist-guard.config.json', '.claude/',
    ],
  },
  F2: {
    label: '正UI のみで動線を完了させる',
    allow: ['src/', 'scripts/walk-human.mjs', 'scripts/serve-ui.mjs', 'scripts/build-dist.mjs'],
  },
  F3: {
    label: '正UI とバックエンドをつなぐ',
    allow: [
      'src/', 'backend/', 'scripts/', 'test/', 'supabase/', 'worker/',
      'package.json', 'package-lock.json',
    ],
  },
};

/* ルール①「現状あるものだけで完成させる」——新しい依存を足させない。 */
const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(install|i|add|create)\b/;

export function readPhase(root) {
  const p = path.join(root, 'docs/ops/phase');
  if (!fs.existsSync(p)) return null;
  const v = fs.readFileSync(p, 'utf8').trim().split(/\s+/)[0];
  return SCOPE[v] ? v : null;
}

/** root からの相対パスにする。root の外なら null（外は見張らない）。 */
export function rel(root, p) {
  if (!p) return null;
  const r = path.relative(root, path.resolve(root, String(p).replace(/^['"]|['"]$/g, '')));
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  return r;
}

const under = (r, list) =>
  list.some((a) => (a.endsWith('/') ? r === a.slice(0, -1) || r.startsWith(a) : r === a));

/** 範囲内なら null、範囲外なら理由の文字列。 */
export function checkPath(root, phase, target) {
  const r = rel(root, target);
  if (!r) return null;
  const { label, allow } = SCOPE[phase];
  if (under(r, [...ALWAYS, ...allow])) return null;
  return `【逸脱監視】\`${r}\` は ${phase}（${label}）の範囲外です。\n`
    + `  ${phase} で触ってよい場所: ${allow.join(' / ')}\n`
    + `  直さないと次の画面へ行けないなら、マスターの判断を仰いでください。\n`
    + `  そうでないなら docs/deferred.md に1行残して先へ進んでください（ルール④）。`;
}

/** 命令が範囲内なら null、範囲外なら理由の文字列。 */
export function checkCommand(root, phase, cmd) {
  const { label } = SCOPE[phase];
  if (INSTALL.test(cmd)) {
    return `【逸脱監視】新しい依存を足そうとしています。\n`
      + `  いまは ${phase}（${label}）。ルール①「現状あるものだけでフェーズを完成させる」に反します。\n`
      + `  どうしても要るなら範囲外なので、docs/deferred.md に1行残して先へ進んでください。`;
  }
  const MUTATE = /(^|[;&|]\s*)(rm|mv|cp|truncate|tee|touch|mkdir|chmod|chown|ln|dd|sed\s+-i|git\s+(rm|mv|checkout|restore|clean|reset))\b|>>?\s*\S/;
  if (!MUTATE.test(cmd)) return null;
  for (const w of cmd.match(/[\w./-]+\.[\w]+|[\w.-]+\/[\w./-]*/g) || []) {
    const why = checkPath(root, phase, w);
    if (why) return why;
  }
  return null;
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
  const i = argv.indexOf('--cmd');
  const reasons = (i >= 0
    ? [checkCommand(root, phase, argv[i + 1] || '')]
    : argv.map((a) => checkPath(root, phase, a))
  ).filter(Boolean);
  if (reasons.length === 0) process.exit(0);
  process.stderr.write(`${reasons.join('\n')}\n`);
  process.exit(1);
}

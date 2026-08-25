#!/usr/bin/env node
/**
 * plan-guard.mjs — ①逸脱監視（発火: 常時 / PreToolUse）
 *
 * 見るのは1つだけ: **いまの行動が、現在のフェーズの範囲内か。**
 * 範囲外なら止めて、理由を返す。良し悪しは判定しない——場所だけを見る。
 *
 * 現在のフェーズは `docs/ops/phase`（F1 / F2 / F3 の1行）。
 * フェーズごとに触ってよい場所は下の SCOPE が正。`docs/ops/plan.md` と揃える。
 *
 * 止め方: 終了コード 2 ＋ 標準エラーに理由（Claude Code がそれを読んで止まる）。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

/* フェーズに関係なく触ってよい場所（生成物・作業場・監視の仕組みそのもの）。 */
const ALWAYS = [
  'dist/', '.human/', '.screens/', 'node_modules/', '.git/',
  'docs/', '.claude/', 'scripts/hooks/', '.agents/',
];

/* フェーズごとに触ってよい場所。ここに無い場所は、すべて範囲外。 */
const SCOPE = {
  F1: {
    label: 'UI とバックエンドの隔離',
    allow: [
      'src/', 'backend/', 'test/', 'scripts/', 'package.json', 'package-lock.json',
      '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'src-dist-guard.config.json',
    ],
  },
  F2: {
    label: '正UI のみで動線を完了させる',
    allow: [
      'src/',
      'scripts/walk-human.mjs', 'scripts/serve-ui.mjs', 'scripts/build-dist.mjs',
    ],
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
const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(install|i|add|create)\b|\bnpx\s+(?!--no)/;

/* 中身を書き換える命令。これが無ければ、ただ読んでいるだけなので通す。 */
const MUTATE = /(^|[;&|]\s*)(rm|mv|cp|install|truncate|tee|touch|mkdir|chmod|chown|ln|dd|sed\s+-i|git\s+(rm|mv|checkout|restore|clean|reset))\b|>>?\s*\S/;

function readPhase() {
  const p = path.join(ROOT, 'docs/ops/phase');
  if (!fs.existsSync(p)) return null;
  const v = fs.readFileSync(p, 'utf8').trim().split(/\s+/)[0];
  return SCOPE[v] ? v : null;
}

/** ROOT からの相対パスにする。ROOT の外なら null（外は見張らない）。 */
function rel(p) {
  if (!p) return null;
  const abs = path.resolve(ROOT, p);
  const r = path.relative(ROOT, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return r;
}

const under = (r, list) => list.some((a) => (a.endsWith('/') ? r === a.slice(0, -1) || r.startsWith(a) : r === a));

function deny(reason) {
  process.stderr.write(reason);
  process.exit(2);
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
let ev;
try { ev = JSON.parse(input || '{}'); } catch { process.exit(0); }

const phase = readPhase();
if (!phase) process.exit(0);            /* フェーズが無い＝この仕組みの外。止めない。 */
const { label, allow } = SCOPE[phase];
const scope = [...ALWAYS, ...allow];

const tool = ev.tool_name || '';
const ti = ev.tool_input || {};

if (tool === 'Bash') {
  const cmd = String(ti.command || '');
  if (INSTALL.test(cmd)) {
    deny(`【逸脱監視】止めました。\n`
       + `いまは ${phase}（${label}）。ルール①「現状あるものだけでフェーズを完成させる」に反します。\n`
       + `新しい依存を入れずに、いま在るもので進めてください。\n`
       + `どうしても要るなら、それは範囲外なので docs/deferred.md に1行残して先へ進んでください。\n`);
  }
  if (MUTATE.test(cmd)) {
    /* 命令の中に出てくる「それらしい場所」を拾って、範囲外を触っていないか見る。 */
    const words = cmd.match(/[\w./-]+\.[\w]+|[\w.-]+\/[\w./-]*/g) || [];
    for (const w of words) {
      const r = rel(w.replace(/^['"]|['"]$/g, ''));
      if (!r || r === '') continue;
      if (!under(r, scope)) {
        deny(`【逸脱監視】止めました。\n`
           + `いまは ${phase}（${label}）。この段では \`${r}\` を書き換えません。\n`
           + `${phase} で触ってよい場所: ${allow.join(' / ')}\n`
           + `直さないと次の画面へ行けないなら、そう言ってマスターの判断を仰いでください。\n`
           + `そうでないなら docs/deferred.md に1行残して先へ進んでください（ルール④）。\n`);
      }
    }
  }
  process.exit(0);
}

const target = rel(ti.file_path || ti.notebook_path);
if (!target) process.exit(0);
if (under(target, scope)) process.exit(0);

deny(`【逸脱監視】止めました。\n`
   + `いまは ${phase}（${label}）。この段では \`${target}\` を書き換えません。\n`
   + `${phase} で触ってよい場所: ${allow.join(' / ')}\n`
   + `直さないと次の画面へ行けないなら、そう言ってマスターの判断を仰いでください。\n`
   + `そうでないなら docs/deferred.md に1行残して先へ進んでください（ルール④）。\n`);

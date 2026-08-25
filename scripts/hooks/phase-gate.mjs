#!/usr/bin/env node
/**
 * phase-gate.mjs — ②③のサブを「呼び忘れ」させないための関所（PreToolUse）
 *
 * マスター指定の発火タイミング:
 *   ② bad-scenarios   … フェーズ開始直後
 *   ③ failure-matcher … フェーズの開始直後 と 完了直後
 *
 * 呼んだかどうかは記憶に頼らない。**成果物が在るか**だけを見る。
 *   docs/ops/failure-check-F{n}-start.md   ③（開始）
 *   docs/ops/bad-scenarios-F{n}.md         ②（10個の提案・マスターの承認印・実行結果）
 *
 * 揃うまで、そのフェーズの**作業場**を書き換えさせない。
 * 記録と仕組みの置き場（docs/ .claude/ scripts/hooks/）は、いつでも書ける——
 * そこを止めたら、成果物そのものが作れなくなる。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const EXEMPT = ['docs/', '.claude/', 'scripts/hooks/', '.agents/', 'dist/', '.human/', '.screens/', 'node_modules/', '.git/'];

const phasePath = path.join(ROOT, 'docs/ops/phase');
if (!fs.existsSync(phasePath)) process.exit(0);
const phase = fs.readFileSync(phasePath, 'utf8').trim().split(/\s+/)[0];
if (!/^F[123]$/.test(phase)) process.exit(0);

let input = '';
for await (const chunk of process.stdin) input += chunk;
let ev;
try { ev = JSON.parse(input || '{}'); } catch { process.exit(0); }

/* 何を触ろうとしているか。Bash は「書き換える命令」だけ見る。 */
const tool = ev.tool_name || '';
const ti = ev.tool_input || {};
let targets = [];
if (tool === 'Bash') {
  const cmd = String(ti.command || '');
  if (!/(^|[;&|]\s*)(rm|mv|cp|tee|sed\s+-i|git\s+(rm|mv|checkout|restore|reset))\b|>>?\s*\S/.test(cmd)) process.exit(0);
  targets = (cmd.match(/[\w./-]+\.[\w]+|[\w.-]+\/[\w./-]*/g) || []);
} else if (ti.file_path || ti.notebook_path) {
  targets = [ti.file_path || ti.notebook_path];
} else {
  process.exit(0);
}

const rels = targets
  .map((t) => path.relative(ROOT, path.resolve(ROOT, String(t).replace(/^['"]|['"]$/g, ''))))
  .filter((r) => r && !r.startsWith('..'));
if (rels.length === 0) process.exit(0);
if (rels.every((r) => EXEMPT.some((e) => r === e.slice(0, -1) || r.startsWith(e)))) process.exit(0);

/* 成果物が揃っているか。 */
const start = path.join(ROOT, `docs/ops/failure-check-${phase}-start.md`);
const bad = path.join(ROOT, `docs/ops/bad-scenarios-${phase}.md`);
const missing = [];

if (!fs.existsSync(start)) {
  missing.push(`③ 再発防止（開始）が無い → docs/ops/failure-check-${phase}-start.md\n`
    + `   failure-matcher サブを呼び、docs/failures.md と docs/decisions.md を照合した結果を置いてください。`);
}
if (!fs.existsSync(bad)) {
  missing.push(`② バッドシナリオが無い → docs/ops/bad-scenarios-${phase}.md\n`
    + `   bad-scenarios サブを呼び、**本質的かつ単純な見落とし10個**を出してマスターに提案してください。`);
} else if (!/^承認:\s*済/m.test(fs.readFileSync(bad, 'utf8'))) {
  missing.push(`② バッドシナリオに**マスターの承認印が無い** → docs/ops/bad-scenarios-${phase}.md\n`
    + `   10個をマスターに提案し、承認を受けてから「承認: 済」を書き、10個を実行してください。`);
}

if (missing.length === 0) process.exit(0);

process.stderr.write(
  `【関所】${phase} の作業場はまだ開いていません。触ろうとした場所: ${rels.join(', ')}\n\n`
  + missing.map((m) => `- ${m}`).join('\n')
  + `\n\n記録と仕組み（docs/ .claude/ scripts/hooks/）は、いつでも書けます。\n`,
);
process.exit(2);

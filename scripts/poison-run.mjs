/**
 * poison-run.mjs — **毒見**。何も動いていない世界で `verify:*` を全部走らせる
 *
 * マスター指示（`D-20260828-53`）:
 *   「壊してみて赤にならないなら検査自体が壊れてるとするか」
 *
 * `docs/ops/proof-of-red.md` の182件を1件ずつ手で壊すのは現実的でない。
 * そこで**土台ごと壊す**——`scripts/lib/poison-stack.mjs` が
 * 「形だけ合っていて中身が空」の Supabase を立て、`SUPABASE_LOCAL_URL` をそこへ向ける。
 * 犬も飼い主もカルテも写真も1件も無く、書き込みは受け取ったふりだけをする世界。
 *
 * **この世界では、すべての検査が赤にならなければおかしい。**
 * 緑のまま残った検査は「**何も無くても通る検査**」＝ `docs/watch.md` W-1 の型そのもの。
 *
 * **Docker は要らない**（`supabase start` の代わりだから）。この環境で走る。
 *
 * ── この機械が判らないもの（役割を書いておく・`key-parity.mjs` と同じ作法）──
 *   「**正しく動いている世界で、別のものを見ている**」型（`F-20260827-43`）は出ない。
 *   毒見で出るのは「空の世界で緑になる」型まで。残りは1件ずつ壊すしかない。
 *
 * ── 走らせないもの ──
 *   `verify-production.mjs` … **本番に向かって出ていく**。毒見の対象ではない
 *   `verify-migrations.mjs` … 実 PostgreSQL に SQL を流す。土台を空にする意味が無い
 *
 *   node scripts/poison-run.mjs                      全部（毒は empty）
 *   node scripts/poison-run.mjs --flavor=noauth      ログインが通らない世界
 *   node scripts/poison-run.mjs verify-stack.mjs     1本だけ
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startPoisonStack, FLAVORS } from './lib/poison-stack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POISON_PORT = Number(process.env.POISON_PORT || 54399);
const PER_SCRIPT_MS = Number(process.env.POISON_TIMEOUT_MS || 180_000);

const SKIP = new Map([
  ['verify-production.mjs', '本番に向かって出ていくので、毒見の対象にしない'],
  ['verify-migrations.mjs', '実 PostgreSQL に SQL を流す検査。土台を空にする意味が無い'],
]);

/** 検査の出力から `PASS` / `FAIL` の行を拾う。 */
export function parseResults(out) {
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(PASS|FAIL)\s{2}(.*)$/);
    if (!m) continue;
    /* 名前のうしろに2スペース区切りで説明が付く。名前だけを採る。 */
    rows.push({ verdict: m[1], name: m[2].split('  ')[0].trim() });
  }
  return rows;
}

async function runOne(file, port) {
  return new Promise((resolve) => {
    const child = spawn('node', [`scripts/${file}`], {
      cwd: ROOT,
      env: {
        ...process.env,
        SUPABASE_LOCAL_URL: `http://127.0.0.1:${POISON_PORT}`,
        /* 検査ごとに port の環境変数名が違うので、**在りそうな名前を全部**渡す。
           当たらなくても既定値で動くが、当たれば衝突しない。 */
        STACK_PORT: String(port), PORTAL_PORT: String(port), EDIT_PORT: String(port),
        XSS_PORT: String(port), ROUNDTRIP_PORT: String(port), EMPTY_PORT: String(port),
        SCREENS_PORT: String(port), DELETE_PORT: String(port), DRAFT_PORT: String(port),
        INVITATION_PORT: String(port), M6_PORT: String(port), ADMIN_PORT: String(port),
        PHOTO_PORT: String(port),
      },
    });
    let out = '';
    const take = (d) => { out += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, PER_SCRIPT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ out, code }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ out: out + String(e), code: -1 }); });
  });
}

const argv = process.argv.slice(2);
const flavorArg = argv.find((a) => a.startsWith('--flavor='));
const FLAVOR = flavorArg ? flavorArg.split('=')[1] : 'empty';
if (!FLAVORS.includes(FLAVOR)) {
  process.stderr.write(`知らない毒: ${FLAVOR}（使えるのは ${FLAVORS.join(' / ')}）\n`);
  process.exit(1);
}
const wanted = argv.filter((a) => !a.startsWith('--'));
const files = fs.readdirSync(path.join(ROOT, 'scripts'))
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .filter((f) => (wanted.length ? wanted.includes(f) : true))
  .sort();

process.stdout.write(`【毒見】毒「${FLAVOR}」の世界で検査を走らせる\n`);
process.stdout.write(`  ${FLAVOR === 'noauth' ? 'ログインが通らない世界。認証を見る検査を判定する。' : 'データが空の世界。データを見る検査を判定する。'}\n`);
process.stdout.write('  この世界では、すべての検査が赤にならなければおかしい。\n');
process.stdout.write('  緑のまま残ったものが「何も無くても通る検査」。\n\n');

const poison = await startPoisonStack({ port: POISON_PORT, flavor: FLAVOR });
const survived = [];
const died = [];
let port = 8880;

for (const file of files) {
  if (SKIP.has(file)) {
    process.stdout.write(`  ⏭  ${file}  — ${SKIP.get(file)}\n`);
    continue;
  }
  port += 1;
  const { out, code } = await runOne(file, port);
  const rows = parseResults(out);
  const green = rows.filter((r) => r.verdict === 'PASS');
  const red = rows.filter((r) => r.verdict === 'FAIL');
  died.push(...red.map((r) => ({ file, name: r.name })));
  survived.push(...green.map((r) => ({ file, name: r.name })));
  const note = rows.length === 0 ? '  ⚠ 判定行が1つも出ていない（入口で死んだ）' : '';
  process.stdout.write(
    `  ${green.length === 0 && rows.length > 0 ? '✅' : '⚠️ '} ${file.padEnd(30)}`
    + ` 赤 ${String(red.length).padStart(3)} / 緑のまま ${String(green.length).padStart(3)}`
    + `  (EXIT ${code})${note}\n`,
  );
}
await poison.stop();

process.stdout.write(`\n  ── まとめ ──\n`);
process.stdout.write(`  赤になった（＝壊すと落ちることを確かめた）: ${died.length}件\n`);
process.stdout.write(`  **緑のまま残った（＝何も無くても通る）: ${survived.length}件**\n\n`);

if (survived.length > 0) {
  process.stdout.write('  緑のまま残った検査:\n');
  for (const s of survived) process.stdout.write(`    ${s.file} :: ${s.name}\n`);
  process.stdout.write('\n');
}

/* 台帳に貼れる形でも出す。

   **一部だけ走らせた回で、全体の記録を上書きしない。** 実際に1本だけ掛け直したとき
   全14本の結果を消してしまった——**記録が、走らせた範囲より広く見える**形だった
   （`docs/watch.md` W-8 の型）。範囲を指定した回は別名に書く。 */
const outPath = path.join(
  ROOT,
  wanted.length
    ? 'docs/ops/poison-run-partial.md'
    : `docs/ops/poison-run-result${FLAVOR === 'empty' ? '' : `-${FLAVOR}`}.md`,
);
fs.writeFileSync(outPath, [
  `# 毒見の結果（何も動いていない世界で \`verify:*\` を走らせた）`,
  wanted.length ? `\n**一部だけ（${wanted.join(' ')}）。全体の記録ではない。**` : '',
  '',
  `実行: \`node scripts/poison-run.mjs --flavor=${FLAVOR}\`（Docker 不要）`,
  '',
  `- 赤になった（壊すと落ちることを確かめた）: **${died.length}件**`,
  `- **緑のまま残った（何も無くても通る）: ${survived.length}件**`,
  '',
  '## 赤になった（`- <ファイル> :: <検査の名前>`）',
  '',
  ...died.map((d) => `- ${d.file} :: ${d.name}`),
  '',
  '## 緑のまま残った（**壊れている**）',
  '',
  ...survived.map((s) => `- ${s.file} :: ${s.name}`),
  '',
].join('\n'));
process.stdout.write(`  結果を書いた: docs/ops/poison-run-result.md\n`);

process.exit(survived.length > 0 ? 1 : 0);

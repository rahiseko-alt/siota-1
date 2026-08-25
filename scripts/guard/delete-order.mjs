/**
 * delete-order.mjs — 写真は「Storage を片付けてから DB を消す」を機械で守らせる
 *
 * **なぜこの検査が要るか**（`D-20260824-34`・`docs/ops/bad-scenarios-F3.md` #2）
 *   Storage のポリシー `private.storage_path_staff` は「その `reports` 行が存在すること」を
 *   条件にしている。ところが犬・飼い主の削除は FK カスケード（pets → reports →
 *   report_assets）でその行を先に消すため、**犬を先に消すと、写真は Storage に残るのに
 *   その瞬間から誰も列挙も削除もできなくなる**。スタッフからも飼い主からも SELECT が
 *   false になるので、見ることすらできない。回収は service_role でしか出来ず、
 *   どのオブジェクトが孤児かを示す `report_assets.storage_path` も一緒に消えている。
 *   画面上は「消えました」と出る。**「削除したのに残る」は個人情報の扱いとして通らない。**
 *
 * **実行時に確かめようとしてはいけない**（消えた `verify-delete.mjs` の警告）
 *   削除後は「残っていても見えない」ので、**RLS 越しの確認は必ず合格してしまう**。
 *   実体を数えるには service_role が要る。だからここでは**呼ぶ順序を静的に**見る。
 *
 * 見るもの: ブラウザ側（`src/` と `backend/js/`）で犬・飼い主を削除する場所が、
 *   同じファイルの中で写真の片付け（`purgePetAssets` / `purgeOwnerAssets`）を
 *   使っているか。サーバ側（`worker/`）は service_role を持たないので対象外——
 *   **片付けはブラウザ側の責任**という契約（`backend/js/supabase-storage.js` 参照）。
 *
 * 何を保証しないか: 実際に順序どおり動くこと・写真が本当に消えること（D-18 偽-5）。
 *   ここは**呼んでいるかどうかだけ**を見る。
 *
 *   node scripts/guard/delete-order.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* 対象はブラウザ側だけ。 */
const AREAS = ['src', 'backend/js'];
const TEXT = new Set(['.js', '.mjs', '.html']);

/* 消す対象ごとに、「削除の呼び出し」と「先に要る片付け」の対。 */
const RULES = [
  { what: '犬', endpoint: /\/api\/pets\//, purge: 'purgePetAssets' },
  { what: '飼い主', endpoint: /\/api\/owners\//, purge: 'purgeOwnerAssets' },
];

const DELETES = /['"`]DELETE['"`]/;

const listFiles = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? listFiles(path.join(dir, e.name))
    : [path.join(dir, e.name)]))
  : []);

export function checkDeleteOrder(root) {
  const files = AREAS
    .flatMap((a) => listFiles(path.join(root, a)))
    .filter((f) => TEXT.has(path.extname(f)));

  const problems = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!DELETES.test(text)) continue;
    for (const { what, endpoint, purge } of RULES) {
      if (!endpoint.test(text)) continue;
      if (text.includes(purge)) continue;
      problems.push({ file: path.relative(root, file), what, purge });
    }
  }
  return { scanned: files.length, problems };
}

/* ── 直接叩かれたとき ── */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const { scanned, problems } = checkDeleteOrder(root);

  /* 走査件数を必ず出す。対象を減らして 0 件にする逃げ道を塞ぐため（D-18 偽-2）。 */
  process.stdout.write(`[delete-order] ブラウザ側を走査: ${scanned} ファイル\n`);

  if (problems.length === 0) {
    process.stdout.write('✅ 削除の順序 OK（Storage を片付けずに DB を消す場所は 0 件）\n');
    process.exit(0);
  }

  process.stderr.write(
    `\n❌ 写真を片付けずに削除している場所が ${problems.length} 件あります\n\n`
    + problems.map((p) => `    ${p.file}\n      ${p.what}を削除しているのに ${p.purge}() を呼んでいません`).join('\n')
    + `\n\n  **Storage → DB の順**です（D-20260824-34）。逆にすると、写真は残るのに\n`
    + `  スタッフからも飼い主からも見えず・消せなくなります（回収は service_role のみ）。\n`
    + `  削除の前に backend/js/supabase-storage.js の片付けを呼んでください。\n`
    + `  **実行して確かめようとしないこと**——削除後は「残っていても見えない」ので、\n`
    + `  RLS 越しの確認は必ず合格します。\n`,
  );
  process.exit(1);
}

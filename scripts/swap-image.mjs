/**
 * swap-image.mjs — 画像を1回の命令で差し替える
 *
 * **なぜ要るか**（マスター指示 2026-08-27「画像はすべて交換可能にしろ」）
 *   画像はどれも「あとで自分の写真に差し替える」もの。手で差し替えると2か所つまずく:
 *
 *   1. **拡張子**。手元の写真が `.png` なのに置き場所が `.jpg` だと、同じ名前で
 *      置いても中身と名前が食い違う。配信側は拡張子で種類を決めるので、
 *      「置いたのに出ない／崩れる」が起きる
 *   2. **参照の数**。1枚の画像が複数の場所から参照されていることがある
 *      （`photo-trim-action.jpg` は3か所）。1か所だけ直すと**片方だけ変わる**
 *
 *   だからこの命令は、**実体を置き換えたうえで、参照側も全部書き換える**。
 *
 *   node scripts/swap-image.mjs                     ← 役割の一覧を出す
 *   node scripts/swap-image.mjs login-photo ~/新しい写真.png
 *
 * **勝手に画質を変えない。** 渡されたファイルをそのまま置く——縮めるかどうかは
 * 用途によって答えが違い（`D-20260827-47` の爪の図は縮めてはいけない）、
 * ここで決めてよいことではない。
 *
 * **出どころは自動で書き換えない**（`A-3`）。差し替えたら
 * `docs/ASSET-PROVENANCE.md` を人が直す。最後にそう伝える。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { IMAGE_ROLES, REFERENCE_FILES, roleById } from './lib/image-roles.mjs';

/** 受け付ける種類。**ここに無い拡張子は断る**——配信側が扱えるとは限らない。 */
const ALLOWED = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

/**
 * 新しいファイル名を決める。
 *
 * **名前は役割のまま、拡張子だけ新しいものに合わせる。** 名前ごと変えると
 * 台帳・記録・過去の失敗の記録がすべて指し先を失う。
 */
export function nextFileName(currentFile, sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  const base = path.basename(currentFile, path.extname(currentFile));
  return `${base}${ext === '.jpeg' ? '.jpg' : ext}`;
}

/**
 * 参照を書き換える。**`assets/xxx` と `/assets/xxx` の両方**を見る
 * （`manifest.json` は相対で書く）。戻り値は書き換えた場所の一覧。
 */
export function rewriteReferences(root, oldFile, newFile, { write = true } = {}) {
  const touched = [];
  if (oldFile === newFile) return touched;
  for (const rel of REFERENCE_FILES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const before = fs.readFileSync(full, 'utf8');
    const after = before.split(`assets/${oldFile}`).join(`assets/${newFile}`);
    if (after === before) continue;
    const count = before.split(`assets/${oldFile}`).length - 1;
    touched.push(`${rel}（${count}か所）`);
    if (write) fs.writeFileSync(full, after);
  }
  return touched;
}

function listRoles() {
  process.stdout.write('差し替えられる画像:\n\n');
  for (const role of IMAGE_ROLES) {
    process.stdout.write(`  ${role.id}\n`);
    process.stdout.write(`      いま: src/assets/${role.file}\n`);
    process.stdout.write(`      どこ: ${role.what}\n`);
    process.stdout.write(`      誰が見る: ${role.seenBy}\n`);
    if (role.note) process.stdout.write(`      注意: ${role.note}\n`);
    process.stdout.write('\n');
  }
  process.stdout.write('  node scripts/swap-image.mjs <役割> <新しいファイル>\n');
}

function main(argv) {
  const root = process.cwd();
  const [, , id, source] = argv;

  if (!id) { listRoles(); return; }

  const role = roleById(id);
  if (!role) {
    process.stderr.write(`「${id}」という役割は無い。\n\n`);
    listRoles();
    process.exit(1);
  }
  if (!source) {
    process.stderr.write(`新しいファイルを渡してください:\n  node scripts/swap-image.mjs ${id} <新しいファイル>\n`);
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    process.stderr.write(`${source} が見つかりません。\n`);
    process.exit(1);
  }
  const ext = path.extname(source).toLowerCase();
  if (!ALLOWED.includes(ext)) {
    process.stderr.write(`${ext} は扱えません。使えるのは ${ALLOWED.join(' / ')} です。\n`);
    process.exit(1);
  }

  const newFile = nextFileName(role.file, source);
  const assetsDir = path.join(root, 'src', 'assets');
  const oldPath = path.join(assetsDir, role.file);
  const newPath = path.join(assetsDir, newFile);

  /* **古いほうは消す。** 残すと「どちらが本物か」が分からなくなり、
     隔離検査が未参照ファイルとして挙げ続ける。 */
  fs.copyFileSync(source, newPath);
  if (newFile !== role.file && fs.existsSync(oldPath)) fs.rmSync(oldPath);

  const touched = rewriteReferences(root, role.file, newFile);
  const size = (fs.statSync(newPath).size / 1024).toFixed(0);

  process.stdout.write(`置き換えました: src/assets/${newFile}（${size}KB）\n`);
  if (touched.length > 0) {
    process.stdout.write(`参照も書き換えました: ${touched.join(' / ')}\n`);
  }
  if (newFile !== role.file) {
    process.stdout.write(
      `**台帳の file を ${newFile} に直してください**: scripts/lib/image-roles.mjs\n`,
    );
  }
  process.stdout.write(
    '\nこのあと必ず:\n'
    + '  1. npm run build && npm run check    ← 参照の食い違いはここで止まる\n'
    + `  2. docs/ASSET-PROVENANCE.md の「${role.file}」の行を、新しい出どころに直す（A-3）\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv);

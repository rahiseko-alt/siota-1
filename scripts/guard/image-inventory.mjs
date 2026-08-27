/**
 * image-inventory.mjs — 台帳に無い画像を、画面に出させない
 *
 * `scripts/lib/image-roles.mjs` の役割一覧と、実際の `src/` を突き合わせる。
 *
 * **何を見るか**（3つ）
 *   1. 台帳の画像が `src/assets/` に**実在する**か（消えたのに台帳だけ残っていないか）
 *   2. 台帳の画像が `src/` から**参照されている**か（誰も使っていないものを台帳に載せない）
 *   3. `src/` が参照している画像が**全部台帳に載っている**か
 *      —— これが本体。**台帳を通さずに画像を足せない**ようにする
 *
 * **何を保証しないか**: 中身が正しいか（同じ絵かどうか）は見ない。
 * 出どころ（`A-3`）も見ない——それは `docs/ASSET-PROVENANCE.md` の担当。
 *
 * **なぜ 3 が要るか**: マスターの指示は「画像はすべて交換可能にしろ」。
 * 台帳に載っていない画像は、差し替えたい人から**見えない**ので交換できない。
 * 「載せ忘れ」を人の注意力で防ぐのはやめる（`D-13` の型）。
 *
 *   node scripts/guard/image-inventory.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { IMAGE_ROLES, REFERENCE_FILES } from '../lib/image-roles.mjs';

/** `/assets/xxx.png` と `assets/xxx.png`（`manifest.json` は相対）の両方を拾う。 */
const IMAGE_REF = /(?:^|["'(\s])\/?assets\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp|svg|gif))/gi;

/** 参照している側を集める。**コメント行は数えない**——説明文の中のパスは参照ではない。 */
export function collectReferences(root) {
  const found = new Map();
  for (const rel of REFERENCE_FILES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      /* HTML と JS のコメントを落とす。台帳の説明にファイル名を書いても
         「参照されている」と数えないため（`D-18` 偽-3 の逆——数を水増ししない）。 */
      const code = line.replace(/<!--.*?-->/g, '').replace(/^\s*(\/\/|\*|\/\*).*/, '');
      for (const m of code.matchAll(IMAGE_REF)) {
        const file = m[1];
        if (!found.has(file)) found.set(file, []);
        found.get(file).push(`${rel}:${i + 1}`);
      }
    });
  }
  return found;
}

export function checkImageInventory(root) {
  const problems = [];
  const refs = collectReferences(root);
  const listed = new Set(IMAGE_ROLES.map((role) => role.file));

  for (const role of IMAGE_ROLES) {
    const full = path.join(root, 'src', 'assets', role.file);
    if (!fs.existsSync(full)) {
      problems.push(`台帳の「${role.id}」が指す src/assets/${role.file} が無い`);
      continue;
    }
    if (!refs.has(role.file)) {
      problems.push(`台帳の「${role.id}」（${role.file}）を、どの画面も参照していない`);
    }
  }

  for (const [file, where] of refs) {
    if (!listed.has(file)) {
      problems.push(
        `${file} が画面に出ているのに台帳に無い（${where.join(' / ')}）`
        + ' — scripts/lib/image-roles.mjs に役割を足すこと',
      );
    }
  }
  return { problems, refs, roles: IMAGE_ROLES };
}

function main() {
  const root = process.cwd();
  const { problems, refs, roles } = checkImageInventory(root);
  process.stdout.write(`[image-inventory] 台帳 ${roles.length}件 / 画面が参照している画像 ${refs.size}件\n`);
  if (problems.length > 0) {
    for (const line of problems) process.stdout.write(`❌ ${line}\n`);
    process.stdout.write(
      '\n画像は「あとで差し替えるもの」（マスター指示 2026-08-27）。\n'
      + '台帳に無い画像は、差し替えたい人から見えないので交換できない。\n'
      + '差し替えは node scripts/swap-image.mjs <役割> <新しいファイル>\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    '✅ 画像の台帳 OK（**中身が同じ絵かは見ていない**——出どころは ASSET-PROVENANCE の担当）\n',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

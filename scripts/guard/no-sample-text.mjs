/**
 * no-sample-text.mjs — お客さんに見える画面に、見本の文章を置かせない
 *
 * `AGENTS.md` D-10「飼い主の画面に、見本を出さない」の機械強制。
 *
 * なぜ要るか（`F-20260821-14`）:
 *   ④の担当メッセージ欄に「今月もとってもお利口に…」が**最初から入っていた**。
 *   トリマーが消し忘れると、**誰も書いていない手紙が担当トリマーの名前で飼い主に届く**。
 *   実際に届いた事故が記録されている。`bad-scenarios-F3` #1 はこの再来を見ていた。
 *
 *   意匠モック由来の文で、悪意も事故も無い——
 *   **絵として見せるために入れてあった**もの。だが `src/` は本番の実体なので、
 *   そこに残っていると本番でそのまま出る（`D-1`）。
 *
 * 見るのは1つ: **`src/` に見本の文が無いこと。** 意匠見本の側は見ない（`D-1`）。
 *
 * **この検査が保証しないこと**: 新しく書かれた見本文は捕まえられない。
 * ここに並ぶのは**実際に事故になった文**だけである。増やすときは1行足す。
 *
 *   node scripts/guard/no-sample-text.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 実際に飼い主へ届いてしまった見本文（`F-20260821-14`）。 */
const SAMPLES = [
  '今月もとってもお利口に',
  '腰のマッサージ中はずっとウトウト',
  'また来月お会いできるのを楽しみに',
  /* 見本の**数字**（`docs/deferred.md` #35）。⑤雑誌の器に残っていて、
     段のタブ「04」で直接来ると**どの犬にも同じ体重が出る**。
     文と違って一見それらしいので、届いても誰も気づかない。
     **コメントで数字だけ書く分は当たらない**ように、単位まで含めて並べる。 */
  '2.79 kg',
  '2.79kg',
  '2.67kg',
];

/** 見る場所。意匠見本の置き場は**わざと外す**——あちらは絵であって本番ではない（`D-1`）。 */
const ROOTS = ['src'];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { yield* walk(full); continue; }
    if (/\.(html|js|json)$/.test(entry.name) && !full.includes('assets')) yield full;
  }
}

export function checkSampleText(root) {
  const hits = [];
  for (const dir of ROOTS) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base)) {
      const text = fs.readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const sample of SAMPLES) {
          if (line.includes(sample)) hits.push(`${path.relative(root, file)}:${i + 1}  「${sample}…」`);
        }
      });
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.REPO_ROOT || process.cwd();
  const hits = checkSampleText(root);
  if (hits.length > 0) {
    process.stderr.write(`[no-sample-text] src/ を走査: 見本の文 ${SAMPLES.length}種\n`);
    hits.forEach((h) => process.stderr.write(`❌ ${h}\n`));
    process.stderr.write(
      '\n書いていないことは空で出す（D-10）。消し忘れると、**誰も書いていない手紙が\n'
      + '担当トリマーの名前で飼い主に届く**（F-20260821-14）。placeholder で示すこと。\n',
    );
    process.exit(1);
  }
  process.stdout.write(`[no-sample-text] src/ を走査: 見本の文 ${SAMPLES.length}種\n`);
  process.stdout.write('✅ 見本の文は無い（**新しく書かれた見本文は捕まえない**——実際に事故になった文だけを見る）\n');
}

/**
 * vendor-fonts.mjs — Google Fonts を同梱物として取り込み直す
 *
 *   node scripts/vendor-fonts.mjs
 *
 * 出力: src/assets/fonts/*.woff2 と src/assets/fonts/fonts.css
 *
 * 常用するものではない。ファミリやウェイトを変えたときだけ実行する。
 * 生成物はコミットする（納品物が外部 CDN に依存しないための同梱なので、
 * ビルド時に取りに行くのでは意味がない）。
 *
 * 日本語フォントを足したくなったら、先に docs/ASSET-PROVENANCE.md の
 * 「同梱していない日本語フォントと、その代償」を読むこと。Noto Sans JP と
 * Noto Serif JP は2つで 70MB あり、リポジトリの容量予算（20MB）に入らない。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'assets', 'fonts');

/* woff2 を返させるために現代的なブラウザを名乗る。
   これが無いと Google は古い形式（ttf）を返し、容量が数倍になる。 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* 同梱する Latin 3ファミリ。いずれも SIL Open Font License 1.1。
   HTML 側の font-family 指定と揃っている必要がある。 */
const FAMILIES = [
  { name: 'Fraunces', spec: 'Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,600' },
  { name: 'Plus-Jakarta-Sans', spec: 'Plus+Jakarta+Sans:wght@400;500;600;700;800' },
  { name: 'Inter', spec: 'Inter:wght@300;400;500;600;700;800' },
];

const HEADER = `/* 同梱フォント（自動生成。scripts/vendor-fonts.mjs で作り直せる）
 *
 * Google Fonts への直リンクを外し、woff2 をこのリポジトリに取り込んだもの。
 * 対象は Latin 3ファミリのみ。日本語フォントは容量の都合で同梱していない。
 * 理由と代償は docs/ASSET-PROVENANCE.md に書いた。
 *
 * ライセンス: 3ファミリとも SIL Open Font License 1.1（再配布可）
 */
`;

fs.mkdirSync(OUT, { recursive: true });

let css = HEADER;
let downloaded = 0;

for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family.spec}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${family.name}: css2 が ${res.status}`);
  let sheet = await res.text();

  const urls = [...new Set([...sheet.matchAll(/https:\/\/fonts\.gstatic\.com\/(\S+?)(?=\))/g)]
    .map((m) => m[0]))];

  for (const fontUrl of urls) {
    const local = `${family.name}-${path.basename(fontUrl)}`;
    const dest = path.join(OUT, local);
    if (!fs.existsSync(dest)) {
      const bin = await fetch(fontUrl, { headers: { 'User-Agent': UA } });
      if (!bin.ok) throw new Error(`${local}: ${bin.status}`);
      const buf = Buffer.from(await bin.arrayBuffer());
      /* 数百バイトのファイルはエラーページを掴んでいる。壊れたフォントを
         コミットすると、表示が静かに崩れるだけで誰も気づかない。 */
      if (buf.length < 1024) throw new Error(`${local}: ${buf.length}B しかない`);
      fs.writeFileSync(dest, buf);
      downloaded += 1;
    }
    sheet = sheet.replaceAll(fontUrl, local);
  }

  css += `\n/* ── ${family.name} ── */\n${sheet}`;
  process.stdout.write(`${family.name}: ${urls.length} ファイル\n`);
}

fs.writeFileSync(path.join(OUT, 'fonts.css'), css, 'utf8');

/* 生成した CSS が参照する全ファイルが実在することを確かめる。
   1件でも欠けると、その字形だけが黙ってフォールバックに落ちる。 */
const refs = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, '')))];
const missing = refs.filter((r) => !fs.existsSync(path.join(OUT, r)));
const external = refs.filter((r) => r.startsWith('http'));

if (missing.length || external.length) {
  process.stderr.write(`❌ 欠落 ${missing.length} 件 / 外部URL残存 ${external.length} 件\n`);
  [...missing, ...external].slice(0, 10).forEach((r) => process.stderr.write(`  - ${r}\n`));
  process.exit(1);
}

process.stdout.write(
  `\n✅ @font-face ${(css.match(/@font-face/g) || []).length} 件 / `
  + `参照ファイル ${refs.length} 件 / 新規取得 ${downloaded} 件 / 外部URL 0 件\n`,
);

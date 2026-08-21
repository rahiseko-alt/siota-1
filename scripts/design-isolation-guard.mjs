/**
 * design-isolation-guard.mjs — `design/` が意匠見本に留まっていることの機械強制
 *
 * LEVEL D-1「`src/` が本番の実体。`design/` は意匠見本であり import 禁止」の実装。
 *
 * `design/` は統合フェーズ（P0〜P9）で `src/` へ貼り替えるための見本であって、
 * 動くコードではない。過去に「動くコードを資料扱いにして、動かないモックを本体に据える」
 * 事故が起きている（移設 plan「前版の誤り」）。逆流を検出する。
 *
 * 検査:
 *   1. `design/` がビルド対象の外（`src/` の配下でない）にあること
 *   2. `src/` `worker/` `scripts/` のどのファイルも `design/` を参照していないこと
 *   3. ビルド済みの `dist/` に `design/` 由来のファイルが入っていないこと
 *
 * 2 について: `src/design-samples/`（V1 カルテ本体の置き場）は別物なので誤検出しない。
 * 探すのは「design」の直後にスラッシュが来る形だけで、`design-samples/` は該当しない。
 *
 * EXIT 0 = 隔離されている / EXIT 1 = 逆流を検出
 * 外部依存ゼロ（node:fs / node:path のみ）
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || process.cwd());
const DESIGN = path.join(ROOT, 'design');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const SCAN_DIRS = ['src', 'worker', 'scripts'];
const SCAN_EXT = new Set(['.html', '.js', '.mjs', '.cjs', '.json', '.toml', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist']);

/** `design/` への参照。`design-samples/` は "design" の次が "-" なので該当しない。 */
const REFERENCE = /(?<![\w-])design\//;

/* このファイル自身は scripts/ に居て、かつ design/ の話をしないと成立しない。
   自分を検査対象から外す。除外はここ1件だけで、増やさない。 */
const SELF = path.resolve(new URL(import.meta.url).pathname);

const problems = [];

// ── 1. design/ がビルド対象の外にあること ──
if (!fs.existsSync(DESIGN)) {
  problems.push('design/ が存在しない。意匠見本の置き場が消えている。');
} else if (path.relative(SRC, DESIGN).startsWith('..') === false) {
  problems.push(
    `design/ が src/ の配下にある (${path.relative(ROOT, DESIGN)})。`
    + ' build-dist.mjs の completeness guard が src/ 配下の HTML を全列挙するため、'
    + 'この位置だとモックがビルドに巻き込まれる。src/ の外へ戻すこと。',
  );
}

// ── 2. src/ worker/ scripts/ から design/ を参照していないこと ──
function walk(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), onFile);
    } else if (entry.isFile()) {
      onFile(path.join(dir, entry.name));
    }
  }
}

for (const rel of SCAN_DIRS) {
  walk(path.join(ROOT, rel), (file) => {
    if (!SCAN_EXT.has(path.extname(file))) return;
    if (path.resolve(file) === SELF) return;
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (REFERENCE.test(line)) {
        problems.push(
          `${path.relative(ROOT, file)}:${i + 1} が design/ を参照している`
          + ` — ${line.trim().slice(0, 100)}`,
        );
      }
    });
  });
}

// ── 3. dist/ に design/ 由来のファイルが混ざっていないこと ──
if (fs.existsSync(DIST) && fs.existsSync(DESIGN)) {
  const designNames = new Set(
    fs.readdirSync(DESIGN, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name),
  );
  walk(DIST, (file) => {
    if (designNames.has(path.basename(file))) {
      problems.push(
        `${path.relative(ROOT, file)} が design/ と同名。モックがビルドに入り込んでいる可能性がある。`,
      );
    }
  });
}

if (problems.length > 0) {
  process.stderr.write('❌ design/ の隔離が破れている\n\n');
  problems.forEach((p) => process.stderr.write(`  - ${p}\n`));
  process.stderr.write('\n  design/ は統合で src/ へ貼り替えるための意匠見本であって、動くコードではない。\n');
  process.stderr.write('  参照が要るなら、貼り替えを済ませて src/ 側の実体を指すこと。\n');
  process.exit(1);
}

process.stdout.write('✅ design/ isolation OK\n');

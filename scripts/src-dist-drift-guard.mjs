/**
 * src-dist-drift-guard.mjs — src→dist 対応物チェッカー
 *
 * 使い方:
 *   node scripts/src-dist-drift-guard.mjs [productDir]
 *   productDir 省略時は cwd を使用
 *
 * 設定ファイル: {productDir}/src-dist-guard.config.json
 *   なければデフォルト: src/*.html → dist/*.html（basename 一致）
 *
 * EXIT 0 = 整合 / EXIT 1 = ドリフト検出
 * 外部依存ゼロ（node:fs / node:path のみ）
 *
 * 横展開手順: products/{product}/src-dist-guard.config.json を作成し
 *   products/{product}/.claude/settings.json の PreToolUse に hook を追記するだけ。
 */

import path from 'node:path';
import fs from 'node:fs';

const productDir = path.resolve(process.argv[2] || process.cwd());
const configPath = path.join(productDir, 'src-dist-guard.config.json');

let checks;

if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (!Array.isArray(config.checks)) {
      process.stderr.write('❌ src-dist-guard.config.json: "checks" 配列が見つかりません\n');
      process.exit(1);
    }
    checks = config.checks;
  } catch (e) {
    process.stderr.write(`❌ src-dist-guard.config.json 読み込みエラー: ${e.message}\n`);
    process.exit(1);
  }
} else {
  // デフォルト: src/*.html → dist/*.html
  checks = [
    {
      srcDir: 'src',
      srcExt: '.html',
      distPattern: 'dist/{name}{ext}',
      description: 'Root HTML (default)',
    },
  ];
}

const drifts = [];

for (const check of checks) {
  const srcDirFull = path.join(productDir, check.srcDir);
  if (!fs.existsSync(srcDirFull)) continue;

  const srcFiles = fs.readdirSync(srcDirFull).filter(
    (f) =>
      f.endsWith(check.srcExt) &&
      fs.statSync(path.join(srcDirFull, f)).isFile(),
  );

  for (const srcFile of srcFiles) {
    const ext = path.extname(srcFile);
    const name = path.basename(srcFile, ext);
    const distRelPath = check.distPattern
      .replace('{name}', name)
      .replace('{ext}', ext);
    const distFull = path.join(productDir, distRelPath);

    if (!fs.existsSync(distFull)) {
      drifts.push({
        description: check.description,
        src: path.join(check.srcDir, srcFile).replace(/\\/g, '/'),
        expectedDist: distRelPath.replace(/\\/g, '/'),
      });
    }
  }
}

if (drifts.length > 0) {
  process.stderr.write(`❌ src→dist drift detected (${drifts.length} 件):\n`);
  for (const d of drifts) {
    process.stderr.write(
      `  [${d.description}] ${d.src} → ${d.expectedDist} (NOT FOUND)\n`,
    );
  }
  process.stderr.write(
    '\n  → npm run build を実行するか、dist に対応物を追加してください\n',
  );
  process.exit(1);
}

process.stdout.write('✅ src→dist parity OK\n');
process.exit(0);

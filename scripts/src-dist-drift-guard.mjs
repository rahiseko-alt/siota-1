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

/* 設定が実在しない場所を指していたら、それ自体を検出として扱う。
   黙って飛ばすと「0 件だったので合格」になり、**調べていないのに緑**になる
   （F1 バッドシナリオ #9・`docs/ops/bad-scenarios-F1.md`）。 */
const deadConfigs = [];

for (const check of checks) {
  const srcDirFull = path.join(productDir, check.srcDir);
  if (!fs.existsSync(srcDirFull)) {
    deadConfigs.push(check);
    continue;
  }

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

if (deadConfigs.length > 0) {
  process.stderr.write(
    `❌ src-dist-guard.config.json が、実在しない場所を指しています (${deadConfigs.length} 件):\n`,
  );
  for (const c of deadConfigs) {
    process.stderr.write(`  [${c.description}] srcDir: ${c.srcDir} (NOT FOUND)\n`);
  }
  process.stderr.write(
    '\n  → その場所を調べていないまま合格になります。設定から消すか、場所を直してください\n',
  );
  process.exit(1);
}

/* `dist/` そのものが無いのは「食い違い」ではなく「まだ組み立てていない」。
   `dist/` は .gitignore で管理外なので、**クローン直後は必ずこの状態**になる。
   同じ EXIT 1 でも、直し方が違うものを同じ文面で出すと、初めての人は
   「自分の環境が壊れている」と読む（F1 バッドシナリオ #10）。
   **合格にはしない**——判定は緩めず、次にやることだけを正しく伝える。 */
if (!fs.existsSync(path.join(productDir, 'dist'))) {
  process.stderr.write(
    'まだ組み立てていません（dist/ が無い）。\n\n'
    + '  dist/ は git の管理外（.gitignore）なので、クローン直後には存在しません。\n'
    + '  新しい環境では、この順で実行してください:\n\n'
    + '    npm ci\n'
    + '    npm run build\n'
    + '    npm run check\n',
  );
  process.exit(1);
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

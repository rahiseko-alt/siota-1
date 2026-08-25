/**
 * chromium.mjs — 絵を撮るためのブラウザを、環境に在るもので起動する
 *
 * `playwright` が同梱を期待するビルド番号と、環境に在るブラウザは食い違うことがある
 * （`Executable doesn't exist at .../chromium_headless_shell-1217/...`）。
 * マスターの PC では一致していても、**新しいコンテナでは一致しない**。
 * D-14 の合否はブラウザが撮る絵だけで決まるので、ここで落ちると
 * 「合格とも不合格とも言えない」状態になる（`F-20260825-33` の型）。
 *
 * 選び方は4段: ①`WALK_CHROMIUM` の明示指定 ②既定で起動できればそれ
 * ③駄目なら**在るものを探して**使う ④無ければ、何をすればよいかを言って落ちる。
 * ③で使ったときは**必ず声に出す**。黙って別のブラウザに差し替えない。
 *
 * `walk-human.mjs` と、作り直す `verify:*`（`bad-scenarios-F3` #6）が共有する。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

/** playwright が入っているブラウザ置き場から、使える chromium の実行ファイルを探す。
    複数あるときはビルド番号の大きいものを選ぶ。見つからなければ null。 */
export function findInstalledChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),          /* Linux 既定 */
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), /* macOS 既定 */
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),  /* Windows 既定 */
  ].filter((r) => r && fs.existsSync(r));

  /* 実行ファイルの置き場所は OS で違う。chrome より headless_shell を先に見ない
     ——絵を撮るのが目的なので、通常のブラウザが在るならそちらを使う。 */
  const CANDIDATES = [
    ['chrome-linux', 'chrome'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-linux', 'headless_shell'],
  ];

  const found = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^chromium(_headless_shell)?-(\d+)$/.test(entry.name)) continue;
      const rev = Number(entry.name.match(/-(\d+)$/)[1]);
      for (const parts of CANDIDATES) {
        const exe = path.join(root, entry.name, ...parts);
        if (fs.existsSync(exe)) { found.push({ rev, exe }); break; }
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found.length > 0 ? found[0].exe : null;
}

/** 絵を撮るためのブラウザを起動する。どれを使ったかは必ず出力する。 */
export async function launchChromium() {
  if (process.env.WALK_CHROMIUM) {
    process.stdout.write(`[walk] WALK_CHROMIUM の指定を使う: ${process.env.WALK_CHROMIUM}\n`);
    return chromium.launch({ executablePath: process.env.WALK_CHROMIUM });
  }
  try {
    return await chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist/.test(String(e))) throw e;
    const exe = findInstalledChromium();
    if (!exe) {
      process.stderr.write(
        `\n[walk] 絵を撮るブラウザが見つかりません。**アプリの不具合ではありません。**\n`
        + `  playwright が期待する版が、この環境に入っていません。次のどちらかで直せます:\n`
        + `    1. npx playwright install chromium\n`
        + `    2. WALK_CHROMIUM=/実行ファイルへのパス npm run walk\n`
        + `  探した場所: ${[process.env.PLAYWRIGHT_BROWSERS_PATH, '~/.cache/ms-playwright'].filter(Boolean).join(' / ')}\n\n`,
      );
      throw e;
    }
    /* 黙って別のブラウザに差し替えない。使ったものを必ず言う。 */
    process.stdout.write(
      `[walk] playwright が期待する版が無いので、この環境に在るものを使う: ${exe}\n`
      + `       （絵の判定には十分だが、マスターの PC とビルド番号が違うことは意識すること）\n`,
    );
    return chromium.launch({ executablePath: exe });
  }
}


/**
 * no-secrets.mjs — 鍵がリポジトリに入るのを、覚えていなくても止める
 *
 * `AGENTS.md` A-1「鍵とパスワードを、コードに書かない」の機械強制。
 * D-7 のとおり、**「気をつける」では守れない**ので命令に落とす。
 *
 * **なぜ足したか**（2026-08-26・`docs/ops/prod-check-F3.md` の作業中に見つけた）
 *   `D-20260824-31` は、作業中に `.cftoken`（Cloudflare API token）・`.sbtoken`
 *   （Supabase Management API token）・`.srkey`（**service_role key・RLS を丸ごと無視する**）
 *   の3本を一時ディレクトリへ実体で置いて作業したことを記録し、ローテーションを
 *   マスター作業として残してある。**履歴にもツリーにも入っていないことは確認済み**だが、
 *   `.gitignore` はこの3つを**塞いでいなかった**（`git check-ignore` が 0 件）。
 *   `*.key` は `.srkey` に当たらない——末尾が `.key` ではないため。
 *   つまり次のセッションが同じ場所へ降ろせば、**普通に `git add` できてしまう。**
 *
 *   `.gitignore` は F3 の範囲外（`scripts/guard/scope.mjs` が止める）なので、
 *   **範囲内で、より強い側**——`npm run check` と CI が毎回止める形——に置いた。
 *   `.gitignore` への追記は棚卸しでマスターに諮る（`docs/deferred.md` #32）。
 *
 * 見るのは2つ:
 *   1. 鍵ファイルが git に追跡されているか／作業ツリーに在るか
 *   2. 追跡ファイルに **service_role の JWT** か **Supabase の PAT (`sbp_…`)** が在るか
 *
 * **値は絶対に出さない。** 出したら、この検査自体が A-1 違反になる。
 * 出すのは「どのファイルの何行目に、どの種類のものが在るか」だけ。
 *
 * **この検査が保証しないこと**（`D-18` 偽-5 の潰し）:
 *   - **git の履歴は見ない。** いま追跡されている中身だけを見る。
 *     過去に入って消したものは捕まえない（それは `git log` で別に見る）。
 *   - **あらゆる鍵を捕まえるわけではない。** Cloudflare の API token は
 *     40文字の英数字で、普通の識別子と見分けが付かない。**形で捕まえられるものだけ**を見る。
 *     捕まらない種類は、ファイル名（1）の側で止める。
 *   - **anon / publishable key は止めない。** これは公開してよい設計で、
 *     実際 `.env.example` に名前だけ載っている（`D-20260824-31`）。
 *
 *   node scripts/guard/no-secrets.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** 作業中に実体で置いた鍵（`D-20260824-31`）。名前が分かっているものは名前で止める。 */
const SECRET_FILES = ['.cftoken', '.sbtoken', '.srkey'];

/** 中身が確実に鍵だと言える形だけを並べる。曖昧な形は入れない（誤検知は検査を殺す）。 */
const SECRET_PATTERNS = [
  { name: 'Supabase の PAT (sbp_…)', re: /\bsbp_[0-9a-f]{40}\b/ },
];

/** JWT の payload を覗いて `service_role` かどうかだけ見る。**値は返さない。** */
function isServiceRoleJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && payload.role === 'service_role';
  } catch {
    return false;
  }
}

export function checkNoSecrets(root) {
  const problems = [];

  /* 1. 鍵ファイルそのもの。追跡されていれば当然だめ。
        追跡されていなくても、作業ツリーに在れば `git add -A` 一回で入る。 */
  const tracked = execSync('git ls-files', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\n').map((l) => l.trim()).filter(Boolean);
  const trackedSet = new Set(tracked);

  for (const name of SECRET_FILES) {
    if (trackedSet.has(name)) {
      problems.push(`git が追跡している: ${name} —— **いますぐ履歴ごと消し、鍵を作り直すこと**`);
    } else if (fs.existsSync(path.join(root, name))) {
      problems.push(
        `作業ツリーに在る: ${name} —— .gitignore が塞いでいないので `
        + `\`git add -A\` 一回で入る。リポジトリの外へ移すこと`,
      );
    }
  }

  /* 2. 追跡ファイルの中身。**走査した本数を必ず出す**——
        黙って対象を狭めて「0件」にするのを防ぐ（`D-18` 偽-2）。 */
  const textFiles = tracked.filter((f) => {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) return false;
    if (fs.statSync(full).size > 2 * 1024 * 1024) return false;
    return !/\.(png|jpe?g|gif|webp|woff2?|ico|pdf|zip)$/i.test(f);
  });

  const SELF = 'scripts/guard/no-secrets.mjs';
  for (const file of textFiles) {
    /* 自分自身は除く——ここに書いてある「形の説明」に当たってしまう。
       除くのはこの1本だけで、除いたことをこの行が示している（偽-2 の潰し）。 */
    if (file === SELF) continue;
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(line)) problems.push(`${file}:${i + 1} に ${name} が在る`);
      }
      for (const m of line.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
        if (isServiceRoleJwt(m[0])) {
          problems.push(`${file}:${i + 1} に service_role の JWT が在る —— **RLS を丸ごと無視できる鍵**`);
        }
      }
    });
  }

  return { problems, scanned: textFiles.length, files: SECRET_FILES.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const { problems, scanned, files } = checkNoSecrets(root);
  process.stdout.write(`[no-secrets] 鍵ファイル名 ${files} 種 / 追跡ファイル ${scanned} 本を走査\n`);
  if (problems.length > 0) {
    process.stdout.write('❌ 鍵がリポジトリに入りかけている（A-1）\n');
    for (const p of problems) process.stdout.write(`   ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(
    '✅ 鍵は入っていない（**履歴は見ていない／形で捕まえられる種類だけ**——'
    + 'anon・publishable key は設計通り止めない）\n',
  );
}

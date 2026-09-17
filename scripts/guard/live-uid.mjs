/**
 * live-uid.mjs — 身元を名乗る場所を `private.live_uid()` から外させない
 *
 * **なぜこの検査が要るか**（`202609170015_session_liveness.sql`・`D-20260917-81`）
 *   ログアウトしても発行済みの通行証（JWT）は取り消せず、最大1時間そのまま通る。
 *   塞ぎ方は、通行証の中の `session_id` が `auth.sessions` に残っているかを見ること
 *   （Supabase 公式）。この判定を1本（`private.live_uid()`）にまとめ、身元を読む
 *   場所は**すべてそこを通す**ことにした。
 *
 *   ところが `auth.uid()` は Supabase の標準の書き方なので、**次に SQL を書く人が
 *   何気なく使うと、そこだけ穴が開く**。しかも開いたことは画面に出ない——
 *   ログアウト済みの通行証でも、その1か所だけ通り続けるだけである。
 *   **文章で「使うな」と書いても破る**（実際、安全確認の最中に自分で12か所破った）。
 *   だから機械に見張らせる。
 *
 * 見るもの: `supabase/migrations/` のうち **202609170015 より後**のファイルに
 *   `auth.uid()` が現れないこと。ただし `private.live_uid()` の定義の中だけは許す
 *   （そこが唯一の出どころだから）。
 *
 * 見ないもの:
 *   - **202609170015 以前のファイル**。適用済みの歴史は書き換えない（`F-20260911-84`）。
 *     いまの定義は 202609170015 が上書きしている。
 *   - `supabase/rollback/`。取り消し用なので `auth.uid()` に戻すのが役目。
 *   - **本当にログアウト後に見えないこと**。それは `supabase/tests/rls.sql` の
 *     ⑥（`npm run verify:migrations`）の担当。ここは**書き方だけ**を見る。
 *
 *   node scripts/guard/live-uid.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const CUTOFF = '202609170015';
const ALLOWED_IN = 'private.live_uid';

export function offenders(root) {
  const dir = path.join(root, 'supabase', 'migrations');
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.slice(0, CUTOFF.length) <= CUTOFF) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (!line.includes('auth.uid()')) return;
      if (line.trimStart().startsWith('--') || line.trimStart().startsWith('*')) return;
      const before = lines.slice(0, index + 1).join('\n');
      const lastDef = before.lastIndexOf('create or replace function ');
      const enclosing = lastDef === -1
        ? ''
        : before.slice(lastDef + 'create or replace function '.length).split('(')[0].trim();
      if (enclosing === ALLOWED_IN) return;
      found.push({ file, line: index + 1, enclosing: enclosing || '（関数の外）', text: line.trim() });
    });
  }
  return found;
}

const found = offenders(process.cwd());
if (found.length > 0) {
  console.error('[live-uid] ❌ **`auth.uid()` を直接読んでいる場所がある。**');
  console.error('   ログアウト済みの通行証でも、そこだけ通ってしまう（ASVS v5.0.0-7.4.1）。');
  console.error('   `(select private.live_uid())` に置き換えること。\n');
  for (const item of found) {
    console.error(`   ${item.file}:${item.line}  ${item.enclosing} 内`);
    console.error(`      ${item.text}`);
  }
  console.error('\n   由来: 202609170015_session_liveness.sql / docs/decisions.md D-20260917-81');
  process.exit(1);
}
console.log(`[live-uid] ✅ ${CUTOFF} より後の SQL に、直接の auth.uid() は無い（**書き方だけを見た**）`);

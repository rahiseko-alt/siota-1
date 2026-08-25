/**
 * verify-stack.mjs — 検査を走らせる土台が、本当に使えるかを確かめる
 *
 * `docs/ops/plan.md` 4-0-c。**9本の `verify:*` を書く前に、これを通す。**
 *
 * なぜ先にこれか: 消えた9本は全部「ログインした特定の人に何が見えるか」を見るもので、
 * 実 Auth / PostgREST / Storage が要る。**土台が動くことを確かめずに9本書くと、
 * また『動かない検査』を増やすだけ**になる（`#6` がまさにその状態だった）。
 *
 * 見るのは4つ。どれも `scripts/lib/local-stack.mjs` の既存の部品を使う（新しく書かない）:
 *   1. Supabase が起きているか（`/auth/v1/health`）
 *   2. **seed が入っているか＝実ログインが通るか**（`staff@local.test`）
 *   3. **マイグレーションが実際に当たっているか**（**その token で** テーブルを引く）
 *   4. **RLS が効いているか**（鍵なしの素の GET が拒まれる）
 *
 * 接続先は `SUPABASE_LOCAL_URL` で差し替えられる（`D-20260825-44`）。
 *
 *   npm run verify:stack
 */

import { ensureLocalSupabaseRunning, passwordLogin, LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, FIXTURE }
  from './lib/local-stack.mjs';

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

process.stdout.write(`[verify-stack] 接続先: ${LOCAL_SUPABASE_URL}\n`);

/* 1. 起きているか。起きていなければ、ここで何をすればよいかを言って止まる。 */
await ensureLocalSupabaseRunning();
check('Supabase が起きている', true);

/* 2. seed が入っているか。実ログインが通れば、DB と Auth の両方が生きている。
      **先にこれをやる。** 3 で使う token がここから出るため。 */
let session = null;
try {
  session = await passwordLogin(FIXTURE.staffEmail);
} catch (e) {
  check('seed のアカウントで実ログインできる', false, String(e).split('\n')[0]);
}
check('seed のアカウントで実ログインできる', Boolean(session?.access_token), FIXTURE.staffEmail);

/* 3. マイグレーションが当たっているか。

      **token を付けて引く。** 最初はここを `apikey` だけで叩き「404 でなければ PASS」に
      していたが、それは**間違った理由で緑になる検査**だった（`F-20260825-35`）。
      PostgREST は JWT が無ければ **401** を返すので、テーブルが1つも無くても 401。
      つまり**マイグレーションが1本も当たっていなくても PASS**していた。
      実際 CI の初回はここが `HTTP 401` のまま PASS と表示された。

      いまは「**200 が返り、中身が配列である**」ことまで見る。
      401/404 のどちらでも落ちる。 */
if (session?.access_token) {
  const res = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/pets?select=id&limit=1`, {
    headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
  });
  let body = null;
  try { body = await res.json(); } catch { /* JSON でないなら下で落ちる */ }
  check('マイグレーションが当たっている（pets を実際に引ける）',
    res.status === 200 && Array.isArray(body),
    `HTTP ${res.status}${Array.isArray(body) ? ` / ${body.length}件` : ' / 配列ではない'}`);
} else {
  check('マイグレーションが当たっている（pets を実際に引ける）', false, 'ログインできていないので確かめられない');
}

/* 4. 鍵も token も無い素の GET が拒まれるか。
      **これは 3 とは別のことを見ている。** 3 が「token を付ければ読める」、
      4 が「付けなければ読めない」。片方だけでは、
      「全部 401」と「ちゃんと効いている」を区別できない。 */
const naked = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/pets?select=id&limit=1`);
check('鍵なしでは読めない（RLS/ゲートウェイが効いている）', naked.status >= 400,
  `HTTP ${naked.status}`);

const failed = results.filter((r) => !r).length;
process.stdout.write(`\n${results.length - failed}/${results.length} PASS\n`);
process.stdout.write('土台の検査。ここが緑でなければ verify:* を書いても意味がない。\n');
process.exit(failed === 0 ? 0 : 1);

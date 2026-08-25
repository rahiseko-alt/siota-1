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
 *   2. **マイグレーションが実際に当たっているか**（PostgREST 越しにテーブルを引く）
 *   3. **seed が入っているか＝実ログインが通るか**（`staff@local.test`）
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

/* 2. マイグレーションが当たっているか。テーブルが無ければ PostgREST は 404 を返す。 */
const petsRes = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/pets?select=id&limit=1`, {
  headers: { apikey: LOCAL_ANON_KEY },
});
check('マイグレーションが当たっている（pets が引ける）', petsRes.status !== 404,
  `HTTP ${petsRes.status}`);

/* 3. seed が入っているか。実ログインが通れば、DB と Auth の両方が生きている。 */
let token = null;
try {
  token = await passwordLogin(FIXTURE.staffEmail);
} catch (e) {
  check('seed のアカウントで実ログインできる', false, String(e).split('\n')[0]);
}
if (token) check('seed のアカウントで実ログインできる', true, FIXTURE.staffEmail);

/* 4. RLS が効いているか。**鍵も token も無い素の GET が通ってしまうなら、
      この土台の上で「誰に何が見えるか」を測っても意味がない。** */
const naked = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/pets?select=id&limit=1`);
check('鍵なしでは読めない（RLS/ゲートウェイが効いている）', naked.status >= 400,
  `HTTP ${naked.status}`);

const failed = results.filter((r) => !r).length;
process.stdout.write(`\n${results.length - failed}/${results.length} PASS\n`);
process.stdout.write('土台の検査。ここが緑でなければ verify:* を書いても意味がない。\n');
process.exit(failed === 0 ? 0 : 1);

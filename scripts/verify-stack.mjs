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
 *   3. **マイグレーションと seed が当たっているか**（**その token で** seed の犬 X を id で引く）
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

/* 1. 起きているか。起きていなければ、ここで何をすればよいかを言って止まる。

      **`check(…, true)` と直書きしていた**（恒真・`F-20260825-40` の型）。
      止めているのは上の `ensureLocalSupabaseRunning()` の throw で、
      この行は**何も測らずに PASS と印字するだけ**だった。応答を実際に見る。 */
await ensureLocalSupabaseRunning();
const health = await fetch(`${LOCAL_SUPABASE_URL}/auth/v1/health`);
check('Supabase が起きている', health.status === 200, `HTTP ${health.status}`);

/* 2. seed が入っているか。実ログインが通れば、DB と Auth の両方が生きている。
      **先にこれをやる。** 3 で使う token がここから出るため。 */
let session = null;
try {
  session = await passwordLogin(FIXTURE.staffEmail);
} catch (e) {
  check('seed のアカウントで実ログインできる', false, String(e).split('\n')[0]);
}
check('seed のアカウントで実ログインできる', Boolean(session?.access_token), FIXTURE.staffEmail);

/* 3. マイグレーションと seed が当たっているか。

      **この検査は2度、間違った理由で緑になっていた。**
      1度目（`F-20260825-35`）: `apikey` だけで叩き「404 でなければ PASS」。
        PostgREST は JWT が無ければ 401 を返すので、**テーブルが1本も無くても PASS**。
      2度目（`F-20260828-50`）: 直して「200 かつ配列」にしたが、**空の配列も配列**。
        毒見（中身が空の土台）で `HTTP 200 / 0件` のまま PASS した。

      いまは **seed にしか無いもの**を名指しで引く（下）。 */
if (session?.access_token) {
  /* **`200 かつ配列` では足りなかった。空の配列も配列である。**
     毒見（`scripts/poison-run.mjs`・中身が空の土台）に掛けたところ、
     `HTTP 200 / 0件` で **PASS** した——**DB が丸ごと無くても緑になる**形だった。
     `F-20260825-35`（401 でも PASS）を直したときに「200 かつ配列」へ変えたが、
     **同じ嘘を別の形で言い続けていた**（`F-20260828-50`）。

     いまは **seed にしか無いもの**を名指しで引く。X は `supabase/seed.sql` が
     入れる犬で、**本物の土台にしか存在しない**。空の土台なら 0 件で落ちる。 */
  const res = await fetch(
    `${LOCAL_SUPABASE_URL}/rest/v1/pets?select=id&id=eq.${FIXTURE.petX}`,
    { headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${session.access_token}` } },
  );
  let body = null;
  try { body = await res.json(); } catch { /* JSON でないなら下で落ちる */ }
  const found = Array.isArray(body) && body.length === 1 && body[0]?.id === FIXTURE.petX;
  check('マイグレーションと seed が当たっている（seed の犬 X を id で引ける）',
    res.status === 200 && found,
    `HTTP ${res.status}${Array.isArray(body) ? ` / ${body.length}件` : ' / 配列ではない'}`);
} else {
  check('マイグレーションと seed が当たっている（seed の犬 X を id で引ける）', false, 'ログインできていないので確かめられない');
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

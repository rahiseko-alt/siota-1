/* 本番向けの `_headers` を作る（放置リスト #80・review R14）。
   `src/_headers` の CSP にはローカルの Supabase が入っている（ローカルの `wrangler dev` が
   同じ dist を使うため）。本番に出すときだけ、コメント以外の行からその1語を消す。
   `scripts/build-dist.mjs --production` が使い、`test/security-headers.test.mjs` が確かめる。 */
export const LOCAL_SUPABASE_ORIGIN = 'http://127.0.0.1:54321';

export function productionHeaders(text) {
  return text.split('\n').map((line) => (
    line.startsWith('#') ? line : line.split(` ${LOCAL_SUPABASE_ORIGIN}`).join('')
  )).join('\n');
}

export function hasLocalOrigin(text) {
  return text.split('\n').some((line) => !line.startsWith('#') && line.includes(LOCAL_SUPABASE_ORIGIN));
}

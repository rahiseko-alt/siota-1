-- 犬の「犬種」（クライアント指示 C-14・マスター指示 2026-11-19・plan.md `N-48`）。
--
-- なぜ要るか:
--   「レポートを作成する犬を選ぶ」の検索結果を「飼い主名・犬名・犬種」で出してほしい
--   （追加改善要望書③-②）。犬の登録情報に犬種が無く、出せなかった（`N-40`・`N-42`）。
--
-- 何を足したか（これだけ）:
--   1. `pets.breed`（空でもよい）。登録済みの犬は空のまま始まる。
--      入れ方は「候補から選べて、手でも打てる」（案C）なので、決まった一覧には縛らない。
--      長さだけを守る（空文字は入れさせない——空は null で表す）。
--   2. 変更の許可をこの列にだけ足す（`202608270009` で列を絞ってある。足し忘れると
--      RLS は通っても `permission denied for table pets` になる・`202608290010` と同じ）。
--   登録（INSERT）は列で絞っていないので、許可の追加は要らない。
--
-- 読み取りの範囲は変えていない。飼い主は自分の犬の行を `pets_customer_select` で
-- 既に読めるので、犬種も読める（飼い主の画面には出していない）。

alter table public.pets
  add column breed text
  check (breed is null or char_length(breed) between 1 and 60);

grant update (breed) on public.pets to authenticated;

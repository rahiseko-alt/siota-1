-- 「使用オプション」の復活（マスター指示・2026-08-31）。
-- 旧デザイン試作（design-samples/ponchi-v2.html、F1で削除済み）にあった
-- 「今月の使用オプション」トグルカードを、今の実データ構造で作り直す。
-- 選べる名前（アメージング・シセルリノ…）は店舗ごとに管理者が追加・編集する
-- （マスター確認済み）。カルテごとに選んだものは reports.data（jsonb）の
-- `options` キーに入るので、こちらに列は要らない。

-- CHECK 制約は式の中に直接サブクエリを書けない（`unnest`/`exists` は不可）ので、
-- 各要素の長さを見る部分だけ関数に切り出す。関数の中身は制約の対象外なので通る。
create or replace function private.grooming_option_names_ok(names text[])
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1 from unnest(names) as o(name)
    where char_length(o.name) = 0 or char_length(o.name) > 40
  );
$$;

-- CHECK 制約は書き込みを行うロール（`authenticated`）の権限で評価されるので、
-- `private` スキーマの既定（`revoke all … from public, anon, authenticated`・
-- `202607160001` 4行目）どおり明示的な GRANT が要る（他の `private.*` 関数と同じ形）。
grant execute on function private.grooming_option_names_ok(text[]) to authenticated;

alter table public.shops
  add column grooming_options text[] not null default array[
    'アメージング', 'シセルリノ', 'ジュエルT', 'ジュエルM',
    'NAMAKERA', 'キラトリ', 'グロスチャー', '皮膚spa', '被毛spa'
  ]
  check (
    array_length(grooming_options, 1) is null
    or array_length(grooming_options, 1) <= 30
  )
  check (private.grooming_option_names_ok(grooming_options));

-- 編集は店舗の管理者だけ（`202608290010` と同じ `shops_admin_update` を使い回す）。
-- 列を絞る（`202608270009` と同じ多層防御）。アプリが書くのはこの1列だけ
-- （`api-schemas.js` の `updateShopSchema`）。
grant update (grooming_options) on public.shops to authenticated;

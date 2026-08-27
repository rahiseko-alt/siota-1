-- 多層防御の隙間を2つ塞ぐ（納品前診断 #11 / #37・2026-08-27）
--
-- どちらも「RLS は効いているが、その内側で余計なことができる」型。越境ではないので
-- 緊急ではないが、渡したあとに効いてくる（`plan.md` 第7章の考え方）。
--
-- #11 owners / pets の update が全カラムに出ていた
--   `reports` は `grant update (data)` と絞ってあるのに、こちらは絞っていなかった。
--   スタッフが Supabase を直に叩けば、同じ店舗の中で `pets.owner_id` を別の飼い主へ
--   付け替えられる——**別の飼い主のカルテが、その犬に付いて見える**ことになる。
--   アプリが実際に書くのは名前・template・active だけ（`api-schemas.js` の
--   `updateOwnerSchema` / `updatePetSchema`）なので、そこまで絞る。
--
-- #37 reports.data に上限が無かった
--   Worker は本文 1MB / 5MB で 413 を返すが、直に叩かれるとその手前を通らない。
--   写真は `asset://` の参照で入るので実データは小さい。2MB は**事故の上限**であって
--   運用の上限ではない。

begin;

revoke update on public.owners from authenticated;
revoke update on public.pets from authenticated;

grant update (name, active) on public.owners to authenticated;
grant update (name, template, active) on public.pets to authenticated;

alter table public.reports
  add constraint reports_data_size_limit
  check (octet_length(data::text) <= 2000000);

commit;

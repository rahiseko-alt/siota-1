/*
 * 202607160006_rate_limit_batch_entry.sql
 *
 * まとめ入力が自店舗のレート制限に当たるのを直す（D-20260824-30 の 5）。
 *
 * `asset_metadata` は 60回/10分だった。1カルテのアセットは写真7枚＋犬体図など
 * Konva 4面で最大11件なので、**10分あたり5〜7カルテが上限**になる。1件ずつ
 * その場で書けば当たらないが、閉店後に10〜20件まとめて入力すると6件目前後で
 * 429 が返り、しかも失敗した試行もカウントを消費するので、待つ以外に手が無くなる。
 * トリマー自身の正当な作業が、自分の店の防御に止められている状態だった。
 *
 * 300回/10分へ上げる（約27カルテ相当）。上限を無くさないのは、これが
 * 「乗っ取られたスタッフ用アカウントが `report_assets` を書き続ける」ことへの
 * 歯止めでもあるため。範囲は変えずに、現場の使い方が収まる幅にだけ広げる。
 *
 * **本来の直し方はアセット登録をまとめて1リクエストにすること**（11回→1回）で、
 * そうすれば上限に触れなくなる。ただしそれは API 契約・store・`finalize_report` の
 * 孤児検出ガードまで巻き込むので、実店舗を止めている今はこちらを先に出す。
 *
 * 関数まるごとの `create or replace`。上限表は関数の中に literal で持っているので、
 * 1行だけ差し替える手段が無い（表に切り出すと RLS の面倒が増えるため今回は追わない）。
 */

create or replace function public.consume_rate_limit(target_scope text, ip_hash text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  request_limit integer;
  window_seconds integer;
  user_count integer;
  ip_count integer;
  now_value timestamptz := clock_timestamp();
begin
  if actor is null then return false; end if;
  select limits.request_limit, limits.window_seconds
  into request_limit, window_seconds
  from (values
    ('invitation_claim', 10, 600),
    ('invitation_create', 20, 3600),
    ('report_write', 120, 600),
    ('asset_metadata', 300, 600),
    ('search', 120, 60)
  ) as limits(scope, request_limit, window_seconds)
  where limits.scope = target_scope;
  if not found then return false; end if;

  /* 別名を `window` にすると PostgreSQL の予約語（WINDOW 句）と衝突して
     `syntax error at or near "window"` で落ちる。別名は非予約語にする。 */
  insert into private.rate_limit_windows as limit_window (scope, key_hash, window_started, request_count)
  values (target_scope, encode(extensions.digest(actor::text, 'sha256'), 'hex'), now_value, 1)
  on conflict (scope, key_hash) do update set
    request_count = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then 1
      else limit_window.request_count + 1
    end,
    window_started = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then now_value
      else limit_window.window_started
    end
  returning request_count into user_count;

  if user_count > request_limit then return false; end if;
  if ip_hash is null or ip_hash !~ '^[0-9a-f]{64}$' then return true; end if;

  insert into private.rate_limit_windows as limit_window (scope, key_hash, window_started, request_count)
  values (target_scope || ':ip', ip_hash, now_value, 1)
  on conflict (scope, key_hash) do update set
    request_count = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then 1
      else limit_window.request_count + 1
    end,
    window_started = case
      when limit_window.window_started + make_interval(secs => window_seconds) <= now_value then now_value
      else limit_window.window_started
    end
  returning request_count into ip_count;
  return ip_count <= request_limit * 2;
end;
$$;


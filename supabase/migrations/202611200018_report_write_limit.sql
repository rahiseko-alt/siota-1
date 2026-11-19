/*
 * 202611200018_report_write_limit.sql
 *
 * 下書きの自動保存が、自分の回数制限で確定を止めていたのを直す
 * （基準に照らしたレビュー 2026-11-20・`docs/ops/review-2026-11-20.md` H3・CWE-770・API4:2023）。
 *
 * `report_write` は 120回/10分だった。作業画面は触るたびに1秒まとめて下書きを保存する
 * （`src/js/ui.js` の `watchDraft`）ので、5秒に1回触るペースで10分作業すると上限に届き、
 * そのあとの**確定も 429・600秒待て**になる（ローカルで実測: 117回目で 429）。
 *
 * 600回/10分（＝1秒に1回）へ上げる。自動保存は1人あたり1秒に1回より多くは送らないので、
 * ふつうの作業では届かない。上限を無くさないのは、乗っ取られたアカウントが書き続けることへの
 * 歯止めでもあるため（`202607160006` と同じ考え方）。他の上限は変えない。
 *
 * 関数まるごとの `create or replace`（上限表が関数の中の literal なので）。本体は
 * `202607160006` と1字違い（report_write の 120 → 600）。
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
    ('report_write', 600, 600),
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


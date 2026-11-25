/*
 * 202611250023_revise_report_limit.sql
 *
 * 確定済みカルテの「修正」を、データベースの側でも回数で止め、残す記録の数に上限をつける
 * （基準に照らしたレビュー 2026-11-25・`docs/ops/review-2026-11-25.md` R1・CWE-770・API4:2023）。
 *
 * ── 何が起きていたか ──
 *   回数制限は Worker（`/api/.../revise` の `report_write`）にしか無かった。スタッフの通行証で
 *   `rest/v1/rpc/revise_report` を**直接**呼ぶと Worker を通らないので、何回でも通る。
 *   しかも1回ごとに直す前の中身がまるごと `report_revisions` に1行増える（`202611200021`）。
 *   手元で実測: 30回 → 30回とも成功、`report_revisions` が 24kB → 20MB。
 *   データベースの容量が埋まると、店全体が止まる。
 *
 * ── どう止めるか（2つ）──
 *   1. **回数**: `revise_report` の中で `public.consume_rate_limit('report_revise')` を呼ぶ。
 *      Worker を通っても通らなくても、同じ関所を通る。
 *      上限は **1人あたり 30回／1時間**（新しい区分 `report_revise`）。
 *      - `report_write`（600回／10分）を使い回さないのは、あれが**下書きの自動保存**のための
 *        数で（`202611200018`）、修正にそのまま当てると10分で600版（最大 1.2GB）まで積める上に、
 *        Worker 経由の修正が1回で2つ数えられ、自動保存の枠を食うため。
 *      - 修正は管理画面から人が1枚ずつ開いて直す手作業。1時間に30回＝2分に1回を1時間続ける
 *        ペースで、ふつうの作業では届かない。届いたら1時間待てば戻る。
 *      - 断るときは SQLSTATE `PT429`・message `rate limited`。PostgREST は `PT` で始まる番号を
 *        HTTP の状態コードとして返す（`PT429` → 429）。Worker は上流の 429 をそのまま
 *        `429 too many requests` に写す（`worker/src/index.js` の `supabaseError`）ので、
 *        画面には他の回数制限と同じ「待て」が届く。`P0001` にすると PostgREST は 400 を返し、
 *        Worker では `502 data request failed`（壊れた）に化けるので使わない。
 *      - 断ったときは同じ取引の中で数えた1回も取り消されるが、数は上限ちょうどで止まったまま
 *        なので、窓（1時間）が過ぎるまで断り続ける。
 *   2. **記録の上限**: 1枚のカルテにつき、新しい順に **20版** だけ残し、それより古い版は
 *      同じ関数の中で消す。
 *      - 1枚の中身は最大 2MB（`202608270009`）なので、1枚あたり最大 40MB で止まる。
 *      - 20版あれば「いつ・誰が・何を消したか」を管理者が辿って戻すには足りる
 *        （修正が1枚で20回を超えるのは、ふつうの使い方ではない）。
 *      - 並びは `revised_at`。同じ取引の中で何度も直しても順が決まるよう、記録の時刻は
 *        `now()`（取引の開始時刻）ではなく `clock_timestamp()` で入れる。
 *
 * ── 変えていないもの ──
 *   引数・戻り値・権限・3つの整合性チェック・監査ログは `202611200021` のまま。
 *   身元は `202611210022` の決まりどおり `private.live_uid()` から読む（前は `auth.uid()` だった）。
 *   `consume_rate_limit` は `202611210022` の定義に `report_revise` の1行を足しただけ。
 *
 * ── 塞がらないもの（正直に書く）──
 *   カルテの枚数ぶんは積める（1人1時間 30版 × 最大 2MB = 60MB まで）。1枚あたりの上限と
 *   回数の上限で「速さ」と「1枚の大きさ」は止まるが、店全体の総量の上限ではない。
 */

begin;

-- public.consume_rate_limit（現行の定義は 202611210022_session_liveness.sql）。`report_revise` を足すだけ。
create or replace function public.consume_rate_limit(target_scope text, ip_hash text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select private.live_uid());
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
    ('report_revise', 30, 3600),
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

-- public.revise_report（現行の定義は 202611200021_report_revisions.sql）
create or replace function public.revise_report(target_report uuid, new_data jsonb)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select private.live_uid());
  target public.reports%rowtype;
  revised public.reports%rowtype;
  report_prefix text;
begin
  if new_data is null then
    raise exception using errcode = '22023', message = 'new_data required';
  end if;

  select report.* into target
  from public.reports report
  where report.id = target_report
    and report.status = 'final'
    and private.is_shop_staff(report.shop_id)
  for update;

  /* 見つからない理由は3つ（存在しない／final でない／その店舗のスタッフでない）。
     どれかを言い分けると、他店舗のカルテの存在を教えてしまう。まとめて弾く。 */
  if not found or actor is null then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  /* R1: 回数の関所。Worker を通らない直接の呼び出しもここで止まる。
     見つからないカルテ（上）では数えない——他店舗のカルテを指して数を減らされないように。 */
  if not public.consume_rate_limit('report_revise', null) then
    raise exception using errcode = 'PT429', message = 'rate limited';
  end if;

  /* ここから3つは `finalize_report` と同じ整合性チェック。写真の貼り替えを
     許した以上、直しでも「参照した実体が本当にあるか」を見ないと、
     壊れた参照のまま確定済みデータを上書きできてしまう。 */
  report_prefix := target.shop_id::text || '/' || target.pet_id::text || '/' || target.id::text || '/';
  if new_data::text ~* 'data:image/' then return null; end if;
  if exists (
    select 1
    from regexp_matches(
      new_data::text,
      'asset://([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      'gi'
    ) as found(marker)
    where not exists (
      select 1 from public.report_assets asset
      where asset.report_id = target.id and asset.id = ((found.marker)[1])::uuid
    )
  ) then return null; end if;
  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'report-assets'
      and object.name like report_prefix || '%'
      and not exists (
        select 1 from public.report_assets asset
        where asset.report_id = target.id and asset.storage_path = object.name
      )
  ) then return null; end if;

  /* `#77`: 差し替える直前の中身を残す。ここより上の `return null` では書かない
     （直していないのに版が増えない）。下の update が例外で落ちれば、この行も取り消される。 */
  insert into public.report_revisions (shop_id, report_id, previous_data, revised_by, revised_at)
  values (target.shop_id, target.id, target.data, actor, clock_timestamp());

  /* R1: 1枚のカルテにつき新しい順に 20版だけ残す（数の根拠はファイル冒頭）。 */
  delete from public.report_revisions old_revision
  where old_revision.report_id = target.id
    and old_revision.id not in (
      select kept.id
      from public.report_revisions kept
      where kept.report_id = target.id
      order by kept.revised_at desc, kept.id desc
      limit 20
    );

  update public.reports report
  set data = new_data, updated_at = now()
  where report.id = target.id and report.status = 'final'
  returning report.* into revised;
  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (revised.shop_id, actor, 'report.revised', 'report', revised.id);
  return revised;
end;
$$;

commit;

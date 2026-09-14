/* 新しい初回登録QRを出したら、前のQRを使えなくする
   （マスター指示 2026-09-13「直せるものを先に治せ」・放置リスト `#61`）。

   同じ犬に何回でもQRを出せて、**出したものが全部有効なまま**だった
   （実測: 連続10回発行して10個とも別々の有効なトークン）。
   シナリオ台帳 `SD-43` の「いまの守り＝回数制限あり」は読み違いで、
   `invitation_create` の 20回/時 は**別の目的**（機械的な連打よけ）であって、
   業務上の上限ではない。犬や飼い主の単位では1件も数えていない。

   **なぜ「回数で止める」にしないか**: 刷り直しは正当な操作で、
   渡しそこねた・別の人に渡してしまった、が理由になる。止めると先へ進めなくなる。
   そして**古いQRが生きているほうが危ない**——誤送信や転送で第三者が先に開く
   （`backend/js/supabase-staff.js` の説明文が既にその危険を書いている）。

   **やることは1つだけ**: 新しく入れる直前に、同じ宛先の
   「まだ使われていない招待」を取り消す。取り消し方は `revoke_invitation` の
   1文とまったく同じ（`claimed_at is null` のものだけに `revoked_at` を入れる）。
   **使用済みの招待は触らない**——後から無効化はできないし、する意味も無い。

   **いちばん危ない1行**: 宛先の一致を `owner_id is not distinct from target_owner`
   で見ること。`=` だと `null`（スタッフ用の招待）が一致せず、逆に条件を落とすと
   **スタッフ用の招待まで巻き込んで全部潰す**。

   既存の migration は書き換えない（適用済みの歴史を直すと本番と手元が食い違う）。 */

begin;

create or replace function public.create_invitation(
  target_shop uuid,
  target_type text,
  target_owner uuid default null
)
returns table (invitation_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  token text;
  created_invitation public.invitations%rowtype;
begin
  if actor is null or not private.is_shop_staff(target_shop) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if target_type not in ('owner', 'staff') then
    raise exception using errcode = '22023', message = 'invalid invitation type';
  end if;
  if target_type = 'owner' and not exists (
    select 1 from public.owners owner
    where owner.id = target_owner and owner.shop_id = target_shop and owner.active
  ) then
    raise exception using errcode = 'P0002', message = 'target unavailable';
  end if;

  /* **前のQRを、ここで使えなくする**（`#61`）。同じ店・同じ種類・同じ宛先の、
     まだ使われていない招待だけ。`is not distinct from` で `null`（スタッフ用）も
     正しく突き合わせる。 */
  update public.invitations
  set revoked_at = now()
  where shop_id = target_shop
    and invitation_type = target_type
    and owner_id is not distinct from target_owner
    and claimed_at is null
    and revoked_at is null;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (
    shop_id, invitation_type, owner_id, token_hash, expires_at, created_by
  ) values (
    target_shop, target_type, target_owner,
    encode(extensions.digest(token, 'sha256'), 'hex'),
    now() + interval '24 hours', actor
  ) returning * into created_invitation;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (target_shop, actor, 'invitation.created', 'invitation', created_invitation.id);

  return query select created_invitation.id, token, created_invitation.expires_at;
end;
$$;

commit;

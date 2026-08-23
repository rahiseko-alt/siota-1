# Decision Log (docs/decisions.md)

> **運用ルール**
> - マスターへの確認事項・その回答・私（Claude）が代わりに判断した事項を、**その場で流さず**ここに記録する。
> - セッションを跨いでも残る。`docs/handoff.md` から必ずここへ辿れるようにする。
> - Append-Only。過去の決定は削除・上書きせず、覆す場合は新しい行を足して「Supersedes #N」と書く。
> - この台帳が作られる前（〜2026-08-22）の決定は `docs/handoff.md` の本文と履歴コミットに散っている。遡及記録はしない。

---

## 記録フォーマット

```markdown
### [D-YYYYMMDD-NN] タイトル

- **Date**: YYYY-MM-DD
- **Kind**: master-decision（マスターが決めた） / claude-judgment（私が代わりに判断した） / open（未決）
- **Question**: 何を確認したか / 何を判断したか
- **Answer**: マスターの回答、または私の判断とその理由
- **Impact**: これが決まらないと何が止まるか（open の場合）／何が変わったか（決定済みの場合）
```

---

## 決定事項・未決事項一覧

### [D-20260823-01] 完成の定義

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: 「完成」をどこまでと定義するか
- **Answer**: 実店舗で使える状態。トリマーが実際に犬のカルテを書き、飼い主がスマホで読める。意匠は当面 V1 のままでよい
- **Impact**: `docs/ops/plans/2026-08-23-completion.md` の全体受け入れ条件を規定する

### [D-20260823-02] 現行本番の扱い

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: 現行の本番（`trimmer-system.kouheikosehira.com`・KVモード）はどうするか
- **Answer**: Supabase 版へ切り替える。「そのために今までの作業がある」との指摘
- **Impact**: F6（独自ドメイン切替）が計画のゴールに含まれる

### [D-20260823-03] 実データの投入時期

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: 実際の顧客データはいつ入れるか
- **Answer**: 実顧客データは過去に一度も入れたことがなく、KV に入っているものも全てダミー。新たにダミーデータを入れて検証する
- **Impact**: F1 でダミーデータを投入して検証する。KV → Supabase のデータ移行は不要（既に `docs/design.md` にも「移行しない」の記載あり、今回の回答で再確認）

### [D-20260823-04] 業務動線

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: クライアントに渡す操作フローは何か
- **Answer**: URL を開く → 作成済みアカウントでログイン → 犬の名前を選ぶ → カルテ作成 → 確認 → 顧客ページ。この動線は `design/mock-4step.html` に既に実装されている「正」の UI であり、それに従う
- **Impact**: F2〜F4 の骨格を規定。V1 の「飼い主ページ→ワンちゃんページ→肉球画面」は動線に無い層として撤去対象になる

### [D-20260823-05] QR発行・スタッフ管理機能の要否

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: `/edit` 画面にある QR発行・スタッフ管理（V1 既存機能、今回新規に作ったものではない）は残すか
- **Answer**: とりあえず残す
- **Impact**: F2 以降の画面骨格作業でこの2機能を削除しない

### [D-20260823-06] 飼い主側検証用アカウント

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: 飼い主側の動作確認に使う Google アカウントは何か
- **Answer**: 管理者アカウント（`rahiseko@gmail.com`）を飼い主としても紐付ける
- **Impact**: F1 でこのアカウントを owner としても登録する

### [D-20260823-07] Google OAuth の公開範囲

- **Date**: 2026-08-23
- **Kind**: master-decision
- **Question**: Google ログインの同意画面をテストモードのままにするか、本番公開にするか
- **Answer**: 今、本番公開にする
- **Impact**: F6 の受け入れ条件に、同意画面が本番公開であることを含める

### [D-20260823-08] 切替のタイミング（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: 独自ドメインを Supabase 版へ向けるタイミングをいつにするか
- **Answer**: 業務が①〜⑥まで一周し、検証（F5）が通ってから切り替える。未完成の状態を本番ドメインに出す理由がなく、`workers.dev` で失敗しても現行本番に影響しない
- **Impact**: F1〜F5 は `workers.dev` 上で行い、F6 でのみ独自ドメインに触れる。異議があれば覆す

### [D-20260823-09] 旧 KV 版 Worker の扱い（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: 独自ドメイン切替後、現行の KV 版 Worker（`saltydog-report-worker`）はどうするか
- **Answer**: 削除せず残す。`routes` だけを外して独自ドメインから切り離す。既存データは D-20260823-03 の通り全てダミーで失うものはないが、切り戻せる状態をすぐには捨てない
- **Impact**: F6 で `worker/wrangler.toml` の `routes` を除去するのみ。`wrangler delete` は行わない

---

## 未決事項（マスター判断待ち）

### [D-20260823-U1] 素材20件のうち出所不明15件

- **Date**: 2026-08-21（`docs/ASSET-PROVENANCE.md` 初出）/ 2026-08-23（本台帳へ転記）
- **Kind**: open
- **Question**: `docs/ASSET-PROVENANCE.md` の `UNVERIFIED` 15件（うち実写に見える4件が優先）の出所は何か。第三者の犬の写真であれば、その飼い主の同意が要る
- **Impact**: コードでは解けない。放置すると、飼い主に配るページに出所不明の写真を配り続けることになる

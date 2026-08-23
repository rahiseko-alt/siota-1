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

### [D-20260823-10] 「他人の犬が見えない」検証には別アカウントが要る（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: `rahiseko@gmail.com` は店舗管理者でもあるため、`pets_staff_all` ポリシー（`supabase/migrations/202607160001_supabase_base.sql:658`）により店舗の全ペットが見える。「他人の犬が見えないこと」（全体受け入れ条件3）はこのアカウントでは検証できない
- **Answer**: F5 で、スタッフ権限を持たない純粋な飼い主アカウント（例: ダミー飼い主B、または新規のテストアカウント）を使って検証する。D-20260823-06 の決定（管理者を飼い主にも紐付ける）は⑥の画面到達確認用であり、RLS の実証には使えないと整理した
- **Impact**: F5 の受け入れ条件に、別アカウントでの確認を明記済み

### [D-20260823-11] F2 で section id の list/edit/view 改名を見送った（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: F2 の計画には「`screen-owner`/`screen-paw`/`screen-archive`/`screen-report` を `list`/`edit`/`view` へ改名する」と書いていた。実施すべきか
- **Answer**: 見送った。この3 id は KV モードと Supabase モードで共有されており、改名は両モードの全参照箇所（表示分岐・CSS・E2E テスト）を巻き込む大きな作業になる。今回必要だったのは「飼い主を選ぶ層を消す」と「肉球画面を消す」であり、id 改名はそのどちらにも必須ではなかった。既存 id を維持したまま `screen-owner` の中身の出し分けだけを変えて目的を達成した
- **Impact**: `screen-owner`/`screen-archive`/`screen-report` の id はそのまま。改名が要る場面が今後出てくれば、その時点で個別に判断する

### [D-20260823-12] マガジン意匠は静的HTML二重化ではなく共有JSテンプレートにした（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: 計画（`docs/ops/plans/2026-08-23-completion.md` F4）は「`grep -c 'data-view=' src/design-samples/ponchi-v2.html` が20以上」を機械チェックとして書いていた。この通りに、マガジンの静的HTMLを `ponchi-v2.html`（トリマー確認画面）と `src/my.html`（飼い主画面）の両方に複製すべきか
- **Answer**: しなかった。`data-view` 付きマークアップは `src/js/magazine-view.js` 内の1つのテンプレート文字列にだけ存在し、`renderMagazine()` が両画面の描画先へ同一内容を注入する。理由: 2ファイルに同じマークアップを手で複製すると、どちらかを直したときにもう一方だけ古いまま残る「ズレ」を生む。これはまさに今セッションで直してきたバグ（F-20260821-22/23・F-20260823-26/27）と同じ種類の再発条件であり、避けるべきだと判断した。マスター指定の「⑤と⑥は同一のレンダラを共有する」を、DOM構造だけでなく1本の関数・1本のテンプレートとして文字通り実装した形になる
- **Impact**: 計画の機械チェックを、静的 grep から実行時 DOM チェックへ差し替えた。ローカルの Playwright 単体検証（`renderMagazine()` を合成データで描画）で `[data-view]` 要素35件・`[data-field]` 要素0件を確認済み（本文参照）。CSS も同じ理由で `magazine-view.js` 内の `injectStyle()` が1本だけ持つ

### [D-20260823-13] マガジンにモックの創作文・架空データは載せない（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: `design/mock-4step.html` の `#screen-4` には「血管の直前で安全に丸く整えています」「次回のおすすめご来店時期は約3〜4週間後」等、意匠モックとして書かれた固定の解説文・提案文がある。これを飼い主に見せるカルテにもそのまま載せるか
- **Answer**: 載せない。これらはカルテのデータモデル（`extractReport()` の14キー＋B固有3キー）のどこにも対応するフィールドが無く、載せれば「トリマーが書いていないことをトリマーの言葉として飼い主に見せる」ことになる。これは `publish-client-ponchi.js` の `setField('staff-note', ...)` のコメントが名指しで警告している失敗パターン（既定文がそのまま飼い主に届く）そのものであり、D-20260821-15/22（架空データを見せない）と同型。次回来店提案（`magazine-revisit-box`）は丸ごと省いた。トリマーバッジの担当者名・アイコンも、カルテ単位で担当者を記録するフィールドが無いため省いた
- **Impact**: `renderMagazine()` は実際に記入された値だけを出す。皮膚・耳・爪・歯のカードは、記入があればその値を、無ければ「記録がありません」という中立な定型文（`verify:empty` が既に許容している「まだカルテがありません」と同種の空状態文言であり、個体ごとの架空事実ではない）を出す

### [D-20260823-14] Google Fonts の CDN 読込は追加しない（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: モックは `fonts.googleapis.com` から Noto Sans JP / Noto Serif JP / Shippori Mincho / Inter を読み込む。マガジン画面にも同じ CDN 読込を足すか
- **Answer**: 足さない。`docs/handoff.md` に記録済みの通り「アプリは外部へ一切通信しない」（`verify:m6` で外部リクエスト0件を確認済み）という既存の不変条件を壊すことになる。調べたところ `src/my.html` は既に同じ役割のトークン名（`--font-serif`/`--font-en`/`--font-sans` 等）をローカル同梱フォント（`/assets/fonts/fonts.css`）で解決する形で先行実装済みだった（P8-a 由来）。マガジンのCSSトークンもこれに合わせ、`my.html` の既存 `:root` と同一の値を使う
- **Impact**: `src/js/magazine-view.js` の `injectStyle()` はフォントCDNを読み込まない。`ponchi-v2.html`・`my.html` とも既存の `fonts.css` 読込だけで完結する

### [D-20260823-15] トリマー確認画面（⑤）は Supabase モードのみマガジン化した（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: `ponchi-app.js` の `showPreview()`（作成フロー Step 6・公開直前プレビュー）は KV モードと Supabase モードの両方が通る共通コードだった。マガジン化はどちらに適用するか
- **Answer**: Supabase モードだけ。`isSupabaseMode()` で分岐し、KV モード（現行本番 `wrangler.toml` が指すコード）は `showLegacyPreview()` として一字一句変更せず残した。現行本番の見た目・挙動を変えない、というこのセッション全体の制約（`worker/wrangler.toml` は触らない）に合わせた
- **Impact**: `#screen-magazine` という新しい画面IDを追加し、`PonchiApp` の `hideAll()` にも加えた。公開成功後の通知の差し込み先も、Supabase モードだけ `#screen-magazine` に向けた（`#screen-report` は非表示のままだと通知が届かないため）

### [D-20260823-16] 体重グラフ・タイムラインは実データのみで作り直した（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: モックの体重グラフは固定の見本カーブ、タイムラインは `alert()` で日付を切り替える見せかけの5件固定チップだった。実装でもこの通りにするか
- **Answer**: しない。体重グラフは実際の `weights[]`（来店ごとの年月・kg）から比例計算した折れ線 SVG を描く。タイムラインは、その犬の実際の他レポート（`report_date` が `final` のもの、RLS が自動的に絞る）へのリンクにし、クリックで実際にそのレポートへ遷移する。記録0件のときはグラフ・タイムラインとも該当ブロックを隠す
- **Impact**: `src/js/magazine-view.js` の `renderWeightGraph()` / `renderTimeline()`。飼い主側の呼び出しは `/api/my/pets/{petId}` から `pet.reports` を取得してタイムラインに渡す（`src/js/supabase-auth.js`）。トリマーの公開前プレビュー（レポートID未確定）はタイムラインを出さない

### [D-20260823-17] F4 は実機（実Worker・実Supabase往復）で未検証（私の判断・要マスター対応）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: F1〜F3 と同様、F4 も実ブラウザ・実DBで確認すべきだが、このセッション（新しいコンテナ）には `CLOUDFLARE_API_TOKEN` も Supabase の service role key（magiclink 発行に必要）も残っていない。どう進めるか
- **Answer**: `wrangler dev`（ローカル実行・Cloudflareアカウント不要）が使えることは確認した。ただし認証済みセッションを自動化で作る手段（F1〜F3で使った admin `generate_link`）が service role key 無しには使えないため、実ログイン→実カルテ作成→公開→飼い主画面という一気通貫の検証はこのセッションでは実施できなかった。代わりに、`renderMagazine()` を対象にした実ブラウザ（Playwright/chromium）でのDOM単体検証を作り、27項目全て確認した：13項目相当の実データ描画、記入なし項目の非表示（架空データを出さない）、`data-view`35件/`data-field`0件、アコーディオン開閉・クイックジャンプ・ライトボックス・タイムラインリンク・戻るボタンの実動作、`<script>`注入が実行されないこと（XSS安全性）、コンソールエラー0件。`npm run build`/`check`/`test` は全て EXIT 0（67件、既存分に regression なし）
- **Impact**: 「動く」と断定できるのは `renderMagazine()` 単体のみ。`ponchi-v2.html`（トリマー確認）・`my.html`（飼い主閲覧）への実際の組み込み、実 Supabase 往復、署名付きURLでの写真表示は**未確認**のまま。マスターが `CLOUDFLARE_API_TOKEN` と Supabase service role key（またはテスト用の実ログイン手段）を渡せば、次のセッションで F1〜F3 と同じ実機検証を仕上げる

### [D-20260823-18] F4 の実機検証は「ローカル Supabase」で完了した（私の判断）

- **Date**: 2026-08-23
- **Kind**: claude-judgment
- **Question**: D-20260823-17 で「実ログイン手段（service role key）が無く実機検証できない」と記録したが、他に手段はないか
- **Answer**: あった。`supabase/seed.sql` に、まさにこの用途のために先行実装済みのローカル専用テストアカウント（`staff@local.test` / `owner-a@local.test` / `owner-b@local.test` など、password login）が既にあった。`docker` と `supabase` CLI がこの環境で使えたので `supabase start` でローカルに実 Postgres・実 Auth（GoTrue）・実 PostgREST・実 Storage を一式起動し（`supabase/config.toml` に `[edge_runtime] enabled=false` を追加——使わない上にこのサンドボックスでは rlimit 権限エラーで起動できなかったため）、`worker/wrangler.local.toml`（新規・ローカル専用・秘密情報なし）でそのローカル Supabase を指す `wrangler dev` を立てて検証した。password grant でアクセストークンを取得し、`window.TrimmerAuth.setSession()`（`supabase-auth.js`/`supabase-staff.js` が既に公開している口）へ注入する形でログインを自動化した。ホスト済み Supabase プロジェクトの service role key も、Cloudflare へのデプロイも一切使っていない
- **Impact**: F4 の受け入れ条件（記入→確定→飼い主画面の値の一致・写真の署名付きURL経由表示・他人の犬が見えないこと）を、Playwright（chromium）で実際に **19/19 PASS** で確認した。詳細は本文および `docs/ops/plans/2026-08-23-completion.md` の F4 セクション参照。D-20260823-17 の「未確認」は解消。D-20260823-U2 は「ローカル検証は解決・ホスト済みプロジェクトへの実デプロイ確認だけがまだ」に格下げする（下記 D-20260823-U2 更新参照）。この手段は F5（`verify:*` の作り直し）でも同じ土台を使い回せる

---

## 未決事項（マスター判断待ち）

### [D-20260823-U1] 素材20件のうち出所不明15件

- **Date**: 2026-08-21（`docs/ASSET-PROVENANCE.md` 初出）/ 2026-08-23（本台帳へ転記）
- **Kind**: open
- **Question**: `docs/ASSET-PROVENANCE.md` の `UNVERIFIED` 15件（うち実写に見える4件が優先）の出所は何か。第三者の犬の写真であれば、その飼い主の同意が要る
- **Impact**: コードでは解けない。放置すると、飼い主に配るページに出所不明の写真を配り続けることになる

### [D-20260823-U2]（解決・格下げ）ホスト済み Supabase プロジェクトへの実デプロイ確認だけが残っている

- **Date**: 2026-08-23（起票）/ 2026-08-23（ローカル検証で大部分解決・D-20260823-18）
- **Kind**: open
- **Question**: F1〜F3 で使っていた `CLOUDFLARE_API_TOKEN` と、ホスト済み Supabase プロジェクトの service role key は、このコンテナに引き継がれていなかった。ローカル Supabase（D-20260823-18）で機能面の実機検証は完了したが、`shiota0823.rahiseko.workers.dev`（ホスト済みプロジェクト・実際の master 確認用URL）へ F4 のコードがデプロイされ、同様に動くことはまだ確認していない
- **Impact**: 機能そのものが動くことはローカルで実証済み（19/19 PASS）なので、リスクは低いと判断している。ただし `shiota0823.rahiseko.workers.dev` は F1〜F3 の時点のコードのままで、F4 は未反映。マスターが `CLOUDFLARE_API_TOKEN` を渡せば次のセッションでデプロイし、ホスト済みプロジェクトでも同じ検証を通す

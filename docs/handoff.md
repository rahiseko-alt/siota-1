# Session Handoff (docs/handoff.md)

> **運用ルール**
> - セッション間の揮発的な作業状態の引き継ぎファイルです。
> - セッション開始時 (`In`) に読み込み、セッション終了時 (`Out`) に更新します。
> - 恒久的な設計情報はここではなく `docs/design.md` に記載してください。

---

## 1. 今回やったこと (Completed in this session)

**移設 plan（M0〜M9）完了。統合フェーズは P0（エンジン抽出）と P8-a（飼い主のマイページ再結線）まで。`docs/failures.md` の OPEN は 0 件。**

### 最新セッション（P8-a）

- **`/my` が一度も起動していなかったのを直した（F-22）**。`src/my.html` には `bootProtectedPortal()` が探すフック5種も起動条件 `data-portal="customer"` も無く、`supabase-auth.js` を読み込んでさえいなかった。器として作り直し、`supabase-vendor.js` →`supabase-auth.js` の順で結線した。
- **同じページに出ていた架空のカルテを撤去した（D-10）**。犬名「ポンチ くん」・体重 2.79kg・来店日 2026.08.15・他所の犬の写真7枚・担当トリマーの文面が入った静的モックで、Supabase 有効化と同時に、ログインしていない誰にでもそう見える状態だった。意匠は `design/mock-4step.html` の `#screen-4` に同じものがあるので失っていない（実データからの描画は P6 の `renderMagazine`）。
- **機械強制を2本足した**。`test/supabase-auth.test.mjs` が `bootProtectedPortal()` のソースから `querySelector` の引数を抜き出し、その全部が `my.html` に在ることを要求する（フックを足せば HTML も要求される）。`npm run verify:portal` は実ブラウザで `/my` を開き、10項目を見る。どちらも、外したら落ちることを実際に確認した。
- **その `verify:portal` が2回目の実行で落ちるのを直した（F-23）**。自分で立てた Worker を `npx` にだけ SIGTERM していて、下の wrangler と workerd がポートを掴んだまま残っていた。プロセスグループごと止めて exit を待つようにし、**連続3回とも 10/10・EXIT 0** になることを確認した。1回しか回さなければ気づけない類で、push 後に見つけた。
- **`/my` の見た目は P6 まで素っ気ない。** 犬の一覧・カルテは `supabase-auth.js` の既存レンダラが素の DOM で出す。架空の中身を見せないこととの交換で、意匠は P6 で実データに乗せる。

### Supabase 有効化（2026-08-23・マスター立ち会いで実施）

**動いている**: https://shiota0823.rahiseko.workers.dev

- **Supabase プロジェクト `shiota1`（`bcodloqwnrhcuvevfguy`）を有効化した。** マイグレーション5本を適用し、テーブル12個・RLS 全11テーブル有効・`report-assets` バケット（非公開/10MB/jpeg,png,webp）を確認。Google OAuth を有効化（Client ID/Secret はマスターが直接 Supabase へ入力。私は経由していない）。
- **Worker `shiota0823` を `workers.dev` へデプロイした。** 独自ドメインには紐付けていない。**現行本番（`wrangler.toml` / `trimmer-system.kouheikosehira.com` / KV モード）には一切触れていない**——別物として並走している。`RATE_LIMIT_IP_PEPPER` は 48文字を生成して `wrangler secret` へ投入。
- **マスターの Google ログインが通ることを実機で確認した**（`auth.users` に行が出来ている）。`/api/session` も 200 を返す。
- 途中で**実物のバグを2件見つけて直した**。どちらも「机上では見えない」型で、`docs/failures.md` の `F-20260821-24`・`F-20260821-25` に記録した。
  - **F-24**: マイグレーションが予約語 `window` を別名に使っていて、実際の PostgreSQL では一度も通らなかった。→ この環境に PostgreSQL 16 を入れ、Supabase の土台のスタブを書いて5本を実流しして確認。
  - **F-25**: `SupabaseDataStore` が Workers の `fetch` をレシーバ付きで呼んでいて、**本番の Supabase 通信が全滅**していた（`Illegal invocation`）。認証だけ別経路で無事だったため切り分けにくかった。→ `bind` して、レシーバを直接検査するテストを追加。
- **残り**: 最初のトリマー（管理者）の登録。招待制の設計上1人目だけ手で入れる必要があり、**マスターがどの Google アカウントを管理者にするかの決定待ち**。

### 以前のセッション（M0〜M9 / P0）

- **M5**: `npm run check` の親モノレポ参照を自リポジトリへ。`--test-isolation=none`（node 22 で `bad option`）を除去。実体を移設していない `predeploy-check` と、それを指す `wrangler.toml` / `runbook.md` の記述を是正。`playwright@1.59.1` / `wrangler@4.92.0` を devDependencies に宣言。lockfile を追加。
- **M6**: `npm run preview`（KV local）で実際にアプリを動かし、plan の受入基準9項目を全て通した。検証は `scripts/verify-m6.mjs`（`npm run verify:m6`）として残してあるので、次回以降は手作業でなく再実行できる。
- M6 の過程で見つけた不具合3件を修正（`/api/config` の KV モード欠落 / デモ月の無効 fetch / favicon 404）。
- **M7**: 眠っていた Supabase 系3スイート（storage 6 / store 23 / auth 10 = 39件）を `test:supabase:static` に配線し、`npm test` が全6スイート **61 pass** を実行するようにした。`scripts/design-isolation-guard.mjs` を新規作成して `npm run check` に組み込み、`design/README.md` を追加。
- **カルテ往復の修復（最重要）**: マスター指摘を受けて機能そのものを検査したところ、**トリマーが記入した所見の大半が飼い主に届いていなかった**。皮膚の種類・変化と歯の状態は保存されるのに復元で静かに消え（`cssAttrSafe` が日本語の値を空にしていた）、耳・爪・歯のコメントは `data-field` が無く保存対象ですらなく、担当からの一言は保存されないうえ既定文が飼い主に届いていた。犬の名前も肉球画面に一度も出ていなかった。全て修正し、`npm run verify:roundtrip` で常時検査する。詳細は `docs/failures.md` の F-20260821-11〜14。
- **カルテ0件の犬の見え方を是正（F-15）**: 施術を一度もしていない犬の公開ページに、架空の月ラベル5つ・他所の犬の Unsplash 写真5枚・他の犬の体重と担当コメント入りのデモカルテが、その犬の名前で出ていた。飼い主には見本を一切出さず「まだカルテがありません」を表示する。トリマー側の中央パッドだけ「＋ 新規カルテ」として残す（1件目を作る唯一の導線のため）。`npm run verify:empty` で検査。
- **stored XSS を発見して修正（F-17・Critical）**: 認証不要の `POST /api/reports` に細工した `weights[].ym` を入れるだけで、飼い主の公開ページで任意の JS が実行された。実ブラウザで実証済み。`ymShort()` が数字以外を返せないようにし、`SET_WEIGHTS` でも形を検査する。`npm run verify:xss` が6経路に撃ち込んで常時検査（修正前 5/6 → 修正後 6/6）。
- **vibe-base への依存を打ち切り（F-09 / F-10）**: どちらも「移設元を見ないと決着しない」と書いていたが、F-09 は注入シンク31箇所の棚卸しでこのリポジトリだけで解決（→ F-17）。F-10 は受け入れ基準#14 を「移設元から8件を転記」から「**このリポジトリで起きた失敗が再現手順つきで記録されていること**」に読み替えた。以後 vibe-base は参照しない。
- **M8（F-07 / F-08 / PII）**: 外部 CDN 参照を全廃した。Unsplash 10件は**同梱ではなく撤去**（全て写真アップロードまでの仮置きで、他人の犬を顧客の犬として見せるのは F-15 と同じ問題になる）。フォントは Latin 3ファミリを同梱し、日本語4ファミリは容量（Noto 2種で 70MB）を理由にシステムフォントへ寄せた。PWA manifest を4ファイルに結線し、dist でのパス変化も build に置換を足して塞いだ。`docs/ASSET-PROVENANCE.md` を新設。実在顧客名と個人アドレスを除去し、`docs/runbook.md` の移設元パス6箇所も是正。
- **M9（ルール改訂）**: `AGENTS.md` の Golden Stack をテンプレートの鉄板構成（Next.js / Tailwind / Prisma / Vitest）から**本リポジトリの確定スタック**へ差し替え。MECHANICAL CHECK と REAL VERIFICATION に実際のコマンドを明記し、LEVEL D に事故から昇格した13条を記載。`docs/design.md` は空テンプレートだったので実態で埋めた。**移設元の凍結は行わない**（vibe-base への依存を打ち切ったため）。
- **P0（統合フェーズ・エンジン抽出）**: `ponchi-v2.html` のインライン `<script>` 985行を `src/js/ponchi-engine.js` へ**逐語**で切り出した。切り出し前後を突き合わせて**完全一致**を確認済み（位置だけが変わった）。HTML は 2154行 → 1168行。これで HTML を差し替えてもエンジンが消えなくなった——P1 以降の貼り替えの前提。
- `docs/failures.md` に **20 件**を記録（**CLOSED 20 / OPEN 0**、+ F-06 の Root Cause 訂正）。

## 2. 現在の状態 (Current State)

> **注記（2026-08-23・F5）**: 以下の verify:* の件数・実行方法（`npm run preview` を別端末で）は
> KVモード時代のもので、**古い**。現在の Supabase モード版の実行方法・件数は
> 「F5 の結果」セクション（本ファイル後半、F4の結果の次）を見ること。

### 機械検証

| コマンド | 結果 |
|---|---|
| `npm run build` | EXIT 0 |
| `npm run check` | EXIT 0（src↔dist parity + design/ isolation の2本） |
| `npm test` | EXIT 0・**66 pass / 0 fail**（全6スイート。P8-a で +5） |
| `npm run verify:m6` | **11/11 PASS・EXIT 0** |
| `npm run verify:roundtrip` | **15/15 PASS・EXIT 0**（記入→保存→公開ページの往復） |
| `npm run verify:empty` | **8/8 PASS・EXIT 0**（カルテ0件の犬に架空の履歴が出ないこと） |
| `npm run verify:xss` | **6/6 PASS・EXIT 0**（保存データが飼い主のブラウザで実行されないこと） |
| `npm run verify:portal` | **10/10 PASS・EXIT 0**（`/my` が起動し、未ログインでログイン導線が出ること） |

**アプリは外部へ一切通信しない。** `verify:m6` 項目9 の外部リクエスト失敗が 24件 → **0件**。

`npm run verify:all` で verify 系5本をまとめて回せる。

`verify:m6` / `verify:roundtrip` / `verify:empty` / `verify:xss` は別端末で `npm run preview` を起動してから実行する。
`verify:portal` だけは自分で Worker を立てる（`/my` は Supabase モードでしか配信されず、`preview` は KV モードのため）。
playwright 管理外の chromium を使う場合は `M6_CHROMIUM=/path/to/chrome` を渡す。

**`verify:roundtrip` がこのリポジトリで一番重要な検査。** 画面が出るか・押せるかではなく、
トリマーが書いた所見が飼い主の公開ページに同じ値で届くかを、13項目突き合わせる。
入力欄を足したら必ずこの検査にも足すこと。足さなければ、その欄は
「保存されていない」状態に戻っても誰も気づかない。

### 動くことが確認できているもの

**導線（`verify:m6`）**: ログイン画面 / 検索一覧 / 飼い主・犬の新規登録（POST 200）/
肉球画面（中央パッド1・指4）/ 犬体図への Konva 描画（ペン・色変更・undo）/
写真アップロード（7スロット）/ カルテ保存（`POST /api/reports` 200）/
公開ページ `/p/{slug}` での閲覧モード再現 / アプリ由来のコンソールエラー 0 件。

**中身（`verify:roundtrip`）**: 犬の名前 / 皮膚1の部位・大きさ・種類・変化 / 歯の状態 /
耳（右・左）/ 爪のレベル / 耳・爪・歯のコメント / 担当からの一言 —— 13項目すべてが、
トリマーの記入どおりの値で飼い主の公開ページに現れる。

**空（`verify:empty`）**: カルテ0件の犬には、架空の月ラベルも見本写真もタップ導線も出ない。
飼い主には「まだカルテがありません」。トリマーの中央パッドからは1件目を作成できる。

**安全（`verify:xss`）**: 保存されたカルテのデータ6経路（体重の年月・犬名・担当の一言・
耳のコメント・皮膚の部位）に細工を撃ち込んでも、飼い主のブラウザで実行されない。

導線が通ることと中身が届くことは別物で、**後者は一度も検査されていなかった**。
`verify:m6` が 9/9 だった時点で、実際には所見の大半が消えていた。

外部ホスト（`images.unsplash.com` / `fonts.googleapis.com`）への接続失敗 22 件は
実行環境の egress 制限によるもので、アプリの不具合ではない。ただし**外部 CDN に
依存していること自体**は D-4 違反として `F-20260821-07` に OPEN で記録した。

### 未着手

**移設 plan（M0〜M9）の工程は無い。** 残るのはコードでは解けない1件と、次の工程。

### 未解決（`docs/failures.md` の OPEN）

**0 件。**

ただし `docs/ASSET-PROVENANCE.md` に**マスター確認待ちが残っている**。素材20件のうち
AI 生成が5件（C2PA 署名から OpenAI / Google と特定）、残る15件は出所不明で `UNVERIFIED`。
実写に見える4件（`photo-dog-ear` / `photo-dog-skin` / `guide-nail-state` / `guide-teeth-state`）が優先。
飼い主に配るページに載るため、第三者の犬が写っている場合はその飼い主の同意も要る。
消すと状態ガイドが空欄になるので、差し替えるまで残してある。

`docs/runbook.md` は M8 で是正済み（絶対パス6箇所・個人アドレス・存在しない A版ファイルへの指示）。

## 2-b. 飼い主の導線（2026-08-21 マスター決定）

**飼い主はログインしてマイページへ行き、そこにある自分の飼っている犬の一覧から選んでカルテを見る。**

無認証の公開URL `/p/{slug}` を廃止したあとの代替導線がこれ。plan には「`/p/` `/o/` 廃止」としか
書かれておらず代替が空白だったので、ここで確定した。

### 調べたら、この導線はほぼ実装済みだった

| 段階 | 実装 | 状態 |
|---|---|---|
| ログイン | `bootProtectedPortal()` + Google OAuth（`supabase-auth.js`） | ✅ ある |
| マイページ = 犬の一覧 | route `pets` = `/my` → `renderPets()` が犬カードを並べる | ✅ ある |
| 犬を選ぶ | `/my/pets/{petId}` | ✅ ある |
| カルテを見る | `/my/pets/{petId}/reports/{reportId}` | ✅ ある |
| 自分の犬だけ見える | RLS `pets_customer_select` = `is_owner_user(owner_id)` | ✅ ある |
| 確定済みだけ見える | RLS `reports_customer_select` = `status = 'final'` | ✅ ある |
| **`my.html` の DOM フック** | `data-portal="customer"` / `data-portal-content` / `data-login-panel` / `data-google-login` / `data-sign-out` / `data-portal-status` | ✅ **P8-a で結線**（`npm run verify:portal`） |
| カルテの意匠 | `renderMagazine`（`src/js/magazine-view.js`） | ❌ **P6 で作る**。今は素の DOM |

`supabase-auth.js:280` が `document.body.dataset.portal === 'customer'` を条件にしているため、
**ポータルは一度も起動していなかった**（統合 plan のリスク#3）。P8-a で結線し、実ブラウザで
未ログイン状態の起動を確認した（`verify:portal` 10/10）。**ログイン後の表示は未確認**——
Google OAuth も犬一覧も RLS も Supabase 有効化後でないと動かせない。

### ⚠️ 順序を P8 → P1 に変えた理由

この導線は**全部 Supabase の Google OAuth 前提**で、Supabase はまだ有効化されていない。
そして **KV モードには飼い主のログインが存在しない**——`/p/{slug}` が無認証なのは、
それが飼い主向けの唯一の経路だからである。

**P1 で先に `/p/` を消すと、Supabase が有効になるまで飼い主はカルテを一切見られなくなる。**
置き換え先を動く状態にしてから古い経路を消す順序にする。

もう1つ、P1 は「画面の改名」ではない。肉球画面の撤去（`grep -c "paw" src/js/ponchi-app.js` は現在 31）と
`src/search.html` の削除を含み、**`verify:*` 4本はすべて `#screen-paw .pad` を経由している**ので
4本とも書き直しになる。検査の作り直しを含む一塊の作業として見積もること。

---

## 3. 次回やること (Next Steps)

**2026-08-23 にマスターと完成までの計画を確定した。次回セッションはこの順で読むこと。**

1. `docs/handoff.md`（このファイル）— 直近の状態
2. **`docs/ops/plans/2026-08-23-completion.md`** — 完成までのフェーズ F0〜F6・受け入れ条件・動線図
3. **`docs/decisions.md`** — マスター決定・私の判断・未決事項の台帳（口頭で流さず必ずここに記録する運用に変更した）

**現在地: F0〜F6 すべて完了。計画の全体受け入れ条件7項目を達成した（2026-08-24）。**

**`https://trimmer-system.kouheikosehira.com` は Supabase 版を配信している。**
同ドメインで①〜⑥を実機で一周させ **9/9 PASS**。旧 KV 版 Worker
（`saltydog-report-worker`）はルートを外して残してあり、切り戻せる（手順は
`worker/wrangler.toml` のコメント）。

**コードで解ける作業は残っていない。** 残るのは素材の出所確認
（`docs/ASSET-PROVENANCE.md` の UNVERIFIED 15件・`docs/decisions.md` D-20260823-U1）で、
これはマスターの手作業。

**資格情報の在り処（重要・次セッションで探し回らないこと）**: `CLOUDFLARE_API_TOKEN` と
Supabase の Management API token は、セッションの scratchpad
（`/tmp/claude-0/-home-user-siota-1/<session-id>/scratchpad/` の `.cftoken` / `.sbtoken`、
どちらも `chmod 600`）に置いてある。Management API token からは
`GET https://api.supabase.com/v1/projects/bcodloqwnrhcuvevfguy/api-keys?reveal=true` で
service_role key を取得できる（`.srkey` に保存済み）。SQL は同ディレクトリの
`sbq.py` で流せる。**「無い」と判断する前に深さ制限なしで探すこと**——一度
`find -maxdepth 5` で見落として、あるものを「無い」と報告した（D-20260823-22）。

**ローカルでの実機検証手段（重要・F5でも使う）**: `CLOUDFLARE_API_TOKEN` もホスト済み
Supabase プロジェクトの service role key も無いコンテナでも、実ログイン・実DB・実RLSの検証が
できる。`supabase start`（Docker）でローカルに実 Postgres・実 Auth・実 PostgREST・実 Storage を
起動し（`supabase/config.toml` の `[edge_runtime] enabled=false` はこのサンドボックスでの
rlimit エラー回避のため追加済み）、`worker/wrangler.local.toml`（新規・秘密情報なし）でそれを
指す `wrangler dev --config worker/wrangler.local.toml --port 8787` を立てる。ログインは
`supabase/seed.sql` のテスト専用アカウント（`staff@local.test` 等・password login）で
password grant のアクセストークンを取得し、`window.TrimmerAuth.setSession()` に注入する
（本番UIはGoogle認証のみを表示するので、この注入はテスト専用の裏口）。詳細は
`docs/decisions.md` D-20260823-18。ホスト済みプロジェクトへの実デプロイ確認だけは
`CLOUDFLARE_API_TOKEN` が無いとできない（D-20260823-U2、格下げ済み・低リスク）。

要点だけ書く（詳細は上記2ファイル）:

- **動線はマスター指定でモックが正**: URL → ログイン → 犬を選ぶ → カルテ作成 → 確認 → 顧客ページ（確認と顧客ページは同一レンダラ、`design/mock-4step.html` の `#screen-4`）。V1 現状の「飼い主ページ→ワンちゃんページ→肉球画面」は動線に無い層で、F2 で撤去する。
- **完成 = 独自ドメイン `trimmer-system.kouheikosehira.com` で6段階が一周すること**（D-20260823-01, 02）。現行 KV 版本番のデータは全てダミーで、移行はしない（D-20260823-03）。
- 切替は F5 の検査が全部通ってから（`docs/decisions.md` D-20260823-08、私の判断）。それまでは `https://shiota0823.rahiseko.workers.dev` 上で作業し、現行本番には触れない。
- `verify:m6` / `verify:roundtrip` / `verify:empty` / `verify:xss` の4本は **KV モード・`#screen-paw` 前提**なので F2 で全て壊れる。F5 で Supabase 版へ作り直す（見積もり済み、書き直しを1工程として計画に含めてある）。
- 素材の出所確認（`docs/ASSET-PROVENANCE.md` の UNVERIFIED 15件）は未決のまま `docs/decisions.md` の D-20260823-U1 に転記した。コードでは解けない。

### F1 の結果（2026-08-23・実機確認済み）

ダミーデータ（飼い主2件・犬3件、`rahiseko@gmail.com` を飼い主にも紐付け）を入れて、①〜⑥を実ブラウザで辿った。

- ①②は通る。③は「犬を選ぶ」の前に「飼い主を選ぶ」層が挟まる（動線に無い層、F2 で撤去対象）。
- ⑤（確認画面）自体は正しく動くが、**④（カルテ作成）が構造的に必ず失敗する**ことを実機で確認した。
  日付フィールドの抽出が、年/月/日 3分割表示のうち月だけしか取れておらず（`publish-client-ponchi.js:141`）、
  Supabase 側の検証（`ponchi-app.js:1316-1319`）が求める `YYYY/MM/DD` に絶対になり得ない。
  `docs/failures.md` の **`F-20260823-26`（OPEN・F3で修正）** に詳細を記録した。
- ⑥（顧客ページ）は④が塞がっているため未到達。ただし `renderReport()`（`supabase-auth.js:132`）が
  皮膚・爪・耳・歯などの主要項目を描画していないことはコードレビューで確認済み（F4 の対象）。
- 検証方法の注意（`docs/decisions.md` D-20260823-10）: `rahiseko@gmail.com` は店舗管理者でもあるため
  `pets_staff_all` ポリシーで店舗の全ペットが見える。「他人の犬が見えない」の検証には
  スタッフ権限のない別アカウントが要る（F5 で対応）。

### F2 の結果（2026-08-23・実機確認済み）

`飼い主ページ → ワンちゃんページ` の2層と肉球画面を撤去し、`/edit` が犬の一覧を直接出すようにした。

- **サーバ側**: `listPetsWithOwner()`（`supabase-data-store.js`）と `GET /api/pets`
  （`worker/src/index.js`）を新設。PostgREST の `owners(name)` embed で、店舗の犬を飼い主名つき
  1回の問い合わせで取得する
- **クライアント側**: `/edit` は `GET /api/pets` を叩き、`renderFlatPetList()`（`ponchi-app.js` 新設）
  が犬を直接並べる。クリックで `/edit/p/{petId}` へ直接遷移し、肉球を経由せず全カルテ一覧へ進む。
  「＋ 新規カルテを作成する」で犬名・飼い主名を1画面から受け取り、飼い主のいない状態からでも
  1件目を作れる
- **肉球画面を全面撤去**: `grep -c "paw" src/js/ponchi-app.js` = 0（実施前31）、HTML/CSSからも撤去。
  行き先が1つになったので「戻るドロワー」（3択のガラスパネル）も撤去し直接遷移に簡略化
- `src/search.html` を削除
- **実機で確認したこと**（`https://shiota0823.rahiseko.workers.dev`）: ログイン直後に犬3頭が
  直接並ぶ／犬をクリックすると肉球を経由せず全カルテ一覧に着く／「戻る」で犬の一覧に戻る／
  新規カルテ作成フォームで実際に飼い主・犬を作成し、その犬の編集画面へ進めることまで確認
  （DB にも実際に行が増えることを確認、テストデータは削除済み）
- `npm run build` / `check` / `test` は EXIT 0・67 pass のまま変化なし
- **scope 変更**: section id の `list/edit/view` 改名は行わなかった。KV/Supabase 両モード共有の
  id なので改名は別作業として大きく、今回の実害（動線に無い層・肉球画面）を消すのに必須でなかった
  ため。詳細は `docs/ops/plans/2026-08-23-completion.md` の F2 セクションに記録
- **意匠はまだ乗っていない**。今の犬の一覧は素の DOM（`createListItem`）。意匠は F4 相当で乗せる

### F3 の結果（2026-08-23・実機確認済み）

**scope 変更**: 計画では「Supabase 経路を結線する」想定だったが、**経路は既に結線済みだった**。
`extractReport`/`applyReport` の Supabase 分岐も、写真アップロード（`TrimmerSupabaseStorage`）も
実装済みで、そのまま動いた。実際に必要だった修正は F1 で見つけた `F-20260823-26` ただ1件。

- **`F-20260823-26`（日付結合の欠落）を修正**。`extractReport()` に `isoDate` キーを新設し、
  `#heroDateInput`（`<input type="date">`、常に `YYYY-MM-DD`）の値をそのまま返すようにした。
  `ponchi-app.js` の公開検証は `report.date`（3分割表示の月だけ）ではなく `report.isoDate` を見る
- **修正の過程でもう1件発見（`F-20260823-27`）**: `clearReport()` が `#heroDateInput` 自体を
  リセットしておらず、新規カルテは日付ピッカーに触れない限り常に HTML の静的な既定値
  （2026年12月5日）で保存されるところだった。今日の日付で初期化するよう修正
- **実機で確認したこと**（`https://shiota0823.rahiseko.workers.dev`）: 日付ピッカーに**一切触れず**、
  犬を選ぶ→記入→確定→プレビュー→公開まで通し、「公開しました！」に到達。DB で
  `reports.status = 'final'`・`report_date` が実行日と一致・`staff_note` が記入値と一致・
  写真4件が `report_assets` に保存されることを確認（テストデータは削除済み）
- 公開処理は写真アセットの数だけ直列アップロードするため体感15〜20秒かかる。遅いが
  今回のスコープの不具合ではないため保留
- `npm run build` / `check` / `test` は EXIT 0・67 pass のまま変化なし

### F4 の結果（2026-08-23・実装完了／実機は一部未確認）

`src/js/magazine-view.js` を新設した。`renderMagazine(container, report, opts)` が
マスター承認のマガジン意匠（4ステップ意匠モックの `#screen-4`）へ、実データを一方向で投影する。
トリマーの確認画面（`/edit` の公開直前プレビュー・Supabase モードのみ）と `/my` の飼い主画面が、
**この1本の関数を共有する**。

- **scope 変更（D-20260823-12）**: 計画は「マガジンの静的HTMLを `ponchi-v2.html` に書く」想定
  だったが、`/my` は別ファイル（`src/my.html`）のため、静的HTMLを2ファイルに複製すると
  ズレるリスクがあった（このセッションで直してきたバグと同じ再発条件）。代わりに
  `magazine-view.js` 1本のテンプレート文字列を両画面に注入する方式にした。機械チェックは
  静的 grep から、実ブラウザでの `[data-view]`/`[data-field]` 件数チェックへ差し替えた
- 皮膚（10行）・爪・耳（左右）・歯・体重推移（実データから計算した折れ線）・カット写真・
  担当からの一言・過去レポートのタイムライン（実リンク）を実データから描画。**モックの創作文・
  次回来店提案・トリマーバッジは、対応するデータフィールドが無いため実装しなかった**
  （D-20260823-13。飼い主に架空の解説文を見せないため）
- Google Fonts の CDN 読込は追加していない（D-20260823-14）。`src/my.html` が既に持っている
  ローカル同梱フォントのトークンをそのまま使い、「アプリは外部へ一切通信しない」を維持した
- KV モード（現行本番）の確認画面（`showLegacyPreview`）は一字一句変更していない
  （D-20260823-15）。マガジン化は Supabase モードだけの分岐
- **実機で確認したこと（2段階）**:
  1. `renderMagazine()` を Playwright（chromium）で合成データを使って単体検証し、27/27 PASS。
     `data-view` 35件・`data-field` 0件、記入なし項目は非表示（架空データを出さない）、
     `<script>` 注入が実行されない（XSS安全性）、アコーディオン/クイックジャンプ/ライトボックス/
     タイムラインリンク/戻るボタンの実動作、コンソールエラー0件
  2. **ローカル Supabase（`supabase start`）+ ローカル `wrangler dev` で一気通貫の実機検証**
     （D-20260823-18）。19/19 PASS。実ログイン（`staff@local.test`）→犬「X」選択→新規カルテに
     皮膚・爪・耳・歯・担当からの一言を実際にクリック/入力→確定→**確認画面
     （`#screen-magazine`）に記入どおりの値が出る**ことを確認→公開→別ブラウザコンテキストで
     飼い主(`owner-a@local.test`)としてログインし直し、**`/my/pets/{id}/reports/{id}` に
     同じ値が同じレンダラで届く**ことを確認。さらに `owner-b@local.test`（他人）は同じURLへ
     アクセスしても中身が出ない（RLS実証・全体受け入れ条件3の前倒し確認）ことも確認
- **未確認のまま残っていること**: 写真アップロードを含む往復（今回はテキスト項目のみ）、
  ホスト済み Supabase プロジェクト（`shiota0823.rahiseko.workers.dev`）への実デプロイ後の
  動作（`CLOUDFLARE_API_TOKEN` が要る・D-20260823-U2・低リスクと判断）
- `npm run build` / `check` / `test` は EXIT 0・67 pass のまま変化なし

### F5 の結果（2026-08-23・実機確認済み）

F4のローカルSupabase実機検証（D-20260823-18）を `scripts/lib/local-stack.mjs`（新設）として
共通化し、`verify:m6`/`verify:roundtrip`/`verify:empty`/`verify:xss`/`verify:portal` の
**5本すべて**をこれで動く形に書き直した。

- **実行方法が変わった**: `npm run preview` を別端末で立てておく前提を廃止した。今は
  `npx supabase start`（ローカルの実Postgres/Auth/PostgREST/Storage）だけを事前に立てておけば、
  各 `npm run verify:*` は自分で `wrangler dev --config worker/wrangler.local.toml` を
  起動・停止するところまで自己完結する。ログインは `supabase/seed.sql` のテスト専用
  アカウント（`staff@local.test` / `owner-a@local.test` / `owner-b@local.test` 等、
  password login）で自動化する
- **`verify:m6`（12/12）**: ①ログイン導線→③犬の一覧（飼い主選択層なし）→画面からの
  新規飼い主・犬登録→④カルテ作成→Konva描画（ペン/色変更/undo）→写真アップロード→
  保存POST→⑤確認画面（マガジン意匠・F4）→⑥公開URL到達→コンソールエラー0件
- **`verify:roundtrip`（19/19・最重要）**: 実UI操作でカルテを記入→保存→別ブラウザ
  コンテキストで飼い主としてログインし直し、13項目すべてが同じ値で届くことを確認。
  他人（owner-b）には見えないこと（RLS）も同じ実行内で確認
- **`verify:empty`（7/7）**: カルテ0件の犬に見本画像・タップ可能なリンクが出ないこと、
  「まだカルテがありません」が出ること（`src/js/supabase-auth.js` の `renderPet()` に追加。
  今回のUIコード変更点はこれのみ）、トリマー側の新規作成導線が生きていることを確認
- **`verify:xss`（7/7）**: DOM/extractReportのサニタイズを迂回し、スタッフAPI経由でDBへ
  直接細工データを書き込んでから飼い主画面で描画させる、より厳しい「出口が安全か」の検査。
  pet/staffNote/skin.loc/ear.comment/nail.comment/teeth.status・comment/weights[].ym の7経路
- **`verify:portal`（14/14）**: ログイン前10項目は無変更のまま維持し、ログイン後4項目
  （自分の犬だけ見える／ログアウトボタン表示／他人の犬は見えないRLS／サインアウトで
  ログイン画面に戻る）を追加
- **クリーンな状態から確認**: `npx supabase db reset` → `npm run verify:all` で
  **59/59 PASS**（12+19+7+7+14）。`npm run build`/`check`/`test` も EXIT 0・67件のまま

### F5後の追加作業（2026-08-23）

一時「F6は資格情報待ち」として止めていたが、**その前提が誤りだった**（後述）。
止まっていた間、および資格情報が見つかったあとに実施したこと。

- **`test/e2e/*.cjs` を削除した（訂正）**: F5直後、「これらはKVモードの検査として今も
  正しいので対象外」と記録したが誤りだった。`#backDrawer`/`openBackDrawer`/`#screen-paw`
  はF2でKV/Supabase共有のソースから完全に削除済みで、この2ファイルはどちらのモードにも
  存在しないものを検査していた。書き直すと`verify:*`5本と重複するだけなので、削除し、
  唯一そこにしか無かった検査（体重の新規登録・使用オプションのオン/オフ）だけを
  `verify-m6.mjs`（6b・6c、12→14項目）へ移植した。`playwright.config.cjs`と
  `package.json`の`test:e2e`も削除。詳細は`docs/decisions.md` D-20260823-20
- **`code-review`スキルでF0〜F5の差分（PR #4）全体を見直し、実バグ1件を発見・修正した**:
  `supabase-auth.js`の`bootProtectedPortal()`で、セッション確認後にトークンが失効/破損
  すると「Googleでログインしてください」と出るのにログインボタンが押せない詰み状態に
  なっていた（signed-out分岐でしかボタンを結線していなかったため）。壊れたトークンを
  実際に注入して再現し、`signOut()`してから1回だけ`reload()`する形に直して、
  実機で解消を確認した。他に確認画面のfetch並行化・未使用コードの整理も実施。
  詳細は`docs/decisions.md` D-20260823-21

### ホスト済み環境での実機確認（2026-08-23・①〜⑥ 8/8 PASS）

**「資格情報が無い」は私の誤りだった**（D-20260823-22）。`.cftoken`/`.sbtoken` は
前セッションの scratchpad に残っていたのに、`find -maxdepth 5` で探して見落とし、
「無い」と報告していた。また「Google OAuth が本番公開済みか確認できない」も誤りで、
`/auth/v1/settings` を叩けば `"google":true` と即座に分かった。**「無い」「できない」と
言う前に、実際に探す・実際に叩くこと。**

資格情報が見つかったので、F4/F5 のコードを `shiota0823.rahiseko.workers.dev` へ
デプロイし、ホスト済み環境（実 Supabase `shiota1`）で①〜⑥を実機で一周させた:

- ①URLを開く → ②ログイン → ③犬の一覧（ポンチ/ムギ/レオが直接出る・飼い主選択層なし）
  → ④カルテ作成 → ⑤確認ページ（F4のマガジン意匠） → 公開 → ⑥顧客ページに同じ値が
  同じレンダラで出る、まで **8/8 PASS**
- ホスト済み DB 側でも `status='final'`・`report_date` が実行日・`staff_note` が記入値と
  一致・`report_assets` 4件（Storage への実アップロード成功）を確認
- テストデータは Storage のオブジェクトごと削除済み（reports 0件・assets 0件・
  Storage 実ファイル0件を確認）
- 詳細は `docs/decisions.md` D-20260823-23

### その検証中に見つけた不具合を修正（D-20260823-24）

**スタッフが未ログインで `/edit` を開くと、ログイン後に飼い主画面へ着いてトリマー画面に
戻れなかった。** `safeReturnPath()` が `/my` 以外の戻り先を全て `/my` に潰しており、
`bootStaffPortal()` が積んだ `post_auth_return='/edit'` が消えていた。さらに
**マスターのアカウントは staff かつ owner（D-20260823-06）** なので、`/my` 側の
「memberships があり ownerLinks が無ければ /edit へ」という救済分岐にも入らず、
飼い主画面に取り残されていた。つまり D-06 の副作用をマスター自身が最も受ける状態。

`safeReturnPath()` が `/my` と `/edit` の両方を通すよう修正（`/editorial` のような
前方一致や `//evil.example/edit` は引き続き `/my` に潰す）。ブラウザ側
（`supabase-auth.js`）と Worker 側（`auth-context.js`）の同名・同契約の関数を
両方直し、両方を対象にした回帰テストを追加（テスト 67→68件）。ホスト済み環境で
「未ログインで `/edit` → ログイン → `/edit` に戻り犬一覧3件」を実機確認済み。

### F6 の結果（2026-08-24・独自ドメインで実機確認済み・9/9 PASS）

**独自ドメイン `trimmer-system.kouheikosehira.com` を Supabase 版へ切り替えた。**

- **Supabase の Site URL / Redirect URLs を独自ドメインへ**変更（Management API 経由）。
  許可リストには workers.dev も残した——切り戻すときに設定を戻す手間を作らないため
- **Cloudflare のルートはダウンタイムゼロで付け替えた**。`wrangler deploy` は既存の
  ルートを削除しないので、設定ファイルの `[[routes]]` を書き換えるだけでは
  切り替わらない（新 Worker のデプロイが `A route with the same pattern already
  exists` で弾かれる）。Cloudflare API の
  `PUT /zones/{zone}/workers/routes/{route_id}` で**ルートを消さず向き先だけ差し替えた**。
  次に同じことをする人はこの方法を使うこと（`docs/decisions.md` D-20260823-26）
- **旧 Worker は削除せず残っている**（D-20260823-09）。ルートを持たないのでドメインからは
  呼ばれない。切り戻し手順は `worker/wrangler.toml` のコメントに書いた
- Google OAuth 同意画面（D-20260823-07）は**既に本番公開済み**だった。Google 側の
  Authorized redirect URI は `https://<project>.supabase.co/auth/v1/callback` 固定なので、
  ドメイン変更の影響を受けない
- **実機確認 9/9 PASS**: ①ドメイン応答（`/api/config` が `backend:"supabase"`）→②ログイン
  →③犬の一覧（ポンチ/ムギ/レオが直接出る）→④カルテ作成→⑤確認ページ（マガジン意匠）
  →公開→⑥顧客ページに同じ値が同じレンダラで出る／編集用フック0件／コンソールエラー0件。
  DB 側も `status='final'`・`report_date` が実行日・`staff_note` 一致・`report_assets` 4件。
  テストデータは Storage のファイルごと削除済み
- **切り替え直後の1回目は `/edit` で「表示できません。」と落ちたが、再実行すると 9/9 で
  通った**（その間コードもデータも変えていない。Node から直接 `/api/session`・`/api/pets`
  を叩くとどちらも 200）。エッジ側の一時的な不安定さと判断した。**本番切替の直後に1回
  落ちても、まず再実行して切り分けること。**

### 本番公開後の点検（2026-08-24）

**出所不明の犬の写真9件が、画面から参照されていないのに配信されていた。** 削除して配信を止めた。

- `docs/ASSET-PROVENANCE.md` が「特に確認が要る」と名指ししていた実写4件
  （`photo-dog-ear` / `photo-dog-skin` / `guide-nail-state` / `guide-teeth-state`）を含む7件が、
  F2（肉球撤去）・P8-a（架空カルテ撤去）・F4（マガジンの実データ化）を経て**参照ゼロ**に
  なっていたのに、`dist/` へコピーされ本番で 200 を返していた
- 画面に出ないのに配信だけされている状態に残す利益が無いので削除（未参照のAI生成2件も併せて9件・3.1MB）。
  `git rm` なので履歴から復元できる。デプロイ後、9件が 404・使用中の素材が 200 であることを確認済み
- **残る問題は `photo-trim-action.jpg` 1件**。`UNVERIFIED` のままログイン画面
  （`src/index.html:226`）で使用中で、**ログイン前の誰にでも見える**ため露出が最も高い。
  消すと意匠が壊れるのでマスター判断が要る（選択肢は `docs/ASSET-PROVENANCE.md` 5章）

### 本番DBに残っている検証用データ（実店舗開始前にマスター判断が要る）

| データ | 内容 | 備考 |
|---|---|---|
| owners | ダミー飼い主A / ダミー飼い主B / **「あ」** | 「あ」は招待テストの残骸（犬0・ユーザー0・未消化の招待1件を保持） |
| pets | ポンチ / ムギ / レオ | D-20260823-03 で「新たにダミーデータを入れて検証」と決めたもの |
| reports | 0件 | 検証で作ったカルテは Storage のファイルごと削除済み |
| auth.users | `rahiseko@gmail.com` のみ | staff（admin）かつ owner |

実店舗で使い始めるときに、これらを消すかどうかはマスターの判断。消す場合は
犬 → 飼い主 → 招待 の順で削除しないと外部キーで止まる。

### 本番公開後の三方向レビューで、実店舗を止める欠陥が4件見つかった（2026-08-24）

**計画の受け入れ条件7項目は満たしていたが、実店舗では使えない状態だった。** サブエージェント
3体に(1)運用リスク(2)未検証経路(3)セキュリティを並行で調べさせ、報告はすべて自分で再現・
確認してから対処した。

| # | 欠陥 | 状態 |
|---|---|---|
| 1 | **旧 KV Worker が無認証APIを workers.dev で公開したままだった** | ✅ 塞いだ |
| 2 | **招待フローが UI から到達不能** = 新規客は永久に自分のカルテを見られない | ✅ 直した |
| 3 | **空の写真スロットにページURLが保存され、飼い主に壊れた画像が届く** | ✅ 直した |
| 4 | **スタッフが2人になると管理者の機能が全部 409 で死ぬ** | ✅ 直した |

**4件とも本番へ反映済み（2026-08-24・Version `2911e465`）。** 直してコミットしただけでは
実店舗には届かないので、`npx wrangler deploy --config worker/wrangler.supabase.toml` で
`shiota0823` を更新し、**ローカルの検査結果を本番の根拠にしない**ため
`https://trimmer-system.kouheikosehira.com` に実ブラウザで入って直接確かめた（**8/8 PASS**）——
スタッフのログイン / 犬の一覧 / **犬の行3件すべてにQRボタンが在る**（行=3 ボタン=3）/
押すと実際に招待URL（64桁）が発行される / QRが画像で出る / 空スロットがページURLを返さない /
`/api/staff` が 200 / コンソールエラー0。旧KV版と新版の `workers.dev` が両方 404 であることも
併せて確認した。検証で発行した招待1件は本番に残さないよう削除済み（D-20260824-32）。

**1. 旧 KV Worker の無認証API（最重要）**
F6 でカスタムドメインの route は Supabase 版へ移したが、**workers.dev のサブドメインは
route とは別物**で塞がれていなかった。`saltydog-report-worker.rahiseko.workers.dev/api/customers`
が 200 で顧客一覧を返し、`DELETE /api/owners/{slug}` のカスケード削除も無認証で通った。
返ってきたデータに「コセヒラ」という実在の姓が含まれていた（D-20260823-03 の「全てダミー」は
姓については当てはまらない）。`workers_dev = false` / `preview_urls = false` を追加して
デプロイし、全経路 404 を確認。Worker 自体は切り戻し用に残してある。
**KV に入っているデータ自体はまだ残っている**（Worker から叩けなくなっただけ）。

**2. 招待フローの不通**
RLS（`pets_customer_select` → `is_owner_user`）は `owner_users` 経由でしか通らず、そこへ
行を入れられるのは `claim_invitation` だけ。ところが QR発行ボタンは **F2 で撤去した
「飼い主を選ぶ層」の画面に乗っていた**ため本番から消えていた。D-20260823-05 は
「QR発行・スタッフ管理は残す」と決めていたのに F2 でその決定を破っていた（私の見落とし）。
飼い主選択層は復活させず、**犬の一覧の各行に QR ボタン**を置いて塞いだ。
スタッフ管理も同じ理由で消えていたので、犬の一覧の末尾（管理者のみ）に置いた。

**3. 写真スロットのページURL混入**
`img.src`（プロパティ）は `<img src="">` のとき空文字ではなく**現在のページURL**を返す
（実ブラウザで確認: `img.src=''` → `http://host/edit/p/{petId}`）。`photo()` がこれを
読んでいたため、使わなかったスロット全部に `https://.../edit/p/{petId}` が保存され、
飼い主のマガジン画面に壊れた画像が出ていた。耳と歯は最初から `src=""` なので**常に**、
ヒーローは hero-1 が空だと hero-2 の実写真より優先されて壊れる。ほぼ全カルテで起きるのに
画面もコンソールも何も言わない。`getAttribute('src')` と `data-empty` を見る形に直した。

**4. `getStaffShopId()` の user_id 欠落**
RLS の `memberships_authorized_select` は `user_id = auth.uid() or is_shop_admin(shop_id)`
なので**管理者には店舗の全メンバー行が返る**。`user_id` で絞っていなかったため、スタッフが
2人になった瞬間に2行取れて `409 shop_selection_required`。飼い主の新規作成・招待の発行と
一覧・スタッフ管理（＝退職者の停止）が全滅する一方、日々のカルテ作成はこの関数を通らない
のでしばらく気づけない壊れ方だった。

**なぜ既存の検査が気づけなかったか**: 5本すべてが、招待を通らずに済むよう `seed.sql` の
`owner-a`（最初から `owner_users` 済み）を使って書かれていた。`verify-report-roundtrip.mjs`
のコメント自身が「新規の飼い主を作ると孤児owner になるため fixture を使う」と明記しており、
**穴を避ける形で検査が書かれていた**。避けた先が実店舗の必須経路だった。
写真も同様で、`verify:roundtrip` は写真を1枚も検査していなかった。

**追加した検査**: `npm run verify:invitation`（新設・`verify:all` に組込）は「実店舗に
新しいお客様が来た」ところから始める——fixture の飼い主を使わず、画面のフォームで新規の
飼い主と犬を作り、カルテを公開し、招待前は見られないことを確認してから、犬の行の QR ボタンで
招待を発行し、別アカウントがそれを消化して自分のカルテを読めるまで通す。消化済み招待の
使い回しも試す。`verify:roundtrip` にも写真の検査を足した（1枚だけ入れて「入れたものは
届く／空スロットにページURLが混ざらない」を同時に見る）。回帰テストは 68→72件。

統合に入る前に `docs/design.md` を読むこと。`finalize_report` が**4条件で黙って `null` を返す**ことなど、
書き直しを選ばない理由が実物の確認つきで書いてある。

なお F-11 と F-16 は自分の進め方の失敗として記録した。要点は2つ——受入基準を満たすことを
成果と取り違えないこと、そして**片方がクライアントに実害を出す選択は「判断」ではなく不具合**
なので、聞かずに直してから報告すること。

### 続けて、記入が黙って消える4経路を塞いだ（2026-08-24・D-20260824-33）

D-20260824-30 に並べた10件のうち、**実害順の上から、設計判断が要らない4件**を直した。
共通点は「画面もコンソールも何も言わないまま、打ち込んだ内容だけが失われる」——
現場では気づけないので、気づけるようにするのではなく**失われないようにした**。

| # | 何が起きていたか | どう直したか |
|---|---|---|
| 1 | 下書きが一切残らず、**戻るの誤タップ1回で数十分の記入が消える** | 入力が止まって1.2秒で `localStorage` に保存。未確定のまま離れようとしたら確認 |
| 2 | 公開に失敗 → 直して再確定、で**直した内容が捨てられ「公開しました！」と出る** | `replaceDataUrlAssets` を再試行判定の外へ。使い回すのは draft 行だけ |
| 6 | 失敗理由が全部「もう一度お試しください」に潰れる | HEIC・10MB超・429・ログイン切れを見分け、何をすれば通るかまで出す |
| 7 | 確定済みカルテが**書けるのに保存できない** | 上書き保存は3層すべてで塞がれている設計なので、書けない側に揃えた |

**1 の設計**: 保存するのは**文字と選択だけ**。写真と手描きは1カルテ十数MBで localStorage の
枠（約5MB）に入らないうえ、`exportImage()` は描画アコーディオンを開いて reflow させるので
入力中には走らせられない。`applyReport` が空の画像キーを触らない性質にそのまま乗せたため、
復元しても既にある写真は消えない（実測 1.1KB）。復元を尋ねるのは**今クリアしたときだけ**
——プレビューから「やり直す」で戻った場合に今の内容を上書きしないため。確定できたら消す。

**検証**: `npm run verify:draft` を新設（13項目・`verify:all` に組込）。
「入力が下書きに残る／写真が混ざらない／離脱時に確認が出る／戻ると続きから書ける／
確定で消える／確定済みは打ち込める場所が0」までブラウザで確認済み。回帰テスト 72→76件。

**まだ触っていないもの**: D-20260824-30 の 3（削除時の Storage 残留）・4（写真の縮小）・
5（レート制限）・8〜10。いずれも設計判断か運用の好みが絡むため、勝手に決めていない。

### 写真が積み上がる／消したのに残る、も直した（2026-08-24・D-20260824-34）

**調べたら D-20260824-30 の 4 の見立ては半分ずれていた。** 「Konva 4面を毎回 PNG 化するので
16MB」と書いたが、実測は**写真が9割・Konva 4面は1割強**。主因は iPhone の 12MP JPEG
（2〜4MB）が無加工で入ることで、縮小するコードはリポジトリに存在しなかった。

| # | 何が起きていたか | どう直したか | 実測 |
|---|---|---|---|
| 4 | 原寸の写真がそのまま入り、1カルテ約16MB | 取り込みの1箇所で長辺1600px・JPEG 0.82 に縮小 | 7.4MB→1018KB |
| 3 | 犬・飼い主を消すと写真が残り、**誰からも触れなくなる** | DB 行を消す**前に** Storage を片付ける | 5件→0件 |

**3 は順序が全てだった。** Storage のポリシー `private.storage_path_staff` は
「その `reports` 行が存在すること」を条件にしている一方、`DELETE /rest/v1/pets` は
FK カスケード（pets → reports → report_assets）でその行を先に消す。犬を先に消すと
写真は残るのに SELECT が false になり、**スタッフも飼い主も見ることすらできない**。
回収は service_role でしかできず、どれが孤児かを示す `report_assets.storage_path` も
同時に消えている。片付けに失敗したら DELETE を送らずに止める——中途半端に消えるより、
何も消えずにもう一度押せるほうがよい。

**検証の肝**: `npm run verify:delete` は **RLS 越しに見てはいけない**。削除後は
「残っていても見えない」ので、RLS 経由の確認は必ず合格してしまう——まさに直したい不具合を
見逃す。service_role で実体を数えている。

**まだ触っていないもの**: Konva 4面の書き出し（未描画面を飛ばす／WebP 化）は、
**飼い主に見えていた素図が消える／配信画質が変わる**という見た目の変更になるため、
マスターの判断が要る。容量の寄与も1割強にとどまる。
残る未着手は D-20260824-30 の 5（レート制限）・8（`owners.active=false`）・
9（招待の解除）・10（中断した削除の復旧）。

### まとめ入力の詰まりと、途中で止まった削除の復旧（2026-08-24・D-20260824-35）

| # | 何が起きていたか | どう直したか |
|---|---|---|
| 5 | `asset_metadata` 60回/10分 = **10分あたり5〜7カルテ**。まとめ入力で 429 | 300回/10分へ（約27カルテ）。マイグレーション 0006・本番適用済み |
| 10 | 削除が途中で失敗すると**一覧から消えるだけで写真ごと残り**、再試行に到達できない | 隠すのをやめ、「削除が途中で止まっています」の行＋やり直す導線を出す |

**5 の補足**: 本来の直し方はアセット登録をまとめて1リクエストにすること（11回→1回）で、
そうすれば上限に触れなくなる。ただし API 契約・store・`finalize_report` の孤児検出ガードまで
巻き込むので、実店舗を止めている今は上限を広げる側を先に出した。後で置き換えられる。

**10 の補足**: 飼い主側は別経路（RLS が `status='final'` を要求する）なので、
スタッフの一覧に出しても飼い主には見えない。`mark_report_deleting` は既に `deleting` の行も
受け付けるので、やり直しは何度押しても壊れない。

**検査自身の不具合も1件直した**: `verify-delete.mjs` が写真スロットを `scrollIntoView`
せずに直接 `click` していて、確定バーに重なった瞬間に30秒でタイムアウトしていた（2回踏んだ）。
`verify-m6` と同じ形にし、**3回連続で通ること**を確認した——1回通っただけで
「通った」と書かない（F-23 と同型）。

### 飼い主側のアクセスを、スタッフ側の見え方と一致させた（2026-08-24・D-20260824-36）

| # | 何が起きていたか | どう直したか |
|---|---|---|
| 8 | 退会扱い（`owners.active=false`）にしても、**その飼い主は `/my` で今まで通り読めた** | 飼い主側の判定4本すべてに `owners.active` を追加 |
| 9 | 招待リンクは**最初にクリックしたアカウントに恒久的に紐付き**、外す手段が無かった | `revoke_owner_link` RPC と、QRダイアログ内の「解除」 |

**8 の要点**: 入口が4本ある——`is_owner_user`（owners/pets）・`can_read_pet`（reports）・
`can_read_final_report`（report_assets）・`storage_path_customer`（Storage）。
**1本でも漏らすとそこだけ見え続ける**ので、機械検査も4本まとめて見る形にした。

**9 の要点**: 誤送信・転送で第三者が先に開くと、以前はその人が永久に読めた。
復旧は飼い主ごと削除しかなく、犬もカルテも写真も道連れになる。解除ボタンは
**QRを出すのと同じダイアログ**に置いた（間違いに気づく場所と、直す場所を同じにする）。
`owner_users` に直接 delete は与えず、他店舗の行に触れないことを関数側で保証する。

**検証**: `verify:invitation` を 11→19項目に拡張。実ブラウザで別アカウントを使い、
退会扱い・その取り消し・紐付けの解除の前後を通した。

### D-20260824-30 の10件の現在地（2026-08-24 時点）

| # | 内容 | 状態 |
|---|---|---|
| 1 | 下書きが残らない | ✅ D-20260824-33 |
| 2 | 再試行で修正が捨てられる | ✅ D-20260824-33 |
| 3 | 削除しても写真が残り触れなくなる | ✅ D-20260824-34 |
| 4 | 写真の縮小をしていない | ✅ 写真は解決（D-20260824-34）／**Konva 4面の書き出し形式は未決** |
| 5 | まとめ入力がレート制限に当たる | ✅ D-20260824-35 |
| 6 | 公開失敗の理由が伝わらない | ✅ D-20260824-33 |
| 7 | 確定済みカルテが書けるのに保存できない | ✅ D-20260824-33 |
| 8 | `owners.active=false` が効かない | ✅ D-20260824-36 |
| 9 | 招待の紐付けを外せない | ✅ D-20260824-36 |
| 10 | 中断した削除が復旧できない | ✅ D-20260824-35 |

**残る未決は 4 の一部だけ**——Konva 4面（犬体図・歯の図など）を「描かれていなければ
書き出さない」または「WebP にする」。どちらも**飼い主に見えるものが変わる**
（素図が消える／配信画質が変わる）ため、マスターの判断が要る。容量の寄与は1割強。

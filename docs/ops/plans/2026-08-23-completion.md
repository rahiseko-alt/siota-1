# SALTY DOG カルテ — 完成までの計画

## Context

トリミングサロンのカルテ管理システムを **KV モードから Supabase モードへ完全移行**し、
実店舗の業務に載る状態にする。

2026-08-23 時点で Supabase の土台（DB 12テーブル・Google 認証・写真の保管庫）と
Worker の配置は完了し、`https://shiota0823.rahiseko.workers.dev` でトリマーが
ログインできるところまで到達した。しかし **業務が一周しない**——
カルテを書いて飼い主が読むまでの動線が、V1 の古い画面構成のままである。

## 動線（マスター指定・`design/mock-4step.html` が正）

```
① URL を開く
② Google でログイン                    screen-1
③ 犬の名前を選ぶ                        screen-2 「登録カルテ一覧」
④ カルテ作成                            screen-3 「カルテ入力」
⑤ 確認（確定してお客様カルテを見る）      screen-4 をトリマーが見る
⑥ 顧客ページ                            screen-4 を飼い主が /my で見る
```

⑤と⑥は**同じ画面**。トリマーの確認と飼い主の閲覧で同一のレンダラを共有する。

現状はこの動線になっていない。V1 は `飼い主ページ → ワンちゃんページ → 肉球画面 → カルテ`
で、**飼い主を選ぶ層が余分**にあり、**肉球画面**という指定に無い画面が挟まる。

## マスター決定（2026-08-23）

| # | 決定 |
|---|---|
| D-1 | 完成 = 実店舗で使える状態。上記6段階が通ること |
| D-2 | 独自ドメイン `trimmer-system.kouheikosehira.com` を Supabase 版へ切り替える |
| D-3 | 既存 KV データは全てダミー。**移行しない**。新規にダミーデータを投入して検証 |
| D-4 | QR 発行・スタッフ管理（V1 既存機能）は残す |
| D-5 | 店舗名 `SALTY DOG` / slug `salty-dog`（登録済み） |
| D-6 | 管理者アカウント `rahiseko@gmail.com` を**飼い主としても紐付ける**（⑥の検証用） |
| D-7 | Google OAuth 同意画面を**本番公開**にする |
| D-8 | 動線・UI はモックが正。私の発案は採らない |

私の判断（マスター確認不要と判断したもの、異議があれば覆す）:
- 切替時期 → **⑥まで通ってから**。未完成をドメインに出す理由がない
- 旧 Worker → **ルートだけ外して残す**。切り戻せる状態を捨てない

---

## フェーズと受け入れ条件

各フェーズは単独でコミットし、`npm run build` / `npm run check` / `npm test` が
全て EXIT 0 であることを共通ゲートとする。

### F0 — 計画と決定をリポジトリに残す

セッションを跨いで維持するため、この計画自体をリポジトリに入れる。

- `docs/ops/plans/2026-08-23-completion.md` — 本計画（動線・フェーズ・受け入れ条件）
- `docs/decisions.md` — 決定台帳（決定済み / 未決 / 誰がいつ）を新設
- `docs/handoff.md` — 現在地を上記2つへのポインタに更新

**受け入れ条件**: 3ファイルが存在し、`docs/handoff.md` から両方へ辿れる。

### F1 — ダミーデータを入れて、現状どこで止まるかを確定させる【完了・2026-08-23】

推測で作業しない。まず動かして、6段階のどこで落ちるかを事実として押さえる。

- 飼い主2件（ダミー飼い主A・B）・犬3件（ポンチ・ムギ／レオ）を Supabase に投入。
  `rahiseko@gmail.com` を飼い主Aにも紐付けた（D-20260823-06）
- 実ブラウザ（Playwright、magiclink でのセッション確立を Google ログインの代替として使用）で
  6段階を1つずつ辿った

#### 結果（① 〜 ⑤ は実機で確認、⑥ は ④⑤ が塞がっているため未到達）

| # | 内容 | 結果 | 根拠 |
|---|---|---|---|
| ① | URL を開く | ✅ 通る | `GET /` → 200 |
| ② | ログイン | ✅ 通る | Supabase Auth 経由でセッション確立、`GET /api/session` → 200 |
| ③ | 犬を選ぶ | ⚠️ **動線が違う** | `/edit` は「飼い主ページ」（`owners` 一覧）が最初に出る。犬の直接選択ではなく、飼い主→犬の2段。`src/js/supabase-staff.js:6-9` の `STAFF_ROUTES` が `owners → owner(1軒の犬一覧) → pet` の3階層で定義されている。F2 で1階層（犬の直接一覧）へ畳む対象 |
| ④ | カルテ作成 | ❌ **公開できない（構造的バグ）** | 下記「F1で見つけた不具合」参照。新規カルテは**常に**公開に失敗する |
| ⑤ | 確認 | ✅ 画面としては動く | 「プレビューを確認」→「これがお客様に届く内容です」の確認画面自体は正しく表示される。ただし④が失敗するため、この画面から先に進めない |
| ⑥ | 顧客ページ | ⏳ **未到達** | ④が塞がっているため、実データでの確認ができていない。`renderReport()`（`src/js/supabase-auth.js:132`）は皮膚・爪・耳・歯などカルテの主要項目を描画せず、犬名・日付・一言・写真しか出さない実装であることはコードレビューで確認済み（F4 の対象） |

#### F1 で見つけた不具合（F3 で必ず直すこと）

**カルテの日付が、新規作成では絶対に正しい形にならない。**

- `src/js/publish-client-ponchi.js:141` — `extractReport()` が `date: field('date')` として抽出する。
  `field('date')` は `[data-field="date"]` 要素の text のみを読む
- しかし `[data-field="date"]` は「年 / **月** / 日」の3分割表示（`src/design-samples/ponchi-v2.html:947`）の
  **月だけ**を保持する要素。年は `[data-field="year"]`、日は `[data-field="day"]` と別要素
- `src/js/ponchi-app.js:1316-1319` の Supabase 分岐は
  `report.date` が単体で `YYYY/MM/DD` 形式であることを要求する（
  `rawDate.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)`）が、
  上記の理由で `report.date` は `"12"` のような1〜2桁にしかなり得ない
- 結果、**新規カルテを作成して公開しようとすると、何をしてもこのバリデーションに失敗する**
  （実機で確認: `alert('日付を YYYY/MM/DD の形式で入力してください。')` が毎回出る）
- KV モードにはこの検証が無い（`report.date` を月ラベルとしてそのまま使う設計）ため、
  **Supabase モードを作った際に、KV 用の抽出ロジックへ後から検証だけを足して、
  日付を結合する処理を足し忘れた**のが根本原因と推測される
- 直し方（F3 で実施）: `extractReport()` で `report.year` / `report.date` / `report.day` を
  結合して `YYYY-MM-DD` を作るか、`ponchi-engine.js:79` の `heroDateInput.value`
  （既に ISO 形式で存在する）をそのまま `report.date` として使う。後者のほうが二重管理にならず安全

#### その他の観察（バグではないが記録）

- `rahiseko@gmail.com` は店舗の管理者（staff）でもあるため、`/my`（顧客ポータル）を開くと
  `pets_staff_all` ポリシー（`supabase/migrations/202607160001_supabase_base.sql:658`）により
  **店舗の全ペットが見える**。これは仕様通り（スタッフは全顧客の犬を見る必要がある）だが、
  「他人の犬が見えないこと」の検証には**別の、スタッフ権限を持たない純粋な飼い主アカウント**が要る
  （F5 で対応）
- マスターが手動で試した QR招待テストにより、`owners` テーブルに `あ` という名前の飼い主が
  1件残っている（`61f24270-ab3c-4605-af81-dd9118077056`）。ダミーデータにつき実害なし

**受け入れ条件**: `docs/ops/plans/2026-08-23-completion.md` に、
①〜⑥それぞれの「通る/落ちる」と、落ちた場合の原因（ファイル名と行番号つき）が書かれている。

### F2 — ③犬を選ぶ（画面骨格）【完了・2026-08-23】

`飼い主ページ → ワンちゃんページ` の2層を、**犬の一覧1枚**にする。肉球画面を撤去する。

**scope 変更（実施時の判断）**: 当初 section id を `list/edit/view` へ全面改名する案を書いていたが、
実施しなかった。`screen-owner`/`screen-archive`/`screen-report` の3画面は KV モードと Supabase
モードで共有されており、id 改名は両モードの全参照箇所（表示分岐・CSS・E2E テスト）を巻き込む
大きな作業になる。今回の実害（動線に無い層・肉球画面）を消すのに id 改名は必須ではないため、
既存 id は維持し、`screen-owner` の**中身の出し分け**だけを変えた（下記）。

- **`worker/src/data-stores/supabase-data-store.js`**: `listPetsWithOwner()` を新設。
  `owners(name)` の PostgREST embed で、店舗の犬を飼い主名つき1回の問い合わせで取得
- **`worker/src/index.js`**: `GET /api/pets`（店舗の犬を直接一覧、スタッフのみ RLS で許可）を追加
- **`src/js/supabase-staff.js`**: `/edit` の処理を `GET /api/owners`（飼い主一覧）から
  `GET /api/pets`（犬の直接一覧）に差し替え
- **`src/js/ponchi-app.js`**: `renderFlatPetList()` を新設（`design/mock-4step.html` の
  「登録カルテ一覧」相当）。犬をクリックすると `/edit/p/{petId}` へ直接遷移し、肉球を経由せず
  archive（全月一覧）へ進む。「＋ 新規カルテを作成する」で犬名・飼い主名を1画面で受け取り、
  飼い主→犬の順に作成して編集画面へ進む導線も追加（1人目の飼い主が居ない状態からでも動く）
- **肉球画面（paw）を全面撤去**: `renderPawScreen`/`applyPawMap`/`PAW_MAP` ほか関数を削除、
  `#screen-paw` の HTML・CSS（`.paw`/`.toe-*`/`.pad*`）を削除。「戻るドロワー」（3択のガラスパネル、
  行き先の1つが paw だった）も、行き先が1つしかなくなったため撤去し直接遷移に簡略化
- `src/search.html` を削除し、`scripts/build-dist.mjs`（HTML コピー・完全性ガード）を追随

**受け入れ条件（実機確認済み）**
| 検証 | 結果 |
|---|---|
| `grep -c "paw" src/js/ponchi-app.js` | **0**（実施前31） |
| `grep -c "paw" src/design-samples/ponchi-v2.html` | **0** |
| `ls src/search.html` | 無い |
| 実ブラウザ: ログイン直後に犬の一覧が出る | ✅ 飼い主を選ぶ操作を挟まない（`/edit` で3頭が直接並ぶ） |
| 実ブラウザ: 犬をクリック | ✅ `/edit/p/{petId}` へ直接遷移、肉球を経由せず全カルテ一覧が出る |
| 実ブラウザ: 「戻る」 | ✅ `/edit`（犬の一覧）へ戻る |
| 実ブラウザ: 新規カルテ作成（犬名+飼い主名） | ✅ 飼い主・犬を作成し、その犬の編集画面へ進む。DB で確認済み |
| `npm run build` / `check` / `test` | EXIT 0・**67 pass**（変わらず） |

**確認していないこと**: 意匠（`design/mock-4step.html` の見た目）はまだ適用していない。
今の犬の一覧は「田舎レンダラ」（`createListItem` の素の DOM）で、意匠は P6/F4 相当の作業で乗せる。
KV モードの `/o/{ownerSlug}`（公開飼い主ページ）は `renderOwnerIndexList`/`renderPetList` の
古い経路のままで、paw 撤去の影響で「犬選択→肉球」ではなく「犬選択→即 archive」に変わった
（本番未デプロイのため実害なし。D-20260823-08 のとおり `workers.dev` のみ触れている）。

### F3 — ④カルテ作成（Supabase 経路の結線）【完了・2026-08-23】

カルテの新規作成・保存が Supabase 側の API で通るようにする。

**scope 変更（実施時の判明事項）**: 計画時点では「経路そのものを結線する」作業だと想定していたが、
実際には**経路は既に結線済みだった**。`showCreateFlow(4, {reportId:'new', ...})` が
`/edit/p/{petId}` のアーカイブ画面から URL を変えずに `screen-report` を開く既存の仕組みで
動いており、`/edit/p/{petId}/new` という新規ルートも `SUPABASE_EDIT_PATH_PATTERN` の拡張も
不要だった。`extractReport`/`applyReport` の Supabase 分岐、写真アップロード
（`TrimmerSupabaseStorage.uploadReportAssets`）も実装済みで、そのまま動いた。
**実際に必要だった修正は、F1 で見つけた `F-20260823-26`（日付結合の欠落）ただ1件**。

- `publish-client-ponchi.js` の `extractReport()` に `isoDate` キーを新設。
  `#heroDateInput`（`<input type="date">`、常に `YYYY-MM-DD`）の値をそのまま返す
- `ponchi-app.js` の公開検証を `report.date`（月だけ）ではなく `report.isoDate` を見るように修正
- 修正の過程でもう1件見つけて直した（`F-20260823-27`）: `clearReport()` が
  `#heroDateInput` 自体をリセットしておらず、新規カルテは日付ピッカーに触れない限り
  常に HTML の静的な既定値（2026年12月5日）で保存されるところだった。
  今日の日付で初期化するよう修正

**受け入れ条件（実機確認済み）**
| 検証 | 結果 |
|---|---|
| 実ブラウザ: 犬を選ぶ→記入（日付ピッカーに触れず）→確定→プレビュー→公開 | ✅ 「公開しました！」まで到達 |
| 保存された `reports.status` | ✅ `final` |
| 保存された `reports.report_date` | ✅ 実行日（今日の日付）と一致 |
| 保存された `staff_note` | ✅ 記入した値と一致 |
| 写真アップロード | ✅ `report_assets` に4件（Canvas 描画画像を含む） |
| `npm run build` / `check` / `test` | EXIT 0・67 pass（変わらず） |

**確認していないこと**: ⑥（顧客ページ）でこの内容が正しく見えるかは未確認（F4 の対象）。
公開処理は写真アセットの数だけ直列にアップロードするため、**体感で15〜20秒かかる**。
遅くはあるが今回のスコープの不具合ではないため、そのままにしてある。
`verify:*` の作り直し（F5）で、この経路の自動検査（新規カルテを1件、日付ピッカーに触れずに
公開できること）を追加すること。

### F4 — ⑤⑥確認ページ＝顧客ページ（同一レンダラ）

`src/js/magazine-view.js` を新設し、`renderMagazine(report)` が
モック `#screen-4` の意匠へ実データを**一方向で投影**する。
トリマーの確認画面と `/my` の飼い主画面が、この1本を共有する。

- 閲覧側は `data-view="…"` の別名前空間（編集側 `data-field=` と衝突させない）
- `src/js/supabase-auth.js` の `renderReport()` を `renderMagazine()` 呼び出しに差し替え

**受け入れ条件**
| 検証 | 合格値 |
|---|---|
| `grep -c 'data-view=' src/design-samples/ponchi-v2.html` | 20 以上 |
| 閲覧セクション内の `grep -c 'data-field='` | 0 |
| **記入→確定→飼い主画面** の値の一致 | 13項目すべて一致 |
| 飼い主に見える写真 | 非公開バケットの署名付きURL経由で表示される |

**【実施済み・2026-08-23・一部未確認】**

**scope 変更（実施時の判明事項・D-20260823-12）**: 上表の `data-view=` grep は
`ponchi-v2.html` の静的ソースを数える設計だったが、実装では
`src/js/magazine-view.js` 内の1つのテンプレート文字列（`renderMagazine()`）を
トリマー確認画面（`#screen-magazine`・`ponchi-v2.html`）と飼い主画面
（`[data-portal-content]`・`src/my.html`）の両方へ注入する方式にした。静的HTMLの
二重複製は、直したときに片方だけ古いまま残る「ズレ」を生む——このセッションで
直してきたバグ（F-20260821-22/23・F-20260823-26/27）と同じ再発条件のため避けた。
機械チェックは静的 grep から実行時 DOM チェック（下記）へ差し替えた。

実装内容:
- `src/js/magazine-view.js`（新規）: `renderMagazine(container, report, opts)`。
  皮膚（10行）・爪・耳（左右）・歯・体重推移（実データから計算したSVG折れ線）・
  カット写真ギャラリー・担当からの一言・過去レポートのタイムライン（実 reportId
  リンク）を実データから描画。記入の無い項目は「記録がありません」と出すか、
  枠ごと隠す（モックの創作文・固定見本は使わない。D-20260823-13）。
  アコーディオン開閉・クイックジャンプ・ライトボックスも実装
- `src/js/supabase-auth.js`: `renderReport()` を `renderMagazine()` 呼び出しに
  差し替え。`hydrateAssetReferences()` で写真の `asset://` マーカーを署名付き
  ダウンロードへ解決してから渡す
- `src/js/ponchi-app.js`: Step 6（`showPreview`）を Supabase モードのみ分岐。
  `showMagazinePreview()` が `extractReport()` の in-memory データをそのまま
  `renderMagazine()` に渡し、`#screen-magazine` に表示する。KV モードは
  `showLegacyPreview()` として無変更のまま残した（D-20260823-15・現行本番は触れない）
- `src/design-samples/ponchi-v2.html`: `#screen-magazine` マウント枠と
  `magazine-view.js` の読込を追加

**受け入れ条件の確認状況**:
| 検証 | 状態 |
|---|---|
| `renderMagazine()` の実ブラウザ単体検証（Playwright/chromium・合成データ） | ✅ 27/27 PASS。`data-view` 35件・`data-field` 0件、13項目相当の実データ描画、記入なし項目の非表示、XSS注入不実行、アコーディオン/クイックジャンプ/ライトボックス/タイムラインリンク/戻るボタンの実動作、コンソールエラー0件 |
| `npm run build` / `check` / `test` | ✅ 全て EXIT 0（67件、regressionなし） |
| **記入→確定→飼い主画面** の実 Supabase 往復（実ログイン・実カルテ作成・実公開） | ⏳ **未確認**（D-20260823-17）。このセッションのコンテナには `CLOUDFLARE_API_TOKEN` も Supabase service role key（テストログイン用）も無く、F1〜F3 と同じ実機検証ができなかった。`wrangler dev` はローカルでCloudflareアカウント無しに動くことは確認済み。ボトルネックは自動ログイン手段（service role key）の方 |
| 飼い主に見える写真が署名付きURL経由 | ⏳ 未確認（同上。コード上は `hydrateAssetReferences()` を経由する実装になっている） |

### F5 — 検査を Supabase 版へ作り直す

現行の `verify:m6` / `verify:roundtrip` / `verify:empty` / `verify:xss` は
**KV モード（`npm run preview`）と `#screen-paw` 前提**で、F2 で全て壊れる。
`test/e2e/*.cjs` も同じく KV 前提。**作り直しを工程として見積もる。**

- 4本を Supabase モード・新画面構成へ書き直す
- `verify:roundtrip` は「トリマーが書いた13項目が飼い主に同じ値で届く」を維持（最重要）
- `verify:portal` は既にある（ログイン前まで）ので、ログイン後の検査を追加

**受け入れ条件**
| 検証 | 合格値 |
|---|---|
| `npm run verify:all` | 全本 EXIT 0 |
| `npm test` | EXIT 0・件数が現状（67）以上 |
| 他人の犬が見えないこと | 別アカウントで 404 / 空 |

### F6 — 独自ドメインへ切り替え

- `worker/wrangler.toml` の `routes` を Supabase 版へ移し、旧 Worker はルートのみ外す
- Supabase の Site URL / Redirect URLs を独自ドメインへ変更
- Google OAuth 同意画面を本番公開（D-7）

**受け入れ条件**
| 検証 | 合格値 |
|---|---|
| `https://trimmer-system.kouheikosehira.com/` | Supabase 版が応答 |
| 同ドメインで6段階を一周 | 全て通る |
| 旧 Worker | 残っているがルート無し（切り戻せる） |

---

## 全体の受け入れ条件（これが満たされたら「完成」）

1. `https://trimmer-system.kouheikosehira.com` で、①〜⑥が**実機で一周する**
2. トリマーが書いた13項目が、飼い主の画面に**同じ値で**出る（`verify:roundtrip`）
3. 他人の犬・未確定カルテが**見えない**（RLS の実証）
4. カルテ0件の犬に**架空の履歴が出ない**（`verify:empty`）
5. 保存データが飼い主のブラウザで**実行されない**（`verify:xss`）
6. `npm run build` / `check` / `test` / `verify:all` が全て EXIT 0
7. 上記1〜6が `docs/handoff.md` に、再現手順つきで記録されている

---

## 検証の進め方

- **推測で「動く」と書かない**（`F-20260821-11` の再発防止）。実ブラウザか実 DB で確かめた
  ものだけを「通った」と記録し、確かめていないものは「未確認」と明記する
- 各フェーズの終わりに `docs/handoff.md` を更新し、失敗があれば `docs/failures.md` に追記
- 本番へ出すのは F6 のみ。F1〜F5 は `workers.dev` 上で行い、現行本番に触れない

## セッションを跨ぐ維持

計画はチャットではなく**リポジトリ**に置く（F0）。次のセッションは
`docs/handoff.md` → `docs/ops/plans/2026-08-23-completion.md` → `docs/decisions.md`
の順に読めば、現在地・決定事項・残作業が分かる。

## 未決（マスター判断が要るもの）

| # | 内容 | 何が止まるか |
|---|---|---|
| U-1 | 素材15件の出所（`docs/ASSET-PROVENANCE.md` の UNVERIFIED） | 第三者の犬の写真を配り続けるリスク。コードでは解けない |

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

### F2 — ③犬を選ぶ（画面骨格）

`飼い主ページ → ワンちゃんページ` の2層を、**犬の一覧1枚**にする。肉球画面を撤去する。

- `src/design-samples/ponchi-v2.html` の section id を `list / edit / view` へ改名
- `src/js/ponchi-app.js` から肉球画面（paw）を撤去
- `src/search.html` を削除し、`scripts/build-dist.mjs` を追随させる

**受け入れ条件**
| 検証 | 合格値 |
|---|---|
| `grep -c "paw" src/js/ponchi-app.js` | 0（現状31） |
| `ls src/search.html` | 無い |
| 実ブラウザ: ログイン直後に犬の一覧が出る | 飼い主を選ぶ操作を挟まない |

### F3 — ④カルテ作成（Supabase 経路の結線）

カルテの新規作成・保存が Supabase 側の API で通るようにする。

- `supabase-staff.js` に `/edit/p/{petId}/new` を追加、`worker/src/index.js:40` の
  `SUPABASE_EDIT_PATH_PATTERN` を1箇所拡張
- `publish-client-ponchi.js` の `extractReport` / `applyReport` を Supabase 経路から呼ぶ
- 写真アップロードを `supabase-storage.js` 経由に結線

**受け入れ条件**
| 検証 | 合格値 |
|---|---|
| 実ブラウザ: 犬を選ぶ→記入→保存 | `reports` に1行増える |
| 保存した値を DB から読み出す | 記入した値と一致 |
| 写真1枚アップロード | `report-assets` にオブジェクトが増える |

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

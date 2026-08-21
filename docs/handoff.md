# Session Handoff (docs/handoff.md)

> **運用ルール**
> - セッション間の揮発的な作業状態の引き継ぎファイルです。
> - セッション開始時 (`In`) に読み込み、セッション終了時 (`Out`) に更新します。
> - 恒久的な設計情報はここではなく `docs/design.md` に記載してください。

---

## 1. 今回やったこと (Completed in this session)

**移設 plan（M0〜M9）完走。統合フェーズの P0（エンジン抽出）まで到達。
すべて `master` にマージ済み。`docs/failures.md` の OPEN は 0 件。**

### 移設の仕上げ

- **M5**: `npm run check` の親モノレポ参照を自リポジトリへ。`--test-isolation=none`（node 22 で `bad option`）を除去。実体を移設していない `predeploy-check` と、それを指す `wrangler.toml` / `runbook.md` の記述を是正。`playwright@1.59.1` / `wrangler@4.92.0` を devDependencies に宣言。lockfile を追加。
- **M6**: `npm run preview`（KV local）で実際にアプリを動かし、受入基準9項目を通した。`scripts/verify-m6.mjs` として残してある。過程で不具合3件を修正（`/api/config` の KV モード欠落 / デモ月の無効 fetch / favicon 404）。
- **M7**: 眠っていた Supabase 系3スイート（storage 6 / store 23 / auth 10 = 39件）を配線し、`npm test` が全6スイート **61 pass** を実行するようにした。`scripts/design-isolation-guard.mjs` を新設して `npm run check` に組み込み、`design/README.md` を追加。
- **M8**: 外部 CDN 参照を全廃。Unsplash 10件は**同梱ではなく撤去**（全て写真アップロードまでの仮置きで、他人の犬を顧客の犬として見せるのは F-15 と同じ問題になる）。フォントは Latin 3ファミリを同梱し、日本語4ファミリは容量（Noto 2種で 70MB）を理由にシステムフォントへ寄せた。PWA manifest を4ファイルに結線し、dist でのパス変化も build に置換を足して塞いだ。`docs/ASSET-PROVENANCE.md` を新設。実在顧客名と個人アドレスを除去し、`docs/runbook.md` の移設元パス6箇所も是正。
- **M9**: `AGENTS.md` の Golden Stack をテンプレの鉄板構成（Next.js / Tailwind / Prisma / Vitest）から**本リポジトリの確定スタック**へ差し替え。MECHANICAL CHECK と REAL VERIFICATION に実コマンドを明記し、LEVEL D に事故から昇格した13条を記載。`docs/design.md` は空テンプレだったので実態で埋めた。

### 見つけて直した不具合（ここが本体）

マスター指摘「もともとの APP の機能を再現しろ。Goal はクライアントが問題なく使えることだ」を
受けて、受入基準ではなく機能そのものを検査した結果。

- **カルテの中身が飼い主に届いていなかった（F-11〜F-14）** — 皮膚の種類・変化と歯の状態は保存されるのに復元で静かに消え（`cssAttrSafe` が日本語の値を空にしていた）、耳・爪・歯のコメントは `data-field` が無く保存対象ですらなく、担当からの一言は保存されないうえ既定文が飼い主に届いていた。犬の名前も肉球画面に一度も出ていなかった。
- **カルテ0件の犬に、存在しない履歴が出ていた（F-15）** — 架空の月ラベル5つ・他所の犬の Unsplash 写真5枚・他の犬の体重と担当コメント入りのデモカルテが、その犬の名前で表示されていた。
- **stored XSS・Critical（F-17）** — 認証不要の `POST /api/reports` に細工した `weights[].ym` を入れるだけで、飼い主の公開ページで任意の JS が実行された。実ブラウザで実証・修正済み。
- **vibe-base への依存を打ち切り（F-09 / F-10）** — 「移設元を見ないと決着しない」としていた2件を、このリポジトリだけで解決または基準の読み替えで完了。以後 vibe-base は参照しない。

### 統合フェーズ

- **P0** — `ponchi-v2.html` のインライン `<script>` 985行を `src/js/ponchi-engine.js` へ**逐語**で切り出した。`origin/master` の同じ範囲とバイト単位で**完全一致**を確認済み（位置だけが変わった）。HTML は 2154行 → 1168行。`/p/` `/edit/o/` `/o/` の全経路で engine が参照・配信されることも実機で確認。

`docs/failures.md` に **21 件**を記録（**CLOSED 21 / OPEN 0**、+ F-06 の Root Cause 訂正）。

---

## 2. 現在の状態 (Current State)

### リポジトリ

| | |
|---|---|
| `master` | `9491e45` |
| `claude/checkin-8u5taq` | `9491e45`（master と同位置） |
| 未コミット / 未 push | 0 件 |
| 開いている PR | なし（#1・#2・#3 すべてマージ済み） |

### 機械検証

| コマンド | 結果 |
|---|---|
| `npm run build` | EXIT 0 |
| `npm run check` | EXIT 0（src↔dist parity + design/ isolation の2本） |
| `npm test` | EXIT 0・**61 pass / 0 fail**（全6スイート） |
| `npm run verify:m6` | **11/11 PASS** |
| `npm run verify:roundtrip` | **15/15 PASS**（記入→保存→公開ページの往復13項目） |
| `npm run verify:empty` | **8/8 PASS**（カルテ0件の犬に架空の履歴が出ないこと） |
| `npm run verify:xss` | **6/6 PASS**（保存データが飼い主のブラウザで実行されないこと） |

`npm run verify:all` で verify 系4本をまとめて回せる。
**いずれも別端末で `npm run preview` を起動してから実行する。**
playwright 管理外の chromium を使う場合は `M6_CHROMIUM=/path/to/chrome` を渡す。

**`verify:roundtrip` がこのリポジトリで一番重要な検査。** 画面が出るか・押せるかではなく、
トリマーが書いた所見が飼い主の公開ページに同じ値で届くかを突き合わせる。
**入力欄を足したら必ずこの検査にも足すこと。** 足さなければ、その欄は
「保存されていない」状態に戻っても誰も気づかない。

### 動くことが確認できているもの

**導線（`verify:m6`）**: ログイン画面 / 検索一覧 / 飼い主・犬の新規登録（POST 200）/
肉球画面 / 犬体図への Konva 描画（ペン・色変更・undo）/ 写真アップロード（7スロット）/
カルテ保存（`POST /api/reports` 200）/ 公開ページ `/p/{slug}` での閲覧モード再現 /
アプリ由来のコンソールエラー 0 件。

**中身（`verify:roundtrip`）**: 犬の名前 / 皮膚1の部位・大きさ・種類・変化 / 歯の状態 /
耳（右・左）/ 爪のレベル / 耳・爪・歯のコメント / 担当からの一言 —— 13項目すべてが、
トリマーの記入どおりの値で飼い主の公開ページに現れる。

**空（`verify:empty`）**: カルテ0件の犬には、架空の月ラベルも見本写真もタップ導線も出ない。
飼い主には「まだカルテがありません」。トリマーの中央パッドからは1件目を作成できる。

**安全（`verify:xss`）**: 保存されたカルテのデータ6経路に細工を撃ち込んでも実行されない。

導線が通ることと中身が届くことは別物で、**後者は一度も検査されていなかった**。
`verify:m6` が 9/9 だった時点で、実際には所見の大半が消えていた（`F-20260821-11`）。

### 外部通信

**アプリは外部へ一切通信しない。** `verify:m6` 項目9 の外部リクエスト失敗は 24件 → **0件**。
Unsplash 直リンクは撤去、Google Fonts は同梱に切り替え済み（`F-20260821-07` は CLOSED）。

### 未解決（`docs/failures.md` の OPEN）

**0 件。**

ただし**コードでは解けないマスター確認待ちが1件ある** — `docs/ASSET-PROVENANCE.md` の素材20件のうち、
AI 生成が5件（C2PA 署名から OpenAI / Google と特定）、残る15件は出所不明で `UNVERIFIED`。
実写に見える4件（`photo-dog-ear` / `photo-dog-skin` / `guide-nail-state` / `guide-teeth-state`）が優先。
飼い主に配るページに載るため、第三者の犬が写っている場合はその飼い主の同意も要る。
消すと状態ガイドが空欄になるので、差し替えるまで残してある。

### レビュー体制の穴

CodeRabbit は PR #1〜#3 の**すべてでレビューが走っていない**（draft スキップ2回・レート上限2回）。
Free プランは概要のみで行単位の指摘を出さない。独立レビューを機能させるなら、
上限を上げるか、`AGENTS.md` LEVEL C の **INDEPENDENT CRITIC**（`prompts/independent-critic.md`）を
自前で回す必要がある。詳細は `F-20260821-21`。

---

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
| **`my.html` の DOM フック** | `data-portal="customer"` / `data-portal-content` / `data-login-panel` / `data-google-login` | ❌ **全部 0 件** |

`supabase-auth.js:280` が `document.body.dataset.portal === 'customer'` を条件にしているため、
**ポータルは一度も起動していない**（統合 plan のリスク#3）。
やることは「作る」ではなく「フックを戻す」に近い。

### ⚠️ 順序を P1 → P8 に変えた理由

この導線は**全部 Supabase の Google OAuth 前提**で、Supabase はまだ有効化されていない。
そして **KV モードには飼い主のログインが存在しない**——`/p/{slug}` が無認証なのは、
それが飼い主向けの唯一の経路だからである。

**P1 で先に `/p/` を消すと、Supabase が有効になるまで飼い主はカルテを一切見られなくなる。**
置き換え先を動く状態にしてから古い経路を消す順序にする。

もう1つ、P1 は「画面の改名」ではない。肉球画面の撤去（`grep -c "paw" src/js/ponchi-app.js` は
**現在 35**。統合 plan は 31 と書いているが、あれは移設元時点の値で、`markPawEmpty()` の追加分だけ増えている）と
`src/search.html` の削除を含み、**`verify:*` 4本はすべて `#screen-paw .pad` を経由している**ので
4本とも書き直しになる。検査の作り直しを含む一塊の作業として見積もること。

---

## 3. 次回やること (Next Steps)

1. **P8 — `my.html` の再結線**（次の一手）。上表の ❌ 1行を埋める作業。
   ただし **Supabase が無効なので実機検証ができない**。静的検証（`node --check` / フックの実在 /
   ルート定義との対応）までしか付けられず、`verify:roundtrip` のような実証は Supabase 有効化後になる。
   **「静的に通った」を「動く」と書かないこと**（`F-20260821-11` の再発防止）。
2. **Supabase の有効化**（マスター作業）— プロジェクト作成と Google OAuth 設定。
   P8 の実機確認と飼い主導線の成立の両方がここに依存する。**最優先の外部依存**。
3. **素材の出所確認**（マスター作業）— `UNVERIFIED` 15件。実写に見える4件が優先。
4. **P1 以降**（統合フェーズ）— P8 の導線が動いてから着手する。

統合に入る前に `docs/design.md` を読むこと。`finalize_report` が**4条件で黙って `null` を返す**ことなど、
書き直しを選ばない理由が実物の確認つきで書いてある。

---

## 4. 今回の反省（`docs/failures.md` に記録済み）

自分の進め方の失敗を3件記録した。次のセッションが同じ穴に落ちないための要点。

- **F-11** — 受入基準を満たすことを成果と取り違えた。検査は「操作できたか」ではなく
  **「入力したものが受け手に同じ値で届いたか」**で書く。
- **F-16** — 直せる不具合を「判断が要る」と称してマスターに投げ返した。
  **片方がクライアントに実害を出す選択は「判断」ではなく不具合**なので、直してから報告する。
- **F-21** — レビューが「実行されなかった」ことを「指摘が無かった」と報告した。
  bot の通知は**結果ではなく状態**として読む。

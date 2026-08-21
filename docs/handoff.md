# Session Handoff (docs/handoff.md)

> **運用ルール**
> - セッション間の揮発的な作業状態の引き継ぎファイルです。
> - セッション開始時 (`In`) に読み込み、セッション終了時 (`Out`) に更新します。
> - 恒久的な設計情報はここではなく `docs/design.md` に記載してください。

---

## 1. 今回やったこと (Completed in this session)

**M5（依存固定・自立化）／ M6（動作証明）／ M7（モック隔離とテスト配線）を完了。**

- **M5**: `npm run check` の親モノレポ参照を自リポジトリへ。`--test-isolation=none`（node 22 で `bad option`）を除去。実体を移設していない `predeploy-check` と、それを指す `wrangler.toml` / `runbook.md` の記述を是正。`playwright@1.59.1` / `wrangler@4.92.0` を devDependencies に宣言。lockfile を追加。
- **M6**: `npm run preview`（KV local）で実際にアプリを動かし、plan の受入基準9項目を全て通した。検証は `scripts/verify-m6.mjs`（`npm run verify:m6`）として残してあるので、次回以降は手作業でなく再実行できる。
- M6 の過程で見つけた不具合3件を修正（`/api/config` の KV モード欠落 / デモ月の無効 fetch / favicon 404）。
- **M7**: 眠っていた Supabase 系3スイート（storage 6 / store 23 / auth 10 = 39件）を `test:supabase:static` に配線し、`npm test` が全6スイート **61 pass** を実行するようにした。`scripts/design-isolation-guard.mjs` を新規作成して `npm run check` に組み込み、`design/README.md` を追加。
- **カルテ往復の修復（最重要）**: マスター指摘を受けて機能そのものを検査したところ、**トリマーが記入した所見の大半が飼い主に届いていなかった**。皮膚の種類・変化と歯の状態は保存されるのに復元で静かに消え（`cssAttrSafe` が日本語の値を空にしていた）、耳・爪・歯のコメントは `data-field` が無く保存対象ですらなく、担当からの一言は保存されないうえ既定文が飼い主に届いていた。犬の名前も肉球画面に一度も出ていなかった。全て修正し、`npm run verify:roundtrip` で常時検査する。詳細は `docs/failures.md` の F-20260821-11〜14。
- **カルテ0件の犬の見え方を是正（F-15）**: 施術を一度もしていない犬の公開ページに、架空の月ラベル5つ・他所の犬の Unsplash 写真5枚・他の犬の体重と担当コメント入りのデモカルテが、その犬の名前で出ていた。飼い主には見本を一切出さず「まだカルテがありません」を表示する。トリマー側の中央パッドだけ「＋ 新規カルテ」として残す（1件目を作る唯一の導線のため）。`npm run verify:empty` で検査。
- `docs/failures.md` に 16 件を記録（CLOSED 11 / OPEN 4、+ F-06 の Root Cause 訂正）。

## 2. 現在の状態 (Current State)

### 機械検証

| コマンド | 結果 |
|---|---|
| `npm run build` | EXIT 0 |
| `npm run check` | EXIT 0（src↔dist parity + design/ isolation の2本） |
| `npm test` | EXIT 0・**61 pass / 0 fail**（全6スイート = plan の目標値） |
| `npm run verify:m6` | **11/11 PASS・EXIT 0** |
| `npm run verify:roundtrip` | **15/15 PASS・EXIT 0**（記入→保存→公開ページの往復） |
| `npm run verify:empty` | **8/8 PASS・EXIT 0**（カルテ0件の犬に架空の履歴が出ないこと） |

`verify:m6` / `verify:roundtrip` / `verify:empty` は別端末で `npm run preview` を起動してから実行する。
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

導線が通ることと中身が届くことは別物で、**後者は一度も検査されていなかった**。
`verify:m6` が 9/9 だった時点で、実際には所見の大半が消えていた。

外部ホスト（`images.unsplash.com` / `fonts.googleapis.com`）への接続失敗 22 件は
実行環境の egress 制限によるもので、アプリの不具合ではない。ただし**外部 CDN に
依存していること自体**は D-4 違反として `F-20260821-07` に OPEN で記録した。

### 未着手

- **M8** PII / 権利 / PWA 是正 — `F-20260821-07` `-08` がここに対応。`塩田` は `src/search.html` `src/my.html` に残存、`@gmail.com` は `docs/runbook.md` に残存。
- **M9** ルール改訂と移設元の凍結 — `docs/design.md` の Golden Stack がテンプレのまま（Next.js / Prisma / Tailwind / Vitest。実際は Vanilla JS + Konva + Cloudflare Workers + `node --test`）。`AGENTS.md` も同様。

### 未解決（`docs/failures.md` の OPEN）

| ID | 内容 | 担当フェーズ |
|---|---|---|
| F-20260821-07 | 納品物が外部 CDN の画像・フォントに依存 | M8 |
| F-20260821-08 | PWA が未結線（`<link rel="manifest">` 0件） | M8 |
| F-20260821-09 | plan の言う XSS Critical の箇所を特定できていない | 要 vibe-base 参照 |
| F-20260821-10 | 移設元の失敗記録8件を転記できていない | 要 vibe-base 参照 |

`docs/runbook.md` は移設元の Windows 絶対パス（`C:\Users\...\vibe-base\...`）を残したままで、
このリポジトリの手順書として読めない。M9 で直す。

## 3. 次回やること (Next Steps)

1. **M8** — `F-20260821-07/-08` を潰す。Unsplash 直リンク10箇所の自リポジトリ同梱と `docs/ASSET-PROVENANCE.md` の作成が本体。あわせて 4ファイルに `link rel="manifest"` を足し、`src/search.html` `src/my.html` の `塩田` を置換する。
2. **M9** — `AGENTS.md` / `docs/design.md` を実スタック（Vanilla JS + Konva + Cloudflare Workers + `node --test`）へ書き換え、`runbook.md` の Windows 絶対パスを是正する。`F-20260821-09/-10` は vibe-base に触れる環境で行う。

導線・中身・空状態の3つに機械検査が付いたので、**「クライアントが使える状態が、壊れたら機械が気づく」ところまで来ている**。

なお F-11 と F-16 は自分の進め方の失敗として記録した。要点は2つ——受入基準を満たすことを
成果と取り違えないこと、そして**片方がクライアントに実害を出す選択は「判断」ではなく不具合**
なので、聞かずに直してから報告すること。

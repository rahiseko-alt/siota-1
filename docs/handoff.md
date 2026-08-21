# Session Handoff (docs/handoff.md)

> **運用ルール**
> - セッション間の揮発的な作業状態の引き継ぎファイルです。
> - セッション開始時 (`In`) に読み込み、セッション終了時 (`Out`) に更新します。
> - 恒久的な設計情報はここではなく `docs/design.md` に記載してください。

---

## 1. 今回やったこと (Completed in this session)

**M5（依存固定・自立化）と M6（動作証明）を完了。**

- **M5**: `npm run check` の親モノレポ参照を自リポジトリへ。`--test-isolation=none`（node 22 で `bad option`）を除去。実体を移設していない `predeploy-check` と、それを指す `wrangler.toml` / `runbook.md` の記述を是正。`playwright@1.59.1` / `wrangler@4.92.0` を devDependencies に宣言。lockfile を追加。
- **M6**: `npm run preview`（KV local）で実際にアプリを動かし、plan の受入基準9項目を全て通した。検証は `scripts/verify-m6.mjs`（`npm run verify:m6`）として残してあるので、次回以降は手作業でなく再実行できる。
- M6 の過程で見つけた不具合3件を修正（`/api/config` の KV モード欠落 / デモ月の無効 fetch / favicon 404）。
- `docs/failures.md` に 10 件を記録（CLOSED 5 / OPEN 5）。

## 2. 現在の状態 (Current State)

### 機械検証

| コマンド | 結果 |
|---|---|
| `npm run build` | EXIT 0 |
| `npm run check` | EXIT 0（移設後はじめて通った） |
| `npm test` | EXIT 0（worker-unit 5 pass） |
| `npm run verify:m6` | **11/11 PASS・EXIT 0** |

`verify:m6` は別端末で `npm run preview` を起動してから実行する。
playwright 管理外の chromium を使う場合は `M6_CHROMIUM=/path/to/chrome` を渡す。

### 動くことが確認できているもの（M6 受入基準・実測）

ログイン画面 / 検索一覧 / 飼い主・犬の新規登録（POST 200）/ 肉球画面（中央パッド1・指4）/
犬体図への Konva 描画（ペン・色変更・undo）/ 写真アップロード（7スロット）/
カルテ保存（`POST /api/reports` 200）/ 公開ページ `/p/{slug}` での閲覧モード再現
（アップロード写真と描画が静止画として戻る）/ アプリ由来のコンソールエラー 0 件。

外部ホスト（`images.unsplash.com` / `fonts.googleapis.com`）への接続失敗 24 件は
実行環境の egress 制限によるもので、アプリの不具合ではない。ただし**外部 CDN に
依存していること自体**は D-4 違反として `F-20260821-07` に OPEN で記録した。

### 未着手

- **M7** モック配置とテスト配線 — `design/README.md` と `scripts/design-isolation-guard.mjs` が未作成。眠っている Supabase 系3スイート（storage 6 / store 23 / auth 10 = 39件）がどの npm script からも走っていない。**個別に実行すると全て pass することは確認済み**（全6スイート合計 61 tests = plan の目標値）。配線するだけでよい。
- **M8** PII / 権利 / PWA 是正 — `F-20260821-06` `-07` `-08` がここに対応。`塩田` は `src/search.html` `src/my.html` に残存、`@gmail.com` は `docs/runbook.md` に残存。
- **M9** ルール改訂と移設元の凍結 — `docs/design.md` の Golden Stack がテンプレのまま（Next.js / Prisma / Tailwind / Vitest。実際は Vanilla JS + Konva + Cloudflare Workers + `node --test`）。`AGENTS.md` も同様。

### 未解決（`docs/failures.md` の OPEN）

| ID | 内容 | 担当フェーズ |
|---|---|---|
| F-20260821-06 | 肉球画面の犬名がデモ値「まるちゃん」のまま | M8 |
| F-20260821-07 | 納品物が外部 CDN の画像・フォントに依存 | M8 |
| F-20260821-08 | PWA が未結線（`<link rel="manifest">` 0件） | M8 |
| F-20260821-09 | plan の言う XSS Critical の箇所を特定できていない | 要 vibe-base 参照 |
| F-20260821-10 | 移設元の失敗記録8件を転記できていない | 要 vibe-base 参照 |

`docs/runbook.md` は移設元の Windows 絶対パス（`C:\Users\...\vibe-base\...`）を残したままで、
このリポジトリの手順書として読めない。M9 で直す。

## 3. 次回やること (Next Steps)

1. **M7** — 眠っている39テストを npm script に配線し、`design/README.md` と `design-isolation-guard.mjs` を追加する。`npm test` の pass 合計が 61 になれば合格。
2. **M8** — `F-20260821-06/-07/-08` を潰す。Unsplash 直リンク10箇所の自リポジトリ同梱と `docs/ASSET-PROVENANCE.md` の作成が本体。
3. **M9** — `AGENTS.md` / `docs/design.md` を実スタックへ書き換え、`runbook.md` のパスを是正する。`F-20260821-09/-10` は vibe-base に触れる環境で行う。

M6 は通ったので、**「動くものが揃っている」状態には到達している**。M7 以降は納品品質を上げる工程で、
アプリが動くかどうかの前提はもう崩れない。
